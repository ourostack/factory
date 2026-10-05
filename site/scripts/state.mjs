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

// Fewer measured members than this and a headline is a thin sample. One
// constant, so changing the threshold changes it everywhere.
export const THIN_SAMPLE_MIN = 5;

// Extension point for capture coverage. Per-host capture coverage will arrive
// as its own published record (a `measured` share between 0 and 1). Until it
// does, no coverage is claimed: the headline says "not recorded yet", never
// 100% and never 0%.
export const LOW_COVERAGE_BELOW = 0.5;
export const COVERAGE_NOT_RECORDED = Object.freeze({
  state: "unavailable",
  reasons: ["not_recorded_yet"],
});

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

// The pipeline's own envelope for one formula: `class` (measured, inferred,
// declared, unavailable), `partial` with `partial_reasons`, `censored`, and
// `reason` when unavailable. Absent, empty or null is not a zero: it is
// unavailable with the reason `not_recorded`.
export function fromFormula(f) {
  if (!f || typeof f !== "object") return unavailable(["not_recorded"]);
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
export function rollup(members, { of, reduce }) {
  const list = Array.isArray(members) ? members : [];
  const usable = list.filter((m) => m && m.state === "measured");
  const excluded = {};
  const reasons = new Set();
  for (const m of list) {
    if (m && m.state !== "measured") {
      const key = m?.state ?? "unavailable";
      excluded[key] = (excluded[key] || 0) + 1;
      for (const r of m?.reasons ?? []) reasons.add(r);
    }
  }
  const base = { n: usable.length, N: list.length, of };
  if (list.length === 0) return { ...unavailable(["no_members"]), ...base };
  if (usable.length === 0) {
    return { ...unavailable(["no_measured_members", ...reasons]), ...base, excluded };
  }
  const value = reduce(usable.map((m) => m.value), usable);
  if (!(typeof value === "number" && Number.isFinite(value)) && typeof value !== "string") {
    return { ...unavailable(["no_measured_members"]), ...base, excluded };
  }
  if (usable.length < list.length) {
    return { state: "partial", value, reasons: ["unmeasured_members", ...reasons], ...base, excluded };
  }
  return { state: "measured", value, reasons: [], ...base };
}

// Trust state for a headline: `ok`, `thin_sample`, `partial`, or (once a
// coverage record exists) `low_coverage`. `reasons` lists every cause that
// applies; `status` is the first that does, in that order of severity.
export function trust(headline, { coverage = COVERAGE_NOT_RECORDED } = {}) {
  const n = Number.isInteger(headline?.n) ? headline.n : headline?.state === "measured" ? 1 : 0;
  const N = Number.isInteger(headline?.N) ? headline.N : n;
  const causes = [];
  if (coverage?.state === "measured" && typeof coverage.value === "number" && coverage.value < LOW_COVERAGE_BELOW) {
    causes.push("low_coverage");
  }
  if (n < THIN_SAMPLE_MIN) causes.push("thin_sample");
  if (n < N || headline?.state === "partial") causes.push("partial");
  const status = causes[0] ?? "ok";
  const text = {
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
export function declareRollup({ value, n, N, of, reasons = [] }) {
  if (!Number.isInteger(n) || !Number.isInteger(N) || n < 0 || n > N) {
    return { ...unavailable(["no_members"]), n: 0, N: Number.isInteger(N) && N >= 0 ? N : 0, of };
  }
  const base = { n, N, of };
  const ok = (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
  if (n === 0 || !ok) return { ...unavailable(["no_measured_members", ...reasons]), ...base };
  if (n < N) return { state: "partial", value, reasons: ["unmeasured_members", ...reasons], ...base };
  return { state: "measured", value, reasons: [], ...base };
}
