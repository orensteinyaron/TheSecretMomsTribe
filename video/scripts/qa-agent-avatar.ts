// DEPRECATED — replaced by per-profile QA agents in PR 1 of YAR-129.
//
// The previous monolithic agent at this path has been removed in favor of
// the dispatch at video/qa/run.ts. See video/qa/README.md for the new CLI.
//
// Migration from the old CLI:
//   OLD:  npx tsx video/scripts/qa-agent-avatar.ts \
//             --reference <url> --clips <clips.json> --label "Test 5"
//   NEW:  Build a metadata.json with:
//           { "reference_image_url": "<url>",
//             "clips": [{ "id": "SCENE_01", "url": "<url>",
//                         "expected_script": "<verbatim ElevenLabs script>",
//                         "duration_s": 9,
//                         "start_offset_in_final_s": 0 }, ...] }
//         Then:
//           npx tsx video/qa/run.ts \
//               --asset <final-composited-mp4> \
//               --profile avatar-v1 \
//               --metadata <metadata.json>
//
// The new agent operates on a final composited MP4 + raw clip URLs. If you
// only have raw clips and no composited output (legacy proof-loop usage),
// concat the clips first with `ffmpeg -f concat` and pass that as --asset.

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

console.error(`
[deprecated] video/scripts/qa-agent-avatar.ts has been replaced.

Use the per-profile QA agent at video/qa/run.ts.

  npx tsx video/qa/run.ts \\
    --asset <local-path> \\
    --profile avatar-v1 \\
    --metadata <metadata.json> \\
    [--content-id <uuid>] \\
    [--keep-workdir]

See video/qa/README.md for full documentation and the legacy-to-new
metadata.json mapping. This shim ships in PR 1 (YAR-129) and is removed
at the end of PR 3 after all callers migrate.
`);
process.exit(1);
