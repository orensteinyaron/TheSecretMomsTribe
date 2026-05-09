-- V2 §4.5: rename Avatar profile display name to "Avatar Full" + set proper
-- cost_estimate_usd + spec_doc_path; delete unused draft "Avatar Video" row.
--
-- Slug `avatar-v1` is preserved — skills/full-avatar-profile/SKILL.md is
-- anchored to that slug in its frontmatter description AND its "When NOT to
-- use" guard. Renaming the slug would require editing the skill md and any
-- caller. Display name change is a 1-row UPDATE; that's the right contract:
-- slug = internal contract, name = user-facing label.
--
-- Cost $2.10 per skills/full-avatar-profile/SKILL.md cost budget
-- (Seedance ~$1.50 + ElevenLabs ~$0.05 + Whisper ~$0.01 + Sonnet QA ~$0.55
-- + hook card $0 + stitch $0). Variable cost only — subscription cost
-- ($24–29/mo HeyGen Creator + $5/mo ElevenLabs Starter) belongs in a
-- separate fixed-cost ledger.
--
-- The unused 'avatar' (status=draft, "Avatar Video") row had 0 FK refs and
-- was leftover from earlier scoping. Deleted to remove confusion.
--
-- Spec: docs/specs/PIECE_PAGE_DATA_FLOW_AUDIT_V2.md §4.5

UPDATE render_profiles
SET name = 'Avatar Full',
    cost_estimate_usd = 2.10,
    spec_doc_path = 'profiles/avatar/PROFILE.md'
WHERE slug = 'avatar-v1';

DELETE FROM render_profiles WHERE slug = 'avatar';
