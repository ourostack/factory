import assert from "node:assert/strict"
import { test } from "node:test"

import {
  EMPTY_SLOTS,
  STALE_AFTER_HOURS,
  buildHealth,
  intakeClass,
  lastBuildFromRuns,
} from "../../../site/scripts/health.mjs"

const HOUR = 3600 * 1000
const NOW = Date.parse("2026-10-05T12:00:00Z")

test("newest intake is a coarse class, never a timestamp", () => {
  assert.equal(intakeClass(NOW - 2 * HOUR, NOW), "under_1_day")
  assert.equal(intakeClass(NOW - 30 * HOUR, NOW), "1_to_3_days")
  assert.equal(intakeClass(NOW - 100 * HOUR, NOW), "3_to_7_days")
  assert.equal(intakeClass(NOW - 400 * HOUR, NOW), "over_7_days")
  assert.equal(intakeClass(null, NOW), null)
})

test("the last factory-build run is read from the API's run list", () => {
  assert.equal(lastBuildFromRuns({ workflow_runs: [{ conclusion: "success", html_url: "https://github.com/o/r/actions/runs/1" }] }).value, "success")
  assert.equal(lastBuildFromRuns({ workflow_runs: [{ conclusion: "failure" }] }).value, "failure")
  const skipped = lastBuildFromRuns({ workflow_runs: [{ conclusion: "skipped" }, { conclusion: "cancelled" }, { conclusion: "failure" }] })
  assert.equal(skipped.value, "failure")
  assert.equal(lastBuildFromRuns({ workflow_runs: [{ conclusion: "skipped" }] }).state, "unavailable")
  const none = lastBuildFromRuns({ workflow_runs: [] })
  assert.equal(none.state, "unavailable")
  assert.equal(lastBuildFromRuns(null).state, "unavailable")
})

const base = () => ({
  builtAt: new Date(NOW).toISOString(),
  factsByHost: { "claude-code": 248 },
  newestIntake: "under_1_day",
  lastBuild: { state: "measured", value: "success", reasons: [] },
  reportsReadable: true,
})

test("alive when the build is green and intake is recent", () => {
  const h = buildHealth(base())
  assert.equal(h.verdict.status, "alive")
  assert.ok(h.verdict.reason.length > 10)
})

test("broken when the last factory-build run failed", () => {
  const h = buildHealth({ ...base(), lastBuild: { state: "measured", value: "failure", reasons: [] } })
  assert.equal(h.verdict.status, "broken")
  assert.match(h.verdict.reason, /factory-build/)
})

test("broken when the reports could not be read", () => {
  assert.equal(buildHealth({ ...base(), reportsReadable: false }).verdict.status, "broken")
})

test("stale when no intake has landed for over a week", () => {
  assert.equal(buildHealth({ ...base(), newestIntake: "over_7_days" }).verdict.status, "stale")
})

test("an unreadable build status is unknown, never alive", () => {
  const h = buildHealth({ ...base(), lastBuild: { state: "unavailable", reasons: ["github_api_unavailable"] } })
  assert.equal(h.factory_build.state, "unavailable")
  assert.equal(h.verdict.status, "unknown")
  assert.match(h.verdict.reason, /could not be checked/)
  assert.equal(buildHealth({ ...base(), lastBuild: undefined }).verdict.status, "unknown")
})

test("precedence: broken over stale over unknown over alive", () => {
  const red = { state: "measured", value: "failure", reasons: [] }
  const unk = { state: "unavailable", reasons: ["x"] }
  assert.equal(buildHealth({ ...base(), lastBuild: red, newestIntake: "over_7_days" }).verdict.status, "broken")
  assert.equal(buildHealth({ ...base(), lastBuild: unk, newestIntake: "over_7_days" }).verdict.status, "stale")
  assert.equal(buildHealth({ ...base(), lastBuild: unk }).verdict.status, "unknown")
  assert.equal(buildHealth({ ...base(), reportsReadable: false, lastBuild: unk }).verdict.status, "broken")
  assert.equal(buildHealth({ ...base(), newestIntake: null }).verdict.status, "alive")
})

test("the health document has named empty slots that say not recorded yet", () => {
  const h = buildHealth(base())
  for (const k of ["capture_coverage", "open_improvement_items", "unsigned_deliveries"]) {
    assert.deepEqual(h.slots[k].reasons, ["not_recorded_yet"], k)
    assert.equal(h.slots[k].state, "unavailable")
  }
  assert.deepEqual(Object.keys(EMPTY_SLOTS).sort(), ["capture_coverage", "open_improvement_items", "unsigned_deliveries"])
  assert.equal(h.config.stale_after_hours, STALE_AFTER_HOURS)
  assert.equal(h.facts_by_host[0].host, "claude-code")
  assert.equal(h.facts_by_host[0].files.value, 248)
  assert.equal(h.last_data_build.value, base().builtAt)
})
