// A route over the settle budget fails only when it is also more than twice
// main's time for the same route in the same run (2026-10-12 ruling): a busy
// machine slows both builds, a real slowdown only one.
import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))
const gate = readFileSync(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url), "utf8")
const at = (ms, where = "#/") => ({ view: "overview", ms, where })

test("over budget fails only when over twice main's time for the same route", () => {
  assert.equal(G.SETTLE_BUDGET_MS, 5000)
  assert.equal(G.SETTLE_RATIO, 2)
  // The round-15 case: 16.8 s on a busy machine, main as slow, passes.
  assert.deepEqual(G.assessSettle([at(16800)], 5000, new Map([["#/", 9000]])), [])
  // A real slowdown: over budget and over twice main's.
  assert.deepEqual(G.assessSettle([at(16800)], 5000, new Map([["#/", 600]])), ["overview (#/): 16.8 s (main 0.6 s)"])
  // Exactly twice is not over; just past is.
  assert.deepEqual(G.assessSettle([at(6000)], 5000, new Map([["#/", 3000]])), [])
  assert.equal(G.assessSettle([at(6001)], 5000, new Map([["#/", 3000]])).length, 1)
  // Under budget passes however slow against main; main not timed fails.
  assert.deepEqual(G.assessSettle([at(4900)], 5000, new Map([["#/", 100]])), [])
  assert.deepEqual(G.assessSettle([at(5100)], 5000, new Map()), ["overview (#/): 5.1 s (main not timed)"])
  // Main is matched by route, not by view.
  assert.equal(G.assessSettle([at(9000, "#/compare")], 5000, new Map([["#/", 9000]])).length, 1)
})

test("settleBudget reports the routes that were slow on both builds and the load average", () => {
  const r = G.settleBudget([at(700), at(16800)], 5000, new Map([["#/", 9000]]))
  assert.equal(r.settled, 2)
  assert.deepEqual(r.over_budget_but_main_slow_too, [{ view: "overview", ms: 16800, where: "#/", main_ms: 9000 }])
  assert.equal(r.load.length, 3)
  assert.throws(() => G.settleBudget([at(700), at(16800)], 5000, new Map([["#/", 600]])), /^Error: 1 of 2 over 5 s and over 2x main: overview \(#\/\): 16\.8 s \(main 0\.6 s\)$/)
})

test("the gate times main for each route over budget before its last check, records the load, and proves a 3x slowdown still fails", () => {
  assert.ok(G.NEGATIVE_CONTROLS.includes("slowdown_3x_over_budget"))
  const end = gate.indexOf("await timeMainFor(SETTLE_TIMES)")
  assert.ok(end > 0 && end < gate.indexOf('await check("pages_settle_within_budget"'))
  assert.match(gate, /load_at_start: loadavg\(\)/)
  assert.match(gate, /resources\.load_at_end = loadavg\(\)/)
  const control = gate.slice(gate.indexOf('expectFailure("slowdown_3x_over_budget"'), gate.indexOf('expectFailure("loading_marker_never_clears"'))
  assert.match(control, /timeOnMain\(where, "cause", 2500\)/)
  assert.match(control, /setTimeout\(ok, 3 \* main\)/)
  assert.match(control, /if \(t\.ms < 3 \* main\) throw/)
})
