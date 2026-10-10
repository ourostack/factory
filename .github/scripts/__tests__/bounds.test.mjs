import assert from "node:assert/strict"
import { test } from "node:test"

import { DIRECTIONS, direct, directionOf } from "../../../site/scripts/bounds.mjs"
import { measured, partial, rollup, unavailable } from "../../../site/scripts/state.mjs"
import { jobSummary } from "../../../site/scripts/job-summary.mjs"

const p = (reasons, value = 5) => partial(value, reasons)

test("a measure with no row in the direction table cannot be made partial: the build stops", () => {
  assert.throws(() => direct(p(["capped"]), "a_new_measure"), /no bound direction/)
  // A measured or unavailable number needs no direction, but the measure must still be known.
  assert.throws(() => direct(measured(1), "a_new_measure"), /no bound direction/)
})

test("every row in the table names a known rule", () => {
  for (const [measure, rule] of Object.entries(DIRECTIONS)) {
    assert.ok(["lower", "upper", "unknown", "from_reasons", "lower_if_censored", "upper_if_awaiting", "finish_date", "from_members", "producer_clock"].includes(rule), measure)
  }
})

test("lifecycle clock directions belong to Desk, including opposing bounds; they are never recomputed from reasons", () => {
  for (const measure of ["request_to_delivery_ms", "queue_ms", "production_ms", "active_in_production_ms", "production_remainder_ms"]) {
    const clock = { class: "measured", state: "partial", value: 4, reasons: ["log_truncated"], basis: ["recorded_activity"], bound: null, bound_reason: "bound_reasons_conflict", so_far: false }
    assert.deepEqual(direct(clock, measure), clock)
    assert.throws(() => directionOf(measure, clock.reasons), /producer/)
    const missing = { ...clock }
    delete missing.bound
    assert.throws(() => direct(missing, measure), /clock/i)
  }
})

test("waits are lower bounds: a session that is not seen can only add wait", () => {
  for (const m of ["human_wait_ms", "permission_wait_ms", "api_retry_ms", "compaction_ms"]) {
    assert.equal(direct(p(["host_records_partly"]), m).bound, "lower", m)
    assert.equal(direct(p(["job_offsets"]), m).bound, "lower", m)
  }
})

test("the queue before the first session is an upper bound: a session whose start was lost could be earlier", () => {
  assert.equal(direct(p(["job_offsets"]), "queue_before_start_ms").bound, "upper")
})

test("counts and times: missing data is a lower bound, a shared worker an upper bound, both together no direction", () => {
  for (const m of ["active_time_ms", "tool_failures", "session_retouches", "public_prs", "tokens_total"]) {
    assert.equal(direct(p(["log_truncated"]), m).bound, "lower", m)
    assert.equal(direct(p(["worker_split"]), m).bound, "lower", m)
    assert.equal(direct(p(["worker_shared"]), m).bound, "upper", m)
    assert.equal(direct(p(["log_truncated", "worker_shared"]), m).bound, "unknown", m)
  }
})

test("ratios, medians and shares have no direction", () => {
  for (const m of ["flow_efficiency", "median", "p75", "share", "rate"]) assert.equal(direct(p(["log_truncated"]), m).bound, "unknown", m)
})

test("a lead time is a lower bound only when the job is still open", () => {
  assert.equal(direct(p(["censored"]), "lead_time_ms").bound, "lower")
  assert.equal(direct(p(["censored", "worker_shared"]), "lead_time_ms").bound, "unknown")
  // Desk raised the lead time to the span of the job's recorded work: the true figure is at least that.
  assert.equal(direct(p(["card_dates_shorter_than_work"]), "lead_time_ms").bound, "lower")
  assert.equal(direct(p(["card_dates_shorter_than_work", "censored"]), "lead_time_ms").bound, "lower")
  assert.equal(direct(p(["card_dates_shorter_than_work", "worker_shared"]), "lead_time_ms").bound, "unknown")
})

test("a number that is not partial carries no bound", () => {
  assert.equal("bound" in direct(measured(1), "tool_failures"), false)
  assert.equal("bound" in direct(unavailable(["capped"]), "tool_failures"), false)
})

test("a rollup needs its measure, and a partial sum is a lower bound while a partial median has none", () => {
  const members = [measured(1), unavailable(["capped"])]
  assert.throws(() => rollup(members, { of: "jobs", reduce: (v) => v[0] }), /no bound direction/)
  assert.equal(rollup(members, { of: "jobs", reduce: (v) => v[0], measure: "sum" }).bound, "lower")
  assert.equal(rollup(members, { of: "jobs", reduce: (v) => v[0], measure: "median" }).bound, "unknown")
})

test("every partial measure a job summary or job page shows carries a direction", () => {
  const f = (reasons) => ({ class: "measured", partial: true, partial_reasons: reasons, reasons, state: "partial", value: 3 })
  const s = jobSummary({
    formulas: {
      queue_before_start_ms: f(["job_offsets"]),
      waits: { human_wait_ms: f(["job_offsets"]), permission_wait_ms: f(["job_offsets"]), api_retry_ms: f(["host_records_partly"]), compaction_ms: f(["job_offsets"]) },
      flow_efficiency: f(["log_truncated"]),
      rework_signals: { session_retouches: f(["log_truncated"]) },
    },
  }, "j.json")
  for (const d of s.details) if (d.number.state === "partial") assert.ok(["lower", "upper", "unknown"].includes(d.number.bound), d.key)
  for (const k of ["queue_before_start_ms", "human_wait_ms", "api_retry_ms", "flow_efficiency"]) assert.ok(s[k].bound, k)
})

test("a first pass that only awaits a sign-off is an upper bound; with lost returns too, its direction is unknown", () => {
  assert.equal(directionOf("first_pass_yield", ["awaiting_signoff"]), "upper")
  assert.equal(directionOf("first_pass_yield", ["awaiting_signoff", "returns_not_fully_recorded"]), "unknown")
  assert.equal(directionOf("returns", ["returns_not_fully_recorded"]), "lower")
})
