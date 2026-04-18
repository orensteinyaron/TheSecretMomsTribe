import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Which daily agents participate in the pipeline SLA metric.
// Mirrors pipeline-monitor.config.sla_definitions.
const DAILY_SLA_AGENTS = [
  { slug: "data-fetcher",     deadlineUtc: "04:00" },
  { slug: "research-agent",   deadlineUtc: "04:15" },
  { slug: "content-text-gen", deadlineUtc: "04:45" },
  { slug: "strategist-daily", deadlineUtc: "05:00" },
];

function utcTodayStart(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0, 0, 0));
}

function utcDeadline(hhmm: string): Date {
  const n = new Date();
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), h, m, 0, 0));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const url = new URL(req.url);
    const resource = url.searchParams.get("resource");

    if (req.method === "GET") {
      if (resource === "services") {
        const { data, error } = await sb.from("services").select("*").order("name");
        if (error) throw error;
        return json(data);
      }

      if (resource === "render_profiles") {
        const { data, error } = await sb.from("render_profiles").select("*").order("name");
        if (error) throw error;
        return json(data);
      }

      if (resource === "system_health") {
        // Existing fields preserved for backwards compatibility.
        // New fields: pipeline.{on_time, late, missed, total} reflecting true
        // operational state — based on today's agent_runs vs. SLA deadlines.
        const todayStart = utcTodayStart();
        const today = todayStart.toISOString().slice(0, 10);

        const [{ data: agents }, { data: services }, { data: costs }, pendingTasks, pendingContent, failedRenders, slaAgents, todayRuns] = await Promise.all([
          sb.from("agents").select("status, slug, last_run_at, last_run_status"),
          sb.from("services").select("status"),
          sb.from("cost_log").select("cost_usd").gte("created_at", today),
          sb.from("strategy_tasks").select("id", { count: "exact", head: true }).eq("status", "pending"),
          sb.from("content_queue").select("id", { count: "exact", head: true }).in("status", ["draft", "pending_approval"]),
          sb.from("content_queue").select("id", { count: "exact", head: true }).in("render_status", ["failed", "qa_failed"]),
          sb.from("agents").select("id, slug").in("slug", DAILY_SLA_AGENTS.map((a) => a.slug)),
          sb.from("agent_runs").select("agent_id, status, started_at").gte("started_at", todayStart.toISOString()),
        ]);

        const agentList   = agents || [];
        const serviceList = services || [];
        const todayCost   = (costs || []).reduce((s: number, c: any) => s + parseFloat(c.cost_usd || 0), 0);

        // Compute pipeline SLA health
        const agentIdBySlug: Record<string, string> = {};
        for (const a of (slaAgents.data || [])) agentIdBySlug[a.slug] = a.id;
        const nowUtc = new Date();

        const pipelineDetail = DAILY_SLA_AGENTS.map((sla) => {
          const agentId = agentIdBySlug[sla.slug];
          const deadline = utcDeadline(sla.deadlineUtc);
          const runs = (todayRuns.data || []).filter((r: any) => r.agent_id === agentId);
          const completed = runs.find((r: any) => r.status === "completed");
          let status: "on_time" | "late" | "pending" | "missed" = "pending";
          if (completed) {
            status = new Date(completed.started_at) <= deadline ? "on_time" : "late";
          } else if (nowUtc > deadline) {
            status = "missed";
          }
          return { slug: sla.slug, deadline_utc: sla.deadlineUtc, status, completed_at: completed?.started_at ?? null };
        });
        const on_time = pipelineDetail.filter((d) => d.status === "on_time").length;
        const late    = pipelineDetail.filter((d) => d.status === "late").length;
        const missed  = pipelineDetail.filter((d) => d.status === "missed").length;
        const pending = pipelineDetail.filter((d) => d.status === "pending").length;

        return json({
          agents: {
            total:    agentList.length,
            healthy:  agentList.filter((a: any) => a.status === "idle").length,
            failed:   agentList.filter((a: any) => a.status === "failed").length,
            disabled: agentList.filter((a: any) => a.status === "disabled").length,
          },
          services: {
            total:  serviceList.length,
            active: serviceList.filter((s: any) => s.status === "active").length,
            down:   serviceList.filter((s: any) => ["disabled", "rate_limited"].includes(s.status)).length,
          },
          pipeline: {
            total:   DAILY_SLA_AGENTS.length,
            on_time,
            late,
            missed,
            pending,
            detail:  pipelineDetail,
          },
          today_cost:      todayCost,
          pending_tasks:   pendingTasks.count || 0,
          pending_content: pendingContent.count || 0,
          failed_renders:  failedRenders.count || 0,
        });
      }

      if (resource === "pipeline_health") {
        // Detailed pipeline strip data: per-agent row, orchestrator liveness,
        // recent pipeline alerts.
        const todayStart = utcTodayStart();
        const [dailyAgents, monitorAgent, orchAgent, todayRuns, todayAlerts] = await Promise.all([
          sb.from("agents").select("id, slug, name, schedule, last_run_at, last_run_status").in("slug", DAILY_SLA_AGENTS.map((a) => a.slug)),
          sb.from("agents").select("id, slug, name, schedule, last_run_at").eq("slug", "pipeline-monitor").maybeSingle(),
          sb.from("agents").select("id, slug, name").eq("slug", "system-orchestrator").maybeSingle(),
          sb.from("agent_runs").select("agent_id, status, started_at, completed_at").gte("started_at", todayStart.toISOString()),
          sb.from("notifications").select("id, title, description, severity, subject_id, created_at").eq("category", "pipeline_health").gte("created_at", todayStart.toISOString()).order("created_at", { ascending: false }).limit(5),
        ]);

        const idBySlug: Record<string, string> = {};
        for (const a of (dailyAgents.data || [])) idBySlug[a.slug] = a.id;

        const nowUtc = new Date();
        const rows = DAILY_SLA_AGENTS.map((sla) => {
          const agent = (dailyAgents.data || []).find((a: any) => a.slug === sla.slug);
          const runs  = (todayRuns.data || []).filter((r: any) => r.agent_id === agent?.id);
          const completed = runs.find((r: any) => r.status === "completed");
          const failed    = runs.find((r: any) => r.status === "failed");
          const running   = runs.find((r: any) => r.status === "running");
          const deadline  = utcDeadline(sla.deadlineUtc);
          let status: string = "pending";
          if (completed) status = new Date(completed.started_at) <= deadline ? "on_time" : "late";
          else if (failed) status = "failed";
          else if (running) status = "running";
          else if (nowUtc > deadline) status = "missed";

          return {
            slug:         sla.slug,
            name:         agent?.name || sla.slug,
            schedule:     agent?.schedule || null,
            deadline_utc: sla.deadlineUtc,
            status,
            last_run_at:  agent?.last_run_at ?? null,
            started_at:   (completed?.started_at ?? failed?.started_at ?? running?.started_at) ?? null,
            completed_at: completed?.completed_at ?? null,
          };
        });

        // Orchestrator liveness
        let orchestrator: Record<string, unknown> = { silent: true, silent_hours: null, last_tick: null };
        if (orchAgent.data?.id) {
          const { data: ticks } = await sb
            .from("agent_runs")
            .select("started_at, status")
            .eq("agent_id", orchAgent.data.id)
            .order("started_at", { ascending: false })
            .limit(1);
          const last = ticks?.[0];
          const hours = last ? (nowUtc.getTime() - new Date(last.started_at).getTime()) / 3600000 : null;
          orchestrator = {
            last_tick: last?.started_at ?? null,
            last_status: last?.status ?? null,
            silent_hours: hours === null ? null : Math.round(hours * 10) / 10,
            silent: hours === null || hours > 2,
          };
        }

        // Monitor liveness
        let monitor: Record<string, unknown> = { last_run_at: monitorAgent.data?.last_run_at ?? null };

        // Overall color
        const missed = rows.filter((r) => r.status === "missed" || r.status === "failed").length;
        const late   = rows.filter((r) => r.status === "late").length;
        const on_time = rows.filter((r) => r.status === "on_time").length;
        let state: "green" | "yellow" | "red" = "green";
        if (missed > 0) state = "red";
        else if (orchestrator.silent && rows.some((r) => r.status === "pending")) state = "yellow";
        else if (late > 0) state = "yellow";

        return json({
          state,
          counts: { total: rows.length, on_time, late, missed, pending: rows.filter((r) => r.status === "pending").length },
          rows,
          orchestrator,
          monitor,
          alerts: todayAlerts.data || [],
        });
      }

      if (resource === "activity_log") {
        // Prefer activity_log table. Fall back to agent_runs if activity_log
        // has no rows yet (so widget stays useful during rollout).
        const date   = url.searchParams.get("date") || utcTodayStart().toISOString();
        const limit  = parseInt(url.searchParams.get("limit") || "50");
        const includeDebug = url.searchParams.get("include_debug") === "1";

        let query = sb
          .from("activity_log")
          .select("*")
          .gte("created_at", date)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (!includeDebug) query = query.neq("category", "debug");

        const { data: logs, error: logsErr } = await query;
        if (logsErr) throw logsErr;

        if ((logs || []).length > 0) {
          return json(
            (logs || []).map((r: any) => ({
              id:           r.id,
              created_at:   r.created_at,
              started_at:   r.created_at, // compat with old shape
              category:     r.category,
              actor_type:   r.actor_type,
              actor_name:   r.actor_name,
              action:       r.action,
              description:  r.description,
              entity_type:  r.entity_type,
              entity_id:    r.entity_id,
              metadata:     r.metadata,
              agent_run_id: r.agent_run_id,
              source:       "activity_log",
            })),
          );
        }

        // Fallback: read agent_runs for backwards compat
        const { data, error } = await sb
          .from("agent_runs")
          .select("*, agents(name, slug)")
          .gte("started_at", date)
          .order("started_at", { ascending: false })
          .limit(limit);
        if (error) throw error;
        return json(
          (data || []).map((r: any) => ({
            ...r,
            agent_name: r.agents?.name,
            agent_slug: r.agents?.slug,
            source: "agent_runs",
          })),
        );
      }

      return json({ error: "Unknown resource" }, 400);
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      if (body.resource === "services") {
        const { id, resource: _, ...updates } = body;
        const { data, error } = await sb.from("services").update(updates).eq("id", id).select();
        if (error) throw error;
        return json(data);
      }
      return json({ error: "Unknown resource" }, 400);
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
