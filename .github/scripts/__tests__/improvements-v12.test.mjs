import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { deriveImprovementQueue, validateImprovementQueue } from "../../../site/scripts/improvement-queue.mjs"
const require = createRequire(import.meta.url)
const S = require("../../../site/src/steps.js")
const F = require("../../../site/src/format.js")
const fixture = JSON.parse(readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
const measured = (value) => ({ state: "measured", value, reasons: [] })
const jobs = [
  { id: "a1", status: "done", outcome: "accepted", finish_date: measured("2026-10-10"), lead_time_ms: measured(100) },
  { id: "b2", status: "done", outcome: "delivered", finish_date: { state: "partial", value: "2026-10-10", bound: "upper", reasons: [] }, lead_time_ms: { state: "partial", value: 200, reasons: [] } },
  { id: "c3", status: "doing", outcome: "in_progress", finish_date: { state: "unavailable", reasons: ["open_job"] }, lead_time_ms: { state: "unavailable", reasons: ["not_recorded"] } },
]
const queue = (patch = {}, publicEvidence = []) => {
  const value = structuredClone(fixture.public)
  Object.assign(value.rows[0], patch)
  const doc = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000, publicEvidence })
  assert.equal(validateImprovementQueue(doc).ok, true)
  return doc
}

test("filter_population_is_not_emphasis", () => {
  assert.deepEqual(S.selectTaskPopulation(jobs, { status: "accepted" }).map((j) => j.id), ["a1"])
  assert.deepEqual(S.selectTaskPopulation(jobs, { status: "done" }).map((j) => j.id), ["a1", "b2"])
  assert.deepEqual(S.selectTaskPopulation(jobs, { task: "b2", evidence: "partial" }).map((j) => j.id), ["b2"])
  assert.deepEqual(S.selectTaskPopulation(jobs, { from: "2026-10-10", to: "2026-10-10" }).map((j) => j.id), ["a1"], "bounded finish dates are not exact dates")
  assert.deepEqual(S.selectTaskPopulation(jobs, { category: "waiting" }).map((j) => j.id), ["a1", "b2", "c3"])
  const bars = [{ job: "a1", total_ms: 100, segments: [{ key: "value", ms: 40 }, { key: "wait_other_task", cause: "other_task", ms: 60 }] }]
  const view = S.emphasizeCategories(bars, "waiting")
  assert.equal(view[0].total_ms, 100)
  assert.deepEqual(view[0].segments.map((s) => s.ms), [40, 60])
  assert.deepEqual(view[0].segments.map((s) => s.emphasized), [false, true])
  assert.equal(bars[0].segments[0].emphasized, undefined, "emphasis must not mutate accounting")
})

test("empty_or_invalid_population_does_not_manufacture_tasks", () => {
  assert.deepEqual(S.selectTaskPopulation(null, {}), [])
  assert.deepEqual(S.selectTaskPopulation(jobs, { task: "not_present" }), [])
  assert.deepEqual(S.selectTaskPopulation(jobs, { from: "2026-02-30" }).map((j) => j.id), ["a1", "b2", "c3"], "unsupported selectors follow the existing route validator")
  assert.deepEqual(S.selectTaskPopulation([...jobs, { id: "d4", status: "unavailable", outcome: "unknown" }], { status: "open" }).map((j) => j.id), ["c3"], "unknown lifecycle must not be classified as still open")
})

test("route_does_not_create_ownership_or_success", () => {
  const row = queue({ route: "agent_ready", gate: null }).rows[0]
  const p = S.improvementPresentation(row)
  assert.equal(p.ownership, "not_published")
  assert.match(p.verification, /not.*checked|not.*published/i)
  assert.equal(p.decision.state, "unavailable")
  const shipped = S.improvementPresentation(queue({ lifecycle: "shipped" }).rows[0])
  assert.match(shipped.verification, /shipped.*not.*checked/i)
  const closed = S.improvementPresentation(queue({ lifecycle: "closed_unverified" }).rows[0])
  assert.match(closed.verification, /without.*confirmed|not.*verified/i)
  const stale = S.improvementPresentation(queue({ state: "stale", age: "stale", ownership: "claimed" }).rows[0])
  assert.match(stale.verification, /insufficient|stale/i)
  assert.equal(S.improvementPresentation(null), null)
})

test("private_human_decision_without_public_issue_is_honest_and_actionable", () => {
  const row = queue().rows[0]
  const p = S.improvementPresentation(row)
  for (const key of ["availability", "gate_explanation", "context", "decision", "recommendation", "safe_continuation", "next_action", "handoff"]) assert.deepEqual(p[key], row[key])
  assert.equal(p.handoff.authority_limit, "inspect_only_no_new_authority")
  for (const sentinel of fixture.privacy_sentinels) assert.ok(!JSON.stringify(p).includes(sentinel))
  const c = fixture.cases.find((c) => c.name === "verified_public_issue_context_no_decision_fields")
  const publicRow = queue(c.row, c.publicEvidence).rows[0]
  const publicView = S.improvementPresentation(publicRow)
  assert.equal(publicView.availability, "verified_public_context")
  assert.equal(publicView.context[0].label, "Synthetic issue")
  assert.equal(publicView.recommendation.state, "unavailable")
  assert.equal(publicView.decision.state, "unavailable")
})

test("finding_keeps_context_while_legacy_compare_modes_remain_compatible", () => {
  const context = { cause: "waiting:other_task", task: "a1", status: "accepted", category: "waiting", evidence: "partial", selection: "gaps:3", return: "#/causes/waiting:other_task" }
  const hash = F.compareHash({ mode: "working", over: "task", otmode: "all", context })
  assert.deepEqual(F.navigationContext(hash), { mode: "working", ...context })
  assert.equal(F.parseRoute(hash).over, "task")
  assert.equal(F.parseRoute(hash).otmode, "all")
  const improvement = F.contextualRoute("#/improvements", hash)
  assert.equal(F.navigationContext(improvement).cause, "waiting:other_task")
  // A selection belongs to the view it was made on; it never travels to another view.
  assert.equal(F.navigationContext(improvement).selection, undefined)
  assert.equal(F.compareHash({ mode: "working", over: "task", otmode: "all" }), "#/compare?mode=working&over=task&otmode=all")
})

test("recorded_interruption_labels_do_not_assert_global_idle_or_production_pause", () => {
  assert.match(S.findingMeaning("waiting:other_task"), /Recorded work on other tasks/)
  assert.match(S.findingMeaning("waiting:no_session"), /No recorded task session/)
  assert.doesNotMatch(S.findingMeaning("waiting:next_prompt"), /Waiting is idle time|no agent.*working/)
})

test("unsupported_handoff_fields_are_not_copied_or_promoted", () => {
  const row = queue().rows[0]
  const malformed = structuredClone(row)
  malformed.handoff.private_prose = fixture.privacy_sentinels[4]
  assert.equal(S.improvementPresentation(malformed), null)
  const wrongId = structuredClone(row)
  wrongId.handoff.annotation_id = "/Users/synthetic/private"
  assert.equal(S.improvementPresentation(wrongId), null)
  const wrongRoute = structuredClone(row)
  wrongRoute.route = fixture.privacy_sentinels[4]
  wrongRoute.handoff.route = wrongRoute.route
  assert.equal(S.improvementPresentation(wrongRoute), null)
})

test("why_lean_is_an_open_experiment_not_a_uniqueness_claim", () => {
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8")
  const why = html.slice(html.indexOf('id="view-why"'), html.indexOf('id="view-about"'))
  const experiment = why.indexOf("open experiment")
  assert.ok(experiment >= 0 && experiment < why.indexOf("The four steps"), "the experiment framing comes before the method")
  assert.match(why, /designed so many teams can adopt it alongside their own engineering lifecycle/)
  assert.match(why, /tested only on the desks and agent hosts that publish to this store/)
  assert.match(why, /href="https:\/\/dora\.dev\/guides\/value-stream-management\/"/, "names the existing application of Lean to software delivery")
  assert.doesNotMatch(why, /\b(unique|uniquely|the first (factory|method|to)|the only (factory|method|one)|no one else|nobody else|industry borrows no)\b/i, "no unsupported uniqueness claim")
})

const html = () => readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8")
const appSource = () => readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")

test("static_comparison_and_findings_intros_ask_the_question_without_takt_or_savings", () => {
  const page = html()
  const lede = (view) => {
    const at = page.indexOf(`id="view-${view}"`)
    const m = page.slice(at).match(/<p class="lede[^"]*">([\s\S]*?)<\/p>/)
    return m[1]
  }
  // The static text is what a reader sees while data loads, and permanently if data.json fails.
  assert.match(lede("compare"), /Which recorded tasks have long windows or interruptions worth inspecting\?/)
  assert.doesNotMatch(lede("compare"), /takt|yamazumi/i)
  assert.match(lede("causes"), /Which recorded patterns deserve investigation\?/)
  assert.doesNotMatch(lede("causes"), /fixing pays|vital few|savings? (are|is) proven/i)
  // No runtime rewrite is needed once the static intro is right.
  assert.doesNotMatch(appSource(), /intro\.textContent = "Which recorded/)
})

test("emphasis_options_match_drawn_segments_with_reader_labels", () => {
  const bars = [
    { job: "a1", segments: [{ key: "value", ms: 5 }, { key: "defects", ms: 2 }, { key: "wait_no_session", cause: "no_session", ms: 7 }, { key: "wait_other_task", cause: "other_task", ms: 3 }] },
    { job: "b2", segments: [{ key: "value", ms: 1 }, { key: "wait_next_prompt_asked", cause: "next_prompt", ms: 4 }, { key: "wait_no_session", cause: "no_session", ms: 2 }] },
  ]
  const options = S.emphasisOptions(bars)
  const keys = options.map(([k]) => k)
  assert.deepEqual(keys, ["waiting", "value", "defects", "wait_next_prompt", "wait_other_task", "wait_no_session"])
  assert.equal(new Set(keys).size, keys.length, "no duplicate option")
  const label = (k) => options.find(([key]) => key === k)[1]
  assert.equal(label("wait_no_session"), "No recorded task session")
  assert.equal(label("wait_other_task"), "Recorded work on other tasks")
  assert.equal(label("waiting"), "Recorded task interruptions")
  assert.ok(!keys.includes("no_session") && !keys.includes("support"), "only categories the chart draws")
  assert.deepEqual(S.emphasisOptions(null), [])
  // Each offered option highlights exactly its own drawn segments.
  const emph = (k) => S.emphasizeCategories(bars, k).flatMap((b) => b.segments.filter((s) => s.emphasized).map((s) => `${b.job}:${s.key}`))
  assert.deepEqual(emph("wait_no_session"), ["a1:wait_no_session", "b2:wait_no_session"])
  assert.deepEqual(emph("wait_next_prompt"), ["b2:wait_next_prompt_asked"])
  for (const k of keys) assert.ok(emph(k).length > 0, `${k} highlights something`)
})

test("filter_changes_keep_the_reader_in_place", () => {
  const app = appSource()
  const start = app.indexOf("function renderComparisonControls")
  const body = app.slice(start, app.indexOf("async function renderCompare", start))
  // A filter change adds a history entry (Back still works) without a full route, which would move focus to the heading and scroll to the top.
  assert.match(body, /history\.pushState\(/)
  // Arrow keys or a date typed digit by digit on one focused control make one Back step, not one per intermediate value.
  assert.match(body, /if \(source && comparisonEditing === source\) history\.replaceState\(null, "", hash\);/)
  // Only a frame that refuses pushState falls back to a hash navigation.
  assert.equal((body.match(/location\.hash =/g) || []).length, 1)
  assert.match(body, /catch \(err\) \{\s*location\.hash = hash; \/\/ a sandboxed frame may refuse pushState/)
})

test("review_minor_fixes_use_reader_words_and_state_failures", () => {
  // Lifecycle identifiers become reader-facing labels.
  assert.equal(S.lifecycleLabel("closed_unverified"), "Closed, result not confirmed")
  assert.equal(S.lifecycleLabel("closed_confirmed"), "Closed, result confirmed")
  assert.equal(S.lifecycleLabel("verifying"), "Checking the result")
  assert.equal(S.lifecycleLabel(null), "Not recorded")
  assert.equal(S.lifecycleLabel("made_up"), "Not recorded")
  const app = appSource()
  assert.doesNotMatch(app, /Published lifecycle: \$\{p\.lifecycle/)
  assert.doesNotMatch(app, /Start with real health alarms/, "the list shows no alarms, so the caption must not promise them")
  // The cause page's tab title uses the same reader-facing name as its heading.
  assert.doesNotMatch(app, /document\.title = `\$\{d\.label\} · The factory`;\n    if \(d\.state === "absent"\)/)
  // A failed copy says so before offering the selected text.
  assert.doesNotMatch(app, /status\.textContent = "The prompt is selected; copy it with the keyboard\."/)
  // One malformed Improvements row renders its own error instead of blanking the view.
  const fn = app.slice(app.indexOf("function renderPublicImprovements"), app.indexOf("async function renderAct"))
  assert.match(fn, /This improvement could not be shown/)
  assert.match(app, /safely\("triage-brief", \(\) => renderPublicImprovements\(/)
  // Status options match the page's definitions: "Done" is done; cancelled is its own choice.
  assert.match(app, /\["done", "Done"\], \["cancelled", "Cancelled"\]/)
})

test("unsupported_emphasis_is_explained_and_mutes_nothing", () => {
  const bars = [{ job: "a1", segments: [{ key: "value", ms: 5 }, { key: "wait_no_session", cause: "no_session", ms: 7 }] }]
  // A hand-typed category the chart does not draw (here the bare legacy key) is unsupported.
  for (const category of ["no_session", "defects", "wait_other_task", "made_up"]) {
    assert.equal(S.supportedEmphasis(bars, category), null, category)
    assert.ok(S.emphasizeCategories(bars, category)[0].segments.every((s) => s.emphasized), `${category} mutes nothing`)
  }
  assert.equal(S.supportedEmphasis(bars, "wait_no_session"), "wait_no_session")
  assert.equal(S.supportedEmphasis(bars, undefined), null)
  // The page says so visibly.
  const app = appSource()
  assert.match(app, /compare-emphasis-note/)
  assert.match(app, /is not a category drawn in this chart, so nothing is emphasized/)
})

test("improvements_lead_with_one_status_sentence_and_keep_limits_in_how_to_read", () => {
  const notReviewed = { schema: "factory-improvements/1", state: "not_reviewed", rows: [] }
  assert.equal(S.improvementStatus({ queue: notReviewed, issues: 8, issuesVerified: true }),
    "Not reviewed yet: no improvement has been reviewed by triage; 8 published improvement issues are listed below under Problems in hand.")
  assert.equal(S.improvementStatus({ queue: notReviewed, issues: 1, issuesVerified: true }),
    "Not reviewed yet: no improvement has been reviewed by triage; 1 published improvement issue is listed below under Problems in hand.")
  assert.equal(S.improvementStatus({ queue: notReviewed, issues: 0, issuesVerified: true }),
    "Not reviewed yet: no improvement has been reviewed by triage; no improvement issue has been published yet.")
  assert.equal(S.improvementStatus({ queue: notReviewed, issues: 3, issuesVerified: false }),
    "Not reviewed yet: no improvement has been reviewed by triage; the published improvement issues could not be checked for this build.")
  // Counts come from the rows the page draws: a malformed row is not counted,
  // and stale and conflicting rows are named separately.
  const current = queue({ route: "agent_ready", gate: null }).rows[0]
  const stale = queue({ state: "stale", age: "stale" }).rows[0]
  const conflicting = { ...structuredClone(current), conflict: true, availability: "stale_or_conflicting", handoff: { ...structuredClone(current.handoff), availability: "stale_or_conflicting" } }
  assert.ok(S.improvementPresentation(conflicting), "a conflicting row still draws")
  const reviewed = { schema: "factory-improvements/1", state: "reviewed", rows: [current, stale, conflicting, { availability: "stale_or_conflicting" }, null] }
  assert.equal(S.improvementStatus({ queue: reviewed, issues: 8, issuesVerified: true }),
    "3 reviewed improvements are listed first, those needing a refresh first (1 stale, 1 in conflict); 8 published improvement issues follow under Problems in hand.")
  assert.equal(S.improvementStatus({ queue: { ...reviewed, rows: [current] }, issues: 1, issuesVerified: true }),
    "1 reviewed improvement is listed first; 1 published improvement issue follows under Problems in hand.")
  assert.equal(S.improvementStatus({ queue: { ...reviewed, rows: [{ availability: "stale_or_conflicting" }] }, issues: 2, issuesVerified: true }),
    "Reviewed improvements are published but none can be shown; 2 published improvement issues are listed below under Problems in hand.")
  assert.equal(S.improvementStatus({ queue: { ...reviewed, rows: [] }, issues: 2, issuesVerified: true }),
    "No current reviewed improvement is published; 2 published improvement issues are listed below under Problems in hand.")
  assert.equal(S.improvementStatus({ queue: null, issues: 2, issuesVerified: true }),
    "Improvement review details are unavailable; 2 published improvement issues are listed below under Problems in hand.")

  const page = html()
  const act = page.slice(page.indexOf('id="view-act"'), page.indexOf('id="view-why"'))
  const h1 = act.indexOf("</h1>")
  // Active improvement-system alarms come first; then the plain status sentence.
  const afterAlarms = act.slice(act.indexOf("</section>", h1) + 10)
  assert.match(act.slice(h1 + 5).trimStart(), /^<section class="block improvement-alarms" id="improvement-alarms"/)
  assert.match(afterAlarms.trimStart(), /^<p id="improvement-status" class="lede improvement-status" role="status">/)
  const details = act.match(/<details class="how-to-read" id="improvement-limits">\s*<summary>How to read this list<\/summary>([\s\S]*?)<\/details>/)
  assert.ok(details, "one labeled disclosure holds the limits and the A3 explanation")
  for (const limit of [/not an execution queue/, /A route alone grants no claim or new authority/, /Inspection does not grant authority or create ownership/, /not a savings ranking/, /Automated triage is not demonstrated; ownership and private decisions are not published/, /not a task-filtered execution queue/, /<dfn>A3<\/dfn>/]) assert.match(details[1], limit)
  // No caveat paragraph stands between the status sentence and the list.
  assert.equal((act.slice(0, act.indexOf('id="improvement-limits"')).match(/<p /g) || []).length, 2, "step label and status sentence only")
  const fn = appSource().slice(appSource().indexOf("function renderPublicImprovements"), appSource().indexOf("async function renderAct"))
  assert.doesNotMatch(fn, /Inspection does not grant authority|Automated triage is not demonstrated|not a task-filtered execution queue/)
  // A failed data load replaces "Loading" with an explicit status.
  assert.match(appSource(), /status\.textContent = "The improvement status could not be loaded/)
})
