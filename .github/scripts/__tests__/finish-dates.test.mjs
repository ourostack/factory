import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { anchorFromPulls, finishInputsOf, forRollupFile, isoWeek, prAnchor, resolveFinishDate, utcDay, validDay } from "../../../site/scripts/finish-date.mjs"
import { buildByWeek } from "../../../site/scripts/by-week.mjs"
import { DIRECTIONS, direct, sumDirection } from "../../../site/scripts/bounds.mjs"
import { checkByWeek, checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { finishOrder, firstAdded, firstAddedDays, labelDays } from "../../../site/scripts/finish-order.mjs"
import { enrichTasks, llmsText } from "../../../site/scripts/publish-files.mjs"
import { measured, partial, unavailable } from "../../../site/scripts/state.mjs"

const day = (d) => ({ ...measured(d), basis: "desk_transition" })
const DAY = 86400000
const T0 = Date.parse("2026-10-01T10:00:00Z")
const TODAY = "2026-10-08"

// ---------------------------------------------------------------- days

test("a UTC day is read from epoch milliseconds, a week is an ISO week starting on Monday", () => {
  assert.equal(utcDay(Date.parse("2026-10-07T23:59:59Z")), "2026-10-07")
  assert.equal(utcDay(Date.parse("2026-10-08T00:00:00Z")), "2026-10-08")
  assert.deepEqual(isoWeek("2026-10-07"), { week: "2026-W41", starts_on: "2026-10-05" })
  assert.deepEqual(isoWeek("2026-10-05"), { week: "2026-W41", starts_on: "2026-10-05" })
  assert.deepEqual(isoWeek("2026-10-11"), { week: "2026-W41", starts_on: "2026-10-05" })
  // The ISO year differs from the calendar year around New Year.
  assert.deepEqual(isoWeek("2026-01-01"), { week: "2026-W01", starts_on: "2025-12-29" })
  assert.deepEqual(isoWeek("2027-01-01"), { week: "2026-W53", starts_on: "2026-12-28" })
})

test("a finish day must be a real calendar day, no earlier than 2025-01-01 and not after today", () => {
  assert.equal(validDay("2026-10-07", TODAY), true)
  assert.equal(validDay("2026-10-08", TODAY), true)
  assert.equal(validDay("2026-10-09", TODAY), false)
  assert.equal(validDay("2024-12-31", TODAY), false)
  assert.equal(validDay("2026-02-30", TODAY), false)
  assert.equal(validDay("2026-10-7", TODAY), false)
  assert.equal(validDay("2026-10-07T10:00:00Z", TODAY), false)
  assert.equal(validDay(20261007, TODAY), false)
})

// ---------------------------------------------------------------- the clock anchor

test("the anchor is the median of GitHub's created_at minus the job-clock time, and outliers beyond 2 minutes are dropped", () => {
  const s = (anchor, at) => ({ at_ms: at, created_ms: anchor + at })
  const a = prAnchor([s(T0, 1000), s(T0 + 4000, 9000), s(T0 - 3000, 50000)])
  assert.equal(a.ms, T0)
  assert.equal(a.n, 3)
  assert.equal(a.dropped, 0)
  assert.equal(a.spread_ms, 7000)
  // A pull request the session only looked at created long before the task: dropped, not averaged in.
  const b = prAnchor([s(T0, 1000), s(T0 + 1000, 2000), s(T0 - 5 * DAY, 3000)])
  assert.equal(b.dropped, 1)
  assert.equal(b.n, 2)
  assert.ok(b.spread_ms <= 120000)
  assert.equal(prAnchor([]), null)
  assert.equal(prAnchor([{ at_ms: "x", created_ms: 1 }, { at_ms: 1, created_ms: NaN }]), null)
})

test("when Desk says which pull requests the session created, only those make the anchor", () => {
  const s = (anchor, at, created) => ({ at_ms: at, created_ms: anchor + at, created })
  const a = prAnchor([s(T0, 1000, true), s(T0 - 30000, 2000, false), s(T0 + 1000, 3000, true)])
  assert.equal(a.n, 2)
  assert.equal(a.spread_ms, 1000)
  // With none flagged true, a pull request Desk flags as not created is left out; one with no flag (a /3 file) counts.
  assert.equal(prAnchor([s(T0, 1000, null), s(T0, 2000, null)]).n, 2)
  assert.equal(prAnchor([s(T0, 1000, null), s(T0, 2000, false)]).n, 1)
  // Created flagged on only false ones: none was created in the session, so no anchor rests on them.
  assert.equal(prAnchor([s(T0, 1000, false), s(T0, 2000, false)]), null)
})

test("anchorFromPulls reads each timed pull request's created_at once and skips the ones GitHub cannot give", async () => {
  const calls = []
  const getCreated = async (repo, number) => {
    calls.push(`${repo}#${number}`)
    return number === 3 ? null : T0 + number * 1000
  }
  const prs = [
    { repo: "o/a", number: 1, at_ms: 0 },
    { repo: "o/a", number: 2, at_ms: 0 },
    { repo: "o/a", number: 3, at_ms: 5000 },
    { repo: "o/a", number: 4 },
    { repo: "bad repo", number: 5, at_ms: 1 },
  ]
  const a = await anchorFromPulls(prs, getCreated)
  assert.deepEqual(calls.sort(), ["o/a#1", "o/a#2", "o/a#3"])
  assert.equal(a.n, 2)
  assert.equal(await anchorFromPulls([], getCreated), null)
})

// ---------------------------------------------------------------- the ladder

const win = (end_ms, state = "measured", reasons = []) => ({ state, start_ms: 0, end_ms, reasons })
const base = { status: "done", today: TODAY }

test("rung 1: Desk's finish day, from the session's own transition, is measured", () => {
  const f = resolveFinishDate({ ...base, desk: { state: "measured", value: "2026-10-07", basis: "transition", reasons: [] }, labelsDay: "2026-10-08" })
  assert.deepEqual(f, { state: "measured", value: "2026-10-07", reasons: [], basis: "desk_transition" })
})

test("rung 1: a day from the card's last update is an upper bound, and a reopened task adds its reason", () => {
  const f = resolveFinishDate({ ...base, desk: { state: "partial", value: "2026-10-07", basis: "card_updated", bound: "upper", reasons: ["finish_from_card_update"] } })
  assert.deepEqual(f, { state: "partial", value: "2026-10-07", reasons: ["finish_from_card_update"], basis: "desk_card_updated", bound: "upper" })
  const g = resolveFinishDate({ ...base, desk: { state: "partial", value: "2026-10-07", basis: "card_updated", bound: "upper", reasons: ["finish_from_card_update", "reopened"] } })
  assert.equal(g.bound, "upper")
  assert.deepEqual(g.reasons, ["finish_from_card_update", "reopened"])
  // The store sets the direction itself when Desk's envelope has none.
  const h = resolveFinishDate({ ...base, desk: { state: "partial", value: "2026-10-07", basis: "card_updated", reasons: ["finish_from_card_update"] } })
  assert.equal(h.bound, "upper")
  // A reopened task whose latest finish is a transition has no direction.
  const k = resolveFinishDate({ ...base, desk: { state: "partial", value: "2026-10-07", basis: "transition", reasons: ["reopened"] } })
  assert.deepEqual([k.basis, k.bound], ["desk_transition", "unknown"])
})

test("rung 1 is skipped when Desk gives no usable day: unavailable, malformed, in the future or before 2025", () => {
  const labelsDay = "2026-10-06"
  for (const desk of [
    undefined,
    null,
    { state: "unavailable", reasons: ["not_recorded"] },
    { state: "measured", value: "2026-10-09", basis: "transition", reasons: [] },
    { state: "measured", value: "2024-12-31", basis: "transition", reasons: [] },
    { state: "measured", value: "not a day", basis: "transition", reasons: [] },
    { state: "measured", value: "2026-10-07", basis: "mystery", reasons: [] },
  ]) {
    const f = resolveFinishDate({ ...base, desk, labelsDay })
    assert.equal(f.basis, "labels_landed", JSON.stringify(desk))
  }
})

test("rung 2: the day is the anchor plus the end of the lead window, measured when the anchors span at most 2 minutes", () => {
  const anchor = { ms: T0, spread_ms: 6000, n: 2, dropped: 0 }
  const f = resolveFinishDate({ ...base, leadWindow: win(2 * DAY + 3600000), anchor })
  assert.deepEqual(f, { state: "measured", value: "2026-10-03", reasons: [], basis: "pr_anchor" })
  const g = resolveFinishDate({ ...base, leadWindow: win(2 * DAY), anchor: { ...anchor, spread_ms: 200000 } })
  assert.deepEqual(g, { state: "partial", value: "2026-10-03", reasons: ["anchor_spread"], basis: "pr_anchor", bound: "unknown" })
  // A window that is partial only because the card's dates are shorter than the work moves its start; its end is the last recorded work, so the day is on or before the true one.
  const h = resolveFinishDate({ ...base, leadWindow: win(2 * DAY, "partial", ["card_dates_shorter_than_work"]), anchor })
  assert.deepEqual(h, { state: "partial", value: "2026-10-03", reasons: ["finish_from_last_work"], basis: "pr_anchor", bound: "upper" })
  // Any other partial window reason may move the end: no direction.
  const k = resolveFinishDate({ ...base, leadWindow: win(2 * DAY, "partial", ["censored"]), anchor })
  assert.deepEqual([k.state, k.bound, k.reasons], ["partial", "unknown", ["lead_window_partial"]])
  const m = resolveFinishDate({ ...base, leadWindow: win(2 * DAY, "partial", ["card_dates_shorter_than_work", "log_truncated"]), anchor })
  assert.deepEqual([m.bound, m.reasons], ["unknown", ["lead_window_partial"]])
})

test("rung 2 is skipped without a lead window, and when it would put the finish after the labels landed", () => {
  const anchor = { ms: T0, spread_ms: 0, n: 1, dropped: 0 }
  assert.equal(resolveFinishDate({ ...base, anchor, labelsDay: "2026-10-04" }).basis, "labels_landed")
  assert.equal(resolveFinishDate({ ...base, anchor, leadWindow: { state: "unavailable", reasons: ["x"] }, labelsDay: "2026-10-04" }).basis, "labels_landed")
  // Labels are written when a task is done, so a finish after that day cannot be measured. The labels day is published with the conflict, not as "on or before".
  const conflict = resolveFinishDate({ ...base, anchor, leadWindow: win(6 * DAY), labelsDay: "2026-10-04" })
  assert.deepEqual(conflict, { state: "partial", value: "2026-10-04", reasons: ["anchor_after_labels"], basis: "labels_landed", bound: "unknown" })
  assert.equal(resolveFinishDate({ ...base, anchor, leadWindow: win(6 * DAY) }).basis, "pr_anchor")
  // A day after today is not a finish day.
  assert.equal(resolveFinishDate({ ...base, anchor: { ...anchor, ms: T0 + 30 * DAY }, leadWindow: win(DAY) }).state, "unavailable")
})

test("rung 3: the day the labels landed is an upper bound, 'finished on or before'", () => {
  const f = resolveFinishDate({ ...base, labelsDay: "2026-10-06" })
  assert.deepEqual(f, { state: "partial", value: "2026-10-06", reasons: ["finish_from_labels_landing"], basis: "labels_landed", bound: "upper" })
})

test("rung 4: no source is unavailable with its reason, and an open task is open", () => {
  assert.deepEqual(resolveFinishDate({ ...base }), { state: "unavailable", reasons: ["no_finish_source"] })
  assert.deepEqual(resolveFinishDate({ status: "processing", today: TODAY, labelsDay: "2026-10-06" }), { state: "unavailable", reasons: ["open_job"] })
  assert.deepEqual(resolveFinishDate({ status: "drafting", today: TODAY, desk: { state: "measured", value: "2026-10-07", basis: "transition", reasons: [] } }), { state: "unavailable", reasons: ["open_job"] })
  // A task whose status could not be read is not called finished (by_week leaves it out too).
  assert.deepEqual(resolveFinishDate({ status: "unavailable", today: TODAY, labelsDay: "2026-10-06" }), { state: "unavailable", reasons: ["status_unavailable"] })
  // A desk that withholds job timing gets no finish day, whatever the labels say.
  assert.deepEqual(resolveFinishDate({ ...base, desk: { state: "unavailable", reasons: ["job_offsets_withheld"] }, labelsDay: "2026-10-06" }), { state: "unavailable", reasons: ["job_offsets_withheld"] })
  // A cancelled task is finished too.
  assert.equal(resolveFinishDate({ status: "cancelled", today: TODAY, labelsDay: "2026-10-06" }).basis, "labels_landed")
})

test("every ladder result passes the numbers check", () => {
  const anchor = { ms: T0, spread_ms: 0, n: 1, dropped: 0 }
  const rows = [
    resolveFinishDate({ ...base, desk: { state: "measured", value: "2026-10-07", basis: "transition", reasons: [] } }),
    resolveFinishDate({ ...base, desk: { state: "partial", value: "2026-10-07", basis: "card_updated", reasons: ["finish_from_card_update", "reopened"] } }),
    resolveFinishDate({ ...base, leadWindow: win(DAY), anchor }),
    resolveFinishDate({ ...base, leadWindow: win(DAY), anchor: { ...anchor, spread_ms: 999999 } }),
    resolveFinishDate({ ...base, labelsDay: "2026-10-06" }),
    resolveFinishDate({ ...base }),
    resolveFinishDate({ status: "processing", today: TODAY }),
  ]
  assert.deepEqual(checkNumbers({ jobs: rows.map((finish_date, i) => ({ id: `j${i}`, finish_date })) }), [])
  // A partial finish day without a direction, or an unknown basis, is caught.
  assert.deepEqual(checkNumbers({ jobs: [{ id: "x", finish_date: { state: "partial", value: "2026-10-06", reasons: ["finish_from_labels_landing"], basis: "labels_landed" } }] }).map((v) => v.code), ["partial_without_direction"])
  assert.deepEqual(checkNumbers({ jobs: [{ id: "x", finish_date: { state: "measured", value: "2026-10-06", reasons: [], basis: "guess" } }] }).map((v) => v.code), ["bad_basis"])
  assert.deepEqual(checkNumbers({ jobs: [{ id: "x", finish_date: "2026-10-06" }] }).map((v) => v.code), ["number_expected"])
})

test("in the rollup and map files a direction the store cannot state is null with its reason, as Desk writes it", () => {
  const spread = resolveFinishDate({ ...base, leadWindow: win(DAY), anchor: { ms: T0, spread_ms: 999999, n: 2, dropped: 0 } })
  assert.deepEqual(forRollupFile(spread), { ...spread, bound: null, bound_reason: "anchor_spread" })
  const noWindow = resolveFinishDate({ ...base, leadWindow: win(DAY, "partial", ["censored"]), anchor: { ms: T0, spread_ms: 0, n: 2, dropped: 0 } })
  assert.equal(forRollupFile(noWindow).bound_reason, "lead_window_partial")
  const clash = resolveFinishDate({ ...base, anchor: { ms: T0, spread_ms: 0, n: 2, dropped: 0 }, leadWindow: win(6 * DAY), labelsDay: "2026-10-04" })
  assert.equal(forRollupFile(clash).bound_reason, "anchor_after_labels")
  const upper = resolveFinishDate({ ...base, labelsDay: "2026-10-06" })
  assert.deepEqual(forRollupFile(upper), upper)
  assert.deepEqual(forRollupFile(day("2026-10-07")), day("2026-10-07"))
  assert.equal(forRollupFile(null), null)
})

test("the direction of a finish day comes from its reasons, and every new measure has a row", () => {
  assert.equal(direct(partial("2026-10-06", ["finish_from_labels_landing"]), "finish_date").bound, "upper")
  assert.equal(direct(partial("2026-10-06", ["finish_from_card_update"]), "finish_date").bound, "upper")
  assert.equal(direct(partial("2026-10-06", ["anchor_spread"]), "finish_date").bound, "unknown")
  assert.equal(direct(partial("2026-10-06", ["finish_from_card_update", "anchor_spread"]), "finish_date").bound, "unknown")
  assert.equal(direct(partial("2026-10-06", ["lead_window_partial"]), "finish_date").bound, "unknown")
  assert.equal(direct(partial("2026-10-06", ["finish_from_last_work"]), "finish_date").bound, "upper")
  assert.equal(direct(partial("2026-10-06", ["anchor_after_labels"]), "finish_date").bound, "unknown")
  for (const m of ["finish_date", "week_sum", "week_median"]) assert.ok(Object.hasOwn(DIRECTIONS, m), m)
})

test("a sum of lower bounds is lower, mixed directions have none, and a missing member makes it a lower bound", () => {
  const lo = { state: "partial", value: 1, reasons: ["log_truncated"], bound: "lower" }
  const up = { state: "partial", value: 1, reasons: ["worker_shared"], bound: "upper" }
  assert.deepEqual(sumDirection([measured(1), lo, lo]), { bound: "lower" })
  assert.deepEqual(sumDirection([up, up]), { bound: "upper" })
  assert.deepEqual(sumDirection([lo, up]), { bound: null, bound_reason: "bound_reasons_conflict" })
  assert.deepEqual(sumDirection([measured(1), unavailable(["x"])]), { bound: "lower" })
  assert.deepEqual(sumDirection([up, unavailable(["x"])]), { bound: null, bound_reason: "bound_reasons_conflict" })
  // Desk's bound_not_moved means exact: it adds nothing to a sum, as a measured member adds nothing.
  const exact = { state: "partial", value: 1, reasons: ["card_dates_shorter_than_work"], bound: null, bound_reason: "bound_not_moved" }
  assert.deepEqual(sumDirection([lo, exact]), { bound: "lower" })
  assert.deepEqual(sumDirection([up, exact]), { bound: "upper" })
  assert.deepEqual(sumDirection([exact, exact, unavailable(["x"])]), { bound: "lower" })
  assert.deepEqual(sumDirection([exact, measured(1)]), { bound: null, bound_reason: "bound_not_moved" })
  assert.deepEqual(sumDirection([lo, exact, up]), { bound: null, bound_reason: "bound_reasons_conflict" })
  // A partial member whose file states no direction leaves the sum undecided, never lower by assumption.
  assert.deepEqual(sumDirection([{ state: "partial", value: 1, reasons: ["x"] }]), { bound: null, bound_reason: "bound_direction_undecided" })
  assert.deepEqual(sumDirection([{ state: "partial", value: 1, reasons: ["x"], bound: null, bound_reason: "bound_not_moved" }]), { bound: null, bound_reason: "bound_not_moved" })
})

// ---------------------------------------------------------------- Desk fields in a job report

test("a job report's finish inputs are read when Desk has them and are empty when it does not", () => {
  const withDesk = {
    timeline: {
      lead_window: win(5000),
      finished_on: { state: "measured", value: "2026-10-07", basis: "transition", reasons: [] },
      prs: [{ repo: "o/a", number: 4, at_ms: 100, created: true }, { repo: "o/a", number: 5 }, { repo: "../x", number: 6, at_ms: 1 }, null],
    },
  }
  const got = finishInputsOf(withDesk)
  assert.deepEqual(got.desk, withDesk.timeline.finished_on)
  assert.deepEqual(got.leadWindow, withDesk.timeline.lead_window)
  assert.deepEqual(got.prs, [{ repo: "o/a", number: 4, at_ms: 100, created: true }])
  assert.deepEqual(finishInputsOf({ timeline: {} }), { desk: null, leadWindow: null, prs: [] })
  assert.deepEqual(finishInputsOf(null), { desk: null, leadWindow: null, prs: [] })
})

// ---------------------------------------------------------------- order by date

test("tasks with a finish day are ordered by it, with ties broken by the labels rule; undated finished tasks follow and open tasks come last", () => {
  const lead = (v) => measured(v)
  const jobs = [
    { id: "late", lead_time_ms: lead(5), sessions: [{ session_id: "s1" }] },
    { id: "early", lead_time_ms: lead(5), sessions: [{ session_id: "s2" }] },
    { id: "tieA", lead_time_ms: lead(9), sessions: [{ session_id: "s3" }] },
    { id: "tieB", lead_time_ms: lead(1), sessions: [{ session_id: "s4" }] },
    { id: "undated", lead_time_ms: lead(5), sessions: [{ session_id: "s5" }] },
    { id: "open", lead_time_ms: lead(5), sessions: [{ session_id: "s6" }] },
    { id: "dateonly", lead_time_ms: lead(5), sessions: [{ session_id: "s7" }] },
  ]
  const labelAdded = new Map([["labels/late/a.json", 0], ["labels/early/a.json", 9], ["labels/tieA/a.json", 5], ["labels/tieB/a.json", 5], ["labels/undated/a.json", 2]])
  const factsAdded = new Map([["facts/f6.json", 1], ["facts/f7.json", 2]])
  const factsFileOf = new Map([["s6", "f6.json"], ["s7", "f7.json"]])
  const finishDates = new Map([
    ["late", partial("2026-10-07", ["finish_from_labels_landing"])],
    ["early", day("2026-10-01")],
    ["tieA", day("2026-10-04")],
    ["tieB", day("2026-10-04")],
    ["undated", unavailable(["no_finish_source"])],
    ["open", unavailable(["open_job"])],
    ["dateonly", day("2026-10-02")],
  ])
  const out = finishOrder(jobs, { labelAdded, factsAdded, factsFileOf, finishDates })
  const order = [...out].sort((a, b) => a[1].finish_order.value - b[1].finish_order.value).map(([id]) => id)
  assert.deepEqual(order, ["early", "dateonly", "tieB", "tieA", "late", "undated", "open"])
  // A task with labels keeps "labels" (the page counts those as labeled); a dated task with none is "date".
  assert.equal(out.get("early").finish_basis, "labels")
  assert.equal(out.get("dateonly").finish_basis, "date")
  assert.equal(out.get("undated").finish_basis, "labels")
  assert.equal(out.get("open").finish_basis, "facts")
  assert.deepEqual(out.get("tieA").finish_group, measured(3))
  // The order agrees with the dates.
  const dated = order.filter((id) => finishDates.get(id).value).map((id) => finishDates.get(id).value)
  assert.deepEqual(dated, [...dated].sort())
  // Without dates the order is the one it always was.
  const plain = finishOrder(jobs, { labelAdded, factsAdded, factsFileOf })
  assert.equal(plain.get("early").finish_basis, "labels")
  assert.equal(plain.get("dateonly").finish_basis, "facts")
  assert.deepEqual([...plain].sort((a, b) => a[1].finish_order.value - b[1].finish_order.value).map(([id]) => id), ["late", "undated", "tieB", "tieA", "early", "open", "dateonly"])
})

test("finished tasks with no date come before open tasks, whatever order their facts landed in", () => {
  const lead = (v) => measured(v)
  const jobs = ["dated", "openLabeled", "openFacts", "doneNoLabels", "doneLabeled"].map((id, i) => ({ id, lead_time_ms: lead(5), sessions: [{ session_id: `s${i}` }] }))
  const labelAdded = new Map([["labels/openLabeled/a.json", 1], ["labels/doneLabeled/a.json", 7]])
  // The open task's facts landed first; the finished unlabeled task's landed last.
  const factsAdded = new Map([["facts/f0.json", 3], ["facts/f2.json", 0], ["facts/f3.json", 9]])
  const factsFileOf = new Map([["s0", "f0.json"], ["s2", "f2.json"], ["s3", "f3.json"]])
  const finishDates = new Map([
    ["dated", day("2026-10-02")],
    ["openLabeled", unavailable(["open_job"])],
    ["openFacts", unavailable(["open_job"])],
    ["doneNoLabels", unavailable(["no_finish_source"])],
    ["doneLabeled", unavailable(["no_finish_source"])],
  ])
  const out = finishOrder(jobs, { labelAdded, factsAdded, factsFileOf, finishDates })
  const order = [...out].sort((a, b) => a[1].finish_order.value - b[1].finish_order.value).map(([id]) => id)
  assert.deepEqual(order, ["dated", "doneLabeled", "doneNoLabels", "openLabeled", "openFacts"])
})

test("the day each task's labels first landed comes from the commit that added them", () => {
  const dir = mkdtempSync(join(tmpdir(), "label-days-"))
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=x", "-c", "user.email=x@example.com", ...a], { encoding: "utf8" })
  git("init", "-q")
  const commit = (file, iso) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), "{}")
    git("add", ".")
    execFileSync("git", ["-C", dir, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", file], { env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } })
  }
  commit("labels/aaa/s1.json", "2026-10-05T23:30:00-07:00")
  commit("labels/bbb/s1.json", "2026-10-06T08:00:00Z")
  commit("labels/aaa/s2.json", "2026-10-07T08:00:00Z")
  const added = firstAdded(dir, "labels/")
  const days = firstAddedDays(dir, "labels/")
  assert.equal(days.get("labels/aaa/s1.json"), "2026-10-06")
  assert.equal(days.get("labels/aaa/s2.json"), "2026-10-07")
  const byJob = labelDays(added, days)
  assert.equal(byJob.get("aaa"), "2026-10-06")
  assert.equal(byJob.get("bbb"), "2026-10-06")
  assert.equal(firstAddedDays(join(dir, "missing"), "labels/").size, 0)
})

// ---------------------------------------------------------------- by week

const env = (value, extra = {}) => ({ class: "inferred", reasons: [], state: "measured", value, ...extra })
const part = (value, reasons, bound) => ({ class: "inferred", reasons, state: "partial", value, bound, ...(bound === null ? { bound_reason: "bound_reasons_conflict" } : {}) })
function stackRow(job, { lead = 1000, working = 600, idle = 400, value = 400, support = 200, next = 300, other = 100, status = "done" } = {}) {
  return {
    job,
    status: env(status),
    lead_time_ms: lead.state ? lead : env(lead),
    working_ms: working.state ? working : env(working),
    idle_ms: env(idle),
    idle: { next_prompt: env(next), other_task: env(other), api_retry: env(0) },
    working: {
      agents_working_unlabeled_ms: env(0),
      not_labeled_ms: env(0),
      class_ms: { value: value.state ? value : env(value), support: env(support) },
      waste_ms: { defects: env(100), motion: env(0) },
    },
  }
}
const taskRow = (job, fe) => ({ job, flow_efficiency: fe === undefined ? env(0.5) : fe })

test("each task's hours count in the week it finished, every week from first to last is listed, and a week with no task is n 0", () => {
  const stackup = { schema: "desk.factory.rollups/1", jobs: [stackRow("aaaa", { status: "done" }), stackRow("bbbb"), stackRow("cccc"), stackRow("dddd", { status: "processing" }), stackRow("eeee")] }
  const tasks = { jobs: [taskRow("aaaa", env(0.6)), taskRow("bbbb", env(0.4)), taskRow("cccc", env(0.5)), taskRow("eeee")] }
  const finishDates = new Map([
    ["aaaa", day("2026-09-28")],
    ["bbbb", day("2026-10-01")],
    ["cccc", resolveFinishDate({ status: "done", today: "2026-10-20", labelsDay: "2026-10-14" })],
    ["dddd", unavailable(["open_job"])],
    ["eeee", unavailable(["no_finish_source"])],
  ])
  const doc = buildByWeek({ stackup, tasks, finishDates })
  assert.equal(doc.schema, "factory.site.by_week/1")
  assert.equal(doc.basis, "by_finish_week")
  assert.deepEqual(doc.weeks.map((w) => [w.week, w.starts_on, w.n]), [["2026-W40", "2026-09-28", 2], ["2026-W41", "2026-10-05", 0], ["2026-W42", "2026-10-12", 1]])
  const w40 = doc.weeks[0]
  assert.deepEqual(w40.jobs, ["aaaa", "bbbb"])
  assert.deepEqual(w40.lead_ms, measured(2000))
  assert.equal(w40.working_ms.value, 1200)
  assert.equal(w40.idle_ms.value, 800)
  assert.equal(w40.by_class_ms.value.value, 800)
  assert.equal(w40.by_waste_ms.defects.value, 200)
  assert.equal(w40.idle_by_waited_on_ms.next_prompt.value, 600)
  assert.equal(w40.agents_working_unlabeled_ms.value, 0)
  assert.equal(w40.not_labeled_ms.value, 0)
  assert.equal(w40.n_partial, 0)
  assert.equal(w40.flow_efficiency.median.value, 0.5)
  assert.deepEqual([w40.flow_efficiency.n, w40.flow_efficiency.N, w40.flow_efficiency.of], [2, 2, "finished tasks with measured flow efficiency"])
  // An empty week is a slot, not a zero bar.
  assert.deepEqual(doc.weeks[1], { week: "2026-W41", starts_on: "2026-10-05", n: 0, n_partial: 0, jobs: [] })
  // A task placed by an upper-bound day is partial.
  assert.equal(doc.weeks[2].n_partial, 1)
  // The open task is not counted; the finished one without a day is unplaced.
  assert.deepEqual(doc.unplaced, { n: 1, jobs: ["eeee"], reasons: ["no_finish_source"] })
  assert.deepEqual(doc.tasks.map((t) => t.job), ["aaaa", "bbbb", "cccc"])
  assert.deepEqual(doc.tasks[2].finish_date, { state: "partial", value: "2026-10-14", reasons: ["finish_from_labels_landing"], basis: "labels_landed", bound: "upper" })
  assert.deepEqual(Object.keys(doc.tasks[0]).sort(), ["finish_date", "flow_efficiency", "job", "lead_time_ms", "working_ms"])
  assert.deepEqual(checkByWeek(doc), [])
})

test("a week's sums are partial with a direction when a member is partial, and the median of flow efficiency counts measured points only", () => {
  const stackup = {
    jobs: [
      stackRow("aaaa", { working: part(600, ["log_truncated"], "lower") }),
      stackRow("bbbb", { working: part(600, ["worker_shared"], "upper") }),
      stackRow("cccc", { working: part(600, ["log_truncated"], "lower") }),
      stackRow("dddd", { lead: { state: "unavailable", reasons: ["not_recorded"], class: "unavailable" } }),
    ],
  }
  const tasks = { jobs: [taskRow("aaaa", env(0.2)), taskRow("bbbb", part(0.4, ["log_truncated"], null)), taskRow("cccc", env(0.8)), taskRow("dddd", { state: "unavailable", reasons: ["not_recorded"] })] }
  const finishDates = new Map(["aaaa", "bbbb", "cccc", "dddd"].map((j) => [j, day("2026-10-06")]))
  const w = buildByWeek({ stackup, tasks, finishDates }).weeks[0]
  assert.equal(w.n, 4)
  assert.equal(w.n_partial, 4)
  // Lower and upper members together: no direction, with the reason.
  assert.equal(w.working_ms.state, "partial")
  assert.equal(w.working_ms.value, 2400)
  assert.equal(w.working_ms.bound, null)
  assert.equal(w.working_ms.bound_reason, "bound_reasons_conflict")
  assert.ok(w.working_ms.reasons.includes("log_truncated") && w.working_ms.reasons.includes("worker_shared"))
  // A member with no lead time makes the sum at least what it is.
  assert.deepEqual([w.lead_ms.state, w.lead_ms.bound, w.lead_ms.value], ["partial", "lower", 3000])
  assert.ok(w.lead_ms.reasons.includes("unmeasured_members"))
  // Medians use measured points only: 0.2 and 0.8, with n of N stated.
  assert.equal(w.flow_efficiency.median.value, 0.5)
  assert.equal(w.flow_efficiency.median.state, "partial")
  assert.deepEqual([w.flow_efficiency.n, w.flow_efficiency.N], [2, 4])
  assert.equal(w.flow_efficiency.median.bound, null)
  assert.equal(w.flow_efficiency.median.bound_reason, "median_of_subset")
  assert.deepEqual(checkByWeek(buildByWeek({ stackup, tasks, finishDates })), [])
})

test("a week mixing a lower bound with Desk's exact (bound_not_moved) members reads at least, not conflict", () => {
  const exact = { class: "inferred", reasons: ["card_dates_shorter_than_work"], state: "partial", value: 600, bound: null, bound_reason: "bound_not_moved" }
  const stackup = { jobs: [stackRow("aaaa", { working: part(600, ["log_truncated"], "lower") }), stackRow("bbbb", { working: exact }), stackRow("cccc", { working: exact })] }
  const finishDates = new Map(["aaaa", "bbbb", "cccc"].map((j) => [j, day("2026-10-06")]))
  const w = buildByWeek({ stackup, tasks: { jobs: [] }, finishDates }).weeks[0]
  assert.deepEqual([w.working_ms.state, w.working_ms.bound, "bound_reason" in w.working_ms], ["partial", "lower", false])
})

test("with no finished task, or without the stack-up file, there is no by-week file", () => {
  assert.equal(buildByWeek({ stackup: null, tasks: null, finishDates: new Map() }), null)
  assert.equal(buildByWeek({ stackup: { jobs: [stackRow("aaaa", { status: "processing" })] }, tasks: { jobs: [] }, finishDates: new Map() }), null)
  // Finished tasks that have no day are all unplaced: the file says so and lists no week.
  const doc = buildByWeek({ stackup: { jobs: [stackRow("aaaa")] }, tasks: { jobs: [] }, finishDates: new Map([["aaaa", unavailable(["no_finish_source"])]]) })
  assert.deepEqual(doc.weeks, [])
  assert.equal(doc.unplaced.n, 1)
})

test("the weeks and the unplaced tasks add up to the stack-up", () => {
  const ids = ["aaaa", "bbbb", "cccc", "dddd"]
  const stackup = { jobs: ids.map((id, i) => stackRow(id, { next: 100 * (i + 1), working: 500 + i })) }
  const finishDates = new Map([["aaaa", day("2026-09-20")], ["bbbb", day("2026-10-07")], ["cccc", day("2026-10-07")], ["dddd", unavailable(["no_finish_source"])]])
  const doc = buildByWeek({ stackup, tasks: { jobs: [] }, finishDates })
  const weekly = doc.weeks.filter((w) => w.n).reduce((a, w) => a + w.idle_by_waited_on_ms.next_prompt.value, 0)
  const unplaced = stackup.jobs.filter((r) => doc.unplaced.jobs.includes(r.job)).reduce((a, r) => a + r.idle.next_prompt.value, 0)
  const all = stackup.jobs.reduce((a, r) => a + r.idle.next_prompt.value, 0)
  assert.equal(weekly + unplaced, all)
})

test("checkByWeek refuses a figure with no state, a partial one with no direction, and an empty week that holds sums", () => {
  const good = buildByWeek({ stackup: { jobs: [stackRow("aaaa")] }, tasks: { jobs: [] }, finishDates: new Map([["aaaa", day("2026-10-06")]]) })
  assert.deepEqual(checkByWeek(good), [])
  const bare = structuredClone(good)
  bare.weeks[0].lead_ms = 5
  assert.ok(checkByWeek(bare).some((v) => v.code === "bare_number"))
  const nodir = structuredClone(good)
  nodir.weeks[0].lead_ms = { state: "partial", value: 5, reasons: ["log_truncated"] }
  assert.ok(checkByWeek(nodir).some((v) => v.code === "partial_without_direction"))
  const nullNoReason = structuredClone(good)
  nullNoReason.weeks[0].lead_ms = { state: "partial", value: 5, reasons: ["log_truncated"], bound: null }
  assert.ok(checkByWeek(nullNoReason).some((v) => v.code === "null_bound_without_reason"))
  const empty = structuredClone(good)
  empty.weeks.push({ week: "2026-W42", starts_on: "2026-10-12", n: 0, n_partial: 0, jobs: [], lead_ms: measured(0) })
  assert.ok(checkByWeek(empty).some((v) => v.code === "empty_week_with_figures"))
  const noText = structuredClone(good)
  noText.weeks[0].lead_ms = { state: "partial", value: 5, reasons: ["made_up_reason"], bound: "lower" }
  assert.ok(checkByWeek(noText).some((v) => v.code === "reason_without_text"))
  const gap = structuredClone(good)
  gap.weeks.push({ week: "2026-W44", starts_on: "2026-10-26", n: 0, n_partial: 0, jobs: [] })
  assert.ok(checkByWeek(gap).some((v) => v.code === "weeks_not_contiguous"))
  assert.ok(checkByWeek({ schema: "x" }).some((v) => v.code === "wrong_schema"))
  // A sum is a number; a string value passes only as a finish day, with a known basis and a real day shape.
  const str = structuredClone(good)
  str.weeks[0].lead_ms = measured("5")
  assert.ok(checkByWeek(str).some((v) => v.code === "bad_value"))
  const basis = structuredClone(good)
  basis.tasks.push({ job: "zzzz", finish_date: { state: "measured", value: "2026-10-06", reasons: [], basis: "guess" } })
  assert.ok(checkByWeek(basis).some((v) => v.code === "bad_basis"))
  const badDay = structuredClone(good)
  badDay.tasks.push({ job: "zzzz", finish_date: { state: "measured", value: "tomorrow", reasons: [], basis: "pr_anchor" } })
  assert.ok(checkByWeek(badDay).some((v) => v.code === "bad_finish_day"))
})

// ---------------------------------------------------------------- published files

test("the tasks rollup carries each task's finish date with the store's other fields", () => {
  const fd = partial("2026-10-06", ["finish_from_labels_landing"])
  const data = { jobs: [{ id: "j1", name: "n", finish_order: measured(1), finish_group: measured(1), finish_basis: "date", finish_date: { ...fd, basis: "labels_landed", bound: "upper" } }, { id: "j2", finish_date: { state: "partial", value: "2026-10-06", reasons: ["anchor_spread"], basis: "pr_anchor", bound: "unknown" } }] }
  const out = enrichTasks({ jobs: [{ job: "j1" }, { job: "j2" }, { job: "j3" }] }, data)
  assert.ok(out.store_fields.includes("finish_date"))
  assert.deepEqual(out.jobs[0].finish_date.bound, "upper")
  assert.deepEqual([out.jobs[1].finish_date.bound, out.jobs[1].finish_date.bound_reason], [null, "anchor_spread"])
  assert.equal(out.jobs[2].finish_date, null)
  assert.equal(out.jobs[0].finish_basis, "date")
})

test("llms.txt lists by_week.json, drops 'no date', and describes the finish date and its ladder", () => {
  const template = readFileSync(new URL("../../../site/src/llms-template.txt", import.meta.url), "utf8")
  const text = llmsText(template, [{ path: "rollups/by_week.json", bytes: 2000 }, { path: "rollups/tasks.json", bytes: 2000 }], {})
  assert.doesNotMatch(text, /no person, no machine and no date/)
  assert.match(text, /rollups\/by_week\.json \(.*\): .*finish week/)
  assert.match(text, /finish_date/)
  for (const basis of ["desk_transition", "desk_card_updated", "pr_anchor", "labels_landed"]) assert.match(text, new RegExp(basis))
  assert.match(text, /UTC/)
  assert.match(text, /by_finish_week/)
  assert.match(text, /on or before/)
  // The null-with-reason convention covers every file under rollups/ and map/, Desk's and the store's.
  assert.match(text, /every file under `rollups\/` and `map\/`, Desk's and the store's/)
  for (const code of ["lead_window_partial", "finish_from_last_work", "anchor_after_labels"]) assert.match(text, new RegExp(code))
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8")
  assert.doesNotMatch(html, /No who, no when/)
  assert.doesNotMatch(html, /that time is never published/)
})

// ---------------------------------------------------------------- the build

const SCRIPT = new URL("../../../site/scripts/build-data.mjs", import.meta.url).pathname
const write = (path, obj) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(obj))
}
const facts = (id, jobs) => ({
  schema: "desk.factory.published/1",
  session: { host: "claude-code", id, duration_ms: 600000, ended: true, entrypoint: "cli", host_version: "1" },
  models: [],
  agents: [],
  intervals: [{ kind: "turn", start_ms: 0, end_ms: 400000 }],
  counts: { tool_calls: { shell: 30 }, tool_failures: { shell: 3 }, api_retries: 0, compactions: 0, tool_retries: 0 },
  refs: { prs: [] },
  jobs: jobs || [],
  unavailable: [],
})
const jobReport = (id, status, timeline) => ({
  job: id,
  formulas: {
    status: { class: "declared", value: status },
    lead_time_ms: { class: "declared", value: 100000 },
    active_time_ms: { class: "measured", value: 500 },
    flow_efficiency: { class: "inferred", value: 0.5 },
    queue_before_start_ms: { class: "measured", value: 0 },
    waits: { human_wait_ms: { class: "measured", value: 100 }, api_retry_ms: { class: "measured", value: 0 } },
    references: { class: "measured", value: { public_prs: 0 } },
    sessions: { class: "measured", value: { bound: 1 } },
  },
  ...(timeline ? { timeline } : {}),
})

function storeFixture({ withDesk }) {
  const dir = mkdtempSync(join(tmpdir(), "finish-build-"))
  const reports = join(dir, "reports")
  const main = join(dir, "main")
  write(join(reports, "rollups/coverage.json"), { sessions_with_facts: 3, jobs: 3, jobs_open: 1, labels: { files: 0 } })
  write(join(reports, "rollups/measures.json"), { groupings: {} })
  write(join(reports, "rollups/muda.json"), { groupings: { overall: { all: { jobs: 3, jobs_labeled: 0, wastes: [] } } }, wastes: ["defects"] })
  const desk = withDesk ? { finished_on: { state: "measured", value: "2026-10-02", basis: "transition", reasons: [] } } : {}
  write(join(reports, "jobs/aaaaaaaa.json"), jobReport("aaaaaaaa", "done", { lead_window: win(100000), ...desk, prs: [], intervals: [{ session_id: "s1", host: "claude-code" }] }))
  write(join(reports, "jobs/bbbbbbbb.json"), jobReport("bbbbbbbb", "done", { intervals: [{ session_id: "s2", host: "claude-code" }] }))
  write(join(reports, "jobs/cccccccc.json"), jobReport("cccccccc", "processing", { lead_window: win(1), prs: [], intervals: [{ session_id: "s3", host: "claude-code" }] }))
  write(join(reports, "rollups/stackup.json"), {
    schema: "desk.factory.rollups/1",
    jobs: [stackRow("aaaaaaaa"), stackRow("bbbbbbbb"), stackRow("cccccccc", { status: "processing" })],
  })
  write(join(reports, "rollups/tasks.json"), { jobs: [taskRow("aaaaaaaa"), taskRow("bbbbbbbb"), taskRow("cccccccc")] })
  write(join(main, "facts/claude-code-s1.json"), facts("s1", [{ job: "aaaaaaaa" }]))
  write(join(main, "facts/claude-code-s2.json"), facts("s2", [{ job: "bbbbbbbb" }]))
  write(join(main, "facts/claude-code-s3.json"), facts("s3", [{ job: "cccccccc" }]))
  execFileSync("git", ["init", "-q", main])
  const commit = (msg, iso) => {
    execFileSync("git", ["-C", main, "add", "."])
    execFileSync("git", ["-C", main, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", msg], { env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } })
  }
  commit("intake", "2026-10-01T09:00:00Z")
  write(join(main, "labels/aaaaaaaa/s1.json"), { job: "aaaaaaaa" })
  commit("labels a", "2026-10-03T09:00:00Z")
  write(join(main, "labels/bbbbbbbb/s2.json"), { job: "bbbbbbbb" })
  commit("labels b", "2026-10-05T09:00:00Z")
  return { dir, reports, main, out: join(dir, "dist/data.json") }
}

function build(fx) {
  return spawnSync("node", [SCRIPT, "--reports", fx.reports, "--main", fx.main, "--out", fx.out], {
    env: { ...process.env, FACTORY_SITE_OFFLINE: "1", GITHUB_TOKEN: "" },
    encoding: "utf8",
  })
}

test("the build with Desk's finish day absent dates each task from the day its labels landed, as an upper bound", () => {
  const fx = storeFixture({ withDesk: false })
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const by = Object.fromEntries(data.jobs.map((j) => [j.id, j]))
  assert.deepEqual(by.aaaaaaaa.finish_date, { state: "partial", value: "2026-10-03", reasons: ["finish_from_labels_landing"], basis: "labels_landed", bound: "upper" })
  assert.equal(by.bbbbbbbb.finish_date.value, "2026-10-05")
  assert.deepEqual(by.cccccccc.finish_date, { state: "unavailable", reasons: ["open_job"] })
  assert.equal(by.aaaaaaaa.finish_basis, "labels")
  assert.ok(by.aaaaaaaa.finish_order.value < by.bbbbbbbb.finish_order.value)
  assert.ok(by.bbbbbbbb.finish_order.value < by.cccccccc.finish_order.value)
  assert.deepEqual(checkNumbers(data), [])
  const weeks = JSON.parse(readFileSync(join(dirname(fx.out), "rollups/by_week.json"), "utf8"))
  assert.equal(weeks.schema, "factory.site.by_week/1")
  assert.deepEqual(weeks.weeks.map((w) => [w.week, w.n]), [["2026-W40", 1], ["2026-W41", 1]])
  assert.equal(weeks.unplaced.n, 0)
  assert.deepEqual(checkByWeek(weeks), [])
})

test("the build with Desk's finish day present uses it first, as measured", () => {
  const fx = storeFixture({ withDesk: true })
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const by = Object.fromEntries(data.jobs.map((j) => [j.id, j]))
  assert.deepEqual(by.aaaaaaaa.finish_date, { state: "measured", value: "2026-10-02", reasons: [], basis: "desk_transition" })
  assert.equal(by.bbbbbbbb.finish_date.basis, "labels_landed")
  assert.deepEqual(checkNumbers(data), [])
  const weeks = JSON.parse(readFileSync(join(dirname(fx.out), "rollups/by_week.json"), "utf8"))
  assert.deepEqual(weeks.weeks.map((w) => [w.week, w.n, w.n_partial]), [["2026-W40", 1, 0], ["2026-W41", 1, 1]])
})

test("the build with no stack-up file writes no by-week file and still dates the tasks", () => {
  const fx = storeFixture({ withDesk: false })
  execFileSync("rm", [join(fx.reports, "rollups/stackup.json")])
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(join(dirname(fx.out), "rollups/by_week.json")), false)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(data.jobs.find((j) => j.id === "aaaaaaaa").finish_date.value, "2026-10-03")
})
