// Per-job summary row for the site, straight from a job report's own
// formulas envelope, plus the ordering the jobs table uses.

export function jobSummary(d, f) {
  const F = d.formulas || {};
  const val = (k) => (F[k] && "value" in F[k] ? F[k].value : null);
  const waits = F.waits || {};
  const waitVal = (k) => (waits[k] && "value" in waits[k] ? waits[k].value : null);
  return {
    id: d.job || f.replace(/\.json$/, ""),
    status: val("status") ?? "unavailable",
    status_class: F.status?.class ?? "unavailable",
    lead_time_ms: val("lead_time_ms"),
    lead_time_class: F.lead_time_ms?.class ?? "unavailable",
    lead_time_censored: F.lead_time_ms?.censored === true,
    active_time_ms: val("active_time_ms"),
    active_time_shared: sharedTime(F.active_time_ms),
    flow_efficiency: val("flow_efficiency"),
    flow_efficiency_shared: sharedTime(F.flow_efficiency),
    queue_before_start_ms: val("queue_before_start_ms"),
    human_wait_ms: waitVal("human_wait_ms"),
    api_retry_ms: waitVal("api_retry_ms"),
    tool_failures: F.rework_signals?.tool_failures?.value ?? null,
    tool_failures_partial: partialQualifier(F.rework_signals?.tool_failures),
    tool_retries: F.rework_signals?.tool_retries?.value ?? null,
    tool_retries_partial: partialQualifier(F.rework_signals?.tool_retries),
    sessions_bound: F.sessions?.value?.bound ?? null,
    sessions_shared: F.sessions?.value?.shared ?? null,
    hosts: F.sessions_by_host?.value ?? {},
    concurrent_agents_max: F.concurrent_agents?.value?.maximum ?? null,
    public_prs: F.references?.value?.public_prs ?? 0,
    public_prs_shared: sharedTime(F.references),
    public_prs_partial: partialQualifier(F.references),
  };
}

// True when a job's measure involves a worker, usually the controlling
// session, that other jobs share: the pipeline marks it partial with the
// reason `worker_shared`. Shared time is copied, so it is an upper bound;
// shared pull requests are withheld, so the count is a lower bound.
function sharedTime(formula) {
  return Array.isArray(formula?.partial_reasons) && formula.partial_reasons.includes("worker_shared");
}

// The qualifier a count measure must render with, or null when the count is
// whole. A partial count covers only the sessions that could supply it, so it
// is a lower bound: `worker_split` (a session's retries and failures cannot be
// divided among its jobs), `worker_shared` (a shared session's pull requests
// are withheld) or, with no named reason, plain `partial`.
export function partialQualifier(formula) {
  const reasons = Array.isArray(formula?.partial_reasons) ? formula.partial_reasons : [];
  if (formula?.partial !== true && reasons.length === 0) return null;
  const names = reasons.map((r) => r.replace(/^worker_/, ""));
  return names.length > 0 ? names.join(", ") : "partial";
}

// Measured lead times first (longest first), then censored ones (a lower
// bound, longest first), then jobs with no lead time at all.
export function compareJobs(a, b) {
  const rank = (j) => (j.lead_time_ms == null ? 2 : j.lead_time_censored ? 1 : 0);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return 0;
  return b.lead_time_ms - a.lead_time_ms;
}
