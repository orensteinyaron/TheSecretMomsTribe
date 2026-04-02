# SMT Access & Credentials

## Current Status

| Resource | Status | Priority | Notes |
|---|---|---|---|
| Apify API | Configured | High | MCP + scripts, token in settings.local.json |
| Anthropic API | Configured | High | Via Claude Code |
| Supabase | Configured | High | Project: fvxaykkmzsbrggjgdfjj |
| Instagram Graph API | NOT configured | High | Needed for Publishing Agent |
| TikTok Content API | NOT configured | High | Needed for Publishing Agent |
| Image Gen API | NOT configured | Medium | Flux or DALL-E for visual content |

---

## Supabase

- **Project ID:** fvxaykkmzsbrggjgdfjj
- **URL:** https://fvxaykkmzsbrggjgdfjj.supabase.co
- **Region:** ap-southeast-1
- **Org:** YO (vqnulumobvcnacxckbqd)

---

## What's Needed Next

### Instagram Graph API (Priority: HIGH)
- **Why:** Publishing Agent needs this to post content
- **How:** Facebook Developer Account → Create App → IG Graph API
- **Scopes needed:** `instagram_basic`, `instagram_content_publish`
- **Prerequisite:** Facebook Page linked to IG Business account

### TikTok Content Posting API (Priority: HIGH)
- **Why:** Publishing Agent needs this to post content
- **How:** TikTok Developer Portal → Create App → Content Posting API
- **Scopes needed:** `video.publish`, `video.upload`
- **Note:** Requires app review by TikTok

### Image Generation API (Priority: MEDIUM)
- **Why:** Visual content for AI magic outputs
- **Options:** OpenAI DALL-E, Flux, Replicate
- **Decision pending:** Which service offers best quality/cost

---

## GitHub Actions Secrets Required

These must be set in the GitHub repo settings:

| Secret Name | Source | Status |
|---|---|---|
| `SUPABASE_URL` | Supabase dashboard | Needs setting |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → API settings | Needs setting |
| `APIFY_TOKEN` | Apify console | Needs setting |
| `ANTHROPIC_API_KEY` | Anthropic console | Needs setting |

---

## Rule

**When blocked on missing credentials:** flag immediately
with exactly what's needed and why. Never silently skip.
