// Per-job summary row for the site, straight from a job report's own
// formulas envelope, plus the ordering the jobs table uses. Every number is
// a stated number (see state.mjs): the pipeline's measured / partial /
// unavailable state and its reasons are kept, never reduced to a value or a
// null, and a formula the report lacks is unavailable (`not_recorded`),
// never zero.

import { fromFormula, unavailable, withBound } from "./state.mjs";

// Reasons that only say part of a job's own work is copied in from a worker
// it shares or splits with other jobs. Every other partial reason says some
// of the work was not seen, which pulls the true figure up.
const SHARING = new Set(["worker_shared", "worker_split"]);

// Which way a partial figure lies. A time that includes a worker shared with
// other jobs is copied, so it is an upper bound, unless some of the work was
// also not seen: then the two pull opposite ways and no bound is shown. A
// count that covers only the sessions that could supply it is a lower bound.
// A censored lead time is a lower bound on a job still running.
function bounded(formula, kind) {
  const n = fromFormula(formula);
  if (n.state !== "partial") return n;
  if (kind === "count") return withBound(n, "lower");
  if (kind === "time") {
    return n.reasons.includes("worker_shared") && n.reasons.every((r) => SHARING.has(r)) ? withBound(n, "upper") : n;
  }
  if (kind === "lead") return n.reasons.includes("censored") ? withBound(n, "lower") : n;
  return n;
}

// One part of the `references` result. A current report has `parts`, each
// with its own state; an older one has only the composite, whose value
// holds a 0 for a count the host does not record, so only its pull request
// count (which every host records at least partly) is read from it.
function referencePart(refs, key) {
  if (refs?.parts && typeof refs.parts === "object") return refs.parts[key];
  if (key !== "public_prs") return undefined;
  return refs && refs.value && typeof refs.value === "object" && refs.class !== "unavailable"
    ? { ...refs, value: refs.value.public_prs }
    : refs;
}

// Every measure the job page shows, in order: what it is called, how its
// value reads, and where it sits in the report. A measure the report lacks
// is no data with the reason `not_recorded`.
const DETAILS = [
  ["lead_time_ms", "Lead time", "duration", (F) => bounded(F.lead_time_ms, "lead")],
  ["queue_before_start_ms", "Queue before the first session", "duration", (F) => fromFormula(F.queue_before_start_ms)],
  ["active_time_ms", "Active time", "duration", (F) => bounded(F.active_time_ms, "time")],
  ["busy_time_ms", "Busy time, all workers", "duration", (F) => bounded(F.busy_time_ms, "time")],
  ["flow_efficiency", "Flow efficiency", "pct", (F) => bounded(F.flow_efficiency, "time")],
  ["human_wait_ms", "Waiting on a human", "duration", (F) => fromFormula(F.waits?.human_wait_ms)],
  ["permission_wait_ms", "Waiting on a permission prompt", "duration", (F) => fromFormula(F.waits?.permission_wait_ms)],
  ["api_retry_ms", "Waiting on API retries", "duration", (F) => bounded(F.waits?.api_retry_ms, "count")],
  ["compaction_ms", "Waiting on context compaction", "duration", (F) => fromFormula(F.waits?.compaction_ms)],
  ["tool_failures", "Tool failures", "count", (F) => bounded(F.rework_signals?.tool_failures, "count")],
  ["tool_retries", "Tool retries", "count", (F) => bounded(F.rework_signals?.tool_retries, "count")],
  ["api_retries", "API retries", "count", (F) => bounded(F.rework_signals?.api_retries, "count")],
  ["session_retouches", "Sessions that came back to it", "count", (F) => fromFormula(F.rework_signals?.session_retouches)],
  ["public_prs", "Public pull requests", "count", (F) => bounded(referencePart(F.references, "public_prs"), "count")],
  ["public_commits", "Public commits", "count", (F) => bounded(referencePart(F.references, "public_commits"), "count")],
  ["private_prs", "Private pull requests (counted only)", "count", (F) => bounded(referencePart(F.references, "private_prs"), "count")],
  ["private_commits", "Private commits (counted only)", "count", (F) => bounded(referencePart(F.references, "private_commits"), "count")],
  ["tokens_total", "Tokens, input plus output", "compact", (F) => bounded(F.tokens_total?.total, "count")],
  ["tokens_input", "Input tokens", "compact", (F) => bounded(F.tokens_total?.input, "count")],
  ["tokens_output", "Output tokens", "compact", (F) => bounded(F.tokens_total?.output, "count")],
  ["tokens_reasoning", "Reasoning tokens (inside output)", "compact", (F) => bounded(F.tokens_total?.reasoning, "count")],
  ["tokens_cache_read", "Cache read tokens", "compact", (F) => bounded(F.tokens_total?.cache_read, "count")],
  ["tokens_cache_write", "Cache write tokens", "compact", (F) => bounded(F.tokens_total?.cache_write, "count")],
];

export function jobDetails(F) {
  return DETAILS.map(([key, label, kind, read]) => ({ key, label, kind, number: read(F || {}) }));
}

export function jobSummary(d, f) {
  const F = d?.formulas || {};
  const waits = F.waits || {};
  const prs = referencePart(F.references, "public_prs");
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
    details: jobDetails(F),
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
