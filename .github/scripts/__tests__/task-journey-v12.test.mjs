// 11U uses existing public clocks only. New episode/grouping/union accounting
// belongs to 11F; these tests pin the reader-facing summary and evidence.
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

test("concise_summary_preserves_existing_bounds_without_new_clocks", () => {
  const summary = W.taskSummary(row, F.reasonText, { idle: { state: "measured", value: 480000, by: [] } })
  assert.match(summary.conclusion, /waiting/i)
  assert.deepEqual(summary.figures.map((x) => [x.label, x.text]), [
    ["Recorded elapsed", "10 minutes"], ["Recorded working", "2 minutes"], ["Recorded waiting", "8 minutes"],
  ])
  assert.match(summary.classification, /not labeled|not recorded/i)
  const partial = W.taskSummary({ ...row, working_ms: { state: "partial", value: 120000, bound: "lower", reasons: ["log_truncated"] } }, F.reasonText)
  assert.match(partial.figures.find((x) => x.label === "Recorded working").text, /at least 2 minutes/)
  assert.match(partial.conclusion, /incomplete|partial/i)
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
