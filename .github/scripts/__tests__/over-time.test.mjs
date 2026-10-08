// Compare → Over time (S3 v1.1, fix round 1): the By week stacked bars in
// three modes, the cause × week table, flow efficiency by week as ranges with
// a bounded weekly median, the base and the day-certainty words, and the
// finished tasks with no day. Every rule lives in site/src/steps.js.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const S = require("../../../site/src/steps.js")
const F = require("../../../site/src/format.js")

const H = 3600000
const m = (value) => ({ state: "measured", value, reasons: [] })
const lo = (value) => ({ state: "partial", value, reasons: ["unmeasured_members"], bound: "lower" })
const u = (reasons) => ({ state: "unavailable", reasons })

const WAITS = ["next_prompt", "no_session", "other_task", "unknown"]
const WASTES = ["defects", "extra_processing", "unknown"]
function week(w, starts_on, jobs, waits, wastes, extra) {
  return {
    week: w,
    starts_on,
    n: jobs.length,
    n_partial: (extra && extra.n_partial) || 0,
    jobs,
    lead_ms: m(10 * H),
    working_ms: m(2 * H),
    idle_ms: m(8 * H),
    idle_by_waited_on_ms: Object.fromEntries(WAITS.map((k) => [k, waits[k] !== undefined ? waits[k] : m(0)])),
    by_waste_ms: Object.fromEntries(WASTES.map((k) => [k, wastes[k] !== undefined ? wastes[k] : m(0)])),
    agents_working_unlabeled_ms: m(H / 2),
    not_labeled_ms: m(H),
    flow_efficiency: { median: m(0.2), n: jobs.length, N: jobs.length, of: "finished tasks with measured flow efficiency" },
    ...(extra || {}),
  }
}
const fd = (value, state = "measured", bound) => ({ state, value, reasons: state === "measured" ? [] : ["x"], basis: "pr_anchor", ...(bound !== undefined ? { bound } : {}) })
const doc = () => ({
  schema: "factory.site.by_week/1",
  basis: "by_finish_week",
  weeks: [
    week("2026-W39", "2026-09-21", ["a", "b"], { next_prompt: m(3 * H), no_session: m(10 * H), other_task: m(H) }, { defects: m(H / 4) }),
    { week: "2026-W40", starts_on: "2026-09-28", n: 0 },
    week("2026-W41", "2026-10-05", ["c", "d", "e"], { next_prompt: lo(5 * H), no_session: m(0), unknown: lo(H / 10) }, { extra_processing: lo(H / 5) }, { n_partial: 2 }),
  ],
  tasks: [
    { job: "a", finish_date: fd("2026-09-22"), flow_efficiency: m(0.5) },
    { job: "b", finish_date: fd("2026-09-26", "partial", "upper"), flow_efficiency: m(0.1) },
    { job: "c", finish_date: fd("2026-10-06", "partial", "lower"), flow_efficiency: u(["source_unreadable"]) },
    { job: "d", finish_date: fd("2026-10-06", "partial", null), flow_efficiency: lo(0.3) },
    { job: "e", finish_date: fd("2026-10-07"), flow_efficiency: m(0.05) },
  ],
  unplaced: { n: 1, jobs: ["z"], reasons: ["no_finish_source"] },
})
const jobs = [
  ...["a", "b", "c", "d", "e"].map((id) => ({ id, status: "done", finish_date: doc().tasks.find((t) => t.job === id).finish_date })),
  { id: "z", status: "done", finish_date: u(["no_finish_source"]) },
  { id: "o", status: "processing", finish_date: u(["open_job"]) },
]
const taskRows = doc().tasks.map((t) => ({ job: t.job, flow_efficiency: t.flow_efficiency }))
const opts = { jobs, taskRows: doc().tasks.map((t) => ({ job: t.job, flow_efficiency: t.flow_efficiency, lead_time_ms: m(10 * H) })).concat([{ job: "z", lead_time_ms: m(30 * H) }]), nameOf: (j) => `Task ${j.id}`, year: 2026 }
const fixture = () => JSON.parse(readFileSync(new URL("../../fixtures/over-time/by_week_26.json", import.meta.url), "utf8"))

test("the picker sorts by finish day: newest first by default, oldest first on request; tasks with no day keep their place after the dated ones, and the other group keeps its own order", () => {
  const rows = [
    { id: "late", group: "finished" },
    { id: "nodate", group: "finished" },
    { id: "early", group: "finished" },
    { id: "mid", group: "finished" },
    { id: "open1", group: "open" },
    { id: "open2", group: "open" },
  ]
  const fds = { late: fd("2026-10-07"), early: fd("2026-09-22", "partial", "upper"), mid: fd("2026-09-30"), nodate: u(["no_finish_source"]), open1: u(["open_job"]), open2: fd("2026-10-01") }
  const finishOf = (id) => F.finishDay(fds[id], { year: 2026 })
  assert.deepEqual(S.sortPicker(rows, finishOf).map((r) => r.id), ["late", "mid", "early", "nodate", "open1", "open2"])
  assert.deepEqual(S.sortPicker(rows, finishOf, "oldest").map((r) => r.id), ["early", "mid", "late", "nodate", "open1", "open2"])
  // Each row carries its finish day in words.
  assert.equal(S.sortPicker(rows, finishOf)[2].finish.words, "on or before 22 Sep")
})

test("every stack-up bar carries its task's finish day", () => {
  const jobs = [{ id: "a", status: "done", finish_order: m(1), finish_basis: "labels", finish_date: fd("2026-09-26", "partial", "upper") }]
  const bars = S.stackBars(jobs, [], [], { mode: "all", segments: F.SEGMENTS, nameOf: (j) => j.id })
  assert.equal(bars[0].finish.short.replace(/ \d{4}$/, ""), "≤26 Sep")
})

test("every week from first to last is listed; an empty week is a slot; a week under 3 tasks is thin", () => {
  const ot = S.overTime(doc(), opts)
  assert.equal(ot.state, "ok")
  assert.deepEqual(ot.weeks.map((w) => [w.week, w.n, w.empty, w.thin]), [["2026-W39", 2, false, true], ["2026-W40", 0, true, false], ["2026-W41", 3, false, false]])
  assert.equal(ot.weeks[0].label, "21 Sep")
  assert.equal(ot.weeks[2].count, "3 tasks, 2 partial")
  for (const mode of ["share", "all", "working"]) assert.deepEqual(S.weekBars(ot, mode)[1].segments, [])
  for (const r of S.causeTable(ot, "all").rows) assert.equal(r.cells[1].empty, true)
})

test("B1: each week says how its days lean, and the page says how many days are exact and claims no change bound days could explain", () => {
  const ot = S.overTime(doc(), opts)
  // W39: a measured day and an "on or before" day.
  assert.equal(ot.weeks[0].days.words, 'days: 1 exact, 1 on or before: may include tasks that finished earlier')
  assert.equal(ot.weeks[0].days.bracket, "left")
  // W41: "on or after", "about" and exact.
  assert.equal(ot.weeks[2].days.bracket, "both")
  assert.match(ot.weeks[2].days.words, /may include tasks that finished earlier or later/)
  assert.match(ot.days.words, /^Finish days of the 5 dated tasks: 2 exact, 1 "on or before", 1 "on or after" and 1 with no direction\. So a week may hold tasks that finished in an earlier or later week/)
  assert.equal(ot.days.coarse, true)
  assert.equal(ot.trend.words, "No change from week to week is claimed: there are not yet enough exact finish days to compare.")
  assert.equal(ot.trend.claimed, false)
  // N6: one short summary sentence leads; the rest sits behind a disclosure.
  assert.equal(ot.summary.words, "5 of 6 finished tasks are dated (50h of 80h lead time); only 2 of 5 days are exact, so no change between weeks is claimed.")
  // Counts from the file win when it has them.
  const d = doc()
  Object.assign(d.weeks[0], { n_day_measured: 0, n_day_on_or_before: 2, n_day_on_or_after: 0, n_day_about: 0 })
  assert.equal(S.overTime(d, opts).weeks[0].days.words, 'all "on or before" days: may include tasks that finished earlier')
  // Two weeks whose days are all exact: the trend names them.
  const sure = doc()
  for (const t of sure.tasks) t.finish_date = fd(t.finish_date.value)
  const ot2 = S.overTime(sure, { ...opts, jobs: [] })
  assert.equal(ot2.trend.claimed, true)
  assert.match(ot2.summary.words, /^5 of 6 finished tasks are dated \(50h of 80h lead time\)\. Agents' working time went from 20% to 20% of lead time between the weeks of 21 Sep and 5 Oct; see how the weeks are dated\.$/)
  // N2: a bounded day that could fall into a compared week stops the claim: an "on or before" day in a later week, or an "on or after" day in an earlier one.
  const later = structuredClone(sure)
  later.weeks.push(week("2026-W42", "2026-10-12", ["f"], {}, {}))
  later.tasks.push({ job: "f", finish_date: fd("2026-10-13", "partial", "upper"), flow_efficiency: m(0.2) })
  assert.equal(S.overTime(later, { ...opts, jobs: [] }).trend.claimed, false)
  const earlier = structuredClone(sure)
  earlier.weeks.unshift(week("2026-W38", "2026-09-14", ["g"], {}, {}))
  earlier.tasks.unshift({ job: "g", finish_date: fd("2026-09-15", "partial", "lower"), flow_efficiency: m(0.2) })
  assert.equal(S.overTime(earlier, { ...opts, jobs: [] }).trend.claimed, false)
  // A bounded day that cannot reach them leaves the claim: "on or before" in an earlier week.
  const harmless = structuredClone(sure)
  harmless.weeks.unshift(week("2026-W38", "2026-09-14", ["g"], {}, {}))
  harmless.tasks.unshift({ job: "g", finish_date: fd("2026-09-15", "partial", "upper"), flow_efficiency: m(0.2) })
  assert.equal(S.overTime(harmless, { ...opts, jobs: [] }).trend.claimed, true)
  assert.match(ot2.trend.words, /^In weeks whose tasks all have exact days and that no bounded finish day could reach, agents' working time went from 20% of the week's lead time \(week of 21 Sep, 2 tasks\) to 20% of the week's lead time \(week of 5 Oct, 3 tasks, 2 partial\)\. The week of 21 Sep is thin \(fewer than 3 tasks\), so read this as a hint, not a trend\.$/)
})

test("I3 and I7: the base is stated once, and the undated tasks are summed in one line with their hours", () => {
  const ot = S.overTime(doc(), opts)
  assert.equal(ot.base.words, "These weeks hold 5 of the 6 finished tasks: 50 of their 80 lead-time hours. The other 1 is not dated yet.")
  assert.equal(ot.unplaced.words, "1 finished task has no finish day yet, so it is on no chart here: 30 of the 80 lead-time hours of all finished tasks.")
  assert.deepEqual(ot.unplaced.groups.map((g) => [g.words, g.items.map((x) => x.job)]), [[`not dated yet: ${F.reasonText("no_finish_source")}`, ["z"]]])
  assert.equal(ot.open, 1)
})

test("B3: By week bars in share mode make each week 100% of its own lead time; all and working modes are hours", () => {
  const d = doc()
  // A week whose parts add up: 2 h working (0.25 value, 0.25 defects, 0.5 agents unlabeled, 1 not labeled) and 8 h waiting.
  Object.assign(d.weeks[0], { by_class_ms: { value: m(H / 4), support: m(0) }, idle_by_waited_on_ms: { next_prompt: m(3 * H), no_session: m(4 * H), other_task: m(H), unknown: m(0) } })
  const ot = S.overTime(d, opts)
  const share = S.weekBars(ot, "share")[0]
  const sum = share.segments.reduce((a, x) => a + x.share, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, String(sum))
  assert.equal(share.totalShort, "100%")
  // Working parts first, in the stack-up's order, then the waits in theirs.
  assert.deepEqual(share.segments.map((x) => x.key), ["value", "defects", "agents_working_unlabeled", "not_labeled", "wait_next_prompt", "wait_other_task", "wait_no_session"])
  // The part of the lead time with no split is its own part.
  const d2 = doc()
  d2.weeks[0].lead_ms = m(12 * H)
  const un = S.weekBars(S.overTime(d2, opts), "all")[0].segments.find((x) => x.key === "unsplit")
  assert.ok(un && un.ms > 0)
  const all = S.weekBars(ot, "all")[0]
  assert.equal(all.total, 10 * H)
  assert.equal(all.totalShort, "10h")
  const working = S.weekBars(ot, "working")[0]
  assert.equal(working.total, 2 * H)
  assert.ok(working.segments.every((x) => !x.cause))
  // A partial part keeps its direction.
  const w41 = S.weekBars(ot, "all")[2]
  assert.equal(w41.segments.find((x) => x.key === "wait_next_prompt").bound, "lower")
  // N1: a share's direction is the share's own, computed from its part and the week's lead time, and it agrees with the cause table.
  const sh41 = S.weekBars(ot, "share")[2]
  const table = S.causeTable(ot, "share")
  for (const seg of sh41.segments.filter((x) => x.cause)) {
    const row = table.rows.find((r) => r.key === `waiting:${seg.cause}`)
    if (!row) continue
    assert.equal(seg.bound, row.cells[2].bound, seg.key)
  }
  // A lower part over a lower lead time has no direction; a lower part over a measured lead time is at least; an exact part over an "at least" lead time is at most.
  const d3 = doc()
  Object.assign(d3.weeks[0], { lead_ms: { state: "partial", value: 10 * H, reasons: ["x"], bound: "lower" }, idle_by_waited_on_ms: { next_prompt: { state: "partial", value: 3 * H, reasons: ["x"], bound: "lower" }, no_session: m(4 * H), other_task: m(H), unknown: m(0) } })
  const s3 = S.weekBars(S.overTime(d3, opts), "share")[0].segments
  assert.equal(s3.find((x) => x.key === "wait_next_prompt").bound, "unknown")
  assert.equal(s3.find((x) => x.key === "wait_no_session").bound, "upper")
  const d4 = doc()
  Object.assign(d4.weeks[0], { idle_by_waited_on_ms: { next_prompt: { state: "partial", value: 3 * H, reasons: ["x"], bound: "lower" }, no_session: m(4 * H), other_task: m(H), unknown: m(0) } })
  const s4 = S.weekBars(S.overTime(d4, opts), "share")[0].segments
  assert.equal(s4.find((x) => x.key === "wait_next_prompt").bound, "lower")
  assert.equal(s4.find((x) => x.key === "wait_no_session").bound, null)
})

test("I2 and I6: the cause × week table has causes in Pareto order, one cell per week, one stated scale, and shares with an honest direction", () => {
  const ot = S.overTime(doc(), opts)
  const t = S.causeTable(ot, "all")
  assert.deepEqual(t.rows.map((r) => r.key), ["waiting:no_session", "waiting:next_prompt", "waiting:other_task", "defects:all", "extra_processing:all", "waiting:unknown"])
  assert.match(t.scale.words, /^bars run from 0 to \d+ hours per week, the same linear scale in every cell$/)
  const np = t.rows[1].cells[2]
  assert.deepEqual([np.short, np.bound], ["≥5h", "lower"])
  assert.equal(t.rows[0].cells[2].short, "0")
  assert.ok(t.rows.every((r) => r.cells.every((c) => c.empty || c.frac === null || (c.frac >= 0 && c.frac <= 1))))
  const sh = S.causeTable(ot, "share")
  assert.equal(sh.rows[1].cells[0].short, "30%")
  // A lower-bound part over a measured lead time is at least that share.
  assert.equal(sh.rows[1].cells[2].short, "≥50%")
  assert.match(sh.scale.words, /^bars run from 0 to \d+% of each week's lead time/)
  // Working mode leaves the waits out.
  assert.ok(S.causeTable(ot, "working").rows.every((r) => !r.key.startsWith("waiting:")))
  // An exact zero is zero of any lead time, partial or not; a lower-bound zero is at least zero.
  assert.equal(S.shareOf({ state: "measured", value: 0, reasons: [] }, { state: "partial", value: 10, reasons: ["x"], bound: "unknown" }).state, "measured")
  assert.equal(S.overTimeCell(S.shareOf({ state: "measured", value: 0, reasons: [] }, { state: "partial", value: 10, reasons: ["x"], bound: "unknown" }), false, "share").short, "0")
  assert.equal(S.overTimeCell(S.shareOf({ state: "partial", value: 0, reasons: ["x"], bound: "lower" }, { state: "measured", value: 10, reasons: [] }), false, "share").short, "≥0")
  // N4: one qualifier per figure, never "about under 1%" or "at least under 1%".
  const tiny = (bound) => S.overTimeCell({ state: "partial", value: 0.004, reasons: ["x"], bound }, false, "share").words
  assert.equal(tiny("unknown"), "less than 1% of the week's lead time recorded (direction not known)")
  assert.equal(tiny("lower"), "at least a sliver of the week's lead time (under 1% recorded)")
  assert.equal(tiny("upper"), "under 1% of the week's lead time")
  assert.ok(![tiny("unknown"), tiny("lower"), tiny("upper")].some((w) => /(about|at least|at most) under/.test(w)))
  // The same rule holds for flow efficiency marks and medians.
  const fd2 = doc()
  fd2.weeks[2].flow_efficiency = { n: 1, N: 1, of: "x", median: { state: "partial", value: 0.004, reasons: ["x"], bound: "upper" } }
  const med = S.overTime(fd2, opts).fe.weeks[2].median
  assert.equal(med.words, "median under 1%, 1 of 1 task")
  assert.equal(med.short, "<1%")
  // A share under 1% reads "<1%", never "~under 1%".
  assert.equal(S.overTimeCell({ state: "partial", value: 0.004, reasons: ["x"], bound: "unknown" }, false, "share").short, "~<1%")
  // The direction of a ratio from its parts.
  assert.equal(S.ratioBound("lower", null), "lower")
  assert.equal(S.ratioBound(null, "lower"), "upper")
  assert.equal(S.ratioBound("lower", "lower"), "unknown")
  assert.equal(S.ratioBound("upper", "lower"), "upper")
})

test("I4 and I5: flow efficiency by week is each task's range and the week's median in words", () => {
  const d = doc()
  d.weeks[2].flow_efficiency = { median: { state: "partial", value: 0.3, reasons: ["card_dates_shorter_than_work"], bound: "upper" }, n: 2, N: 3, of: "x" }
  const ot = S.overTime(d, opts)
  const w39 = ot.fe.weeks[0]
  // b is measured 10%, a measured 50%.
  assert.deepEqual(w39.marks.map((x) => [x.job, x.kind, x.lo, x.hi]), [["b", "exact", 0.1, 0.1], ["a", "exact", 0.5, 0.5]])
  const d41 = ot.fe.weeks[2].marks.find((x) => x.job === "d")
  assert.deepEqual([d41.kind, d41.lo, d41.hi, d41.words], ["at_least", 0.3, 1, "at least 30%"])
  assert.equal(ot.fe.weeks[0].median.words, "median 20%, 2 of 2 tasks")
  assert.equal(ot.fe.weeks[2].median.words, "median at most 30%, 2 of 3 tasks")
  assert.equal(ot.fe.weeks[2].median.short, "≤30%")
  assert.equal(ot.fe.weeks[1].median.words, "no task finished")
  // A dated task with no flow efficiency is named, not drawn.
  assert.deepEqual(ot.fe.omitted.map((x) => x.job), ["c"])
})

test("B2: 52 weeks fit the frame at 1280 px without scrolling, labels never overlap, and a phone scrolls only below the floor", () => {
  const wide = S.weekAxis(52, 1040)
  assert.equal(wide.scroll, false)
  assert.ok(wide.width <= 1040)
  assert.ok(wide.colW * wide.every >= 58)
  assert.equal(wide.showValues, false)
  const phone = S.weekAxis(52, 300)
  assert.equal(phone.colW, 8)
  assert.equal(phone.scroll, true)
  // N5: every label lies inside the frame and no two overlap, at phone and desktop widths; the newest week is always labeled.
  for (const [n, avail] of [[26, 300], [26, 994], [52, 1040], [3, 300], [13, 320]]) {
    const ax = S.weekAxis(n, avail, { min: 10, max: 96, labelPx: 52 })
    const ls = ax.labels
    assert.ok(ls.length > 0 && ls[ls.length - 1].i === n - 1, `${n}@${avail}: newest labeled`)
    for (const l of ls) assert.ok(l.left >= 0 && l.right <= ax.width + 0.001, `${n}@${avail}: label ${l.i} inside`)
    for (let k = 1; k < ls.length; k++) assert.ok(ls[k].left >= ls[k - 1].right, `${n}@${avail}: labels ${ls[k - 1].i} and ${ls[k].i} overlap`)
    for (const l of ls) assert.ok(["start", "middle", "end"].includes(l.anchor))
  }
  // Arrows for bounded days are drawn only when a column is at least 14 px wide.
  assert.equal(S.weekAxis(26, 300, { min: 10 }).brackets, false)
  assert.equal(S.weekAxis(3, 1040).brackets, true)
  const few = S.weekAxis(3, 1040)
  assert.deepEqual([few.colW, few.scroll, few.every, few.showValues], [120, false, 1, true])
})

test("the 26-week fixture: every week is listed, the newest week is last, and every model holds together", () => {
  const f = fixture()
  const ot = S.overTime(f, { jobs: [], taskRows: f.tasks, year: 2026 })
  assert.equal(ot.state, "ok")
  assert.equal(ot.weeks.length, 26)
  assert.equal(ot.weeks.filter((w) => w.empty).length, 4)
  assert.ok(ot.weeks[25].starts_on > ot.weeks[0].starts_on)
  for (const mode of ["share", "all", "working"]) {
    const bars = S.weekBars(ot, mode)
    assert.equal(bars.length, 26)
    if (mode === "share") for (const b of bars.filter((x) => !x.empty)) assert.ok(Math.abs(b.segments.reduce((a, x) => a + x.share, 0) - 1) < 1e-6, b.week)
    const t = S.causeTable(ot, mode)
    assert.ok(t.rows.length > 0)
    assert.ok(t.rows.every((r) => r.cells.length === 26))
  }
  // N2: weeks 19 to 26 are mostly exact, but "on or before" days in later weeks could reach every all-exact week, so nothing is claimed.
  assert.ok(ot.weeks.slice(18).some((w) => w.days.counts.exact === w.n && w.n > 0))
  const reachable = (i) => ot.weeks.some((w, j) => (j >= i && w.days.counts.before) || (j <= i && w.days.counts.after) || w.days.counts.about)
  assert.ok(ot.weeks.every((w, i) => w.empty || w.days.counts.exact !== w.n || reachable(i)))
  assert.equal(ot.trend.claimed, false)
  assert.equal(ot.trend.words, "No change from week to week is claimed: there are not yet enough exact finish days to compare.")
  assert.equal(ot.fe.weeks.length, 26)
})

test("Each task: the stack-up's finished, dated bars in finish order", () => {
  const bars = [
    { job: "x", finish: F.finishDay(fd("2026-10-07")), open: false, pos: 3 },
    { job: "y", finish: F.finishDay(fd("2026-09-22")), open: false, pos: 1 },
    { job: "z", finish: F.finishDay(u(["no_finish_source"])), open: false, pos: 2 },
    { job: "o", finish: F.finishDay(u(["open_job"])), open: true, pos: 4 },
  ]
  assert.deepEqual(S.eachTaskBars(bars).map((b) => b.job), ["y", "x"])
})

test("the route keeps the Over time choices in the query string", () => {
  assert.deepEqual(F.parseRoute("#/compare?over=task&otmode=all"), { view: "compare", over: "task", otmode: "all" })
  assert.deepEqual(F.parseRoute("#/compare?mode=working&otmode=working"), { view: "compare", mode: "working", otmode: "working" })
  assert.deepEqual(F.parseRoute("#/compare?over=bogus"), { view: "compare" })
  assert.deepEqual(F.parseRoute("#/compare?mode=share"), { view: "compare", mode: "share" })
  assert.equal(F.compareHash({ mode: "all", over: "week", otmode: "share" }), "#/compare")
  assert.equal(F.compareHash({ mode: "working", over: "task", otmode: "all" }), "#/compare?mode=working&over=task&otmode=all")
})

test("without the by-week file nothing is drawn rather than a zero", () => {
  assert.equal(S.overTime(null, opts).state, "absent")
  assert.equal(S.overTime({ schema: "factory.site.by_week/1", weeks: [], tasks: [], unplaced: { n: 0, jobs: [] } }, opts).state, "empty")
})

test("Compare has the Over time section, its lede, its two toggles and the cause × week table", () => {
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8")
  assert.match(html, /id="over-time"/)
  assert.match(html, /Each task is counted in the week it finished \(UTC\)/)
  for (const v of ['data-over="week"', 'data-over="task"', 'data-otmode="share"', 'data-otmode="all"', 'data-otmode="working"', 'id="cause-weeks"', 'id="over-time-base"']) assert.ok(html.includes(v), v)
  // The Over time buttons are not the stack-up's mode buttons.
  const section = html.slice(html.indexOf('id="over-time"'), html.indexOf("</section>", html.indexOf('id="over-time"')))
  assert.doesNotMatch(section, /class="mode-btn"/)
})

test("every drawer on a task's page states the task's finish day: each openDrawer call passes the task", () => {
  const src = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")
  const calls = [...src.matchAll(/\bopenDrawer\(opener, ([^\n]*)/g)].map((m) => m[1])
  assert.ok(calls.length >= 5, `found ${calls.length} calls`)
  // The next line holds the extras when the call spans lines.
  const lines = src.split("\n")
  const missing = []
  lines.forEach((l, i) => {
    if (!/\bopenDrawer\(opener, /.test(l) || /function openDrawer/.test(l)) return
    const span = lines.slice(i, i + 3).join("\n")
    if (!/\bjob: (j|openMark\.job)\b/.test(span)) missing.push(`line ${i + 1}`)
  })
  assert.deepEqual(missing, [])
})

test("N7: a week's median label never overlaps its marks: marks keep to the left of the label, or the label is left to the words", () => {
  for (const colW of [12, 40, 60, 100, 160]) {
    for (const n of [0, 1, 3, 5, 9]) {
      const L = S.feLayout(colW, n, { labelPx: 34 })
      assert.equal(L.xs.length, n)
      for (const x of L.xs) assert.ok(x - 5 >= 0 && x + 5 <= colW, `${colW}/${n}: mark inside`)
      if (L.label) for (const x of L.xs) assert.ok(x + 5 <= L.label.left, `${colW}/${n}: mark ${x} meets the label at ${L.label.left}`)
      if (L.label) assert.ok(L.label.left >= 0 && L.label.right <= colW)
    }
  }
  assert.ok(S.feLayout(160, 5, { labelPx: 34 }).label)
  assert.equal(S.feLayout(40, 5, { labelPx: 34 }).label, null)
})
