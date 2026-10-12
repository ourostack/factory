// A route over the settle budget is re-timed twice, back to back with main's
// same route. It passes only when the re-timed route is within budget (a
// spike), or main is itself over budget in the same run (a busy machine) and
// the route is at most twice main's time. On a quiet machine the budget stays
// a hard limit (2026-10-12 ruling and its round-16 review).
import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))
const gate = readFileSync(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url), "utf8")
const at = (ms, where = "#/") => ({ view: "overview", ms, where })
const re = (ms, main_ms, where = "#/") => new Map([[where, { ms, main_ms }]])
const fails = (t, r) => G.assessSettle([t], 5000, r).length === 1

test("a route over budget passes only as a spike, or beside a main that is over budget too and within twice its time", () => {
  assert.equal(G.SETTLE_BUDGET_MS, 5000)
  assert.equal(G.SETTLE_RATIO, 2)
  // The round-15 case: 16.8 s once, 0.6 s when re-timed.
  assert.equal(fails(at(16800), re(600, 590)), false)
  // A busy machine: slow on both builds, within twice main's.
  assert.equal(fails(at(16800), re(16000, 12000)), false)
  // A quiet machine keeps the hard limit: main is under budget.
  assert.equal(fails(at(5100), re(5100, 2600)), true)
  assert.equal(fails(at(9700), re(9700, 4900)), true)
  assert.deepEqual(G.assessSettle([at(16800)], 5000, re(16800, 600)), ["overview (#/): 16.8 s, re-timed 16.8 s (main 0.6 s)"])
  // Main over budget does not excuse more than twice its time.
  assert.equal(fails(at(18000), re(18000, 6000)), true)
  assert.equal(fails(at(12000), re(12000, 6000)), false)
  assert.equal(fails(at(12001), re(12001, 6000)), true)
  // Under budget passes untouched; over budget with no re-timing fails.
  assert.deepEqual(G.assessSettle([at(4900)], 5000, new Map()), [])
  assert.deepEqual(G.assessSettle([at(5100)], 5000, new Map()), ["overview (#/): 5.1 s, not re-timed"])
  // The re-timing is matched by route.
  assert.equal(fails(at(9000, "#/compare"), re(600, 590)), true)
})

test("settleBudget lists every excused route with why, and the load average", () => {
  const r = G.settleBudget([at(700), at(16800), at(13000, "#/tasks")], 5000, new Map([["#/", { ms: 600, main_ms: 590 }], ["#/tasks", { ms: 12000, main_ms: 9000 }]]))
  assert.equal(r.settled, 3)
  assert.deepEqual(r.over_budget_excused.map((x) => [x.where, x.retimed_ms, x.main_ms, x.because]), [["#/", 600, 590, "within budget when re-timed"], ["#/tasks", 12000, 9000, "main was over budget too"]])
  assert.equal(r.load.length, 3)
  assert.throws(() => G.settleBudget([at(700), at(16800)], 5000, re(16800, 600)), /^Error: 1 of 2 over 5 s: overview \(#\/\): 16\.8 s, re-timed 16\.8 s \(main 0\.6 s\)$/)
})

test("the gate re-times each route over budget before its last check, alternating with main, records the load, and proves a 3x slowdown still fails", () => {
  assert.ok(G.NEGATIVE_CONTROLS.includes("slowdown_3x_over_budget"))
  const end = gate.indexOf("await retimeOver(SETTLE_TIMES)\n    if (mainServer)")
  assert.ok(end > 0 && end < gate.indexOf('await check("pages_settle_within_budget"'))
  assert.match(gate, /for \(let i = 0; i < 2; i\+\+\) \{ here\.push\(await timeRoute\(false, where, view, delay\)\); main\.push\(await timeRoute\(true, where, view, mainDelay\)\) \}/)
  assert.match(gate, /return \{ ms: Math\.min\(\.\.\.here\), main_ms: Math\.min\(\.\.\.main\), load: loadavg\(\) \}/)
  assert.match(gate, /load_at_start: loadavg\(\)/)
  assert.match(gate, /resources\.load_at_end = loadavg\(\)/)
  const control = gate.slice(gate.indexOf('expectFailure("slowdown_3x_over_budget"'), gate.indexOf('expectFailure("loading_marker_never_clears"'))
  assert.match(control, /retime\(where, "cause", 3 \* main, 2500\)/)
  assert.match(control, /if \(r\.ms < 3 \* r\.main_ms\) throw/)
})
