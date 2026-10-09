// Per-job summary row for the site, straight from a job report's own
// formulas envelope, plus the ordering the jobs table uses. Every number is
// a stated number (see state.mjs): the pipeline's measured / partial /
// unavailable state and its reasons are kept, never reduced to a value or a
// null, and a formula the report lacks is unavailable (`not_recorded`),
// never zero.

import { direct, ratioDirection } from "./bounds.mjs";
import { fromFormula, measured, unavailable } from "./state.mjs";
import { waitWords } from "./outcomes.mjs";

// Every partial figure carries its direction from the one table in
// bounds.mjs, keyed by the measure.
function bounded(formula, measure) {
  return direct(fromFormula(formula), measure);
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
  ["lead_time_ms", "Lead time", "duration", (F) => bounded(F.lead_time_ms, "lead_time_ms")],
  ["queue_before_start_ms", "Queue before the first session", "duration", (F) => bounded(F.queue_before_start_ms, "queue_before_start_ms")],
  ["active_time_ms", "Active time", "duration", (F) => bounded(F.active_time_ms, "active_time_ms")],
  ["busy_time_ms", "Busy time, all workers", "duration", (F) => bounded(F.busy_time_ms, "busy_time_ms")],
  ["flow_efficiency", "Flow efficiency", "pct", (F) => flowOf(F)],
  ["human_wait_ms", "Waiting on a human", "duration", (F) => bounded(F.waits?.human_wait_ms, "human_wait_ms")],
  ["permission_wait_ms", "Waiting on a permission prompt", "duration", (F) => bounded(F.waits?.permission_wait_ms, "permission_wait_ms")],
  ["api_retry_ms", "Waiting on API retries", "duration", (F) => bounded(F.waits?.api_retry_ms, "api_retry_ms")],
  ["compaction_ms", "Waiting on context compaction", "duration", (F) => bounded(F.waits?.compaction_ms, "compaction_ms")],
  ["tool_failures", "Tool failures", "count", (F) => bounded(F.rework_signals?.tool_failures, "tool_failures")],
  ["tool_retries", "Tool retries", "count", (F) => bounded(F.rework_signals?.tool_retries, "tool_retries")],
  ["api_retries", "API retries", "count", (F) => bounded(F.rework_signals?.api_retries, "api_retries")],
  ["session_retouches", "Sessions that came back to it", "count", (F) => bounded(F.rework_signals?.session_retouches, "session_retouches")],
  ["public_prs", "Public pull requests", "count", (F) => bounded(referencePart(F.references, "public_prs"), "public_prs")],
  ["public_commits", "Public commits", "count", (F) => bounded(referencePart(F.references, "public_commits"), "public_commits")],
  ["private_prs", "Private pull requests (counted only)", "count", (F) => bounded(referencePart(F.references, "private_prs"), "private_prs")],
  ["private_commits", "Private commits (counted only)", "count", (F) => bounded(referencePart(F.references, "private_commits"), "private_commits")],
  ["tokens_total", "Tokens, input plus output", "compact", (F) => bounded(F.tokens_total?.total, "tokens_total")],
  ["tokens_input", "Input tokens", "compact", (F) => bounded(F.tokens_total?.input, "tokens_input")],
  ["tokens_output", "Output tokens", "compact", (F) => bounded(F.tokens_total?.output, "tokens_output")],
  ["tokens_reasoning", "Reasoning tokens (inside output)", "compact", (F) => bounded(F.tokens_total?.reasoning, "tokens_reasoning")],
  ["tokens_cache_read", "Cache read tokens", "compact", (F) => bounded(F.tokens_total?.cache_read, "tokens_cache_read")],
  ["tokens_cache_write", "Cache write tokens", "compact", (F) => bounded(F.tokens_total?.cache_write, "tokens_cache_write")],
  ["signoff", "Sign-off", "text", signoffOf],
  ["signoff_wait", "Wait for sign-off", "text", signoffWaitOf],
  ["first_pass", "First pass", "pass", (F) => bounded(F.first_pass_yield, "first_pass_job")],
  ["returns", "Times sent back", "count", returnsOf],
];

// The human's answer to the job's delivery, in words. An acceptance or a
// refusal no human was seen to make says so; the card's raw state is never
// shown as an acceptance on its own.
const SIGNOFF_WORDS = {
  delivered_unsigned: "delivered, not signed yet",
  reopened: "reopened",
  not_delivered: "not delivered yet",
};
// The job's sign-off state in words. Acceptance is the agent's record of the
// operator's word; the site reads only the state, never a `verified` field.
function signoffOf(F) {
  const n = fromFormula(F.signoff);
  if (n.state === "unavailable") return n;
  const v = n.value;
  let words = SIGNOFF_WORDS[v];
  if (v === "accepted") words = "accepted";
  if (v === "refused") words = "sent back";
  return words ? measured(words) : unavailable(["not_recorded"]);
}

// Where the job stands for the operator, in one word the page can group by:
// accepted, sent back, delivered and waiting for an answer, delivered before
// sign-off was recorded, or not delivered yet.
export function outcomeOf(status, F) {
  const s = F?.signoff;
  const v = s && s.state !== "unavailable" && s.class !== "unavailable" ? s.value : null;
  if (v === "accepted") return "accepted";
  if (v === "refused") return "sent_back";
  if (v === "delivered_unsigned") return "awaiting_signoff";
  if (status === "done") return "delivered";
  if (status === "cancelled") return "cancelled";
  if (status === "unavailable") return "unknown";
  return "in_progress";
}

// The human attention the job took (Desk's per-job attention estimate) and
// the human turns it rests on, each with the estimate's own state.
function attentionOf(F) {
  return bounded(F.attention, "attention_ms");
}
function humanTurnsOf(F) {
  const a = F.attention;
  const n = fromFormula(a);
  if (n.state === "unavailable") return n;
  if (!Number.isSafeInteger(a.turns) || a.turns < 0) return unavailable(["not_recorded"]);
  return bounded({ ...a, value: a.turns }, "human_turns");
}

// How many work bursts the task's map draws: the timeline's bursts, with
// the state Desk gives them (an envelope { state, reasons, items } or
// `bursts_state`). A map whose bursts are unavailable draws none, whatever
// its list holds; a partly recorded one draws at least these.
function mapBurstsOf(t) {
  if (!t || typeof t !== "object") return unavailable(["not_recorded"]);
  const b = t.bursts;
  const env = t.bursts_state && typeof t.bursts_state === "object" ? t.bursts_state : b && typeof b === "object" && !Array.isArray(b) ? b : null;
  const items = Array.isArray(b) ? b : b && Array.isArray(b.items) ? b.items : [];
  const reasons = env && Array.isArray(env.reasons) ? env.reasons : [];
  const state = env && typeof env.state === "string" ? env.state : "measured";
  if (state === "unavailable") return unavailable(reasons.length ? reasons : ["not_recorded"]);
  if (state === "partial") return { state: "partial", value: items.length, reasons: reasons.length ? reasons : ["partial"], bound: "lower" };
  return measured(items.length);
}

// The job's public pull requests, as links with their number only (never
// the repository owner on the page text).
function pullRequestsOf(F) {
  const list = F.references?.value?.public_pull_requests;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.repo === "string" && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(p.repo) && Number.isSafeInteger(p.number) && p.number > 0)
    .map((p) => ({ ref: `#${p.number}`, url: `https://github.com/${p.repo}/pull/${p.number}` }));
}

// The sessions on the job's timeline, in order of first appearance.
export function sessionsOf(d) {
  const seen = new Map();
  for (const i of Array.isArray(d?.timeline?.intervals) ? d.timeline.intervals : []) {
    if (i && typeof i.session_id === "string" && /^[0-9A-Za-z_-]{1,64}$/.test(i.session_id) && !seen.has(i.session_id)) {
      seen.set(i.session_id, typeof i.host === "string" ? i.host : "unknown");
    }
  }
  return [...seen].map(([session_id, host]) => ({ session_id, host }));
}
function signoffWaitOf(F) {
  const n = fromFormula(F.signoff);
  if (n.state === "unavailable") return n;
  const words = waitWords(F.signoff?.wait);
  return words ? measured(words) : unavailable(["not_delivered"]);
}
// All returns of the job, whichever catch point caught them.
function returnsOf(F) {
  const r = F.rework;
  if (!r || typeof r !== "object" || !r.value || typeof r.value !== "object") return bounded(r, "returns");
  const parts = Object.values(r.value);
  if (!parts.every((x) => Number.isSafeInteger(x) && x >= 0)) return unavailable(["not_recorded"]);
  return bounded({ ...r, value: parts.reduce((a, b) => a + b, 0) }, "returns");
}

// Flow efficiency is working over lead time, so a partial one takes its
// direction from those two (as Desk's rollups do), not a fixed "unknown"
// (A1 pass 2 M-n2).
function flowOf(F) {
  const fe = bounded(F.flow_efficiency, "flow_efficiency");
  if (!fe || fe.state !== "partial") return fe;
  return { ...fe, bound: ratioDirection(bounded(F.active_time_ms, "active_time_ms"), bounded(F.lead_time_ms, "lead_time_ms")) };
}

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
    lead_time_ms: bounded(F.lead_time_ms, "lead_time_ms"),
    active_time_ms: bounded(F.active_time_ms, "active_time_ms"),
    flow_efficiency: flowOf(F),
    queue_before_start_ms: bounded(F.queue_before_start_ms, "queue_before_start_ms"),
    human_wait_ms: bounded(waits.human_wait_ms, "human_wait_ms"),
    api_retry_ms: bounded(waits.api_retry_ms, "api_retry_ms"),
    tool_failures: bounded(F.rework_signals?.tool_failures, "tool_failures"),
    tool_retries: bounded(F.rework_signals?.tool_retries, "tool_retries"),
    sessions_bound: bounded(bound, "sessions_bound"),
    public_prs: bounded(prs, "public_prs"),
    signoff: signoffOf(F),
    signoff_wait: signoffWaitOf(F),
    first_pass: bounded(F.first_pass_yield, "first_pass_job"),
    returns: returnsOf(F),
    outcome: outcomeOf(statusValue, F),
    attention_ms: attentionOf(F),
    human_turns: humanTurnsOf(F),
    map_bursts: mapBurstsOf(d?.timeline),
    pull_requests: pullRequestsOf(F),
    sessions: sessionsOf(d),
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
