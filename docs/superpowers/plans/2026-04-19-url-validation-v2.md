# URL Validation V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace yesterday's runtime URL validator with trust-on-scrape provenance model so Reddit/TikTok apify-sourced URLs stop being dropped by GitHub-Actions-runner IP/geo blocks.

**Architecture:** Every signal carries a `signal_source` tag (`apify_reddit`, `apify_tiktok`, `apify_trends`, `llm_inferred`, `user_submitted`). `validateBriefingUrls` skips validation when `signal_source` starts with `apify_` — the scrape itself is the liveness proof. `validateSocialUrl` becomes strictly less aggressive: drops only on unambiguous server signals (404/410/451); treats 403, timeout, and TikTok body markers as valid-with-caveat. Adds `SKIP_URL_VALIDATION` env kill switch.

**Tech Stack:** Node 20 ESM, `node:test`, Supabase JS, Anthropic SDK, Apify client.

**Spec:** `URL_VALIDATION_V2_SPEC.md` (external, attached to task).

---

### Task 1: validateBriefingUrls — trust + skipAll + trusted counter (TDD)

**Files:**
- Modify: `agents/lib/briefing-urls.js`
- Test: `agents/lib/__tests__/briefing-urls.test.js`

- [ ] Add 5 spec tests (apify_reddit skip, apify_tiktok skip even when URL fails, llm_inferred validates, missing→validate, skipAll bypass+log).
- [ ] Run tests — verify fail.
- [ ] Implement: add `skipAll` option + `trusted` counter + early-return for `signal_source.startsWith('apify_')`.
- [ ] Run tests — verify pass. Existing tests stay green.
- [ ] Commit.

### Task 2: validateSocialUrl — less aggressive rules (TDD)

**Files:**
- Modify: `agents/lib/url-validator.js`
- Test: `agents/lib/__tests__/url-validator.test.js`

- [ ] Update existing tests: TikTok "Video isn't available" body → valid; Reddit [removed] → still invalid; 403 → valid+caveat; 404 → invalid; timeout → valid+caveat('fetch_failed'). Keep Instagram private + Reddit [removed] markers.
- [ ] Run — verify fail.
- [ ] Remove TikTok markers from `SOCIAL_DEAD_MARKERS`. Change 403 path to return `{valid:true, caveat:'http_403_likely_ip_block'}`. Change timeout/network-error path to `{valid:true, caveat:'fetch_failed'}`. Keep 404/410/451 as invalid.
- [ ] Run — verify pass.
- [ ] Commit.

### Task 3: signal_source tagging in scrapers + LLM

**Files:**
- Modify: `agents/research.js` (scanReddit, scanTikTokTrends, scanGoogleTrends, scanRedditFallback, SYSTEM_PROMPT, validateOpportunities)

- [ ] Add `signal_source: 'apify_reddit'` to reddit + reddit_fallback mapped signals; `apify_tiktok` to tiktok; `apify_trends` to google_trends.
- [ ] Update SYSTEM_PROMPT to instruct the LLM to preserve `signal_source` per opportunity (or use `llm_inferred` when URL synthesized).
- [ ] Add `signal_source` schema entry to the prompt's output-format block.
- [ ] In `validateOpportunities`: default missing → `llm_inferred`, log debug `signal_source_missing` per occurrence.
- [ ] Commit.

### Task 4: SKIP_URL_VALIDATION env flag + pass through

**Files:**
- Modify: `agents/research.js` (main())

- [ ] Read `SKIP_URL_VALIDATION` at top of main(), parse as `['true','1','yes'].includes(lower)`.
- [ ] If set, console.warn and pass `{ skipAll: true }` to `validateBriefingUrls`.
- [ ] Commit.

### Task 5: Verify full suite green + push PR

- [ ] Run `npm test` — expect all tests passing.
- [ ] Push branch `fix/url-validation-v2`.
- [ ] Open PR against `main` with summary + test plan referencing spec.

### Task 6: Pre-merge safety — GH secret check + merge

- [ ] Confirm `SKIP_URL_VALIDATION=true` set in GH Actions repo secrets (via `gh secret list`).
- [ ] Merge PR.
- [ ] Trigger `daily-research.yml` via `workflow_dispatch`.
- [ ] Capture: activity_log `url_validation_skipped` event, first `daily_briefings` row for 2026-04-19.
