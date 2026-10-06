// Fact-level numbers for the site, each with its state. The published facts
// carry an `unavailable` list ({ field, reason }) for what the host did not
// or could not record; this module reads it. A session that did not measure
// something is an unmeasured member of the population, never a zero, and
// every total is a rollup over the measured members with n of N.

import { activeMs } from "./active-time.mjs";
import { direct } from "./bounds.mjs";
import { measured, partial, rollup, unavailable } from "./state.mjs";

// The population the site's own fact-level rollups count.
export const SUBSTANTIAL = "substantial sessions";

const sum = (v) => v.reduce((a, b) => a + b, 0);

// What each host never records, or records only partly, whatever its file
// says. Desk's published facts /2 carry these flags in every file; a /1 file
// does not, so they are added when it is read (the file is not changed).
// Mirrors Desk's host constants (contract for the store and the site,
// section 1.7); `host_records_partly` means the number is a lower bound.
export const HOST_FLAGS = Object.freeze({
  "claude-code": [
    ["compaction_waits", "host_does_not_record"],
    ["reasoning_tokens", "host_does_not_record"],
    ["commits", "host_does_not_record"],
    ["permission_waits", "host_does_not_record"],
    ["prs", "host_records_partly"],
    ["api_retries", "host_records_partly"],
  ],
  "codex-cli": [
    ["compaction_waits", "host_does_not_record"],
    ["commits", "host_does_not_record"],
    ["permission_waits", "host_does_not_record"],
    ["api_retries", "host_does_not_record"],
    ["prs", "host_records_partly"],
    ["tool_outcomes", "host_records_partly"],
    ["requests", "host_records_partly"],
    ["tokens", "host_records_partly"],
    ["human_turns", "host_does_not_record"],
  ],
  "copilot-cli": [
    ["prs", "host_records_partly"],
    ["human_turns", "host_records_partly"],
  ],
});

// A session's flags: its own `unavailable` list plus its host's constants,
// each pair once. Absent or null in a facts file is "not recorded", never 0.
export function sessionFlags(d) {
  const own = (Array.isArray(d?.unavailable) ? d.unavailable : []).filter(
    (u) => u && typeof u.field === "string" && typeof u.reason === "string",
  );
  const host = d?.session?.host;
  const constant = (Object.hasOwn(HOST_FLAGS, host) ? HOST_FLAGS[host] : []).map(([field, reason]) => ({ field, reason }));
  if (host === "copilot-cli" && d?.session?.entrypoint === "cli") constant.push({ field: "entrypoint", reason: "host_does_not_record" });
  const seen = new Set();
  return [...own, ...constant].filter((u) => {
    const key = `${u.field}|${u.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const flags = sessionFlags;

// The entry point a session recorded, or "unknown" when it recorded none or
// its host only fills in a default.
export function entrypointOf(d) {
  const e = d?.session?.entrypoint;
  if (typeof e !== "string" || !e) return "unknown";
  return sessionFlags(d).some((u) => u.field === "entrypoint") ? "unknown" : e;
}

// Reasons under which a session's record of its workers or tool calls may be
// incomplete. `session_open` only says the session has not ended: what has
// been recorded so far is still whole.
const INCOMPLETE = new Set(["source_unreadable", "log_truncated", "capped"]);

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
  const of = SUBSTANTIAL;
  const bucketOf = (c) => (c === 0 ? "0" : c <= 2 ? "1-2" : c <= 5 ? "3-5" : "6+");
  const buckets = {};
  for (const key of ["0", "1-2", "3-5", "6+"]) {
    buckets[key] = rollup(
      per.map((n) => (n.state === "measured" ? measured(bucketOf(n.value) === key ? 1 : 0) : n)),
      { of, measure: "sum", reduce: sum },
    );
  }
  return {
    dispatches: rollup(per, { of, measure: "sum", reduce: sum }),
    sessions_with_subagents: rollup(
      per.map((n) => (n.state === "measured" ? measured(n.value > 0 ? 1 : 0) : n)),
      { of, measure: "sum", reduce: sum },
    ),
    buckets,
  };
}

// ---- tool calls ------------------------------------------------------------

const TOOL_FIELDS = ["tool_calls", "tool_failures", "tool_durations", "job_segments"];

// A session's tool counts. `failures` also carries how far its outcomes can
// be trusted: a host that does not record outcomes has no failure count at
// all, and one that records them partly gives a lower bound.
function toolCounts(d) {
  const calls = d?.counts?.tool_calls;
  const failures = d?.counts?.tool_failures;
  if (!calls || typeof calls !== "object" || !failures || typeof failures !== "object") {
    return { state: "unavailable", reasons: ["not_recorded"] };
  }
  const reasons = incompleteReasons(d, TOOL_FIELDS);
  const outcomes = [...new Set(flaggedReasons(d, "tool_outcomes"))];
  const out = reasons.length ? { state: "partial", reasons, calls, failures } : { state: "measured", reasons: [], calls, failures };
  return outcomes.length ? { ...out, outcomes } : out;
}

// The failure side of a session's tool counts, as a stated number.
function failureNumber(t, pick) {
  if (t.state === "unavailable") return unavailable(t.reasons);
  const hard = (t.outcomes || []).filter((r) => r !== "host_records_partly");
  if (hard.length) return unavailable(hard);
  const reasons = [...new Set([...t.reasons, ...(t.outcomes || [])])].sort();
  if (reasons.length) return direct(partial(pick(t), reasons), "session_tool_failures");
  return measured(pick(t));
}

function countOf(obj, key) {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function toolKindRollups(sessions) {
  const per = sessions.map(toolCounts);
  const of = SUBSTANTIAL;
  const asMember = (c, f) => {
    if (c.state === "unavailable") return unavailable(c.reasons);
    if (c.state === "partial") return partial(f(c), c.reasons);
    return measured(f(c));
  };
  const totalCalls = rollup(per.map((c) => asMember(c, (x) => sum(Object.values(x.calls).filter((v) => Number.isFinite(v))))), {
    of,
    measure: "sum",
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
    const calls = rollup(per.map((c) => asMember(c, (x) => countOf(x.calls, tool))), { of, measure: "sum", reduce: sum });
    const failures = rollup(per.map((c) => failureNumber(c, (x) => countOf(x.failures, tool))), { of, measure: "sum", reduce: sum });
    const using = rollup(per.map((c) => asMember(c, (x) => (countOf(x.calls, tool) > 0 ? 1 : 0))), { of, measure: "sum", reduce: sum });
    // The rate divides failures by calls over the same sessions: those whose
    // calls and failures are both measured.
    const rateMembers = per.map((c) => {
      const f = failureNumber(c, (x) => countOf(x.failures, tool));
      const k = asMember(c, (x) => countOf(x.calls, tool));
      if (f.state !== "measured") return f;
      if (k.state !== "measured") return k;
      return { ...f, aux: k.value };
    });
    const callsCounted = sum(rateMembers.filter((m) => m.state === "measured").map((m) => m.aux));
    const rate =
      callsCounted > 0
        ? rollup(rateMembers, { of, measure: "rate", reduce: (v, ms) => sum(v) / sum(ms.map((m) => m.aux)) })
        : { ...unavailable(["no_calls"]), kind: "rollup", n: 0, N: per.length, of, out_of_scope: 0 };
    return { tool, calls, failures, sessions: using, failure_rate: rate };
  });
  kinds.sort((a, b) => (b.calls.value ?? -1) - (a.calls.value ?? -1));
  return { total_calls: totalCalls, kinds };
}

// ---- models and tokens -----------------------------------------------------

const COUNTERS = ["input", "output", "cache_read", "cache_write"];

// A session's models, and the flags on each kind of counter. A flag on
// `models` stops every counter; a flag on `requests` or on `tokens` stops
// only that kind. `host_records_partly` alone keeps the count as a lower
// bound (partial), never as a whole one.
function modelsOf(d) {
  const flagged = flaggedReasons(d, "models");
  const list = Array.isArray(d?.models) ? d.models : [];
  if (flagged.length) return { reasons: [...new Set(flagged)] };
  // An empty list with no flag is not "no models were used": the host did not
  // record them.
  if (list.length === 0) return { reasons: ["not_recorded"] };
  return {
    list,
    requests: [...new Set(flaggedReasons(d, "requests"))],
    tokens: [...new Set(flaggedReasons(d, "tokens"))],
  };
}

function counter(m, key) {
  const v = key === "requests" ? m?.requests : m?.tokens?.[key];
  return typeof v === "number" && Number.isFinite(v) ? measured(v) : unavailable(["counter_not_recorded"]);
}

// Sum `key` over a session's model rows `rows`, read through that counter
// kind's flags.
function counted(p, rows, key) {
  const kindFlags = key === "requests" ? p.requests : p.tokens;
  const hard = kindFlags.filter((r) => r !== "host_records_partly");
  if (hard.length) return unavailable(hard);
  if (rows.length === 0) return measured(0);
  const parts = rows.map((m) => counter(m, key));
  const bad = parts.find((x) => x.state !== "measured");
  if (bad) return bad;
  const total = sum(parts.map((x) => x.value));
  return kindFlags.length ? direct(partial(total, kindFlags), "session_counter") : measured(total);
}

export function modelRollups(sessions) {
  const per = sessions.map(modelsOf);
  const of = SUBSTANTIAL;
  const ids = new Set();
  for (const p of per) for (const m of p.list || []) if (m && typeof m.id === "string") ids.add(m.id);
  const member = (p, id, key) => (p.list ? counted(p, p.list.filter((m) => m && m.id === id), key) : unavailable(p.reasons));
  const totalMember = (p) => (p.list ? counted(p, p.list, "requests") : unavailable(p.reasons));
  const models = [...ids].map((id) => {
    const row = { id, requests: rollup(per.map((p) => member(p, id, "requests")), { of, measure: "sum", reduce: sum }) };
    for (const k of COUNTERS) row[k] = rollup(per.map((p) => member(p, id, k)), { of, measure: "sum", reduce: sum });
    return row;
  });
  models.sort((a, b) => (b.requests.value ?? -1) - (a.requests.value ?? -1) || a.id.localeCompare(b.id));
  return { total_requests: rollup(per.map(totalMember), { of, measure: "sum", reduce: sum }), models };
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
    active = reasons.length ? direct(partial(activeMs(d), reasons), "session_active_ms") : measured(activeMs(d));
  }
  const tools = toolCounts(d);
  const total = (obj) => sum(Object.values(obj).filter((v) => Number.isFinite(v)));
  const fromTools = (pick) =>
    tools.state === "unavailable"
      ? unavailable(tools.reasons)
      : tools.state === "partial"
        ? direct(partial(pick(tools), tools.reasons), "session_tool_calls")
        : measured(pick(tools));
  return {
    duration_ms: Number.isFinite(duration) ? measured(duration) : unavailable(["not_recorded"]),
    active_ms: active,
    subagent_count: subagentCount(d),
    tool_calls_total: fromTools((t) => total(t.calls)),
    tool_failures_total: failureNumber(tools, (t) => total(t.failures)),
  };
}
