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
  assert.equal(F.navigationContext(improvement).selection, "gaps:3")
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
