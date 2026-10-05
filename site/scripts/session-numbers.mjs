// Fact-level numbers for the site, each with its state. The published facts
// carry an `unavailable` list ({ field, reason }) for what the host did not
// or could not record; this module reads it. A session that did not measure
// something is an unmeasured member of the population, never a zero, and
// every total is a rollup over the measured members with n of N.

import { activeMs } from "./active-time.mjs";
import { measured, partial, rollup, unavailable } from "./state.mjs";

const sum = (v) => v.reduce((a, b) => a + b, 0);

function flags(d) {
  return (Array.isArray(d?.unavailable) ? d.unavailable : []).filter(
    (u) => u && typeof u.field === "string" && typeof u.reason === "string",
  );
}

// Reasons under which a session's record of its workers or tool calls may be
// incomplete. `session_open` only says the session has not ended: what has
// been recorded so far is still whole.
const INCOMPLETE = new Set(["source_unreadable", "log_truncated"]);

function incompleteReasons(d, fields) {
  return [
    ...new Set(
      flags(d)
        .filter((u) => fields.includes(u.field) && INCOMPLETE.has(u.reason))
        .map((u) => u.reason),
    ),
  ];
}

function flaggedReasons(d, field) {
  return flags(d)
    .filter((u) => u.field === field)
    .map((u) => u.reason);
}

// Subagent counts depend on the agents list and on the logs that carry the
// subagents; any of those flagged unreadable or truncated means the count may
// be short, so it is not a measured zero.
const SUBAGENT_FIELDS = ["agents", "turns", "tool_durations"];

function subagentCount(d) {
  const flagged = flaggedReasons(d, "agents");
  if (flagged.length) return unavailable(flagged);
  const reasons = incompleteReasons(d, SUBAGENT_FIELDS);
  if (reasons.length) return unavailable(reasons);
  // No agents list at all (and no flag) is not "no subagents": nothing was recorded.
  if (!Array.isArray(d.agents)) return unavailable(["not_recorded"]);
  const agents = d.agents;
  return measured(agents.filter((a) => a && a.parent !== null && a.parent !== undefined).length);
}

export function subagentRollups(sessions) {
  const per = sessions.map(subagentCount);
  const of = "sessions";
  const bucketOf = (c) => (c === 0 ? "0" : c <= 2 ? "1-2" : c <= 5 ? "3-5" : "6+");
  const buckets = {};
  for (const key of ["0", "1-2", "3-5", "6+"]) {
    buckets[key] = rollup(
      per.map((n) => (n.state === "measured" ? measured(bucketOf(n.value) === key ? 1 : 0) : n)),
      { of, reduce: sum },
    );
  }
  return {
    dispatches: rollup(per, { of, reduce: sum }),
    sessions_with_subagents: rollup(
      per.map((n) => (n.state === "measured" ? measured(n.value > 0 ? 1 : 0) : n)),
      { of, reduce: sum },
    ),
    buckets,
  };
}

// ---- tool calls ------------------------------------------------------------

const TOOL_FIELDS = ["tool_calls", "tool_failures", "tool_durations"];

function toolCounts(d) {
  const calls = d?.counts?.tool_calls;
  const failures = d?.counts?.tool_failures;
  if (!calls || typeof calls !== "object" || !failures || typeof failures !== "object") {
    return { state: "unavailable", reasons: ["not_recorded"] };
  }
  const reasons = incompleteReasons(d, TOOL_FIELDS);
  return reasons.length ? { state: "partial", reasons, calls, failures } : { state: "measured", reasons: [], calls, failures };
}

function countOf(obj, key) {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function toolKindRollups(sessions) {
  const per = sessions.map(toolCounts);
  const of = "sessions";
  const asMember = (c, f) => {
    if (c.state === "unavailable") return unavailable(c.reasons);
    if (c.state === "partial") return partial(f(c), c.reasons);
    return measured(f(c));
  };
  const totalCalls = rollup(per.map((c) => asMember(c, (x) => sum(Object.values(x.calls).filter((v) => Number.isFinite(v))))), {
    of,
    reduce: sum,
  });
  const tools = new Set();
  for (const c of per) {
    if (c.state === "measured") {
      for (const k of Object.keys(c.calls)) tools.add(k);
      for (const k of Object.keys(c.failures)) tools.add(k);
    }
  }
  const kinds = [...tools].map((tool) => {
    const calls = rollup(per.map((c) => asMember(c, (x) => countOf(x.calls, tool))), { of, reduce: sum });
    const failures = rollup(per.map((c) => asMember(c, (x) => countOf(x.failures, tool))), { of, reduce: sum });
    const using = rollup(per.map((c) => asMember(c, (x) => (countOf(x.calls, tool) > 0 ? 1 : 0))), { of, reduce: sum });
    const rate =
      calls.state === "unavailable" || calls.value === 0
        ? unavailable(calls.state === "unavailable" ? calls.reasons : ["no_calls"])
        : { ...calls, value: failures.value / calls.value, reasons: [...calls.reasons] };
    return { tool, calls, failures, sessions: using, failure_rate: rate };
  });
  kinds.sort((a, b) => (b.calls.value ?? -1) - (a.calls.value ?? -1));
  return { total_calls: totalCalls, kinds };
}

// ---- models and tokens -----------------------------------------------------

const COUNTERS = ["input", "output", "cache_read", "cache_write"];

function modelsOf(d) {
  const flagged = flaggedReasons(d, "models").concat(flaggedReasons(d, "tokens"));
  const list = Array.isArray(d?.models) ? d.models : [];
  if (flagged.length) return { reasons: [...new Set(flagged)] };
  // An empty list with no flag is not "no models were used": the host did not
  // record them.
  if (list.length === 0) return { reasons: ["not_recorded"] };
  return { list };
}

function counter(m, key) {
  const v = key === "requests" ? m?.requests : m?.tokens?.[key];
  return typeof v === "number" && Number.isFinite(v) ? measured(v) : unavailable(["counter_not_recorded"]);
}

export function modelRollups(sessions) {
  const per = sessions.map(modelsOf);
  const of = "sessions";
  const ids = new Set();
  for (const p of per) for (const m of p.list || []) if (m && typeof m.id === "string") ids.add(m.id);
  const member = (p, id, key) => {
    if (!p.list) return unavailable(p.reasons);
    const rows = p.list.filter((m) => m && m.id === id);
    if (rows.length === 0) return measured(0);
    const parts = rows.map((m) => counter(m, key));
    const bad = parts.find((x) => x.state !== "measured");
    return bad ? bad : measured(sum(parts.map((x) => x.value)));
  };
  const totalMember = (p) => {
    if (!p.list) return unavailable(p.reasons);
    const parts = p.list.map((m) => counter(m, "requests"));
    const bad = parts.find((x) => x.state !== "measured");
    return bad ? bad : measured(sum(parts.map((x) => x.value)));
  };
  const models = [...ids].map((id) => {
    const row = { id, requests: rollup(per.map((p) => member(p, id, "requests")), { of, reduce: sum }) };
    for (const k of COUNTERS) row[k] = rollup(per.map((p) => member(p, id, k)), { of, reduce: sum });
    return row;
  });
  models.sort((a, b) => (b.requests.value ?? -1) - (a.requests.value ?? -1) || a.id.localeCompare(b.id));
  return { total_requests: rollup(per.map(totalMember), { of, reduce: sum }), models };
}

// ---- one session on the featured card -------------------------------------

export function featuredNumbers(d) {
  const duration = d?.session?.duration_ms;
  const intervals = Array.isArray(d?.intervals) ? d.intervals : [];
  let active;
  if (intervals.length === 0) {
    active = unavailable(["no_intervals"]);
  } else {
    const reasons = incompleteReasons(d, ["turns", "tool_durations"]);
    active = reasons.length ? partial(activeMs(d), reasons) : measured(activeMs(d));
  }
  const tools = toolCounts(d);
  const total = (obj) => sum(Object.values(obj).filter((v) => Number.isFinite(v)));
  const fromTools = (pick) =>
    tools.state === "unavailable"
      ? unavailable(tools.reasons)
      : tools.state === "partial"
        ? partial(pick(tools), tools.reasons)
        : measured(pick(tools));
  return {
    duration_ms: Number.isFinite(duration) ? measured(duration) : unavailable(["not_recorded"]),
    active_ms: active,
    subagent_count: subagentCount(d),
    tool_calls_total: fromTools((t) => total(t.calls)),
    tool_failures_total: fromTools((t) => total(t.failures)),
  };
}
