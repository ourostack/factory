import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
const require = createRequire(import.meta.url)
const W = require("../../../site/src/walk.js")
const measured = (value) => ({ state: "measured", value, reasons: [] })
const missing = { state: "unavailable", reasons: ["device_missing"] }

test("public_clock_offsets_keep_before_after_and_zero_without_invented_dates", () => {
  assert.equal(W.clockWords(-60000, 60000), "from 1m before to 1m after the task's start (2 minutes)")
  assert.equal(W.clockWords(-120000, -60000), "from 2m before to 1m before the task's start (1 minute)")
  for (const [ms, text] of [[-60000, "−1m"], [0, "0s"], [60000, "1m"]]) assert.equal(W.clockTick(ms), text)
})

test("public_share_formatting_preserves_strict_sides_of_rounding_edges", () => {
  for (const [value, text] of [[.00000001, "0.001%"], [.99999999, "99.999%"], [1.00000001, "100.001%"]]) {
    assert.equal(W.shareFigure(value, 0, "none").text, text)
  }
  assert.equal(W.pctWords(.99999999), "99.999%")
  assert.equal(W.pctWords(1.00000001), "100.001%")
  assert.equal(W.pctWords(.50001, "upper"), "51%")
  assert.equal(W.pctWords(.50001, "lower"), "50%")
})

test("stated_and_summed_numbers_never_promote_malformed_or_missing_values_to_measured", () => {
  for (const input of [
    { state: "measured" }, { state: "partial", value: Infinity },
    { state: "partial", value: null, reasons: ["device_missing"] },
  ]) assert.equal(W.stated(input).state, "unavailable")
  assert.deepEqual(W.stated({ state: "unavailable" }), { state: "unavailable", reasons: [] })
  assert.deepEqual(W.sumStated([]), measured(0))
  assert.equal(W.sumStated([missing, measured(1)]).state, "partial")
  assert.equal(W.sumStated([missing]).state, "unavailable")
})

test("default_reason_callbacks_explain_missing_data_without_zero_claims", () => {
  const row = { lead_time_ms: missing, working_ms: missing, value_in_working_ms: missing }
  assert.match(W.ledeText(W.lede(row)), /device missing/)
  assert.match(W.operatorTime({ human_turns: missing, attention_ms: missing }).text, /device missing/)
  assert.equal(W.clockListWords(missing, "Prompts"), "Prompts not recorded (device missing)")
  assert.equal(W.prTimeWords(null, missing), "not placed on the task clock: device missing")
  const partial = { state: "partial", value: 60000, bound: "lower", reasons: ["device_missing"] }
  const summary = W.taskSummary({ ...row, lead_time_ms: partial, working_ms: measured(1000) })
  assert.match(summary.figures[0].details, /device missing/)
})

test("gap_and_why_splits_discard_invalid_amounts_and_preserve_unknown_remainders", () => {
  assert.deepEqual(W.gapIdleBy({ start_ms: 0, end_ms: 10, waited_on: "unsupported" }), { unknown: 10 })
  assert.deepEqual(W.gapIdleBy({ start_ms: 0, end_ms: 10, idle_by_waited_on_ms: { invalid: NaN, absent: null, unrecorded: missing } }), { unknown: 10 })
  assert.deepEqual(W.whyBy({ idle_by_why_ms: { invalid: Infinity, negative: -1, absent: missing, unsupported: measured(3) } }), { not_known: 3 })
  assert.deepEqual(W.gapCauses({ start_ms: 0, end_ms: 10, idle_by_waited_on_ms: { next_prompt: 5, api_retry: 5 } }), ["next_prompt", "api_retry"])
})

test("adjacent_waits_share_one_wait_without_losing_their_individual_gap_numbers", () => {
  const model = W.mapModel({ gaps: [
    { start_ms: 5, end_ms: 10, waited_on: "api_retry" },
    { start_ms: 0, end_ms: 5, waited_on: "next_prompt" },
  ] }, { shortGapGrouping: true })
  assert.equal(model.items.length, 1)
  assert.deepEqual(model.items[0].gap_range, [1, 2])
  assert.equal(model.items[0].duration_ms, 10)
  assert.deepEqual(model.items[0].causes, ["next_prompt", "api_retry"])
})

test("empty_exported_legacy_thresholds_keep_the_constructor_empty_but_not_the_fixed_mode", () => {
  const original = W.FOLD_STEPS.slice()
  try {
    W.FOLD_STEPS.length = 0
    const map = { bursts: [{ start_ms: 0, end_ms: 10, working_ms: measured(10), sessions: [] }] }
    assert.deepEqual(W.mapModel(map).items, [])
    assert.equal(W.mapModel(map).fold_ms, 0)
    assert.equal(W.mapModel(map, { shortGapGrouping: true }).items.length, 1)
  } finally {
    W.FOLD_STEPS.push(...original)
  }
})

test("list_wrappers_and_missing_job_counts_remain_supported_by_the_public_map_model", () => {
  const model = W.mapModel({
    bursts: { items: [{ start_ms: 0, end_ms: 10, working_ms: measured(10), sessions: ["b", "a"] }] },
    gaps: { items: [] }, sessions: [{ id: "b" }, { id: "a", offset_ms: 1 }],
  }, { shortGapGrouping: true, jobStates: { operator_turns: { state: "unavailable" } } })
  assert.deepEqual(model.items[0].session_numbers, [1, 2])
  assert.equal(model.items[0].operator_turns.state, "unavailable")
  assert.equal(model.totals.working_ms, 10)
})

test("missing_next_prompt_class_amounts_fail_closed_and_keep_all_reasons", () => {
  const split = W.nextPromptWhy({
    waiting_by_waited_on_ms: { next_prompt: measured(10) },
    next_prompt_by_why_ms: Object.fromEntries(W.WHY_KEYS.map((key) => [key, missing])),
  })
  assert.equal(split.state, "unavailable")
  assert.deepEqual(split.reasons, ["device_missing"])
})

test("why_tokens_and_wait_handoffs_keep_the_real_reason_split_without_a_custom_callback", () => {
  const map = { gaps: [{
    start_ms: 0, end_ms: 60000, waited_on: "next_prompt",
    idle_by_why_ms: { approval: 30000, decision: 30000 },
  }] }
  const model = W.mapModel(map, { shortGapGrouping: true })
  const item = model.items[0]
  const prompt = W.promptItem({ kind: "wait", item }, { model })
  assert.match(prompt.what, /why the agent stopped/)
  const row = {
    waiting_by_waited_on_ms: { next_prompt: measured(60000) },
    next_prompt_by_why_ms: Object.fromEntries(W.WHY_KEYS.map((key) => [key, measured(key === "approval" || key === "decision" ? 30000 : 0)])),
  }
  const parts = W.whyLedeParts(W.nextPromptWhy(row), 60000)
  assert.ok(parts.some((part) => part && typeof part === "object"))
})

test("public_handoff_rows_and_prompt_drawers_explain_unknown_stop_reasons", () => {
  const clock = { prompts: [{
    n: 1, total: 1, ms: 60000, turn: { session: "s", basis: "after_stop" },
    why: "not_known", wait: { reasons: ["device_missing"], next_prompt_ms: 1 },
  }] }
  const rows = W.handoffRows(clock, 0)
  assert.equal(rows.length, 1)
  assert.match(rows[0].why, /device missing/)
  const drawer = W.drawer({ kind: "prompt", mark: clock.prompts[0] }, {})
  assert.match(drawer.rows.find(([name]) => name === "Why the agent stopped")[1], /device missing/)
})

test("missing_public_labels_and_partial_notes_keep_unknown_distinct_from_zero", () => {
  assert.equal(W.durationShort(null), "0s")
  assert.match(W.waitLabel(null), /cause not recorded/)
  const stretch = W.drawer({ kind: "stretch", stretch: { class: "muda", waste: "unsupported", start_ms: 0, end_ms: 1 } })
  assert.deepEqual(stretch.rows.find(([name]) => name === "What it is"), ["What it is", "Waste: could not classify"])
  assert.equal(W.statedText(missing), "no data")
  assert.match(W.barPartialNote(), /partial/i)
  assert.equal(W.finishCellWords(null), "Not recorded")
  assert.equal(W.finishCellWords({ kind: "open" }), "No finish day yet: in progress")
  assert.equal(W.finishCellWords({ kind: "open" }, { outcome: "delivered" }), "No finish day yet: delivered for acceptance, but its card is still in progress")
  assert.deepEqual(W.readableDrawer({}), { facts: [], technical: [] })
  assert.deepEqual(W.pickerRows(null, null, () => "unused"), [])
})

test("malformed_burst_cause_amounts_cannot_expand_the_span_remainder", () => {
  assert.deepEqual(W.burstIdleBy({
    start_ms: 0, end_ms: 10, working_ms: measured(5),
    idle_by_waited_on_ms: { broken: NaN, unsupported: measured(7) },
  }), { unknown: 5 })
  const model = W.mapModel({
    bursts: [{ start_ms: 0, end_ms: 0, working_ms: measured(0), sessions: [] }],
    gaps: [{ start_ms: 0, end_ms: 0, idle_by_waited_on_ms: { next_prompt: measured(5) } }],
  }, { shortGapGrouping: true })
  assert.equal(model.totals.lead_ms, 0)
  assert.deepEqual(model.items[0].inner_by, {})
  const emptyWait = W.mapModel({ gaps: [{ start_ms: 0, end_ms: 0 }] }).items[0]
  assert.deepEqual(emptyWait.causes, ["unknown"])
  assert.equal(emptyWait.longest_ms, 0)
})

test("card_status_and_highlight_fallbacks_do_not_invent_supported_causes_or_items", () => {
  assert.equal(W.cardStatusWords(null), "In progress (status not recorded)")
  assert.equal(W.cardStatusWords("cancelled", false), "Cancelled")
  assert.equal(W.cardStatusWords("cancelled", true), "Cancelled (last observed)")
  assert.equal(W.highlightSelector("longest"), ".vsm-wait")
  assert.match(W.highlightSelector("why", { why: "unsupported" }), /has-next_prompt/)
  assert.equal(W.stretchSegment({ class: "unlabeled", reason: "other" }), "not_labeled")
  assert.equal(W.stretchSegment({ class: "muda", waste: "unsupported" }), "unknown")
  assert.ok(W.zoomSteps(100000, 10, 5).includes(1))
})

test("status_marks_place_unclocked_and_outside_transitions_without_making_new_items", () => {
  const model = { items: [{ start_ms: 10, end_ms: 20 }] }
  const marks = W.statusMarks({
    transitions: [{ to: "drafting", offset_ms: -1 }, { to: "processing" }, { to: "done", offset_ms: 30 }],
    observations: [{ status: "accepted" }],
  }, model)
  assert.deepEqual(marks.map((mark) => mark.item), [0, 0, 0, 0])
  assert.deepEqual(W.statusMarks(null, model), [])
  assert.deepEqual(W.statusMarks({ transitions: [{ to: "done" }] }, { items: [] }), [{ status: "done", item: 0, observed: false }])
})

test("swimlane_cycles_and_unknown_parents_keep_every_worker_exactly_once", () => {
  const detail = { session: "s", intervals: [0, 1, 2, 3].map((worker) => ({ worker })) }
  const lanes = W.lanes(detail, [
    { session: "s", n: 1, parent: 1 }, { session: "s", n: 2, parent: 3 },
    { session: "s", n: 3, parent: 2 }, { session: "s", n: 4, parent: 99 },
  ])
  assert.deepEqual(lanes.map((lane) => lane.worker).sort(), [0, 1, 2, 3, 4])
  assert.equal(new Set(lanes.map((lane) => lane.worker)).size, 5)
  assert.deepEqual(W.lanes(null, null), [{ worker: 0, depth: 0, label: "Main agent" }])
})

test("public_why_metadata_fallbacks_remain_explicitly_not_recorded", () => {
  assert.equal(W.whyReasonWords("device_missing"), "device missing")
  assert.match(W.whyTriangle("not_known"), /reason not recorded/)
  assert.equal(W.whySourceWords("unsupported"), "not recorded")
  assert.equal(W.confidenceText(null), "not stated")
  assert.equal(W.confidenceText(""), "not stated")
  assert.equal(W.groupWhy(null), "not_known")
  assert.deepEqual(W.whyKeysIn(null), [])
  assert.match(W.whyLegend(null), /every prompt is drawn in one color/)
  assert.equal(W.stopWords({}), null)
})

test("empty_and_incomplete_clock_populations_keep_unknown_placement_and_coverage", () => {
  const clock = W.clockMarks(null)
  assert.deepEqual(clock.prompts, [])
  assert.deepEqual(clock.prs, [])
  assert.equal(W.stepPlace(null, 0), null)
  assert.equal(W.stepPlace({ type: "wait", duration_ms: 0, gaps: [] }, 0).frac, 0)
  assert.equal(W.stepPlace({ type: "box", working_ms: 0 }, 0).frac, 0)
  assert.deepEqual(W.boxPrCount(null), measured(0))
  assert.match(W.clockListWords({ state: "partial", reasons: ["worker_shared"] }, "Prompts"), /partly recorded/)
  assert.deepEqual(W.ladderLanes(null, null).prompts, [])
  assert.deepEqual(W.ladderLanes(null, null).prs, [])
})

test("list_state_overrides_keep_the_producer_bound_and_unknown_hosts_stay_incomplete", () => {
  const explicit = W.clockListStates({
    sessions: "malformed", human_turns: null,
    human_turns_state: { state: "partial", reasons: null, bound: null, bound_reason: "mixed_sources" },
    prs_state: { state: "unavailable" },
  })
  assert.deepEqual(explicit.human_turns_state, {
    state: "partial", reasons: [], bound: null, bound_reason: "mixed_sources", basis: "desk",
  })
  assert.equal(explicit.prs_state.state, "unavailable")
  const unknownHost = W.clockListStates({ sessions: [{ id: "s", host: "unsupported" }], human_turns: [null] })
  assert.equal(unknownHost.human_turns_state.state, "partial")
  assert.ok(unknownHost.human_turns_state.reasons.includes("not_recorded"))
  assert.ok(unknownHost.prs_state.reasons.includes("not_recorded"))
  assert.equal(W.clockListStates(null).human_turns_state.state, "unavailable")
})

test("unplaced_pull_requests_keep_a_lower_bound_even_when_no_mark_is_drawn", () => {
  const count = W.boxPrCount({ prs: [], unplaced: [{ what: "opened" }] }, 0, { state: "partial" })
  assert.deepEqual(count, { state: "partial", value: 0, bound: "lower", reasons: ["pr_time_not_placed"] })
  assert.equal(W.boxPrCount({ prs: [], unplaced: [] }, 0, {}).state, "measured")
})

test("public_prompt_names_and_text_keep_missing_identity_private_and_do_not_make_selectors", () => {
  assert.equal(W.promptName(null), "factory task (unknown) (private)")
  assert.equal(W.promptName({ title: null }), "factory task (unknown) (private)")
  assert.equal(W.promptName({ kind: "unnamed", short: "abc" }), "factory task abc (private)")
  assert.equal(W.promptName({ kind: "unnamed", title: "Unnamed task", short: "abc" }), "factory task abc")
  const text = W.promptText({ name: "abc", route: "#/task/abc", dataUrl: "map/abc.json" })
  assert.match(text, /factory task abc/)
  assert.doesNotMatch(text, /\?undefined|Index of every data file/)
})

test("public_map_projection_keeps_missing_lists_unknown_and_does_not_publish_an_uncertain_utc_day", () => {
  const report = { timeline: {
    job: "task", bursts: { state: "unavailable", reasons: ["device_missing"], items: [{
      start_ms: 0, end_ms: 10, working_ms: missing,
      idle_by_waited_on_ms: { broken: Infinity, next_prompt: measured(1) },
    }] },
    gaps: { items: "not_an_array" }, human_turns: [{ at_ms: 0, session: "s" }, { at_ms: null, session: "s" }],
  } }
  const map = W.slimMap(report, {
    pr_clock: { prs: [], anchor: {}, origin: { value_ms: Date.parse("2026-10-14T23:59:30Z"), uncertainty_ms: 60000 } },
  })
  assert.equal(map.bursts_state.state, "unavailable")
  assert.deepEqual(map.gaps, [])
  assert.deepEqual(map.bursts[0].idle_by_waited_on_ms, { next_prompt: 1 })
  assert.ok(map.human_turns.every((turn) => turn.day === null))
  assert.equal(W.slimMap(null).job, "")
  assert.equal(W.slimMap(null).lead_window.state, "unavailable")
})

test("missing_or_unreadable_idle_inputs_cannot_be_promoted_to_a_measured_split", () => {
  const row = { lead_time_ms: measured(10), working_ms: measured(5) }
  const wrapped = W.idleSplit(row, { bursts: { items: [] }, gaps: { items: [] } })
  assert.equal(wrapped.value, 5)
  assert.equal(W.idleSplit({ ...row, working_ms: missing }, {}).state, "unavailable")
  assert.equal(W.idleSplit(row, { bursts: {}, gaps: {} }).value, 5)
  const bar = W.timeBar(null, row, { state: "measured", value: 5, by: [] }, [{ key: "value", label: "Value" }])
  assert.equal(bar.state, "ok")
  assert.equal(bar.total_ms, 10)
  assert.equal(W.timeBar(null, row, { state: "unavailable" }, []).state, "lead_only")
})

test("legacy_box_metadata_keeps_missing_figures_missing_and_rework_count_separate", () => {
  const data = W.dataBox({
    working_ms: 0, operator_turns: missing, agents: missing, tool_calls: missing,
    tool_failures: missing, prs: missing, session_numbers: [],
  }, 0)
  assert.ok(data.some((field) => field.text.includes("no data")))
  assert.equal(W.reworkWords({ defect_stretches: measured(2), defect_ms: missing }), "2 defect stretches")
  const model = W.mapModel({ bursts: [{
    start_ms: 0, end_ms: 10, working_ms: missing, sessions: [],
  }] }, { jobStates: { operator_turns: { state: "partial", value: 1 } } })
  assert.equal(model.items[0].operator_turns.state, "unavailable")
  assert.equal(model.items[0].working_state.state, "unavailable")
})

test("public_evidence_drawers_keep_mixed_wait_causes_and_unavailable_work_honest", () => {
  const map = { gaps: [
    { start_ms: 0, end_ms: 5, waited_on: "next_prompt", idle_by_why_ms: { approval: 5 } },
    { start_ms: 5, end_ms: 10, waited_on: "api_retry" },
  ] }
  const model = W.mapModel(map)
  const drawer = W.drawer({ kind: "wait", item: model.items[0] })
  assert.match(JSON.stringify(drawer.rows), /2 waits in a row/)
  assert.match(JSON.stringify(drawer.rows), /Longest of them/)
  const box = W.mapModel({ bursts: [{ start_ms: 0, end_ms: 10, working_ms: missing, sessions: [] }] }).items[0]
  assert.match(JSON.stringify(W.drawer({ kind: "box", item: box }).rows), /not recorded/)
  assert.ok(W.promptItem({ kind: "wait", item: model.items[0] }).what.includes("gaps 1–2"))
})

test("unknown_geometry_does_not_assign_a_clock_mark_to_another_evidence_item", () => {
  const clock = { prompts: [{ n: 1, ms: 0, item: 0, frac: .5, step: "missing", turn: {} }], prs: [] }
  for (const sizes of [null, [{}], [{ work: [0, 10] }], [{ other: [0, 10] }]]) {
    const result = W.ladderLanes(clock, sizes)
    assert.equal(result.prompts.length, 1)
    assert.equal(result.prompts[0].item, 0)
    assert.ok(Number.isFinite(result.prompts[0].pos))
  }
})

test("partial_attention_without_recorded_prompts_is_not_an_exact_zero_attention_claim", () => {
  const zero = { state: "partial", value: 0, bound: "lower", reasons: ["device_missing"] }
  const result = W.operatorTime({ human_turns: missing, attention_ms: zero }, [{ prompt_class: "unsupported" }])
  assert.equal(result.attention, "none recorded")
  assert.match(result.text, /no recorded prompt/)
  const unknown = W.operatorTime({ human_turns: missing, attention_ms: missing })
  assert.match(unknown.text, /prompts.*not recorded/)
  const sizes = W.operatorTime({ human_turns: measured(3), attention_ms: measured(1) }, [
    { prompt_class: "s", output_class: "s" }, { prompt_class: "m", output_class: "m" },
    { prompt_class: "unsupported", output_class: "unsupported" },
  ])
  assert.match(sizes.text, /1 short and 1 medium/)
})

test("missing_why_detail_keeps_its_unknown_reason_without_manufacturing_a_class", () => {
  assert.deepEqual(W.whyLedeParts(null, 0), [])
  const split = { state: "ok", template: "not_recorded", total: measured(10), not_known: null }
  assert.match(W.whyLedeParts(split, 10).join(""), /reason not recorded/)
  const parts = W.whyLedeParts({
    state: "ok", template: "all", total: measured(5), classified_ms: 5,
    top: ["approval", "decision", "question", "error_limit", "interrupted"].map((why) => ({ why, ms: 1, n: measured(1) })),
    not_known: { ms: 0, n: measured(0), reasons: [] },
  }, 5)
  assert.ok(parts.length)
  assert.match(JSON.stringify(parts), /other kind/)
})

test("prompt_drawer_optional_metadata_and_nonrecorded_stops_stay_explicit", () => {
  for (const turn of [undefined, { basis: "mid_turn" }, { basis: "unsupported" }]) {
    const drawer = W.drawer({ kind: "prompt", mark: { n: 1, total: 1, ms: 0, turn, why: "not_known", wait: { reasons: null } } }, {})
    assert.ok(drawer.rows.some(([name]) => name === "Why the agent stopped"))
    assert.doesNotMatch(JSON.stringify(drawer.rows), /NaN|Infinity/)
  }
  const stopped = W.drawer({ kind: "prompt", mark: {
    n: 1, total: 1, ms: 0, turn: { basis: "after_stop" },
    why: "not_known", wait: { next_prompt_ms: 1, stop: { end: "unsupported" }, reasons: ["not_labeled"] },
  } }, {})
  assert.match(JSON.stringify(stopped.rows), /not recorded/)
  assert.match(JSON.stringify(stopped.rows), /Counted as waiting/)
})

test("zero_duration_items_and_missing_work_amounts_do_not_divide_by_zero_on_the_task_clock", () => {
  const empty = { type: "box", start_ms: 0, end_ms: 0, working_ms: 0, bursts: [], folded: [] }
  assert.equal(W.placeOnMap({ items: [empty] }, 0).frac, 0)
  const wait = { type: "wait", start_ms: 0, end_ms: 10, duration_ms: 10, gaps: [{ start_ms: 0, end_ms: 5 }, { start_ms: 5, end_ms: 10 }] }
  assert.equal(W.stepPlace(wait, 10).frac, 1)
  const box = { type: "box", start_ms: 0, end_ms: 10, working_ms: 10, bursts: [{ start_ms: 0, end_ms: 10, working_ms: missing }], folded: [{ start_ms: 0, end_ms: 2 }, { start_ms: 2, end_ms: 3 }] }
  assert.ok(Number.isFinite(W.stepPlace(box, 10).frac))
})

test("clock_lists_accept_wrapped_legacy_bursts_but_never_place_malformed_pr_records", () => {
  const map = {
    bursts: { items: [{ start_ms: 0, end_ms: 10, working_ms: missing, idle_ms: null }] },
    gaps: { items: [] }, sessions: [],
    human_turns: [{ session: "s", at_ms: 10, basis: "after_stop" }, { session: "s", at_ms: 10, basis: "first" }],
    prs: [null, "unsupported"],
  }
  const clock = W.clockMarks(map, { items: [{ type: "box", start_ms: 0, end_ms: 10, working_ms: 10, bursts: [], folded: [] }] })
  assert.equal(clock.prompts.length, 2)
  assert.equal(clock.prs.length, 0)
  assert.deepEqual(clock.prompts.map((prompt) => prompt.n), [1, 2])
})

test("labeled_stretch_evidence_keeps_unknown_kinds_and_workers_explicit", () => {
  const stretch = { class: "support", start_ms: 0, end_ms: 1, evidence: [0, 1] }
  const drawer = W.drawer({ kind: "stretch", stretch, index: 0, intervals: [
    { worker: 3, kind: "new_kind", start_ms: 0, end_ms: 1 },
    { worker: 0, kind: "new_kind", start_ms: 0, end_ms: 1 },
  ] })
  assert.deepEqual(drawer.evidence.map((record) => record.kind), ["new kind", "new kind"])
  assert.deepEqual(drawer.evidence.map((record) => record.lane), ["Subagent 3", "Main agent"])
  assert.deepEqual(W.drawer({ kind: "stretch", stretch }).evidence, [])
  assert.match(JSON.stringify(drawer.rows), /Stretch 1 in this session/)
})

test("A3_item_locators_keep_box_and_folded_wait_membership_with_or_without_summary_context", () => {
  const map = {
    bursts: [
      { start_ms: 0, end_ms: 1000, working_ms: measured(1000), sessions: [] },
      { start_ms: 2000, end_ms: 3000, working_ms: measured(1000), sessions: [] },
    ],
    gaps: [{ start_ms: 1000, end_ms: 2000, waited_on: "unknown" }],
  }
  const model = W.mapModel(map, { shortGapGrouping: true }), item = model.items[0]
  assert.equal(W.promptItem({ kind: "box", item }).select, "bursts=1-2")
  assert.equal(W.promptItem({ kind: "box", item }, { model }).select, "bursts=1-2")
  const folded = W.promptItem({ kind: "ladder", item, seg: { folded: true } })
  assert.match(folded.what, /short waits inside work box/)
  assert.equal(folded.select, "bursts=1-2")
  const stretch = { class: "support", start_ms: 0, end_ms: 1 }
  assert.match(W.promptItem({ kind: "stretch", stretch, index: 0 }).what, /stretch 1 in session/)
  const pause = { class: "muda", waste: "waiting", waited_on: "next_prompt", start_ms: 0, end_ms: 1 }
  assert.match(W.promptItem({ kind: "stretch", stretch: pause, index: 0 }).where, /lasted/)
})

test("box_drawer_partial_work_directions_and_missing_ranges_do_not_become_exact", () => {
  const base = W.mapModel({ bursts: [{ start_ms: 0, end_ms: 60000, working_ms: measured(60000), sessions: [] }] }).items[0]
  for (const bound of ["upper", "lower", null]) {
    const item = { ...base, burst_range: undefined, working_state: { state: "partial", value: 60000, bound, reasons: [] } }
    const drawer = W.drawer({ kind: "box", item })
    assert.match(JSON.stringify(drawer.rows), /partial/)
    if (bound === "upper") assert.match(JSON.stringify(drawer.rows), /at most/)
    if (bound === null) assert.doesNotMatch(drawer.rows.find(([key]) => key === "Working time")[1], /at least|at most/)
  }
  const item = { ...base, working_state: undefined, working_ms: 60000 }
  assert.match(JSON.stringify(W.drawer({ kind: "box", item }).rows), /1 minute/)
})

test("contained_wait_drawers_preserve_unknown_causes_when_optional_metadata_is_absent", () => {
  const item = {
    type: "box", box_no: 1, burst_range: [1, 1], inner_wait_ms: 1,
    inner_causes: [], inner_by: {}, start_ms: 0, end_ms: 2,
  }
  const drawer = W.drawer({ kind: "ladder", item, seg: { folded: true } })
  assert.match(JSON.stringify(drawer.rows), /cause not recorded/)
  const mixed = { ...item, inner_causes: ["next_prompt", "unknown"], inner_by: null }
  assert.match(JSON.stringify(W.drawer({ kind: "ladder", item: mixed, seg: { folded: true } }).rows), /next prompt/)
})

test("why_rows_keep_missing_stop_metadata_and_no_lead_denominator_unknown", () => {
  const rows = W.whyRows({ not_known: 1 }, [{ why: "not_known", reasons: [], next_prompt_ms: 1 }])
  assert.match(JSON.stringify(rows), /reason not recorded|not recorded/)
  assert.doesNotMatch(JSON.stringify(rows), /NaN|Infinity|of the lead time/)
  assert.match(JSON.stringify(W.whyRows({}, null)), /no waiting for the next prompt/)
})

test("partial_PR_drawers_do_not_upgrade_opening_to_merge_duration_to_exact", () => {
  const pr = {
    repo: "example/project", number: 1, created: false, state: "merged",
    opened_at_ms: 0, merged_at_ms: 60000,
    opened_state: { state: "partial", bound: "lower" },
    merged_state: { state: "partial", bound: "upper" },
  }
  const drawer = W.drawer({ kind: "pr", pr, k: 0 }, {})
  assert.match(drawer.rows.find(([key]) => key === "Opening to merge")[1], /about/)
  assert.doesNotMatch(JSON.stringify(drawer.rows), /NaN|Infinity/)
  const prompt = W.promptItem({ kind: "pr", pr, k: 0 })
  assert.ok(prompt.what.includes("pull request"))
})

test("prompt_day_precision_is_explicit_UTC_and_only_omits_the_given_matching_year", () => {
  assert.equal(W.promptDayWords("2026-10-14", { year: 2026 }), "14 Oct (UTC)")
  assert.equal(W.promptDayWords("2026-10-14", { year: 2025 }), "14 Oct 2026 (UTC)")
})

test("shared_label_and_lower_value_summaries_keep_their_partial_classification", () => {
  const row = {
    lead_time_ms: measured(10000), working_ms: { state: "partial", value: 5000, bound: "lower" },
    value_in_working_ms: measured(0), labels_from_shared_session: true,
  }
  assert.match(W.ledeText(W.lede(row)), /shared with other tasks/)
  const lower = { ...row, value_in_working_ms: { state: "partial", value: 1, bound: "lower", reasons: [] } }
  assert.match(W.ledeText(W.lede(lower)), /at least/)
  assert.match(W.taskSummary(lower).classification, /shared session/)
  const longest = { ...row, longest_gap: measured({ duration_ms: 1000, waited_on: "unsupported" }) }
  const lede = W.lede(longest, undefined, { idle: { state: "measured", value: 5000, by: [{ key: "unsupported", ms: 5000 }] } })
  assert.match(W.ledeText(lede), /cause not recorded/)
})

test("missing_optional_work_reasons_and_legacy_idle_metadata_do_not_change_number_state", () => {
  assert.equal(W.idleSplit({ lead_time_ms: measured(10) }, {}).state, "unavailable")
  const task = { lead_time_ms: measured(1000), working_ms: measured(500) }
  const stack = { ...task, idle_ms: measured(500) }
  assert.equal(W.timeBar(stack, task, null, []).state, "ok")
  assert.equal(W.timeBar({ ...task, working: null }, task, { state: "measured", value: 500, by: [] }, []).state, "ok")
  const summary = W.taskSummary(task, undefined, { idle: { value: 500, by: [] } })
  assert.match(summary.conclusion, /cannot yet say/)
  assert.equal(W.foldedGapAt({}, 1), null)
  assert.equal(W.foldedGapAt({ items: [{ type: "box" }] }, 1), null)
})

test("tiny_positive_next_prompt_wait_keeps_the_absent_classification_note", () => {
  const task = {
    lead_time_ms: measured(2), working_ms: measured(1),
    waiting_by_waited_on_ms: { next_prompt: measured(1) },
    next_prompt_by_why_ms: Object.fromEntries(W.WHY_KEYS.map((key) => [key, measured(0)])),
  }
  const bar = W.timeBar(task, task, { state: "measured", value: 1, by: [{ key: "next_prompt", ms: 1 }] }, [])
  assert.equal(bar.state, "ok")
  assert.ok(bar.notes.length)
})

test("simultaneous_PR_events_keep_open_before_merge_and_their_own_indices", () => {
  const prs = Array.from({ length: 100 }, (_, index) => ({
    repo: "example/project", number: index + 1, state: "merged",
    opened_at_ms: (index * 37) % 100, merged_at_ms: (index * 37) % 100,
  }))
  const clock = W.clockMarks({ prs }, { items: [{ type: "box", start_ms: 0, end_ms: 100, working_ms: 100, bursts: [], folded: [] }] })
  assert.equal(clock.prs.length, 200)
  for (let index = 0; index < prs.length; index++) {
    assert.deepEqual(clock.prs.filter((mark) => mark.k === index).map((mark) => mark.kind), ["opened", "merged"])
  }
})

test("prompt_handoffs_keep_missing_relations_and_after_window_placement_explicit", () => {
  const model = { items: [{ type: "box", box_no: 1, start_ms: 0, end_ms: 10 }], box_count: 1 }
  const mark = { n: 1, total: 1, ms: 20, outside: "after", frac: .5, item: 0 }
  const drawer = W.drawer({ kind: "prompt", mark }, { model })
  assert.match(JSON.stringify(drawer.rows), /after.*lead time ended/)
  const handoff = W.promptItem({ kind: "prompt", mark: { ...mark, turn: { basis: "after_stop", window_ms: 1 } } })
  assert.match(handoff.what, /operator prompt/)
  assert.match(handoff.where, /main agent stopped/)
  const unsupported = W.promptItem({ kind: "prompt", mark })
  assert.match(unsupported.what, /relation.*not recorded/)
  assert.deepEqual(W.handoffRows(null), [])
  assert.deepEqual(W.operatorLane(null), [])
  assert.deepEqual(W.prLane(null), { marks: [], outside: 0 })
})

test("legacy_projection_retains_optional_label_envelopes_and_filters_missing_stop_objects", () => {
  const map = W.slimMap({ timeline: {
    bursts_labels: { state: "unavailable" },
    waits: [{ session: "s", start_ms: 0, end_ms: 1, stop: "unsupported" }],
  } })
  assert.deepEqual(map.bursts_labels, { state: "unavailable", reasons: [] })
  assert.equal(map.waits[0].stop, null)
})

test("upper_value_bounds_and_missing_percentages_never_read_as_exact_population_shares", () => {
  const row = {
    job: "task", lead_time_ms: measured(10000), working_ms: measured(5000),
    value_in_working_ms: { state: "partial", value: 1, bound: "upper", reasons: ["log_truncated"] },
  }
  assert.match(W.ledeText(W.lede(row)), /at most/)
  const picks = W.pickerRows([{ id: "task", status: "processing" }], [{
    ...row, lead_time_ms: { state: "partial", value: 10000, bound: "lower" },
    flow_efficiency: { state: "measured", value: NaN },
  }], () => "Task")
  assert.equal(picks[0].feText, null)
  assert.doesNotMatch(JSON.stringify(picks), /NaN%/)
})

test("missing_session_offsets_and_missing_stop_reason_arrays_keep_native_fallbacks", () => {
  const map = {
    sessions: [{ id: "a" }, { id: "b" }],
    gaps: [{ start_ms: 0, end_ms: 10, waited_on: "next_prompt", idle_by_why_ms: { not_known: 10 } }],
    waits: [{ start_ms: 0, end_ms: 10, why: "not_known", reasons: "not_an_array" }],
  }
  const model = W.mapModel(map)
  assert.deepEqual(model.items[0].why_reasons, ["stop_not_recorded"])
  const box = W.mapModel({ bursts: [{
    start_ms: 0, end_ms: 10, working_ms: { state: "partial", value: 0, bound: "lower" }, sessions: [],
  }] }).items[0]
  assert.ok(W.dataBox(box, 0).some((row) => row.text.includes("none recorded")))
})

test("optional_clock_denominators_and_zero_reported_idle_are_not_fabricated_percentages", () => {
  const rows = W.whyRows({ not_known: 1 }, [{ why: "not_known", next_prompt_ms: null }], [])
  assert.doesNotMatch(JSON.stringify(rows), /counted as waiting/)
  const operator = W.operatorTime({ human_turns: measured(1), attention_ms: missing })
  assert.match(operator.text, /operator sent 1 prompt/)
  const span = W.boundedWords(1000, 2000)
  assert.doesNotMatch(span, /NaN|Infinity/)
  const task = { lead_time_ms: measured(1), working_ms: measured(1) }
  assert.equal(W.timeBar({ ...task, working: 0 }, task, { state: "measured", value: 0, by: [] }, []).state, "ok")
})

test("a_public_prompt_with_an_unrecorded_wait_and_no_list_reasons_keeps_the_limit_visible", () => {
  const mark = { n: 1, total: 1, ms: 0, turn: { basis: "after_stop" }, wait: { next_prompt_ms: null } }
  const drawer = W.drawer({ kind: "prompt", mark })
  assert.ok(drawer.rows.some(([key]) => key === "Why the agent stopped"))
  assert.match(W.clockListWords({ state: "unavailable" }, "Prompts"), /not recorded/)
  const mid = W.promptItem({ kind: "prompt", mark: { ...mark, turn: { basis: "mid_turn", window_ms: 1 } } })
  assert.match(mid.where, /previous prompt/)
  const unknownWindow = W.promptItem({ kind: "prompt", mark: { ...mark, turn: { basis: "mid_turn" } } })
  assert.doesNotMatch(unknownWindow.where, /previous prompt/)
})

test("legacy_wait_dtos_with_unknown_causes_keep_missing_work_and_ranges_explicit", () => {
  const item = {
    type: "wait", count: 1, start_ms: 0, end_ms: 1, duration_ms: 1,
    gap_range: [1, 1], gaps: [], waited_on: "mixed", causes: ["unknown"], by: {},
  }
  assert.match(JSON.stringify(W.drawer({ kind: "wait", item }).rows), /cause not recorded/)
  assert.ok(W.promptItem({ kind: "wait", item }).where.includes("starting at minute"))
  const emptyCause = { ...item, waited_on: "unknown", causes: [] }
  assert.equal(W.drawer({ kind: "wait", item: emptyCause }).cause, "unknown")
  const box = W.mapModel({ bursts: [{ start_ms: 0, end_ms: 1, working_ms: missing, sessions: [] }] }).items[0]
  const omittedReasons = { ...box, working_state: { state: "unavailable", reasons: [] } }
  assert.match(JSON.stringify(W.drawer({ kind: "box", item: omittedReasons }).rows), /no recorded working duration/)
  const upper = { ...box, working_state: { state: "partial", value: 1, bound: "upper" } }
  assert.match(JSON.stringify(W.drawer({ kind: "box", item: upper }).rows), /at most/)
})

test("clock_mark_geometry_without_step_metadata_keeps_both_lanes_and_finite_positions", () => {
  const clock = {
    prompts: [{ n: 1, ms: 0, item: 0, frac: .5, turn: {} }],
    prs: [{ kind: "opened", ms: 0, item: 0, frac: .5, pr: { repo: "example/project", number: 1 }, ref: { k: 0 } }],
  }
  assert.ok(W.ladderLanes(clock, null).prompts[0].label.includes("prompt"))
  assert.match(W.ladderLanes(clock, [{ item: [0, 10] }]).prs[0].label, /pull request/i)
  assert.ok(W.ladderLanes({ prompts: [], prs: clock.prs }, [{ work: [0, 10] }]).before.count === 0)
  assert.equal(W.boxPrCount({ prs: [] }, 0).value, 0)
})

test("duplicate_PR_evidence_keeps_the_stronger_creation_fact_without_an_invented_merge_time", () => {
  const list = [
    { repo: "example/project", number: 1, created: null },
    { repo: "example/project", number: 1, created: true, at_ms: 0 },
    { repo: "example/project", number: 2, created: null },
    { repo: "example/project", number: 2, created: false },
  ]
  const clock = W.prClock(list, null)
  assert.equal(clock.prs.length, 2)
  assert.equal(clock.prs[0].created, true)
  assert.equal(clock.prs[1].created, false)
  const unanchored = W.placePrs([{ repo: "example/project", number: 1 }], new Map([
    ["example/project#1", { merged: true, merged_at: null }],
  ]))
  assert.equal(unanchored[0].merged_at_ms, null)
})

test("exported_duration_parts_retains_its_own_public_normalization_boundary", () => {
  for (const value of [undefined, null, NaN, -1, "", "bad"]) {
    assert.equal(W.durationParts(value), null)
    assert.deepEqual(W.durationParts(value, "lower"), { n: 0, unit: "ms" })
  }
  assert.deepEqual(W.durationParts("1000"), { n: 1, unit: "s" })
})

test("legacy_unavailable_work_spans_and_all_partial_directions_remain_honest", () => {
  const box = W.mapModel({ bursts: [{ start_ms: 0, end_ms: 60000, working_ms: missing, sessions: [] }] }).items[0]
  assert.match(W.dataBox(box, 0)[0].text, /\(span\)/)
  for (const bound of [null, "unknown", "upper", "lower"]) {
    const partialBox = { ...box, working_state: { state: "partial", value: 60000, bound, reasons: [] } }
    assert.match(JSON.stringify(W.drawer({ kind: "box", item: partialBox }).rows), /partial/)
  }
})

test("legacy_stack_rows_with_non_object_working_still_use_the_task_split", () => {
  const row = { lead_time_ms: measured(20), working_ms: measured(10) }
  const idle = { state: "measured", value: 10, by: [{ key: "unknown", ms: 10 }] }
  assert.equal(W.timeBar({ working: 1 }, row, idle, []).state, "ok")
})

test("public_mark_labels_keep_lower_unknown_and_upper_partial_directions", () => {
  for (const bound of ["lower", null, "upper"]) {
    const mark = { kind: "opened", pr: { repo: "example/project", number: 1 }, state: "partial", bound, ms: 1000 }
    assert.match(W.markLine(mark), /example\/project#1/)
    assert.match(W.markLine(mark, 0), /minute/)
    const lane = W.ladderLanes({ prompts: [], prs: [{ ...mark, item: 0, frac: .5, step: "work" }] }, [{ work: [0, 10] }])
    assert.equal(lane.prs.length, 1)
    assert.ok(Number.isFinite(lane.prs[0].pos))
  }
})

test("public_step_placement_accepts_out_of_order_legacy_folded_intervals", () => {
  const item = { type: "box", folded: [{ start_ms: 100, end_ms: 200 }, { start_ms: 0, end_ms: 10 }], inner_wait_ms: 110 }
  assert.equal(W.stepPlace(item, 5).step, "fold")
  assert.equal(W.stepPlace(item, NaN), null)
  assert.equal(W.stepPlace(null, 0), null)
})

test("outside_prompt_margin_plural_and_optional_box_totals_remain_precise", () => {
  const model = W.mapModel({ bursts: [{ start_ms: 0, end_ms: 10, working_ms: measured(10), sessions: [] }] })
  const clock = W.clockMarks({ human_turns: [{ at_ms: -2 }, { at_ms: -1 }] }, model)
  assert.match(W.ladderLanes(clock, [10]).before.short, /2 prompts/)
  const p = { ...W.clockMarks({ human_turns: [{ at_ms: 5 }] }, model).prompts[0] }
  const noTotal = { ...model, box_count: 0 }
  assert.match(JSON.stringify(W.drawer({ kind: "prompt", mark: p }, { model: noTotal })), /work box/)
  const wait = { type: "wait", gap_range: [1, 1], duration_ms: 1, start_ms: 0, end_ms: 1, waited_on: "unknown" }
  assert.match(W.promptItem({ kind: "wait", item: wait }, { origin_ms: 0 }).where, /minute 0/)
})

test("native_sorting_preserves_tied_burst_gap_and_PR_events_under_permuted_input", () => {
  let state = 7
  const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
  for (let pass = 0; pass < 100; pass++) {
    const bursts = Array.from({ length: 25 }, () => {
      const start = Math.floor(rand() * 5) * 100
      return { start_ms: start, end_ms: start + 10, working_ms: measured(10), sessions: [] }
    })
    const gaps = Array.from({ length: 25 }, () => {
      const start = Math.floor(rand() * 5) * 100
      return { start_ms: start, end_ms: start + 10, waited_on: "unknown" }
    })
    assert.ok(W.mapModel({ bursts, gaps }, { shortGapGrouping: true }).items.length > 0)
    const prs = Array.from({ length: 100 }, (_, number) => {
      const t = Math.floor(rand() * 5) * 100
      return { repo: "example/project", number: number + 1, opened_at_ms: t, merged_at_ms: t, state: "merged" }
    })
    const marks = W.clockMarks({ prs }, null).prs
    for (let i = 1; i < marks.length; i++) assert.ok(marks[i].ms >= marks[i - 1].ms)
    for (const pr of prs) {
      const pair = marks.filter((mark) => mark.pr === pr)
      assert.deepEqual(pair.map((mark) => mark.kind), ["opened", "merged"])
    }
  }
})

test("public_missing_clock_reasons_and_wait_item_locations_are_not_invented", () => {
  assert.equal(W.prTimeWords(null, { state: "unavailable" }), "not placed on the task clock")
  const clock = W.clockMarks({ prs: [{ opened_state: { state: "unavailable" } }] }, null)
  assert.deepEqual(clock.unplaced[0].reasons, [])
  const model = W.mapModel({ gaps: [{ start_ms: 0, end_ms: 10, waited_on: "unknown" }] }, { shortGapGrouping: true })
  const p = W.clockMarks({ human_turns: [{ at_ms: 5 }] }, model).prompts[0]
  assert.match(JSON.stringify(W.drawer({ kind: "prompt", mark: p }, { model })), /inside the wait/)
  assert.deepEqual(W.stretchWorkers({ evidence: null }, []), [])
})

test("box_drawers_keep_explicit_no_direction_reasons_for_incomplete_work", () => {
  const model = W.mapModel({ bursts: [{ start_ms: 0, end_ms: 10, working_ms: measured(10), sessions: [] }] })
  const item = { ...model.items[0], working_state: { state: "partial", value: 10, bound: null, bound_reason: "clock_skew_conflict", reasons: [] } }
  assert.match(JSON.stringify(W.drawer({ kind: "box", item }).rows), /direction not known, because clock skew conflict/)
})
