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
  for (const limit of [/not an execution queue/, /A route alone grants no claim or new authority/, /Inspection does not grant authority or create ownership/, /not a savings ranking/, /<span id="improvement-triage-note">No triage review is published in this build\.<\/span> Ownership and private decisions are not published/, /not a task-filtered execution queue/, /<dfn>A3<\/dfn>/]) assert.match(details[1], limit)
  // No caveat paragraph stands between the status sentence and the list.
  assert.equal((act.slice(0, act.indexOf('id="improvement-limits"')).match(/<p /g) || []).length, 2, "step label and status sentence only")
  const fn = appSource().slice(appSource().indexOf("function renderPublicImprovements"), appSource().indexOf("async function renderAct"))
  assert.doesNotMatch(fn, /Inspection does not grant authority|Automated triage is not demonstrated|not a task-filtered execution queue/)
  // A failed data load replaces "Loading" with an explicit status.
  assert.match(appSource(), /status\.textContent = "The improvement status could not be loaded/)
})

// ---- Published triage on Improvements (plan Task 12F) ----
const HOUR = 3600000
const T0 = Date.parse("2026-10-10T12:00:00Z")
let batchSerial = 0
const publish = (rows, { coverage = {}, runner = {}, hoursAgo = 1 } = {}) => {
  const value = { ...structuredClone(fixture.public), batch: (++batchSerial).toString(16).padStart(16, "0"), rows, coverage: { ...fixture.public.coverage, ...coverage }, runner: { ...fixture.public.runner, ...runner } }
  return { path: `triage/${value.batch}.json`, bytes: JSON.stringify(value) + "\n", committedAtMs: T0 - hoursAgo * HOUR }
}
const fixtureRow = (over = {}) => ({ ...structuredClone(fixture.public.rows[0]), ...over })
const published = (...batches) => {
  const q = deriveImprovementQueue({ batches, now: T0 })
  assert.deepEqual(validateImprovementQueue(q), { ok: true, codes: [] })
  return q
}
const hex = (c) => c.repeat(32)

test("a_row_whose_evidence_names_a_job_report_is_drawn", () => {
  const job = { kind: "job", ref: `https://github.com/example/project/blob/reports/jobs/${hex("a")}.md`, revision: 1 }
  const issue = { kind: "issue", ref: "https://github.com/example/project/issues/1", revision: 1 }
  const pr = { kind: "pr", ref: "https://github.com/example/project/pull/2", revision: 3 }
  for (const pointers of [[job], [issue], [pr], [job, issue, pr]]) {
    const q = published(publish([fixtureRow({ evidence: pointers, basis: { ...fixture.public.rows[0].basis, evidence_revisions: pointers } })]))
    assert.equal(q.state, "reviewed")
    const p = S.improvementPresentation(q.rows[0])
    assert.ok(p, JSON.stringify(pointers.map((x) => x.kind)))
    assert.deepEqual(p.handoff.basis.evidence_revisions, pointers)
    // v1.2 verifies no public context: the row carries no link.
    assert.equal(p.availability, "private_detail_not_published")
    assert.deepEqual(p.context, [])
  }
  // A pointer that is not the transport's shape still refuses the row.
  const good = published(publish([fixtureRow()])).rows[0]
  for (const ref of [hex("a"), `https://github.com/example/project/blob/main/jobs/${hex("a")}.md`, `https://example.com/example/project/blob/reports/jobs/${hex("a")}.md`, `https://github.com/example/project/blob/reports/jobs/${hex("a")}.md?x=1`]) {
    const bad = structuredClone(good)
    bad.handoff.basis.evidence_revisions = [{ kind: "job", ref, revision: 1 }]
    assert.equal(S.improvementPresentation(bad), null, ref)
  }
})

test("coverage_says_what_one_machine_counted_and_never_sums", () => {
  const known = published(publish([fixtureRow()], { coverage: { reviewed: 12, unreviewed: 3, refused: 1, deferred: 2, more_unreviewed: true } }))
  assert.deepEqual(S.triageCoverageWords(known), [
    "Triage on the publishing machine has reviewed 12 improvement cards; it also counts 3 not yet reviewed, 1 whose review was refused, 2 put off to a later run.",
    "More cards are waiting than this count shows.",
    "This is one machine's count from its last complete scan, published in the last 72 hours; it is not a count of every desk.",
  ])
  const one = published(publish([fixtureRow()]))
  assert.equal(S.triageCoverageWords(one)[0], "Triage on the publishing machine has reviewed 1 improvement card; it counts none waiting, refused or put off.")
  assert.equal(S.triageCoverageWords(one).length, 2)
  // An empty publication with a known count is still a count.
  const empty = published(publish([], { coverage: { reviewed: 0, unreviewed: 4 } }))
  assert.equal(empty.rows.length, 0)
  assert.equal(S.triageCoverageWords(empty)[0], "Triage on the publishing machine has reviewed 0 improvement cards; it also counts 4 not yet reviewed.")
  // Unknown coverage says why as far as the queue tells, and never a number.
  const never = published(publish([], { coverage: { reviewed: 0, unreviewed: null, refused: null, deferred: null, more_unreviewed: null }, runner: { state: "no_agent_cli", last_success_age: "never" } }))
  assert.deepEqual(S.triageCoverageWords(never), [
    "How many improvement cards triage has covered is not known: the publishing machine's last scan was incomplete, it has not yet recorded every count, or its newest publications give different counts.",
    "A review listed here is therefore not shown as current, and an empty list does not mean nothing is waiting.",
  ])
  const two = published(publish([fixtureRow()], { coverage: { reviewed: 5 } }), publish([fixtureRow({ id: hex("1") })], { coverage: { generation: hex("f"), reviewed: 7 } }))
  assert.equal(two.coverage.state, "unknown")
  assert.match(S.triageCoverageWords(two)[0], /is not known: no single machine published in the last 72 hours \(none did, or more than one did, and their counts are never added together\)\.$/)
  assert.doesNotMatch(S.triageCoverageWords(two).join(" "), /\d+ improvement cards?|12/)
  const quiet = published(publish([fixtureRow()], { hoursAgo: 73 }))
  assert.match(S.triageCoverageWords(quiet)[0], /no single machine published in the last 72 hours/)
  const invalid = deriveImprovementQueue({ batches: [publish([fixtureRow()]), { path: "triage/0000000000000000.json", bytes: "bad", committedAtMs: T0 }], now: T0 })
  assert.match(S.triageCoverageWords(invalid)[0], /is not known: a published triage file could not be read\.$/)
  const unreadable = deriveImprovementQueue({ batches: null, now: T0 })
  assert.match(S.triageCoverageWords({ ...unreadable, state: "unknown" })[0], /is not known: the published triage files could not be read\.$/)
  // Reviews counted but none published: the status sentence does not say "none reviewed".
  const countedOnly = published(publish([], { coverage: { reviewed: 3 } }))
  assert.equal(countedOnly.state, "not_reviewed")
  const status = S.improvementStatus({ queue: countedOnly, issues: 0, issuesVerified: true })
  assert.match(status, /^Triage reports reviews, but none is published that this build can show; /)
  assert.doesNotMatch(status, /no improvement has been reviewed/)
  assert.match(S.improvementStatus({ queue: published(), issues: 0, issuesVerified: true }), /^Not reviewed yet: no improvement has been reviewed by triage; /)
  // Nothing published: the status sentence already says so.
  assert.deepEqual(S.triageCoverageWords(deriveImprovementQueue({ batches: [], now: T0 })), [])
  for (const bad of [null, undefined, {}, { schema: "factory-improvements/1" }, { schema: "other", coverage: known.coverage }]) assert.deepEqual(S.triageCoverageWords(bad), [])
  // A count that is not a whole number is never printed.
  assert.match(S.triageCoverageWords({ ...known, coverage: { ...known.coverage, refused: -1 } })[0], /is not known/)
})

test("runner_words_say_when_it_last_succeeded_and_why_it_cannot_run", async () => {
  const { TRIAGE_RUNNER_STATES } = await import("../triage-values.mjs")
  const said = (runner) => S.triageRunnerWords(published(publish([fixtureRow()], { runner })))
  assert.equal(said({}), "The triage runner on the publishing machine ran. Its last successful run was within the last day. Both are that machine's own report, as of its last publication.")
  assert.equal(said({ state: "no_agent_cli", last_success_age: "never" }), "The triage runner on the publishing machine cannot run: no agent command is installed on that machine. It has never completed a run. Both are that machine's own report, as of its last publication.")
  assert.equal(said({ state: "ran", last_success_age: "never" }), "The triage runner on the publishing machine reports that it ran, but it has no successful run on record. Both are that machine's own report, as of its last publication.")
  assert.match(said({ state: "disabled_would_bill", last_success_age: "stale" }), /is switched off: a run would be billed per token\. Its last successful run was more than three days ago\./)
  assert.match(said({ state: "timeout", last_success_age: "aging" }), /timed out on its last run\. Its last successful run was between one and three days ago\./)
  assert.match(said({ state: "failed", last_success_age: "unknown" }), /failed on its last run\. When it last succeeded is not recorded\./)
  // Every state Desk can publish has words, and none is a raw code.
  const seen = new Set()
  for (const state of TRIAGE_RUNNER_STATES) {
    const words = said({ state, last_success_age: "recent" })
    assert.equal(typeof words, "string", state)
    assert.doesNotMatch(words, /_/, state)
    seen.add(words)
  }
  assert.equal(seen.size, TRIAGE_RUNNER_STATES.length)
  // Unknown runner, or anything that is not the queue, says nothing.
  assert.equal(S.triageRunnerWords(deriveImprovementQueue({ batches: [], now: T0 })), null)
  assert.equal(S.triageRunnerWords(published(publish([fixtureRow()], { hoursAgo: 73 }))), null)
  for (const bad of [null, {}, { schema: "factory-improvements/1", runner: { state: "sleeping", last_success_age: "recent" } }, { schema: "factory-improvements/1", runner: { state: "ran", last_success_age: "yesterday" } }]) assert.equal(S.triageRunnerWords(bad), null)
})

test("row_facts_name_source_review_state_and_route_without_creating_a_claim", () => {
  const facts = (over, ...more) => {
    const q = published(publish([fixtureRow(over)]), ...more)
    return Object.fromEntries(S.improvementFacts(S.improvementPresentation(q.rows.find((r) => r.id === fixture.public.rows[0].id))).map((f) => [f.label, f.text]))
  }
  assert.deepEqual(facts({}), {
    "Raised by": "the waste evaluator",
    "Review": "Reviewed and published within the last 72 hours",
    "Proposed route": "a decision outside existing authority is needed from its owner (gate: intent)",
  })
  assert.equal(facts({ route: "agent_ready", gate: null, source: "andon" })["Proposed route"], "an agent can take the next step under existing authority; the engineering workflow's gates still apply")
  assert.equal(facts({ route: "agent_ready", gate: null, source: "andon" })["Raised by"], "an andon alarm")
  assert.equal(facts({ route: "investigate", gate: null })["Proposed route"], "a fact or cause is still to be established by inspection or a bounded experiment")
  // A stale review keeps its last route for context, and says it cannot support action.
  const stale = facts({ state: "stale", age: "stale" })
  assert.equal(stale.Review, "Stale: its evidence changed or it was not published again within 72 hours")
  assert.equal(stale["Last proposed route"], "a decision outside existing authority is needed from its owner (gate: intent); it cannot support action now")
  assert.equal(stale["Proposed route"], undefined)
  const withdrawn = facts({ revision: 2, state: "withdrawn", route: null, gate: null })
  assert.equal(withdrawn.Review, "Withdrawn: its card changed or was removed, so this review no longer applies")
  assert.equal(withdrawn["Proposed route"], "none")
  const conflict = facts({}, publish([fixtureRow({ route: "investigate", gate: null })]))
  assert.equal(conflict.Review, "In conflict: publications disagree about this review, or another review names the same public issue, so it is not used")
  assert.match(conflict["Last proposed route"], /it cannot support action now$/)
  const unknown = facts({}, publish([], { coverage: { generation: hex("f") } }))
  assert.match(unknown.Review, /^Not current: its source could not be read completely, or the queue's coverage is unknown/)
  // Every source the transport allows has a label; no fact claims ownership.
  for (const source of ["andon", "friction_candidate", "reconcile_class", "desk_problem", "store_build", "evaluator", "loop_alarm", "flush_health"]) {
    const f = facts({ source })
    assert.ok(f["Raised by"] && !/_/.test(f["Raised by"]), source)
    assert.doesNotMatch(Object.values(f).join(" "), /claimed|owned by|assigned|working on/i)
  }
  assert.deepEqual(S.improvementFacts(null), [])
})

test("related_and_duplicate_rows_are_named_by_their_place_on_the_page", () => {
  const A = fixture.public.rows[0].id, B = hex("b"), C = hex("c"), GONE = hex("d")
  const q = published(publish([
    fixtureRow({ related_ids: [B, GONE], duplicate_ids: [C] }),
    fixtureRow({ id: B, route: "agent_ready", gate: null, related_ids: [A] }),
    fixtureRow({ id: C, route: "investigate", gate: null, duplicate_ids: [A, A] }),
  ], { coverage: { reviewed: 3 } }))
  const rows = q.rows.map(S.improvementPresentation)
  assert.ok(rows.every(Boolean))
  const links = S.improvementLinks(rows)
  assert.deepEqual(links.map((l) => [l.n, l.of]), [[1, 3], [2, 3], [3, 3]])
  const at = Object.fromEntries(links.map((l) => [l.id, l]))
  const n = (id) => at[id].n
  assert.equal(at[A].related, `Related, not shown to be the same problem: improvement ${n(B)} on this page and 1 not listed on this page.`)
  assert.equal(at[A].duplicates, `Suggested duplicate, sharing evidence; nothing is merged or closed: improvement ${n(C)} on this page.`)
  assert.equal(at[B].related, `Related, not shown to be the same problem: improvement ${n(A)} on this page.`)
  assert.equal(at[B].duplicates, null)
  assert.equal(at[C].duplicates, `Suggested duplicate, sharing evidence; nothing is merged or closed: improvement ${n(A)} on this page.`)
  // A row never names itself, and a malformed id is dropped.
  const self = S.improvementPresentation({ ...q.rows[0], related_ids: [A, "not-an-id", B] })
  assert.deepEqual(self.related_ids, [B])
  assert.deepEqual(S.improvementLinks([]), [])
  assert.deepEqual(S.improvementLinks(null), [])
})

test("withdrawn_reviews_are_counted_apart_and_the_triage_note_follows_the_data", () => {
  const q = published(publish([
    fixtureRow({ revision: 2, state: "withdrawn", route: null, gate: null }),
    fixtureRow({ id: hex("b"), route: "agent_ready", gate: null }),
    fixtureRow({ id: hex("c"), state: "stale", age: "stale" }),
  ], { coverage: { reviewed: 2 } }))
  assert.equal(S.improvementStatus({ queue: q, issues: 2, issuesVerified: true }),
    "3 reviewed improvements are listed first, those needing a refresh first (1 stale), with 1 withdrawn review last; 2 published improvement issues follow under Problems in hand.")
  const only = published(publish([fixtureRow({ revision: 2, state: "withdrawn", route: null, gate: null }), fixtureRow({ id: hex("b"), route: "agent_ready", gate: null })], { coverage: { reviewed: 1 } }))
  assert.equal(S.improvementStatus({ queue: only, issues: 0, issuesVerified: true }),
    "2 reviewed improvements are listed first with 1 withdrawn review last; no improvement issue has been published yet.")
  // A review that is not current because coverage is unknown is not called stale.
  const two = published(publish([fixtureRow()]), publish([fixtureRow({ id: hex("b"), route: "agent_ready", gate: null })], { coverage: { generation: hex("f") } }))
  assert.equal(S.improvementStatus({ queue: two, issues: 1, issuesVerified: true }),
    "2 reviewed improvements are listed first, those needing a refresh first (2 not current); 1 published improvement issue follows under Problems in hand.")
  // The page gives a withdrawn review no route, gate or prompt.
  assert.match(appSource(), /if \(p\.state === "withdrawn" && !p\.conflict\) \{[\s\S]{0,400}A later publication withdrew this review\.[^"]*"\)\);\s*node\.appendChild\(item\);\s*return;/)
  assert.equal(S.triagePublished(q), true)
  assert.equal(S.triageNote(q), "Triage reviews from Desk are published in this build; Improvements says what they cover and how current they are.")
  const none = deriveImprovementQueue({ batches: [], now: T0 })
  assert.equal(S.triagePublished(none), false)
  assert.equal(S.triageNote(none), "No triage review is published in this build.")
  assert.equal(S.triageNote(null), "No triage review is published in this build.")
  // The page's static words before data loads are the "none published" words.
  const page = html()
  assert.match(page, /<span id="overview-triage-note">No triage review is published in this build\.<\/span>/)
  assert.match(page, /<span id="improvement-triage-note">No triage review is published in this build\.<\/span>/)
  assert.doesNotMatch(page, /triage is not demonstrated/i)
  const app = appSource()
  const fn = app.slice(app.indexOf("function renderPublicImprovements"), app.indexOf("// The improvement system's own alarms lead Improvements"))
  assert.match(fn, /S\.triageCoverageWords\(queue\), S\.triageRunnerWords\(queue\)/)
  assert.match(fn, /`Improvement \$\{links\[i\]\.n\} of \$\{links\[i\]\.of\}: \$\{kind\}`/)
  assert.match(fn, /S\.improvementFacts\(p\)/)
  assert.match(app, /triageNote\.textContent = S\.triageNote\(data\.improvements\)/)
})
