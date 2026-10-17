// Existing public-clock summary/evidence and 11F's fixed short-gap grouping.
// Lifecycle and union accounting have separate producer tests.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
const require = createRequire(import.meta.url)
const W = require("../../../site/src/walk.js")
const F = require("../../../site/src/format.js")
const measured = (value) => ({ state: "measured", value, reasons: [] })
const unavailable = { state: "unavailable", reasons: ["not_recorded"] }
const row = {
  status: measured("done"), lead_time_ms: measured(600000),
  working_ms: measured(120000), value_in_working_ms: unavailable,
  flow_efficiency: measured(.2), longest_gap: unavailable,
}

test("short_gap_grouping_keeps_fifteen_minute_membership_independent_of_box_budget", () => {
  const burst = (start_ms, end_ms) => ({ start_ms, end_ms, working_ms: end_ms - start_ms, sessions: [] })
  const map = {
    bursts: [burst(0, 60000), burst(959999, 1019999), burst(1919999, 1979999)],
    gaps: [
      { start_ms: 60000, end_ms: 959999, waited_on: "next_prompt" },
      { start_ms: 1019999, end_ms: 1919999, waited_on: "next_prompt" },
    ],
  }
  for (const maxBoxes of [1, 2, 6, 7, Infinity]) {
    const model = W.mapModel(map, { shortGapGrouping: true, maxBoxes })
    assert.equal(model.fold_ms, 900000)
    assert.deepEqual(model.items.map((item) => item.type), ["box", "wait", "box"])
    assert.deepEqual(model.items.filter((item) => item.type === "box").map((item) => item.burst_range), [[1, 2], [3, 3]])
    assert.deepEqual(model.items[0].folded.map((gap) => gap.n), [1])
    assert.deepEqual(model.items[1].gap_range, [2, 2])
    assert.deepEqual(model.totals, {
      working_ms: 180000, inner_wait_ms: 899999, waiting_ms: 900000,
      lead_ms: 1979999, bursts: 3, gaps: 2,
    })
    assert.match(W.foldWords(model), /15 minutes/)
    assert.doesNotMatch(W.foldWords(model), /At this width|different threshold/)
    const drawer = W.readableDrawer(W.drawer({ kind: "box", item: model.items[0] }, { model, lead_ms: 1979999, origin_ms: 0 }))
    assert.match(drawer.facts.find((fact) => fact[0] === "Contains short pauses")[1], /15 minutes/)
  }
})

test("short_gap_grouping_keeps_empty_and_wait_only_maps_honest", () => {
  const empty = W.mapModel(null, { shortGapGrouping: true })
  assert.equal(empty.fold_ms, 900000)
  assert.deepEqual(empty.items, [])
  const waitOnly = W.mapModel({ gaps: [{ start_ms: 0, end_ms: 1, waited_on: "unknown" }] }, { shortGapGrouping: true })
  assert.deepEqual(waitOnly.items.map((item) => item.type), ["wait"])
  assert.equal(waitOnly.totals.working_ms, 0)
  assert.equal(waitOnly.totals.waiting_ms, 1)
})

test("concise_summary_preserves_existing_bounds_without_new_clocks", () => {
  const summary = W.taskSummary(row, F.reasonText, { idle: { state: "measured", value: 480000, by: [] } })
  assert.match(summary.conclusion, /waiting/i)
  assert.deepEqual(summary.figures.map((x) => [x.label, x.text]), [
    ["Recorded elapsed", "10 minutes"], ["Recorded working", "2 minutes"], ["Recorded waiting", "8 minutes"],
  ])
  assert.match(summary.classification, /not labeled|not recorded/i)
  const partial = W.taskSummary({ ...row, working_ms: { state: "partial", value: 120000, bound: "lower", reasons: ["log_truncated"] } }, F.reasonText)
  assert.match(partial.figures.find((x) => x.label === "Recorded working").text, /at least 2 minutes/)
  assert.match(partial.caveat, /incomplete|partial/i)
  assert.doesNotMatch(partial.conclusion, /largest|most/)
})

test("missing_summary_does_not_substitute_zero_or_production_clock", () => {
  for (const published of [true, false]) {
    const summary = W.taskSummary(null, F.reasonText, { published })
    assert.equal(summary.figures.length, 0)
    assert.match(summary.conclusion, /not published|no row/)
    assert.doesNotMatch(summary.conclusion, /\b0\b|production/)
  }
})

test("summary_keeps_explicit_upper_and_unbounded_figures_beside_values", () => {
  const upper = W.taskSummary({ ...row, lead_time_ms: { state: "partial", value: 600000, bound: "upper", reasons: ["log_truncated"] } }, F.reasonText)
  assert.match(upper.figures[0].text, /at most 10 minutes/)
  const unknown = W.taskSummary({ ...row, working_ms: { state: "partial", value: 120000, bound: null, bound_reason: "log_truncated", reasons: ["log_truncated"] } }, F.reasonText)
  const work = unknown.figures.find((f) => f.label === "Recorded working")
  assert.match(work.text, /direction not known/)
  assert.doesNotMatch(work.text, /at least|at most/)
  const openUnknown = W.taskSummary({ ...row, lead_time_ms: { state: "partial", value: 600000, bound: null, bound_reason: "log_truncated", reasons: ["censored", "log_truncated"] } }, F.reasonText)
  assert.match(openUnknown.figures[0].text, /direction not known/)
  assert.doesNotMatch(openUnknown.figures[0].text, /at least|at most/)
})

test("drawer_unknown_work_is_not_the_legacy_layout_fallback_span", () => {
  const map = { bursts: [{ start_ms: 0, end_ms: 600000, sessions: [] }], gaps: [] }
  const model = W.mapModel(map)
  const readable = W.readableDrawer(W.drawer({ kind: "box", item: model.items[0] }, { model, lead_ms: 600000 }))
  assert.match(readable.facts.find((f) => f[0] === "Recorded work")[1], /not recorded/)
  assert.doesNotMatch(readable.facts.find((f) => f[0] === "Recorded work")[1], /10 minutes/)
})

test("summary_discloses_long_reasons_separately_but_keeps_material_bound", () => {
  const partial = W.taskSummary({ ...row, working_ms: { state: "partial", value: 120000, bound: "lower", reasons: ["log_truncated"] } }, F.reasonText)
  const work = partial.figures.find((f) => f.label === "Recorded working")
  assert.match(work.text, /at least 2 minutes/)
  assert.doesNotMatch(work.text, /session's log/)
  assert.match(work.details, /session's log was cut short/)
})

test("drawer_useful_facts_precede_expandable_technical_evidence", () => {
  const input = {
    title: "Work box", rows: [
      ["Which", "bursts 1–2"], ["What it is", "Recorded activity"],
      ["On the task clock", "from minute 0 to minute 12"],
      ["Working time", "10 minutes"], ["Short waits inside", "2 minutes"],
      ["Value-adding, as labeled", "not recorded"],
    ], evidence: [],
  }
  const readable = W.readableDrawer(input)
  assert.deepEqual(readable.facts, [
    ["Recorded work", "10 minutes"], ["Position from task start", "from minute 0 to minute 12"],
    ["Interpretation", "Recorded activity"], ["Contains short pauses", "2 minutes"],
    ["Value-adding, as labeled", "not recorded"],
  ])
  assert.deepEqual(readable.technical, [["Which", "bursts 1–2"]])
  assert.equal(input.rows[0][0], "Which", "public evidence must not be mutated")
  assert.deepEqual(W.readableDrawer({ rows: [] }).facts, [])
})

test("zone_changes_only_supported_instants_not_relative_clock_days_or_duration", () => {
  const cases = [
    ["2026-03-08T09:30:00Z", "01:30"], ["2026-03-08T10:30:00Z", "03:30"],
    ["2026-11-01T08:30:00Z", "01:30"], ["2026-11-01T09:30:00Z", "01:30"],
  ]
  for (const [instant, time] of cases) assert.ok(F.formatInstant(instant, "America/Los_Angeles").includes(time))
  assert.notEqual(F.formatInstant(cases[2][0], "America/Los_Angeles"), F.formatInstant(cases[3][0], "America/Los_Angeles"), "offset disambiguates repeated Pacific hour")
  assert.equal(W.clockWords(0, 600000, 0), "from 0s to 10m after the task's start (10 minutes)")
  assert.equal(W.durationWords(600000), "10 minutes")
})

const journeyMap = () => ({
  lead_window: { state: "partial", start_ms: -1000, end_ms: 10001000, reasons: ["work_before_card"] },
  bursts_state: measured(null),
  bursts: [
    { start_ms: 0, end_ms: 60000, working_ms: measured(30000), sessions: ["s1"], idle_by_waited_on_ms: { next_prompt: 30000 } },
    { start_ms: 10000000, end_ms: 10001000, working_ms: measured(1000), sessions: ["s2"] },
  ],
  gaps: [
    { start_ms: -1000, end_ms: 0, waited_on: "unknown" },
    { start_ms: 60000, end_ms: 10000000, waited_on: "no_session", idle_by_waited_on_ms: { no_session: 9900000, unknown: 40000 } },
  ],
  transitions: [{ offset_ms: 59000, to: "blocked" }],
  observations: [{ offset_ms: 10000500, status: "done" }],
})

test("whole_journey_covers_the_recorded_window_once_including_short_pauses_and_unknown_edges", () => {
  const map = journeyMap(), saved = JSON.stringify(map)
  const story = W.recordedJourney(map)
  assert.equal(story.state, "ok")
  assert.equal(story.total_ms, 10002000)
  assert.equal(story.working_ms, 31000)
  assert.deepEqual(story.by, { next_prompt: 30000, no_session: 9900000, unknown: 41000 })
  assert.deepEqual(story.items.map(({ item, kind, start_ms, end_ms }) => ({ item, kind, start_ms, end_ms })), [
    { item: 0, kind: "box", start_ms: -1000, end_ms: 60000 },
    { item: 1, kind: "wait", start_ms: 60000, end_ms: 10000000 },
    { item: 2, kind: "box", start_ms: 10000000, end_ms: 10001000 },
  ])
  assert.match(story.headline, /2 recorded work periods/)
  assert.match(story.headline, /2h 46m 42s.*2h 45m 40s/, "the whole frame and longest pause must not round to the same duration")
  assert.match(story.pause, /no session recorded for this task/i)
  assert.doesNotMatch(story.pause, /factory was idle|blocked because|waste/i)
  assert.deepEqual(story.items[0].statuses, [{ status: "blocked", observed: false }])
  assert.deepEqual(story.items[2].statuses, [{ status: "done", observed: true }])
  assert.equal(story.items[0].working_ms, 30000, "period span is not continuous work")
  assert.equal(JSON.stringify(map), saved)
})

test("journey_duration_keeps_hours_minutes_and_seconds_distinct_without_inventing_zero", () => {
  assert.equal(W.durationDetail(94967009), "26h 22m 47s")
  assert.equal(W.durationDetail(91913453), "25h 31m 53s")
  assert.equal(W.durationDetail(995826), "16m 36s")
  assert.equal(W.durationDetail(0), "0s")
  assert.equal(W.durationDetail(524), "<1s")
  assert.equal(W.durationDetail(null), "Not recorded")
})

test("whole_journey_does_not_turn_missing_or_overlapping_capture_into_an_exact_account", () => {
  for (const change of [
    (m) => { m.bursts[0] = null },
    (m) => { m.gaps[0] = "not an interval" },
    (m) => { m.bursts_state = { state: "partial", reasons: ["log_truncated"] } },
    (m) => { m.bursts[0].working_ms = unavailable },
    (m) => { m.bursts[0].working_ms = { state: "partial", value: 30000, bound: "lower", reasons: ["log_truncated"] } },
    (m) => { m.bursts[0].working_ms = measured(60001) },
    (m) => { m.gaps[0].end_ms = -1 },
    (m) => { m.gaps[0].end_ms = 1 },
    (m) => { m.gaps[1].idle_by_waited_on_ms.no_session = 10000000 },
    (m) => { m.lead_window.end_ms = NaN },
    (m) => { m.lead_window.state = "unavailable" },
  ]) {
    const map = journeyMap(); change(map)
    const story = W.recordedJourney(map)
    assert.equal(story.state, "unavailable")
    assert.match(story.reason, /not recorded|incomplete|overlap|partition|window|measured/)
    assert.equal(Object.hasOwn(story, "total_ms"), false)
  }
  assert.equal(W.recordedJourney(null).state, "unavailable")
})

test("task_conclusion_uses_positive_recorded_journey_evidence_without_replacing_the_bound_clocks", () => {
  const partialRow = { ...row, lead_time_ms: measured(10002000), working_ms: { state: "partial", value: 31000, bound: "lower", reasons: ["log_truncated"] } }
  const summary = W.taskSummary(partialRow, F.reasonText, { map: journeyMap() })
  assert.match(summary.conclusion, /2 recorded work periods/)
  assert.doesNotMatch(summary.conclusion, /cannot yet say|factory.*idle/)
  assert.match(summary.caveat, /captured|recorded/)
  assert.match(summary.figures.find((x) => x.label === "Recorded working").text, /at least/)
  const incomplete = journeyMap(); incomplete.bursts_state = unavailable
  assert.doesNotMatch(W.taskSummary(partialRow, F.reasonText, { map: incomplete }).conclusion, /2 recorded work periods/)
})

test("task_conclusion_does_not_join_mismatching_rollup_and_map_windows_into_one_story", () => {
  const summary = W.taskSummary(row, F.reasonText, { map: journeyMap() })
  assert.doesNotMatch(summary.conclusion, /2 recorded work periods/)
  assert.match(summary.caveat, /map and rollup.*different recorded windows/i)
})
