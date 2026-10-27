// Factory v1.2 review round 5 (2026-10-12): Compare shows one duration unit
// per view, chosen from its largest value; every conclusion is marked as
// such and the gate reads the marker, not a list of caveat phrases; and the
// preferences migration drops only the zone the old bug stored (UTC).
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")
const W = require("../../../site/src/walk.js")
const P = require("../../../site/src/preferences.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))

const m = (v) => ({ state: "measured", value: v, reasons: [] })
const p = (v, bound, reasons = ["log_truncated"]) => ({ state: "partial", value: v, reasons, bound, ...(bound === null ? { bound_reason: "bound_reasons_conflict" } : {}) })
const H = 3600000
const D = 24 * H

test("a view's unit comes from its largest value: days above 48 hours, hours from one hour, minutes below", () => {
  assert.equal(S.viewUnit(49 * H), "days")
  assert.equal(S.viewUnit(48 * H), "hours")
  assert.equal(S.viewUnit(H), "hours")
  assert.equal(S.viewUnit(30 * 60000), "minutes")
  assert.equal(S.viewUnit(0), "hours")
})

test("a per-task figure has one form: days from 48 hours, then hours, minutes and seconds; a bound never meets 'under'", () => {
  assert.equal(W.durationWords(48 * H), "2 days")
  assert.equal(W.durationWords(47 * H), "47 hours")
  assert.equal(W.durationShort(53.7 * H), "2.2d")
  assert.equal(W.durationWords(400), "under a second")
  assert.equal(W.durationShort(400), "<1s")
  // A bounded value too small for seconds drops to milliseconds.
  assert.equal(W.durationWords(400, true), "400 milliseconds")
  assert.equal(W.durationShort(400, true), "400ms")
  assert.equal(W.durationWords(0.2, true), "1 millisecond")
  // A figure that rounds up to the next unit does so in both forms.
  assert.equal(W.durationWords(59.6 * 60000), "1 hour")
  assert.equal(W.durationShort(59.6 * 60000), "1h")
  // The view unit drops to the per-task form rather than "under" behind a bound.
  assert.equal(S.unitWords(60000, "days"), "under 0.01 days")
  assert.equal(S.unitWords(60000, "days", true), "1 minute")
  assert.equal(S.unitWords(2419 * H, "days"), "101 days")
  assert.equal(S.unitShort, undefined, "bar labels never use the view unit")
})

test("the axis takes the view's unit and is labelled with it", () => {
  const s = S.timeScale(200 * H * 1.15, undefined, "days")
  assert.equal(s.unit, "days")
  assert.equal(s.per, D)
  assert.ok(s.max_ms >= 230 * H && s.ticks.every((t) => (t / D) * 4 === Math.round((t / D) * 4)), "ticks fall on round days")
  assert.equal(S.timeScale(200 * H).unit, "hours")
  assert.match(read("site/src/app.js"), /UNIT_TITLE\[scale\.unit\]/)
})

test("Compare: the axis, sum and lead sentence share the view unit; each task's figure has one form in its label, table, tooltip and accessible label", () => {
  const job = (id, clocks) => ({ id, status: "done", finish_date: { state: "unavailable", reasons: ["not_recorded"] }, clocks })
  const na = { state: "unavailable", reasons: ["original_request_not_recorded"] }
  const clocks = (prod, active, rest) => ({ production_ms: prod, active_in_production_ms: active, production_remainder_ms: rest, request_to_delivery_ms: na, queue_ms: na })
  const jobs = [
    job("a".repeat(16), clocks(m(7 * D), p(3.6 * H, "lower"), p(7 * D - 3.6 * H, "upper"))),
    job("b".repeat(16), clocks(m(5 * H), m(2 * H), m(3 * H))),
    job("c".repeat(16), clocks(p(3 * 60000, "lower"), p(400, "lower"), p(3 * 60000 - 400, null))),
  ]
  const bars = S.clockBars(jobs, "production", { unit: "days" })
  assert.deepEqual(bars.map((b) => b.words), ["7 days", "5 hours", "at least 3 minutes"])
  assert.deepEqual(bars.map((b) => b.label), ["7d", "5h", "≥3m"])
  assert.deepEqual(bars.map((b) => b.view_words), ["7 days", "0.21 days", "at least 3 minutes"])
  // The table cell is the same clock in the same form.
  for (const [i, b] of bars.entries()) assert.equal(S.clockFigures(jobs[i].clocks, F.reasonText).find((f) => f.key === "production_ms").text, b.words)
  // Tooltip rows for the parts carry their bound in the same form as the table.
  const seg = bars[2].segments.find((x) => x.key === "prod_active")
  assert.equal(seg.words, "at least 400 milliseconds")
  assert.equal(seg.words, S.clockFigures(jobs[2].clocks, F.reasonText).find((f) => f.key === "active_in_production_ms").text)
  // The sum is in the view unit.
  assert.match(S.exposureWords(bars), /: at least 7.2 days of task exposure/)
  assert.equal(S.groupWords({ ms: 3.6 * H, qualifier: "at least " }), "at least 3.6 hours")
  assert.equal(S.groupWords({ ms: 300, qualifier: "at least " }), "at least 300 milliseconds")
  assert.equal(S.compactRow({ job: "x", name: "x", state: "ok", label: "2.2d", groups: [{ key: "waiting", ms: 300, qualifier: "at least " }] }).waiting, "≥300ms")
  const app = read("site/src/app.js")
  assert.match(app, /const unit = S\.viewUnit\(/)
  assert.match(app, /candidate\.view_words/)
  assert.match(app, /value: sg\.words \|\| W\.durationWords\(sg\.ms\)/)
  for (const t of [...bars.map((b) => b.words), ...bars.map((b) => b.label), seg.words]) assert.deepEqual(G.boundsBeforeUnder([t]), [], t)
})

test("the gate reads a duration's form from a label or a sentence, and compares each task's figures", () => {
  assert.deepEqual(G.durationForm("≥2.2d"), { bound: "lower", value: "2.2", unit: "days" })
  assert.deepEqual(G.durationForm("at least 2.2 days so far"), { bound: "lower", value: "2.2", unit: "days" })
  assert.deepEqual(G.durationForm("~3.6h"), G.durationForm("about 3.6 hours (could be higher or lower)"))
  assert.deepEqual(G.durationForm("<1s"), { bound: "under", value: "1", unit: "seconds" })
  assert.deepEqual(G.durationForm("under a second"), { bound: "under", value: "1", unit: "seconds" })
  assert.deepEqual(G.durationForm("≤400ms"), { bound: "upper", value: "400", unit: "milliseconds" })
  assert.deepEqual(G.durationForm("1,234 hours"), { bound: null, value: "1234", unit: "hours" })
  assert.equal(G.durationForm("none"), null)
  const row = { job: "a", label: "≥2.2d", aria: "Fix 3 bugs: at least 2.2 days", tip: "at least 2.2 days", cell: "at least 2.2 days" }
  assert.deepEqual(G.assessTaskForms([row]), [])
  assert.match(G.assessTaskForms([{ ...row, cell: "at least 53 hours" }])[0], /a: the table cell reads "at least 53 hours"/)
  assert.match(G.assessTaskForms([{ ...row, tip: "2.2 days" }])[0], /tooltip/)
  assert.match(G.assessTaskForms([{ ...row, aria: "Fix: 2.3 days" }])[0], /accessible label/)
})

test("the gate holds the axis, sum and lead to one unit, and rejects any bound followed by '<' or 'under'", () => {
  const ok = { axis: "Days of production", sum: "Summed over the 3 drawn tasks: at least 7.2 days of task exposure.", lead: "Start by inspecting x: 101 days so far, the largest" }
  assert.equal(G.assessViewUnits(ok), null)
  assert.match(G.assessViewUnits({ ...ok, axis: "Hours of production" }), /axis in hours.*days/)
  assert.match(G.assessViewUnits({ ...ok, sum: "Summed: 170 hours of task exposure." }), /sum in hours/)
  assert.equal(G.assessViewUnits({ ...ok, sum: null, axis: null }), null)
  assert.deepEqual(G.boundsBeforeUnder(["at least under 0.01 days", "≥<0.01d", "≤ <1s", "about under a second", "under a second", "at least 3 minutes", "<1s"]), ["at least under", "≥<", "≤ <", "about under"])
  for (const name of ["compare_axis_sum_and_lead_share_one_unit", "compare_task_figures_match_everywhere", "compare_no_bound_before_under"]) assert.ok(G.REQUIRED_CHECKS.includes(name), name)
  for (const name of ["view_unit_mismatch_on_compare", "task_figure_differs_on_compare", "bound_before_under_on_compare"]) assert.ok(G.NEGATIVE_CONTROLS.includes(name), name)
  assert.ok(!G.REQUIRED_CHECKS.includes("compare_uses_one_duration_unit"))
  // The page function reads tooltips and accessible labels too.
  const gate = read("site/scripts/verify-v12-browser.mjs")
  assert.match(gate, /getAttribute\("aria-label"\)/)
  assert.match(gate, /getElementById\("tooltip"\)/)
})

test("doubled text is budgeted against the baseline's doubled text; its ratio to normal text is reported, not judged", () => {
  assert.equal(G.TEXT2X_HEIGHT_BUDGET, undefined)
  const gate = read("site/scripts/verify-v12-browser.mjs")
  assert.match(gate, /check\("page_height_within_budget_at_doubled_text"[\s\S]{0,1600}assessHeights\(heights, HEIGHT_BUDGET\)/)
  assert.match(gate, /text2x_over_text1x/)
})

test("each conclusion is marked as one, and the gate reads that marker instead of a caveat phrase list", () => {
  assert.equal(G.CAVEAT_PATTERN, undefined, "no phrase list decides what a conclusion is")
  assert.deepEqual(G.CONCLUSIONS, { task: "#view-task", compare: "#view-compare", overview: "#view-overview", time: "#view-time" })
  assert.equal(G.assessFirstScreen({ found: true, role: "conclusion", top: 300, text: "The recorded window is incomplete." }, 390), null, "wording alone never fails a marked conclusion")
  assert.match(G.assessFirstScreen({ found: true, role: "caveat", top: 300, text: "Keep the bounds in view." }, 390), /caveat/)
  assert.match(G.assessFirstScreen({ found: false }, 390), /no conclusion/)
  const html = read("site/src/evidence.html")
  assert.match(read("site/src/reader.js"), /conclusion\.id = "overview-conclusion"; conclusion\.dataset\.role = "conclusion"/)
  assert.match(html, /<p id="comparison-conclusion" [^>]*data-role="conclusion"/)
  assert.match(html, /<p id="compare-lede" [^>]*data-role="caveat"/)
  const gate = read("site/scripts/verify-v12-browser.mjs")
  assert.match(gate, /\[data-role="conclusion"\], \$\{scope\} \[data-role="caveat"\]/)
})

test("the preferences migration drops only the UTC the old bug stored, and keeps any other chosen zone", () => {
  const store = (zone) => {
    const s = new Map([["factory.preferences/1", JSON.stringify({ schema: "factory.preferences/1", dismissed: true, zone, previous: null })]])
    return { getItem: (k) => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)) }
  }
  assert.equal(P.readPreferences(store("UTC"), "America/Los_Angeles").zone, "America/Los_Angeles")
  const kept = P.readPreferences(store("Europe/London"), "America/Los_Angeles")
  assert.equal(kept.zone, "Europe/London")
  assert.equal(kept.dismissed, true)
  assert.equal(P.readPreferences(store("Not/AZone"), "America/Los_Angeles").zone, "America/Los_Angeles", "an invalid zone falls back")
})

// Round 7 (2026-10-12): rounding never overstates a bound, and the unit
// comes from the rounded value.
test("a lower bound rounds down and an upper bound up; other figures round to nearest", () => {
  const M = 60000
  assert.equal(W.durationWords(59.5 * M, "lower"), "59 minutes")
  assert.equal(W.durationShort(59.5 * M, "lower"), "59m")
  assert.equal(W.durationWords(59.5 * M), "1 hour")
  assert.equal(W.durationWords(59.5 * M, "upper"), "1 hour")
  assert.equal(W.durationWords(2.25 * D, "lower"), "2.2 days")
  assert.equal(W.durationWords(2.25 * D, "upper"), "2.3 days")
  assert.equal(W.durationShort(2.25 * D, "lower"), "2.2d")
  assert.equal(W.durationShort(2.25 * D, "upper"), "2.3d")
  assert.equal(S.unitWords(2.25 * D, "days", "lower"), "2.2 days")
  assert.equal(S.unitWords(2.25 * D, "days", "upper"), "2.3 days")
  // A Compare bar and its table cell round the same bound the same way.
  const na = { state: "unavailable", reasons: ["not_recorded"] }
  const clocks = { production_ms: p(2.25 * D, "lower"), active_in_production_ms: na, production_remainder_ms: na, request_to_delivery_ms: na, queue_ms: na }
  const [bar] = S.clockBars([{ id: "a".repeat(16), status: "done", finish_date: na, clocks }], "production", { unit: "days" })
  assert.equal(bar.label, "≥2.2d")
  assert.equal(bar.words, "at least 2.2 days")
  assert.equal(S.clockFigures(clocks, F.reasonText).find((f) => f.key === "production_ms").text, "at least 2.2 days")
})

test("60 seconds carries to a minute, as 60 minutes carries to an hour, and the unit comes from the rounded value", () => {
  assert.equal(W.durationWords(59.6 * 1000), "1 minute")
  assert.equal(W.durationShort(59.6 * 1000), "1m")
  assert.equal(W.durationWords(59.4 * 1000), "59 seconds")
  assert.equal(W.durationWords(47.96 * H), "2 days")
  assert.equal(W.durationShort(47.96 * H), "2d")
  assert.equal(W.durationWords(47.96 * H, "lower"), "47 hours")
  assert.equal(W.durationWords(999.6, "upper"), "1 second")
})

test("the task-figure check compares working-mode table cells, and needs a cell wherever a table column is shown", () => {
  const gate = read("site/scripts/verify-v12-browser.mjs")
  assert.match(gate, /working: \/\^Working\$\//)
  assert.match(gate, /a table column is shown but no bar matched a cell/)
})
