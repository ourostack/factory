// Step 1 of the walk, "Follow a task": the lede's templates per number
// state, the value stream map's folding (which must never lose time), the
// timeline ladder, the picker's order, the evidence drawer, the prompt for
// an agent, the slim map file the Pages build writes, the swimlane's lanes
// and marks, and the page's honest behavior when the walk's files are not
// published.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { llmsText, publishData, sizeLine } from "../../../site/scripts/publish-files.mjs"

const require = createRequire(import.meta.url)
const W = require("../../../site/src/walk.js")
const F = require("../../../site/src/format.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const H = 3600000
const M = 60000
const m = (value, reasons = []) => ({ class: "inferred", state: "measured", value, reasons })
const p = (value, reasons) => ({ class: "inferred", state: "partial", value, reasons })
const u = (reasons) => ({ class: "inferred", state: "unavailable", reasons })
const waits = (next_prompt, extra = {}) => ({ next_prompt: m(next_prompt), api_retry: m(0), tool_failure: m(0), long_tool_call: m(0), unknown: m(0), ...extra })

// A task row as rollups/tasks.json writes it (job 825084c9's numbers).
function row825(over = {}) {
  const r = ["card_dates_shorter_than_work"]
  return {
    job: "825084c9676f1da79f49e868ff950abb",
    status: { class: "declared", state: "measured", value: "done", reasons: [] },
    labels_from_shared_session: false,
    lead_time_ms: p(193344986, r),
    working_ms: p(62609950, r),
    value_in_working_ms: p(532, r),
    flow_efficiency: p(0.32382505124803185, r),
    waiting_by_waited_on_ms: { next_prompt: p(130484670, r), api_retry: p(0, r), tool_failure: p(0, r), long_tool_call: p(0, r), unknown: p(0, r) },
    agents_working_unlabeled_ms: p(12721842, r),
    top_causes: p([{ cause: "waiting:next_prompt", hours: 36.2, total_ms: 130484670 }, { cause: "defects:shell", hours: 0.05, total_ms: 164857 }], r),
    longest_gap: p({ start_ms: 104435005, end_ms: 171718276, duration_ms: 67283271, waited_on: "next_prompt" }, r),
    bursts: p(13, r),
    ...over,
  }
}

// ---------------------------------------------------------------- the lede

// The idle split of 825084c9 as its map gives it: 36.25 hours waiting for
// the next prompt and 4 minutes whose cause is not recorded.
const idle825 = (row) => W.idleSplit(row, {
  bursts: [{ start_ms: 0, end_ms: 62609950 + 4 * M, working_ms: 62609950 }],
  gaps: [{ start_ms: 62609950 + 4 * M, end_ms: 193344986, waited_on: "next_prompt" }],
})

test("the lede: partial, counted from the first session, with working and value-adding time apart and one waiting sentence when one cause covers it", () => {
  const row = row825()
  const model = W.lede(row, F.reasonText, { idle: idle825(row) })
  assert.equal(model.state, "ok")
  const text = W.ledeText(model)
  assert.match(text, /^This task took at least 54 hours, counted from its first session because its card \(its record on the desk\) was created after work began\./)
  assert.match(text, /Agents were working for 17 hours of it; the evaluator \(an independent agent that labels the work\) judged under a second of that work value-adding/)
  // One cause covers 95% or more: one sentence, one number (I3).
  // 4 of its minutes have no recorded cause, so it is "nearly all", never "all" (R5).
  assert.match(text, /Most of the 54 hours was waiting, not work: 36 hours, nearly all of it \(99% of the waiting\) while the agent had stopped and was waiting for the operator's next prompt\./)
  // When one cause is all of it, the sentence says so without a share.
  const whole = W.idleSplit(row, { bursts: [{ start_ms: 0, end_ms: 62609950, working_ms: 62609950 }], gaps: [{ start_ms: 62609950, end_ms: 193344986, waited_on: "next_prompt" }] })
  assert.match(W.ledeText(W.lede(row, F.reasonText, { idle: whole })), /Most of the 54 hours was waiting, not work: for 36 hours the agent had stopped and was waiting for the operator's next prompt\./)
  assert.doesNotMatch(text, /in all/)
  assert.match(text, /The longest single wait was 19 hours, also for the next prompt\./)
  // Flow efficiency is defined in place; a lead time that is a lower bound makes it an upper bound.
  assert.match(text, /working time divided by lead time is called flow efficiency; here it is at most 32%\. A low number is normal/)
  assert.doesNotMatch(text, /\byou(r)?\b/i, "public copy says the operator")
  // Every number is a token the page turns into a button.
  const keys = model.parts.filter((x) => typeof x === "object" && !x.term).map((x) => x.key)
  assert.deepEqual(keys, ["lead", "working", "value", "waiting", "longest", "fe"])
})

test("the lede: waiting with several causes gives the total, then its largest part as its own number, and says what was not recorded", () => {
  const row = row825({ lead_time_ms: m(10 * H), working_ms: m(2 * H), flow_efficiency: m(0.2), longest_gap: m({ start_ms: 0, end_ms: 4 * H, duration_ms: 4 * H, waited_on: "queue_before_start" }) })
  const idle = W.idleSplit(row, {
    bursts: [{ start_ms: 4 * H, end_ms: 6 * H + 30 * M, working_ms: 2 * H }],
    gaps: [{ start_ms: 0, end_ms: 4 * H, waited_on: "queue_before_start" }, { start_ms: 6 * H + 30 * M, end_ms: 10 * H, waited_on: "next_prompt" }],
  })
  assert.deepEqual(idle.by.map((x) => [x.key, x.ms]), [["queue_before_start", 4 * H], ["next_prompt", 3.5 * H], ["unknown", 30 * M]])
  const model = W.lede(row, F.reasonText, { idle })
  const t = W.ledeText(model)
  assert.match(t, /Most of the 10 hours was waiting, not work: 8 hours in all\. The largest part, 4 hours, was while the task was waiting for its first session to start\. What 30 minutes of it waited on was not recorded\./)
  assert.match(t, /The longest single wait was 4 hours, also before the first session\./)
  const cause = model.parts.find((x) => x.key === "wait_cause")
  assert.equal(cause.cause, "queue_before_start", "the cause's number lights only that cause")
  // Under half the lead time: "Of the N, M was waiting" (M1), and no "a low number is normal" above one half (M2).
  const busy = row825({ lead_time_ms: m(10 * H), working_ms: m(8 * H), flow_efficiency: m(0.8), longest_gap: u(["no_gaps"]) })
  const bt = W.ledeText(W.lede(busy, F.reasonText, { idle: W.idleSplit(busy, { bursts: [{ start_ms: 0, end_ms: 8 * H, working_ms: 8 * H }], gaps: [{ start_ms: 8 * H, end_ms: 10 * H, waited_on: "next_prompt" }] }) }))
  assert.match(bt, /Of the 10 hours, 2 hours was waiting, all of it while the agent had stopped and was waiting for the operator's next prompt\./)
  assert.doesNotMatch(bt, /A low number is normal/)
})

test("the lede: a partial working time prints as at least, and the waiting derived from it as at most (I2)", () => {
  const row = row825({ lead_time_ms: m(10 * H), working_ms: p(4 * H, ["log_truncated"]), flow_efficiency: p(0.4, ["log_truncated"]), value_in_working_ms: u(["log_truncated"]), longest_gap: u(["log_truncated"]) })
  const idle = W.idleSplit(row, null)
  assert.equal(idle.bound, "upper")
  const t = W.ledeText(W.lede(row, F.reasonText, { idle }))
  assert.match(t, /Agents were working for at least 4 hours of it \(a lower bound: a session's log was cut short\)/)
  assert.match(t, /Most of the 10 hours was waiting, not work: for at most 6 hours/)
  assert.match(t, /here it is at least 40%/)
  // Only the reasons that make it a bound are named there; a shared session's labels are said once, elsewhere.
  const shared = row825({ lead_time_ms: m(10 * H), working_ms: p(4 * H, ["labels_from_shared_session", "log_truncated"]), labels_from_shared_session: true })
  assert.match(W.ledeText(W.lede(shared, F.reasonText)), /at least 4 hours of it \(a lower bound: a session's log was cut short\)/)
  assert.equal(W.reworkWords({ defect_stretches: p(1, ["x"]), defect_ms: p(1000, ["x"]) }), "at least 1 defect stretch, 1 second")
  // An upper-bound working time makes the waiting a lower bound.
  const up = row825({ lead_time_ms: m(10 * H), working_ms: { ...p(4 * H, ["log_truncated"]), bound: "upper" } })
  assert.equal(W.idleSplit(up, null).bound, "lower")
  // A lead time and a working time both partial in other ways leave the waiting unbounded, and the lede says so.
  const both = row825({ lead_time_ms: p(10 * H, ["log_truncated"]), working_ms: p(4 * H, ["log_truncated"]), longest_gap: u(["log_truncated"]) })
  const bi = W.idleSplit(both, null)
  assert.equal(bi.bound, "unknown")
  assert.match(W.ledeText(W.lede(both, F.reasonText, { idle: bi })), /about 6 hours .*not bounded/)
})

test("the lede reads a true zero as none and an unlabeled task without repeating itself", () => {
  const zero = row825({ lead_time_ms: m(100 * H), working_ms: m(36000), value_in_working_ms: m(0), flow_efficiency: m(0.0001) })
  assert.match(W.ledeText(W.lede(zero, F.reasonText)), /the evaluator \(an independent agent that labels the work\) judged none of that work value-adding/)
  assert.equal(W.durationWords(0), "none")
  assert.equal(W.durationWords(400), "under a second")
  const unl = row825({ lead_time_ms: m(10 * H), working_ms: m(2 * H), value_in_working_ms: u(["not_labeled"]), flow_efficiency: m(0.2) })
  const t = W.ledeText(W.lede(unl, F.reasonText))
  assert.match(t, /that work is not labeled yet, so how much of it added value is not known\./)
  assert.doesNotMatch(t, /not labeled yet \(not labeled/)
})

test("the lede: a measured task, a generic partial, an open task, and labels from a shared session", () => {
  const measured = row825({
    lead_time_ms: m(23579000),
    working_ms: m(3570042),
    value_in_working_ms: p(1798453, ["labels_from_shared_session"]),
    flow_efficiency: m(0.1514),
    labels_from_shared_session: true,
    waiting_by_waited_on_ms: waits(0, { long_tool_call: m(321567) }),
    longest_gap: m({ start_ms: 0, end_ms: 8101680, duration_ms: 8101680, waited_on: "unknown" }),
  })
  const t = W.ledeText(W.lede(measured, F.reasonText))
  assert.match(t, /^This task took 6\.5 hours from the creation of its card \(its record on the desk\) to its end\./)
  assert.match(t, /Those labels come from a session this task shared with other tasks, so that split is partial\./)
  // The labeled waiting stretches (5 minutes of long tool calls) are not the answer to where 5.6 hours of idle time went (C1).
  assert.doesNotMatch(t, /Long tool calls/)
  assert.match(t, /Most of the 6\.5 hours was waiting, not work: for 5\.6 hours no agent was working on this task, and the cause was not recorded\./)
  assert.match(t, /The longest single wait was 2\.3 hours, also with its cause not recorded\./)
  assert.match(t, /here it is 15%\./)

  const generic = W.ledeText(W.lede(row825({ lead_time_ms: p(4 * H, ["log_truncated"]), flow_efficiency: p(0.5, ["log_truncated"]), working_ms: m(2 * H) }), F.reasonText))
  assert.match(generic, /^This task took 4 hours, a partial figure: a session's log was cut short\./)
  assert.match(generic, /here it is 50% \(partial\)/)

  const open = row825({ lead_time_ms: p(377807798, ["censored"]), working_ms: p(115353171, ["censored"]), value_in_working_ms: u(["open_job"]), flow_efficiency: p(0.31, ["censored"]), waiting_by_waited_on_ms: { next_prompt: u(["open_job"]) } })
  const ot = W.ledeText(W.lede(open, F.reasonText))
  assert.match(ot, /^This task is still open\. So far it has taken at least 4\.4 days\./)
  assert.match(ot, /Agents were working for at least 32 hours of it; that work is not labeled yet \(the job is still open\), so how much of it added value is not known\./)
  assert.match(ot, /here it is 31% so far\./)
})

test("the lede: an unavailable lead time says why in words and prints no figure", () => {
  const row = row825({ lead_time_ms: u(["cancelled"]), working_ms: u(["cancelled"]), value_in_working_ms: u(["cancelled"]), flow_efficiency: u(["cancelled"]), longest_gap: u(["cancelled"]) })
  const model = W.lede(row, F.reasonText)
  const t = W.ledeText(model)
  assert.match(t, /^This task's lead time is not measured, because the job was cancelled\./)
  assert.match(t, /How long agents were working is not measured, because the job was cancelled\./)
  assert.match(t, /flow efficiency; it is not measured for this task, because the job was cancelled\./)
  assert.doesNotMatch(t, /\d/, "no digit is printed for a figure that was not measured")
  assert.equal(model.parts.filter((x) => typeof x === "object" && !x.term).length, 0)
})

test("the lede degrades honestly: no tasks file, or no row for this task, is said in words, never as zeros", () => {
  const absent = W.lede(null, F.reasonText, { published: false })
  assert.equal(absent.state, "absent")
  assert.match(W.ledeText(absent), /not published yet/)
  assert.doesNotMatch(W.ledeText(absent), /\d/)
  const noRow = W.lede(null, F.reasonText, { published: true })
  assert.equal(noRow.state, "no_row")
  assert.match(W.ledeText(noRow), /no row in the walk's data/)
  assert.doesNotMatch(W.ledeText(noRow), /\d/)
})

test("durations in words and in short labels use hours up to three days", () => {
  assert.equal(W.durationWords(400), "under a second")
  assert.equal(W.durationWords(40000), "40 seconds")
  assert.equal(W.durationWords(12 * M), "12 minutes")
  assert.equal(W.durationWords(4.26 * H), "4.3 hours")
  assert.equal(W.durationWords(53.7 * H), "54 hours")
  assert.equal(W.durationWords(4.5 * 24 * H), "4.5 days")
  assert.equal(W.durationShort(0), "0s")
  assert.equal(W.durationShort(48 * H), "48h")
  assert.equal(W.durationShort(80 * H), "3.3d")
})

// ------------------------------------------------------ the value stream map

// A task of n bursts with gaps between them, plus a queue before the first.
function synthetic(n, seed = 1) {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const bursts = []
  const gaps = []
  let t = 0
  gaps.push({ start_ms: t, end_ms: (t += Math.round(rnd() * 3 * H)), waited_on: "queue_before_start" })
  for (let i = 0; i < n; i++) {
    const span = Math.round(rnd() * 2 * H) + 1000
    const working = Math.round(span * (0.7 + 0.3 * rnd()))
    bursts.push({ start_ms: t, end_ms: t + span, working_ms: working, sessions: [`s${i % 3}`], agents: 1 + (i % 4), tool_calls: 10 + i, tool_failures: i % 3, operator_turns: 1, prs: i % 5 === 0 ? 1 : 0, value_ms: 100 * i, defect_ms: i % 2 ? 2000 : 0, defect_stretches: i % 2 })
    t += span
    if (i < n - 1) {
      const g = Math.round(rnd() ** 3 * 20 * H)
      if (g > 0) gaps.push({ start_ms: t, end_ms: (t += g), waited_on: i % 4 === 0 ? "api_retry" : "next_prompt" })
    }
  }
  gaps.push({ start_ms: t, end_ms: t + 5 * M, waited_on: "unknown" })
  t += 5 * M
  return { bursts, gaps, lead_window: { start_ms: 0, end_ms: t, state: "measured", reasons: [] }, sessions: [{ id: "s0", offset_ms: 0 }, { id: "s1", offset_ms: 10 }, { id: "s2", offset_ms: 20 }] }
}

test("folding short waits never loses time: working + waits inside boxes + waits between boxes equals the lead window", () => {
  for (const [n, maxBoxes] of [[1, 7], [13, 4], [13, 7], [40, 3], [210, 6], [210, 1]]) {
    const map = synthetic(n, n * 7 + maxBoxes)
    const model = W.mapModel(map, { maxBoxes })
    const lead = map.lead_window.end_ms - map.lead_window.start_ms
    assert.equal(model.totals.lead_ms, lead, `n=${n}`)
    assert.equal(model.totals.working_ms, map.bursts.reduce((a, b) => a + b.working_ms, 0))
    const boxes = model.items.filter((x) => x.type === "box")
    assert.ok(boxes.length <= maxBoxes, `n=${n}: ${boxes.length} boxes`)
    // Every burst and every gap lands in exactly one item.
    assert.equal(boxes.reduce((a, b) => a + b.count, 0), n)
    const gapsUsed = model.items.reduce((a, it) => a + (it.type === "wait" ? it.gaps.length : it.folded.length), 0)
    assert.equal(gapsUsed, map.gaps.length)
    // Counts add up too.
    assert.equal(boxes.reduce((a, b) => a + b.tool_calls.value, 0), map.bursts.reduce((a, b) => a + b.tool_calls, 0))
    assert.equal(boxes.reduce((a, b) => a + b.defect_stretches.value, 0), map.bursts.reduce((a, b) => a + b.defect_stretches, 0))
    // Items run in clock order, and a folded wait is shorter than the stated threshold.
    for (let i = 1; i < model.items.length; i++) assert.ok(model.items[i].start_ms >= model.items[i - 1].start_ms)
    for (const b of boxes) for (const g of b.folded) assert.ok(g.end_ms - g.start_ms < model.fold_ms)
    for (const w of model.items.filter((x) => x.type === "wait")) {
      if (w.gaps.some((g) => g.end_ms - g.start_ms >= model.fold_ms)) continue
      // A wait made only of short gaps sits where no box could take them: before any burst with no burst after, or at the end.
      assert.ok(w === model.items[model.items.length - 1] || w === model.items[0], "short gaps fold into a box when one is beside them")
    }
    // The ladder carries the same total.
    assert.equal(W.ladder(model).reduce((a, s) => a + s.ms, 0), lead)
  }
})

test("with no fold, every burst has its own box and every gap its own triangle; the fold is stated in words", () => {
  const map = synthetic(4, 3)
  const model = W.mapModel(map, { maxBoxes: 10 })
  assert.equal(model.fold_ms, 0)
  assert.equal(model.items.filter((x) => x.type === "box").length, 4)
  assert.match(W.foldWords(model), /Every work burst has its own box/)
  const folded = W.mapModel(synthetic(40, 9), { maxBoxes: 3 })
  assert.ok(folded.fold_ms > 0)
  assert.match(W.foldWords(folded), /^Waits shorter than .+ are folded into the box beside them/)
})

test("the data box keeps the design's order, the rework loop counts defect stretches, and sessions read k of n", () => {
  const map = synthetic(3, 5)
  const model = W.mapModel(map, { maxBoxes: 10 })
  const box = model.items.find((x) => x.type === "box" && x.defect_stretches)
  // The pull requests opened in each box are back (v1.1 addendum §3): pull request times are on the task clock.
  assert.deepEqual(W.dataBox(box, model.session_count).map((r) => r.label), ["Working time", "Agents", "Tool calls", "Failed tool calls", "Operator turns", "Pull requests first appeared", "Session"])
  assert.equal(W.reworkWords({ defect_stretches: 12, defect_ms: 3 * M }), "12 defect stretches, 3 minutes")
  assert.equal(W.reworkWords({ defect_stretches: 0, defect_ms: 0 }), null)
  assert.equal(W.reworkWords({ defect_stretches: u(["not_labeled"]), defect_ms: u(["not_labeled"]) }), null, "an unlabeled box draws no loop")
  assert.equal(W.sessionWords([1], 1), "session 1 of 1")
  assert.equal(W.sessionWords([1, 2], 3), "sessions 1–2 of 3")
  assert.equal(W.sessionWords([1, 3], 3), "sessions 1, 3 of 3")
})

test("the ladder: a box is low, a wait is high, and a box's folded waits are a small high step after it", () => {
  const map = {
    bursts: [{ start_ms: 0, end_ms: 10 * M, working_ms: 9 * M, sessions: ["a"] }, { start_ms: 12 * M, end_ms: 20 * M, working_ms: 8 * M, sessions: ["a"] }],
    gaps: [{ start_ms: 10 * M, end_ms: 12 * M, waited_on: "next_prompt" }, { start_ms: 20 * M, end_ms: 5 * H, waited_on: "next_prompt" }],
    sessions: [{ id: "a", offset_ms: 0 }],
  }
  const model = W.mapModel(map, { maxBoxes: 1 })
  const segs = W.ladder(model)
  assert.deepEqual(segs.map((s) => [s.level, !!s.folded, s.ms]), [["low", false, 17 * M], ["high", true, 3 * M], ["high", false, 5 * H - 20 * M]])
  assert.equal(segs[1].label, "+3m")
})

test("card status changes sit over the item they fall in, and the last seen status is added once", () => {
  const map = synthetic(3, 2)
  const model = W.mapModel(map, { maxBoxes: 10 })
  const mid = model.items[2]
  const marks = W.statusMarks({ ...map, transitions: [{ offset_ms: mid.start_ms + 1, to: "processing" }], observations: [{ offset_ms: null, status: "done" }] }, model)
  assert.deepEqual(marks, [{ status: "processing", item: 2, observed: false }, { status: "done", item: model.items.length - 1, observed: true }])
  const same = W.statusMarks({ ...map, transitions: [{ offset_ms: 0, to: "done" }], observations: [{ offset_ms: 5, status: "done" }] }, model)
  assert.equal(same.length, 1)
})

test("burst fields stated as envelopes never read as zero: a box sums them and says no data or at least", () => {
  const b = (start, over) => ({ start_ms: start, end_ms: start + 10 * M, working_ms: 9 * M, sessions: ["a"], agents: m(1), tool_calls: m(4), tool_failures: m(1), operator_turns: m(1), prs: m(0), value_ms: u(["not_labeled"]), defect_ms: u(["not_labeled"]), defect_stretches: u(["not_labeled"]), ...over })
  const map = {
    bursts: [b(0, {}), b(11 * M, { operator_turns: u(["not_recorded"]), working_ms: u(["source_unreadable"]) })],
    gaps: [{ start_ms: 10 * M, end_ms: 11 * M, waited_on: "next_prompt" }],
    sessions: [{ id: "a", offset_ms: 0 }],
  }
  const model = W.mapModel(map, { maxBoxes: 1 })
  const box = model.items[0]
  assert.equal(box.tool_calls.state, "measured")
  assert.equal(box.tool_calls.value, 8)
  assert.deepEqual(box.operator_turns, { state: "partial", value: 1, bound: "lower", reasons: ["not_recorded"] })
  assert.equal(box.value_ms.state, "unavailable")
  const rows = Object.fromEntries(W.dataBox(box, 1).map((r) => [r.label, r.text]))
  assert.equal(rows["Operator turns"], "at least 1")
  assert.equal(rows["Pull requests"], undefined, "no pull request count per box")
  assert.equal(rows["Working time"], "at least 19m")
  const d = Object.fromEntries(W.drawer({ kind: "box", item: box }, { origin_ms: 0, lead_ms: 21 * M, reasonText: F.reasonText }).rows)
  assert.equal(d["Value-adding, as labeled"], "not labeled yet")
  assert.equal(d["Defects, as labeled"], "not labeled yet")
  // Totals still hold: a burst with no stated working time counts its span.
  assert.equal(model.totals.lead_ms, 21 * M)
  // An enveloped bursts list reads too.
  const env = W.mapModel({ bursts: { state: "partial", reasons: ["source_unreadable"], items: map.bursts }, gaps: { state: "partial", reasons: [], items: map.gaps } }, { maxBoxes: 3 })
  assert.equal(env.items.length, 3)
  assert.deepEqual(W.slimMap({ timeline: { bursts: { state: "partial", reasons: ["source_unreadable"], items: [] } } }).bursts_state, { state: "partial", reasons: ["source_unreadable"] })
})

// ------------------------------------------- where this task's time went

test("the task's bar has two groups that sum to its lead time: working by label, then waiting by cause", () => {
  const r = ["card_dates_shorter_than_work"]
  // Today's stack-up row: labels may also cover idle time, and "not labeled yet" covers both.
  const stack = {
    lead_time_ms: p(10 * H, r),
    class_ms: { value: p(1 * H, r), support: p(2 * H, r) },
    waste_ms: { waiting: p(5 * H, r), defects: p(0.5 * H, r), extra_processing: p(0, r), unknown: p(0, r) },
    agents_working_unlabeled_ms: p(0.25 * H, r),
    not_labeled_ms: p(1.25 * H, r),
    no_session_ms: p(0, r),
  }
  const row = { lead_time_ms: p(10 * H, r), working_ms: p(4 * H, r) }
  const idle = W.idleSplit(row, { bursts: [{ start_ms: 0, end_ms: 4.5 * H, working_ms: 4 * H }], gaps: [{ start_ms: 4.5 * H, end_ms: 10 * H, waited_on: "next_prompt" }] })
  const bar = W.timeBar(stack, row, idle, F.SEGMENTS)
  assert.equal(bar.state, "ok")
  assert.deepEqual(bar.groups.map((g) => g.key), ["working", "waiting"])
  assert.deepEqual(bar.groups[0].segments.map((s) => s.key), ["value", "support", "defects", "agents_working_unlabeled", "not_labeled"])
  assert.equal(bar.groups[0].segments.find((s) => s.key === "not_labeled").ms, 0.25 * H, "not labeled yet is the working time no label covers")
  assert.deepEqual(bar.groups[1].segments.map((s) => [s.cause, s.ms]), [["next_prompt", 5.5 * H], ["unknown", 0.5 * H]])
  assert.equal(bar.groups[0].ms, 4 * H)
  assert.equal(bar.groups[1].ms, 6 * H)
  assert.equal(bar.segments.reduce((a, s) => a + s.ms, 0), bar.total_ms)
  assert.ok(!bar.segments.some((s) => s.key === "waiting" || s.key === "no_session"), "labeled waiting is not drawn as working")
  assert.equal(bar.partial, true)
  // Labels that cover more than the working time are not drawn as a split.
  const over = W.timeBar({ ...stack, class_ms: { value: p(5 * H, r), support: p(0, r) } }, row, idle, F.SEGMENTS)
  assert.deepEqual(over.groups[0].segments.map((s) => s.key), ["working_unsplit"])
  assert.match(over.notes[0], /labels also cover idle time/)
  // Desk's split rows (idle_ms): labels are working time only and read as they are.
  const split = W.timeBar({ ...stack, idle_ms: p(6 * H, r), not_labeled_ms: p(0.25 * H, r) }, row, idle, F.SEGMENTS)
  assert.deepEqual(split.groups[0].segments.map((s) => [s.key, s.ms]), [["value", H], ["support", 2 * H], ["defects", 0.5 * H], ["agents_working_unlabeled", 0.25 * H], ["not_labeled", 0.25 * H]])
  assert.equal(W.timeBar(null, null, idle, F.SEGMENTS).state, "absent")
  assert.equal(W.timeBar({ lead_time_ms: u(["cancelled"]) }, null, idle, F.SEGMENTS).state, "unavailable")
})

test("Desk's split stack-up rows (working and idle parts) read as they are, and a task with no working time draws its lead time alone", () => {
  const r = ["labels_from_shared_session"]
  const stack = {
    lead_time_ms: m(10 * H),
    working_ms: p(4 * H, r),
    idle_ms: p(6 * H, r),
    working: { class_ms: { value: p(H, r), support: p(2 * H, r) }, waste_ms: { defects: p(0.5 * H, r) }, agents_working_unlabeled_ms: p(0.25 * H, r), not_labeled_ms: p(0.25 * H, r) },
    idle: { next_prompt: p(5 * H, r), long_tool_call: p(0.5 * H, r), unknown: p(0.5 * H, r) },
  }
  const row = { lead_time_ms: m(10 * H), working_ms: p(4 * H, r), idle_ms: p(6 * H, r), waiting_by_waited_on_ms: stack.idle }
  const bar = W.timeBar(stack, row, W.idleSplit(row, null), F.SEGMENTS)
  assert.deepEqual(bar.groups[0].segments.map((x) => [x.key, x.ms]), [["value", H], ["support", 2 * H], ["defects", 0.5 * H], ["agents_working_unlabeled", 0.25 * H], ["not_labeled", 0.25 * H]])
  assert.deepEqual(bar.groups[1].segments.map((x) => [x.cause, x.ms]), [["next_prompt", 5 * H], ["long_tool_call", 0.5 * H], ["unknown", 0.5 * H]])
  // With no task row, the stack-up row's own idle split is used.
  assert.equal(W.timeBar(stack, null, null, F.SEGMENTS).groups[1].ms, 6 * H)
  const gone = W.timeBar({ lead_time_ms: m(10 * H), working_ms: u(["source_unreadable"]), idle_ms: u(["source_unreadable"]) }, { lead_time_ms: m(10 * H), working_ms: u(["source_unreadable"]), idle_ms: u(["source_unreadable"]) }, W.idleSplit({ lead_time_ms: m(10 * H), working_ms: u(["source_unreadable"]), idle_ms: u(["source_unreadable"]) }, null), F.SEGMENTS)
  assert.equal(gone.state, "lead_only")
  assert.equal(gone.total_ms, 10 * H)
  assert.deepEqual(gone.reasons, ["source_unreadable"])
  assert.match(read("site/src/app.js"), /How it splits into working and waiting is not known, because/)
  assert.match(read("site/src/app.js"), /work bursts are not known, because/)
})

test("Desk's own idle split (idle_ms with waiting_by_waited_on_ms over idle time) is read as it is, and any rest is cause not recorded", () => {
  const row = { lead_time_ms: m(10 * H), working_ms: m(4 * H), idle_ms: m(6 * H), waiting_by_waited_on_ms: { next_prompt: m(3 * H), long_tool_call: m(H), tool_failure: m(0), unknown: m(H) } }
  const idle = W.idleSplit(row, { bursts: [], gaps: [{ start_ms: 0, end_ms: 10 * H, waited_on: "unknown" }] })
  assert.equal(idle.source, "rollup")
  assert.deepEqual(idle.by.map((x) => [x.key, x.ms]), [["next_prompt", 3 * H], ["long_tool_call", H], ["unknown", 2 * H]].sort((a, b) => b[1] - a[1] || 0))
  assert.equal(idle.value, 6 * H)
  assert.equal(W.idleSplit({ ...row, idle_ms: u(["source_unreadable"]) }, null).state, "unavailable")
})

test("the bar's partial note never calls an upper-bound group a lower bound (R4)", () => {
  const note = W.barPartialNote([F.reasonText("censored"), F.reasonText("truncated")], [{ label: "Working", qualifier: "at least " }, { label: "Waiting", qualifier: "at most " }])
  assert.doesNotMatch(note, /so this is a lower bound/)
  assert.match(note, /^Partial: the job is still open; .*\. So working time is a lower bound, and waiting time is an upper bound\.$/)
  assert.equal(W.barPartialNote([], []), "Partial: some parts are partial.")
})

test("a box's inner waits name the causes Desk states per burst, the same as the bar; without them they read cause not recorded", () => {
  // Desk's per-burst split, in bare numbers or stated numbers; the rest of a burst's idle time is cause not recorded.
  const b = { start_ms: 0, end_ms: 60 * M, working_ms: 30 * M, idle_by_waited_on_ms: { tool_failure: 17 * M, api_retry: m(3 * M), next_prompt: p(0, ["censored"]) } }
  assert.deepEqual(W.burstIdleBy(b), { tool_failure: 17 * M, api_retry: 3 * M, unknown: 10 * M })
  assert.deepEqual(W.burstIdleBy({ start_ms: 0, end_ms: 60 * M, working_ms: 30 * M }), { unknown: 30 * M })
  // A stated split larger than the burst's idle time is scaled to fit, so the box still sums to its span.
  const over = W.burstIdleBy({ start_ms: 0, end_ms: 10 * M, working_ms: 8 * M, idle_by_waited_on_ms: { next_prompt: 3 * M, api_retry: 1 * M } })
  assert.equal(Math.round(over.next_prompt + over.api_retry), 2 * M)
  // The box and the task's split agree on causes.
  const map = { bursts: [{ ...b, n: 1 }, { start_ms: 70 * M, end_ms: 80 * M, working_ms: 10 * M, n: 2 }], gaps: [{ start_ms: 60 * M, end_ms: 70 * M, waited_on: "next_prompt" }] }
  const row = { lead_time_ms: m(80 * M), working_ms: m(40 * M) }
  const split = W.idleSplit(row, map)
  assert.equal(split.value, 40 * M)
  assert.deepEqual(Object.fromEntries(split.by.map((x) => [x.key, x.ms])), { tool_failure: 17 * M, next_prompt: 10 * M, unknown: 10 * M, api_retry: 3 * M })
  const model = W.mapModel(map, { maxBoxes: 1 })
  const box = model.items.find((it) => it.type === "box")
  assert.deepEqual(box.inner_by, { next_prompt: 10 * M, tool_failure: 17 * M, api_retry: 3 * M, unknown: 10 * M })
  assert.deepEqual(box.inner_causes, ["tool_failure", "next_prompt", "unknown", "api_retry"])
  const d = Object.fromEntries(W.drawer({ kind: "ladder", seg: { folded: true }, item: box }, { lead_ms: 80 * M, model }).rows)
  assert.equal(d["Waited on"], "after a failed tool call, 17 minutes; next prompt (the agent had stopped), 10 minutes; cause not recorded, 10 minutes; API retry, 3 minutes")
})

test("causes read in the page's words and link to Rank causes", () => {
  assert.equal(W.causeWords("waiting:next_prompt"), "Waiting · next prompt (the agent had stopped)")
  assert.equal(W.causeWords("waiting:long_tool_call"), "Waiting · long tool call")
  assert.equal(W.causeWords("defects:shell"), "Defects · failed shell calls")
  assert.equal(W.causeWords("extra_processing:all"), "Extra processing")
  assert.equal(W.causeSegment("defects:shell"), "defects")
  assert.equal(W.causeSegment("nonsense:x"), "unknown")
  const app = read("site/src/app.js")
  assert.match(app, /F\.safeRoute\("causes"\)/)
})

// ---------------------------------------------------------------- picker

test("the picker lists every task, the latest to finish first, with badges for partial and unavailable figures, and filters by name or key", () => {
  const jobs = [
    { id: "aaaa1111", finish_order: m(2), finish_basis: "labels", name: "Older task" },
    { id: "bbbb2222", finish_order: m(5), finish_basis: "labels", name: "Newest task" },
    { id: "cccc3333", finish_order: u(["no_facts"]), finish_basis: "none" },
    { id: "dddd4444", finish_order: m(3), finish_basis: "labels" },
  ]
  const rows = [
    { job: "aaaa1111", status: m("done"), lead_time_ms: m(H), flow_efficiency: m(0.2), labels_from_shared_session: false },
    { job: "bbbb2222", status: m("done"), lead_time_ms: p(H, ["card_dates_shorter_than_work"]), flow_efficiency: p(0.2, ["card_dates_shorter_than_work"]), labels_from_shared_session: false },
    { job: "dddd4444", status: m("cancelled"), lead_time_ms: u(["cancelled"]), flow_efficiency: u(["cancelled"]), labels_from_shared_session: false },
  ]
  const name = (j) => j.name || `Private task ${j.id.slice(0, 8)}`
  const out = W.pickerRows(jobs, rows, name, "")
  assert.deepEqual(out.map((r) => r.id), ["bbbb2222", "dddd4444", "aaaa1111", "cccc3333"])
  assert.deepEqual(out.map((r) => r.badge), ["partial", "no data", null, "no data"])
  assert.equal(out[0].status, "done")
  assert.deepEqual(W.pickerRows(jobs, rows, name, "newest").map((r) => r.id), ["bbbb2222"])
  assert.deepEqual(W.pickerRows(jobs, rows, name, "DDDD").map((r) => r.id), ["dddd4444"])
  // With no tasks file at all, every task is still listed, each marked no data.
  assert.ok(W.pickerRows(jobs, null, name, "").every((r) => r.badge === "no data"))
})

test("the picker's row 1 is the latest finished task: open tasks follow in their own group, however late their facts arrived (I-R1); a finished task not labeled yet stays in the finished group (A1 I1)", () => {
  const jobs = [
    { id: "open0030", finish_order: m(30), finish_basis: "facts", status: "processing" },
    { id: "done0009", finish_order: m(9), finish_basis: "labels", status: "done" },
    { id: "open0012", finish_order: m(12), finish_basis: "facts", status: "processing" },
    { id: "nofacts0", finish_order: u(["no_facts"]), finish_basis: "none", status: "drafting" },
    { id: "done0002", finish_order: m(2), finish_basis: "labels", status: "done" },
    { id: "done0010", finish_order: m(10), finish_basis: "facts", status: "done" },
  ]
  const out = W.pickerRows(jobs, [], (j) => j.id, "")
  assert.equal(out[0].id, "done0010")
  assert.deepEqual(out.map((r) => r.id), ["done0010", "done0009", "done0002", "open0030", "open0012", "nofacts0"])
  assert.deepEqual(out.map((r) => r.group), ["finished", "finished", "finished", "open", "open", "open"])
  assert.deepEqual(out.map((r) => !!r.unlabeled), [true, false, false, false, false, false])
  // On the real snapshot too: row 1 is the finished task with the highest finish position.
  const snap = JSON.parse(read(".github/fixtures/walk/snapshot.json"))
  if (Array.isArray(snap.jobs) && snap.jobs.length) {
    const best = snap.jobs.filter((j) => (j.status === "done" || j.status === "cancelled") && j.finish_order.state === "measured").sort((a, b) => b.finish_order.value - a.finish_order.value)[0]
    assert.equal(W.pickerRows(snap.jobs, snap.tasks || [], (j) => j.id, "")[0].id, best.id)
  }
})

// ------------------------------------------------------------ the drawer

const detail = {
  job: "j1",
  session: "s1",
  offset_ms: 0,
  end_ms: 10 * H,
  labeled: true,
  labels_from_shared_session: false,
  intervals: [
    { start_ms: 0, end_ms: 60000, kind: "turn", worker: 0 },
    { start_ms: 1000, end_ms: 2000, kind: "tool", tool: "shell", outcome: "error", worker: 0 },
    { start_ms: 1500, end_ms: 3000, kind: "tool", tool: "shell", outcome: "ok", worker: 2 },
    { start_ms: 2500, end_ms: 2600, kind: "tool", tool: "edit", outcome: "timeout", worker: 3 },
    { start_ms: 3 * H, end_ms: 5 * H, kind: "human_wait", worker: 0 },
  ],
  stretches: [
    { start_ms: 1000, end_ms: 3000, class: "muda", waste: "defects", confidence: "high", evaluator_version: "3.2.0-alpha.202", evidence: [1, 2] },
    { start_ms: 3 * H, end_ms: 5 * H, class: "muda", waste: "waiting", waited_on: "next_prompt", confidence: "medium", evaluator_version: "3.2.0-alpha.202", evidence: [4] },
  ],
}
const agents = [{ session: "s1", n: 0, parent: null }, { session: "s1", n: 2, parent: 0 }, { session: "s1", n: 3, parent: 2 }, { session: "other", n: 9, parent: 0 }]

test("the drawer says what a stretch is, which one, its share of lead time and the evidence it rests on; a waiting stretch gets its length and its clock times", () => {
  const lanes = W.lanes(detail, agents)
  const c = W.drawer({ kind: "stretch", stretch: detail.stretches[1], index: 1, total: 2, intervals: detail.intervals, lanes }, { origin_ms: 0, lead_ms: 10 * H })
  assert.equal(c.title, "Evaluator-labeled pause (inside working time) stretch")
  const rows = Object.fromEntries(c.rows)
  assert.equal(rows.Which, "Stretch 2 of 2 in this session")
  // R6: the evaluator's waiting label has its own name, so "waiting" keeps one meaning (idle time).
  assert.equal(rows["What it is"], "Evaluator-labeled pause (inside working time): the evaluator labeled this stretch waiting; on this page, waiting means idle time")
  assert.equal(rows.Confidence, "medium")
  assert.equal(rows["Evaluator version"], "3.2.0-alpha.202")
  assert.equal(rows["Waited on"], "the agent had stopped and was waiting for the operator's next prompt")
  // v1.1: an idle band's start and end are on the task clock, like any other time.
  assert.equal(rows["On the task clock"], "from 3h to 5h after the task's start (2 hours)")
  assert.equal(rows.Length, undefined)
  assert.equal(rows.Share, "20% of the lead time")
  // A working stretch keeps its place on the clock.
  assert.match(Object.fromEntries(W.drawer({ kind: "stretch", stretch: detail.stretches[0], intervals: detail.intervals, lanes }, { origin_ms: 0, lead_ms: 10 * H }).rows)["On the task clock"], /^from /)
  assert.deepEqual(c.evidence, [{ kind: "waiting for the operator", tool: "", outcome: "", lane: "Main agent", duration: "2h" }])
  const d = W.drawer({ kind: "stretch", stretch: detail.stretches[0], intervals: detail.intervals, lanes }, { origin_ms: 0, lead_ms: null })
  assert.deepEqual(d.evidence.map((e) => [e.kind, e.tool, e.outcome, e.lane]), [["tool call", "shell", "error", "Main agent"], ["tool call", "shell", "ok", "Subagent 2"]])
  assert.equal(Object.fromEntries(d.rows).Share, "share of lead time not known (no lead time)")
})

test("the drawer for a box and a wait names which one it is, its time and its share; a wait gets its place among the boxes and its clock times", () => {
  const model = W.mapModel(synthetic(3, 4), { maxBoxes: 10 })
  const box = model.items.find((x) => x.type === "box")
  const wait = model.items.find((x) => x.type === "wait" && x.waited_on === "queue_before_start")
  const cb = Object.fromEntries(W.drawer({ kind: "box", item: box }, { origin_ms: 0, lead_ms: model.totals.lead_ms, model }).rows)
  assert.equal(cb.Which, "Work box 1 of 3: burst 1")
  assert.match(cb["What it is"], /^One work burst/)
  assert.match(cb["Working time"], /of the lead time\)$/)
  assert.match(cb["On the task clock"], /^from /)
  const cw = W.drawer({ kind: "wait", item: wait }, { origin_ms: 0, lead_ms: model.totals.lead_ms, model })
  assert.equal(cw.title, "Wait: queued before the first session")
  const rw = Object.fromEntries(cw.rows)
  assert.equal(rw["Waited on"], "the task was waiting for its first session to start")
  assert.equal(rw.Which, "Gap 1, before the first work box")
  assert.match(rw["On the task clock"], /^from 0s to .+ after the task's start/, "a wait carries its clock times")
  // A folded box says how it was folded (M4).
  const folded = W.mapModel(synthetic(40, 9), { maxBoxes: 3 })
  const fb = folded.items.find((x) => x.type === "box" && x.count > 1)
  assert.match(Object.fromEntries(W.drawer({ kind: "box", item: fb }, { model: folded, fold_ms: folded.fold_ms }).rows)["What it is"], /folded into one box with the waits shorter than .+ between them/)
  // The folded-ladder step names its box and causes, with no clock time.
  const inner = folded.items.find((x) => x.type === "box" && x.inner_wait_ms > 0)
  const fr = Object.fromEntries(W.drawer({ kind: "ladder", seg: { folded: true }, item: inner }, { model: folded }).rows)
  assert.match(fr.Which, /^Inside work box \d+ of \d+$/)
  assert.ok(fr["Waited on"].length > 0)
  assert.equal(fr["On the task clock"], undefined)
})

test("the prompt names the exact item, its place, a link that opens it, and where it is in the data file (I5)", () => {
  const model = W.mapModel(synthetic(13, 7), { maxBoxes: 6 })
  const boxes = model.items.filter((x) => x.type === "box")
  const ctx = { origin_ms: 0, model }
  const a = W.promptItem({ kind: "box", item: boxes[0] }, ctx)
  const b = W.promptItem({ kind: "box", item: boxes[1] }, ctx)
  assert.notEqual(a.what, b.what)
  assert.match(a.what, /^work box 1 of \d+ \(bursts? 1(–\d+)? of 13\)$/)
  assert.match(a.where, /^It ran from minute \d+ to minute \d+ after the task's start/)
  assert.match(a.locator, /^bursts\[0\]/)
  assert.match(a.select, /^bursts=1(-\d+)?$/)
  const w = W.promptItem({ kind: "wait", item: model.items.find((x) => x.type === "wait") }, ctx)
  assert.match(w.what, /^the wait (before the first work box|between work boxes \d+ and \d+|after the last work box) \(gaps? [\d–]+ of \d+; waited on: .+\)$/)
  assert.match(w.where, /^It lasted .+, from minute \d+ to minute \d+ after the task's start$/, "a wait gives its length and its clock times")
  const lanes = W.lanes(detail, agents)
  const s0 = W.promptItem({ kind: "stretch", stretch: detail.stretches[0], index: 0, total: 2, session: "s1abcdef99", intervals: detail.intervals, lanes }, { origin_ms: 0 })
  const s1 = W.promptItem({ kind: "stretch", stretch: detail.stretches[1], index: 1, total: 2, session: "s1abcdef99", intervals: detail.intervals, lanes }, { origin_ms: 0 })
  assert.notEqual(W.promptText({ ...s0, taskName: "x", route: "r", dataUrl: "d" }), W.promptText({ ...s1, taskName: "x", route: "r", dataUrl: "d" }), "two stretches give two prompts")
  assert.equal(s1.select, "stretch=2")
  assert.equal(W.promptItem({ kind: "stretch", stretch: { class: "value", start_ms: 135 * M, end_ms: 135 * M + 1000 }, index: 4, total: 9, session: "abc" }, { origin_ms: 0 }).where, "It ran for 1 second, starting at minute 135 after the task's start")
  assert.equal(s1.locator, "stretches[1]")
  // The name reads naturally: no "factory task Private task".
  assert.equal(W.promptName({ title: "Private task 825084c9", kind: "private", short: "825084c9" }), "factory task 825084c9 (private)")
  assert.equal(W.promptName({ title: "Revocable sessions", kind: "public", short: "fc8b915a" }), 'factory task "Revocable sessions" (fc8b915a)')
  const text = W.promptText({ ...s1, taskName: "factory task 825084c9 (private)", route: "https://ourostack.github.io/factory/#/task/825084c9676f1da79f49e868ff950abb/session/5f4879fb", dataUrl: "https://ourostack.github.io/factory/jobs/825084c9676f1da79f49e868ff950abb/5f4879fb.json" })
  assert.equal(text, "Walk me through evaluator-labeled pause (inside working time) stretch 2 of 2 in session s1abcdef (waited on: next prompt (the agent had stopped)) of factory task 825084c9 (private). It lasted 2 hours. It is open at https://ourostack.github.io/factory/#/task/825084c9676f1da79f49e868ff950abb/session/5f4879fb?stretch=2, and its data is stretches[1] in https://ourostack.github.io/factory/jobs/825084c9676f1da79f49e868ff950abb/5f4879fb.json. Explain what happened and what we could change.")
  assert.doesNotMatch(text, /factory task Private task/)
  // The link's query opens the item again.
  assert.deepEqual(F.parseRoute("#/task/825084c9676f1da79f49e868ff950abb/session/5f4879fb?stretch=2"), { view: "session", job: "825084c9676f1da79f49e868ff950abb", session: "5f4879fb", select: { kind: "stretch", from: 2, to: 2 } })
  assert.deepEqual(F.parseRoute("#/task/abc?bursts=4-6").select, { kind: "bursts", from: 4, to: 6 })
  assert.equal(F.parseRoute("#/task/abc?bursts=6-4").select, undefined)
  assert.equal(F.parseRoute("#/task/abc?x=<script>").view, "task")
})

// --------------------------------------------------------- the swimlane

test("swimlane lanes: the main agent first, subagents nested under their parents, only this session's agents", () => {
  assert.deepEqual(W.lanes(detail, agents).map((l) => [l.worker, l.depth, l.label]), [[0, 0, "Main agent"], [2, 1, "Subagent 2"], [3, 2, "Subagent 3"]])
  // A worker missing from the agents list hangs under the main agent.
  assert.deepEqual(W.lanes(detail, []).map((l) => [l.worker, l.depth]), [[0, 0], [2, 1], [3, 1]])
})

test("failed tool calls are binned to pixel columns, activity merges below a pixel, and a stretch spans the lanes its evidence names", () => {
  const ticks = W.failureTicks(detail.intervals, [0, 2, 3], 0, 10000)
  assert.deepEqual(ticks, [{ x: 0, n: 2, tools: ["edit", "shell"] }])
  assert.deepEqual(W.failureTicks(detail.intervals, [0, 2, 3], 0, 1).map((t) => t.x), [1000, 2500], "zoomed in, each failure is its own tick")
  assert.deepEqual(W.activityRuns(detail.intervals, 0, 1000), [[0, 60000]])
  assert.deepEqual(W.density(detail.intervals, [2, 3], 0, 1000, 10).map((c) => [c.x, c.n]), [[1, 1], [2, 2], [3, 1]])
  assert.deepEqual(W.stretchWorkers(detail.stretches[0], detail.intervals), [0, 2])
  assert.equal(W.stretchSegment({ class: "unlabeled", reason: "agents_working" }), "agents_working_unlabeled")
  assert.equal(W.stretchSegment({ class: "muda", waste: "waiting" }), "waiting")
  assert.equal(W.waitLabel("next_prompt"), "labeled pause: next prompt")
  assert.equal(W.waitLabel("api_retry"), "labeled pause: API retry")
  const steps = W.zoomSteps(10 * H, 1000, 32768)
  assert.equal(steps[0], 1)
  assert.ok(1000 * steps[steps.length - 1] <= 32768)
})

// ------------------------------------------------ the map file and publishing

test("the map file (factory.site.map/2) keeps what the landing view draws, every operator prompt, the pull request clock and each burst's pull request count, and drops the intervals", () => {
  const report = {
    job: { id: "j1" },
    timeline: {
      job: "j1",
      intervals: [{ start_ms: 0, end_ms: 1, kind: "turn" }],
      human_turns: [
        { at_ms: 0, session: "s1", host: "h", basis: "first", window_ms: null, prompt_class: "m", output_class: "none" },
        { at_ms: 15, session: "s1", host: "h", basis: "after_stop", window_ms: 6, prompt_class: "s", output_class: "l" },
      ],
      prs: [{ repo: "o/r", number: 7, at_ms: 1234, session: "s1", worker: 0, host: "h" }],
      bursts: [{ start_ms: 0, end_ms: 10, working_ms: 9, sessions: ["s1"], agents: 1, tool_calls: 2, tool_failures: 0, operator_turns: 1, prs: m(1), value_ms: 3, defect_ms: 0, defect_stretches: 0 }],
      gaps: [{ start_ms: 10, end_ms: 20, waited_on: "next_prompt" }],
      lead_window: { start_ms: 0, end_ms: 20, state: "measured", reasons: [] },
      sessions: [{ id: "s1", host: "claude-code", offset_ms: 0, end_ms: 20, basis: ["x"], ended: true }],
      agents: [{ host: "h", session: "s1", n: 0, parent: null }],
      transitions: [{ offset_ms: 3, to: "done" }],
      observations: [{ offset_ms: 4, status: "done" }],
      outcome: { state: "not_recorded", deliveries: 0, job: "j1" },
      detail_files: ["jobs/j1/s1.json"],
    },
  }
  const slim = W.slimMap(report)
  assert.equal(slim.schema, "factory.site.map/2")
  assert.doesNotMatch(JSON.stringify(slim), /"intervals"/)
  // Every operator prompt, on the task clock, with its why (none known before Desk's waits).
  assert.deepEqual(slim.human_turns, [
    { session: "s1", host: "h", at_ms: 0, basis: "first", window_ms: null, prompt_class: "m", output_class: "none", why: null },
    { session: "s1", host: "h", at_ms: 15, basis: "after_stop", window_ms: 6, prompt_class: "s", output_class: "l", why: null },
  ])
  assert.deepEqual(slim.waits, [])
  assert.deepEqual(slim.human_turns_state, { state: "measured", reasons: [], basis: "store_from_hosts" })
  assert.deepEqual(slim.prs_state, { state: "partial", bound: "lower", reasons: ["host_records_partly"], basis: "store_from_hosts" })
  // A burst keeps Desk's pull request count envelope.
  assert.deepEqual(slim.bursts[0].prs, m(1))
  // With no GitHub data, a pull request is not placed and says why: nothing is invented.
  const notRead = { state: "unavailable", reasons: ["github_not_read"] }
  assert.deepEqual(slim.prs, [{ repo: "o/r", number: 7, created: null, opened_at_ms: null, opened_basis: "not_placed", opened_state: notRead, merged_at_ms: null, merged_basis: "not_placed", merged_state: notRead, state: null, reasons: ["github_not_read"] }])
  assert.deepEqual(slim.pr_anchor, { state: "unavailable", reasons: ["github_not_read"], basis: "timed", n: 0 })
  // The same placement as the build's, with no GitHub data: one implementation (walk.js prClock).
  assert.deepEqual(slim.prs, W.prClock(report.timeline.prs, null).prs)
  assert.equal(slim.finish_date, null, "no finish date until the store resolves one")
  assert.equal(slim.bursts.length, 1)
  assert.deepEqual(slim.gaps, [{ start_ms: 10, end_ms: 20, waited_on: "next_prompt" }])
  assert.deepEqual(slim.detail_files, ["jobs/j1/s1.json"])
  assert.equal(slim.job, "j1")
})

test("the map file takes the store's pull request clock and finish date, and joins each prompt to the wait it ends (Desk D4 and D5 fields)", () => {
  const report = {
    job: { id: "j1" },
    timeline: {
      human_turns: [
        { at_ms: 0, session: "s1", host: "claude-code", basis: "first", window_ms: null, prompt_class: "m", output_class: "none" },
        { at_ms: 50, session: "s1", host: "claude-code", basis: "after_stop", window_ms: 30, prompt_class: "s", output_class: "l" },
        // The same instant in another session ends no wait of this one.
        { at_ms: 90, session: "s2", host: "claude-code", basis: "after_stop", window_ms: 10, prompt_class: "s", output_class: "s" },
      ],
      human_turns_state: { class: "inferred", state: "partial", bound: "lower", reasons: ["log_truncated"] },
      prs_state: { class: "inferred", state: "partial", bound: "lower", reasons: ["host_records_partly"] },
      waits: [
        { session: "s1", start_ms: 20, end_ms: 50, next_prompt_ms: 30, stop: { end: "end_turn", asks: false, pending_agents: false }, why: "acceptance", why_source: "evaluator", confidence: "high", reasons: [] },
        { session: "s1", start_ms: 80, end_ms: 90, next_prompt_ms: 10, stop: { end: "end_turn", asks: true, pending_agents: null }, why: null, why_source: "none", confidence: null, reasons: ["not_labeled"] },
      ],
      prs: [{ repo: "o/r", number: 7, at_ms: 1234, created: true }],
      bursts: [],
      gaps: [],
      sessions: [{ id: "s1", host: "claude-code", offset_ms: 0 }, { id: "s2", host: "claude-code", offset_ms: 60 }],
    },
  }
  const clock = { anchor: { state: "measured", reasons: [], basis: "created", n: 1, dropped: 0, spread_ms: 0 }, prs: [{ repo: "o/r", number: 7, created: true, opened_at_ms: 1234, opened_basis: "desk", merged_at_ms: 5000, merged_basis: "pr_anchor", state: "merged", reasons: [] }] }
  const finish = { state: "measured", value: "2026-10-07", basis: "desk_transition", reasons: [] }
  const slim = W.slimMap(report, { pr_clock: clock, finish_date: finish })
  assert.deepEqual(slim.human_turns.map((t) => t.why), [null, "acceptance", null])
  assert.deepEqual(slim.waits[0], report.timeline.waits[0])
  // A stop keeps only the fields the store reviewed.
  const extra = W.slimMap({ timeline: { waits: [{ ...report.timeline.waits[0], stop: { end: "end_turn", asks: false, pending_agents: false, text: "never" } }] } })
  assert.deepEqual(extra.waits[0].stop, { end: "end_turn", asks: false, pending_agents: false })
  assert.equal(slim.waits.length, 2)
  assert.deepEqual(slim.human_turns_state, { state: "partial", bound: "lower", reasons: ["log_truncated"], basis: "desk" })
  assert.deepEqual(slim.prs, clock.prs)
  assert.deepEqual(slim.pr_anchor, clock.anchor)
  assert.deepEqual(slim.finish_date, finish)
  // Offsets only: no epoch value and no ISO time reaches the map file.
  assert.doesNotMatch(JSON.stringify(slim), /"value_ms"|\d{4}-\d{2}-\d{2}T/)
})

test("the page still draws a map/2 file as it drew map/1, plus each box's pull requests opened", () => {
  const timeline = {
    bursts: [
      { start_ms: 0, end_ms: 10 * M, working_ms: 9 * M, sessions: ["s1"], agents: 1, tool_calls: 2, tool_failures: 0, operator_turns: m(1), prs: m(1) },
      { start_ms: 40 * M, end_ms: 60 * M, working_ms: 20 * M, sessions: ["s1"], agents: 1, tool_calls: 5, tool_failures: 1, operator_turns: m(1), prs: m(0) },
    ],
    gaps: [{ start_ms: 10 * M, end_ms: 40 * M, waited_on: "next_prompt" }],
    human_turns: [{ at_ms: 0, session: "s1", basis: "first" }, { at_ms: 40 * M, session: "s1", basis: "after_stop", window_ms: 30 * M }],
    prs: [{ repo: "o/r", number: 7, at_ms: 5 * M }],
    sessions: [{ id: "s1", host: "claude-code", offset_ms: 0, end_ms: 60 * M }],
    transitions: [{ offset_ms: 59 * M, to: "done" }],
    lead_window: { start_ms: 0, end_ms: 60 * M, state: "measured", reasons: [] },
  }
  const v2 = W.slimMap({ job: { id: "j" }, timeline })
  const v1 = { ...v2, schema: "factory.site.map/1", prs: v2.prs.map((p) => ({ repo: p.repo, number: p.number })), bursts: v2.bursts.map(({ prs, ...b }) => b) }
  for (const k of ["human_turns", "waits", "human_turns_state", "prs_state", "pr_anchor", "finish_date"]) delete v1[k]
  const draw = (map) => {
    const model = W.mapModel(map, { maxBoxes: 7 })
    // A box keeps its raw bursts; the page draws from the rest.
    // S4 adds the box's pull requests opened, which a map/1 file does not hold.
    const items = model.items.map(({ bursts, prs, ...it }) => it)
    return { items, totals: model.totals, ladder: W.ladder(model).map(({ item, ...seg }) => seg), marks: W.statusMarks(map, model) }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(draw(v2))), JSON.parse(JSON.stringify(draw(v1))))
  const box = (map) => W.dataBox(W.mapModel(map, { maxBoxes: 7 }).items[0], 1).find((r) => r.key === "prs").text
  assert.equal(box(v2), "1")
  assert.equal(box(v1), "not recorded", "a map/1 file holds no pull request count, which reads not recorded, never 0")
  assert.equal(draw(v2).items.filter((x) => x.type === "box").length, 2)
})

test("the Pages build writes one map file per task, lists it in llms.txt and reports its size; with no task files it writes none", () => {
  const root = mkdtempSync(join(tmpdir(), "follow-task-"))
  const reports = join(root, "reports")
  const dist = join(root, "dist")
  write(join(reports, "jobs", "j1.json"), JSON.stringify({ job: { id: "j1" }, timeline: { intervals: new Array(500).fill({ start_ms: 0, end_ms: 1, kind: "tool" }), bursts: [], gaps: [] } }))
  write(join(reports, "jobs", "j1", "s1.json"), "{}")
  write(join(reports, "jobs", "broken.json"), "{not json")
  write(join(reports, "rollups", "tasks.json"), "{}")
  mkdirSync(dist, { recursive: true })
  const { files, maps } = publishData({ reports, dist })
  assert.deepEqual(maps, ["map/j1.json"])
  assert.ok(files.some((f) => f.path === "map/j1.json"))
  const slim = files.find((f) => f.path === "map/j1.json").bytes
  const full = files.find((f) => f.path === "jobs/j1.json").bytes
  assert.ok(slim < full / 5, "the map file is a small part of the full report")
  assert.match(sizeLine(files.filter((f) => f.path.startsWith("map/")), "Task map files (new)"), /^Task map files \(new\): 1 files, 0\.00 MB total, largest map\/j1\.json/)
  assert.match(llmsText("{{READ_WHOLE}}\n{{FILES}}", files), /## Step 1, follow a task: one task's map\n\n- map\/j1\.json \(\d+ KB, small enough to read whole\): the work bursts, waits, card status changes, operator prompts \(each with its why\), the waits before them, and pull requests with their opened and merged times on the task clock, of task j1/)

  const emptyRoot = mkdtempSync(join(tmpdir(), "follow-task-empty-"))
  mkdirSync(join(emptyRoot, "dist"), { recursive: true })
  const none = publishData({ reports: join(emptyRoot, "reports"), dist: join(emptyRoot, "dist") })
  assert.deepEqual(none.maps, [])
  assert.deepEqual(readdirSync(join(emptyRoot, "dist")), ["reasons.json"], "only the reason words, which need no report")
  // The workflow prints the map files' size line and publishes walk.js.
  const wf = read(".github/workflows/pages.yml")
  assert.match(wf, /cp site\/src\/index\.html site\/src\/styles\.css site\/src\/format\.js site\/src\/walk\.js site\/src\/steps\.js site\/src\/app\.js site\/dist\//)
  assert.match(read("site/scripts/publish-files.mjs"), /Task map files \(new\)/)
})

// ------------------------------------------------------------- the page

test("the page loads walk.js, opens evidence in a real dialog, and places operator prompts and pull request times only through walk.js", () => {
  const html = read("site/src/index.html")
  assert.match(html, /<script src="walk\.js"><\/script>\s*<script src="steps\.js"><\/script>\s*<script src="app\.js"><\/script>/)
  assert.match(html, /<dialog id="evidence-drawer" class="drawer" aria-labelledby="drawer-title">/)
  for (const id of ["task-picker", "task-head", "task-lede", "vsm", "time-went", "job-detail", "swimlane"]) assert.match(html, new RegExp(`id="${id}"`))
  const app = read("site/src/app.js")
  assert.match(app, /showModal\(\)/)
  assert.match(app, /Copy as a prompt for your agent/)
  // v1.1 (addendum §3): prompts and pull request times are on the task clock, placed by walk.js's tested clockMarks.
  assert.match(app, /W\.clockMarks\(map, model\)/)
  assert.doesNotMatch(app, /\.at_ms\b|human_turns\s*\[|\.human_turns\.(map|forEach|filter|length)/, "the page reads no prompt time itself")
  // Every chart has a text equivalent.
  assert.match(app, /The map as a table/)
  assert.match(app, /labeled stretches as a table/)
  assert.match(app, /aria-label", `Lead time/)
  // The walk's files load on demand, and a missing file reads as not published.
  assert.match(app, /walkFile\("rollups\/tasks\.json"\)/)
  assert.match(app, /walkFile\(mapPath\(j\.id\)\)/)
  assert.match(app, /not published yet/)
})

test("Desk's own bound on flow efficiency wins: bound upper reads at most, bound lower at least", () => {
  const r = ["truncated"]
  const base = row825({ lead_time_ms: m(193344986), working_ms: p(62609950, r) })
  const upper = W.ledeText(W.lede({ ...base, flow_efficiency: { ...p(0.3238, r), bound: "upper" } }, F.reasonText, {}))
  assert.match(upper, /here it is at most 32%\./)
  const lower = W.ledeText(W.lede({ ...base, flow_efficiency: { ...p(0.3238, r), bound: "lower" } }, F.reasonText, {}))
  assert.match(lower, /here it is at least 32%\./)
  // An inferred bound (no bound field: a lower-bound working time over a measured lead time) reads the same in the picker as in the lede (R2).
  const inferred = { ...base, flow_efficiency: p(0.14, r) }
  assert.match(W.ledeText(W.lede(inferred, F.reasonText, {})), /here it is at least 14%\./)
  assert.equal(W.pickerRows([{ id: base.job, finish_order: m(1), finish_basis: "labels" }], [inferred], () => "x", "")[0].feText, "at least 14%")
  // The summary box reads each token with its qualifier (R1): the working token carries "at least".
  const work = W.lede(inferred, F.reasonText, {}).parts.find((x) => x && x.key === "working")
  assert.equal(`${work.q}${work.text}`, "at least 17 hours")
})

test("the reason text table covers the walk's new reasons", () => {
  for (const r of ["labels_from_shared_session", "over_budget_after_binning", "agents_working", "card_dates_shorter_than_work", "censored", "open_job", "cancelled", "job_offsets_unavailable"]) {
    assert.equal(F.hasReasonText(r), true, r)
    assert.doesNotMatch(F.reasonText(r), /_/)
  }
})

test("the status line finds a repeated alarm by its key, not by its words", () => {
  const s = F.statusLine({
    verdict: { status: "alive", reason: "ok" },
    andon: [],
    capture: { share: m(0.9), alarms: [{ host: "claude-code", code: "below_threshold" }] },
    loop: { verdict: { status: "healthy" }, alarms: [] },
    fixNext: [{ id: "capture_alarm", severity: "alarm", title: "Capture coverage needs a look" }, { id: "labels_mismatch", severity: "alarm", title: "Capture coverage labels mismatch" }],
  })
  assert.equal(s.state, "abnormal")
  assert.deepEqual(s.alarms.map((a) => a.key), ["capture:claude-code", "labels_mismatch"], "a fix-next alarm whose title starts like another's words is still told, and the capture alarm is not told twice")
})

test("an open factory-alarm issue whose title carries the alarm's key owns that alarm; one without reads no one is on this (desk#232)", () => {
  assert.deepEqual(F.alarmKeys("capture:claude-code — a capture record sent during a quarantine release"), ["capture:claude-code"])
  assert.deepEqual(F.alarmKeys("loop:steps_stale and capture:copilot-cli"), ["loop:steps_stale", "capture:copilot-cli"])
  assert.deepEqual(F.alarmKeys("Recapture:x is not a key; nor is xcapture:y"), [])
  const input = {
    verdict: { status: "alive", reason: "ok" },
    andon: [],
    andonVerification: "verified",
    capture: { share: m(0.9), alarms: [{ host: "claude-code", code: "coverage_low" }, { host: "codex", code: "coverage_low" }] },
    loop: { verdict: { status: "alarm" }, alarms: [{ code: "steps_stale" }] },
    alarmIssues: [
      { ref: "ourostack/desk#230", url: "https://github.com/ourostack/desk/issues/230", issue_state: "open", keys: ["capture:claude-code"] },
      { ref: "#9", url: "https://github.com/ourostack/factory/issues/9", issue_state: "closed", keys: ["loop:steps_stale"] },
    ],
  }
  const s = F.statusLine(input)
  const by = Object.fromEntries(s.alarms.map((a) => [a.key, a.owner]))
  assert.deepEqual(by["capture:claude-code"], { ref: "ourostack/desk#230", url: "https://github.com/ourostack/desk/issues/230" })
  assert.equal(by["capture:codex"], null, "no issue: no one is on this")
  assert.equal(by["loop:steps_stale"], null, "a closed issue owns nothing")
  // The build reads the factory-alarm issues of ourostack/desk and this store, and keeps keys, number and link only.
  const build = read("site/scripts/build-data.mjs")
  assert.match(build, /labels=factory-alarm/)
  assert.match(build, /"ourostack\/desk", GITHUB_REPO/)
  assert.match(build, /keys: alarmKeys\(i\.title\)/)
  assert.match(read("site/src/app.js"), /alarmIssues: data\.alarm_issues, alarmIssuesVerification: data\.alarm_issues_verification/)
  const text = Object.fromEntries(s.alarms.map((a) => [a.key, a.ownerText]))
  assert.equal(text["capture:codex"], "no one is on this")
})

test("when the build could not check for owner issues, an alarm says its owner was not checked, never that no one is on it (I-R2)", () => {
  const base = {
    verdict: { status: "alive", reason: "ok" },
    andon: [],
    andonVerification: "verified",
    capture: { share: m(0.9), alarms: [{ host: "codex", code: "coverage_low" }] },
    loop: { verdict: { status: "alarm" }, alarms: [{ code: "steps_stale" }] },
  }
  const down = F.statusLine({ ...base, alarmIssues: [], alarmIssuesVerification: "unavailable" })
  assert.equal(down.state, "abnormal")
  for (const a of down.alarms) {
    assert.equal(a.owner, null)
    assert.equal(a.ownerText, "owner not checked (GitHub could not be reached for this build)")
  }
  // A build from before owner issues were read did not look either.
  const old = F.statusLine(base)
  assert.ok(old.alarms.every((a) => a.ownerText === "owner not checked (this build did not look for owner issues)"))
  // A verified empty list is a real answer.
  const ok = F.statusLine({ ...base, alarmIssues: [], alarmIssuesVerification: "verified" })
  assert.ok(ok.alarms.every((a) => a.ownerText === "no one is on this"))
})

// --------------------------------------- one waiting figure, on real tasks

// The snapshot of the real walk (.github/fixtures/walk/snapshot.json), or a
// fresh build's dist directory in FACTORY_WALK_DIST.
function realWalk() {
  const dir = process.env.FACTORY_WALK_DIST
  if (!dir) return JSON.parse(read(".github/fixtures/walk/snapshot.json"))
  const tasks = JSON.parse(readFileSync(join(dir, "rollups/tasks.json"), "utf8")).jobs
  const stackup = JSON.parse(readFileSync(join(dir, "rollups/stackup.json"), "utf8")).jobs
  const maps = {}
  for (const f of readdirSync(join(dir, "map"))) {
    const mp = JSON.parse(readFileSync(join(dir, "map", f), "utf8"))
    maps[mp.job] = mp
  }
  return { tasks, stackup, maps }
}

test("for every real task, the lede's waiting = the map's triangles plus short waits inside boxes = the bar's waiting group = lead time minus working time (C1)", () => {
  const { tasks, stackup, maps } = realWalk()
  let checked = 0
  let unknown = 0
  let percause = 0
  const bursts = (map) => (Array.isArray(map.bursts) ? map.bursts : map.bursts && Array.isArray(map.bursts.items) ? map.bursts.items : [])
  for (const row of tasks) {
    const map = maps[row.job]
    const lead = row.lead_time_ms.state === "unavailable" ? null : row.lead_time_ms.value
    const working = row.working_ms.state === "unavailable" ? null : row.working_ms.value
    if (!map || lead === null) continue
    if (working === null) {
      // A task whose working time is not known (an unreadable session log):
      // the lede says so, prints no waiting figure, and the bar draws the
      // lead time alone.
      const t = W.ledeText(W.lede(row, F.reasonText, { idle: W.idleSplit(row, map) }))
      assert.match(t, /How long agents were working is not measured, because /, row.job)
      assert.doesNotMatch(t, /was waiting/, row.job)
      const sr = stackup.find((x) => x.job === row.job)
      if (sr) assert.equal(W.timeBar(sr, row, W.idleSplit(row, map), F.SEGMENTS).state, "lead_only", row.job)
      unknown += 1
      continue
    }
    checked += 1
    const idle = W.idleSplit(row, map)
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1000, `${row.job.slice(0, 8)}: ${what}: ${a} vs ${b}`)
    near(idle.value, lead - working, "waiting = lead - working")
    near(idle.by.reduce((a, x) => a + x.ms, 0), idle.value, "the causes sum to the waiting")
    for (const maxBoxes of [3, 6]) {
      const model = W.mapModel(map, { maxBoxes })
      near(model.totals.waiting_ms + model.totals.inner_wait_ms, idle.value, `triangles + inner waits at ${maxBoxes} boxes`)
      const segs = W.ladder(model)
      near(segs.filter((x) => x.level === "high").reduce((a, x) => a + x.ms, 0), idle.value, "the ladder's high steps")
      near(segs.filter((x) => x.level === "low").reduce((a, x) => a + x.ms, 0), working, "the ladder's low steps")
      // Once Desk states each burst's idle time by cause, the map names the
      // same causes as the bar, cause by cause (R7).
      if (bursts(map).some((b) => b.idle_by_waited_on_ms)) {
        const mapBy = {}
        for (const it of model.items) {
          if (it.type === "wait") for (const g of it.gaps) for (const [k, ms] of Object.entries(W.gapIdleBy(g))) mapBy[k] = (mapBy[k] || 0) + ms
          else for (const [k, ms] of Object.entries(it.inner_by || {})) mapBy[k] = (mapBy[k] || 0) + ms
        }
        // Where Desk splits each gap by cause, the map matches the bar
        // exactly; before that, a gap names only the cause that holds most
        // of it, so a gap with two causes moves a little time between them:
        // within 1% of the waiting, cause by cause. Box insides match exactly.
        const exact = (Array.isArray(map.gaps) ? map.gaps : []).some((g) => g.idle_by_waited_on_ms)
        for (const x of idle.by) assert.ok(Math.abs((mapBy[x.key] || 0) - x.ms) <= 1000 + (exact ? 0 : 0.01 * idle.value), `${row.job.slice(0, 8)}: the map's ${x.key} at ${maxBoxes} boxes: ${mapBy[x.key] || 0} vs ${x.ms}`)
        percause += 1
      }
    }
    const model = W.lede(row, F.reasonText, { idle })
    const tok = model.parts.find((x) => x && x.key === "waiting")
    if (idle.value > 0) assert.equal(tok && tok.text, W.durationWords(idle.value), `${row.job.slice(0, 8)}: the lede states the same waiting`)
    const stackRow = stackup.find((x) => x.job === row.job)
    if (!stackRow) continue
    const bar = W.timeBar(stackRow, row, idle, F.SEGMENTS)
    assert.equal(bar.state, "ok", row.job)
    near(bar.groups[1].ms, idle.value, "the bar's waiting group")
    near(bar.groups[1].segments.reduce((a, x) => a + x.ms, 0), idle.value, "the bar's waiting parts")
    near(bar.groups[0].segments.reduce((a, x) => a + x.ms, 0), working, "the bar's working parts")
    near(bar.groups[0].ms + bar.groups[1].ms, lead, "the bar sums to the lead time")
  }
  assert.ok(checked >= 15, `checked ${checked} real tasks`)
  // With Desk's per-burst causes in the data, the cause-by-cause check ran on real tasks.
  if (Object.values(maps).some((mp) => bursts(mp).some((b) => b.idle_by_waited_on_ms))) assert.ok(percause >= 15 * 2, `cause by cause on ${percause / 2} real tasks`)
  assert.ok(checked + unknown >= 25, `${checked + unknown} real tasks`)
})

test("a box reads job-level states: operator turns not recorded and an unlabeled task never read as 0 (I1)", () => {
  const map = synthetic(3, 5)
  const model = W.mapModel(map, { maxBoxes: 10, jobStates: { operator_turns: u(["not_recorded"]), labels: u(["not_labeled"]) } })
  const box = model.items.find((x) => x.type === "box")
  const rows = Object.fromEntries(W.dataBox(box, model.session_count).map((r) => [r.label, r.text]))
  assert.equal(rows["Operator turns"], "not recorded")
  const d = Object.fromEntries(W.drawer({ kind: "box", item: box }, { model, reasonText: F.reasonText }).rows)
  assert.equal(d["Value-adding, as labeled"], "not labeled yet")
  assert.equal(d["Defects, as labeled"], "not labeled yet")
  assert.equal(W.reworkWords(box), null)
  const partial = W.mapModel(map, { maxBoxes: 10, jobStates: { operator_turns: p(3, ["host_records_partly"]) } })
  assert.match(W.dataBox(partial.items.find((x) => x.type === "box"), 3).find((r) => r.key === "operator_turns").text, /^at least \d+$/)
  // A labeled zero reads "none", never "under a second".
  const zero = W.mapModel({ bursts: [{ start_ms: 0, end_ms: M, working_ms: M, value_ms: 0, defect_ms: 0, defect_stretches: 0 }], gaps: [] }, {})
  const dz = Object.fromEntries(W.drawer({ kind: "box", item: zero.items[0] }, { model: zero }).rows)
  assert.equal(dz["Value-adding, as labeled"], "none")
  assert.equal(dz["Defects, as labeled"], "none")
})

test("each lede number lights its own part of the map; a cause lights only the waits that waited on it", () => {
  assert.equal(W.highlightSelector("wait_cause", { cause: "queue_before_start" }), ".vsm-wait.has-queue_before_start, .lad-high.has-queue_before_start")
  assert.equal(W.highlightSelector("wait_cause", { cause: "<x>" }), ".vsm-wait, .lad-high, .sum-waiting")
  assert.equal(W.highlightSelector("waiting"), ".vsm-wait, .lad-high, .sum-waiting")
  assert.equal(W.highlightSelector("longest", { item: 4 }), '[data-item="4"]')
  assert.equal(W.highlightSelector("nonsense"), null)
  const app = read("site/src/app.js")
  assert.match(app, /has-\$\{k\}/, "waits and ladder steps carry their causes as classes")
  assert.match(app, /W\.highlightSelector\(key, \{ item, cause, seg, why \}\)/)
  // The swimlane's labels row is one tab stop with arrow keys inside (I4).
  assert.match(app, /tabindex: k === current \? 0 : -1/)
  assert.match(app, /ArrowRight: pos \+ 1/)
  assert.doesNotMatch(app, /class: "lane-stretch", tabindex: 0/)
})
