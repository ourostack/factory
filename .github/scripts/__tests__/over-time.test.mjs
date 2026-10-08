// Compare → Over time (S3 v1.1): hours by finish week per cause as small
// multiples, flow efficiency by finish date with each task as a dated point,
// and the finished tasks with no day listed with their reason, never placed
// on a guessed date. Every rule lives in site/src/steps.js overTime.
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
const opts = { jobs, taskRows, nameOf: (j) => `Task ${j.id}`, year: 2026 }

test("every week from first to last is listed; an empty week is a slot, never a zero bar; a week under 3 tasks is thin", () => {
  const ot = S.overTime(doc(), opts)
  assert.equal(ot.state, "ok")
  assert.deepEqual(ot.weeks.map((w) => [w.week, w.n, w.empty, w.thin]), [["2026-W39", 2, false, true], ["2026-W40", 0, true, false], ["2026-W41", 3, false, false]])
  assert.equal(ot.weeks[0].label, "21 Sep")
  assert.equal(ot.weeks[2].count, "3 tasks, 2 partial")
  // In every cause row, the empty week has no value at all.
  for (const r of ot.causes.rows) assert.equal(r.cells[1].empty, true)
})

test("the small multiples are the top 5 causes by hours plus other, on one linear scale from zero that is stated", () => {
  const ot = S.overTime(doc(), opts)
  const keys = ot.causes.rows.map((r) => r.key)
  assert.deepEqual(keys, ["waiting:no_session", "waiting:next_prompt", "waiting:other_task", "defects:all", "extra_processing:all", "other"])
  const other = ot.causes.rows[5]
  assert.equal(other.label, "Other (1 cause)")
  assert.equal(other.cells[2].ms, H / 10)
  // One scale for every row, from zero, at least the largest cell.
  assert.equal(ot.causes.scale.ticks[0], 0)
  assert.ok(ot.causes.scale.max_ms >= 10 * H)
  assert.match(ot.causes.scaleWords, /^0 to \d+ hours per week, the same linear scale in every row$/)
  // A partial cell names its bound in its label and its words.
  const np = ot.causes.rows[1].cells[2]
  assert.deepEqual([np.state, np.bound, np.short], ["partial", "lower", "≥5h"])
  assert.match(np.words, /^at least 5 hours/)
  // A measured zero is no bar and reads "none".
  const ns = ot.causes.rows[0].cells[2]
  assert.deepEqual([ns.ms, ns.short], [0, "none"])
  // The unlabeled working time is said, with its base, since it is in no row.
  assert.match(ot.causes.unlabeledWords, /not split by cause/)
})

test("flow efficiency by finish date: each dated task is a point with its finish day and its bound; no point is placed on a guessed date", () => {
  const ot = S.overTime(doc(), opts)
  assert.deepEqual(ot.points.map((p) => p.job), ["a", "b", "d", "e"])
  const b = ot.points.find((p) => p.job === "b")
  assert.equal(b.finish.words, "on or before 26 Sep")
  assert.equal(b.hollow, false)
  const d = ot.points.find((p) => p.job === "d")
  assert.deepEqual([d.hollow, d.feBound], [true, "lower"])
  assert.equal(d.finish.kind, "about")
  // A dated task whose flow efficiency is not measured is counted and named, not drawn.
  assert.deepEqual(ot.feOmitted.map((x) => x.job), ["c"])
  assert.match(ot.feOmitted[0].words, /could not be read|not/)
  // The axis spans the dated tasks' days.
  assert.deepEqual([ot.range.first, ot.range.last], ["2026-09-22", "2026-10-07"])
})

test("finished tasks with no finish day are listed below the chart with their reason; open tasks are not finished and are only counted", () => {
  const ot = S.overTime(doc(), opts)
  assert.deepEqual(ot.unplaced.map((x) => [x.job, x.name]), [["z", "Task z"]])
  assert.equal(ot.unplaced[0].words, `not dated yet: ${F.reasonText("no_finish_source")}`)
  assert.equal(ot.open, 1)
})

test("a week's flow-efficiency median carries n of N and is shown only over measured points", () => {
  const d = doc()
  d.weeks[2].flow_efficiency = { median: { state: "partial", value: 0.05, reasons: ["unmeasured_members"], bound: null, bound_reason: "median_of_subset" }, n: 1, N: 3, of: "x" }
  const ot = S.overTime(d, opts)
  assert.equal(ot.medians[0].words, "median 20%, 2 of 2 tasks measured")
  assert.equal(ot.medians[1].empty, true)
  assert.equal(ot.medians[2].words, "median 5%, 1 of 3 tasks measured")
})

test("without the by-week file nothing is drawn rather than a zero", () => {
  assert.equal(S.overTime(null, opts).state, "absent")
  assert.equal(S.overTime({ schema: "factory.site.by_week/1", weeks: [], tasks: [], unplaced: { n: 0, jobs: [] } }, opts).state, "empty")
})

test("Compare has the Over time section and its lede", () => {
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8")
  assert.match(html, /id="over-time"/)
  assert.match(html, /Each task is counted in the week it finished \(UTC\)/)
})

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
