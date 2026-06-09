/**
 * Types for the create-from-url ingestion path (Phase 1).
 *
 * This is the "validated remixing" flow: a human-supplied URL is captured and
 * analyzed (structure only), recreated as an original SMT piece (the LLM step,
 * done live by the skill), approved twice by Yaron, rendered by an existing
 * renderer, and then ENQUEUED onto the same rails as agent content
 * (content_queue + scheduled_posts) via the Phase 0 lifecycle layer.
 *
 * The deterministic surfaces implemented here are CAPTURE and ENQUEUE. ANALYZE
 * and RECREATE are creative steps the skill performs in-session (no code), and
 * the approvals are human gates. Source of truth: skills/create-from-url/SKILL.md.
 */

import type { Channel, RenderProfileSlug } from '../lifecycle/types.js';

export type SourcePlatform = 'instagram' | 'tiktok' | 'web';

/** The format of the SOURCE piece (independent of our render profile). */
export type SourceFormat = 'carousel' | 'video' | 'image';

/** One captured carousel slide. */
export interface CaptureSlide {
  index: number;
  on_screen_text: string;
  image_description: string;
}

/**
 * Structured capture of the source (skill §1). Best-effort: fields absent in the
 * source are left null/empty rather than invented (no fabrication of source
 * facts). `complete=false` signals the skill to fall back to screenshots-in-chat.
 */
export interface CaptureObject {
  source_url: string;
  platform: SourcePlatform;
  creator_handle: string | null;
  engagement: { views?: number; likes?: number; comments?: number; saves?: number; shares?: number };
  format: SourceFormat;
  /** carousel only */
  slides: CaptureSlide[];
  /** video only */
  transcript_or_script: string | null;
  on_screen_text: string | null;
  hook: string | null;
  caption: string | null;
  hashtags: string[];
  /** true ⇒ enough was captured to brief a recreation. */
  complete: boolean;
}

/** Injected network deps so capture() is unit-testable without live calls. */
export interface CaptureDeps {
  /** Fetch an open web page (web_fetch equivalent). */
  fetchWeb(url: string): Promise<{ text: string; title?: string }>;
  /** Run an Apify actor and return its dataset items. */
  runApifyActor(actorId: string, input: Record<string, unknown>): Promise<unknown[]>;
}

/** The canonical SKILL-side pillar names (translated to DB pillars at enqueue). */
export type CanonicalPillar =
  | 'ai_magic'
  | 'parenting_insights'
  | 'health'
  | 'tech_for_moms'
  | 'trending'
  | 'financial';

/** Verbatim AI Magic artifacts — REQUIRED when pillar is `ai_magic` (contract gate). */
export interface AiMagicArtifacts {
  original_prompt: string;
  original_output: string;
  ai_tool_name: string;
  /** The public source URL where the artifact is visible. */
  source_url: string;
}

/**
 * The approved-concept → enqueue plan. Built from approval #2 (the human gate
 * that authorizes publishing). `approved` defaults to false (fail-closed); the
 * CLI requires an explicit flag to set it true.
 */
export interface RemixEnqueuePlan {
  renderProfileSlug: RenderProfileSlug;
  /** Canonical SKILL pillar; translated to the DB pillar at the boundary. */
  pillar: CanonicalPillar;
  hook: string;
  /** Base/storytelling caption (content_queue.caption fallback). */
  baseCaption: string;
  finalAssetUrl: string;
  renderCompletedAt?: string | null;
  /** Platform-native captions written to scheduled_posts.caption. */
  channelCaptions: Partial<Record<Channel, string>>;
  /** Target channels. Default: both tiktok + instagram. */
  channels?: Channel[];
  /** Per-channel schedule; a bare string/null applies to all. */
  scheduledFor?: Partial<Record<Channel, string | null>> | string | null;
  /** Internal provenance only — never surfaced as public credit. */
  provenance: { sourceUrl: string; creatorHandle?: string | null };
  /**
   * TikTok cannot take carousel/static-image via the Phase 1 browser uploader.
   * 'skip' (default) → enqueue tiktok then mark it skipped; 'slideshow' → the
   * caller must have rendered a moving-images MP4 (tiktok stays pending).
   */
  tiktokCarouselStrategy?: 'skip' | 'slideshow';
  /** REQUIRED when pillar === 'ai_magic'. */
  aiMagic?: AiMagicArtifacts;
  /** Whether approval #2 has been given. */
  approved: boolean;
  /** Extra metadata merged into content_queue.metadata. */
  extraMetadata?: Record<string, unknown>;
}
