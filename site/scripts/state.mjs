// A number travels with its state. Everything the site shows is one of these:
//   { state: "measured" | "partial" | "unavailable", value?, reasons: [...] }
// `value` is absent when the state is `unavailable`: there is no zero to fall
// back to. A constructor refuses a value that is not a finite number or a
// string, so a NaN, a null or an undefined cannot become a "measured" figure.
//
// A rollup (sum, median, share) is a number that also carries `n` of `N`: how
// many members were measured out of how many there are, and what it counts
// (`of`). Only measured members enter it; a partial or unavailable member is
// listed under `excluded`, and a rollup with any unmeasured member is partial.

import { direct } from "./bounds.mjs";

// Fewer measured members than this and a headline is a thin sample. One
// constant, so changing the threshold changes it everywhere.
export const THIN_SAMPLE_MIN = 5;

// Capture coverage: the share of sessions still on disk that were captured,
// summed from the machines' capture records (capture-coverage.mjs). With no
// record, no coverage is claimed: the headline says "not recorded yet", never
// 100% and never 0%.
export const LOW_COVERAGE_BELOW = 0.5;
export const COVERAGE_NOT_RECORDED = Object.freeze({
  state: "unavailable",
  reasons: ["not_recorded_yet"],
});

// Reasons that mean "this measure does not apply here, by design", not "the
// data was lost". A member unavailable only for these reasons is not in a
// rollup's N; it is counted beside it as `out_of_scope`. Missing data inside
// scope stays in N and makes the figure partial. One named set.
export const NOT_APPLICABLE_REASONS = new Set(["outside_capture_scope", "host_does_not_record"]);

export function isNotApplicable(member) {
  return (
    member?.state === "unavailable" &&
    Array.isArray(member.reasons) &&
    member.reasons.length > 0 &&
    member.reasons.every((r) => NOT_APPLICABLE_REASONS.has(r))
  );
}

function checkValue(value) {
  const ok = (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
  if (!ok) throw new TypeError(`a measured or partial number needs a finite value, got ${String(value)}`);
}

export function measured(value) {
  checkValue(value);
  return { state: "measured", value, reasons: [] };
}

export function partial(value, reasons = ["partial"]) {
  checkValue(value);
  return { state: "partial", value, reasons: reasons.length ? [...reasons] : ["partial"] };
}

export function unavailable(reasons = ["not_recorded"]) {
  return { state: "unavailable", reasons: reasons.length ? [...reasons] : ["not_recorded"] };
}

const STATES = new Set(["measured", "partial", "unavailable"]);

function isValue(v) {
  return (typeof v === "number" && Number.isFinite(v)) || typeof v === "string";
}

function reasonList(reasons) {
  return [...new Set((Array.isArray(reasons) ? reasons : []).filter((r) => typeof r === "string" && r))].sort();
}

// A result from a report that carries its own `state` and `reasons` (Desk's
// per-job report since published facts /2). The state is read first; the
// value only when the state allows one. A result that contradicts itself
// (unavailable class, a measured state without a value, a measured state
// with reasons) never becomes a plain measured figure.
function fromStated(f) {
  const reasons = reasonList(f.reasons);
  if (f.state === "unavailable" || f.class === "unavailable") {
    return unavailable(reasons.length ? reasons : ["not_recorded"]);
  }
  if (!isValue(f.value)) return unavailable(["not_recorded"]);
  if (f.state === "partial" || reasons.length > 0) return partial(f.value, reasons.length ? reasons : ["partial"]);
  if (f.class === "declared") return { ...measured(f.value), basis: "declared" };
  return measured(f.value);
}

// The pipeline's own envelope for one formula. A current report carries
// `state` and `reasons` and is read by them (`mixed` appears only as
// `reason`; the real causes are in `reasons`). An older report has only
// `class` (measured, inferred, declared, unavailable), `partial` with
// `partial_reasons`, `censored`, and `reason` when unavailable. Absent,
// empty or null is not a zero: it is unavailable with the reason
// `not_recorded`.
export function fromFormula(f) {
  if (!f || typeof f !== "object") return unavailable(["not_recorded"]);
  if (STATES.has(f.state) && Array.isArray(f.reasons)) return fromStated(f);
  if (f.class === "unavailable") {
    return unavailable([typeof f.reason === "string" && f.reason ? f.reason : "not_recorded"]);
  }
  const v = f.value;
  if (!((typeof v === "number" && Number.isFinite(v)) || typeof v === "string")) {
    return unavailable(["not_recorded"]);
  }
  const reasons = Array.isArray(f.partial_reasons) ? f.partial_reasons.filter((r) => typeof r === "string") : [];
  if (f.partial === true || reasons.length > 0) return partial(v, reasons);
  // A censored value is a lower bound on something still running; it is not
  // a measurement of the finished quantity.
  if (f.censored === true) return partial(v, ["censored"]);
  // `declared` (taken from a task card, not measured from a session) keeps
  // its evidence class so the page can say so.
  if (f.class === "declared") return { ...measured(v), basis: f.class };
  return measured(v);
}

// Attach a direction to a bound ("lower" or "upper"). The number keeps its
// state; the bound only says which way the true figure lies.
export function withBound(number, bound) {
  return number.state === "unavailable" ? number : { ...number, bound };
}

// Build a rollup over `members` (numbers with a state). `reduce` receives the
// values of the measured members only, and the members themselves as a second
// argument (a member may carry an `aux` number for a ratio of sums).
export function rollup(members, { of, reduce, measure }) {
  const all = Array.isArray(members) ? members : [];
  const outOfScope = all.filter(isNotApplicable).length;
  const list = all.filter((m) => !isNotApplicable(m));
  const usable = list.filter((m) => m && m.state === "measured");
  const excluded = {};
  const reasons = new Set();
  const lostReasons = new Set();
  for (const m of list) {
    if (m && m.state !== "measured") {
      const key = m?.state ?? "unavailable";
      excluded[key] = (excluded[key] || 0) + 1;
      for (const r of m?.reasons ?? []) {
        reasons.add(r);
        if (key !== "partial") lostReasons.add(r);
      }
    }
  }
  const base = { kind: "rollup", n: usable.length, N: list.length, of, out_of_scope: outOfScope };
  direct(measured(0), measure);
  if (list.length === 0) return { ...unavailable(["no_applicable_members"]), ...base };
  if (usable.length === 0) {
    // No figure is shown, so a partial member's own reasons ("the figure is
    // a lower bound") would contradict "no data". They are replaced by one
    // rollup-only reason that says why nothing was combined.
    const partly = excluded.partial ? ["only_partly_recorded"] : [];
    return { ...unavailable(["no_measured_members", ...lostReasons, ...partly]), ...base, excluded };
  }
  // The measure is known up front: a rollup with no direction cannot be built.
  direct(measured(0), measure);
  const value = reduce(usable.map((m) => m.value), usable);
  if (!(typeof value === "number" && Number.isFinite(value)) && typeof value !== "string") {
    return { ...unavailable(["no_measured_members"]), ...base, excluded };
  }
  if (usable.length < list.length) {
    return direct({ state: "partial", value, reasons: ["unmeasured_members", ...reasons], ...base, excluded }, measure);
  }
  return direct({ state: "measured", value, reasons: [], ...base }, measure);
}

// Trust state for a headline: `ok`, `thin_sample`, `partial`, `coverage_unknown` (the
// capture coverage could not be computed) or (once a coverage record exists)
// `low_coverage`. `reasons` lists every cause that
// applies; `status` is the first that does, in that order of severity.
// `coverage` is the capture share the trust state rests on; the site build
// passes it to every call. Without one it reads "not recorded yet".
export function trust(headline, { coverage = COVERAGE_NOT_RECORDED } = {}) {
  const n = Number.isInteger(headline?.n) ? headline.n : headline?.state === "measured" ? 1 : 0;
  const N = Number.isInteger(headline?.N) ? headline.N : n;
  const causes = [];
  // Coverage that could not be computed (anything but a measured or partial
  // record, or the plain "not recorded yet") is not "ok": it is not measured.
  const notRecordedYet = coverage?.state === "unavailable" && Array.isArray(coverage.reasons) && coverage.reasons.length === 1 && coverage.reasons[0] === "not_recorded_yet";
  const known = coverage?.state === "measured" || coverage?.state === "partial";
  if (!known && !notRecordedYet && coverage !== undefined) causes.push("coverage_unknown");
  if ((coverage?.state === "measured" || coverage?.state === "partial") && typeof coverage.value === "number" && coverage.value < LOW_COVERAGE_BELOW) {
    causes.push("low_coverage");
  }
  if (n < THIN_SAMPLE_MIN) causes.push("thin_sample");
  if (n < N || headline?.state === "partial") causes.push("partial");
  const status = causes[0] ?? "ok";
  const text = {
    coverage_unknown: `capture coverage not measured${Array.isArray(coverage?.reasons) && coverage.reasons.length ? ` (${coverage.reasons.join(", ")})` : ""}`,
    low_coverage: "capture coverage is low",
    thin_sample: `only ${n} measured (fewer than ${THIN_SAMPLE_MIN})`,
    partial: `${n} of ${N} measured`,
  };
  const reason = status === "ok" ? `${n} of ${N} measured` : causes.map((r) => text[r]).join("; ");
  return { status, reason, causes, coverage };
}

// A rollup the pipeline already computed, with its own n of N (for example a
// waste total over the jobs that are fully labeled). `n` of `N` must be
// integers with n <= N.
export function declareRollup({ value, n, N, of, measure, reasons = [], outOfScope = 0 }) {
  direct(measured(0), measure);
  if (!Number.isInteger(n) || !Number.isInteger(N) || n < 0 || n > N) {
    return {
      ...unavailable(["no_members"]),
      kind: "rollup",
      n: 0,
      N: Number.isInteger(N) && N >= 0 ? N : 0,
      of,
      out_of_scope: outOfScope,
    };
  }
  const base = { kind: "rollup", n, N, of, out_of_scope: outOfScope };
  const ok = (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
  if (n === 0 || !ok) return { ...unavailable(["no_measured_members", ...reasons]), ...base };
  if (n < N) return direct({ state: "partial", value, reasons: ["unmeasured_members", ...reasons], ...base }, measure);
  return { state: "measured", value, reasons: [], ...base };
}

// A leaf of the pipeline's `rollups/totals.json`, or a tool-kind row's
// counts: `{ state, value?, n, N, reasons }` over sessions. Its rule, from
// Desk: measured when n === N, partial when a value exists and n < N,
// unavailable when no session supplied a count. A partial value sums the
// counted sessions plus, as a lower bound, sessions the host records only
// partly, so a partial total can have n of zero only for that reason. A leaf
// that breaks the rule, or is malformed, is no data: never a zero.
export function fromTotalsLeaf(leaf, of) {
  const base = { kind: "rollup", of, out_of_scope: 0 };
  const okCounts =
    leaf && typeof leaf === "object" && Number.isInteger(leaf.n) && Number.isInteger(leaf.N) && leaf.n >= 0 && leaf.n <= leaf.N;
  const N = okCounts ? leaf.N : Number.isInteger(leaf?.N) && leaf.N >= 0 ? leaf.N : 0;
  const broken = { ...unavailable(["not_recorded"]), ...base, n: 0, N };
  if (!okCounts || !STATES.has(leaf.state) || !Array.isArray(leaf.reasons)) return broken;
  const reasons = reasonList(leaf.reasons);
  const has = "value" in leaf && leaf.value !== undefined;
  if (has && !(typeof leaf.value === "number" && Number.isFinite(leaf.value))) return broken;
  const want = leaf.N > 0 && leaf.n === leaf.N ? "measured" : has ? "partial" : "unavailable";
  if (leaf.state !== want) return broken;
  if (want === "measured") {
    if (reasons.length || !has) return broken;
    return { ...measured(leaf.value), ...base, n: leaf.n, N: leaf.N };
  }
  if (!reasons.length) return broken;
  if (want === "partial") {
    if (leaf.n === 0 && !reasons.includes("host_records_partly")) return broken;
    return direct({ ...partial(leaf.value, reasons), ...base, n: leaf.n, N: leaf.N }, "pipeline_total");
  }
  return { ...unavailable(reasons), ...base, n: leaf.n, N: leaf.N };
}
