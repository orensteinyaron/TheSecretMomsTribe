import { randomUUID } from "node:crypto";

import type { SeedanceClient } from "./SeedanceClient.js";
import type { ClipParams, ClipResult, SeedanceErrorKind } from "./types.js";
import { SeedanceError } from "./types.js";

// Per-credit USD conversion mirrors the historical Higgsfield-routed cost
// (~$0.013/credit at 50 credits ≈ $0.65/clip). The fake reports the same so
// downstream cost-tracking code paths see realistic numbers.
const USD_PER_CREDIT = 0.013;
const DEFAULT_CREDITS_PER_CLIP = 50;

export type FakeSeedanceClientOpts = {
  /** Override the fixture MP4 URL returned by generateClip. */
  fixtureVideoUrl?: string;
  /** If set, generateClip throws a matching SeedanceError instead of succeeding. */
  simulate?: SeedanceErrorKind;
};

export class FakeSeedanceClient implements SeedanceClient {
  private readonly fixtureVideoUrl: string;
  private readonly simulate?: SeedanceErrorKind;

  constructor(opts: FakeSeedanceClientOpts = {}) {
    this.fixtureVideoUrl = opts.fixtureVideoUrl ?? "https://example.com/fake-clip.mp4";
    this.simulate = opts.simulate;
  }

  async generateClip(params: ClipParams): Promise<ClipResult> {
    if (this.simulate) {
      throw new SeedanceError(this.simulate, `FakeSeedanceClient: simulated ${this.simulate}`);
    }
    return {
      job_id: `fake-${randomUUID()}`,
      video_url: this.fixtureVideoUrl,
      duration_s: params.duration_s,
      cost_credits: DEFAULT_CREDITS_PER_CLIP,
      cost_usd: DEFAULT_CREDITS_PER_CLIP * USD_PER_CREDIT,
      mode_used: params.mode,
    };
  }
}
