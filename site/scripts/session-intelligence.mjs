import { createRequire } from "node:module";
import { activeMs } from "./active-time.mjs";
import { featuredNumbers, sessionFlags } from "./session-numbers.mjs";
import { measured, partial, unavailable } from "./state.mjs";
import { direct } from "./bounds.mjs";
import { projectTaskContext } from "./task-context.mjs";

const { validateSessionCatalog, validateSessionDetail } = createRequire(import.meta.url)("../src/session-data.js");
const HOUR = 3600000;
const PARTIAL = new Set(["source_unreadable", "log_truncated", "capped", "host_records_partly", "interval_outside_session_clock", "returns_not_fully_recorded"]);
const PARTIAL_WAITS = new Set(["host_records_partly", "interval_outside_session_clock"]);
const CATEGORIES = { shell: "commands", read: "reading", search: "reading", web: "reading", edit: "writing",
  agent: "helpers", skill: "notes", desk: "notes" };
const COVERED = ["commands", "reading", "writing", "helpers", "notes", "other", "stops", "captured"];
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = () => { throw new Error("session_input_invalid"); };

function reasons(facts, fields) {
  return [...new Set(sessionFlags(facts).filter((f) => fields.includes(f.field) && f.reason !== "session_open").map((f) => f.reason))].sort();
}
function hard(reasons) {
  return reasons.some((r) => !PARTIAL.has(r));
}
function number(value, flags, absent = "not_recorded") {
  if (hard(flags)) return unavailable(flags);
  if (value === undefined || value === null) return unavailable(flags.length ? flags : [absent]);
  if (!integer(value)) fail();
  return flags.length ? direct(partial(value, flags), "session_counter") : measured(value);
}
function items(value, flags, project) {
  if (hard(flags)) return { ...unavailable(flags), items: [] };
  if (value === undefined || value === null) return { ...unavailable(flags.length ? flags : ["not_recorded"]), items: [] };
  if (!Array.isArray(value)) fail();
  return { state: flags.length ? "partial" : "measured", reasons: flags, items: value.map(project) };
}
function identity(facts) {
  if (!object(facts) || !object(facts.session)) fail();
  if (facts.unavailable !== undefined && facts.unavailable !== null && (!Array.isArray(facts.unavailable) ||
      facts.unavailable.some((flag) => !object(flag) ||
        typeof flag.field !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(flag.field) ||
        typeof flag.reason !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(flag.reason)))) fail();
  const models = items(facts.models, reasons(facts, ["models"]), (m) => {
    if (!object(m) || typeof m.id !== "string") fail();
    return m.id;
  });
  return { id: facts.session.id, host: facts.session.host, ended: facts.session.ended, models: [...new Set(models.items)] };
}
function intervalsOf(facts, duration) {
  const flags = reasons(facts, ["intervals", "turns", "tool_durations", "agents"]);
  const result = items(facts.intervals, flags, (i) => {
    if (!object(i) || typeof i.kind !== "string" || !integer(i.start_ms) || !integer(i.end_ms) ||
        i.end_ms < i.start_ms || duration.state !== "unavailable" && i.end_ms > duration.value ||
        i.agent !== undefined && !integer(i.agent) || i.kind === "tool" && typeof i.tool !== "string") fail();
    return i;
  });
  if (!result.items.length && result.state !== "unavailable") return { ...unavailable(flags.length ? flags : ["no_intervals"]), items: [] };
  if (result.state === "unavailable" && !flags.length) result.reasons = ["no_intervals"];
  return result;
}
function coverage(intervals, selected, start = 0, end = Number.MAX_SAFE_INTEGER) {
  if (intervals.state === "unavailable") return unavailable(intervals.reasons);
  // Reuse the activity union for each selected set; these are coverage lanes,
  // not a partition, so stops and calls can overlap without adding to a total.
  const value = activeMs({ intervals: selected.map((i) => ({
    kind: "turn", start_ms: Math.max(start, i.start_ms), end_ms: Math.min(end, i.end_ms),
  })) });
  return number(value, intervals.reasons);
}
function workersOf(facts) {
  const modelFlags = reasons(facts, ["models"]);
  const result = items(facts.agents, reasons(facts, ["agents"]), (worker) => {
    if (!object(worker)) fail();
    return { n: worker.n, parent: worker.parent, model: hard(modelFlags) ? null : worker.model ?? null };
  });
  if (result.state !== "unavailable" && modelFlags.length) {
    result.state = "partial";
    result.reasons = [...new Set([...result.reasons, ...modelFlags])].sort();
  }
  return result;
}
function bindingsOf(facts) {
  const segmentReasons = [...new Set([
    ...reasons(facts, ["job_segments"]),
    ...reasons(facts, ["job_offsets"]).filter((r) => r === "desk_public"),
  ])].sort();
  return items(facts.jobs, reasons(facts, ["jobs"]), (binding) => {
    if (!object(binding)) fail();
    return {
      job: binding.job,
      agents: items(binding.agents, reasons(facts, ["job_agents"]), (n) => n),
      segments: items(binding.segments, segmentReasons, (s) => {
        if (!object(s)) fail();
        return { start_ms: s.start_ms, end_ms: s.end_ms };
      }),
    };
  });
}
function countsOf(facts) {
  if (facts.counts !== null && facts.counts !== undefined && !object(facts.counts)) fail();
  const counts = facts.counts || {};
  for (const key of ["tool_calls", "tool_failures"]) {
    const flags = reasons(facts, [key, "tool_durations", ...(key === "tool_failures" ? ["tool_outcomes"] : [])]);
    if (hard(flags) || counts[key] === null || counts[key] === undefined) continue;
    if (!object(counts[key]) || !Object.values(counts[key]).every(integer)) fail();
  }
  return counts;
}
function numbersOf(facts, duration, intervals, workers) {
  const counts = countsOf(facts);
  const featured = featuredNumbers(facts);
  const total = (key, base, extra = []) => {
    const flags = reasons(facts, [key, "tool_durations", "job_segments", ...extra]);
    if (hard(flags)) return unavailable(flags);
    if (base.state === "unavailable") return unavailable([...new Set([...flags, ...base.reasons])]);
    return number(base.value, [...new Set([...flags, ...base.reasons])].sort());
  };
  const roots = new Set(workers.items.filter((w) => w.parent === null).map((w) => w.n));
  const workerIds = new Set(workers.items.map((w) => w.n));
  const stops = intervals.items.filter((i) => i.kind === "human_wait" && roots.has(i.agent));
  const waitReasons = reasons(facts, ["human_waits"]);
  const stopReasons = [...new Set([...intervals.reasons, ...reasons(facts, ["agents"]), ...waitReasons])].sort();
  const unidentified = intervals.items.some((i) => i.kind === "human_wait" && !workerIds.has(i.agent));
  // Desk's wait-field flags remove the measure except for explicitly partial
  // capture or intervals dropped outside the session clock.
  const stopIntervals = workers.state === "unavailable" || !roots.size || unidentified || waitReasons.some((r) => !PARTIAL_WAITS.has(r))
    ? { ...unavailable(stopReasons.length ? stopReasons : ["not_recorded"]), items: [] }
    : { ...intervals, reasons: stopReasons };
  const activity = intervals.state === "unavailable" ? unavailable(intervals.reasons)
    : number(activeMs({ intervals: intervals.items }), intervals.reasons);
  return {
    numbers: {
      duration_ms: duration,
      activity_ms: activity,
      stop_ms: coverage(stopIntervals, stops),
      tool_calls: total("tool_calls", featured.tool_calls_total),
      tool_failures: total("tool_failures", featured.tool_failures_total, ["tool_outcomes"]),
      tool_retries: number(counts.tool_retries, reasons(facts, ["tool_retries", "tool_durations"])),
      compactions: number(counts.compactions, reasons(facts, ["compactions", "turns"])),
    },
    stops, stopIntervals,
  };
}
function binsOf(duration, intervals, stops, stopIntervals) {
  if (duration.state === "unavailable") return { resolution_ms: unavailable(duration.reasons), rows: [] };
  const resolution = Math.max(1, Math.ceil(duration.value / HOUR / 96)) * HOUR;
  const lanes = Object.fromEntries(COVERED.map((key) => [key, []]));
  lanes.captured = intervals.items;
  lanes.stops = stops;
  for (const i of intervals.items) {
    if (i.kind === "subagent") lanes.helpers.push(i);
    if (i.kind === "tool") lanes[Object.hasOwn(CATEGORIES, i.tool) ? CATEGORIES[i.tool] : "other"].push(i);
  }
  const rows = [];
  for (let start_ms = 0; start_ms < duration.value; start_ms += resolution) {
    const end_ms = Math.min(duration.value, start_ms + resolution);
    rows.push({ start_ms, end_ms, ...Object.fromEntries(COVERED.map((key) =>
      [key, coverage(key === "stops" ? stopIntervals : intervals, lanes[key], start_ms, end_ms)])) });
  }
  return { resolution_ms: measured(resolution), rows };
}
function outcomesOf(facts, bindings, jobs) {
  const recorded = items(facts.outcomes, reasons(facts, ["outcomes"]), (o) => {
    if (!object(o) || typeof o.job !== "string") fail();
    if (Object.hasOwn(o, "returns_truncated") && o.returns_truncated !== true ||
        Object.hasOwn(o, "returns_unreadable") && (!integer(o.returns_unreadable) || o.returns_unreadable < 1 || o.returns_unreadable > 9999)) fail();
    return o;
  });
  if (new Set(recorded.items.map((o) => o.job)).size !== recorded.items.length) fail();
  return bindings.items.map(({ job }) => {
    const summary = jobs.find((entry) => entry.id === job);
    const outcome = recorded.items.find((entry) => entry.job === job);
    const state = !outcome || outcome.state === "not_recorded"
      ? unavailable(recorded.reasons.length ? recorded.reasons : ["not_recorded"])
      : recorded.reasons.length ? direct(partial(outcome.state, recorded.reasons), "session_counter") : measured(outcome.state);
    const returnReasons = [...recorded.reasons];
    if (outcome?.returns_truncated === true || outcome?.returns_unreadable > 0) returnReasons.push("returns_not_fully_recorded");
    return {
      job, scope: "task", snapshot: { session: facts.session.id, rev: outcome?.rev ?? null },
      status: !summary || summary.status === undefined || summary.status === "unavailable" ? unavailable(["not_recorded"]) : measured(summary.status),
      state,
      returns: items(outcome?.returns, [...new Set(returnReasons)].sort(), (r) => {
        if (!object(r)) fail();
        return { caught: r.caught, counts: r.counts };
      }),
    };
  });
}
function sessionParts(facts) {
  const session = identity(facts);
  const duration = number(facts.session.duration_ms, reasons(facts, ["duration_ms"]));
  const intervals = intervalsOf(facts, duration);
  const workers = workersOf(facts);
  const bindings = bindingsOf(facts);
  const { numbers, stops, stopIntervals } = numbersOf(facts, duration, intervals, workers);
  return { session, numbers, workers, bindings, bins: binsOf(duration, intervals, stops, stopIntervals) };
}
export function buildSessionCatalog({ facts, sources }) {
  if (!Array.isArray(facts)) fail();
  const sessions = facts.map((fact) => {
    const { session, numbers, bindings } = sessionParts(fact);
    return { ...session, jobs: bindings.items.map((b) => b.job), duration_ms: numbers.duration_ms,
      activity_ms: numbers.activity_ms, detail: `sessions/${session.id}.json` };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const catalog = { schema: "factory-session-catalog/1", sources: structuredClone(sources), sessions };
  if (!validateSessionCatalog(catalog).ok) throw new Error("session_catalog_invalid");
  return catalog;
}
export function buildSessionDetail({ facts, contexts, jobs, sources }) {
  if (!(contexts instanceof Map) || !Array.isArray(jobs)) fail();
  const parts = sessionParts(facts);
  const detail = {
    schema: "factory-session-detail/1", sources: structuredClone(sources), ...parts,
    contexts: parts.bindings.items.map(({ job }) => contexts.has(job) ? structuredClone(contexts.get(job)) : projectTaskContext({ job, bytes: null })),
    outcomes: outcomesOf(facts, parts.bindings, jobs),
  };
  if (!validateSessionDetail(detail).ok) throw new Error("session_detail_invalid");
  return detail;
}
