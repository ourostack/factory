// Per-job summary row for the site, straight from a job report's own
// formulas envelope, plus the ordering the jobs table uses. Every number is
// a stated number (see state.mjs): the pipeline's measured / partial /
// unavailable state and its reasons are kept, never reduced to a value or a
// null, and a formula the report lacks is unavailable (`not_recorded`),
// never zero.

import { fromFormula, unavailable, withBound } from "./state.mjs";

// Which way a partial figure lies. A time that includes a worker shared with
// other jobs is copied, so it is an upper bound. A count that covers only the
// sessions that could supply it is a lower bound. A censored lead time is a
// lower bound on a job still running.
function bounded(formula, kind) {
  const n = fromFormula(formula);
  if (n.state !== "partial") return n;
  if (kind === "count") return withBound(n, "lower");
  if (kind === "time") return n.reasons.includes("worker_shared") ? withBound(n, "upper") : n;
  if (kind === "lead") return n.reasons.includes("censored") ? withBound(n, "lower") : n;
  return n;
}

export function jobSummary(d, f) {
  const F = d?.formulas || {};
  const waits = F.waits || {};
  const refs = F.references;
  const prs = refs && refs.value && typeof refs.value === "object" && refs.class !== "unavailable"
    ? { ...refs, value: refs.value.public_prs }
    : refs;
  const sessions = F.sessions;
  const bound = sessions && sessions.value && typeof sessions.value === "object"
    ? { ...sessions, value: sessions.value.bound }
    : sessions;
  const statusValue = F.status && typeof F.status.value === "string" ? F.status.value : "unavailable";
  return {
    id: d?.job || String(f).replace(/\.json$/, ""),
    status: statusValue,
    status_class: F.status?.class ?? "unavailable",
    lead_time_ms: bounded(F.lead_time_ms, "lead"),
    active_time_ms: bounded(F.active_time_ms, "time"),
    flow_efficiency: bounded(F.flow_efficiency, "time"),
    queue_before_start_ms: fromFormula(F.queue_before_start_ms),
    human_wait_ms: fromFormula(waits.human_wait_ms),
    api_retry_ms: fromFormula(waits.api_retry_ms),
    tool_failures: bounded(F.rework_signals?.tool_failures, "count"),
    tool_retries: bounded(F.rework_signals?.tool_retries, "count"),
    sessions_bound: fromFormula(bound),
    public_prs: bounded(prs, "count"),
  };
}

// A job's membership in a rollup over finished jobs whose whole life sits
// inside capture. Only a job that is KNOWN to be unfinished, or known to
// predate capture, is out of scope (by design). A job whose status or whose
// start offset could not be told is lost data, not out of scope: it keeps its
// own reason, stays in N and makes the figure partial.
export function scopeMember(j, key) {
  if (j.status === "unavailable") return unavailable(["status_unavailable"]);
  if (j.status !== "done") return unavailable(["outside_capture_scope"]);
  const q = j.queue_before_start_ms;
  if (q.state === "unavailable") return unavailable(q.reasons);
  if (q.state !== "measured") return unavailable(["queue_start_not_whole"]);
  if (q.value !== 0) return unavailable(["outside_capture_scope"]);
  return j[key];
}

// Measured lead times first (longest first), then partial ones (a lower
// bound, longest first), then jobs with no lead time at all.
export function compareJobs(a, b) {
  const rank = (j) => (j.lead_time_ms.state === "unavailable" ? 2 : j.lead_time_ms.state === "partial" ? 1 : 0);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return 0;
  return b.lead_time_ms.value - a.lead_time_ms.value;
}
