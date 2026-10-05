import assert from "node:assert/strict"
import { test } from "node:test"

import { compareJobs, jobSummary } from "../../../site/scripts/job-summary.mjs"

test("a censored lead time is a partial lower bound, a plain one is measured", () => {
  const censored = jobSummary(
    { formulas: { lead_time_ms: { value: 8335518596, class: "measured", censored: true } } },
    "b2b5d3c9.json",
  )
  assert.equal(censored.lead_time_ms.state, "partial")
  assert.equal(censored.lead_time_ms.bound, "lower")
  assert.equal(censored.lead_time_ms.value, 8335518596)

  const plain = jobSummary({ formulas: { lead_time_ms: { value: 5, class: "measured" } } }, "abc.json")
  assert.equal(plain.lead_time_ms.state, "measured")
  assert.equal("bound" in plain.lead_time_ms, false)
})

test("nothing in the summary defaults to zero or null: a missing formula is unavailable", () => {
  const s = jobSummary({}, "empty.json")
  for (const k of [
    "lead_time_ms",
    "active_time_ms",
    "flow_efficiency",
    "queue_before_start_ms",
    "human_wait_ms",
    "api_retry_ms",
    "tool_failures",
    "tool_retries",
    "sessions_bound",
    "public_prs",
  ]) {
    assert.equal(s[k].state, "unavailable", k)
    assert.deepEqual(s[k].reasons, ["not_recorded"], k)
    assert.equal("value" in s[k], false, k)
  }
  assert.equal(s.status, "unavailable")
})

test("a pipeline-unavailable formula keeps its reason", () => {
  const s = jobSummary({ formulas: { active_time_ms: { class: "unavailable", reason: "job_offsets_unavailable", value: null } } }, "a.json")
  assert.deepEqual(s.active_time_ms.reasons, ["job_offsets_unavailable"])
})

test("compareJobs puts measured before censored and unavailable last", () => {
  const mk = (id, lead) => ({ id, lead_time_ms: lead })
  const rows = [
    mk("m10", { state: "measured", value: 10, reasons: [] }),
    mk("c1000", { state: "partial", value: 1000, reasons: ["censored"], bound: "lower" }),
    mk("m50", { state: "measured", value: 50, reasons: [] }),
    mk("none", { state: "unavailable", reasons: ["x"] }),
  ]
  assert.deepEqual(rows.sort(compareJobs).map((r) => r.id), ["m50", "m10", "c1000", "none"])
})

test("time shared with other jobs is a partial upper bound", () => {
  const s = jobSummary(
    {
      formulas: {
        active_time_ms: { value: 136759587, partial: true, partial_reasons: ["worker_shared"] },
        flow_efficiency: { value: 0.79, partial: true, partial_reasons: ["worker_split", "worker_shared"] },
      },
    },
    "a.json",
  )
  assert.equal(s.active_time_ms.state, "partial")
  assert.equal(s.active_time_ms.bound, "upper")
  assert.deepEqual(s.flow_efficiency.reasons, ["worker_split", "worker_shared"])
  assert.equal(s.flow_efficiency.bound, "upper")
  const split = jobSummary({ formulas: { active_time_ms: { value: 5, partial: true, partial_reasons: ["worker_split"] } } }, "b.json")
  assert.equal("bound" in split.active_time_ms, false)
})

test("partial counts are lower bounds with their reasons; a zero is only a measured zero", () => {
  const d = {
    formulas: {
      rework_signals: {
        tool_failures: { class: "inferred", partial: true, partial_reasons: ["worker_split"], value: 21 },
        tool_retries: { class: "inferred", value: 0 },
      },
      references: { class: "measured", partial: true, partial_reasons: ["worker_shared"], value: { public_prs: 0 } },
    },
  }
  const s = jobSummary(d, "x.json")
  assert.deepEqual(s.tool_failures, { state: "partial", value: 21, reasons: ["worker_split"], bound: "lower" })
  assert.deepEqual(s.tool_retries, { state: "measured", value: 0, reasons: [] })
  assert.equal(s.public_prs.state, "partial")
  assert.equal(s.public_prs.value, 0)
  assert.equal(s.public_prs.bound, "lower")
})

test("job ids and status stay plain labels", () => {
  const s = jobSummary({ job: "abc123", formulas: { status: { class: "declared", value: "done" } } }, "f.json")
  assert.equal(s.id, "abc123")
  assert.equal(s.status, "done")
})
