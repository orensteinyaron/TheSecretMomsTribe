/**
 * SMT Image Generation Agent
 *
 * Generates DALL-E images ONLY for approved posts.
 * Images are expensive (~$0.08 each) — never waste on rejected content.
 *
 * Flow:
 *   1. Query content_queue WHERE status=approved AND image_status=pending
 *   2. Enhance image_prompt with Visual Design Guide rules
 *   3. Call DALL-E 3 API
 *   4. Upload to Supabase Storage (post-images bucket)
 *   5. Update content_queue with image_url and image_status
 *
 * For multi-slide posts: generates images for slides that have image_prompts,
 * stores URLs in slide_images JSONB array.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... node scripts/image-gen.js
 */

import { createClient } from '@supabase/supabase-js';
import { logCost, printCostSummary } from './utils/cost-logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Size mapping by post_format ---

const SIZE_MAP = {
  tiktok_slideshow: '1024x1792',
  tiktok_text: '1024x1792',
  ig_carousel: '1024x1024',
  ig_static: '1024x1024',
  ig_meme: '1024x1024',
  video_script: '1024x1024',
};

// --- Image prompt enhancement ---

const PROMPT_PREFIX = `CRITICAL RULES:
- NO faces visible anywhere. Show only: hands, backs of heads, over-shoulder angles, feet, silhouettes.
- Warm, golden-hour lighting. Never harsh, clinical, or cool-toned.
- Color palette: warm amber, soft cream, dusty blush, muted sage. Never oversaturated.
- Style: editorial photography. Must look like a real photograph, NOT AI-generated.
- Environments should feel real and lived-in: kitchens, living rooms, cars, parks, bedrooms.
- No text or words in the image.
- Soft focus backgrounds. Subject in focus.

IMAGE REQUEST:
`;

function enhancePrompt(rawPrompt) {
  let prompt = rawPrompt || '';
  // Ensure no-faces rule is explicit
  if (!prompt.toLowerCase().includes('no face')) {
    prompt = prompt + ' No faces visible.';
  }
  return PROMPT_PREFIX + prompt;
}

// --- DALL-E API call ---

async function generateImage(prompt, size) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: enhancePrompt(prompt),
      n: 1,
      size,
      quality: 'hd',
      style: 'natural',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DALL-E API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.data[0].url;
}

// --- Upload to Supabase Storage ---

async function uploadToStorage(dalleUrl, postId, suffix = '') {
  // Download from DALL-E temporary URL
  const imageResponse = await fetch(dalleUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageResponse.status}`);
  }
  const buffer = Buffer.from(await imageResponse.arrayBuffer());

  const filename = `${postId}${suffix}-${Date.now()}.png`;
  const { error } = await supabase.storage
    .from('post-images')
    .upload(filename, buffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from('post-images')
    .getPublicUrl(filename);

  return urlData.publicUrl;
}

// --- Process a single post ---

async function processPost(post) {
  const size = SIZE_MAP[post.post_format] || '1024x1024';
  console.log(`[ImageGen] Processing ${post.id} (${post.post_format}, ${size})...`);

  // Mark as generating
  await supabase.from('content_queue')
    .update({ image_status: 'generating' })
    .eq('id', post.id);

  try {
    // Generate hero/cover image from image_prompt
    let heroUrl = null;
    if (post.image_prompt) {
      // image_prompt might be a JSON string of array (legacy) or a plain string
      let promptText = post.image_prompt;
      try {
        const parsed = JSON.parse(promptText);
        if (Array.isArray(parsed)) {
          promptText = parsed[0]; // Use first prompt as hero
        }
      } catch {
        // It's a plain string, use as-is
      }

      console.log(`[ImageGen] Generating hero image...`);
      const dalleUrl = await generateImage(promptText, size);
      heroUrl = await uploadToStorage(dalleUrl, post.id, '-hero');
      console.log(`[ImageGen] Hero uploaded: ${heroUrl}`);
      await logCost(supabase, {
        pipeline_stage: 'image_generation', service: 'openai',
        model: `dall-e-3-${size}-hd`,
        content_id: post.id,
        description: `Hero image for ${post.platform} ${post.post_format}`,
        metadata: { size, quality: 'hd', style: 'natural', type: 'hero' },
      });
    }

    // Process slide-level images if slides exist
    const slideImages = [];
    const slides = post.slides || [];

    if (Array.isArray(slides) && slides.length > 0) {
      for (const slide of slides) {
        if (slide.image_prompt) {
          console.log(`[ImageGen] Generating slide ${slide.slide_number} image...`);
          try {
            const dalleUrl = await generateImage(slide.image_prompt, size);
            const slideUrl = await uploadToStorage(dalleUrl, post.id, `-slide${slide.slide_number}`);
            slideImages.push({
              slide_number: slide.slide_number,
              image_url: slideUrl,
            });
            console.log(`[ImageGen] Slide ${slide.slide_number} uploaded: ${slideUrl}`);
            await logCost(supabase, {
              pipeline_stage: 'image_generation', service: 'openai',
              model: `dall-e-3-${size}-hd`,
              content_id: post.id,
              description: `Slide ${slide.slide_number} image`,
              metadata: { size, quality: 'hd', style: 'natural', type: 'slide', slide_number: slide.slide_number },
            });
          } catch (err) {
            console.warn(`[ImageGen] Slide ${slide.slide_number} failed: ${err.message}`);
            slideImages.push({
              slide_number: slide.slide_number,
              image_url: null,
              error: err.message,
            });
          }
        }
      }
    }

    // Update content_queue with results
    const update = {
      image_status: 'generated',
      image_url: heroUrl,
      slide_images: slideImages.length > 0 ? slideImages : [],
    };

    const { error } = await supabase.from('content_queue')
      .update(update)
      .eq('id', post.id);

    if (error) {
      throw new Error(`DB update failed: ${error.message}`);
    }

    const totalImages = (heroUrl ? 1 : 0) + slideImages.filter((s) => s.image_url).length;
    console.log(`[ImageGen] ${post.id}: ${totalImages} image(s) generated successfully`);
    return totalImages;

  } catch (err) {
    console.error(`[ImageGen] ${post.id} FAILED: ${err.message}`);
    await supabase.from('content_queue')
      .update({ image_status: 'failed' })
      .eq('id', post.id);
    return 0;
  }
}

// --- Main ---

async function main() {
  console.log('[ImageGen Agent] Starting image generation for approved posts...');
  const startTime = Date.now();

  // Query approved posts that need images
  const { data: posts, error } = await supabase
    .from('content_queue')
    .select('*')
    .eq('status', 'approved')
    .eq('image_status', 'pending')
    .not('image_prompt', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[ImageGen] Failed to query posts:', error);
    process.exit(1);
  }

  if (!posts || posts.length === 0) {
    console.log('[ImageGen] No approved posts needing images. Done.');
    process.exit(0);
  }

  console.log(`[ImageGen] Found ${posts.length} post(s) to generate images for`);

  let totalImages = 0;
  let successCount = 0;
  let failCount = 0;

  // Process sequentially to avoid DALL-E rate limits
  for (const post of posts) {
    const count = await processPost(post);
    if (count > 0) {
      totalImages += count;
      successCount++;
    } else {
      failCount++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[ImageGen Agent] Done in ${elapsed}s.`);
  console.log(`[ImageGen] ${successCount} posts succeeded, ${failCount} failed`);
  console.log(`[ImageGen] ${totalImages} total images generated`);

  await printCostSummary(supabase);
}

main().catch((err) => {
  console.error('[ImageGen Agent] Fatal error:', err);
  process.exit(1);
});
