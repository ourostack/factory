import assert from "node:assert/strict"
import { test } from "node:test"

import {
  THIN_SAMPLE_MIN,
  declareRollup,
  fromFormula,
  fromTotalsLeaf,
  measured,
  partial,
  rollup,
  trust,
  unavailable,
  useCaptureCoverage,
} from "../../../site/scripts/state.mjs"

test("a number always carries state, value and reasons", () => {
  assert.deepEqual(measured(0), { state: "measured", value: 0, reasons: [] })
  assert.deepEqual(partial(4, ["worker_split"]), { state: "partial", value: 4, reasons: ["worker_split"] })
  const none = unavailable(["host_does_not_record"])
  assert.deepEqual(none, { state: "unavailable", reasons: ["host_does_not_record"] })
  assert.equal("value" in none, false)
})

test("unavailable needs a reason, and a bare NaN is refused", () => {
  assert.deepEqual(unavailable().reasons, ["not_recorded"])
  assert.throws(() => measured(NaN))
  assert.throws(() => measured(null))
  assert.throws(() => measured(undefined))
})

test("fromFormula keeps the pipeline's own state and reasons", () => {
  assert.deepEqual(fromFormula({ class: "measured", value: 7 }), measured(7))
  assert.deepEqual(fromFormula({ class: "declared", value: 7 }), { ...measured(7), basis: "declared" })
  assert.deepEqual(
    fromFormula({ class: "measured", value: 7, partial: true, partial_reasons: ["worker_shared"] }),
    partial(7, ["worker_shared"]),
  )
  assert.deepEqual(fromFormula({ class: "inferred", value: 1, partial: true }), partial(1, ["partial"]))
  assert.deepEqual(
    fromFormula({ class: "unavailable", reason: "not_collected_in_slice_1", value: null }),
    unavailable(["not_collected_in_slice_1"]),
  )
})

test("fromFormula never turns an absent or null formula into a zero", () => {
  assert.deepEqual(fromFormula(undefined), unavailable(["not_recorded"]))
  assert.deepEqual(fromFormula({}), unavailable(["not_recorded"]))
  assert.deepEqual(fromFormula({ class: "measured", value: null }), unavailable(["not_recorded"]))
})

test("a censored value is partial: a lower bound is not a measurement", () => {
  const n = fromFormula({ class: "measured", value: 9, censored: true })
  assert.equal(n.state, "partial")
  assert.deepEqual(n.reasons, ["censored"])
})

test("rollup counts only measured members and carries n of N", () => {
  const r = rollup([measured(1), measured(3), partial(100, ["worker_shared"]), unavailable(["x"])], {
    of: "jobs", measure: "sum",
    reduce: (v) => v.reduce((a, b) => a + b, 0),
  })
  assert.equal(r.n, 2)
  assert.equal(r.N, 4)
  assert.equal(r.out_of_scope, 0)
  assert.equal(r.of, "jobs")
  assert.equal(r.value, 4)
  assert.equal(r.state, "partial")
  assert.deepEqual(r.excluded, { partial: 1, unavailable: 1 })
  assert.ok(r.reasons.includes("unmeasured_members"))
})

test("a rollup of all measured members is measured; of none is unavailable, never zero", () => {
  const all = rollup([measured(2), measured(4)], { of: "jobs", measure: "sum", reduce: (v) => v[0] })
  assert.equal(all.state, "measured")
  assert.equal(all.n, 2)
  assert.equal(all.N, 2)
  const none = rollup([unavailable(["a"]), unavailable(["b"])], { of: "jobs", measure: "sum", reduce: (v) => v[0] })
  assert.equal(none.state, "unavailable")
  assert.equal("value" in none, false)
  assert.equal(none.n, 0)
  assert.equal(none.N, 2)
  const empty = rollup([], { of: "jobs", measure: "sum", reduce: () => 0 })
  assert.equal(empty.state, "unavailable")
  assert.equal(empty.N, 0)
  assert.equal(empty.out_of_scope, 0)
})

test("a measured zero stays a measured zero", () => {
  const r = rollup([measured(0), measured(0)], { of: "jobs", measure: "sum", reduce: (v) => v[0] })
  assert.equal(r.state, "measured")
  assert.equal(r.value, 0)
})

test("trust: thin sample under the named constant, partial, ok; coverage never invented", () => {
  assert.equal(THIN_SAMPLE_MIN, 5)
  const mk = (n, N) =>
    rollup([...Array(n).fill(measured(1)), ...Array(N - n).fill(unavailable(["x"]))], { of: "jobs", measure: "sum", reduce: (v) => v[0] })
  assert.equal(trust(mk(4, 4)).status, "thin_sample")
  assert.equal(trust(mk(0, 3)).status, "thin_sample")
  assert.equal(trust(mk(5, 5)).status, "ok")
  const p = trust(mk(6, 9))
  assert.equal(p.status, "partial")
  assert.ok(p.reason.length > 0)
  const both = trust(mk(2, 9))
  assert.equal(both.status, "thin_sample")
  assert.ok(both.causes.includes("partial"))
  assert.deepEqual(trust(mk(5, 5)).coverage, { state: "unavailable", reasons: ["not_recorded_yet"] })
})

test("trust can take a coverage record without changing its callers", () => {
  const r = rollup(Array(6).fill(measured(1)), { of: "jobs", measure: "sum", reduce: (v) => v[0] })
  const low = trust(r, { coverage: { state: "measured", value: 0.2, reasons: [] } })
  assert.equal(low.status, "low_coverage")
})

test("a ratio of sums can carry an aux number through a rollup", () => {
  const r = rollup([{ ...measured(1), aux: 4 }, { ...measured(3), aux: 4 }, unavailable(["x"])], {
    of: "sessions", measure: "share",
    reduce: (v, ms) => v.reduce((a, b) => a + b, 0) / ms.reduce((a, m) => a + m.aux, 0),
  })
  assert.equal(r.value, 0.5)
  assert.equal(r.n, 2)
  assert.equal(r.N, 3)
})

test("a rollup declared by the pipeline keeps its own n of N and states itself", () => {
  assert.deepEqual(declareRollup({ measure: "sum", value: 5, n: 2, N: 3, of: "jobs" }).reasons, ["unmeasured_members"])
  assert.equal(declareRollup({ measure: "sum", value: 5, n: 3, N: 3, of: "jobs" }).state, "measured")
  assert.equal(declareRollup({ measure: "sum", value: 5, n: 2, N: 3, of: "jobs" }).state, "partial")
  const none = declareRollup({ measure: "sum", value: 0, n: 0, N: 3, of: "jobs" })
  assert.equal(none.state, "unavailable")
  assert.equal("value" in none, false)
  assert.equal(declareRollup({ measure: "sum", value: 5, n: 4, N: 3, of: "jobs" }).state, "unavailable")
  assert.equal(declareRollup({ measure: "sum", value: 0, n: 3, N: 3, of: "jobs" }).value, 0)
})

import { NOT_APPLICABLE_REASONS, isNotApplicable } from "../../../site/scripts/state.mjs"

test("members out of scope by design are not in N and are reported beside it", () => {
  const r = rollup(
    [measured(1), measured(3), unavailable(["outside_capture_scope"]), unavailable(["host_does_not_record"]), unavailable(["outside_capture_scope"])],
    { of: "finished jobs", measure: "median", reduce: (v) => v[0] },
  )
  assert.equal(r.N, 2)
  assert.equal(r.n, 2)
  assert.equal(r.out_of_scope, 3)
  assert.equal(r.state, "measured")
  assert.equal(r.kind, "rollup")
})

test("missing data inside scope stays in N and makes the figure partial", () => {
  const r = rollup([measured(1), unavailable(["job_offsets_unavailable"]), unavailable(["outside_capture_scope"])], { of: "jobs", measure: "sum", reduce: (v) => v[0] })
  assert.equal(r.N, 2)
  assert.equal(r.state, "partial")
  assert.equal(r.out_of_scope, 1)
})

test("an unavailable member with a mix of by-design and lost reasons is not out of scope", () => {
  assert.equal(isNotApplicable(unavailable(["outside_capture_scope", "log_truncated"])), false)
  assert.equal(isNotApplicable(unavailable(["host_does_not_record"])), true)
  assert.ok(NOT_APPLICABLE_REASONS.has("outside_capture_scope"))
})

test("all members out of scope: unavailable with N of zero", () => {
  const r = rollup([unavailable(["outside_capture_scope"])], { of: "jobs", measure: "sum", reduce: (v) => v[0] })
  assert.equal(r.state, "unavailable")
  assert.equal(r.N, 0)
  assert.equal(r.out_of_scope, 1)
})

// --- per-job report results carrying `state` and `reasons` (Desk contract section 2) ---

test("a result that carries state and reasons is read by its state, one per state", () => {
  assert.deepEqual(fromFormula({ class: "measured", reasons: [], state: "measured", value: 8000 }), measured(8000))
  assert.deepEqual(
    fromFormula({ class: "measured", partial: true, partial_reasons: ["host_records_partly"], reasons: ["host_records_partly"], state: "partial", uncovered_sessions: 1, value: 0 }),
    partial(0, ["host_records_partly"]),
  )
  assert.deepEqual(
    fromFormula({ class: "unavailable", reason: "host_does_not_record", reasons: ["host_does_not_record"], state: "unavailable", value: null }),
    unavailable(["host_does_not_record"]),
  )
})

test("a censored result reads partial with censored among its reasons", () => {
  const n = fromFormula({ basis: "latest_session_end", censored: true, class: "measured", reasons: ["censored"], state: "partial", value: 12 })
  assert.equal(n.state, "partial")
  assert.deepEqual(n.reasons, ["censored"])
})

test("mixed is never shown: the real causes come from reasons", () => {
  const n = fromFormula({ class: "unavailable", reason: "mixed", reasons: ["field_absent", "worker_split"], state: "unavailable", value: null })
  assert.deepEqual(n.reasons, ["field_absent", "worker_split"])
})

test("a stated result that contradicts itself never becomes a measured figure", () => {
  assert.equal(fromFormula({ class: "unavailable", reasons: [], state: "measured", value: 3 }).state, "unavailable")
  assert.deepEqual(fromFormula({ class: "measured", reasons: [], state: "measured", value: null }), unavailable(["not_recorded"]))
  assert.deepEqual(fromFormula({ class: "measured", reasons: ["capped"], state: "measured", value: 4 }), partial(4, ["capped"]))
  assert.deepEqual(fromFormula({ class: "measured", reasons: [], state: "partial", value: 4 }), partial(4, ["partial"]))
})

test("a declared result keeps its basis when read by state", () => {
  assert.deepEqual(fromFormula({ class: "declared", reasons: [], state: "measured", value: 7 }), { ...measured(7), basis: "declared" })
})

// --- rollups/totals.json leaves and tool-kind rows (Desk contract section 3) ---

test("a totals leaf becomes a rollup with its n of N, one per state", () => {
  assert.deepEqual(fromTotalsLeaf({ N: 10, n: 10, reasons: [], state: "measured", value: 10 }, "published sessions"), {
    state: "measured", value: 10, reasons: [], kind: "rollup", n: 10, N: 10, of: "published sessions", out_of_scope: 0,
  })
  assert.deepEqual(fromTotalsLeaf({ N: 249, n: 174, reasons: ["field_absent"], state: "partial", value: 78283 }, "published sessions"), {
    state: "partial", value: 78283, reasons: ["field_absent"], bound: "lower", kind: "rollup", n: 174, N: 249, of: "published sessions", out_of_scope: 0,
  })
  const none = fromTotalsLeaf({ N: 10, n: 0, reasons: ["field_absent"], state: "unavailable" }, "published sessions")
  assert.equal(none.state, "unavailable")
  assert.equal("value" in none, false)
  assert.deepEqual(none.reasons, ["field_absent"])
})

test("a totals leaf counted only from sessions the host records partly is a lower bound with n of zero", () => {
  const n = fromTotalsLeaf({ N: 3, n: 0, reasons: ["host_records_partly"], state: "partial", value: 40 }, "published sessions")
  assert.equal(n.state, "partial")
  assert.equal(n.value, 40)
  assert.equal(n.n, 0)
  assert.equal(n.bound, "lower")
})

test("a totals leaf that is malformed or contradicts itself is no data, never a zero", () => {
  for (const bad of [
    null,
    { N: 3, n: 4, reasons: [], state: "measured", value: 1 },
    { N: 3, n: 3, reasons: [], state: "measured" },
    { N: 3, n: 1, reasons: [], state: "measured", value: 1 },
    { N: 3, n: 0, reasons: ["field_absent"], state: "partial", value: 1 },
    { N: 3, n: 3, reasons: ["x"], state: "measured", value: 1 },
    { N: 3, n: 1, reasons: ["x"], state: "partial", value: NaN },
    { n: 1, reasons: [], state: "measured", value: 1 },
  ]) {
    const n = fromTotalsLeaf(bad, "published sessions")
    assert.equal(n.state, "unavailable", JSON.stringify(bad))
    assert.equal("value" in n, false)
    assert.equal(n.kind, "rollup")
  }
  const empty = fromTotalsLeaf({ N: 0, n: 0, reasons: ["no_sessions"], state: "unavailable" }, "published sessions")
  assert.deepEqual(empty.reasons, ["no_sessions"])
})

test("a rollup with no measured member never repeats a member's lower-bound reason; partly recorded members get a rollup-only reason", () => {
  const median = rollup(
    [partial(10, ["host_records_partly"]), partial(20, ["host_records_partly"]), unavailable(["status_unavailable"])],
    { of: "finished jobs", measure: "median", reduce: (v) => v[0] },
  )
  assert.equal(median.state, "unavailable")
  assert.ok(!("value" in median))
  assert.ok(!median.reasons.includes("host_records_partly"))
  assert.ok(median.reasons.includes("only_partly_recorded"))
  assert.ok(median.reasons.includes("status_unavailable"))
  assert.deepEqual(median.excluded, { partial: 2, unavailable: 1 })
  // A partial rollup (some members measured) keeps its members' reasons: it
  // shows a figure, and the figure is partial for those reasons.
  const some = rollup([measured(5), partial(10, ["host_records_partly"])], { of: "finished jobs", measure: "median", reduce: (v) => v[0] })
  assert.equal(some.state, "partial")
  assert.ok(some.reasons.includes("host_records_partly"))
})

test("the default coverage every trust state reads is the capture share the build sets", () => {
  useCaptureCoverage({ state: "partial", value: 0.3, reasons: ["unverified_host"] })
  try {
    const t = trust({ state: "measured", n: 10, N: 10 })
    assert.equal(t.status, "low_coverage")
  } finally {
    useCaptureCoverage(null)
  }
  assert.deepEqual(trust({ state: "measured", n: 10, N: 10 }).coverage.reasons, ["not_recorded_yet"])
})
