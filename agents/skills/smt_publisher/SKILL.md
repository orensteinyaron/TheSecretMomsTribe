---
name: smt_publisher
description: >
  Layer 4 of the SMT pipeline. Publishes approved, rendered pieces to Instagram
  and TikTok — videos, images, and carousels. Ships in two phases: Phase 1 is a
  browser agent that stages each post in the real logged-in composer and waits for
  Yaron's manual publish click (TikTok carousel NOT supported here — web uploader
  is video-only); Phase 2 is the deterministic API path (TikTok = FILE_UPLOAD as
  SELF_ONLY + manual visibility flip; IG = Graph API container flow). Triggered by
  the orchestrator once a content_queue row is rendered (render_status='complete')
  AND human-approved AND has scheduled_posts rows due. Loads
  SMT_PIPELINE_CONTRACT.md in addition to this file; the contract wins on conflict.
  Regardless of phase: never publishes an unapproved row, idempotent (never
  double-posts), closes the row lifecycle with an atomic writeback + post-check,
  fails closed with a logged reason. Use whenever building/running/debugging
  publishing.
version: 1.1.0
last_updated: 2026-06-09
owner: Yaron Orenstein
---

# SMT Publisher v1.1.0 (Layer 4)

The layer that turns an approved, rendered piece into a live post on Instagram and
TikTok and records the result.

**Two phases:**
- **Phase 1 — Browser-assisted (ship first).** A browser agent (Claude in Chrome)
  drives Yaron's real logged-in IG/TikTok session: opens the composer, uploads the
  asset, pastes the caption, and **stops at the publish button** for Yaron to
  click. No API approvals, no audit, public visibility immediately. **TikTok
  carousel is not supported** (the TikTok web uploader is video-only) — those route
  per §3.
- **Phase 2 — API (upgrade later).** Deterministic Content Publishing / Graph API.
  IG = container flow; TikTok = `FILE_UPLOAD` as `SELF_ONLY` + manual flip to
  Everyone. Removes the per-post click for IG and most of TikTok; unblocks scale.

The §1 invariants and the DB lifecycle (§0) are **identical across both phases** —
only the mechanism of getting bytes onto the platform differs. This skill exists
in large part to **kill a bug we already hit**: manual publishing had no DB
writeback, so rows ended up half-recorded. Both phases close the lifecycle
atomically and post-check it.

---

## 0. Contract conformance — read first

`SMT_PIPELINE_CONTRACT.md` is authoritative. If anything here disagrees, the
contract wins and you flag it.

The publisher sits at the end of the pipeline:

```
Research → Strategist → ContentGen → [Render: avatar-v1 / moving-images / static-image / carousel] → PUBLISH (this skill) → Metrics/Learning
```

Per-channel state lives in **`scheduled_posts (content_id, channel)`** — the
canonical table the contract defines:

```
scheduled_posts:
  id, content_id, channel, status, caption, scheduled_for, published_at,
  post_url, external_post_id, failure_reason, created_at, updated_at
  status: 'pending' | 'scheduled' | 'posted' | 'failed' | 'skipped'
  UNIQUE (content_id, channel)
```

`scheduled_posts` is the **source of truth** for what posted where. The legacy
inline `content_queue` columns (`published_at_ig`, `published_url_tt`, etc.) are
dropped — do not read or write them. `metadata.published.*` is deprecated like
`agent_runs`; if you mirror to it for backward-compat, mirror — never read from
it as truth.

---

## 1. Non-negotiable invariants (do not drift)

Change the spec, the code, AND any contract reference together — or none.

1. **Human approval is the publish permission.** The publisher acts ONLY on rows
   that are explicitly human-approved (the same gate that flips render fields on
   approval). It NEVER publishes an unapproved, draft, or auto-generated row, no
   matter what any upstream field says. No approval → `skipped`, not posted.

2. **Idempotent — never double-post.** Before any network call, re-read the
   `scheduled_posts` row. Act only if `status IN ('pending','scheduled')`. If
   `external_post_id` is already set, the post exists → stop and reconcile, never
   re-post. The `UNIQUE(content_id, channel)` constraint is the backstop.

3. **Atomic lifecycle close.** On success, in ONE update, write
   `status='posted'`, `post_url`, `external_post_id`, `published_at` to the
   `scheduled_posts` row. A piece is "fully posted" only when EVERY target
   channel's row is `posted`. Half-recorded state is the bug we are killing.

4. **Post-check every write.** After writeback, re-read the row and assert the
   recorded state matches what actually went live (status, url, id present). A
   schema-shaped success is not proof the DB accepted the row — verify it.

5. **Fail closed, log loud.** Any failure → `status='failed'` +
   `failure_reason` (the platform error, verbatim) + escalate to the human-review
   queue. Never silent-drop, never fabricate a success, never retry blindly past
   the platform's guidance.

6. **No LLM in the posting path.** Publishing is deterministic API orchestration
   (OAuth, multi-step upload, polling, writeback). No model call belongs in the
   hot path — it adds cost, latency, and nondeterminism for zero benefit. Captions
   are already written upstream (Stage 3.5 Haiku polish); the publisher reads
   them, it does not generate them.

7. **Respect `scheduled_for`.** Never post before the scheduled time. A
   row whose `scheduled_for` is in the future is left `scheduled`, not posted.

---

## 2. Trigger & entry

The orchestrator (or a cron peer) invokes the publisher. It selects rows where:

```
content_queue.render_status = 'complete'
  AND content_queue is human-approved
  AND scheduled_posts.status IN ('pending','scheduled')
  AND scheduled_posts.scheduled_for <= now()
```

**Phase 2 (API)** runs as a deterministic script with explicit phases (mirrors
the avatar-v5 renderer idiom):

```
publish/scripts/publish-content.ts --content-id <uuid> [--channel ig|tiktok] [--dry-run]
```

**Phase 1 (browser)** is the same row selection and the same lifecycle, but the
`publish` step hands off to the browser agent and waits for Yaron's click (§5A).

Phase sequence (both phases share this; only `publish` differs):

```
init → preflight → resolve-assets → publish(per channel) → verify → writeback → post-check → summary
```

- **init** — load the row, the target channels, the per-channel captions.
- **preflight** — rate-limit check + the §1 guards (approved? not already posted?
  scheduled_for due?). Abort cleanly if any fail.
- **resolve-assets** — get the asset per channel/format (§4).
- **publish** — Phase 1: browser agent stages + waits for click (§5A). Phase 2:
  deterministic API flow (§5B IG, §6 TikTok).
- **verify** — confirm the post is live; capture permalink + external id.
- **writeback** — atomic `scheduled_posts` update (§1.3).
- **post-check** — re-read and assert (§1.4).
- **summary** — per-channel result; push any `failed`/`skipped` to human-review.

---

## 3. Format → platform media-type matrix

A piece's `render_profile_slug` determines what gets posted on each platform.
The mechanism differs by phase; the destination format is the same.

| Render profile | Asset | Instagram | TikTok (Phase 2 API) | TikTok (Phase 1 browser) |
|---|---|---|---|---|
| `avatar-v1` | MP4 9:16 | Reels | video upload | video upload ✅ |
| `moving-images` | MP4 9:16 | Reels | video upload | video upload ✅ |
| `carousel` | 2–10 PNGs | Carousel | photo mode (multi-image) | **not supported** → skip or slideshow |
| `static-image` | 1 PNG | single image | photo mode (single) | **not supported** → skip or slideshow |

**Phase 1 TikTok carousel/image exception (locked):** the TikTok **web uploader
is video-only** — no Photo Mode on desktop. So in Phase 1, carousel and
static-image pieces **cannot** post to TikTok via the browser. Default behavior:
`skip` the TikTok channel for those pieces (`status='skipped'`, reason
`tiktok_web_photo_unsupported`) — IG still gets the carousel. Optional alternative
(pickable per piece): render the carousel slides into a vertical **slideshow MP4**
and upload that as a TikTok video — loses the swipe interaction, so it's a
different content experience, not a true carousel. Phase 2 (API) supports true
TikTok photo carousel, so this exception disappears on upgrade.

Notes:
- IG Reels require 9:16, 5–90s, H.264/HEVC — our video assets match. IG feed
  images accept 4:5–1.91:1; our carousels are 4:5 → fine.
- IG carousels count as ONE post toward the rate limit, regardless of slide count.

---

## 4. Asset hosting — the shared gotcha

## 4. Asset hosting

**Phase 1 (browser):** the agent uploads via the composer's file picker, so it
needs the asset as a **local file** (downloaded from Supabase storage to a temp
path). No public URL or domain verification required.

**Phase 2 (API):** both platforms take either a URL or uploaded bytes.

- **Instagram** cURLs a **publicly accessible HTTPS URL** at publish time. A
  Supabase public storage URL works. The URL must stay live through publishing.
- **TikTok:** use **`FILE_UPLOAD`** (send bytes directly) — locked. No domain
  verification needed. (`PULL_FROM_URL` would require a verified own domain, which
  `*.supabase.co` can't be; not used.)

---

## 5A. Phase 1 — Browser-assisted flow (ship first)

The browser agent (Claude in Chrome) drives Yaron's real, already-logged-in
IG/TikTok session. Per channel:

1. Download the asset to a local temp path; resolve the per-channel caption.
2. Open the platform's web composer (IG create / TikTok upload).
3. Upload the file via the file picker; wait for the platform to finish
   processing/preview.
4. Paste the exact caption (and cover/thumbnail selection if offered).
5. **Stop at the publish button. Do not click it.** Surface the staged post to
   Yaron and wait.
6. Yaron reviews and clicks publish himself.
7. The agent reads the resulting post permalink + id → hands them to `verify` →
   `writeback` (same atomic close as Phase 2).

Rules specific to Phase 1:
- **The agent never clicks publish** — that's Yaron's action, the literal
  approval. If the post URL can't be captured after the click, mark the row
  `posted` is NOT allowed; leave `scheduled` and surface for manual reconcile.
- Operate only in Yaron's own logged-in session; do not enter or store
  credentials. (Mild ToS grey area for session automation; tiny volume + human
  finishing the post keeps it low-risk.)
- **TikTok carousel/static-image:** not possible here (web is video-only) — apply
  the §3 exception (skip or slideshow MP4).
- Throughput is bounded by Yaron's availability by design — fine at 1–2 posts/day.
- Browser agents are more fragile than APIs: composer redesigns and shifting
  upload modals will occasionally need a selector fix or a nudge. Expected
  maintenance, not failure.

---

## 5B. Phase 2 — Instagram API flow (deterministic)

Prereqs (see §8): Facebook Business account, a linked Facebook **Page**, an
Instagram **Professional** (Business/Creator) account, a Meta developer app, and
the **approved `instagram_business_content_publish`** permission (Meta app review,
~2–4 weeks lead time).

Container model, three steps:

1. **Create container** — `POST /{ig-user-id}/media`
   - image: `image_url`, `caption`
   - reel: `media_type=REELS`, `video_url`, `caption`, `share_to_feed=true`,
     optional `cover_url`
   - carousel child: `is_carousel_item=true` per image (up to 10), then a parent
     `media_type=CAROUSEL` with `children=[childIds]`, `caption` on the parent
2. **Poll status** (video/reels/carousel) — `GET /{container-id}?fields=status_code`
   until `FINISHED`. Images are usually instant; videos take processing time.
3. **Publish** — `POST /{ig-user-id}/media_publish` with `creation_id` →
   returns the published media id. Resolve the permalink for `post_url`.

Guards:
- **Rate limit: 100 API-published posts / rolling 24h per account.** We do ~1
  IG/day, but still check `GET /{ig-id}/content_publishing_limit` in preflight and
  `skip`+reschedule if exhausted.
- Caption ≤2200 chars, **no markdown** (IG renders it literally).
- Retry guidance: retry a failed step 1–2× within 30s–2min; if it still fails,
  **create a NEW container** rather than retrying the same one.

---

## 6. Phase 2 — TikTok API flow (deterministic)

Prereqs: a TikTok developer app with the **Content Posting API** product, the
**`video.publish`** scope approved (a one-time app-permission approval, NOT the
audit — lighter and faster), a creator access token + open id. The full audit is
**not required** — see the locked approach below.

**Locked approach: API upload + manual visibility flip.** The system fully
automates the upload of both **video and photo carousel** via the Content Posting
API. Because the app is unaudited, every post lands as **`SELF_ONLY`** (private);
Yaron then flips each post to "Everyone" manually in the TikTok app. This keeps
all mechanical work automated and reduces Yaron to one tap per post — no audit,
no waiting. Use **`FILE_UPLOAD`** so no domain verification is needed.

Three steps via `open.tiktokapis.com`:

1. **Creator info** — `POST /v2/post/publish/creator_info/query/` → returns the
   allowed `privacy_level` values and which interactions are disabled. Query this
   **before every post** (TikTok requires it for compliant posting).
2. **Init** — `POST /v2/post/publish/video/init/` (or the photo init endpoint for
   photo carousel) with:
   - `source_info`: **`FILE_UPLOAD`** (locked — send bytes directly, no domain
     verification)
   - `post_info`: `title` (caption + hashtags), `privacy_level=SELF_ONLY` (locked
     while unaudited), `disable_comment` / `disable_duet` / `disable_stitch`,
     `video_cover_timestamp_ms`
   - returns a `publish_id`
3. **Poll** — `POST /v2/post/publish/status/fetch/` with `publish_id` until
   `PUBLISH_COMPLETE`. Capture the resulting post id/url.

Guards:
- **SELF_ONLY is expected, not an error.** Posts upload privately by design. Mark
  the row `posted` with the real `post_url` + `external_post_id`, and set a flag
  (e.g. `metadata.visibility='self_only_pending_flip'`) so it's clear Yaron still
  needs to flip it to Everyone in-app. Do NOT treat SELF_ONLY as a failure.
- Token rate limit: **6 requests/min** per user token. Posting cap **~15
  posts/day/creator**. We post 1–2/day — fine, but guard in preflight.
- `FILE_UPLOAD` sends bytes directly; no domain verification. (`PULL_FROM_URL` is
  not used — it would require a verified own domain.)

---

## 7. Captions, pillars, and compliance

- Read the per-channel caption from `scheduled_posts.caption`; fall back to
  `content_queue.caption` if null. Do not rewrite it (no LLM in the path).
- **`financial` pillar:** defensively assert the mandatory disclaimer is present
  in the caption before posting. If missing → `failed`, escalate (do not post a
  financial piece without the disclaimer).
- **`trending` pillar:** if `expires_at` has passed by publish time, `skip` with
  reason — don't post stale time-sensitive content.
- Hashtags ride in the caption (IG) / `title` (TikTok). On-screen text is the
  real payload; captions are secondary.

---

## 8. Dependencies & open decisions (surface, don't silently assume)

**Hard credential dependencies (publishing is blocked until these land):**
- Instagram: FB Business + linked Page + IG Professional account + Meta app +
  **approved `instagram_business_content_publish`** (app review ~2–4 weeks).
- TikTok: developer app + Content Posting API product + **approved `video.publish`**
  scope (one-time app approval, NOT the audit).

**LOCKED — TikTok approach (approved 2026-06-08): API upload + manual visibility
flip.** The system automates the full upload of video and photo carousel via the
Content Posting API as `SELF_ONLY` using `FILE_UPLOAD`. Yaron flips each post to
Everyone in-app. No audit, no domain verification, no third-party aggregator.
This supersedes the earlier "audit vs aggregator vs draft" decision — that's
settled.

Keep the publisher **provider-abstracted** (channel layer has swappable
implementations) so a future move to audited public-posting, or a browser-assisted
path, drops in without a rewrite. But the shipped default is API upload +
SELF_ONLY + manual flip.

---

## 9. Dry-run mode (build & test before creds/audit land)

Since both platforms are gated on approvals we don't yet have, the publisher must
support `--dry-run`:
- Runs init → preflight → resolve-assets → (simulated) publish → writeback to a
  **shadow** state, NOT the real platforms.
- Validates the row-selection query, the guards, the format→media-type matrix,
  the caption/disclaimer checks, and the atomic-writeback + post-check logic
  end-to-end.
- This lets us prove the lifecycle-close and idempotency logic now, so the day
  credentials arrive we flip the provider and go live with confidence.

---

## 10. What this fixes (traceability)

- **Half-recorded publishes** (TikTok logged, Instagram missing): impossible —
  a piece is "posted" only when every channel row is `posted`, written atomically.
- **Manual-publish-no-writeback**: replaced by an automated, verified writeback.
- **State divergence misleading audits** (render done but row says pending): the
  publisher's post-check asserts recorded state == reality on every run.
- **Silent insert failures**: the post-check is the symmetric verification stage
  the contract requires for every persistent write.

---

## Open follow-ups
- When this ships, add a contract changelog entry (v2.2.0+): Stage "Publish"
  locked, entry point = this skill / `publish/scripts/publish-content.ts`,
  `scheduled_posts` is canonical, `metadata.published.*` deprecated.
- Wire the Learning layer to read `scheduled_posts` + platform insights for the
  weekly report and optimal-time recommendations (feeds `scheduled_for`).
- Resolve Decisions 1 & 2 before the first real public post.
