// The second v1.1 acceptance pass's findings (a1-v11-report-pass2.md): the
// landing task teaches with labels (B2 ruling), Over time draws "Not labeled
// yet" as the stack-up does (I-n1), and M-n1 to M-n6.
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
const M = 60000
const m = (value) => ({ state: "measured", value, reasons: [] })
const p = (value, reasons, bound) => ({ state: "partial", value, reasons, ...(bound === undefined ? {} : { bound }) })
const u = (reasons) => ({ state: "unavailable", reasons })
const day = (value) => ({ state: "partial", value, basis: "desk_card_updated", bound: "upper", reasons: ["finish_from_card_update"] })

// A finished data.json job with what the landing rule reads.
function job(id, order, d, leadH, o = {}) {
  return {
    id,
    status: o.status || "done",
    finish_order: m(order),
    finish_basis: o.labeled ? "labels" : "date",
    finish_date: day(d),
    lead_time_ms: m(leadH * H),
    active_time_ms: o.work === undefined ? m(30 * M) : o.work,
    map_bursts: o.bursts === undefined ? m(3) : o.bursts,
    human_turns: o.prompts === undefined ? m(2) : o.prompts,
    waste: { sessions_labeled: o.labeled ? m(1) : m(0) },
  }
}

// ------------------------------------------------------------ landing (B2 ruling)

test("#/ lands on the latest-finished task that teaches and has waste labels", () => {
  const jobs = [
    job("old", 1, "2026-09-29", 54, { labeled: true }),
    job("unl", 2, "2026-10-07", 7),
    job("noprompt", 3, "2026-10-07", 126, { prompts: p(0, ["host_records_partly"], "lower") }),
  ]
  const c = F.landingChoice(jobs)
  assert.equal(c.job.id, "old")
  assert.equal(c.level, "labeled")
  assert.equal(F.defaultTask(jobs).id, "old")
  assert.equal(c.note, "This page opens on the latest-finished task with waste labels, a lead time of at least an hour, at least 5 minutes of known working time, a work burst on its map and a recorded operator prompt. The 2 finished tasks that come after it in finish order are skipped (a task can miss several): 1 with no recorded operator prompt, 2 with no waste labels yet.")
  // A label with a session labeled counts; finish_basis alone does not decide.
  assert.equal(F.landingChoice([{ ...job("x", 1, "2026-10-01", 3), waste: { sessions_labeled: m(2) } }]).level, "labeled")
})

test("#/ drops the label condition when no labeled task teaches, then falls back, and says which", () => {
  const unl = F.landingChoice([job("old", 1, "2026-09-29", 54, { labeled: true, prompts: m(0) }), job("unl", 2, "2026-10-07", 7)])
  assert.equal(unl.job.id, "unl")
  assert.equal(unl.level, "unlabeled")
  assert.equal(unl.note, "No finished task has waste labels and all of a lead time of at least an hour, at least 5 minutes of known working time, a work burst on its map and a recorded operator prompt, so this page opens on the latest-finished task with all of these but the labels; it has no waste labels yet.")
  const fb = F.landingChoice([job("a", 1, "2026-10-06", 3, { bursts: u(["source_unreadable"]) }), job("b", 2, "2026-10-07", 0.5)])
  assert.equal(fb.job.id, "a")
  assert.equal(fb.level, "fallback")
  assert.match(fb.note, /^No finished task has all of a lead time of at least an hour, at least 5 minutes of known working time, a work burst on its map and a recorded operator prompt, so this page opens on the latest-finished task whose lead time is at least an hour instead\. The 1 finished task that comes after it in finish order is skipped \(a task can miss several\): 1 with a lead time under an hour or not known\.$/)
  // The page shows the note on #/ only, and llms.txt and About state the rule.
  const app = read("site/src/app.js")
  assert.match(app, /F\.landingChoice\(data\.jobs\)/)
  assert.match(app, /landing\.note/)
  assert.match(read("site/src/llms-template.txt"), /and `waste\.sessions_labeled` has a value of 1 or more \(the task has evaluator waste labels\)\. Open the one with the latest `finish_date\.value`\./)
  assert.match(read("site/src/llms-template.txt"), /If no task qualifies, the label condition is dropped; if still none qualifies,/)
  assert.match(read("site/src/index.html"), /"Follow a task" opens on the latest-finished task that has something to teach and waste labels/)
})

// ------------------------------------------------------------ I-n1

test("I-n1: Over time draws each part with the stack-up's class and outline, so Not labeled yet is outlined", () => {
  const nl = F.segmentLook({ key: "not_labeled" })
  assert.equal(nl.cls, "sb-seg seg-not_labeled")
  assert.equal(nl.stroke, "var(--c-not-labeled)")
  assert.equal(F.segmentLook({ key: "value" }).stroke, null)
  assert.equal(F.segmentLook({ key: "x", cause: "next_prompt" }).cls, "sb-seg seg-wait-next_prompt")
  assert.equal(F.segmentLook({ key: "unsplit" }).stroke, "var(--baseline)")
  assert.equal(F.segmentLook({ key: "working_unsplit" }).stroke, "var(--c-not-labeled)")
  // Both charts use it.
  assert.equal((read("site/src/app.js").match(/F\.segmentLook\(s\)/g) || []).length, 2)
})

// ------------------------------------------------------------ M-n2

test("M-n2: data.json gives a partial flow efficiency the direction of working over lead time", async () => {
  const { jobSummary } = await import("../../../site/scripts/job-summary.mjs")
  const { ratioDirection } = await import("../../../site/scripts/bounds.mjs")
  const part = (value) => ({ class: "measured", state: "partial", value, reasons: ["interval_outside_session_clock", "session_open"] })
  const report = { job: "a", formulas: { status: { value: "done" }, lead_time_ms: { class: "declared", state: "measured", value: 24013000, reasons: [] }, active_time_ms: part(19630398), flow_efficiency: { ...part(0.817), class: "inferred" } } }
  const s = jobSummary(report, "a.json")
  assert.equal(s.flow_efficiency.bound, "lower")
  assert.equal(s.details.find((d) => d.key === "flow_efficiency").number.bound, "lower")
  assert.equal(ratioDirection(m(1), p(1, ["censored"], "lower")), "upper")
  assert.equal(ratioDirection(p(1, ["x"], "lower"), p(1, ["censored"], "lower")), "unknown")
  assert.equal(ratioDirection(p(1, ["x"], "lower"), p(1, ["y"], "upper")), "lower")
  assert.equal(ratioDirection(m(1), m(1)), "unknown")
})

// ------------------------------------------------------------ M-n3

test("M-n3: the agent's work after the last prompt is capped at the task's own window", () => {
  const map = {
    lead_window: { state: "measured", start_ms: 0, end_ms: 6.7 * H, reasons: [] },
    sessions: [{ id: "s", offset_ms: 0, end_ms: 30 * H }],
    bursts: [{ start_ms: 0, end_ms: 6.7 * H, working_ms: m(6 * H) }],
    gaps: [],
    human_turns: [{ at_ms: 6 * H, session: "s", basis: "after_stop", window_ms: 60000 }],
    human_turns_state: m(1),
    prs: [],
  }
  const clock = W.clockMarks(map, W.mapModel(map))
  const words = W.workedWords(clock.prompts[0])
  assert.equal(words, "no later prompt while this task was open; the task ended 42 minutes later, and the session went on to other work")
  // A session that ends inside the window reads as before.
  const inside = { ...map, sessions: [{ id: "s", offset_ms: 0, end_ms: 6.5 * H }] }
  assert.equal(W.workedWords(W.clockMarks(inside, W.mapModel(inside)).prompts[0]), "no later prompt in this session; it ended 30 minutes later")
})

// ------------------------------------------------------------ M-n4

test("M-n4: the Store states its scope once, in jobs, and keeps tasks apart", async () => {
  const { outcomesSummary } = await import("../../../site/scripts/outcomes.mjs")
  const file = {
    signoff: { recorded: true, accepted: 0, delivered_unsigned: 5, jobs: 41, jobs_without_work_record: 11, no_record: 1, not_delivered: 20, not_recorded: 16, refused: 0, reopened: 0, refusal_reasons: {}, waits: { signed: {}, unsigned: { lt_1d: 5 } } },
    first_pass_yield: { N: 0, awaiting_signoff: 0, changed_ask_only: 0, excluded: [{ jobs: 41, reason: "history_not_recorded" }, { jobs: 1, reason: "not_recorded" }], n: 0, passed: 0, reasons: ["no_delivered_jobs"], returned: 0, state: "unavailable" },
  }
  const o = outcomesSummary(file)
  const w = F.signoffWords(o, 31, 19)
  assert.equal(w.scope, "These figures count 42 jobs: the 31 tasks the other pages show, and 11 task cards that have a sign-off record but no published session, so no time to show. Of the 42 jobs, 21 were delivered, 20 are not delivered yet and 1 has no sign-off record. 19 of the 31 tasks are delivered; a task is the published part of a job.")
  assert.equal(w.yieldNote, "None of the 21 delivered jobs has a first-pass result (the 5 awaiting an answer and the 16 delivered before sign-off was recorded). Desk counts its reasons over all jobs, not only delivered ones: 41 because the job's history was not recorded from the start (an adopted card), and 1 because the store has no record of this.")
  // The captions under the figures name no second out-of-scope count.
  assert.equal(F.describe(F.withoutScope(o.unsigned), "count").nofn, "5 of 5 delivered jobs with a sign-off record")
  assert.equal(F.describe(F.withoutScope(o.first_pass_yield), "pct").nofn, "0 of 0 verdicts on delivered jobs are final")
  const app = read("site/src/app.js")
  assert.match(app, /num\(F\.withoutScope\(o\.unsigned\), "count"\)/)
  assert.match(app, /num\(F\.yieldCaption\(o\.first_pass_yield, words\), "pct"\)/)
  assert.match(app, /F\.signoffWords\(o, taskCount, /)
})

// ------------------------------------------------------------ M-n5

test("M-n5: a week whose unsplit tasks were all cancelled does not promise a split", () => {
  const c = S.unsplitOf({ n: 13, n_unsplit: 2, unsplit_reasons: ["cancelled"] })
  assert.equal(c.words, "2 of 13 tasks have no working/waiting split (the job was cancelled)")
  assert.equal(c.final, true)
  const y = S.unsplitOf({ n: 4, n_unsplit: 1, unsplit_reasons: ["source_unreadable"] })
  assert.match(y.words, /has no working\/waiting split yet/)
  assert.equal(y.final, false)
  assert.equal(S.unsplitNote([{ label: "5 Oct", unsplit: c }]), "Not measured: week of 5 Oct, 2 of 13 tasks have no working/waiting split (the job was cancelled). Their hours count in the week's lead time as \"split not known\", and in no cause; \"n/m not split\" under a bar says the same.")
  assert.match(S.unsplitNote([{ label: "5 Oct", unsplit: c }, { label: "28 Sep", unsplit: y }]), /^Not measured yet: /)
  assert.match(read("site/src/app.js"), /S\.unsplitNote\(/)
})

// ------------------------------------------------------------ M-n6

test("M-n6: Compare's lede marks its hours and gives the share no direction when the parts' bounds conflict", () => {
  const lo = (v) => p(v, ["interval_outside_session_clock"], "lower")
  const row = (id, work, lead) => ({ job: id, status: m("done"), lead_time_ms: lead, working_ms: work, idle_ms: m(1), flow_efficiency: p(0.2, ["x"], "lower") })
  const bar = (id, w, l) => ({ job: id, name: `Task ${id}`, group: "finished", state: "ok", total_ms: l, words: `${l / H} hours`, finish: { day: "2026-10-05" }, groups: [{ ms: w }, { ms: l - w, segments: [{ cause: "other_task", ms: l - w }] }] })
  const bars = [bar("a", 10 * H, 100 * H), bar("b", 4 * H, 20 * H)]
  const rows = [row("a", lo(10 * H), p(100 * H, ["card_dates_shorter_than_work"], "lower")), row("b", lo(4 * H), m(20 * H))]
  const t = S.compareLede(bars, rows, F.reasonText).text
  assert.match(t, /agents were working about 12% \(direction not known\) of the elapsed time \(at least 14 of at least 120 hours\)\./)
  assert.match(t, / The rest, about 106 hours, was waiting/)
  // A member Desk marks bound_not_moved is exact and adds no direction.
  const exact = { state: "partial", value: 4 * H, reasons: ["card_dates_shorter_than_work"], bound: null, bound_reason: "bound_not_moved" }
  const t2 = S.compareLede(bars, [rows[0], row("b", exact, m(20 * H))], F.reasonText).text
  assert.match(t2, /\(at least 14 of at least 120 hours\)/)
  // With exact parts the figures stay plain.
  const plain = S.compareLede(bars, [row("a", m(10 * H), m(100 * H)), row("b", m(4 * H), m(20 * H))].map((r) => ({ ...r, flow_efficiency: m(0.1) })), F.reasonText).text
  assert.match(plain, /agents were working 12% of the elapsed time \(14 of 120 hours\)\. The rest, 106 hours, was waiting/)
})

// ------------------------------------------------------------ M-n1 on the page

test("M-n1: the landing note is shown on #/ with why newer tasks were skipped", () => {
  const app = read("site/src/app.js")
  assert.match(app, /note\.textContent = !r\.job && landing\.note \? landing\.note : ""/)
})

// ================================================================ Fix round 1
// The review of PR #228 (s8-v11-review.md): an open task's flow efficiency
// (I-1), a first-pass yield with a value (I-2), and M-1 to M-4.

test("Fix 1 I-1: an open task's flow efficiency has no direction, since its working time also grows", async () => {
  const { jobSummary } = await import("../../../site/scripts/job-summary.mjs")
  // 86bda7cc: processing, lead time censored (at least), working time measured so far.
  const report = { job: "o", formulas: { status: { value: "processing" }, lead_time_ms: { class: "declared", state: "partial", value: 4 * 24 * H, reasons: ["censored"], censored: true }, active_time_ms: { class: "measured", state: "measured", value: 12 * M, reasons: [] }, flow_efficiency: { class: "inferred", state: "partial", value: 0.002, reasons: ["censored"] } } }
  const s = jobSummary(report, "o.json")
  assert.equal(s.flow_efficiency.bound, "unknown")
  assert.equal(s.details.find((d) => d.key === "flow_efficiency").number.bound, "unknown")
  // A finished task keeps the direction its parts prove (M-n2).
  const done = { job: "d", formulas: { status: { value: "done" }, lead_time_ms: { class: "declared", state: "measured", value: 24013000, reasons: [] }, active_time_ms: { class: "measured", state: "partial", value: 19630398, reasons: ["session_open"] }, flow_efficiency: { class: "inferred", state: "partial", value: 0.8, reasons: ["session_open"] } } }
  assert.equal(jobSummary(done, "d.json").flow_efficiency.bound, "lower")
})

test("Fix 1 I-2: a first-pass yield with a value says what it rests on and why the other delivered jobs are left out", async () => {
  const { outcomesSummary } = await import("../../../site/scripts/outcomes.mjs")
  // Today's shape: 49 jobs, 22 delivered, one verdict.
  const file = {
    signoff: { recorded: true, accepted: 0, delivered_unsigned: 6, jobs: 48, jobs_without_work_record: 16, no_record: 1, not_delivered: 26, not_recorded: 16, refused: 0, reopened: 0, refusal_reasons: {}, waits: { signed: {}, unsigned: { lt_1d: 6 } } },
    first_pass_yield: { N: 1, n: 0, awaiting_signoff: 1, changed_ask_only: 0, excluded: [{ jobs: 41, reason: "history_not_recorded" }, { jobs: 6, reason: "not_delivered" }, { jobs: 1, reason: "not_recorded" }], passed: 1, reasons: ["awaiting_signoff"], returned: 0, state: "partial", value: 1 },
  }
  const o = outcomesSummary(file)
  assert.equal(o.first_pass_yield.state, "partial")
  assert.equal(o.first_pass_yield.N, 1)
  assert.equal(o.first_pass_yield.out_of_scope, 21)
  const w = F.signoffWords(o, 33, 20)
  assert.equal(w.yieldNote, "1 of the 22 delivered jobs has a first-pass verdict; the other 21 have none. Desk counts its reasons over all jobs, not only delivered ones: 41 because the job's history was not recorded from the start (an adopted card), and 1 because the store has no record of this.")
  // Desk's own "not delivered" count uses another base, so it is not listed and no total is given.
  assert.doesNotMatch(w.yieldNote, /not delivered|\b4[89]\b/)
  // The caption drops its out-of-scope count only when the note gives it.
  assert.equal(F.yieldCaption(o.first_pass_yield, w).out_of_scope, 0)
  assert.equal(F.yieldCaption(o.first_pass_yield, { yieldNote: null }).out_of_scope, 21)
  assert.match(read("site/src/app.js"), /num\(F\.yieldCaption\(o\.first_pass_yield, words\), "pct"\)/)
})

test("Fix 1 M-1: the landing note holds in either picker order", () => {
  const c = F.landingChoice([job("old", 1, "2026-09-29", 54, { labeled: true }), job("unl", 2, "2026-10-07", 7)])
  assert.match(c.note, / The 1 finished task that comes after it in finish order is skipped \(a task can miss several\): 1 with no waste labels yet\.$/)
  assert.doesNotMatch(c.note, /listed above/)
})

test("Fix 1 M-2, M-3: the Store's intro and the Health row point to the one scope line", () => {
  const html = read("site/src/index.html")
  assert.doesNotMatch(html, /counted beside each figure/)
  assert.match(html, /Jobs whose card predates sign-off are out of scope; the line below says how many\./)
  assert.match(read("site/src/app.js"), /key === "unsigned_deliveries" \? F\.withoutScope\(number\) : number/)
})

test("Fix 1 M-4: Compare's share follows its parts, and waiting takes the direction lead minus working proves", () => {
  const row = (id, work, lead, fe) => ({ job: id, status: m("done"), lead_time_ms: lead, working_ms: work, idle_ms: m(1), flow_efficiency: fe })
  const bar = (id, w, l) => ({ job: id, name: `Task ${id}`, group: "finished", state: "ok", total_ms: l, words: `${l / H} hours`, finish: { day: "2026-10-05" }, groups: [{ ms: w }, { ms: l - w, segments: [{ cause: "other_task", ms: l - w }] }] })
  const bars = [bar("a", 10 * H, 100 * H)]
  // Working at least, lead at most: the share is at least, waiting at most, even if the task's own bound says otherwise.
  const t = S.compareLede(bars, [row("a", p(10 * H, ["x"], "lower"), p(100 * H, ["y"], "upper"), p(0.1, ["x"], "upper"))], F.reasonText).text
  assert.match(t, /agents were working at least 10% of the elapsed time \(at least 10 of at most 100 hours\)\. The rest, at most 90 hours, was waiting/)
  // Working at most, lead at least: waiting at least.
  const t2 = S.compareLede(bars, [row("a", p(10 * H, ["x"], "upper"), p(100 * H, ["y"], "lower"), p(0.1, ["x"], "upper"))], F.reasonText).text
  assert.match(t2, /at most 10% of the elapsed time \(at most 10 of at least 100 hours\)\. The rest, at least 90 hours, was waiting/)
})
