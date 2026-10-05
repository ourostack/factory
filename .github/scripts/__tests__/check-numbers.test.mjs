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
  jobs: [{ id: "a", status: "done", lead_time_ms: measured(5), active_time_ms: unavailable(["x"]) }],
  headline: rollup([measured(1), measured(2)], { of: "jobs", reduce: (v) => v[0] }),
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
  d.jobs[0].active_time_ms = { state: "unavailable", value: 0, reasons: ["x"] }
  d.jobs[0].lead_time_ms = { state: "partial", reasons: ["y"] }
  const c = codes(d)
  assert.ok(c.includes("value_on_unavailable"))
  assert.ok(c.includes("missing_value"))
})

test("a rollup must carry n, N and what it counts, and n cannot exceed N", () => {
  const d = good()
  d.headline = { state: "measured", value: 3, reasons: [], n: 2 }
  assert.ok(codes(d).includes("rollup_missing_n"))
  const e = good()
  e.headline = { state: "measured", value: 3, reasons: [], n: 3, N: 2, of: "jobs" }
  assert.ok(codes(e).includes("rollup_n_exceeds_N"))
  const f = good()
  f.headline = { state: "measured", value: 3, reasons: [], n: 1, N: 2, of: "jobs" }
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
