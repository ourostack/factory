// Factory v1.2 review round 4 (2026-10-12): one name and one duration format
// per quantity on the task page, the conclusion before its caveat, published
// clock parts read rather than recomputed, summed bounds that keep their
// direction, and the #267 should-fixes (lifecycle finish words, whether an
// improvement addresses the investigated cause, an unavailable selection
// that never says it is selected, alarm focus, and the time zone reset).
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
const clocks = (over) => ({
  production_ms: p(601066595, "upper", ["finish_from_card_update"]),
  active_in_production_ms: p(13136098, null),
  production_remainder_ms: p(587930497, null),
  request_to_delivery_ms: { state: "unavailable", reasons: ["original_request_not_recorded"] },
  queue_ms: { state: "unavailable", reasons: ["original_request_not_recorded"] },
  production_periods: { state: "partial", reasons: ["finish_from_card_update"], items: [{ start_ms: 17405, end_ms: 601084000 }] },
  ...over,
})

test("the clock for recorded work inside production has its own name, and clock durations read like the task's other figures", () => {
  const figures = S.clockFigures(clocks(), F.reasonText)
  const active = figures.find((f) => f.key === "active_in_production_ms")
  assert.equal(active.label, "Recorded working inside production")
  assert.ok(!figures.some((f) => f.label === "Recorded working time" || f.label === "Recorded working"), "no clock shares the legacy figure's name")
  // The same formatter as "Recorded elapsed: 7 days" (days above 48 hours).
  assert.equal(figures.find((f) => f.key === "production_ms").text, `at most ${W.durationWords(601066595)}`)
  assert.equal(figures.find((f) => f.key === "production_ms").text, "at most 7 days")
  assert.match(active.text, /^about 3\.6 hours/)
  assert.match(S.productionJourney(clocks(), F.reasonText).items[0].words, /^7 days, from 17 seconds after the task's start to 7 days after the task's start/)
  // A zero clock is a stated zero, never "none".
  assert.equal(S.clockWords(p(0, null), null).text, "about 0 seconds (could be higher or lower)")
})

test("one line relates production elapsed to the task's overall recorded elapsed", () => {
  const line = S.productionRelation(clocks(), m(601084000 + 17405))
  assert.match(line, /Production elapsed time \(at most 7 days\)/)
  assert.match(line, /recorded elapsed \(7 days\)/)
  assert.match(line, /first recorded work/)
  assert.match(line, /delivery/)
  assert.equal(S.productionRelation(null, m(H)), null)
  assert.match(S.productionRelation(clocks({ production_ms: { state: "unavailable", reasons: ["late_work_without_reopen"] } }), m(H)), /not available/)
  assert.match(read("site/src/app.js"), /S\.productionRelation\(clocks, /)
})

test("Compare's production split reads the published remainder instead of subtracting", () => {
  const c = clocks({ production_remainder_ms: p(5 * H, "lower"), active_in_production_ms: m(2 * H), production_ms: m(10 * H) })
  const [bar] = S.clockBars([{ id: "a".repeat(32), status: "done", clocks: c }], "production")
  assert.deepEqual(bar.segments.map((s) => [s.key, s.ms]), [["prod_active", 2 * H], ["prod_remainder", 5 * H]])
  assert.equal(bar.segments[1].bound, "lower")
  // Without a published remainder the split is not known; nothing is computed.
  const [none] = S.clockBars([{ id: "b".repeat(32), status: "done", clocks: clocks({ production_remainder_ms: { state: "unavailable", reasons: ["not_recorded"] }, production_ms: m(10 * H) }) }], "production")
  assert.deepEqual(none.segments.map((s) => s.key), ["unsplit"])
})

test("a sum keeps its direction when every partial member shares it, and says about only when they are mixed", () => {
  const bar = (v, bound) => ({ state: "ok", total_ms: v, partial: bound !== undefined, bound })
  assert.match(S.exposureWords([bar(H), bar(H, "lower"), bar(H, "lower")]), /: at least 3 hours of task exposure/)
  assert.match(S.exposureWords([bar(H, "upper"), bar(H)]), /: at most 2 hours of task exposure/)
  assert.match(S.exposureWords([bar(H, "upper"), bar(H, "lower")]), /: about 2 hours of task exposure \(could be higher or lower\)/)
  assert.match(S.exposureWords([bar(H, null), bar(H)]), /: about 2 hours/)
  assert.match(S.exposureWords([bar(H), bar(H)]), /: 2 hours of task exposure/)
})

test("the task page leads with a conclusion; the caveat follows it and is never the conclusion", () => {
  const row = { status: m("done"), lead_time_ms: p(10 * H, "lower"), working_ms: p(H, "lower"), value_in_working_ms: { state: "unavailable", reasons: ["not_recorded"] }, flow_efficiency: m(0.1), longest_gap: { state: "unavailable", reasons: [] } }
  const s = W.taskSummary(row, F.reasonText, { idle: { state: "partial", value: 9 * H, bound: "lower", by: [] } })
  assert.doesNotMatch(s.conclusion, /incomplete|keep the bounds/i)
  assert.match(s.caveat, /incomplete/)
  // At least 9 hours waiting against at least 1 hour of work does not rank them: the conclusion says so.
  assert.match(s.conclusion, /cannot yet say whether waiting or working/)
  const ranked = W.taskSummary({ ...row, working_ms: p(H, "upper") }, F.reasonText, { idle: { state: "partial", value: 9 * H, bound: "lower", by: [] } })
  assert.match(ranked.conclusion, /^Waiting is the largest recorded part/)
  const exact = W.taskSummary({ ...row, lead_time_ms: m(10 * H), working_ms: m(H) }, F.reasonText, { idle: { state: "measured", value: 9 * H, by: [] } })
  assert.equal(exact.caveat, "")
  const app = read("site/src/app.js")
  assert.match(app, /el\("p", "task-caveat", summary\.caveat\)/)
})

test("a task with no finish day says why in lifecycle words, never 'still open' beside 'Awaiting acceptance'", () => {
  const open = F.finishDay({ state: "unavailable", reasons: ["open_job"] })
  assert.equal(W.finishCellWords(open, { outcome: "awaiting_signoff", status: "processing" }), "No finish day yet: delivered for acceptance, but its card is still in processing")
  assert.equal(W.finishCellWords(open, { outcome: "in_progress", status: "blocked" }), "No finish day yet: in progress (blocked)")
  const dated = F.finishDay({ state: "measured", value: "2026-10-06", basis: "desk_transition", reasons: [] })
  assert.equal(W.finishCellWords(dated, { outcome: "delivered", status: "done" }), dated.words)
  assert.match(read("site/src/app.js"), /W\.finishCellWords\(r\.finish, jobById\.get\(r\.id\)\)/)
})

test("Improvements with an investigated cause says whether any published improvement addresses it", () => {
  const rows = [{ ref: "ourostack/factory#53", cause: { key: "waiting:next_prompt", label: "Waiting · next prompt" } }, { ref: "ourostack/factory#54", cause: null }]
  assert.equal(S.causeAddressedWords(rows, "waiting:next_prompt"), `1 published improvement issue addresses ${W.causeWords("waiting:next_prompt")}: ourostack/factory#53.`)
  assert.equal(S.causeAddressedWords(rows, "waiting:other_task"), `No published improvement issue addresses ${W.causeWords("waiting:other_task")} yet.`)
  assert.equal(S.causeAddressedWords(rows, null), null)
  assert.match(read("site/src/app.js"), /S\.causeAddressedWords\(rows, F\.navigationContext\(location\.hash\)\.cause\)/)
})

test("an unavailable selection never says it is selected; the Overview alarm link lands focus on the alarms", () => {
  const app = read("site/src/app.js")
  assert.match(app, /"selection-note"/)
  assert.match(app, /querySelector\("\.selection-note"\)/, "the selected-item note is removed when the item is not found")
  // The router focuses the alarms section, not the heading, after the Overview link.
  assert.match(app, /if \(r\.view === "act" && focusAfterRender === "improvement-alarms"\)/)
})

test("the stored preferences version is bumped so a zone pinned to UTC by the old bug resets to the browser's zone", () => {
  const store = new Map([["factory.preferences/1", JSON.stringify({ schema: "factory.preferences/1", dismissed: true, zone: "UTC", previous: null })]])
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
  const read2 = P.readPreferences(storage, "America/Los_Angeles")
  assert.equal(read2.schema, "factory.preferences/2")
  assert.equal(read2.zone, "America/Los_Angeles", "the old pinned UTC is not carried over")
  assert.equal(read2.dismissed, true, "other preferences carry over")
  P.savePreferences(storage, { zone: "UTC" }, "America/Los_Angeles")
  assert.equal(P.readPreferences(storage, "America/Los_Angeles").zone, "UTC", "a UTC chosen after the fix is kept")
})

test("the first-screen check is per width, wants the conclusion sentence, and covers Overview and Compare", () => {
  assert.equal(G.firstScreenHeight(320), 640)
  assert.equal(G.firstScreenHeight(480), 640)
  assert.equal(G.firstScreenHeight(481), 900)
  assert.deepEqual(Object.keys(G.CONCLUSIONS).sort(), ["compare", "overview", "task"])
  assert.equal(G.assessFirstScreen({ found: true, role: "conclusion", top: 600, text: "Waiting is the largest recorded part." }, 390), null)
  assert.match(G.assessFirstScreen({ found: true, role: "conclusion", top: 700, text: "Waiting is the largest." }, 390), /below the first screen \(640 px/)
  assert.equal(G.assessFirstScreen({ found: true, role: "conclusion", top: 700, text: "Waiting is the largest." }, 800), null)
  assert.match(G.assessFirstScreen({ found: true, role: "caveat", top: 10, text: "The recorded window or its work split is incomplete." }, 800), /caveat/)
  assert.match(G.assessFirstScreen({ found: false }, 800), /no conclusion/)
  const source = readFileSync(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)), "utf8")
  assert.match(source, /fitted tripwires/)
})

test("Overview and Compare lead with their conclusion, right under the heading", () => {
  const B = require("../../../site/src/briefing.js")
  const item = (title) => ({ id: `x:${title}`, title })
  assert.equal(B.conclusionWords({ state: "attention", attention: [item("improvement loop: the loop raised an alarm about itself")], investigation: [item("Deliveries are waiting for an answer")] }), "One item needs your attention first: improvement loop: the loop raised an alarm about itself.")
  assert.equal(B.conclusionWords({ state: "attention", attention: [item("a"), item("b")], investigation: [] }), "2 items need your attention first, led by: a.")
  assert.equal(B.conclusionWords({ state: "limited", attention: [], investigation: [item("Deliveries are waiting for an answer")] }), "Nothing is flagged for your attention first; 1 recorded pattern is worth investigating: Deliveries are waiting for an answer.")
  assert.equal(B.conclusionWords({ state: "limited", attention: [], investigation: [] }), "Nothing in this briefing is flagged for attention or investigation.")
  const html = read("site/src/index.html")
  const after = (view, id) => { const v = html.slice(html.indexOf(`id="view-${view}"`)); return v.slice(v.indexOf("</h1>") + 5).trimStart().startsWith(`<p id="${id}"`) }
  assert.ok(after("overview", "overview-conclusion"), "the Overview's conclusion follows its heading")
  assert.ok(after("compare", "comparison-conclusion"), "Compare's conclusion follows its heading")
  assert.match(read("site/src/app.js"), /getElementById\("overview-conclusion"\)\.textContent = B\.conclusionWords\(doc\)/)
})

test("a partial zero reads 'none recorded', never 'at least none'", () => {
  const row = { status: m("done"), lead_time_ms: m(10 * H), working_ms: m(H), value_in_working_ms: p(0, "lower"), flow_efficiency: m(0.1), longest_gap: { state: "unavailable", reasons: [] } }
  const s = W.taskSummary(row, F.reasonText, { idle: { state: "measured", value: 9 * H, by: [] } })
  assert.doesNotMatch(s.classification, /at least none/)
  assert.match(s.classification, /none recorded/)
})
