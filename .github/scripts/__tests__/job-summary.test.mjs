import assert from "node:assert/strict"
import { test } from "node:test"

import { compareJobs, jobSummary } from "../../../site/scripts/job-summary.mjs"

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
