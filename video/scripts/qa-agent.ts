// DEPRECATED — replaced by per-profile QA agents in PR 1/2 of YAR-129.
//
// Use video/qa/run.ts. CLI:
//   npx tsx video/qa/run.ts \
//     --asset <local-path-to-mp4> \
//     --profile moving-images \
//     --metadata <metadata.json> \
//     [--content-id <uuid>] \
//     [--keep-workdir]
//
// agents/render-orchestrator.js was rewired in PR 2 to call the new
// entry point with --profile moving-images. The legacy --avatar flag
// path was rewired in PR 1 to use --profile avatar-v1 instead.

import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

console.error(`
[deprecated] video/scripts/qa-agent.ts has been replaced.

Use the per-profile QA agent at video/qa/run.ts.

  npx tsx video/qa/run.ts \\
    --asset <local-path> \\
    --profile moving-images \\
    --metadata <metadata.json> \\
    [--content-id <uuid>]

See video/qa/README.md for full documentation. This shim ships in PR 2
(YAR-129) and is removed at the end of PR 3 after all callers migrate.
`);
process.exit(1);
