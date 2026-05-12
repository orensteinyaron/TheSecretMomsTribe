# SMT Claude Code Routines

The two routines below replace the GitHub Actions cron that previously
fired `agents/orchestrator.js` every 15 minutes. They run the orchestrator
inside Claude Code's managed environment, which means:

- The Routine's runtime knows when its own pipeline is still going, so
  the "in_progress loop" bug we hit under the cron is impossible.
- The orchestrator runs as a long-lived process per invocation, so
  pre-flight + run + post-flight share state cleanly.
- Hot signal triggers from Supabase get a clean API surface (no extra
  GitHub Actions plumbing).

**Operator-gated.** Yaron creates these routines after the PR is merged.
Do not create them from a sub-agent or scripted session.

## Routine 1: `smt-daily-pipeline`

| Field | Value |
| --- | --- |
| Trigger | Scheduled, daily at 03:00 UTC |
| Repo | `orensteinyaron/TheSecretMomsTribe`, branch: `main` |
| Prompt | Run the daily SMT content pipeline. Execute `node agents/orchestrator.js --mode=daily`. At completion, report the `pipeline_run_id`, final status, stage durations, and any escalations. |
| Required env vars | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PEXELS_API_KEY`, `APIFY_API_TOKEN` |
| Network allowlist | Supabase, `api.anthropic.com`, `api.openai.com`, `api.pexels.com`, `api.apify.com`, `npmjs.org`, `github.com` |

### CLI command (template)

```bash
claude routine create \
  --name smt-daily-pipeline \
  --repo orensteinyaron/TheSecretMomsTribe \
  --branch main \
  --schedule "0 3 * * *" \
  --env SUPABASE_URL=... \
  --env SUPABASE_SERVICE_ROLE_KEY=... \
  --env ANTHROPIC_API_KEY=... \
  --env OPENAI_API_KEY=... \
  --env PEXELS_API_KEY=... \
  --env APIFY_API_TOKEN=... \
  --allow supabase.co \
  --allow api.anthropic.com \
  --allow api.openai.com \
  --allow api.pexels.com \
  --allow api.apify.com \
  --allow npmjs.org \
  --allow github.com \
  --prompt "Run the daily SMT content pipeline. Execute \`node agents/orchestrator.js --mode=daily\`. At completion, report the pipeline_run_id, final status, stage durations, and any escalations."
```

## Routine 2: `smt-hot-signal-pipeline`

| Field | Value |
| --- | --- |
| Trigger | API only (no schedule) |
| Repo | `orensteinyaron/TheSecretMomsTribe`, branch: `main` |
| Prompt | Run the SMT pipeline in hot signal mode for the provided `signal_id`. Execute `node agents/orchestrator.js --mode=hot_signal --signal_id=<from request body>`. Report the resulting `content_queue` row id. |
| Required env vars | Same as Routine 1 |
| Network allowlist | Same as Routine 1 |

### CLI command (template)

```bash
claude routine create \
  --name smt-hot-signal-pipeline \
  --repo orensteinyaron/TheSecretMomsTribe \
  --branch main \
  --trigger api \
  --env SUPABASE_URL=... \
  --env SUPABASE_SERVICE_ROLE_KEY=... \
  --env ANTHROPIC_API_KEY=... \
  --env OPENAI_API_KEY=... \
  --env PEXELS_API_KEY=... \
  --env APIFY_API_TOKEN=... \
  --allow supabase.co \
  --allow api.anthropic.com \
  --allow api.openai.com \
  --allow api.pexels.com \
  --allow api.apify.com \
  --allow npmjs.org \
  --allow github.com \
  --prompt "Run the SMT pipeline in hot signal mode for the provided signal_id. Execute \`node agents/orchestrator.js --mode=hot_signal --signal_id=\$signal_id\`. Report the resulting content_queue row id."
```

After creation, store the per-routine API endpoint and bearer token in
Supabase project secrets:

```bash
supabase secrets set HOT_SIGNAL_ROUTINE_ENDPOINT="https://routines.claude.com/v1/run/<routine-id>"
supabase secrets set HOT_SIGNAL_ROUTINE_TOKEN="<bearer-token>"
supabase secrets set HOT_SIGNAL_TRIGGER_SECRET="<random-secret-the-trigger-validates>"
```

The Edge Function at `supabase/functions/trigger-hot-signal/index.ts`
reads these secrets to invoke Routine 2.
