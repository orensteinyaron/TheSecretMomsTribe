/**
 * Batch generate videos for all approved posts that don't have video yet.
 * 
 * Usage: npx tsx scripts/batch-generate.ts [--limit N] [--no-tts] [--no-images]
 */

import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import path from "path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const limitFlag = args.findIndex(a => a === "--limit");
const limit = limitFlag >= 0 ? parseInt(args[limitFlag + 1]) : 5;
const extraFlags = args.filter(a => a === "--no-tts" || a === "--no-images").join(" ");

async function main() {
  console.log(`\n🎬 SMT Batch Video Generator`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Limit: ${limit} posts  |  Flags: ${extraFlags || "none"}\n`);

  // Find approved posts without video
  const { data: posts, error } = await supabase
    .from("content_queue")
    .select("id, hook, content_pillar")
    .eq("status", "approved")
    .or("metadata->>video_generated.is.null,metadata->>video_generated.eq.false")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  if (!posts || posts.length === 0) {
    console.log("No posts need video generation.");
    return;
  }

  console.log(`Found ${posts.length} posts to process:\n`);

  let success = 0;
  let failed = 0;
  let totalCost = 0;

  for (const post of posts) {
    console.log(`\n── ${post.id.slice(0, 8)} ──`);
    console.log(`   "${post.hook?.slice(0, 50)}..."`);

    try {
      const scriptPath = path.resolve("scripts/generate-video.ts");
      const cmd = `npx tsx ${scriptPath} ${post.id} ${extraFlags}`;
      execSync(cmd, { stdio: "inherit", cwd: path.resolve(".") });
      success++;
    } catch (err) {
      console.error(`   ❌ Failed: ${err}`);
      failed++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Batch complete: ${success} succeeded, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);
