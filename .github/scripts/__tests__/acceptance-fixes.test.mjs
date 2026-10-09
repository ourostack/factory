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
  assert.equal(F.finishWords(by.b, jobs, { year: 2026 }), "It finished on 6 Oct (UTC), the 2nd of 3 dated tasks in the store's order; 2 tasks share this day. It is not labeled for waste yet.")
  assert.equal(F.finishWords(by.c, jobs, { year: 2026 }), "It finished on or before 6 Oct (UTC), the 3rd of 3 dated tasks in the store's order; 2 tasks share this day.")
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
  assert.equal(o.text, "The operator sent 13 prompts (7 short, 4 medium and 2 very short) and read the agent's output before 12 of them (7 long, 4 medium and 1 very long). Desk's estimate of the operator's attention on this task, their reading and answering time, is 37 minutes; it is the same estimate the Store page averages over delivered tasks.")
  // Waiting is never called attention.
  assert.doesNotMatch(o.text, /wait/i)
  // A partial estimate keeps its bound and reason; one with no direction names no bound.
  const p = W.operatorTime({ attention_ms: partial(769527, ["host_records_partly"], "lower"), human_turns: partial(3, ["host_records_partly"], "lower") }, [], { state: "partial", reasons: ["host_records_partly"] }, F.reasonText)
  assert.equal(p.attention, "at least 13 minutes")
  assert.match(p.text, /^The operator sent at least 3 prompts\. Desk's estimate of the operator's attention on this task, their reading and answering time, is at least 13 minutes \(partial: the host records only part of this, so the figure is a lower bound\);/)
  // No estimate: says so, with the reason, and never a zero.
  const u = W.operatorTime({ attention_ms: unavailable(["not_recorded"]), human_turns: unavailable(["not_recorded"]) }, [], null, F.reasonText)
  assert.equal(u.state, "none")
  assert.equal(u.attention, null)
  assert.equal(u.text, "Desk has no estimate of the operator's attention on this task, because the store has no record of this; the prompts the operator sent are not recorded either.")
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
  assert.equal(w.yieldNote, "All 21 delivered jobs are out of scope for first-pass yield (the 5 awaiting an answer and the 16 delivered before sign-off was recorded). Across all 42 jobs, 41 are out of scope because the job's history was not recorded from the start (an adopted card), and 1 because the store has no record of this.")
  // When the counts do not add up to the site's tasks, no claim is made about them.
  assert.equal(F.signoffWords(o, 30).scope, "These figures count 42 jobs, each a task card with a sign-off record or a published session.")
  const app = read("site/src/app.js")
  assert.match(app, /F\.signoffWords\(o, /)
})

// ------------------------------------------------------------------ I7

const MEAS = (value) => ({ class: "inferred", state: "measured", value, reasons: [] })
const UNREAD = { class: "inferred", state: "unavailable", reasons: ["source_unreadable"] }
function stack(job, split) {
  return {
    job,
    status: MEAS("done"),
    lead_time_ms: MEAS(10 * H),
    working_ms: split ? MEAS(2 * H) : UNREAD,
    idle_ms: split ? MEAS(8 * H) : UNREAD,
    idle: { next_prompt: split ? MEAS(8 * H) : UNREAD, no_session: split ? MEAS(0) : UNREAD },
    working: { agents_working_unlabeled_ms: MEAS(0), not_labeled_ms: split ? MEAS(2 * H) : UNREAD, class_ms: {}, waste_ms: {} },
  }
}

test("I7: a week says how many of its tasks have no working/waiting split yet, and a cause cell never reads ≥0 for them", async () => {
  const { buildByWeek } = await import("../../../site/scripts/by-week.mjs")
  const { checkByWeek } = await import("../../../site/scripts/check-numbers.mjs")
  // A later week whose one task waited with no session running, so that cause has a row.
  const later = stack("dddd", true)
  later.idle = { next_prompt: MEAS(7 * H), no_session: MEAS(H) }
  const stackup = { jobs: [stack("aaaa", true), stack("bbbb", false), stack("cccc", false), later] }
  const day = (value) => ({ state: "partial", value, basis: "desk_card_updated", bound: "upper", reasons: ["finish_from_card_update"] })
  const doc = buildByWeek({ stackup, tasks: { jobs: [] }, finishDates: new Map([...["aaaa", "bbbb", "cccc"].map((j) => [j, day("2026-10-06")]), ["dddd", day("2026-10-13")]]) })
  const w = doc.weeks[0]
  assert.equal(w.n_unsplit, 2)
  assert.deepEqual(w.unsplit_reasons, ["source_unreadable"])
  assert.deepEqual(checkByWeek(doc), [])
  const ot = S.overTime(doc, { jobs: [], taskRows: [], year: 2026 })
  assert.equal(ot.weeks[0].unsplit.n, 2)
  assert.equal(ot.weeks[0].unsplit.words, "2 of 3 tasks have no working/waiting split yet (a session's log could not be read)")
  const t = S.causeTable(ot, "all")
  const np = t.rows.find((r) => r.key === "waiting:next_prompt")
  assert.ok(np)
  const ns = S.causeTable(ot, "all").rows.find((r) => r.key === "waiting:no_session")
  // The zero is only over the task with a split; the cell says so instead of ≥0.
  assert.equal(ns.cells[0].short, "not measured for 2")
  assert.match(ns.cells[0].words, /none recorded in the 1 task with a split; not measured for the other 2/)
  assert.equal(ns.cells[1].short, "1h")
  for (const r of S.causeTable(ot, "share").rows) for (const c of r.cells) assert.notEqual(c.short, "≥0")
  for (const r of t.rows) for (const c of r.cells) assert.notEqual(c.short, "≥0")
  // The page says it under each bar and in the caption.
  const app = read("site/src/app.js")
  assert.match(app, /b\.unsplit && b\.unsplit\.n/)
})

// ------------------------------------------------------------------ M9

test("M9: a weekly sum stays at least when its no-direction members are exact (bound_not_moved), and has no direction when one truly has none", async () => {
  const { sumFigures } = await import("../../../site/scripts/by-week.mjs")
  const exact = { state: "partial", value: 0, reasons: ["card_dates_shorter_than_work"], bound: null, bound_reason: "bound_not_moved" }
  const low = { state: "partial", value: 0, reasons: ["card_dates_shorter_than_work"], bound: "lower" }
  assert.equal(sumFigures([exact, low, { state: "unavailable", reasons: ["source_unreadable"] }]).bound, "lower")
  const open = { state: "partial", value: 5, reasons: ["x"], bound: null, bound_reason: "bound_reasons_conflict" }
  const s = sumFigures([open, low])
  assert.equal(s.bound, null)
  assert.equal(s.bound_reason, "bound_reasons_conflict")
  // llms.txt says so.
  assert.match(read("site/src/llms-template.txt"), /a member whose `bound_reason` is `bound_not_moved` is exact and adds no direction to a sum/)
})

// ------------------------------------------------------------------ M1

test("M1: a pull request's words drop 'Desk does not say which yet' wherever Desk says whether the session opened it", () => {
  assert.equal(W.prLegendWords([{ created: true }, { created: true }]), "A pull request this task opened, on the ladder's second lane at its opening time; a diamond is one merged.")
  assert.equal(W.prLegendWords([{ created: true }, { created: false }]), "A pull request this task opened or only mentioned (its drawer says which), on the ladder's second lane at its opening time; a diamond is one merged.")
  assert.match(W.prLegendWords([{ created: true }, { created: null }]), /Desk does not say which for some/)
  assert.equal(W.prLegendWords([]), "A pull request this task opened or mentioned, on the ladder's second lane at its opening time; a diamond is one merged.")
  assert.match(W.prStateWords({ created: false, state: "merged" }), /^A pull request this task's sessions mentioned but did not open; it merged$/)
  const about = read("site/src/index.html")
  assert.doesNotMatch(about, /Desk does not say which yet/)
  assert.doesNotMatch(read("site/src/app.js"), /Desk does not say which yet/)
})

// ------------------------------------------------------------------ M2

test("M2: the pull request section mentions unplaced pull requests only when one exists", () => {
  const all = W.prCaption({ placed: 35, total: 35, anchorMeasured: true })
  assert.equal(all, "35 of 35 pull requests have an opening time on the task clock. GitHub's times are placed through the task's clock anchor, to within seconds.")
  assert.equal(W.prCaption({ placed: 33, total: 35 }), "33 of 35 pull requests have an opening time on the task clock. The 2 with no placed time are listed as \"opened, time not recorded\", with why, and are not drawn.")
  assert.equal(W.prCaption({ placed: 0, total: 1 }), "0 of 1 pull request has an opening time on the task clock. The 1 with no placed time is listed as \"opened, time not recorded\", with why, and is not drawn.")
  assert.match(read("site/src/app.js"), /W\.prCaption\(/)
})

// ------------------------------------------------------------------ M3

test("M3: an open task's lede says it is still open once", () => {
  assert.equal(W.afterFinish("This task is still open. So far it has taken at least "), "So far it has taken at least ")
  assert.equal(W.afterFinish("This task took 5 hours"), "It took 5 hours")
  assert.equal(W.afterFinish("Other text"), "Other text")
  const app = read("site/src/app.js")
  assert.match(app, /W\.afterFinish\(next\.textContent\)/)
})

// ------------------------------------------------------------------ M4

test("M4: every view states its own fold threshold in the same words, apart from Desk's 15-minute burst rule", () => {
  assert.equal(W.foldWords({ fold_ms: 0 }), "At this width the map folds no wait: every work burst has its own box and every wait its own triangle.")
  assert.equal(W.foldWords({ fold_ms: 5 * 60000 }), "At this width the map folds waits shorter than 5 minutes into the box beside them, so it stays legible; each box says how many bursts it holds, and the ladder shows the folded waits beside its working time. A wider or narrower screen may fold a different threshold.")
  assert.match(W.foldWords({ fold_ms: Infinity }), /^At this width the map folds every wait into one box/)
  const html = read("site/src/index.html")
  assert.match(html, /Desk starts a new burst after 15 minutes idle or when an operator prompt arrives; to fit the screen, the map may also fold shorter waits into the box beside them, and the note under the map gives the threshold at this width/)
})

// ------------------------------------------------------------------ M5

test("M5: a prompt carries its UTC day where the task's clock has a measured anchor, and the prompt drawer shows it", async () => {
  const { prClock } = await import("../../../site/scripts/pr-clock.mjs")
  const M = 60000
  const T0 = Date.parse("2026-10-05T22:00:00Z")
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
  const prs = [{ repo: "o/r", number: 1, at_ms: 10 * M, created: true }, { repo: "o/r", number: 2, at_ms: 50 * M, created: true }]
  const gh = new Map([["o/r#1", { created_at: iso(T0 + 10 * M + 3000), merged_at: null, state: "open" }], ["o/r#2", { created_at: iso(T0 + 50 * M + 5000), merged_at: null, state: "open" }]])
  const clock = prClock(prs, gh)
  assert.equal(clock.anchor.state, "measured")
  assert.equal("value_ms" in clock.anchor, false, "the map never holds an epoch value")
  const report = { job: { id: "j" }, timeline: { prs, human_turns: [{ session: "s", host: "claude-code", at_ms: 30 * M, basis: "first", window_ms: null, prompt_class: "s", output_class: "none" }, { session: "s", host: "claude-code", at_ms: 3 * 60 * M, basis: "after_stop", window_ms: 60 * M, prompt_class: "m", output_class: "l" }] } }
  const map = W.slimMap(report, { pr_clock: clock, finish_date: null })
  assert.deepEqual(map.human_turns.map((h) => h.day), ["2026-10-05", "2026-10-06"])
  assert.equal(JSON.stringify(map).includes(String(T0).slice(0, 6)), false, "no epoch value in the file")
  // With no anchor, no day is given.
  const none = W.slimMap(report, { pr_clock: prClock(prs, null), finish_date: null })
  assert.deepEqual(none.human_turns.map((h) => h.day), [null, null])
  // The drawer's day row.
  assert.equal(W.promptDayWords("2026-10-06", { year: 2026 }), "6 Oct (UTC)")
  assert.equal(W.promptDayWords(null), "not known: the task's clock is not tied to the calendar (no pull request anchors it)")
  assert.match(read("site/src/walk.js"), /\["Day \(UTC\)", promptDayWords\(t\.day\)\]/)
})

// ------------------------------------------------------------------ M6-M8

test("M6: the Pareto axis says its bars are job-hours summed over tasks", () => {
  const app = read("site/src/app.js")
  assert.equal(S.paretoAxisTitle("hours"), "Job-hours, summed over tasks")
  assert.doesNotMatch(app, /\(per task\)`/)
})

// CIEDE2000 between two hex colors, for the palette check.
function de2000(h1, h2) {
  const lab = (h) => {
    const c = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    const x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047
    const y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
    const z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
    return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))]
  }
  const [L1, a1, b1] = lab(h1)
  const [L2, a2, b2] = lab(h2)
  const rad = (d) => (d * Math.PI) / 180
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360
  const h2p = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360
  let dh = h2p - h1p
  if (C1p * C2p === 0) dh = 0
  else if (Math.abs(dh) > 180) dh -= 360 * Math.sign(dh)
  const dL = L2 - L1
  const dC = C2p - C1p
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2))
  const Lb = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  const hb = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : (h1p + h2p + 360) / 2
  const T = 1 - 0.17 * Math.cos(rad(hb - 30)) + 0.24 * Math.cos(rad(2 * hb)) + 0.32 * Math.cos(rad(3 * hb + 6)) - 0.2 * Math.cos(rad(4 * hb - 63))
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2)
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hb - 275) / 25) ** 2))))
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))
}

test("M7: in both themes, extra processing and long tool call, and defects and after a failed tool call, are clearly different colors", () => {
  const css = read("site/src/styles.css")
  const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"))
  const light = css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"))
  const tok = (src, name) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(src)[1]
  for (const src of [light, dark]) {
    assert.ok(de2000(tok(src, "c-waste-extra-processing"), tok(src, "c-wait-long_tool_call")) >= 12)
    assert.ok(de2000(tok(src, "c-waste-defects"), tok(src, "c-wait-tool_failure")) >= 12)
  }
})

test("M8: on a phone, Pareto bars carry numbers and their names are a list under the chart, so no label overlaps", () => {
  const model = { bars: [{ label: "Waiting · no session running", ms: 117 * H, href: "#/causes/waiting:no_session" }, { label: "Waiting · agent on another task", ms: 5.6 * H, href: null }] }
  assert.deepEqual(S.paretoNames(model), [
    { n: 1, label: "Waiting · no session running", hours: "117h", href: "#/causes/waiting:no_session" },
    { n: 2, label: "Waiting · agent on another task", hours: "5.6h", href: null },
  ])
  const app = read("site/src/app.js")
  assert.match(app, /S\.paretoNames\(model\)/)
  assert.match(app, /phone \? \[String\(i \+ 1\)\] : wrapWords\(b\.label/)
})

// ------------------------------------------------------------------ M10

test("M10: the wait drawer says why the agent stopped once when the wait holds one stop", () => {
  const stop = { session: "s", start_ms: 0, end_ms: 19 * H, next_prompt_ms: 19 * H, stop: { end: "end_turn", asks: false, pending_agents: false }, why: "not_known", why_source: "none", confidence: null, reasons: ["not_labeled"] }
  const rows = W.whyRows({ not_known: 19 * H }, [stop], ["not_labeled"], 54 * H)
  const labels = rows.map((r) => r[0])
  assert.equal(labels.filter((l) => /why/i.test(l)).length, 1, labels.join(" | "))
  assert.deepEqual(rows[0], ["Why the agent stopped", "why not known (not labeled yet), 19 hours"])
  // Two stops, or a stop whose class differs from the split, keep their own rows.
  const two = W.whyRows({ not_known: 19 * H, acceptance: H }, [stop, { ...stop, why: "acceptance", why_source: "evaluator", confidence: "high", reasons: [] }], ["not_labeled"], 54 * H)
  assert.ok(two.some((r) => r[0] === "Stop 1 of 2: why"))
  assert.ok(two.some((r) => r[0] === "Stop 2 of 2: why"))
})

test("I2: an 'at least zero' prompt count or estimate reads as none recorded, never 'at least 0' or 'at least none'", () => {
  const o = W.operatorTime({ attention_ms: partial(0, ["host_records_partly"], "lower"), human_turns: partial(0, ["host_records_partly"], "lower") }, [], null, F.reasonText, F.reasonCore)
  assert.equal(o.attention, "none recorded")
  assert.equal(o.text, "No prompt from the operator is recorded for this task (the host records only part of this, so the figure is a lower bound). Desk's estimate of the operator's attention on this task, their reading and answering time, has no recorded prompt to rest on, so it reads none recorded; it is the same estimate the Store page averages over delivered tasks.")
  assert.doesNotMatch(o.text, /at least (0|none)/)
})

test("M1: a pull request the sessions only mentioned is never called 'first appeared' in its own words", () => {
  const pr = (created) => ({ repo: "o/r", number: 7, created, opened_at_ms: 600000, opened_state: "measured" })
  assert.match(W.promptItem({ kind: "pr", pr: pr(false) }, { origin_ms: 0 }).where, /^It was mentioned at minute 10 after the task's start$/)
  assert.match(W.promptItem({ kind: "pr", pr: pr(true) }, { origin_ms: 0 }).where, /^It was opened at minute 10/)
  assert.match(W.promptItem({ kind: "pr", pr: pr(null) }, { origin_ms: 0 }).where, /^It first appeared at minute 10/)
  assert.match(W.promptItem({ kind: "pr", pr: pr(false) }, { origin_ms: 1200000 }).where, /^It was mentioned 10 minutes before the task's start$/)
  const walk = read("site/src/walk.js")
  assert.match(walk, /x\.pr\.created === false \? "mentioned"/)
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /"Pull request first appeared in this task's sessions/)
  assert.doesNotMatch(walk, /"Pull requests first appeared"/)
})

// ================================================================ Fix round 1
// The review of PR #220 (s7-v11-review.md): the landing task teaches (I-1),
// the Store's yield note counts delivered jobs only (I-2), and m-1 to m-5.

const M = 60000
// A finished job with what the landing rule reads: working time, the map's
// drawn bursts and the recorded prompts.
const teach = (id, order, d, lead, opts = {}) => ({
  ...job(id, "done", order, { date: day(d), lead: measured(lead * H) }),
  active_time_ms: opts.work === undefined ? measured(30 * M) : opts.work,
  map_bursts: opts.bursts === undefined ? measured(4) : opts.bursts,
  human_turns: opts.prompts === undefined ? measured(3) : opts.prompts,
})

test("Fix 1 I-1: #/ lands on the latest-finished task that has something to teach", () => {
  const thin = job("thin", "done", 9, { date: day("2026-10-07"), lead: measured(126 * H) })
  const a = teach("a", 5, "2026-09-30", 26)
  const b = teach("b", 4, "2026-09-29", 54)
  assert.equal(F.defaultTask([thin, a, b]).id, "a")
  const c = F.landingChoice([thin, a, b])
  assert.equal(c.job.id, "a")
  assert.equal(c.teaches, true)
  assert.equal(c.why, null)
  // A same-day tie goes to the larger lead time.
  assert.equal(F.defaultTask([teach("x", 1, "2026-09-30", 30), teach("y", 2, "2026-09-30", 20)]).id, "x")
  // Each condition on its own keeps a task out.
  const out = (o, lead = 26) => F.defaultTask([b, teach("z", 7, "2026-10-05", lead, o)]).id
  assert.equal(out({}), "z")
  assert.equal(out({}, 0.5), "b", "lead under an hour")
  assert.equal(out({ work: measured(4 * M) }), "b", "under 5 minutes of working time")
  assert.equal(out({ work: partial(6 * M, ["host_records_partly"], "lower") }), "z", "partial working time with a value counts")
  assert.equal(out({ work: unavailable(["source_unreadable"]) }), "b", "working time not known")
  assert.equal(out({ bursts: unavailable(["no_segments"]) }), "b", "no burst drawn")
  assert.equal(out({ bursts: measured(0) }), "b", "no burst")
  assert.equal(out({ bursts: partial(2, ["field_absent"], "lower") }), "z", "a partly recorded map with bursts draws them")
  assert.equal(out({ prompts: partial(0, ["host_records_partly"], "lower") }), "b", "no recorded prompt")
  assert.equal(out({ prompts: unavailable(["field_absent"]) }), "b", "prompts not recorded")
  // No task qualifies: the earlier rule, and the page says why.
  const none = F.landingChoice([thin, job("short", "done", 3, { date: day("2026-10-06"), lead: measured(2 * H) })])
  assert.equal(none.job.id, "thin")
  assert.equal(none.teaches, false)
  assert.equal(none.why, "No finished task has all of a lead time of at least an hour, at least 5 minutes of known working time, a work burst on its map and a recorded operator prompt, so this page opens on the latest-finished task whose lead time is at least an hour instead.")
  assert.equal(F.landingChoice([]).job, null)
  // The page shows the reason, and llms.txt and About state the rule.
  assert.match(read("site/src/app.js"), /F\.landingChoice\(data\.jobs\)/)
  assert.match(read("site/src/llms-template.txt"), /`active_time_ms` is measured, or partial with a value, at 300000 ms or more; `map_bursts` has a value of 1 or more and is not `unavailable`; and `human_turns` has a value of 1 or more/)
  assert.match(read("site/src/index.html"), /at least 5 minutes of known working time, at least one work burst on its map and at least one recorded operator prompt/)
})

test("Fix 1 I-1: each task row says how many work bursts its map draws", async () => {
  const { jobSummary } = await import("../../../site/scripts/job-summary.mjs")
  const { checkNumbers } = await import("../../../site/scripts/check-numbers.mjs")
  const items = [{ start_ms: 0, end_ms: 1 }, { start_ms: 2, end_ms: 3 }]
  assert.deepEqual(jobSummary({ job: "a", timeline: { bursts: items } }, "a.json").map_bursts, { state: "measured", value: 2, reasons: [] })
  assert.deepEqual(jobSummary({ job: "a", timeline: { bursts: { state: "partial", reasons: ["field_absent"], items } } }, "a.json").map_bursts, { state: "partial", value: 2, reasons: ["field_absent"], bound: "lower" })
  assert.deepEqual(jobSummary({ job: "a", timeline: { bursts: items, bursts_state: { state: "unavailable", reasons: ["no_segments"] } } }, "a.json").map_bursts, { state: "unavailable", reasons: ["no_segments"] })
  assert.deepEqual(jobSummary({ job: "a" }, "a.json").map_bursts, { state: "unavailable", reasons: ["not_recorded"] })
  const bad = checkNumbers({ jobs: [{ map_bursts: { state: "measured", value: 2, reasons: [] } }] }).filter((v) => /map_bursts/.test(v.path))
  assert.deepEqual(bad, [])
})

test("Fix 1 I-2: the Store's yield note counts only delivered jobs and agrees with the section", async () => {
  const { outcomesSummary } = await import("../../../site/scripts/outcomes.mjs")
  const file = {
    signoff: { recorded: true, accepted: 0, delivered_unsigned: 5, jobs: 41, jobs_without_work_record: 11, no_record: 1, not_delivered: 20, not_recorded: 16, refused: 0, reopened: 0, refusal_reasons: {}, waits: { signed: {}, unsigned: { lt_1d: 5 } } },
    first_pass_yield: { N: 0, awaiting_signoff: 0, changed_ask_only: 0, excluded: [{ jobs: 41, reason: "history_not_recorded" }, { jobs: 1, reason: "not_recorded" }], n: 0, passed: 0, reasons: ["no_delivered_jobs"], returned: 0, state: "unavailable" },
  }
  const w = F.signoffWords(outcomesSummary(file), 31)
  // 21 = 5 awaiting an answer + 16 delivered before sign-off was recorded, the
  // section's own figures; the excluded total (42) is larger and never shown as delivered.
  assert.equal(w.yieldNote, "All 21 delivered jobs are out of scope for first-pass yield (the 5 awaiting an answer and the 16 delivered before sign-off was recorded). Across all 42 jobs, 41 are out of scope because the job's history was not recorded from the start (an adopted card), and 1 because the store has no record of this.")
  // One reason reads alone; with no delivered count, no note.
  const one = outcomesSummary({ ...file, first_pass_yield: { ...file.first_pass_yield, excluded: [{ jobs: 42, reason: "history_not_recorded" }] } })
  assert.match(F.signoffWords(one, 31).yieldNote, /\. Across all 42 jobs, 42 are out of scope because the job's history was not recorded from the start \(an adopted card\)\.$/)
  const noCount = outcomesSummary({ ...file, signoff: { ...file.signoff, not_delivered: undefined } })
  assert.equal(F.signoffWords(noCount, 31).yieldNote, null)
})

test("Fix 1 m-1: the task page calls the attention estimate Desk's, as the glossary does", () => {
  const j = { human_turns: measured(2), attention_ms: measured(5 * M) }
  const t = W.operatorTime(j, [], "measured", F.reasonText, F.reasonCore).text
  assert.match(t, /Desk's estimate of the operator's attention on this task/)
  assert.doesNotMatch(t, /store's estimate/)
  const zero = W.operatorTime({ human_turns: partial(0, ["host_records_partly"], "lower"), attention_ms: partial(0, ["host_records_partly"], "lower") }, [], null, F.reasonText, F.reasonCore).text
  assert.match(zero, /Desk's estimate/)
  assert.match(W.operatorTime({ attention_ms: unavailable(["field_absent"]), human_turns: unavailable(["field_absent"]) }, [], null, F.reasonText, F.reasonCore).text, /^Desk has no estimate/)
})

test("Fix 1 m-2: a rank inside a shared day says the order is the store's and how many share the day", () => {
  const jobs = [
    job("a", "done", 1, { date: day("2026-10-06") }),
    job("b", "done", 2, { date: day("2026-10-07") }),
    job("c", "done", 3, { date: day("2026-10-07") }),
  ]
  assert.match(F.finishWords(jobs[2], jobs), /, the 3rd of 3 dated tasks in the store's order; 2 tasks share this day\./)
  assert.match(F.finishWords(jobs[0], jobs), /, the 1st of 3 dated tasks\./)
})

test("Fix 1 m-3: a list state with reasons that pull both ways names no direction", () => {
  const words = (s) => W.clockListWords(s, "Pull requests", F.reasonText, F.reasonCore)
  const both = words({ state: "partial", bound: "lower", reasons: ["host_records_partly", "worker_shared"] })
  assert.equal(both, "Pull requests only partly recorded, and some may belong to other jobs that share a worker, so there may be more or fewer than these (the host records only part of this; includes a worker shared with other jobs; some of these reasons pull the figure up and others down, so which way the true figure lies is not known)")
  assert.doesNotMatch(both, /lower bound/)
  assert.match(words({ state: "partial", bound: "lower", reasons: ["host_records_partly"] }), /may be more than these \(the host records only part of this, so the figure is a lower bound\)$/)
  assert.match(read("site/src/app.js"), /W\.clockListWords\(map\.prs_state, "Pull requests", F\.reasonText, F\.reasonCore\)/)
})

test("Fix 1 m-4: the Pareto axis title comes from a function the page calls", () => {
  assert.equal(S.paretoAxisTitle("hours"), "Job-hours, summed over tasks")
  assert.equal(S.paretoAxisTitle("minutes"), "Job-minutes, summed over tasks")
  assert.match(read("site/src/app.js"), /S\.paretoAxisTitle\(scale\.unit\)/)
})

test("Fix 1 m-5: a finish day with no direction reads once in chart labels", () => {
  const fd = { state: "partial", value: "2026-09-29", basis: "desk_card_updated", bound: null, reasons: ["finish_before_last_work"] }
  assert.equal(F.finishLabel(F.finishDay(fd, { year: 2026 })), "about 29 Sep (UTC; direction not known)")
  assert.equal(F.finishLabel(F.finishDay(day("2026-09-29"), { year: 2026 })), "on or before 29 Sep (UTC)")
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /finish\.words\} \(UTC\)/)
  assert.match(app, /F\.finishLabel\(/)
})

// ================================================================ Fix round 2

test("Fix 2: the first-pass-yield caption counts only delivered jobs, as the note beneath it does", async () => {
  const { outcomesSummary } = await import("../../../site/scripts/outcomes.mjs")
  const file = {
    signoff: { recorded: true, accepted: 0, delivered_unsigned: 5, jobs: 41, jobs_without_work_record: 11, no_record: 1, not_delivered: 20, not_recorded: 16, refused: 0, reopened: 0, refusal_reasons: {}, waits: { signed: {}, unsigned: { lt_1d: 5 } } },
    first_pass_yield: { N: 0, awaiting_signoff: 0, changed_ask_only: 0, excluded: [{ jobs: 41, reason: "history_not_recorded" }, { jobs: 1, reason: "not_recorded" }], n: 0, passed: 0, reasons: ["no_delivered_jobs"], returned: 0, state: "unavailable" },
  }
  const y = outcomesSummary(file).first_pass_yield
  // 21 delivered (41 with a sign-off record less 20 not delivered), none with a verdict.
  assert.equal(y.out_of_scope, 21)
  assert.equal(F.describe(y, "pct").nofn, "0 of 0 verdicts on delivered jobs are final \u00b7 21 out of scope")
  // Why, over every job, is kept apart from the caption.
  assert.deepEqual(y.excluded, { history_not_recorded: 41, not_recorded: 1 })
  // With verdicts, the delivered jobs without one are out of scope.
  const some = outcomesSummary({ ...file, first_pass_yield: { ...file.first_pass_yield, N: 4, awaiting_signoff: 1, state: "partial", value: 0.75, reasons: [] } }).first_pass_yield
  assert.equal(some.N, 4)
  assert.equal(some.out_of_scope, 17)
  // With no delivered count, the caption makes no out-of-scope claim.
  const unknown = outcomesSummary({ ...file, signoff: { ...file.signoff, not_delivered: undefined } }).first_pass_yield
  assert.equal(unknown.out_of_scope, 0)
})
