import assert from "node:assert/strict"
import { test } from "node:test"

import { compareJobs, jobSummary, scopeMember } from "../../../site/scripts/job-summary.mjs"

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
  // A ratio has no direction (bounds.mjs).
  assert.equal(s.flow_efficiency.bound, "unknown")
  // A split session's share is left out: a lower bound.
  const split = jobSummary({ formulas: { active_time_ms: { value: 5, partial: true, partial_reasons: ["worker_split"] } } }, "b.json")
  assert.equal(split.active_time_ms.bound, "lower")
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
  // A shared worker's pull requests are counted for each job: an upper bound.
  assert.equal(s.public_prs.bound, "upper")
})

test("job ids and status stay plain labels", () => {
  const s = jobSummary({ job: "abc123", formulas: { status: { class: "declared", value: "done" } } }, "f.json")
  assert.equal(s.id, "abc123")
  assert.equal(s.status, "done")
})

const job = (over) => ({
  status: "done",
  queue_before_start_ms: { state: "measured", value: 0, reasons: [] },
  active_time_ms: { state: "measured", value: 5, reasons: [] },
  ...over,
})

test("scope: only a job genuinely outside capture is out of scope; lost data keeps its own reason", () => {
  assert.equal(scopeMember(job(), "active_time_ms").value, 5)
  assert.deepEqual(scopeMember(job({ status: "processing" }), "active_time_ms").reasons, ["outside_capture_scope"])
  assert.deepEqual(scopeMember(job({ status: "cancelled" }), "active_time_ms").reasons, ["outside_capture_scope"])
  assert.deepEqual(
    scopeMember(job({ queue_before_start_ms: { state: "measured", value: 9, reasons: [] } }), "active_time_ms").reasons,
    ["outside_capture_scope"],
  )
  assert.deepEqual(scopeMember(job({ status: "unavailable" }), "active_time_ms").reasons, ["status_unavailable"])
  assert.deepEqual(
    scopeMember(job({ queue_before_start_ms: { state: "unavailable", reasons: ["job_offsets_unavailable"] } }), "active_time_ms").reasons,
    ["job_offsets_unavailable"],
  )
})

// --- the per-job report with state and reasons (Desk contract section 2) ---

const v2 = {
  job: "j2",
  formulas: {
    status: { class: "declared", reasons: [], state: "measured", value: "done" },
    active_time_ms: { class: "measured", partial: true, partial_reasons: ["worker_shared", "log_truncated"], reasons: ["log_truncated", "worker_shared"], state: "partial", value: 88 },
    waits: {
      human_wait_ms: { class: "measured", reasons: [], state: "measured", value: 0 },
      permission_wait_ms: { class: "unavailable", reason: "host_does_not_record", reasons: ["host_does_not_record"], state: "unavailable", value: null },
      api_retry_ms: { class: "measured", partial: true, partial_reasons: ["host_records_partly"], reasons: ["host_records_partly"], state: "partial", value: 30 },
      compaction_ms: { class: "unavailable", reason: "host_does_not_record", reasons: ["host_does_not_record"], state: "unavailable", value: null },
    },
    references: {
      class: "measured",
      partial: true,
      partial_reasons: ["host_does_not_record", "host_records_partly"],
      reasons: ["host_does_not_record", "host_records_partly"],
      state: "partial",
      value: { public_prs: 2, public_commits: null, private_prs: 0, private_commits: null },
      parts: {
        public_prs: { class: "measured", partial: true, partial_reasons: ["host_records_partly"], reasons: ["host_records_partly"], state: "partial", value: 2 },
        public_commits: { class: "unavailable", reason: "host_does_not_record", reasons: ["host_does_not_record"], state: "unavailable", value: null },
        private_prs: { class: "measured", partial: true, partial_reasons: ["host_records_partly"], reasons: ["host_records_partly"], state: "partial", value: 0 },
        private_commits: { class: "unavailable", reason: "host_does_not_record", reasons: ["host_does_not_record"], state: "unavailable", value: null },
      },
    },
    tokens_total: {
      total: { class: "measured", reasons: [], state: "measured", value: 300 },
      input: { class: "measured", reasons: [], state: "measured", value: 100 },
      output: { class: "measured", reasons: [], state: "measured", value: 200 },
      cache_read: { class: "measured", partial: true, partial_reasons: ["worker_split"], reasons: ["worker_split"], state: "partial", value: 5 },
      cache_write: { class: "measured", reasons: [], state: "measured", value: 0 },
      reasoning: { class: "unavailable", reason: "host_does_not_record", reasons: ["host_does_not_record"], state: "unavailable", value: null },
    },
    rework_signals: {
      api_retries: { class: "inferred", partial: true, partial_reasons: ["host_records_partly"], reasons: ["host_records_partly"], state: "partial", value: 0 },
      session_retouches: { basis: "captured_sessions", class: "inferred", reasons: [], state: "measured", value: 1 },
    },
  },
}

test("public pull requests come from the references part, with its own state", () => {
  const s = jobSummary(v2, "j2.json")
  assert.deepEqual(s.public_prs, { state: "partial", value: 2, reasons: ["host_records_partly"], bound: "lower" })
})

test("a time partial for missing data and for a shared worker has no direction: the two pull opposite ways", () => {
  const s = jobSummary(v2, "j2.json")
  assert.equal(s.active_time_ms.state, "partial")
  assert.deepEqual(s.active_time_ms.reasons, ["log_truncated", "worker_shared"])
  assert.equal(s.active_time_ms.bound, "unknown")
})

test("the job page lists every measure with its state: measured, partial and no data", () => {
  const s = jobSummary(v2, "j2.json")
  const by = Object.fromEntries(s.details.map((d) => [d.key, d]))
  assert.deepEqual(by.human_wait_ms.number, { state: "measured", value: 0, reasons: [] })
  assert.equal(by.api_retry_ms.number.state, "partial")
  assert.deepEqual(by.permission_wait_ms.number, { state: "unavailable", reasons: ["host_does_not_record"] })
  assert.deepEqual(by.compaction_ms.number, { state: "unavailable", reasons: ["host_does_not_record"] })
  assert.deepEqual(by.public_commits.number, { state: "unavailable", reasons: ["host_does_not_record"] })
  assert.equal(by.private_prs.number.value, 0)
  assert.equal(by.private_prs.number.state, "partial")
  assert.deepEqual(by.tokens_total.number, { state: "measured", value: 300, reasons: [] })
  assert.deepEqual(by.tokens_reasoning.number, { state: "unavailable", reasons: ["host_does_not_record"] })
  assert.equal(by.tokens_cache_read.number.state, "partial")
  assert.equal(by.api_retries.number.state, "partial")
  assert.equal(by.session_retouches.number.value, 1)
  for (const d of s.details) {
    assert.equal(typeof d.label, "string", d.key)
    assert.ok(["duration", "count", "compact", "pct"].includes(d.kind), d.key)
  }
})

test("an older report without parts or tokens never shows a commit or token zero", () => {
  const s = jobSummary(
    { formulas: { references: { class: "measured", value: { public_prs: 1, public_commits: 0, private_prs: 0, private_commits: 0 } } } },
    "old.json",
  )
  const by = Object.fromEntries(s.details.map((d) => [d.key, d]))
  assert.equal(s.public_prs.value, 1)
  for (const k of ["public_commits", "private_commits", "private_prs", "tokens_total", "tokens_reasoning", "permission_wait_ms", "compaction_ms"]) {
    assert.deepEqual(by[k].number, { state: "unavailable", reasons: ["not_recorded"] }, k)
  }
})
