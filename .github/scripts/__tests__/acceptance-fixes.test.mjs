// The first v1.1 acceptance walk's findings (A1): a finish day that is no
// bound (B1), the landing task (B2), one "Finished" list (I1), the
// operator's own time on a task page (I2), llms.txt's landing rule (I3),
// the glossary (I4), the Store's sign-off words (I5), partial notes with no
// direction (I6), the unmeasured part of a week (I7) and the minor ones
// (M1-M10).
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const W = require("../../../site/src/walk.js")
const S = require("../../../site/src/steps.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

const H = 3600000
const measured = (value) => ({ state: "measured", value, reasons: [] })
const partial = (value, reasons, bound) => ({ state: "partial", value, reasons, bound })
const unavailable = (reasons) => ({ state: "unavailable", reasons })
const day = (value, basis = "desk_card_updated", bound = "upper", reasons = ["finish_from_card_update"]) =>
  bound === "measured" ? { state: "measured", value, basis, reasons: [] } : { state: "partial", value, basis, bound, reasons }

// A data.json job.
function job(id, status, order, opts = {}) {
  return {
    id,
    status,
    finish_order: order === null ? unavailable(["no_facts"]) : measured(order),
    finish_basis: opts.basis || (opts.labeled ? "labels" : status === "done" || status === "cancelled" ? "date" : "facts"),
    finish_date: opts.date === undefined ? unavailable([status === "done" || status === "cancelled" ? "no_finish_source" : "open_job"]) : opts.date,
    lead_time_ms: opts.lead === undefined ? measured(10 * H) : opts.lead,
    ...(opts.name ? { name: opts.name } : {}),
  }
}

// ------------------------------------------------------------------ B1

test("B1: a finish day whose recorded finish is before the task's last work is no bound, and never reads on or before", () => {
  assert.equal(F.reasonText("finish_before_last_work"), "the recorded finish time is earlier than the task's last work, so it is not a bound")
  const fd = { state: "partial", value: "2026-09-29", basis: "desk_card_updated", bound: null, reasons: ["finish_before_last_work"] }
  const f = F.finishDay(fd, { year: 2026 })
  assert.equal(f.kind, "about")
  assert.doesNotMatch(f.words, /on or before|on or after/)
  assert.match(f.words, /29 Sep/)
  assert.equal(f.short, "~29 Sep")
  // The reason is said with the day, wherever the day is a sentence.
  assert.match(F.finishWords(job("x", "done", 1, { date: fd }), [job("x", "done", 1, { date: fd })]), /not a bound/)
})

// ------------------------------------------------------------------ B2

test("B2: #/ lands on the latest-finished task whose lead time is at least an hour, labeled or not; a same-day tie goes to the longer lead time", () => {
  const jobs = [
    job("old", "done", 1, { labeled: true, date: day("2026-09-29"), lead: partial(54 * H, ["card_dates_shorter_than_work"], "lower") }),
    job("tiny", "done", 2, { labeled: true, date: day("2026-10-06"), lead: partial(37000, ["card_dates_shorter_than_work"], "lower") }),
    job("short7", "done", 3, { date: day("2026-10-07"), lead: measured(7 * H) }),
    job("long7", "done", 4, { date: day("2026-10-07"), lead: measured(126 * H) }),
    job("open", "processing", 5, { lead: measured(300 * H) }),
  ]
  assert.equal(F.defaultTask(jobs).id, "long7")
  // The order inside a day is not known, so the later position alone never wins.
  assert.equal(F.defaultTask([jobs[3], jobs[2]].map((j, i) => ({ ...j, finish_order: measured(i + 1) }))).id, "long7")
  // A task under an hour never lands while a longer finished one exists.
  assert.equal(F.defaultTask(jobs.filter((j) => !j.id.endsWith("7"))).id, "old")
  // A cancelled task counts as finished.
  assert.equal(F.defaultTask([jobs[0], job("cx", "cancelled", 9, { date: day("2026-10-08"), lead: measured(2 * H) })]).id, "cx")
  // An "at most" lead time is not known to be an hour.
  assert.equal(F.defaultTask([jobs[0], job("um", "done", 9, { date: day("2026-10-08"), lead: partial(2 * H, ["x"], "upper") })]).id, "old")
  // Fallbacks: the latest dated finished task, then any finished task, then the latest position.
  assert.equal(F.defaultTask([jobs[1], jobs[4]]).id, "tiny")
  assert.equal(F.defaultTask([job("u", "done", 2), jobs[4]]).id, "u")
  assert.equal(F.defaultTask([jobs[4], job("d", "drafting", 1)]).id, "open")
  assert.equal(F.defaultTask([]), null)
})

test("B2: the task header places a task among the dated tasks by date, never among labeling batches", () => {
  const jobs = [
    job("a", "done", 1, { labeled: true, date: day("2026-09-26") }),
    job("b", "done", 2, { date: day("2026-10-06", "desk_transition", "measured") }),
    job("c", "done", 3, { labeled: true, date: day("2026-10-06") }),
    job("u", "done", 4, { labeled: true }),
    job("o", "processing", 5),
    job("n", "drafting", null),
  ]
  const by = Object.fromEntries(jobs.map((j) => [j.id, j]))
  assert.equal(F.finishWords(by.b, jobs, { year: 2026 }), "It finished on 6 Oct (UTC), the 2nd of 3 dated tasks. It is not labeled for waste yet.")
  assert.equal(F.finishWords(by.c, jobs, { year: 2026 }), "It finished on or before 6 Oct (UTC), the 3rd of 3 dated tasks.")
  assert.equal(F.finishWords(by.u, jobs, { year: 2026 }), "It is finished, but no source gives its finish day (no record gives the day this task finished), so it is listed after the 3 dated tasks.")
  assert.match(F.finishWords(by.o, jobs), /still open/)
  assert.match(F.finishWords(by.n, jobs), /no place in finish order/)
  for (const j of jobs) assert.doesNotMatch(F.finishWords(j, jobs), /batch|labeled tasks/)
  // The finish cell reads the same order: a position for every finished task.
  assert.equal(F.finishCell(by.b), "2nd")
  assert.equal(F.finishCell(by.o), "open")
  assert.equal(F.finishCell(by.n), "no session")
})

// ------------------------------------------------------------------ I1

test("I1: the picker holds one Finished list, every done or cancelled task, the latest first, with a not-labeled-yet badge", () => {
  const jobs = [
    job("lab", "done", 1, { labeled: true, date: day("2026-09-29") }),
    job("new", "done", 3, { date: day("2026-10-07") }),
    job("cx", "cancelled", 2, { date: day("2026-10-06") }),
    job("nodate", "done", 4),
    job("open", "processing", 5),
  ]
  const rows = S.sortPicker(W.pickerRows(jobs, [], (j) => j.id, ""), (id) => F.finishDay(jobs.find((j) => j.id === id).finish_date), "newest")
  assert.deepEqual(rows.map((r) => [r.id, r.group]), [["new", "finished"], ["cx", "finished"], ["lab", "finished"], ["nodate", "finished"], ["open", "open"]])
  assert.deepEqual(rows.filter((r) => r.unlabeled).map((r) => r.id), ["new", "cx", "nodate"])
  const app = read("site/src/app.js")
  assert.match(app, /"not labeled yet"/)
  assert.match(app, /"Still open, the latest to start first"/)
  assert.doesNotMatch(app, /Still open or not labeled yet/)
})

test("I1: Compare orders the same finished tasks as Over time, by finish date, and says why an undated one sits last", () => {
  const jobs = [
    job("lab", "done", 1, { labeled: true, date: day("2026-09-29") }),
    job("new", "done", 3, { date: day("2026-10-07") }),
    job("cx", "cancelled", 2, { date: day("2026-10-06") }),
    job("nodate", "done", 4),
    job("open", "processing", 5),
  ]
  const order = S.walkOrder(jobs)
  assert.deepEqual(order.map((x) => [x.j.id, x.group]), [["lab", "finished"], ["cx", "finished"], ["new", "finished"], ["nodate", "finished"], ["open", "open"]])
  const rows = jobs.map((j) => ({ job: j.id, status: measured(j.status), lead_time_ms: measured(10 * H), working_ms: unavailable(["source_unreadable"]) }))
  const bars = S.stackBars(jobs, [], rows, { nameOf: (j) => j.id })
  const lede = S.compareLede(bars, rows, F.reasonText)
  assert.doesNotMatch(lede.text, /store's sense|labeled for waste yet\) follow/)
  assert.match(lede.text, /1 task still open follows on the right/)
  assert.match(lede.text, /1 finished task has no finish day \(no record gives the day this task finished\), so it sits after the dated ones/)
})

// ------------------------------------------------------------------ I6

test("I6: a figure with no direction never names a bound; it says some reasons pull it up and others down", () => {
  // The Store's operator attention per delivered task, as data.json gives it.
  const d = F.describe({ state: "partial", value: 2575396, reasons: ["unmeasured_members", "host_records_partly", "turns_not_recorded"], bound: "unknown" }, "duration")
  assert.doesNotMatch(d.reason, /lower bound|upper bound/)
  assert.match(d.reason, /some of these reasons pull the figure up and others down, so which way the true figure lies is not known/)
  assert.match(d.reason, /the host records only part of this/)
  // Desk's null bound says its own reason, which says the pull both ways.
  const n = F.describe({ state: "partial", value: 3, reasons: ["host_records_partly", "censored"], bound: null, bound_reason: "bound_reasons_conflict" }, "count")
  assert.doesNotMatch(n.reason, /lower bound|upper bound/)
  assert.match(n.reason, /^the host records only part of this; the job is still open; direction not known, because its reasons pull it both ways, so the true figure may be higher or lower$/)
  // A null bound with no reason of Desk's says the pull itself.
  assert.match(F.describe({ state: "partial", value: 3, reasons: ["host_records_partly", "censored"], bound: null }, "count").reason, /; some of these reasons pull the figure up and others down/)
  // "no data" never names a bound.
  const u = F.describe({ state: "unavailable", reasons: ["field_absent", "host_records_partly", "no_accepted_outcomes", "turns_not_recorded"] }, "count")
  assert.doesNotMatch(u.reason, /bound/)
  assert.doesNotMatch(F.toText({ state: "unavailable", reasons: ["censored", "returns_not_fully_recorded"] }, "count"), /bound/)
  // A figure with a direction keeps its words.
  assert.match(F.describe({ state: "partial", value: 3, reasons: ["host_records_partly"], bound: "lower" }, "count").reason, /so the figure is a lower bound/)
  // A finish day with no bound never says "on or before" in its reasons either.
  const fd = { state: "partial", value: "2026-10-02", basis: "desk_card_updated", bound: null, reasons: ["finish_from_card_update", "finish_before_last_work"] }
  const words = F.finishWords({ id: "x", status: "done", finish_order: measured(1), finish_basis: "labels", finish_date: fd }, [], { year: 2026 })
  assert.doesNotMatch(words, /on or before|on or after/)
  assert.match(words, /not a bound/)
})

// ------------------------------------------------------------------ I2

test("I2: a task page states the operator's own time: the Store's attention estimate for this one task, and the prompts it rests on", () => {
  const turns = [
    ...Array(7).fill({ prompt_class: "s", output_class: "l" }),
    ...Array(4).fill({ prompt_class: "m", output_class: "m" }),
    { prompt_class: "xs", output_class: "xl" },
    { prompt_class: "xs", output_class: "none" },
  ]
  // 825084c9 as data.json gives it: 2,209,789 ms over 13 turns, measured.
  const o = W.operatorTime({ attention_ms: measured(2209789), human_turns: measured(13) }, turns, { state: "measured", reasons: [] }, F.reasonText)
  assert.equal(o.state, "ok")
  assert.equal(o.attention, "37 minutes")
  assert.equal(o.text, "The operator sent 13 prompts (7 short, 4 medium and 2 very short) and read the agent's output before 12 of them (7 long, 4 medium and 1 very long). The store's estimate of the operator's attention on this task, their reading and answering time, is 37 minutes; it is the same estimate the Store page averages over delivered tasks.")
  // Waiting is never called attention.
  assert.doesNotMatch(o.text, /wait/i)
  // A partial estimate keeps its bound and reason; one with no direction names no bound.
  const p = W.operatorTime({ attention_ms: partial(769527, ["host_records_partly"], "lower"), human_turns: partial(3, ["host_records_partly"], "lower") }, [], { state: "partial", reasons: ["host_records_partly"] }, F.reasonText)
  assert.equal(p.attention, "at least 13 minutes")
  assert.match(p.text, /^The operator sent at least 3 prompts\. The store's estimate of the operator's attention on this task, their reading and answering time, is at least 13 minutes \(partial: the host records only part of this, so the figure is a lower bound\);/)
  // No estimate: says so, with the reason, and never a zero.
  const u = W.operatorTime({ attention_ms: unavailable(["not_recorded"]), human_turns: unavailable(["not_recorded"]) }, [], null, F.reasonText)
  assert.equal(u.state, "none")
  assert.equal(u.attention, null)
  assert.equal(u.text, "The store has no estimate of the operator's attention on this task, because the store has no record of this; the prompts the operator sent are not recorded either.")
  // The page shows it in the lede and in the map's summary box.
  const app = read("site/src/app.js")
  assert.match(app, /W\.operatorTime\(/)
  assert.match(app, /line\("sum-attention", "Operator attention"/)
})

// ------------------------------------------------------------------ I4

test("I4: the glossary defines the v1.1 words: finish day (UTC) and its marks, Handoffs, the prompt and pull request markers, operator attention and every why-the-agent-stopped class", () => {
  const html = read("site/src/index.html")
  const terms = [...html.matchAll(/<dt id="g-([a-z0-9-]+)">/g)].map((m) => m[1])
  for (const t of ["finish-day", "handoffs", "prompt-marker", "pull-request-markers", "operator-attention", "why-the-agent-stopped", "stopped-short", "human-gate", "asked-a-question", "error-or-limit", "interrupted", "why-not-known"]) {
    assert.ok(terms.includes(t), t)
    assert.ok(F.glossaryRoute(t), t)
  }
  const dd = (t) => html.slice(html.indexOf(`<dt id="g-${t}">`), html.indexOf("</dd>", html.indexOf(`<dt id="g-${t}">`)))
  // "(UTC)" is stated once, with the marks.
  assert.match(dd("finish-day"), /UTC/)
  assert.match(dd("finish-day"), /on or before/)
  assert.match(dd("finish-day"), /on or after/)
  assert.match(dd("finish-day"), /direction not known/)
  assert.match(dd("human-gate"), /decision.*approval.*acceptance/)
  assert.match(dd("why-not-known"), /not labeled yet/)
  // Attention is not waiting.
  assert.match(dd("operator-attention"), /not the time the task waited/)
})

// ------------------------------------------------------------------ I5

test("I5: the Store's sign-off section agrees with itself, and says what its jobs are beside the site's tasks", async () => {
  const { outcomesSummary } = await import("../../../site/scripts/outcomes.mjs")
  // Today's rollups/outcomes.json, trimmed to what the section reads.
  const file = {
    signoff: { recorded: true, accepted: 0, delivered_unsigned: 5, jobs: 41, jobs_without_work_record: 11, no_record: 1, not_delivered: 20, not_recorded: 16, refused: 0, reopened: 0, refusal_reasons: {}, waits: { signed: {}, unsigned: { lt_1d: 5 } } },
    first_pass_yield: { N: 0, awaiting_signoff: 0, changed_ask_only: 0, excluded: [{ jobs: 41, reason: "history_not_recorded" }, { jobs: 1, reason: "not_recorded" }], n: 0, passed: 0, reasons: ["no_delivered_jobs"], returned: 0, state: "unavailable" },
  }
  const o = outcomesSummary(file)
  assert.deepEqual(o.signoff.jobs_without_work_record, measured(11))
  assert.deepEqual(o.first_pass_yield.excluded, { history_not_recorded: 41, not_recorded: 1 })
  // Desk's own words for the yield's reason: no claim that nothing was delivered.
  assert.equal(F.reasonText("no_delivered_jobs"), "no delivered job has a first-pass result yet")
  const w = F.signoffWords(o, 31)
  assert.equal(w.scope, "These figures count 42 jobs: the 31 tasks the other pages show, and 11 task cards that have a sign-off record but no published session, so no time to show.")
  assert.equal(w.yieldNote, "Every delivered job is out of scope for first-pass yield, including the 5 awaiting an answer: 41 because the job's history was not recorded from the start (an adopted card), 1 because the store has no record of this.")
  // When the counts do not add up to the site's tasks, no claim is made about them.
  assert.equal(F.signoffWords(o, 30).scope, "These figures count 42 jobs, each a task card with a sign-off record or a published session.")
  const app = read("site/src/app.js")
  assert.match(app, /F\.signoffWords\(o, /)
})
