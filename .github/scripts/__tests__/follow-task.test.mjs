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

test("the lede: partial, counted from the first session, with working and value-adding time apart and waiting in system terms", () => {
  const model = W.lede(row825(), F.reasonText)
  assert.equal(model.state, "ok")
  const text = W.ledeText(model)
  assert.match(text, /^This task took at least 54 hours, counted from its first session because the card was created after work began\./)
  assert.match(text, /Agents were working for 17 hours of it; the evaluator judged under a second of that work value-adding/)
  assert.match(text, /Most of the 54 hours was waiting, not work: 36 hours in all\./)
  assert.match(text, /For 36 hours of it, the agent had stopped and was waiting for the operator's next prompt\./)
  assert.match(text, /The longest single wait was 19 hours, also for the next prompt\./)
  // Flow efficiency is defined in place; a lead time that is a lower bound makes it an upper bound.
  assert.match(text, /working time divided by lead time is called flow efficiency; here it is at most 32%\. A low number is normal/)
  assert.doesNotMatch(text, /\byou(r)?\b/i, "public copy says the operator")
  // Every number is a token the page turns into a button.
  const keys = model.parts.filter((x) => typeof x === "object" && !x.term).map((x) => x.key)
  assert.deepEqual(keys, ["lead", "working", "value", "waiting", "wait_cause", "longest", "fe"])
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
  assert.match(t, /^This task took 6\.5 hours from its card's creation to its end\./)
  assert.match(t, /Those labels come from a session this task shared with other tasks, so that split is partial\./)
  assert.match(t, /Long tool calls \(five minutes or more\) ran for 5 minutes/)
  assert.match(t, /The longest single wait was 2\.3 hours, when nothing was running for this task, and what it waited on was not recorded\./)
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
  assert.deepEqual(W.dataBox(box, model.session_count).map((r) => r.label), ["Working time", "Agents", "Tool calls", "Failed tool calls", "Operator turns", "Pull requests", "Session"])
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
  assert.equal(rows["Pull requests"], "0", "a measured zero is still a zero")
  assert.equal(rows["Working time"], "at least 19m")
  const d = Object.fromEntries(W.drawer({ kind: "box", item: box }, { origin_ms: 0, lead_ms: 21 * M, reasonText: F.reasonText }).rows)
  assert.equal(d["Value-adding, as labeled"], "not labeled (not labeled for waste yet)")
  assert.equal(d["Defects, as labeled"], "not labeled (not labeled for waste yet)")
  // Totals still hold: a burst with no stated working time counts its span.
  assert.equal(model.totals.lead_ms, 21 * M)
  // An enveloped bursts list reads too.
  const env = W.mapModel({ bursts: { state: "partial", reasons: ["source_unreadable"], items: map.bursts }, gaps: { state: "partial", reasons: [], items: map.gaps } }, { maxBoxes: 3 })
  assert.equal(env.items.length, 3)
  assert.deepEqual(W.slimMap({ timeline: { bursts: { state: "partial", reasons: ["source_unreadable"], items: [] } } }).bursts_state, { state: "partial", reasons: ["source_unreadable"] })
})

// ------------------------------------------- where this task's time went

test("the task's stacked bar keeps the shared stacking order, starts at zero and sums to its lead time", () => {
  const r = ["card_dates_shorter_than_work"]
  const row = {
    lead_time_ms: p(193344986, r),
    class_ms: { value: p(532, r), support: p(48391810, r) },
    waste_ms: { waiting: p(130484670, r), defects: p(164857, r), extra_processing: p(0, r), unknown: p(0, r) },
    agents_working_unlabeled_ms: p(12721842, r),
    not_labeled_ms: p(1581275, r),
    no_session_ms: p(0, r),
  }
  const bar = W.timeBar(row, F.SEGMENTS)
  assert.equal(bar.state, "ok")
  assert.deepEqual(bar.segments.map((s) => s.key), ["value", "support", "waiting", "defects", "agents_working_unlabeled", "not_labeled"])
  assert.equal(bar.segments.reduce((a, s) => a + s.ms, 0), bar.total_ms)
  assert.equal(bar.partial, true)
  assert.equal(W.timeBar(null, F.SEGMENTS).state, "absent")
  assert.equal(W.timeBar({ lead_time_ms: u(["cancelled"]) }, F.SEGMENTS).state, "unavailable")
})

test("causes read in the page's words and link to Rank causes", () => {
  assert.equal(W.causeWords("waiting:next_prompt"), "Waiting for the next prompt (the agent had stopped)")
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
    { id: "aaaa1111", finish_order: m(2), name: "Older task" },
    { id: "bbbb2222", finish_order: m(5), name: "Newest task" },
    { id: "cccc3333", finish_order: u(["no_facts"]) },
    { id: "dddd4444", finish_order: m(3) },
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

test("the drawer says what a stretch is, where it sits on the task clock, its share of lead time and the evidence it rests on", () => {
  const lanes = W.lanes(detail, agents)
  const c = W.drawer({ kind: "stretch", stretch: detail.stretches[1], intervals: detail.intervals, lanes }, { origin_ms: 0, lead_ms: 10 * H })
  assert.equal(c.title, "Waiting stretch")
  const rows = Object.fromEntries(c.rows)
  assert.equal(rows["What it is"], "Waste: Waiting")
  assert.equal(rows.Confidence, "medium")
  assert.equal(rows["Evaluator version"], "3.2.0-alpha.202")
  assert.equal(rows["Waited on"], "the agent had stopped and was waiting for the operator's next prompt")
  assert.equal(rows["On the task clock"], "from 3h to 5h after the task's start (2 hours)")
  assert.equal(rows.Share, "20% of the lead time")
  assert.deepEqual(c.evidence, [{ kind: "waiting for the operator", tool: "", outcome: "", lane: "Main agent", duration: "2h" }])
  const d = W.drawer({ kind: "stretch", stretch: detail.stretches[0], intervals: detail.intervals, lanes }, { origin_ms: 0, lead_ms: null })
  assert.deepEqual(d.evidence.map((e) => [e.kind, e.tool, e.outcome, e.lane]), [["tool call", "shell", "error", "Main agent"], ["tool call", "shell", "ok", "Subagent 2"]])
  assert.equal(Object.fromEntries(d.rows).Share, "share of lead time not known (no lead time)")
})

test("the drawer for a box and a wait names what it is, its time and its share", () => {
  const model = W.mapModel(synthetic(3, 4), { maxBoxes: 10 })
  const box = model.items.find((x) => x.type === "box")
  const wait = model.items.find((x) => x.type === "wait" && x.waited_on === "queue_before_start")
  const cb = Object.fromEntries(W.drawer({ kind: "box", item: box }, { origin_ms: 0, lead_ms: model.totals.lead_ms }).rows)
  assert.match(cb["What it is"], /^One work burst/)
  assert.match(cb["Working time"], /of the lead time\)$/)
  const cw = W.drawer({ kind: "wait", item: wait }, { origin_ms: 0, lead_ms: model.totals.lead_ms })
  assert.equal(cw.title, "Wait: queued before the first session")
  assert.equal(Object.fromEntries(cw.rows)["Waited on"], "the task was waiting for its first session to start")
})

test("the prompt for an agent carries the page route and the data file, and nothing else about the operator", () => {
  assert.equal(
    W.promptText({ what: "this stretch", name: "Private task 825084c9", route: "https://ourostack.github.io/factory/#/task/825084c9676f1da79f49e868ff950abb/session/5f4879fb", dataUrl: "https://ourostack.github.io/factory/jobs/825084c9676f1da79f49e868ff950abb/5f4879fb.json" }),
    "Walk me through this stretch of factory task Private task 825084c9 (https://ourostack.github.io/factory/#/task/825084c9676f1da79f49e868ff950abb/session/5f4879fb, data: https://ourostack.github.io/factory/jobs/825084c9676f1da79f49e868ff950abb/5f4879fb.json). Explain what happened and what we could change.",
  )
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
  assert.equal(W.waitLabel("next_prompt"), "waiting for the next prompt")
  assert.equal(W.waitLabel("api_retry"), "waiting: API retry")
  const steps = W.zoomSteps(10 * H, 1000, 32768)
  assert.equal(steps[0], 1)
  assert.ok(1000 * steps[steps.length - 1] <= 32768)
})

// ------------------------------------------------ the map file and publishing

test("the slim map keeps what the landing view draws and drops intervals, per-turn times and pull request times", () => {
  const report = {
    job: { id: "j1" },
    timeline: {
      job: "j1",
      intervals: [{ start_ms: 0, end_ms: 1, kind: "turn" }],
      human_turns: [{ at_ms: 5, session: "s1" }],
      prs: [{ repo: "o/r", number: 7, at_ms: 1234, session: "s1", worker: 0, host: "h" }],
      bursts: [{ start_ms: 0, end_ms: 10, working_ms: 9, sessions: ["s1"], agents: 1, tool_calls: 2, tool_failures: 0, operator_turns: 1, prs: 1, value_ms: 3, defect_ms: 0, defect_stretches: 0 }],
      gaps: [{ start_ms: 10, end_ms: 20, waited_on: "next_prompt" }],
      lead_window: { start_ms: 0, end_ms: 20, state: "measured", reasons: [] },
      sessions: [{ id: "s1", host: "h", offset_ms: 0, end_ms: 20, basis: ["x"], ended: true }],
      agents: [{ host: "h", session: "s1", n: 0, parent: null }],
      transitions: [{ offset_ms: 3, to: "done" }],
      observations: [{ offset_ms: 4, status: "done" }],
      outcome: { state: "not_recorded", deliveries: 0, job: "j1" },
      detail_files: ["jobs/j1/s1.json"],
    },
  }
  const slim = W.slimMap(report)
  const text = JSON.stringify(slim)
  assert.doesNotMatch(text, /"intervals"|"human_turns"|"at_ms"|"basis"/)
  assert.deepEqual(slim.prs, [{ repo: "o/r", number: 7 }])
  assert.equal(slim.bursts.length, 1)
  assert.deepEqual(slim.gaps, [{ start_ms: 10, end_ms: 20, waited_on: "next_prompt" }])
  assert.deepEqual(slim.detail_files, ["jobs/j1/s1.json"])
  assert.equal(slim.job, "j1")
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
  assert.match(llmsText("{{READ_WHOLE}}\n{{FILES}}", files), /## Step 1, follow a task: one task's map\n\n- map\/j1\.json \(\d+ KB, small enough to read whole\): the work bursts, waits, card status changes and pull request numbers of task j1/)

  const emptyRoot = mkdtempSync(join(tmpdir(), "follow-task-empty-"))
  mkdirSync(join(emptyRoot, "dist"), { recursive: true })
  const none = publishData({ reports: join(emptyRoot, "reports"), dist: join(emptyRoot, "dist") })
  assert.deepEqual(none.maps, [])
  assert.deepEqual(readdirSync(join(emptyRoot, "dist")), [])
  // The workflow prints the map files' size line and publishes walk.js.
  const wf = read(".github/workflows/pages.yml")
  assert.match(wf, /cp site\/src\/index\.html site\/src\/styles\.css site\/src\/format\.js site\/src\/walk\.js site\/src\/app\.js site\/dist\//)
  assert.match(read("site/scripts/publish-files.mjs"), /Task map files \(new\)/)
})

// ------------------------------------------------------------- the page

test("the page loads walk.js, opens evidence in a real dialog, and never draws per-turn operator markers or pull request times", () => {
  const html = read("site/src/index.html")
  assert.match(html, /<script src="walk\.js"><\/script>\s*<script src="app\.js"><\/script>/)
  assert.match(html, /<dialog id="evidence-drawer" class="drawer" aria-labelledby="drawer-title">/)
  for (const id of ["task-picker", "task-head", "task-lede", "vsm", "time-went", "job-detail", "swimlane"]) assert.match(html, new RegExp(`id="${id}"`))
  const app = read("site/src/app.js")
  assert.match(app, /showModal\(\)/)
  assert.match(app, /Copy as a prompt for your agent/)
  assert.doesNotMatch(app, /\.at_ms\b|human_turns\s*\[|\.human_turns\.(map|forEach|filter|length)|map\.human_turns/, "no per-turn operator markers and no pull request times on the task clock")
  // Every chart has a text equivalent.
  assert.match(app, /The map as a table/)
  assert.match(app, /labeled stretches as a table/)
  assert.match(app, /aria-label", `Lead time/)
  // The walk's files load on demand, and a missing file reads as not published.
  assert.match(app, /walkFile\("rollups\/tasks\.json"\)/)
  assert.match(app, /walkFile\(mapPath\(j\.id\)\)/)
  assert.match(app, /not published yet/)
})

test("the reason text table covers the walk's new reasons", () => {
  for (const r of ["labels_from_shared_session", "agents_working", "card_dates_shorter_than_work", "censored", "open_job", "cancelled", "job_offsets_unavailable"]) {
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
  assert.deepEqual(s.alarms.map((a) => a.key), ["capture_alarm", "labels_mismatch"], "a fix-next alarm whose title starts like another's words is still told")
})
