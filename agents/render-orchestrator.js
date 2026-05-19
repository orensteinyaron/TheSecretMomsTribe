/**
 * SMT Render Orchestrator
 *
 * Processes approved content through render pipelines, dispatching
 * to the appropriate renderer (video, static image, carousel) and
 * running QA validation before marking complete.
 *
 * Triggered by the system orchestrator when content gets approved,
 * or run manually.
 *
 * State machine:
 *   pending → rendering → (QA) → complete | failed | qa_failed
 *   pending → blocked (services unavailable)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node agents/render-orchestrator.js
 */

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { printCostSummary } from '../scripts/utils/cost-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// --- Config ---

const RENDER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Pending Items ---

async function getPendingItems() {
  const { data, error } = await supabase
    .from('content_queue')
    .select('*, render_profiles(*)')
    .eq('status', 'approved')
    .eq('render_status', 'pending')
    .not('render_profile_id', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Render] Failed to query pending items:', error.message);
    return [];
  }

  return data || [];
}

// --- Service Health Check ---

async function checkServicesHealth(requiredServices) {
  if (!requiredServices || requiredServices.length === 0) {
    return { healthy: true, unavailable: [] };
  }

  const { data: services, error } = await supabase
    .from('services')
    .select('slug, status')
    .in('slug', requiredServices);

  if (error) {
    console.error('[Render] Failed to check services:', error.message);
    return { healthy: false, unavailable: ['services_table_error'] };
  }

  // Flag any service not found as unavailable
  const found = new Set((services || []).map(s => s.slug));
  const missing = requiredServices.filter(s => !found.has(s));
  const inactive = (services || []).filter(s => s.status !== 'active');

  const unavailable = [
    ...inactive.map(s => `${s.slug} (${s.status})`),
    ...missing.map(s => `${s} (not_found)`),
  ];

  return {
    healthy: unavailable.length === 0,
    unavailable,
  };
}

// --- Spawn with Timeout ---

function spawnWithTimeout(command, args, options) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Process timed out after ${RENDER_TIMEOUT_MS / 1000}s`));
    }, RENDER_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(stderr.trim() || `Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// --- State Updates ---

async function setRendering(itemId) {
  const { error } = await supabase
    .from('content_queue')
    .update({
      render_status: 'rendering',
      render_started_at: new Date().toISOString(),
      render_error: null,
    })
    .eq('id', itemId);

  if (error) console.error(`[Render] Failed to set rendering state: ${error.message}`);
}

async function setFailed(itemId, reason) {
  const { error } = await supabase
    .from('content_queue')
    .update({
      render_status: 'failed',
      render_error: reason.slice(0, 2000),
    })
    .eq('id', itemId);

  if (error) console.error(`[Render] Failed to set failed state: ${error.message}`);
}

async function setBlocked(itemId, unavailableServices) {
  const reason = `Services unavailable: ${unavailableServices.join(', ')}`;
  const { error } = await supabase
    .from('content_queue')
    .update({
      render_status: 'blocked',
      render_error: reason,
    })
    .eq('id', itemId);

  if (error) console.error(`[Render] Failed to set blocked state: ${error.message}`);
}

async function setQAFailed(itemId, reason) {
  const { error } = await supabase
    .from('content_queue')
    .update({
      render_status: 'qa_failed',
      render_error: reason.slice(0, 2000),
    })
    .eq('id', itemId);

  if (error) console.error(`[Render] Failed to set qa_failed state: ${error.message}`);
}

async function setComplete(itemId, finalAssetUrl, costUsd) {
  const { error } = await supabase
    .from('content_queue')
    .update({
      render_status: 'complete',
      render_completed_at: new Date().toISOString(),
      final_asset_url: finalAssetUrl,
      render_cost_usd: costUsd,
      render_error: null,
    })
    .eq('id', itemId);

  if (error) console.error(`[Render] Failed to set complete state: ${error.message}`);
}

// --- Cost Aggregation ---

async function getItemRenderCost(contentId) {
  const { data: costs, error } = await supabase
    .from('cost_log')
    .select('cost_usd')
    .eq('content_id', contentId);

  if (error) {
    console.warn(`[Render] Failed to query costs for ${contentId}: ${error.message}`);
    return 0;
  }

  return (costs || []).reduce((sum, c) => sum + parseFloat(c.cost_usd), 0);
}

// --- QA: Static Image ---

async function qaStaticImage(imageUrl) {
  try {
    const sharp = (await import('sharp')).default;

    const response = await fetch(imageUrl);
    if (!response.ok) return { pass: false, reason: `HTTP ${response.status} fetching image` };

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length < 50_000) {
      return { pass: false, reason: `File too small (${(buffer.length / 1000).toFixed(1)}KB < 50KB)` };
    }

    const metadata = await sharp(buffer).metadata();

    const validResolutions = [
      [1080, 1920], // Story / Reel
      [1080, 1350], // IG portrait
      [1080, 1080], // IG square
    ];
    const validRes = validResolutions.some(
      ([w, h]) => metadata.width === w && metadata.height === h
    );
    if (!validRes) {
      return { pass: false, reason: `Invalid resolution: ${metadata.width}x${metadata.height}` };
    }

    const stats = await sharp(buffer).stats();
    const avgBrightness = stats.channels.reduce((sum, c) => sum + c.mean, 0) / stats.channels.length;
    if (avgBrightness < 40 || avgBrightness > 240) {
      return { pass: false, reason: `Brightness out of range: ${avgBrightness.toFixed(1)}` };
    }

    return { pass: true };
  } catch (err) {
    return { pass: false, reason: `QA error: ${err.message}` };
  }
}

// --- Renderer: moving-images (Video V2) ---

async function renderVideo(item) {
  console.log(`[Render] Spawning video renderer for ${item.id}...`);

  await spawnWithTimeout('npx', ['tsx', 'scripts/generate-video-v2.ts', item.id], {
    cwd: resolve(PROJECT_ROOT, 'video'),
    env: process.env,
  });

  // Retrieve final asset URL from metadata
  const { data: updated } = await supabase
    .from('content_queue')
    .select('metadata')
    .eq('id', item.id)
    .single();

  return updated?.metadata?.video_v2_url || updated?.metadata?.video_url || null;
}

// PR 2 of YAR-129: dispatches Moving Images QA to the per-profile agent
// at video/qa/run.ts (replaces the legacy video/scripts/qa-agent.ts).
// Behavior mirrors qaAvatarVideo: verdict is data, not gate, while the
// moving-images profile is in 'informational' qa_stability state.
async function qaVideo(item) {
  const localVideoPath = resolve(PROJECT_ROOT, 'video', 'out', item.id, `${item.id}-v2.mp4`);

  if (!existsSync(localVideoPath)) {
    return { pass: false, reason: `Video file not found at ${localVideoPath}` };
  }

  console.log(`[Render] Running per-profile QA (moving-images) for ${item.id}...`);

  const metadataTmp = join(tmpdir(), `qa-meta-${item.id}-${Date.now()}.json`);
  // moving-images doesn't require raw clip metadata — base dims work on the
  // composited mp4 only. b_roll_relevance / image_coherence / ken_burns
  // reconstruct slide segments from Whisper + frame-diff (no upstream
  // pipeline change needed).
  const metadata = {
    asset_id: item.id,
    hook_overlay_text: item.metadata?.qa_inputs?.hook_overlay_text,
  };
  writeFileSync(metadataTmp, JSON.stringify(metadata), 'utf-8');

  const qaOutputDir = resolve(PROJECT_ROOT, 'video', 'out', item.id, 'qa');
  mkdirSync(qaOutputDir, { recursive: true });

  let verdict = 'UNKNOWN';
  let reportPath = null;
  try {
    await spawnWithTimeout(
      'npx',
      [
        'tsx', 'qa/run.ts',
        '--asset', localVideoPath,
        '--profile', 'moving-images',
        '--content-id', item.id,
        '--metadata', metadataTmp,
        '--output-dir', qaOutputDir,
      ],
      { cwd: resolve(PROJECT_ROOT, 'video'), env: process.env }
    );

    const jsons = readdirSync(qaOutputDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, t: statSync(join(qaOutputDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (jsons.length > 0) {
      reportPath = join(qaOutputDir, jsons[0].f);
      const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
      verdict = report.overall_verdict;

      await supabase
        .from('content_queue')
        .update({
          metadata: {
            ...(item.metadata || {}),
            qa_report_v3: {
              json_path: reportPath,
              markdown_path: reportPath.replace(/\.json$/, '.md'),
              verdict,
              agent_version: report.agent_version,
              ran_at: report.ran_at,
              unmeasured_dimensions: report.unmeasured_dimensions,
              cost_usd: report.cost_summary?.total_usd,
              human_review_required: report.human_review_required,
            },
          },
        })
        .eq('id', item.id);
    }
  } catch (err) {
    rmSync(metadataTmp, { force: true });
    return { pass: false, reason: `QA agent crashed: ${err.message}` };
  } finally {
    rmSync(metadataTmp, { force: true });
  }

  return {
    pass: true,
    reason: `QA agent ran (verdict=${verdict}); human review required during profile stabilization`,
  };
}

// --- Renderer: avatar-v1 (Avatar Video) ---

async function renderAvatarVideo(item) {
  console.log(`[Render] Spawning avatar renderer for ${item.id}...`);

  await spawnWithTimeout('npx', ['tsx', 'scripts/generate-avatar-video.ts', item.id], {
    cwd: resolve(PROJECT_ROOT, 'video'),
    env: process.env,
  });

  // Retrieve final asset URL from metadata
  const { data: updated } = await supabase
    .from('content_queue')
    .select('metadata')
    .eq('id', item.id)
    .single();

  return updated?.metadata?.avatar_video_url || null;
}

// PR 1 of YAR-129: dispatches to the per-profile QA agent at video/qa/run.ts
// instead of the legacy video/scripts/qa-agent.ts. Behavior during profile
// stabilization (qa_stability.state='informational'):
//   - QA agent always exits 0; verdict is data, not gate.
//   - Orchestrator persists qa_report_v3 path to content_queue.metadata
//     for UI surfacing and human review.
//   - Pass:true is returned regardless of verdict — human review is the
//     gate per memory rule 29. Once the profile is promoted to decisional,
//     this function gates on verdict=PASS.
//
// metadata.qa_inputs (clips, reference_image_url, expected scripts) is
// surfaced by the future generate-avatar-video.ts change to the avatar
// pipeline. Until then, the QA agent runs with just the asset path —
// dimensions that need clip metadata return UNMEASURED.
async function qaAvatarVideo(item) {
  const localVideoPath = resolve(PROJECT_ROOT, 'video', 'out', item.id, `${item.id}-avatar.mp4`);

  if (!existsSync(localVideoPath)) {
    return { pass: false, reason: `Avatar video file not found at ${localVideoPath}` };
  }

  console.log(`[Render] Running per-profile QA (avatar-v1) for ${item.id}...`);

  const metadataTmp = join(tmpdir(), `qa-meta-${item.id}-${Date.now()}.json`);
  const qaInputs = item.metadata?.qa_inputs ?? {};
  const metadata = {
    asset_id: item.id,
    reference_image_url: qaInputs.reference_image_url,
    clips: qaInputs.clips,
    hook_overlay_text: qaInputs.hook_overlay_text,
  };
  writeFileSync(metadataTmp, JSON.stringify(metadata), 'utf-8');

  const qaOutputDir = resolve(PROJECT_ROOT, 'video', 'out', item.id, 'qa');
  mkdirSync(qaOutputDir, { recursive: true });

  let verdict = 'UNKNOWN';
  let reportPath = null;
  try {
    await spawnWithTimeout(
      'npx',
      [
        'tsx', 'qa/run.ts',
        '--asset', localVideoPath,
        '--profile', 'avatar-v1',
        '--content-id', item.id,
        '--metadata', metadataTmp,
        '--output-dir', qaOutputDir,
      ],
      { cwd: resolve(PROJECT_ROOT, 'video'), env: process.env }
    );

    // Find the latest JSON report in qaOutputDir.
    const jsons = readdirSync(qaOutputDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, t: statSync(join(qaOutputDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (jsons.length > 0) {
      reportPath = join(qaOutputDir, jsons[0].f);
      const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
      verdict = report.overall_verdict;

      // Persist QA artifact path + verdict into content_queue.metadata for UI.
      await supabase
        .from('content_queue')
        .update({
          metadata: {
            ...(item.metadata || {}),
            qa_report_v3: {
              json_path: reportPath,
              markdown_path: reportPath.replace(/\.json$/, '.md'),
              verdict,
              agent_version: report.agent_version,
              ran_at: report.ran_at,
              unmeasured_dimensions: report.unmeasured_dimensions,
              cost_usd: report.cost_summary?.total_usd,
              human_review_required: report.human_review_required,
            },
          },
        })
        .eq('id', item.id);
    }
  } catch (err) {
    rmSync(metadataTmp, { force: true });
    return { pass: false, reason: `QA agent crashed: ${err.message}` };
  } finally {
    rmSync(metadataTmp, { force: true });
  }

  // Informational stage: pass:true regardless. Decisional stage (post-
  // promotion) will gate on verdict==='PASS' && !human_review_required.
  return {
    pass: true,
    reason: `QA agent ran (verdict=${verdict}); human review required during profile stabilization`,
  };
}

// --- Renderer: static-image ---

async function renderStaticImage(item) {
  console.log(`[Render] Spawning static image renderer for ${item.id}...`);

  // Ensure image_status is 'pending' so image-gen.js picks it up
  await supabase
    .from('content_queue')
    .update({ image_status: 'pending' })
    .eq('id', item.id);

  await spawnWithTimeout('node', ['scripts/image-gen.js'], {
    cwd: PROJECT_ROOT,
    env: process.env,
  });

  // Retrieve final asset URL
  const { data: updated } = await supabase
    .from('content_queue')
    .select('image_url')
    .eq('id', item.id)
    .single();

  return updated?.image_url || null;
}

// --- Dispatch ---

const RENDERERS = {
  'moving-images': {
    render: renderVideo,
    qa: qaVideo,
  },
  'avatar-v1': {
    render: renderAvatarVideo,
    qa: qaAvatarVideo,
  },
  'static-image': {
    render: renderStaticImage,
    qa: async (item) => {
      const { data } = await supabase
        .from('content_queue')
        .select('image_url')
        .eq('id', item.id)
        .single();

      if (!data?.image_url) {
        return { pass: false, reason: 'No image_url after render' };
      }

      return qaStaticImage(data.image_url);
    },
  },
};

// --- Process Single Item ---

async function processItem(item) {
  const profile = item.render_profiles;
  const slug = profile?.slug;

  console.log(`\n[Render] Processing: ${item.id}`);
  console.log(`[Render]   Profile: ${slug} (${profile?.profile_type})`);

  // 1. Check profile status
  if (profile?.status !== 'active') {
    console.log(`[Render]   Profile "${slug}" is ${profile?.status} — skipping`);
    await setBlocked(item.id, [`render_profile "${slug}" is ${profile?.status}`]);
    return;
  }

  // 2. Service health check
  const requiredServices = profile?.required_services || [];
  const health = await checkServicesHealth(requiredServices);

  if (!health.healthy) {
    console.log(`[Render]   Services unavailable: ${health.unavailable.join(', ')}`);
    await setBlocked(item.id, health.unavailable);
    return;
  }

  // 3. Find renderer
  const renderer = RENDERERS[slug];
  if (!renderer) {
    console.log(`[Render]   No renderer for profile "${slug}" — skipping`);
    await setBlocked(item.id, [`no_renderer_for_${slug}`]);
    return;
  }

  // 4. Render
  await setRendering(item.id);

  let finalAssetUrl;
  try {
    finalAssetUrl = await renderer.render(item);
    console.log(`[Render]   Render complete. Asset: ${finalAssetUrl || '(none)'}`);
  } catch (err) {
    console.error(`[Render]   Render FAILED: ${err.message}`);
    await setFailed(item.id, err.message);
    return;
  }

  // 5. QA
  try {
    const qa = await renderer.qa(item);

    if (!qa.pass) {
      console.error(`[Render]   QA FAILED: ${qa.reason}`);
      await setQAFailed(item.id, qa.reason);
      return;
    }

    console.log(`[Render]   QA passed`);
  } catch (err) {
    console.error(`[Render]   QA error: ${err.message}`);
    await setQAFailed(item.id, err.message);
    return;
  }

  // 6. Cost aggregation
  const totalCost = await getItemRenderCost(item.id);
  console.log(`[Render]   Cost: $${totalCost.toFixed(4)}`);

  // 7. Mark complete
  await setComplete(item.id, finalAssetUrl, totalCost);
  console.log(`[Render]   COMPLETE`);
}

// --- Main ---

const WATCH_MODE = process.argv.includes('--watch');
const WATCH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

async function runOnce() {
  console.log(`[Render Orchestrator] Checking for approved content to render... (${new Date().toLocaleTimeString()})`);

  const items = await getPendingItems();

  if (items.length === 0) {
    console.log('[Render] No pending items.');
    return;
  }

  console.log(`[Render] Found ${items.length} item(s) to process`);

  // Process sequentially (renders are expensive)
  for (const item of items) {
    await processItem(item);
  }

  await printCostSummary(supabase, 'render orchestrator');
}

async function main() {
  await runOnce();

  if (WATCH_MODE) {
    console.log(`[Render] Watch mode — polling every ${WATCH_INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
    setInterval(async () => {
      try {
        await runOnce();
      } catch (err) {
        console.error('[Render] Error during poll:', err.message);
      }
    }, WATCH_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('[Render] Fatal error:', err);
  process.exit(1);
});
