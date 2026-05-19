// SeedanceClient interface — the localized seam for swapping the
// generation backend.
//
// v5.0 has two implementations:
//   - FakeSeedanceClient (./fake-client.ts) — deterministic stub for tests
//   - The Claude Code session itself, calling Higgsfield MCP directly per
//     the playbook in docs/specs/AVATAR_FULL_V5.md. There is intentionally
//     no production TypeScript implementation of this interface in v5.0,
//     because MCP tools are Claude-session-scoped and a Node-side bridge
//     would be more fragile than the playbook for a pipeline that still
//     has a per-clip human-review gate.
//
// v5.x will land HttpSeedanceClient (or BytePlusClient) as a drop-in
// implementation of this interface; render-avatar-full-v5.ts will then
// gain a --phase=seedance subcommand and the playbook becomes optional.

import type { ClipParams, ClipResult } from "./types.js";

export interface SeedanceClient {
  generateClip(params: ClipParams): Promise<ClipResult>;
}
