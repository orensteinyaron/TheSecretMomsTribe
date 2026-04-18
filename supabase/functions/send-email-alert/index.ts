import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function htmlEscape(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

function renderHtml(n: { title: string; description: string; metadata: Record<string, unknown>; created_at: string; category?: string; severity?: string }) {
  const meta = Object.entries(n.metadata || {})
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#888;">${htmlEscape(k)}</td><td style="padding:4px 0;">${htmlEscape(typeof v === "string" ? v : JSON.stringify(v))}</td></tr>`)
    .join("");
  return `<!doctype html>
<html><body style="font-family:-apple-system,system-ui,Segoe UI,Helvetica,Arial,sans-serif;background:#0e0e12;color:#e9e6ef;padding:24px;margin:0;">
  <div style="max-width:560px;margin:auto;background:#171720;border:1px solid #2a2a36;border-radius:12px;padding:24px;">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#b74780;margin-bottom:8px;">SMT Pipeline Alert · ${htmlEscape(n.severity || "critical")}</div>
    <h1 style="font-size:20px;margin:0 0 8px;color:#fff;">${htmlEscape(n.title)}</h1>
    <p style="margin:0 0 16px;color:#c9c6d0;line-height:1.5;">${htmlEscape(n.description)}</p>
    <table style="font-size:13px;color:#c9c6d0;margin:0 0 20px;">${meta}</table>
    <div style="font-size:12px;color:#6a6776;">Fired at ${htmlEscape(n.created_at)}</div>
  </div>
  <div style="max-width:560px;margin:16px auto 0;text-align:center;font-size:11px;color:#6a6776;">The Secret Moms Tribe · automated ops alert</div>
</body></html>`;
}

function renderText(n: { title: string; description: string; metadata: Record<string, unknown>; created_at: string }) {
  const meta = Object.entries(n.metadata || {}).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
  return `SMT Pipeline Alert — ${n.created_at}\n\n${n.title}\n${n.description}\n\n${meta}\n`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const notificationId = body.notification_id;
    if (!notificationId) return json({ error: "notification_id required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: n, error } = await sb.from("notifications").select("*").eq("id", notificationId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!n) return json({ error: "notification not found" }, 404);

    if (n.delivered_channels?.email?.sent_at) {
      return json({ skipped: "already_sent", resend_id: n.delivered_channels.email.response?.id ?? null });
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const to     = Deno.env.get("ALERT_EMAIL_TO");
    const from   = Deno.env.get("ALERT_EMAIL_FROM");
    if (!apiKey || !to || !from) {
      return json({
        error: "missing_secrets",
        detail: "Set RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM in edge function secrets.",
      }, 503);
    }

    const subject = `🚨 SMT Pipeline: ${n.title}`;
    const html    = renderHtml(n as any);
    const text    = renderText(n as any);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });

    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) return json({ error: "resend_failed", status: resp.status, payload }, 502);

    await sb.from("notifications").update({
      delivered_channels: { email: { sent_at: new Date().toISOString(), response: payload } },
    }).eq("id", notificationId);

    return json({ ok: true, resend_id: payload?.id ?? null });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
