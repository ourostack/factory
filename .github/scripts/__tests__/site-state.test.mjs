import assert from "node:assert/strict"
import { test } from "node:test"

import {
  THIN_SAMPLE_MIN,
  fromFormula,
  measured,
  partial,
  rollup,
  trust,
  unavailable,
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
  assert.deepEqual(fromFormula({ class: "declared", value: 7 }), measured(7))
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
    of: "jobs",
    reduce: (v) => v.reduce((a, b) => a + b, 0),
  })
  assert.equal(r.n, 2)
  assert.equal(r.N, 4)
  assert.equal(r.of, "jobs")
  assert.equal(r.value, 4)
  assert.equal(r.state, "partial")
  assert.deepEqual(r.excluded, { partial: 1, unavailable: 1 })
  assert.ok(r.reasons.includes("unmeasured_members"))
})

test("a rollup of all measured members is measured; of none is unavailable, never zero", () => {
  const all = rollup([measured(2), measured(4)], { of: "jobs", reduce: (v) => v[0] })
  assert.equal(all.state, "measured")
  assert.equal(all.n, 2)
  assert.equal(all.N, 2)
  const none = rollup([unavailable(["a"]), unavailable(["b"])], { of: "jobs", reduce: (v) => v[0] })
  assert.equal(none.state, "unavailable")
  assert.equal("value" in none, false)
  assert.equal(none.n, 0)
  assert.equal(none.N, 2)
  const empty = rollup([], { of: "jobs", reduce: () => 0 })
  assert.equal(empty.state, "unavailable")
  assert.equal(empty.N, 0)
})

test("a measured zero stays a measured zero", () => {
  const r = rollup([measured(0), measured(0)], { of: "jobs", reduce: (v) => v[0] })
  assert.equal(r.state, "measured")
  assert.equal(r.value, 0)
})

test("trust: thin sample under the named constant, partial, ok; coverage never invented", () => {
  assert.equal(THIN_SAMPLE_MIN, 5)
  const mk = (n, N) =>
    rollup([...Array(n).fill(measured(1)), ...Array(N - n).fill(unavailable(["x"]))], { of: "jobs", reduce: (v) => v[0] })
  assert.equal(trust(mk(4, 4)).state, "thin_sample")
  assert.equal(trust(mk(0, 3)).state, "thin_sample")
  assert.equal(trust(mk(5, 5)).state, "ok")
  const p = trust(mk(6, 9))
  assert.equal(p.state, "partial")
  assert.ok(p.reason.length > 0)
  const both = trust(mk(2, 9))
  assert.equal(both.state, "thin_sample")
  assert.ok(both.reasons.includes("partial"))
  assert.deepEqual(trust(mk(5, 5)).coverage, { state: "unavailable", reasons: ["not_recorded_yet"] })
})

test("trust can take a coverage record without changing its callers", () => {
  const r = rollup(Array(6).fill(measured(1)), { of: "jobs", reduce: (v) => v[0] })
  const low = trust(r, { coverage: { state: "measured", value: 0.2, reasons: [] } })
  assert.equal(low.state, "low_coverage")
})
