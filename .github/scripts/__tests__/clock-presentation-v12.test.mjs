// Factory v1.2 clock parts of 10F-12F: how the site presents Desk's
// lifecycle clocks (production elapsed, recorded working, production not
// recorded as active, request to delivery, queue) on a task and in Compare.
// The browser formats and filters; Desk alone computes the clocks.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")
const fixture = JSON.parse(readFileSync(new URL("./fixtures/v12-clocks.json", import.meta.url), "utf8"))
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const caseOf = (id) => structuredClone(fixture.cases.find((c) => c.id === id).expected)

const LABELS = {
  production_ms: "Production elapsed time",
  active_in_production_ms: "Recorded working inside production",
  production_remainder_ms: "Production not recorded as active",
  request_to_delivery_ms: "Request to delivery",
  queue_ms: "Queued before production",
}

const clock = (over) => ({ class: "measured", state: "measured", value: 7200000, reasons: [], basis: ["recorded_activity", "done_transition", "lifecycle_history"], so_far: false, ...over })

test("clock_figures_keep_bounds_reasons_and_never_show_zero_for_unavailable", () => {
  for (const c of fixture.cases) {
    const figures = S.clockFigures(c.expected, F.reasonText)
    assert.deepEqual(figures.map((f) => f.key), Object.keys(LABELS), c.id)
    for (const f of figures) {
      assert.equal(f.label, LABELS[f.key], `${c.id} ${f.key}`)
      const n = c.expected[f.key]
      if (n.state === "unavailable") {
        assert.equal(f.text, "Not available", `${c.id} ${f.key}`)
        assert.doesNotMatch(f.text, /\b0\b|none/)
        assert.match(f.why, /^Not available because /, `${c.id} ${f.key}`)
        for (const r of n.reasons) assert.ok(f.why.includes(F.reasonText(r)), `${c.id} ${f.key} ${r}`)
      } else if (n.state === "partial") {
        if (n.bound === "lower") assert.match(f.text, /^at least /, `${c.id} ${f.key}`)
        else if (n.bound === "upper") assert.match(f.text, /^at most /, `${c.id} ${f.key}`)
        else assert.match(f.text, /could be higher or lower/, `${c.id} ${f.key}`)
        assert.ok(f.why.length > 0, `${c.id} ${f.key} partial needs a reason`)
      } else assert.doesNotMatch(f.text, /at least|at most|higher or lower/)
      if (n.so_far) assert.match(n.state === "unavailable" ? f.why : f.text, n.state === "unavailable" ? /still open/ : /so far/)
    }
  }
  // Request and queue are unavailable for every published task (original_request_not_recorded): never an invented zero.
  const [, , , request, queue] = S.clockFigures(caseOf("adopted_positive_uncaptured"), F.reasonText)
  assert.match(request.why, /the original request was not recorded/)
  assert.match(queue.why, /the original request was not recorded/)
  // A partial value names the direction of its bound in plain words.
  const lower = S.clockFigures({ ...caseOf("reopened"), production_ms: clock({ class: "declared", state: "partial", bound: "lower", reasons: ["censored"], so_far: true }) }, F.reasonText)[0]
  assert.match(lower.text, /^at least 2 hours so far$/)
  assert.match(lower.why, /could be longer/)
  const upper = S.clockFigures({ ...caseOf("reopened"), production_ms: clock({ class: "declared", state: "partial", bound: "upper", reasons: ["finish_from_card_update"] }) }, F.reasonText)[0]
  assert.match(upper.why, /could be shorter/)
  assert.match(upper.why, /the day comes from the task card's last update/)
  assert.equal(S.clockFigures(null, F.reasonText), null, "a task without clocks is legacy, not zero")
})

test("production_journey_shows_episodes_and_between_delivery_intervals", () => {
  const journey = S.productionJourney(caseOf("reopened"), F.reasonText)
  assert.equal(journey.state, "measured")
  assert.deepEqual(journey.items.map((i) => [i.kind, i.start_ms, i.end_ms]), [["production", 0, 2000], ["between", 2000, 6000], ["production", 6000, 8000]])
  assert.equal(journey.items[1].label, "Between deliveries")
  assert.match(journey.items[1].words, /not production time/)
  assert.equal(journey.items[0].label, "Production period 1")
  assert.equal(journey.items[2].label, "Production period 2")
  // Unavailable periods show the reason, not an empty journey or a zero.
  const late = S.productionJourney(caseOf("late_work"), F.reasonText)
  assert.equal(late.state, "unavailable")
  assert.deepEqual(late.items, [])
  assert.match(late.words, /work was recorded after delivery without a recorded reopen/)
  // An open period ends at the latest supported evidence and says so.
  const open = caseOf("reopened")
  open.production_periods.items[1].so_far = true
  assert.match(S.productionJourney(open, F.reasonText).items[2].words, /so far/)
  assert.equal(S.productionJourney(null, F.reasonText), null)
})

test("acceptance_wait_is_its_coarse_class_outside_production", () => {
  const waiting = S.acceptanceFigure({ signoff_wait: { state: "measured", value: "waiting at least 1 day", reasons: [] } }, F.reasonText)
  assert.equal(waiting.label, "Acceptance wait")
  assert.match(waiting.text, /waiting at least 1 day/)
  assert.match(waiting.why, /coarse class/)
  assert.match(waiting.why, /not part of production/)
  const none = S.acceptanceFigure({ signoff_wait: { state: "unavailable", reasons: ["not_delivered"] } }, F.reasonText)
  assert.equal(none.text, "Not available")
  assert.match(none.why, /the job has not been delivered/)
  assert.doesNotMatch(none.text, /\b0\b/)
})

test("production_bars_split_recorded_work_and_the_rest_without_inventing_values", () => {
  const jobs = [
    { id: "a".repeat(32), status: "done", finish_order: { state: "measured", value: 1, reasons: [] }, clocks: caseOf("reopened") },
    { id: "b".repeat(32), status: "done", finish_order: { state: "measured", value: 2, reasons: [] }, clocks: caseOf("late_work") },
    { id: "c".repeat(32), status: "done", finish_order: { state: "measured", value: 3, reasons: [] } },
  ]
  const bars = S.clockBars(jobs, "production", { nameOf: (j) => j.id.slice(0, 4) })
  assert.deepEqual(bars.map((b) => b.state), ["ok", "no_data", "no_data"])
  assert.deepEqual(bars[0].segments.map((s) => [s.key, s.ms]), [["prod_active", 2000], ["prod_remainder", 2000]])
  assert.equal(bars[0].total_ms, 4000)
  assert.match(bars[1].reasons.join(" "), /late_work_without_reopen/)
  assert.deepEqual(bars[2].reasons, ["clocks_not_published"])
  for (const b of bars.filter((x) => x.state === "no_data")) assert.equal(b.total_ms, null)
  // Bounds show on the bar's short label.
  const partial = structuredClone(jobs[0]); partial.clocks.production_ms = clock({ class: "declared", state: "partial", value: 4000, bound: "upper", reasons: ["finish_from_card_update"] })
  assert.match(S.clockBars([partial], "production")[0].label, /^≤/)
  // Request mode: every published task lacks an original request, so no bar and a stated reason.
  const request = S.clockBars(jobs.slice(0, 2), "request")
  assert.ok(request.every((b) => b.state === "no_data" && b.reasons.includes("original_request_not_recorded")))
})

test("sums_are_task_exposure_and_ratios_keep_uncertainty", () => {
  const bars = S.clockBars([
    { id: "a".repeat(32), status: "done", clocks: caseOf("reopened") },
    { id: "b".repeat(32), status: "done", clocks: caseOf("reopened") },
  ], "production")
  const sum = S.exposureWords(bars)
  assert.match(sum, /task exposure/)
  assert.match(sum, /not factory time/)
  assert.match(sum, /more than the wall-clock time/)
  assert.doesNotMatch(sum, /utilization/i)
  const m = (v) => ({ state: "measured", value: v, reasons: [] })
  const p = (v, bound) => ({ state: "partial", value: v, reasons: ["censored"], bound, ...(bound === null ? { bound_reason: "bound_reasons_conflict" } : {}) })
  assert.equal(S.clockShareWords(m(1), m(4)), "25% of production time")
  assert.match(S.clockShareWords(p(1, "lower"), p(4, "upper")), /^at least 25%/)
  assert.match(S.clockShareWords(p(1, "upper"), p(4, "lower")), /^at most 25%/)
  const mixed = S.clockShareWords(p(1, "lower"), p(4, "lower"))
  assert.match(mixed, /^about 25%/)
  assert.match(mixed, /could be higher or lower/)
  assert.match(S.clockShareWords(p(1, null), m(4)), /could be higher or lower/)
  assert.equal(S.clockShareWords({ state: "unavailable", reasons: ["late_work_without_reopen"] }, m(4)), null)
  for (const w of [S.clockShareWords(m(1), m(4)), mixed]) assert.doesNotMatch(w, /utilization/i)
  // A tiny share never reads as a bare 0%, and a zero clock never reads as "none".
  assert.equal(S.clockShareWords(m(3), m(1000)), "0.3% of production time")
  assert.equal(S.clockShareWords(m(1), m(100000)), "under 0.1% of production time")
  assert.equal(S.clockShareWords(p(3, null), m(1000)), "about 0.3% of production time (could be higher or lower)")
  assert.equal(S.clockShareWords(p(1, "lower"), m(100000)), "more than 0% of production time")
  assert.equal(S.clockWords({ state: "partial", value: 0, reasons: ["log_truncated"], bound: null }, null).text, "about 0 seconds (could be higher or lower)")
})

test("compare offers production and request modes backed by the producer, labelled honestly", () => {
  const html = read("site/src/index.html")
  assert.match(html, /data-mode="production"[^>]*>Production time</)
  assert.match(html, /data-mode="request"[^>]*>Request to delivery</)
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /clock mode is unavailable until an approved producer/)
  assert.doesNotMatch(app, /corrected production clocks are unavailable/)
  assert.match(app, /S\.clockBars\(selectedJobs, mode/)
  assert.match(app, /S\.exposureWords\(/)
  assert.match(F.compareHash({ mode: "production" }), /mode=production/)
  assert.match(F.compareHash({ mode: "request" }), /mode=request/)
})

test("the task view leads with its conclusion, then the production clocks and journey", () => {
  const app = read("site/src/app.js")
  assert.match(app, /S\.clockFigures\(clocks, F\.reasonText\)/)
  assert.match(app, /S\.productionJourney\(clocks, F\.reasonText\)/)
  assert.match(app, /S\.acceptanceFigure\(j, F\.reasonText\)/)
  assert.ok(app.indexOf('el("p", "task-conclusion"') < app.indexOf("S.clockFigures(clocks, F.reasonText)"), "the conclusion comes before the clocks")
  assert.doesNotMatch(app, /New production grouping is not available/)
  // The conclusion sits right under the task title, before the reference and status lines.
  assert.match(app, /title\.after\(conclusion\)/)
})

test("llms.txt documents the clock fields, their twins and their limits", () => {
  const llms = read("site/src/llms-template.txt")
  for (const s of ["production_ms", "active_in_production_ms", "production_remainder_ms", "request_to_delivery_ms", "queue_ms", "production_periods", "original_request_not_recorded", "so_far", "task exposure", "acceptance"]) assert.ok(llms.includes(s), s)
  assert.doesNotMatch(llms, /does not demonstrate new production accounting/)
  assert.match(llms, /never zero/)
})
