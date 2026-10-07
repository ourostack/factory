// Steps 2 to 4 of the Lean walk: Compare tasks (the stack-up and the flow
// efficiency dot plot), Rank causes (the Pareto chart and each cause's page,
// with its A3 prompt) and Act (the problems in hand and the alarm owners),
// plus the step-1 changes they bring (the top causes in two groups, the
// labeled wait's swatch). Every rule lives in site/src/steps.js.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const S = require("../../../site/src/steps.js")
const W = require("../../../site/src/walk.js")
const F = require("../../../site/src/format.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const snap = () => JSON.parse(read(".github/fixtures/walk/snapshot.json"))

const H = 3600000
const M = 60000
const m = (value, extra) => ({ state: "measured", value, reasons: [], ...(extra || {}) })
const p = (value, reasons, extra) => ({ state: "partial", value, reasons, ...(extra || {}) })
const u = (reasons) => ({ state: "unavailable", reasons })
const job = (id, pos, basis, status) => ({ id, status: status || "done", finish_order: pos === null ? u(["no_facts"]) : m(pos), finish_basis: basis })
const nameOf = (j) => `Task ${j.id}`

// A task with a known split: 1 h value, 0.5 h necessary, 0.25 h defects,
// then waiting 6 h for the next prompt and 0.25 h with its cause not recorded.
function rows(id, opts) {
  const o = opts || {}
  const lead = o.lead || 8 * H
  const working = 1.75 * H
  const idle = lead - working
  const stack = {
    job: id,
    status: m(o.status || "done"),
    lead_time_ms: o.leadN || m(lead),
    working_ms: m(working),
    idle_ms: m(idle),
    working: { class_ms: { value: m(H), support: m(0.5 * H) }, waste_ms: { defects: m(0.25 * H) }, agents_working_unlabeled_ms: m(0), not_labeled_ms: m(0) },
    idle: { next_prompt: m(idle - 0.25 * H), unknown: m(0.25 * H) },
  }
  const task = {
    job: id,
    status: m(o.status || "done"),
    lead_time_ms: o.leadN || m(lead),
    working_ms: o.workN || m(working),
    idle_ms: m(idle),
    waiting_by_waited_on_ms: { next_prompt: m(idle - 0.25 * H), unknown: m(0.25 * H) },
    flow_efficiency: o.fe || m(working / lead),
    labels_from_shared_session: !!o.shared,
    top_causes: m([{ cause: "waiting:next_prompt", total_ms: idle - 0.25 * H }, { cause: "defects:shell", total_ms: 0.25 * H }]),
  }
  return { stack, task }
}

// ------------------------------------------------------------ the order

test("the walk's order: finished tasks in finish order, the latest on the right, then the rest by when work began, then tasks with no place", () => {
  const order = S.walkOrder([job("open2", 12, "facts", "processing"), job("f2", 2, "labels"), job("none", null, "none", "drafting"), job("f1", 1, "labels"), job("open1", 10, "facts")])
  assert.deepEqual(order.map((x) => x.j.id), ["f1", "f2", "open1", "open2", "none"])
  assert.deepEqual(order.map((x) => x.group), ["finished", "finished", "open", "open", "open"])
})

// ------------------------------------------------------- the stack-up

test("each bar stacks working time by label from the base up, then waiting by cause, and the parts sum to the lead time", () => {
  const a = rows("a")
  const [bar] = S.stackBars([job("a", 1, "labels")], [a.stack], [a.task], { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.equal(bar.state, "ok")
  assert.deepEqual(bar.segments.map((s) => s.key), ["value", "support", "defects", "wait_next_prompt", "wait_unknown"])
  assert.equal(bar.segments.reduce((x, s) => x + s.ms, 0), 8 * H)
  assert.equal(bar.total_ms, 8 * H)
  assert.deepEqual(bar.groups.map((g) => [g.key, g.ms]), [["working", 1.75 * H], ["waiting", 6.25 * H]])
  assert.equal(bar.href, "#/task/a")
  assert.equal(bar.label, "8h")
  assert.equal(bar.words, "8 hours")
})

test("agent working time mode shows only tasks with labeled working time, at their own scale, and one sentence accounts for the rest", () => {
  const { tasks, stackup, jobs } = snap()
  const bars = S.stackBars(jobs, stackup, tasks, { mode: "working", segments: F.SEGMENTS, nameOf: (j) => `Task ${j.id.slice(0, 8)}` })
  const v = S.workingView(bars)
  assert.equal(v.bars.length, 8)
  assert.ok(v.bars.every((b) => b.group === "finished" && b.state === "ok"))
  assert.ok(Math.max(...v.bars.map((b) => b.total_ms)) < 20 * H, "the scale fits the labeled tasks, not the open ones")
  assert.equal(v.left_out, 23)
  assert.match(v.text, /^23 tasks are left out because none of their working time is labeled yet: 8 still open hold \d+ hours of working time not labeled yet, the most in “Task 1f0ae588” \(258 hours\); 1 done but not labeled yet holds 3\.6 hours; 14 have no working time measured\. The table below lists every task\.$/)
  // A bar whose working time is all "not labeled yet" is left out; one with any label stays.
  const a = rows("a")
  const o = rows("o", { status: "processing", leadN: p(8 * H, ["censored"]) })
  o.stack.working = { class_ms: {}, waste_ms: {}, agents_working_unlabeled_ms: m(0), not_labeled_ms: m(1.75 * H) }
  const two = S.stackBars([job("a", 1, "labels"), job("o", 2, "facts", "processing")], [a.stack, o.stack], [a.task, o.task], { mode: "working", segments: F.SEGMENTS, nameOf })
  assert.deepEqual(S.workingView(two).bars.map((b) => b.job), ["a"])
  assert.equal(S.workingView([]).text, "")
})

test("the chart labels the finished task that waited longest (idle time only) in all mode, and the most labeled waste in working mode", () => {
  const { tasks, stackup, jobs } = snap()
  const opts = (mode) => ({ mode, segments: F.SEGMENTS, nameOf: (j) => `Task ${j.id.slice(0, 8)}` })
  const all = S.mostWaste(S.stackBars(jobs, stackup, tasks, opts("all")), "all")
  assert.equal(all.job.slice(0, 8), "c9235d85")
  assert.match(all.label, /^Waited longest: \d+h$/)
  const work = S.mostWaste(S.workingView(S.stackBars(jobs, stackup, tasks, opts("working"))).bars, "working")
  assert.equal(work.job.slice(0, 8), "690331dd")
  assert.equal(work.label, "Most labeled waste: 17m")
  assert.equal(S.mostWaste([], "all"), null)
  // Labeled waste never counts toward waiting: a task with less idle time
  // but more labeled waste does not win in all mode.
  const bar = (job, waitMs, wasteMs) => ({ job, group: "finished", state: "ok", segments: [{ key: "defects", ms: wasteMs }, { key: "wait_next_prompt", cause: "next_prompt", ms: waitMs }] })
  assert.equal(S.mostWaste([bar("a", 2 * H, 10 * H), bar("b", 3 * H, 0)], "all").job, "b")
  assert.equal(S.mostWaste([bar("a", 2 * H, 10 * H), bar("b", 3 * H, 0)], "working").job, "a")
})

test("agent working time mode keeps only the working group, so a 20-minute task is not drowned out by waiting", () => {
  const a = rows("a")
  const [bar] = S.stackBars([job("a", 1, "labels")], [a.stack], [a.task], { mode: "working", segments: F.SEGMENTS, nameOf })
  assert.deepEqual(bar.segments.map((s) => s.key), ["value", "support", "defects"])
  assert.equal(bar.total_ms, 1.75 * H)
  assert.ok(bar.segments.every((s) => !s.cause))
})

test("the stack-up bar is the task page's bar: the same walk.js timeBar, segment for segment, on every real task", () => {
  const { tasks, stackup, jobs } = snap()
  const bars = S.stackBars(jobs, stackup, tasks, { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.equal(bars.length, jobs.length, "every task has a bar")
  let ok = 0
  for (const b of bars) {
    const row = tasks.find((r) => r.job === b.job)
    const sr = stackup.find((r) => r.job === b.job)
    const tb = W.timeBar(sr, row, W.idleSplit(row, null), F.SEGMENTS)
    if (b.state === "ok") {
      ok += 1
      assert.deepEqual(b.segments, tb.segments, b.short)
      assert.ok(Math.abs(b.segments.reduce((x, s) => x + s.ms, 0) - b.total_ms) <= 1000, `${b.short}: parts sum to the lead time`)
    } else if (b.state === "unsplit") {
      assert.equal(tb.state, "lead_only", b.short)
      assert.equal(b.segments.length, 1)
      assert.ok(b.segments[0].ms > 0, "an unknown split is drawn as its own segment, never zero")
    } else assert.equal(b.label, "no data", b.short)
  }
  assert.ok(ok >= 15, `${ok} real tasks split`)
  // A finished task comes before every open one, and positions rise left to right in each group.
  const firstOpen = bars.findIndex((b) => b.group === "open")
  assert.ok(bars.slice(firstOpen).every((b) => b.group === "open"))
  const placed = bars.filter((b) => b.pos !== null)
  for (let i = 1; i < placed.length; i++) if (placed[i].group === placed[i - 1].group) assert.ok(placed[i].pos > placed[i - 1].pos)
})

test("unknown parts are never zero: a lead time with no split is one 'split not known' segment, and a missing figure is no data", () => {
  const leadOnly = { job: "b", status: m("done"), lead_time_ms: m(5 * H), working_ms: u(["source_unreadable"]) }
  const bars = S.stackBars([job("b", 1, "labels"), job("c", 2, "labels", "cancelled")], [leadOnly], [leadOnly, { job: "c", status: m("cancelled"), lead_time_ms: u(["cancelled"]), working_ms: u(["cancelled"]) }], { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.equal(bars[0].state, "unsplit")
  assert.deepEqual(bars[0].segments, [{ key: "unsplit", label: "Split not known", ms: 5 * H }])
  assert.deepEqual(bars[0].reasons, ["source_unreadable"])
  assert.equal(bars[1].state, "no_data")
  assert.equal(bars[1].total_ms, null)
  assert.deepEqual(bars[1].reasons, ["cancelled"])
  // In agent working time mode the lead-only task has no figure to draw.
  const working = S.stackBars([job("b", 1, "labels")], [leadOnly], [leadOnly], { mode: "working", segments: F.SEGMENTS, nameOf })
  assert.equal(working[0].state, "no_data")
  // A task with no row at all: no data, not a zero.
  const none = S.stackBars([job("d", 1, "labels")], [], [], { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.equal(none[0].state, "no_data")
  assert.deepEqual(none[0].reasons, ["not_published"])
})

test("open tasks are outlined as in progress and read 'so far'; bars on shared-session labels are marked partial; bounds read at least and at most", () => {
  const o = rows("o", { status: "processing", leadN: p(8 * H, ["censored"]) })
  const s = rows("s", { shared: true })
  const lb = rows("l", { leadN: p(8 * H, ["card_dates_shorter_than_work"]) })
  const bars = S.stackBars([job("s", 1, "labels"), job("l", 2, "labels"), job("o", 5, "facts", "processing")], [o.stack, s.stack, lb.stack], [o.task, s.task, lb.task], { mode: "all", segments: F.SEGMENTS, nameOf })
  const [sb, lbb, ob] = bars
  assert.equal(ob.open, true)
  assert.equal(ob.words, "8 hours so far")
  assert.equal(ob.label, "8h")
  assert.equal(sb.shared, true)
  assert.equal(sb.partial, true)
  assert.equal(sb.open, false)
  assert.equal(lbb.words, "at least 8 hours")
  assert.equal(lbb.label, "≥8h")
})

test("the stack-up's scale is linear from zero, in hours, with round ticks; minutes when every value is under an hour", () => {
  const sc = S.timeScale(309 * H)
  assert.equal(sc.unit, "hours")
  assert.equal(sc.ticks[0], 0)
  assert.ok(sc.max_ms >= 309 * H)
  const steps = sc.ticks.slice(1).map((t, i) => t - sc.ticks[i])
  assert.ok(steps.every((x) => x === steps[0]), "evenly spaced")
  assert.deepEqual(sc.ticks.map((t) => S.tickWords(t, sc)), ["0", "100", "200", "300", "400"])
  const small = S.timeScale(17 * M)
  assert.equal(small.unit, "minutes")
  assert.deepEqual(small.ticks.map((t) => S.tickWords(t, small)), ["0", "5", "10", "15", "20"])
  assert.equal(S.timeScale(0).ticks[0], 0)
})

// ------------------------------------------------------------ the lede

test("Compare tasks' lede gives the real share of elapsed time agents worked, what the rest waited on, and the task that waited longest", () => {
  const a = rows("a")
  const b = rows("b", { lead: 20 * H })
  const jobs = [job("a", 1, "labels"), job("b", 2, "labels"), job("o", 3, "facts", "processing")]
  const o = rows("o", { status: "processing", leadN: p(8 * H, ["censored"]) })
  const bars = S.stackBars(jobs, [a.stack, b.stack, o.stack], [a.task, b.task, o.task], { mode: "all", segments: F.SEGMENTS, nameOf })
  const l = S.compareLede(bars, [a.task, b.task, o.task], F.reasonText)
  assert.equal(l.state, "ok")
  // 3.5 h of 28 h: 13%.
  assert.match(l.text, /^Across the 2 finished tasks whose time splits into working and waiting, agents were working 13% of the elapsed time \(3\.5 of 28 hours\)\./)
  assert.match(l.text, / The rest, 25 hours, was waiting, mostly for the next prompt \(the agent had stopped\) \(24 hours\)\./)
  assert.match(l.text, /The finished task that waited longest is “Task b”: 18 hours of waiting in a lead time of 20 hours\./)
  assert.match(l.text, /The 1 task not finished in the store's sense/)
})

test("the lede's share carries a bound: at most when lead times start at the first session, about when the bounds disagree", () => {
  const a = rows("a", { fe: p(0.2, ["card_dates_shorter_than_work"], { bound: "upper" }) })
  const b = rows("b", { fe: p(0.1, ["card_dates_shorter_than_work"], { bound: "upper" }) })
  const jobs = [job("a", 1, "labels"), job("b", 2, "labels")]
  const bars = S.stackBars(jobs, [a.stack, b.stack], [a.task, b.task], { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.match(S.compareLede(bars, [a.task, b.task]).text, /agents were working at most 22%/)
  const c = rows("b", { workN: p(1.75 * H, ["log_truncated"]), fe: p(0.1, ["log_truncated"]) })
  const bars2 = S.stackBars(jobs, [a.stack, c.stack], [a.task, c.task], { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.match(S.compareLede(bars2, [a.task, c.task]).text, /agents were working about 22%/)
})

test("the lede says what it leaves out, and degrades when nothing is published or nothing has finished", () => {
  const leadOnly = { job: "x", status: m("done"), lead_time_ms: m(5 * H), working_ms: u(["source_unreadable"]) }
  const a = rows("a")
  const bars = S.stackBars([job("a", 1, "labels"), job("x", 2, "labels")], [a.stack, leadOnly], [a.task, leadOnly], { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.match(S.compareLede(bars, [a.task, leadOnly], F.reasonText).text, /One more finished task does not split, because a session's log could not be read; its bar shows the lead time alone\./)
  const absent = S.stackBars([job("a", 1, "labels")], null, null, { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.equal(S.compareLede(absent, null).state, "absent")
  assert.equal(S.compareLede([], null).state, "absent")
  const open = rows("o", { status: "processing", leadN: p(8 * H, ["censored"]) })
  const onlyOpen = S.stackBars([job("o", 3, "facts", "processing")], [open.stack], [open.task], { mode: "all", segments: F.SEGMENTS, nameOf })
  assert.equal(S.compareLede(onlyOpen, [open.task]).state, "none_finished")
})

test("on the real store the lede names the finished tasks, a bound, and the cause most of the waiting had", () => {
  const { tasks, stackup, jobs } = snap()
  const bars = S.stackBars(jobs, stackup, tasks, { mode: "all", segments: F.SEGMENTS, nameOf })
  const l = S.compareLede(bars, tasks, F.reasonText)
  assert.equal(l.state, "ok")
  assert.match(l.text, /^Across the 8 finished tasks whose time splits into working and waiting, agents were working about \d+% of the elapsed time/)
  assert.equal(l.facts.top.key, "no_session")
  assert.ok(Math.abs(l.facts.lead_ms - l.facts.working_ms - l.facts.waiting_ms) < 1)
})

// --------------------------------------------------- flow efficiency dots

test("the flow efficiency dots follow the bars' order; a partial point is hollow and says at most or at least; unavailable points are counted", () => {
  const a = rows("a", { fe: p(0.32, ["card_dates_shorter_than_work"], { bound: "upper" }) })
  const b = rows("b")
  const x = { job: "x", status: m("done"), lead_time_ms: m(5 * H), working_ms: u(["source_unreadable"]), flow_efficiency: u(["source_unreadable"]) }
  const jobs = [job("a", 1, "labels"), job("x", 2, "labels"), job("b", 3, "labels")]
  const bars = S.stackBars(jobs, [a.stack, b.stack, x], [a.task, b.task, x], { mode: "all", segments: F.SEGMENTS, nameOf })
  const d = S.feDots(bars, [a.task, b.task, x])
  assert.deepEqual(d.points.map((q) => q.job), ["a", "b"])
  assert.equal(d.points[0].hollow, true)
  assert.equal(d.points[0].words, "at most 32%")
  assert.equal(d.points[1].hollow, false)
  assert.equal(d.omitted, 1)
  assert.deepEqual(d.reasons, [{ code: "source_unreadable", count: 1 }])
  const real = snap()
  const rd = S.feDots(S.stackBars(real.jobs, real.stackup, real.tasks, { mode: "all", segments: F.SEGMENTS, nameOf }), real.tasks)
  assert.equal(rd.points.length + rd.omitted, real.jobs.length)
})

// ----------------------------------------------------------- the Pareto

const causesDoc = (causes, extra) => ({ schema: "desk.factory.rollups/1", basis: "job_hours", state: "partial", n: 3, N: 5, reasons: ["not_labeled", "labels_from_shared_session"], references_per_cause: 10, causes, ...(extra || {}) })
const cause = (key, ms, jobs, spans) => ({ cause: key, waste: key.split(":")[0], total_ms: ms, hours: ms / H, jobs: jobs || ["a"], spans: spans || [] })

test("the Pareto's bars are in strictly descending time, the running total rises to 100%, and beyond the limit the rest fold into Other, last", () => {
  const doc = causesDoc([cause("defects:shell", 2 * H), cause("waiting:next_prompt", 10 * H), cause("extra_processing:all", 3 * H), cause("waiting:unknown", 1 * H), cause("defects:desk", 0.5 * H), cause("motion:all", 0)])
  const all = S.paretoModel(doc, "all")
  assert.deepEqual(all.bars.map((b) => b.key), ["waiting:next_prompt", "extra_processing:all", "defects:shell", "waiting:unknown", "defects:desk"], "a zero cause draws no bar")
  for (let i = 1; i < all.bars.length; i++) {
    assert.ok(all.bars[i].ms < all.bars[i - 1].ms)
    assert.ok(all.bars[i].cum > all.bars[i - 1].cum)
  }
  assert.equal(all.bars.at(-1).cum, 1)
  assert.equal(all.total_ms, 16.5 * H)
  assert.equal(all.bars[0].label, "Waiting · next prompt (the agent had stopped)")
  assert.equal(all.bars[2].label, "Defects · failed shell calls")
  assert.equal(all.bars[0].href, "#/causes/waiting:next_prompt")
  const folded = S.paretoModel(doc, "all", { maxBars: 3 })
  assert.deepEqual(folded.bars.map((b) => b.key), ["waiting:next_prompt", "extra_processing:all", "other"])
  assert.equal(folded.bars[2].label, "Other (3 causes)")
  assert.equal(folded.bars[2].ms, 3.5 * H)
  assert.deepEqual(folded.bars[2].members, ["defects:shell", "waiting:unknown", "defects:desk"])
  assert.equal(folded.bars[2].href, null)
})

test("agent working time mode leaves waiting out and ranks the causes agents can fix, with its own running total", () => {
  const doc = causesDoc([cause("waiting:next_prompt", 10 * H), cause("extra_processing:all", 3 * H), cause("defects:shell", 1 * H)])
  const w = S.paretoModel(doc, "working")
  assert.deepEqual(w.bars.map((b) => b.key), ["extra_processing:all", "defects:shell"])
  assert.equal(w.bars[0].share, 0.75)
  assert.equal(w.bars.at(-1).cum, 1)
  assert.equal(w.left_out, 10 * H)
  assert.equal(S.paretoModel(causesDoc([cause("waiting:next_prompt", H)]), "working").state, "empty")
  assert.equal(S.paretoModel(null, "all").state, "absent")
})

test("on the real store the Pareto keeps Desk's order and running total, and states its basis in one sentence", () => {
  const { causes } = snap()
  const all = S.paretoModel(causes, "all")
  assert.deepEqual(all.bars.map((b) => b.key), causes.causes.map((c) => c.cause))
  all.bars.forEach((b, i) => assert.ok(Math.abs(b.cum - causes.causes[i].cumulative_share) < 1e-9, b.key))
  assert.equal(all.bars[0].wait, "no_session")
  const note = S.paretoNote(all, F.reasonText)
  assert.match(note, /^Time is counted in job-hours: a moment two tasks share counts once for each task\. The ranking counts 8 of 31 tasks; the others are left out, for these reasons: /)
  assert.match(note, /Some counted figures are partial, for these reasons: some tasks' labels come from sessions they shared with other tasks/)
  assert.equal(S.paretoNote({ state: "absent" }), "The causes file is not published yet, so no cause can be ranked. No bar is drawn rather than a zero.")
})

test("a running total reads 100% only at the last bar", () => {
  assert.equal(S.cumWords(0.996), "99%")
  assert.equal(S.cumWords(1), "100%")
  assert.equal(S.cumWords(0.685), "69%")
})

test("Rank causes' lede names the largest cause, the vital few, and the largest cause agents can fix", () => {
  const { causes } = snap()
  const t = S.causesLede(S.paretoModel(causes, "all"), S.paretoModel(causes, "working"))
  assert.match(t, /^The ranking counts 8 of the 31 tasks; the note under the chart says why the rest are left out\. Across those 8, the largest cause, waiting · no session running, cost 117 hours: 69% of the 171 hours ranked\. Two causes of 9 carry 92% of the time: those are the vital few\./)
  assert.match(t, /Leave waiting out, and the largest cause agents can fix in their own work is extra processing, at 17 minutes\.$/)
  assert.match(S.causesLede({ state: "absent", bars: [] }, null), /not published yet/)
})

test("the lede says when one task holds most of the top cause, and the chart caption carries the ranking's coverage", () => {
  const { causes, tasks, stackup } = snap()
  const t = S.causesLede(S.paretoModel(causes, "all"), S.paretoModel(causes, "working"), { doc: causes, taskRows: tasks, stackRows: stackup, nameOf: (j) => `Task ${j.slice(0, 8)}` })
  assert.match(t, /cost 117 hours: 69% of the 171 hours ranked; 92 of its 117 hours are in one task, “Task c9235d85”\./)
  // No clause when no one task holds most of it.
  const spread = causesDoc([cause("waiting:no_session", 10 * H, ["a", "b"]), cause("defects:shell", H)])
  const rowsAB = [{ job: "a", waiting_by_waited_on_ms: { no_session: m(5 * H) } }, { job: "b", waiting_by_waited_on_ms: { no_session: m(5 * H) } }]
  assert.doesNotMatch(S.causesLede(S.paretoModel(spread, "all"), null, { doc: spread, taskRows: rowsAB }), /in one task/)
  const all = S.paretoModel(causes, "all")
  assert.match(S.paretoCaption(all), /It counts 8 of 31 tasks\.$/)
  assert.match(S.paretoCaption(S.paretoModel(causes, "working")), /^Agent working time only: waiting is left out \(\d.* of it\).*It counts 8 of 31 tasks\.$/)
})

test("on a phone, Compare's table is three columns (task, lead time, waiting), with every figure behind a disclosure that counts its tasks", () => {
  const { tasks, stackup, jobs } = snap()
  const bars = S.stackBars(jobs, stackup, tasks, { mode: "all", segments: F.SEGMENTS, nameOf: (j) => `Task ${j.id.slice(0, 8)}` })
  const rowsC = bars.map(S.compactRow)
  assert.equal(rowsC.length, 31)
  const first = rowsC[0]
  assert.deepEqual(Object.keys(first), ["job", "name", "href", "lead", "waiting"])
  assert.equal(first.lead, "100h")
  assert.equal(first.waiting, "100h")
  assert.ok(rowsC.some((r) => r.lead.startsWith("≥") && /^[≤~≥]?\d/.test(r.waiting)))
  assert.ok(rowsC.some((r) => r.lead === "no data" && r.waiting === "not known"))
  assert.equal(S.fullTableSummary(31), "Every figure, as a table (31 tasks)")
  assert.equal(S.fullTableSummary(1), "Every figure, as a table (1 task)")
  assert.equal(S.groupWords({ ms: 0 }), "none")
  assert.equal(S.groupWords({ ms: 2 * H, qualifier: "at least " }), "at least 2 hours")
})

test("finished tasks with no waste labels are counted and named, for the ranking note and Act", () => {
  const { jobs } = snap()
  const list = S.unlabeledFinished(jobs, (j) => `Task ${j.id.slice(0, 8)}`)
  assert.equal(list.length, 9)
  assert.ok(list.every((x) => /^#\/task\/[0-9a-f]+$/.test(x.href)))
  assert.deepEqual(S.unlabeledFinished([job("a", 1, "labels"), job("b", 2, "facts"), job("c", 3, "facts", "processing")]).map((x) => x.job), ["b"])
  assert.equal(S.unlabeledWords(9, "causes"), "9 finished tasks are waiting for the evaluator's waste labels; until they are labeled, the ranking leaves them out.")
  assert.equal(S.unlabeledWords(1, "act"), "1 finished task is waiting for the evaluator's waste labels; until it is labeled, it cannot count toward any check.")
  assert.equal(S.unlabeledWords(0, "act"), "")
})

// ------------------------------------------------------------ the routes

test("each cause has its own route, #/causes/<key>, under the Rank causes tab; a bad key is not a page", () => {
  assert.deepEqual(F.parseRoute("#/causes/waiting:next_prompt"), { view: "cause", cause: "waiting:next_prompt" })
  assert.deepEqual(F.parseRoute("#/causes/waiting%3Anext_prompt"), { view: "cause", cause: "waiting:next_prompt" })
  // The chart mode is in the URL, so a link opens the same view.
  assert.deepEqual(F.parseRoute("#/compare?mode=working"), { view: "compare", mode: "working" })
  assert.deepEqual(F.parseRoute("#/causes?mode=working"), { view: "causes", mode: "working" })
  assert.deepEqual(F.parseRoute("#/compare?mode=other"), { view: "compare" })
  assert.deepEqual(F.parseRoute("#/act?mode=working"), { view: "act" })
  // One cause-key pattern serves the route parser and the link builder.
  assert.equal(S.CAUSE_KEY, F.CAUSE_ID)
  assert.deepEqual(F.parseRoute("#/causes/defects:shell/"), { view: "cause", cause: "defects:shell" })
  for (const bad of ["#/causes/nope", "#/causes/<x>:y", "#/causes/a:b/c", "#/causes/%E0%A4%A", "#/causes/waiting:"]) assert.deepEqual(F.parseRoute(bad), { view: "missing" }, bad)
  assert.equal(F.stepOf("cause"), "causes")
  assert.equal(S.causeRoute("waiting:next_prompt"), "#/causes/waiting:next_prompt")
  assert.equal(S.causeRoute("javascript:alert(1)//"), "#/causes")
  assert.equal(S.isCauseKey("Waiting:x"), false)
})

// --------------------------------------------------------- one cause

test("a cause's page ranks it in both modes and lists its tasks largest first, each adding up to the cause on the real store", () => {
  const { causes, tasks, stackup } = snap()
  for (const c of causes.causes) {
    const d = S.causeDetail(causes, c.cause, { taskRows: tasks, stackRows: stackup })
    assert.equal(d.state, "ok")
    const sum = d.tasks.reduce((a, t) => a + (t.ms || 0), 0)
    assert.ok(Math.abs(sum - c.total_ms) <= 1000, `${c.cause}: ${sum} vs ${c.total_ms}`)
    for (let i = 1; i < d.tasks.length; i++) assert.ok(d.tasks[i].ms <= d.tasks[i - 1].ms)
    for (let i = 1; i < d.spans.length; i++) assert.ok(d.spans[i].ms <= d.spans[i - 1].ms, "stretches longest first")
  }
  const np = S.causeDetail(causes, "waiting:next_prompt", { taskRows: tasks, stackRows: stackup })
  assert.deepEqual([np.all.rank, np.all.of], [2, 9])
  assert.equal(np.working, null, "a waiting cause has no rank once waiting is left out")
  const ep = S.causeDetail(causes, "extra_processing:all", { taskRows: tasks, stackRows: stackup })
  assert.deepEqual([ep.working.rank, ep.working.of], [1, 3])
})

test("a cause no counted task has is not ranked; with no causes file the page says so; a failed tool kind's task time comes from its stretches", () => {
  const doc = causesDoc([cause("defects:shell", 30 * M, ["a", "b"], [{ job: "b", start_ms: 0, end_ms: 10 * M }, { job: "b", start_ms: 20 * M, end_ms: 25 * M }])])
  assert.equal(S.causeDetail(doc, "waiting:api_retry").state, "not_ranked")
  assert.equal(S.causeDetail(null, "waiting:api_retry").state, "absent")
  const a = rows("a")
  const d = S.causeDetail(doc, "defects:shell", { taskRows: [{ ...a.task, top_causes: m([{ cause: "defects:shell", total_ms: 15 * M }]) }], stackRows: [] })
  assert.deepEqual(d.tasks.map((t) => [t.job, t.ms, t.source]), [["b", 15 * M, "spans"], ["a", 15 * M, "task"]].sort((x, y) => (x[0] < y[0] ? -1 : 1)))
  assert.deepEqual(d.spans.map((s) => s.ms), [10 * M, 5 * M])
})

test("a stretch opens the map at the wait that holds it, or else the work burst", () => {
  const map = { gaps: [{ start_ms: 0, end_ms: 10 }, { start_ms: 100, end_ms: 200 }], bursts: [{ start_ms: 10, end_ms: 100 }, { start_ms: 200, end_ms: 300 }] }
  assert.deepEqual(S.spanItem(map, { start_ms: 120, end_ms: 180 }), { kind: "gaps", n: 2 })
  assert.deepEqual(S.spanItem(map, { start_ms: 210, end_ms: 290 }), { kind: "bursts", n: 2 })
  assert.deepEqual(S.spanItem(map, { start_ms: 90, end_ms: 150 }), { kind: "gaps", n: 2 }, "the item it overlaps most")
  assert.equal(S.spanItem(map, { start_ms: 900, end_ms: 950 }), null)
  assert.equal(S.spanItem(null, { start_ms: 0, end_ms: 1 }), null)
  // The real store: every listed stretch lands on an item of its task's map.
  const { causes, maps } = snap()
  for (const c of causes.causes) for (const s of c.spans || []) if (maps[s.job]) assert.ok(S.spanItem(maps[s.job], s), `${c.cause} ${s.job.slice(0, 8)}`)
})

test("the A3 prompt names the cause and its key, its time and share, its largest tasks, its page and where it sits in the data", () => {
  const { causes, tasks, stackup } = snap()
  const d = S.causeDetail(causes, "waiting:next_prompt", { taskRows: tasks, stackRows: stackup, promptNameOf: (j) => `factory task ${j.slice(0, 8)} (private)` })
  const t = S.a3Prompt(d, { route: "https://x.test/#/causes/waiting:next_prompt", dataUrl: "https://x.test/rollups/causes.json" })
  assert.match(t, /^Help me start an A3 on factory cause "Waiting · next prompt \(the agent had stopped\)" \(waiting:next_prompt\)\. It cost 39 hours, counted per task, 23% of all the time ranked\. It ranks 2nd of 9 causes by time\./)
  assert.match(t, /Its largest tasks are factory task 825084c9 \(private\), 36 hours; factory task 690331dd \(private\), 2\.5 hours; factory task c87c243f \(private\), 33 minutes; of 4 tasks in all\./)
  assert.match(t, /Its page is https:\/\/x\.test\/#\/causes\/waiting:next_prompt, and its data is the entry with cause "waiting:next_prompt" in https:\/\/x\.test\/rollups\/causes\.json\./)
  assert.doesNotMatch(t, /causes\[|\) \(/)
  assert.match(t, /draft the A3 with me/)
})

test("each cause reads the same on a task's page: waiting and labeled working causes in two groups, with Rank causes' keys and links", () => {
  const { tasks, causes } = snap()
  const keys = new Set(causes.causes.map((c) => c.cause))
  const row = tasks.find((r) => r.job.startsWith("825084c9"))
  const tc = S.taskCauses(row, W.idleSplit(row, null))
  assert.deepEqual(tc.waiting.map((c) => c.key), ["waiting:next_prompt", "waiting:unknown"])
  assert.deepEqual(tc.working.map((c) => c.key), ["defects:shell"])
  for (const c of [...tc.waiting, ...tc.working]) {
    assert.ok(keys.has(c.key), c.key)
    assert.equal(c.href, `#/causes/${c.key}`)
  }
  assert.ok(tc.waiting.every((c) => c.key.startsWith("waiting:")) && tc.working.every((c) => !c.key.startsWith("waiting:")))
  const none = S.taskCauses({ top_causes: u(["not_labeled"]) }, { by: [] })
  assert.deepEqual([none.waiting, none.working, none.working_state, none.working_reasons], [[], [], "unavailable", ["not_labeled"]])
})

// ----------------------------------------------------------------- act

test("Act lists one row per kaizen issue with its countermeasure, a cause only from the mapping table, and the honest check state", () => {
  const issues = [
    { ref: "#52", title: "Kaizen: desk release friction, api_retries", issue_state: "closed", url: "https://github.com/ourostack/factory/issues/52", resolution: { kind: "countermeasure", ref: "#60", url: "https://github.com/ourostack/desk/pull/60", merged: true } },
    { ref: "#53", title: "Kaizen: desk skill friction, human_wait", issue_state: "closed", url: "https://github.com/ourostack/factory/issues/53", resolution: { kind: "countermeasure", ref: "#65", url: "https://github.com/ourostack/desk/pull/65", merged: true } },
    { ref: "#70", title: "Kaizen: waiting for the next prompt", issue_state: "open", url: "https://github.com/ourostack/factory/issues/70" },
    { ref: "#9", issue_state: "closed", url: "javascript:alert(1)" },
  ]
  const rows = S.actRows(issues, causesDoc([cause("waiting:next_prompt", H)]))
  assert.deepEqual(rows.map((r) => r.ref), ["ourostack/factory#70", "ourostack/factory#53", "ourostack/factory#52", "#9"], "open first, then the newest; a URL that is not GitHub keeps its plain ref (the page shows it as text)")
  assert.equal(rows[0].cause, null, "a title that names a cause does not map it: only the table does")
  assert.equal(rows[0].countermeasure, null)
  assert.deepEqual(rows[1].cause, { key: "waiting:next_prompt", label: "Waiting · next prompt (the agent had stopped)", href: "#/causes/waiting:next_prompt", ranked: true })
  assert.equal(rows[2].cause.ranked, false)
  assert.deepEqual(rows[1].countermeasure, { ref: "ourostack/desk#65", url: "https://github.com/ourostack/desk/pull/65", merged: true, kind: "countermeasure" })
  assert.equal(rows[1].title, "desk skill friction, human_wait")
  assert.ok(rows.every((r) => r.check === "not enough labeled tasks yet"))
  assert.deepEqual(Object.keys(S.KAIZEN_CAUSES).sort(), ["ourostack/factory#52", "ourostack/factory#53"])
  for (const k of Object.values(S.KAIZEN_CAUSES)) assert.ok(S.isCauseKey(k))
  assert.deepEqual(S.actRows(null, null), [])
})

test("Act's second list is the open factory-alarm issues, each with the status-line alarms its title's keys name", () => {
  const a = S.alarmRows([
    { ref: "ourostack/desk#231", url: "https://github.com/ourostack/desk/issues/231", issue_state: "open", keys: ["capture:copilot-cli"] },
    { ref: "ourostack/desk#9", url: "https://github.com/ourostack/desk/issues/9", issue_state: "closed", keys: ["loop:improvement_age"] },
    { ref: "ourostack/factory#3", url: "https://github.com/ourostack/factory/issues/3", issue_state: "open", keys: ["loop:steps_stale"] },
  ])
  assert.deepEqual(a, [
    { ref: "ourostack/desk#231", url: "https://github.com/ourostack/desk/issues/231", owns: ["capture coverage on copilot-cli"] },
    { ref: "ourostack/factory#3", url: "https://github.com/ourostack/factory/issues/3", owns: ["the improvement loop (steps stale)"] },
  ])
  assert.equal(S.refOf("https://github.com/ourostack/desk/pull/65"), "ourostack/desk#65")
  assert.equal(S.refOf("https://evil.test/ourostack/desk/pull/65"), null)
})

// ------------------------------------------------------- step 1, carried

test("the evidence drawer gives a labeled wait the swimlane's cross-hatch, not the solid waiting color", () => {
  const wait = W.drawer({ kind: "stretch", stretch: { class: "muda", waste: "waiting", waited_on: "next_prompt", start_ms: 0, end_ms: 60000, evidence: [] }, index: 0, total: 1, intervals: [], lanes: [] }, {})
  assert.equal(wait.segment, "labeled_wait")
  const defect = W.drawer({ kind: "stretch", stretch: { class: "muda", waste: "defects", start_ms: 0, end_ms: 60000, evidence: [] }, index: 0, total: 1, intervals: [], lanes: [] }, {})
  assert.equal(defect.segment, "defects")
  const app = read("site/src/app.js")
  assert.match(app, /if \(key === "labeled_wait"\) \{\s*const k = el\("span", "swatch lane-key lane-key-wait"\)/)
  // idleSplit's comment sits on idleSplit.
  const walk = read("site/src/walk.js")
  assert.match(walk, /source \} with `by` largest first\.\n  function idleSplit\(row, map\) \{/)
  assert.match(walk, /Returns \{ key: ms \}\.\n  function burstIdleBy\(b\) \{/)
  // The picker's open group says its order.
  assert.match(app, /"Still open or not labeled yet, the latest to start first"/)
})

// ------------------------------------------------------------- the page

test("the walk reads in order: each step names its number and ends with a link to the next", () => {
  const html = read("site/src/index.html")
  const view = (id, next) => html.slice(html.indexOf(`id="view-${id}"`), html.indexOf(`id="view-${next}"`))
  assert.match(view("task", "session"), /Step 1 of 4[\s\S]*<a href="#\/compare">Next: <span class="step-n" aria-hidden="true">2<\/span>Compare tasks<\/a>/)
  assert.match(view("compare", "causes"), /Step 2 of 4[\s\S]*<a href="#\/causes">Next: <span class="step-n" aria-hidden="true">3<\/span>Rank causes<\/a>/)
  assert.match(view("causes", "cause"), /Step 3 of 4[\s\S]*<a href="#\/act">Next: <span class="step-n" aria-hidden="true">4<\/span>Act<\/a>/)
  assert.match(view("cause", "act"), /<a href="#\/act">Next: /)
  assert.match(view("act", "why"), /Step 4 of 4[\s\S]*Back to <span class="step-n" aria-hidden="true">1<\/span>Follow a task/)
  // Both charts switch between the same two modes.
  for (const v of ["compare", "causes"]) {
    const x = view(v, v === "compare" ? "causes" : "cause")
    assert.match(x, /data-mode="all" aria-pressed="true">All elapsed time</)
    assert.match(x, /data-mode="working" aria-pressed="false">Agent working time</)
  }
  // The old v0 lists are gone from the walk: no "what to fix next" and no labeled-waste bar list.
  assert.doesNotMatch(html, /id="fix-list"|id="labeled-waste"|id="kaizen-panel"/)
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /function renderFixNext|function renderLabeledWaste|function renderKaizen/)
  // Every chart has a text equivalent.
  for (const id of ["stackup-table", "pareto-table"]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(app, /Start an A3 with your agent/)
})

test("llms.txt describes the files behind steps 2 to 4 in the page's words", async () => {
  const { llmsText } = await import("../../../site/scripts/publish-files.mjs")
  const t = llmsText(read("site/src/llms-template.txt"), [{ path: "data.json", bytes: 1000 }, { path: "rollups/stackup.json", bytes: 1000 }, { path: "rollups/causes.json", bytes: 1000 }])
  assert.match(t, /- rollups\/stackup\.json \(1 KB, small enough to read whole\): one row per task: its lead time split into working time by the evaluator's labels and waiting \(idle time\) by what it waited on/)
  assert.match(t, /- rollups\/causes\.json \(1 KB, small enough to read whole\): each cause's time in job-hours/)
  assert.match(t, /alarm_issues \(who owns each alarm\) are step 4, Act/)
  assert.match(t, /`#\/causes\/<key>`/)
})

test("the page wires fix round 1: the working view, the waste label, the phone tables, pinned Pareto axes, a reachable Other bar and the unlabeled notes", () => {
  const app = read("site/src/app.js")
  const html = read("site/src/index.html")
  assert.match(app, /S\.workingView\(S\.stackBars\(data\.jobs, stackRows, taskRows, opts\("working"\)\)\)/)
  assert.match(app, /drawStackup\(document\.getElementById\("stackup"\), bars, mode, S\.mostWaste\(bars, mode\)\)/)
  for (const t of ["sb-table", "pareto-table", "cause-tasks"]) assert.ok(app.includes(`"data-table ${t}"`), t)
  assert.doesNotMatch(app + read("site/src/styles.css"), /phone-cards|labelCells/)
  assert.match(app, /summary\.textContent = S\.fullTableSummary\(bars\.length\)/)
  assert.match(app, /svg\("g", \{ class: "chart-other", tabindex: "0"/)
  assert.match(app, /row\.append\(left, frame, right\)/)
  assert.match(app, /unlabeledNote\(document\.getElementById\("act-unlabeled"\), data, "act"\)/)
  assert.match(app, /unlabeledNote\(document\.getElementById\("causes-unlabeled"\), data, "causes"\)/)
  assert.match(app, /history\.replaceState\(null, "", `#\/\$\{which\}\$\{modes\[which\] === "working" \? "\?mode=working" : ""\}`\)/)
  for (const id of ["stackup-left-out", "causes-unlabeled", "act-unlabeled"]) assert.match(html, new RegExp(`id="${id}"`), id)
  // On Act the note sits below "Problems in hand".
  assert.ok(html.indexOf('id="act-unlabeled"') > html.indexOf('id="problems"'))
  assert.ok(html.indexOf('id="act-unlabeled"') < html.indexOf('id="owners-title"'))
})
