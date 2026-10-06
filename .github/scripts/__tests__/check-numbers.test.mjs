import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { measured, rollup, unavailable } from "../../../site/scripts/state.mjs"

const good = () => ({
  schema: "factory-site/3",
  config: { thin_sample_min: 5 },
  jobs: [{ id: "a", status: "done", lead_time_ms: measured(5), active_time_ms: unavailable(["log_missing"]) }],
  time_breakdown: [{ key: "k", median: rollup([measured(1), measured(2)], { of: "jobs", measure: "sum", reduce: (v) => v[0] }) }],
  headline: rollup([measured(1), measured(2)], { of: "jobs", measure: "sum", reduce: (v) => v[0] }),
  takeaways: [{ id: "t", template: "Of {a} sessions", numbers: { a: measured(3) } }],
})
const codes = (d) => checkNumbers(d).map((v) => v.code)

test("a well-formed document passes", () => {
  assert.deepEqual(checkNumbers(good()), [])
})

test("a bare number outside config is refused", () => {
  const d = good()
  d.jobs[0].lead_time_ms = 5
  assert.ok(codes(d).includes("bare_number"))
})

test("a null standing for a value is refused", () => {
  const d = good()
  d.jobs[0].active_time_ms = null
  assert.ok(codes(d).includes("null_value"))
})

test("NaN and Infinity are refused", () => {
  const d = good()
  d.jobs[0].lead_time_ms = { state: "measured", value: NaN, reasons: [] }
  assert.ok(codes(d).includes("non_finite"))
})

test("a number without a valid state, or without reasons, is refused", () => {
  const d = good()
  d.jobs[0].lead_time_ms = { value: 5, reasons: [] }
  d.jobs[0].active_time_ms = { state: "kinda", value: 5, reasons: [] }
  const c = codes(d)
  assert.ok(c.includes("missing_state"))
  assert.ok(c.includes("bad_state"))
  const e = good()
  e.jobs[0].lead_time_ms = { state: "measured", value: 5 }
  assert.ok(codes(e).includes("missing_reasons"))
})

test("unavailable must not carry a value; measured and partial must", () => {
  const d = good()
  d.jobs[0].active_time_ms = { state: "unavailable", value: 0, reasons: ["log_missing"] }
  d.jobs[0].lead_time_ms = { state: "partial", reasons: ["capped"] }
  const c = codes(d)
  assert.ok(c.includes("value_on_unavailable"))
  assert.ok(c.includes("missing_value"))
})

test("a rollup must carry n, N and what it counts, and n cannot exceed N", () => {
  const d = good()
  d.headline = { state: "measured", value: 3, reasons: [], kind: "rollup", n: 2 }
  assert.ok(codes(d).includes("rollup_missing_n"))
  const e = good()
  e.headline = { state: "measured", value: 3, reasons: [], kind: "rollup", n: 3, N: 2, of: "jobs", out_of_scope: 0 }
  assert.ok(codes(e).includes("rollup_n_exceeds_N"))
  const f = good()
  f.headline = { state: "measured", value: 3, reasons: [], kind: "rollup", n: 1, N: 2, of: "jobs", out_of_scope: 0 }
  assert.ok(codes(f).includes("rollup_state_mismatch"))
})

test("a sentence template holds no digits: numbers go through slots", () => {
  const d = good()
  d.takeaways[0].template = "Of 12 sessions"
  assert.ok(codes(d).includes("digits_in_text"))
})

test("the CLI exits non-zero on a bad data.json, and on a null in the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-numbers-"))
  const ok = join(dir, "ok.json")
  writeFileSync(ok, JSON.stringify(good()))
  const script = new URL("../../../site/scripts/check-numbers.mjs", import.meta.url).pathname
  assert.equal(spawnSync("node", [script, ok]).status, 0)
  const bad = join(dir, "bad.json")
  const d = good()
  d.jobs[0].lead_time_ms = { state: "measured", value: NaN, reasons: [] }
  writeFileSync(bad, JSON.stringify(d))
  const r = spawnSync("node", [script, bad])
  assert.equal(r.status, 1)
  assert.match(String(r.stderr), /null_value/)
})

// ---- the reviewer's bypass cases: each must fail the check ----

test("a rollup path that lost its n, N and kind is refused", () => {
  const d = good()
  d.time_breakdown[0].median = { state: "measured", value: 3, reasons: [] }
  assert.ok(codes(d).includes("rollup_expected"))
})

test("a rollup must carry out_of_scope too", () => {
  const d = good()
  delete d.headline.out_of_scope
  assert.ok(codes(d).includes("rollup_missing_n"))
  const e = good()
  delete e.time_breakdown[0].median.kind
  assert.ok(codes(e).length > 0)
})

test("a bare number or NaN nested inside a stated node is refused", () => {
  const d = good()
  d.jobs[0].lead_time_ms = { ...measured(5), extra: 7 }
  assert.ok(codes(d).includes("unknown_key"))
  const e = good()
  e.jobs[0].lead_time_ms = { ...measured(5), bound: { x: NaN } }
  assert.ok(codes(e).length > 0)
})

test("strings standing for missing values are refused anywhere", () => {
  for (const bad of ["NaN", "null", "undefined", "", "0", "12.5", "Infinity", "-Infinity", " 12 ", "1e3", "0x10", "\u0661\u0662", "+5", " ", "\t"]) {
    const d = good()
    d.jobs[0].lead_time_ms = { state: "measured", value: bad, reasons: [] }
    assert.ok(codes(d).length > 0, JSON.stringify(bad))
    const e = good()
    e.jobs[0].status = bad
    assert.ok(codes(e).length > 0, "plain " + JSON.stringify(bad))
  }
})

test("measured with any reason, partial without one, and unavailable with a hidden zero are refused", () => {
  const d = good()
  d.jobs[0].lead_time_ms = { state: "measured", value: 5, reasons: ["not_recorded"] }
  assert.ok(codes(d).includes("measured_with_reasons"))
  const e = good()
  e.jobs[0].lead_time_ms = { state: "partial", value: 5, reasons: [] }
  assert.ok(codes(e).includes("missing_reasons"))
  const f = good()
  f.jobs[0].active_time_ms = { state: "unavailable", reasons: ["log_missing"], zero: 0 }
  assert.ok(codes(f).includes("unknown_key"))
})

test("an empty object where a number belongs is refused", () => {
  const d = good()
  d.jobs[0].lead_time_ms = {}
  assert.ok(codes(d).length > 0)
  const e = good()
  e.time_breakdown[0].median = {}
  assert.ok(codes(e).includes("rollup_expected"))
})

// --- every reason has words; lower-bound totals; the job page ---

test("a reason that has no plain text fails the build", () => {
  const d = good()
  d.jobs[0].active_time_ms = unavailable(["a_reason_with_no_words"])
  assert.ok(codes(d).includes("reason_without_text"))
  d.jobs[0].active_time_ms = unavailable(["host_records_partly"])
  assert.deepEqual(codes(d), [])
})

test("a total counted only from partly recorded sessions may be partial with n of zero; otherwise n of zero is no data", () => {
  const d = good()
  d.headline = { kind: "rollup", state: "partial", value: 40, reasons: ["host_records_partly"], bound: "lower", n: 0, N: 3, of: "published sessions", out_of_scope: 0 }
  assert.deepEqual(codes(d), [])
  d.headline = { kind: "rollup", state: "partial", value: 40, reasons: ["field_absent"], n: 0, N: 3, of: "published sessions", out_of_scope: 0 }
  assert.ok(codes(d).includes("rollup_state_mismatch"))
  d.headline = { kind: "rollup", state: "partial", reasons: ["field_absent"], n: 1, N: 3, of: "published sessions", out_of_scope: 0 }
  assert.ok(codes(d).includes("missing_value"))
})

test("a measure on the job page must be a stated number", () => {
  const d = good()
  d.jobs[0].details = [{ key: "tokens_total", label: "Tokens", kind: "compact", number: 12 }]
  assert.ok(codes(d).includes("number_expected") || codes(d).includes("bare_number"))
  d.jobs[0].details = [{ key: "tokens_total", label: "Tokens", kind: "compact", number: {} }]
  assert.ok(codes(d).includes("number_expected"))
  d.jobs[0].details = [{ key: "tokens_total", label: "Tokens", kind: "compact", number: measured(12) }]
  assert.deepEqual(codes(d), [])
})

test("every partial number says which way it lies; a whole number carries no bound", () => {
  const d = good()
  d.jobs[0].lead_time_ms = { state: "partial", value: 5, reasons: ["censored"] }
  assert.ok(codes(d).includes("partial_without_direction"))
  d.jobs[0].lead_time_ms = { state: "partial", value: 5, reasons: ["censored"], bound: "unknown" }
  assert.deepEqual(codes(d), [])
  d.jobs[0].lead_time_ms = { state: "measured", value: 5, reasons: [], bound: "lower" }
  assert.ok(codes(d).includes("bound_on_whole_number"))
})

test("the numbers check fails a build whose outcome figure has no state or no n of N", () => {
  const c = codes({ outcomes: { signoff: { accepted: 2 }, unsigned: measured(1), first_pass_yield: 0.75 }, jobs: [{ id: "a", signoff: "accepted" }] })
  assert.ok(c.includes("bare_number"))
  assert.ok(c.includes("rollup_expected"))
  assert.ok(c.includes("number_expected"))
})

test("the numbers check fails a headline that has a value and zero accepted outcomes", () => {
  const headline = { state: "measured", value: 60000, reasons: [], kind: "rollup", n: 1, N: 1, of: "accepted outcomes", out_of_scope: 0 }
  const d = { outcomes: { signoff: { accepted: measured(0) }, attention: { headline } } }
  assert.ok(codes(d).includes("value_without_accepted_outcome"))
  d.outcomes.signoff.accepted = measured(1)
  assert.deepEqual(checkNumbers(d), [])
})
