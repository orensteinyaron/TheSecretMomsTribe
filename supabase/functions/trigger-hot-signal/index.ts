// Hot signal trigger.
//
// Body: { signal_id: string, secret: string }
//
// Validates:
//   1. body.secret matches HOT_SIGNAL_TRIGGER_SECRET (env)
//   2. signal_id exists in `signals` AND signal_strength >= 9 AND
//      captured_at within 24h
//
// On success: POSTs to HOT_SIGNAL_ROUTINE_ENDPOINT with bearer
// HOT_SIGNAL_ROUTINE_TOKEN, payload `{ signal_id }`. Logs a warn-level
// row to `escalations` so the operator can audit every hot-signal pass.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: { signal_id?: string; secret?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { signal_id, secret } = payload;
  if (!signal_id || !secret) {
    return json({ error: "missing_fields", required: ["signal_id", "secret"] }, 400);
  }

  const expected = Deno.env.get("HOT_SIGNAL_TRIGGER_SECRET");
  if (!expected || secret !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: signal, error: signalError } = await supabase
    .from("signals")
    .select("id, signal_strength, captured_at")
    .eq("id", signal_id)
    .maybeSingle();
  if (signalError) {
    return json({ error: "lookup_failed", details: signalError.message }, 500);
  }
  if (!signal) {
    return json({ error: "signal_not_found", signal_id }, 404);
  }
  if ((signal.signal_strength ?? 0) < 9) {
    return json({ error: "signal_too_weak", signal_strength: signal.signal_strength, required: 9 }, 422);
  }
  const capturedAtMs = signal.captured_at ? new Date(signal.captured_at).getTime() : 0;
  if (Date.now() - capturedAtMs > TWENTY_FOUR_HOURS_MS) {
    return json({ error: "signal_stale", captured_at: signal.captured_at }, 422);
  }

  const routineEndpoint = Deno.env.get("HOT_SIGNAL_ROUTINE_ENDPOINT");
  const routineToken = Deno.env.get("HOT_SIGNAL_ROUTINE_TOKEN");
  if (!routineEndpoint || !routineToken) {
    return json({ error: "routine_not_configured" }, 500);
  }

  const routineResp = await fetch(routineEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${routineToken}`,
    },
    body: JSON.stringify({ signal_id }),
  });
  const routineText = await routineResp.text();
  const routineOk = routineResp.ok;

  await supabase.from("escalations").insert({
    severity: "warn",
    reason: "hot_signal_triggered",
    details: {
      signal_id,
      signal_strength: signal.signal_strength,
      routine_status: routineResp.status,
      routine_response_preview: routineText.slice(0, 500),
    },
    recommended_action: "Watch pipeline_runs for the resulting hot_signal pass and review its content_queue row.",
  });

  if (!routineOk) {
    return json({ error: "routine_invocation_failed", status: routineResp.status, body: routineText.slice(0, 500) }, 502);
  }
  return json({ ok: true, signal_id, routine_status: routineResp.status }, 200);
});
