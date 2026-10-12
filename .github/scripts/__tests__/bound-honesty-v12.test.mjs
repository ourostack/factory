// Cross-agent review R1 (2026-10-12): a partial figure with an explicit
// null bound has no direction, so it never reads as a minimum. One rule for
// every surface, following format.js describe: lower is "at least", upper
// "at most", null with bound_not_moved is the plain figure (exact for its
// window), any other null bound is "about", and only a partial figure that
// states no bound at all (a sum with parts missing) is "at least".
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")
const W = require("../../../site/src/walk.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

const notMoved = { state: "partial", value: 52009, bound: null, bound_reason: "bound_not_moved", reasons: ["card_dates_shorter_than_work"] }
const noDirection = { state: "partial", value: 52009, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["log_truncated"] }
const nullNoReason = { state: "partial", value: 52009, bound: null, reasons: ["log_truncated"] }
const lower = { state: "partial", value: 52009, bound: "lower", reasons: ["log_truncated"] }
const upper = { state: "partial", value: 52009, bound: "upper", reasons: ["log_truncated"] }
const unstated = { state: "partial", value: 52009, reasons: ["not_recorded"] }

test("one qualifier rule: an explicit null bound is never a minimum", () => {
  assert.equal(W.qualifierOf(notMoved), "")
  assert.equal(W.qualifierOf(noDirection), "about ")
  assert.equal(W.qualifierOf(nullNoReason), "about ")
  assert.equal(W.qualifierOf({ ...noDirection, bound: "unknown" }), "about ")
  assert.equal(W.qualifierOf(lower), "at least ")
  assert.equal(W.qualifierOf(upper), "at most ")
  assert.equal(W.qualifierOf(unstated), "at least ", "a partial figure with no bound stated is a sum with parts missing")
  assert.equal(W.qualifierOf({ state: "measured", value: 1, reasons: [] }), "")
  // The same rule as the canonical formatter.
  assert.equal(F.describe(notMoved, "duration").text.startsWith("at least"), false)
  assert.equal(F.describe(noDirection, "duration").text.startsWith("at least"), false)
})

test("the task table's working cell (statedText) reads the reviewer's input without a minimum", () => {
  assert.equal(W.statedText(notMoved, "duration"), "52s")
  assert.equal(W.statedText(noDirection, "duration"), "about 52s")
  assert.equal(W.statedText(nullNoReason, "duration"), "about 52s")
  assert.equal(W.statedText(lower, "duration"), "at least 52s")
  // An upper bound rounds up, so it never understates the ceiling.
  assert.equal(W.statedText(upper, "duration"), "at most 53s")
  assert.equal(W.statedText({ ...noDirection, value: 3 }, null), "about 3")
  // The picker cell is that formatter.
  assert.match(read("site/src/app.js"), /return W\.statedText\(n, "duration"\);/)
})

test("sentences, counts and the other walk.js paths follow the same rule", () => {
  assert.equal(W.qualOf(notMoved), "")
  assert.equal(W.qualOf(noDirection), "about ")
  assert.equal(W.reworkWords({ defect_stretches: { state: "partial", value: 3, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["log_truncated"] }, defect_ms: { state: "measured", value: 60000, reasons: [] } }), "about 3 defect stretches, 1 minute")
  const box = { working_ms: 52009, working_state: noDirection, agents: 1, tool_calls: 1, tool_failures: 0, operator_turns: 0, prs: 0, session_numbers: [1] }
  assert.equal(W.dataBox(box, 1).find((r) => r.key === "working").text, "about 52s")
  assert.equal(W.dataBox({ ...box, working_state: notMoved }, 1).find((r) => r.key === "working").text, "52s")
  assert.equal(W.dataBox({ ...box, working_state: lower }, 1).find((r) => r.key === "working").text, "at least 52s")
  const walk = read("site/src/walk.js")
  assert.match(walk, /groups\[0\]\.qualifier = wb === "lower" \? "at least " : wb === "upper" \? "at most " : workN && workN\.state === "partial" && \(workN\.bound === null \|\| workN\.bound === "unknown"\) \? qualifierOf\(workN\) : "";/)
})

test("Compare clocks: bound_not_moved reads as the plain figure in the label, table, tooltip and sum", () => {
  const na = { state: "unavailable", reasons: ["not_recorded"] }
  const clocks = { production_ms: notMoved, active_in_production_ms: na, production_remainder_ms: na, request_to_delivery_ms: na, queue_ms: na }
  const [bar] = S.clockBars([{ id: "a".repeat(16), status: "done", finish_date: na, clocks }], "production", { unit: "hours" })
  assert.equal(bar.label, "52s")
  assert.equal(bar.words, "52 seconds")
  assert.equal(S.clockFigures(clocks, F.reasonText).find((f) => f.key === "production_ms").text, "52 seconds")
  assert.doesNotMatch(S.exposureWords([bar]), /about|at least/)
  const [dir] = S.clockBars([{ id: "b".repeat(16), status: "done", finish_date: na, clocks: { ...clocks, production_ms: noDirection } }], "production", { unit: "hours" })
  assert.equal(dir.label, "~52s")
  assert.equal(dir.words, "about 52 seconds (could be higher or lower)")
})

test("the task page's one-bar lead time follows the same rule", () => {
  const app = read("site/src/app.js")
  assert.match(app, /const leadQ = /)
  assert.doesNotMatch(app, /const atLeast = bar\.lead_state === "partial" \? "at least " : "";/)
})

// Cross-agent review R2: the gate measured no chart under 100 x 50 px, so
// the 72 px one-task plot's labels were never checked against its edges.
test("the gate measures every visible chart's text, with a one-task check and a narrow-plot control", async () => {
  const { fileURLToPath } = await import("node:url")
  const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))
  const gate = read("site/scripts/verify-v12-browser.mjs")
  const loop = gate.slice(gate.indexOf("Labels drawn on top of each other inside one chart"), gate.indexOf("Every link the reader can reach"))
  assert.doesNotMatch(loop, /sr\.width < 100 \|\| sr\.height < 50/, "no size floor before the text-bounds check")
  assert.match(loop, /chartsMeasured\.push/)
  assert.ok(G.REQUIRED_CHECKS.includes("narrow_one_task_plot_keeps_text_in_bounds"))
  assert.ok(G.NEGATIVE_CONTROLS.includes("clipped_text_in_narrow_plot"))
  assert.match(gate, /check\("narrow_one_task_plot_keeps_text_in_bounds"[\s\S]{0,700}for \(const scale of TEXT_SCALES\)[\s\S]{0,200}for \(const width of \[390, 1280\]\)/)
  assert.match(gate, /#\/compare\?task=\$\{encodeURIComponent\(targets\.task\)\}/)
  // A text outside a narrow chart is still reported.
  const m = { doc: { scrollWidth: 390, clientWidth: 390, bodyScrollWidth: 390 }, chartTextOut: [{ chart: "stackup", text: "Cut at the edge", planted: true }] }
  assert.deepEqual(G.assessLayout(m).map((p) => p.code), ["chart_text_out_of_bounds"])
})
