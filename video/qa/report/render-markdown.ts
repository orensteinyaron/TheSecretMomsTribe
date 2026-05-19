// Markdown rendering for QAReport. Structured for human review — verdict,
// human-review banner, per-dimension table + details, cost summary, evidence
// frame paths.

import type { QAReport } from "../schemas/qa-report.js";

function statusBadge(s: "PASS" | "FAIL" | "UNMEASURED"): string {
  return s === "PASS" ? "PASS" : s === "FAIL" ? "**FAIL**" : "UNMEASURED";
}

function verdictBadge(v: "PASS" | "FAIL" | "PARTIAL"): string {
  return v === "PASS" ? "**PASS**" : v === "FAIL" ? "**FAIL**" : "**PARTIAL**";
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderQAReportMarkdown(report: QAReport): string {
  const ts = report.ran_at.replace("T", " ").slice(0, 19) + " UTC";
  const variant = report.render_profile_variant ? ` (variant: ${report.render_profile_variant})` : "";
  const banner = report.human_review_required
    ? `\n> **HUMAN REVIEW REQUIRED.** Profile is in 'informational' status; this report is informational only. Yaron's eyes are the gate.\n`
    : "";
  const unmeasuredLine = report.unmeasured_dimensions.length > 0
    ? `\n**Unmeasured dimensions:** ${report.unmeasured_dimensions.join(", ")}\n`
    : "";

  const dimRows = report.dimensions.map(d => {
    const scoreCell = d.score === undefined ? "—" : Number.isInteger(d.score) ? `${d.score}` : d.score.toFixed(2);
    return `| ${d.name} | ${statusBadge(d.status)} | ${scoreCell} | ${escapeCell(d.details.slice(0, 240))}${d.details.length > 240 ? "…" : ""} |`;
  }).join("\n");

  const dimDetails = report.dimensions.map(d => {
    const head = `\n### ${d.name} — ${statusBadge(d.status)}${d.score !== undefined ? ` (score ${d.score.toFixed ? d.score.toFixed(2) : d.score})` : ""}`;
    const body = `${d.details}`;
    const evidence = d.evidence && d.evidence.length > 0
      ? `\n\n**Evidence:**\n${d.evidence.map(e => `- \`${e}\``).join("\n")}`
      : "";
    const calls = d.call_costs && d.call_costs.length > 0
      ? `\n\n**API calls:** ${d.call_costs.length} (cost $${d.call_costs.reduce((s, c) => s + c.cost_usd, 0).toFixed(4)})`
      : "";
    return `${head}\n\n${body}${evidence}${calls}`;
  }).join("\n");

  const costRows = Object.entries(report.cost_summary.by_dimension).map(([name, v]) =>
    `| ${name} | ${v.calls} | $${v.cost_usd.toFixed(4)} |`,
  ).join("\n");
  const serviceRows = Object.entries(report.cost_summary.by_service).map(([svc, v]) =>
    `| ${svc} | ${v.calls} | $${v.cost_usd.toFixed(4)} |`,
  ).join("\n");

  return `# QA Report — ${report.render_profile_slug}${variant}

Generated: ${ts}
Agent version: ${report.agent_version}
Asset: \`${report.asset_path}\`${report.asset_id ? `\nContent ID: \`${report.asset_id}\`` : ""}

## Overall verdict: ${verdictBadge(report.overall_verdict)}
${banner}${unmeasuredLine}
## Per-dimension scores

| Dimension | Status | Score | Notes |
|---|---|---|---|
${dimRows || "_(no dimensions ran)_"}

**Total cost:** $${report.cost_summary.total_usd.toFixed(4)}${report.cost_summary.retries > 0 ? ` · retries: ${report.cost_summary.retries}` : ""}

## Cost — by dimension

| Dimension | Calls | Cost (USD) |
|---|---|---|
${costRows || "_(no calls)_"}

## Cost — by service

| Service | Calls | Cost (USD) |
|---|---|---|
${serviceRows || "_(no calls)_"}

## Dimension detail
${dimDetails}
`;
}
