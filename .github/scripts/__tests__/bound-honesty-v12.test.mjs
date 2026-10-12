// Cross-agent review R1 (2026-10-12): a partial figure with an explicit
// null bound has no direction, so it never reads as a minimum. One rule for
// every surface, following format.js describe: lower is "at least", upper
// "at most", null with bound_not_moved is the plain figure (exact for its
// window), any other null bound is "about", and a partial figure that
// states no bound at all reads as describe reads it, the plain figure.
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
  assert.equal(W.qualifierOf(unstated), "", "describe reads a partial figure with no bound stated as the plain figure")
  // boundOf agrees: no direction for null, "unknown" or no bound stated.
  assert.equal(W.boundOf(noDirection), null)
  assert.equal(W.boundOf({ ...noDirection, bound: "unknown" }), null)
  assert.equal(W.boundOf(unstated), null)
  assert.equal(W.boundOf(lower), "lower")
  assert.equal(W.boundOf(upper), "upper")
  // Round 8: every stated shape reads as describe's text does.
  // Round 8: every stated shape reads exactly as describe reads it.
  for (const n of [notMoved, lower, upper, unstated]) assert.equal(W.statedText(n, "duration"), F.describe(n, "duration").text, JSON.stringify(n))
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
  assert.match(walk, /groups\[0\]\.qualifier = qualifierOf\(workN\);/)
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
  // Round 8 (5): in every Compare mode with a drawn bar.
  assert.match(gate, /check\("narrow_one_task_plot_keeps_text_in_bounds"[\s\S]{0,500}const modes = \["all", "working", "production", "request"\][\s\S]{0,300}for \(const scale of TEXT_SCALES\)[\s\S]{0,200}for \(const width of \[390, 1280\]\)/)
  assert.match(gate, /#\/compare\?mode=\$\{mode\}&task=\$\{encodeURIComponent\(task\)\}/)
  // Round 8 (2): the task page's lead time equals Compare's, with a planted control.
  assert.ok(G.REQUIRED_CHECKS.includes("task_page_lead_time_matches_compare"))
  assert.ok(G.NEGATIVE_CONTROLS.includes("task_lead_differs_from_compare"))
  assert.deepEqual(G.assessLeadAgreement([{ job: "a", compare: "at least 1 minute 38 seconds", caption: "at least 1 minute 38 seconds", aria: "at least 1 minute: working 1 minute" }]), [])
  assert.equal(G.assessLeadAgreement([{ job: "a", compare: "at least 1 minute 38 seconds", caption: "at least 2 minutes", aria: "at least 1 minute 38 seconds" }]).length, 1)
  assert.equal(G.assessLeadAgreement([{ job: "b", compare: "7.1 days so far", caption: "at least 7 days", aria: "at least 7.1 days" }]).length, 1)
  assert.deepEqual(G.assessLeadAgreement([{ job: "b", compare: "7.1 days so far", caption: "at least 7.1 days", aria: "at least 7.1 days: x" }]), [])
  // A text outside a narrow chart is still reported.
  const m = { doc: { scrollWidth: 390, clientWidth: 390, bodyScrollWidth: 390 }, chartTextOut: [{ chart: "stackup", text: "Cut at the edge", planted: true }] }
  assert.deepEqual(G.assessLayout(m).map((p) => p.code), ["chart_text_out_of_bounds"])
})

test("a Compare bar's working figure with no known direction says so in its label, open or not", () => {
  const job = { id: "f".repeat(32), status: "processing", finish_date: { state: "unavailable", reasons: ["open_job"] } }
  const work = { state: "partial", value: 40131607, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["censored", "session_open"] }
  const lead = { state: "partial", value: 149659105, bound: "lower", reasons: ["censored"] }
  const row = { job: job.id, status: { state: "measured", value: "processing", reasons: [] }, lead_time_ms: lead, working_ms: work }
  const [bar] = S.stackBars([job], [row], [row], { mode: "working", segments: F.SEGMENTS })
  assert.equal(bar.state, "ok")
  {
    assert.equal(bar.label, "~11h")
    assert.equal(bar.words, "about 11 hours so far")
  }
  const app = read("site/src/app.js")
  assert.match(app, /const rx = rightW - 13 \* k;/)
  assert.match(app, /"chart-caption sb-group-note"/)
})

// Round 8 (1): a qualifier and its duration are one figure, rounded the way
// the qualifier reads, at every call site.
test("a qualified duration rounds the way its qualifier reads, everywhere", () => {
  assert.equal(W.qualified("about ", 400), "about 400 milliseconds")
  assert.doesNotMatch(W.qualified("about ", 400), /about under/)
  // Round 9's rule: minutes and seconds from 1 to 10 minutes.
  assert.equal(W.qualified("at least ", 98172), "at least 1 minute 38 seconds")
  assert.equal(W.qualified("at most ", 61000), "at most 1 minute 1 second")
  // No call site puts a qualifier in front of an unbounded durationWords.
  const walk = read("site/src/walk.js")
  const app = read("site/src/app.js")
  assert.doesNotMatch(walk, /\$\{(?:q|vq|totalW|dir\(att\)|qualOf\([^)]*\))\}\$\{durationWords\([^,()]*\)\}/)
  assert.doesNotMatch(app, /\$\{(?:at|atLeast|leadQ|g\.qualifier \|\| "")\}\$\{W\.durationWords\(/)
  assert.doesNotMatch(app, /W\.qualOf\(s\) : ""\}\$\{W\.durationWords/)
  // A working time of 400 ms with no known direction, on the task page's bar.
  const row = { job: "a", lead_time_ms: { state: "measured", value: 10000, reasons: [] }, working_ms: { state: "partial", value: 400, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["log_truncated"] } }
  const bar = W.timeBar(row, row, W.idleSplit(row, null), F.SEGMENTS)
  assert.equal(bar.groups[0].qualifier, "about ")
  assert.equal(W.qualified(bar.groups[0].qualifier, bar.groups[0].ms), "about 400 milliseconds")
})

// Round 8 (2): the task page's lead time rounds a lower bound down, as Compare does.
test("the task page's lead time equals Compare's: a lower bound rounds down on both", () => {
  const lead = { state: "partial", value: 98172, bound: "lower", reasons: ["card_dates_shorter_than_work"] }
  const row = { job: "2b8f4ba0", status: { state: "measured", value: "done", reasons: [] }, lead_time_ms: lead, working_ms: { state: "measured", value: 60000, reasons: [] } }
  const lede = W.lede(row, F.reasonText)
  const tok = lede.parts.find((x) => x && x.key === "lead")
  assert.equal(`${tok.q}${tok.text}`, "at least 1 minute 38 seconds")
  assert.equal(W.leadQualifierOf(lead), "at least ")
  assert.equal(W.qualified(W.leadQualifierOf(lead), lead.value), "at least 1 minute 38 seconds")
  const job = { id: row.job, status: "done", finish_order: { state: "measured", value: 1, reasons: [] }, finish_basis: "labels" }
  const [bar] = S.stackBars([job], [row], [row], { mode: "all", segments: F.SEGMENTS })
  assert.equal(bar.words, "at least 1 minute 38 seconds")
  // An open task's "so far" figure is a minimum too: 7.1 days and 7.1 days.
  const open = { ...lead, value: 7.16 * 86400000, reasons: ["censored"] }
  const orow = { ...row, status: { state: "measured", value: "processing", reasons: [] }, lead_time_ms: open }
  const [ob] = S.stackBars([{ ...job, status: "processing" }], [orow], [orow], { mode: "all", segments: F.SEGMENTS })
  const otok = W.lede(orow, F.reasonText).parts.find((x) => x && x.key === "lead")
  assert.equal(ob.words, `${otok.text} so far`)
  const app = read("site/src/app.js")
  assert.match(app, /const leadText = W\.qualified\(leadQ, bar\.total_ms\);/)
})

// Round 8 (6): a figure at its domain's edge can be off one way only.
test("at a domain edge a figure with no known direction says the one way it can be off", () => {
  const z = { state: "partial", value: 0, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["log_truncated"] }
  assert.equal(W.qualified("about ", 0), "0 seconds (could be higher)")
  assert.equal(W.qualified("at most ", 0), "0 seconds")
  assert.equal(W.statedText(z, "duration"), "0s (could be higher)")
  assert.equal(S.clockWords(z, null).text, "0 seconds (could be higher)")
  const na = { state: "unavailable", reasons: ["not_recorded"] }
  const clocks = { production_ms: z, active_in_production_ms: na, production_remainder_ms: na, request_to_delivery_ms: na, queue_ms: na }
  const [bar] = S.clockBars([{ id: "z".repeat(16), status: "done", finish_date: na, clocks }], "production", {})
  assert.equal(bar.label, "0s")
  const share = (w, p) => S.clockShareWords(w, p)
  const conflict = (v) => ({ state: "partial", value: v, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["log_truncated"] })
  assert.equal(share(conflict(0), { state: "measured", value: 1000, reasons: [] }), "0% of production time (could be higher)")
  assert.equal(share(conflict(1000), { state: "measured", value: 1000, reasons: [] }), "100% of production time (could be lower)")
  assert.deepEqual(W.atEdge("about ", 1, undefined, 1), ["", " (could be lower)"])
  assert.deepEqual(W.atEdge("at least ", 1, undefined, 1), ["", ""])
  assert.deepEqual(W.atEdge("about ", 0.5, 0, 1), ["about ", ""])
})

// Round 8 follow-up: describe rounds a bound the way it reads, as the site does.
test("format.js describe rounds a lower bound down and an upper bound up", () => {
  const d = (value, bound, kind = "duration") => F.describe({ state: "partial", value, bound, reasons: ["log_truncated"] }, kind).text
  assert.equal(d(52400, "upper"), "at most 53s")
  assert.equal(d(52600, "lower"), "at least 52s")
  assert.equal(d(59200, "upper"), "at most 1m")
  assert.equal(d(59.6 * 60000, "lower"), "at least 59m")
  assert.equal(d(2.25 * 86400000, "upper"), "at most 2.3d")
  assert.equal(d(2.29 * 86400000, "lower"), "at least 2.2d")
  assert.equal(d(400.2, "upper"), "at most 401 ms")
  assert.equal(d(0.1234, "upper", "pct"), "at most 13%")
  assert.equal(d(0.1294, "lower", "pct1"), "at least 12.9%")
  assert.equal(d(5.5 * 3600000 + 1, "upper", "hours"), "at most 5.6 hours")
  // No direction keeps nearest rounding.
  assert.equal(F.describe({ state: "partial", value: 52600, bound: null, bound_reason: "bound_not_moved", reasons: ["x"] }, "duration").text, "53s")
})

// Round 8 follow-up: a route is read once its data has arrived, not after a guessed time.
test("the gate settles a route on network idle and a stable layout", () => {
  const gate = read("site/scripts/verify-v12-browser.mjs")
  assert.match(gate, /const page = await context\.newPage\(\)\n\s*trackRequests\(page\)/)
  const settle = gate.slice(gate.indexOf("async function settle("), gate.indexOf("export async function main("))
  assert.match(settle, /const busy = open\.size > 0/)
  assert.match(settle, /if \(busy\) \{ idleSince = null; last = -1 \}/)
})
