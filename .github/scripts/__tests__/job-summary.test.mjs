import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { compareJobs, jobSummary, partialQualifier } from "../../../site/scripts/job-summary.mjs"

test("jobSummary carries the censored flag", () => {
  const censored = jobSummary(
    { formulas: { lead_time_ms: { value: 8335518596, class: "measured", censored: true } } },
    "b2b5d3c9.json",
  )
  assert.equal(censored.lead_time_censored, true)
  assert.equal(censored.lead_time_ms, 8335518596)

  const measured = jobSummary(
    { formulas: { lead_time_ms: { value: 5, class: "measured" } } },
    "abc.json",
  )
  assert.equal(measured.lead_time_censored, false)
  assert.equal(measured.lead_time_ms, 5)
})

test("compareJobs puts measured before censored and null last", () => {
  const rows = [
    { id: "m10", lead_time_ms: 10, lead_time_censored: false },
    { id: "c1000", lead_time_ms: 1000, lead_time_censored: true },
    { id: "m50", lead_time_ms: 50, lead_time_censored: false },
    { id: "null", lead_time_ms: null, lead_time_censored: false },
  ]
  assert.deepEqual(rows.sort(compareJobs).map((r) => r.id), ["m50", "m10", "c1000", "null"])
})

test("compareJobs puts a censored row with a null lead time last", () => {
  const rows = [
    { id: "cnull", lead_time_ms: null, lead_time_censored: true },
    { id: "c5", lead_time_ms: 5, lead_time_censored: true },
    { id: "m1", lead_time_ms: 1, lead_time_censored: false },
  ]
  assert.deepEqual(rows.sort(compareJobs).map((r) => r.id), ["m1", "c5", "cnull"])
})

test("jobSummary flags time shared with other jobs", () => {
  const shared = jobSummary(
    {
      formulas: {
        active_time_ms: { value: 136759587, partial: true, partial_reasons: ["worker_shared"] },
        flow_efficiency: { value: 0.79, partial: true, partial_reasons: ["worker_split", "worker_shared"] },
      },
    },
    "a.json",
  )
  assert.equal(shared.active_time_shared, true)
  assert.equal(shared.flow_efficiency_shared, true)
  const split = jobSummary(
    { formulas: { active_time_ms: { value: 5, partial: true, partial_reasons: ["worker_split"] }, flow_efficiency: { value: 0.5 } } },
    "b.json",
  )
  assert.equal(split.active_time_shared, false)
  assert.equal(split.flow_efficiency_shared, false)
  assert.equal(jobSummary({}, "c.json").active_time_shared, false)
})

test("jobSummary flags pull requests withheld from shared workers", () => {
  const shared = jobSummary(
    { formulas: { references: { value: { public_prs: 0 }, partial: true, partial_reasons: ["worker_shared"] } } },
    "a.json",
  )
  assert.equal(shared.public_prs, 0)
  assert.equal(shared.public_prs_shared, true)
  const plain = jobSummary({ formulas: { references: { value: { public_prs: 3 } } } }, "b.json")
  assert.equal(plain.public_prs_shared, false)
})

test("partial count measures carry their qualifier", () => {
  const d = {
    formulas: {
      rework_signals: {
        tool_failures: { class: "inferred", partial: true, partial_reasons: ["worker_split"], value: 21 },
        tool_retries: { class: "inferred", value: 3 },
      },
      references: { class: "measured", partial: true, partial_reasons: ["worker_shared"], value: { public_prs: 2 } },
    },
  }
  const s = jobSummary(d, "x.json")
  assert.equal(s.tool_failures, 21)
  assert.equal(s.tool_failures_partial, "split")
  assert.equal(s.tool_retries_partial, null)
  assert.equal(s.public_prs_partial, "shared")
  assert.equal(partialQualifier({ partial: true, uncovered_sessions: 1 }), "partial")
  assert.equal(partialQualifier({ partial: true, partial_reasons: ["worker_split", "worker_shared"] }), "split, shared")
  assert.equal(partialQualifier(undefined), null)
})

test("the jobs table renders partial counts with their qualifier, never bare", () => {
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")
  assert.match(app, /fmtCount\(j\.tool_failures, j\.tool_failures_partial\)/)
  assert.match(app, /fmtCount\(j\.tool_retries, j\.tool_retries_partial\)/)
  assert.match(app, /fmtCount\(j\.public_prs, j\.public_prs_partial\)/)
})
