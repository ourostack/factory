import assert from "node:assert/strict"
import { test } from "node:test"

import { outcomesSummary, waitWords } from "../../../site/scripts/outcomes.mjs"
import { jobSummary } from "../../../site/scripts/job-summary.mjs"
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"

// rollups/outcomes.json as Desk's pipeline builds it (pipeline/outcomes.js).
const waits = (o = {}) => ({ lt_1h: 0, lt_1d: 0, lt_7d: 0, ge_7d: 0, ...o })
const signoff = (o = {}) => ({
  recorded: true,
  jobs: 6,
  accepted: 2,
  accepted_unverified: 1,
  delivered_unsigned: 1,
  refused: 1,
  refused_unverified: 0,
  reopened: 0,
  not_recorded: 1,
  not_delivered: 0,
  no_record: 4,
  jobs_without_work_record: 0,
  refusal_reasons: { not_what_was_asked: 0, defect: 1, changed_ask: 0, incomplete: 0, other: 0 },
  waits: { signed: waits({ lt_1h: 2, lt_1d: 2 }), unsigned: waits({ lt_7d: 1 }) },
  ...o,
})
const yieldRollup = (o = {}) => ({
  state: "partial",
  value: 0.75,
  reasons: ["awaiting_signoff", "signoff_unverified"],
  n: 3,
  N: 4,
  passed: 3,
  returned: 1,
  awaiting_signoff: 1,
  signoff_unverified: 1,
  changed_ask_only: 0,
  excluded: [{ reason: "history_not_recorded", jobs: 4 }, { reason: "not_recorded", jobs: 1 }],
  ...o,
})
const rework = (o = {}) => ({
  state: "partial",
  reasons: ["history_not_recorded"],
  n: 5,
  N: 9,
  returns: {
    in_task: { agent_error: 1, changed_ask: 0, new_information: 0, external: 0 },
    at_review: { agent_error: 0, changed_ask: 1, new_information: 0, external: 0 },
    after_delivery: { agent_error: 1, changed_ask: 0, new_information: 0, external: 0 },
  },
  changed_ask: 1,
  reason_check: { state: "partial", compared: 1, disagree: 0, compared_verified: 1, reasons: ["history_not_recorded"] },
  defects: { state: "unavailable", reasons: ["no_labels"], n: 0, N: 3 },
  ...o,
})
const file = (o = {}) => ({ schema: "desk.factory.rollups/1", signoff: signoff(), first_pass_yield: yieldRollup(), rework: rework(), ...o })

const FIGURES = (s) => [
  ...Object.values(s.signoff),
  s.unsigned,
  s.oldest_unsigned_wait,
  s.first_pass_yield,
  s.rework.changed_ask,
  ...s.rework.returns.map((r) => r.total),
  s.attention.headline,
  s.attention.turns_per_accepted,
]

test("with no outcomes file every outcome figure is not recorded yet and none is zero", () => {
  const s = outcomesSummary(null)
  for (const f of FIGURES(s)) {
    assert.equal(f.state, "unavailable")
    assert.ok(!("value" in f))
    assert.deepEqual(f.reasons, ["not_recorded_yet"])
  }
  assert.deepEqual(checkNumbers({ outcomes: s }), [])
})

test("a store where no session published an outcomes key says sign-off is not published, never zero accepted", () => {
  const s = outcomesSummary(file({ signoff: { recorded: false } }))
  assert.equal(s.signoff.accepted.state, "unavailable")
  assert.deepEqual(s.signoff.accepted.reasons, ["signoff_not_published"])
  assert.equal(s.unsigned.state, "unavailable")
  assert.deepEqual(checkNumbers({ outcomes: s }), [])
})

test("sign-off counts are measured, and an unverified acceptance is apart from accepted", () => {
  const s = outcomesSummary(file())
  assert.equal(s.signoff.accepted.value, 2)
  assert.equal(s.signoff.accepted_unverified.value, 1)
  assert.equal(s.signoff.refused.value, 1)
  assert.equal(s.signoff.no_record.value, 4)
  assert.deepEqual(s.refusal_reasons.map((r) => [r.reason, r.jobs.value]), [["defect", 1]])
  assert.deepEqual(checkNumbers({ outcomes: s }), [])
})

test("unsigned deliveries count jobs with a sign-off record, with jobs that predate it out of scope", () => {
  const s = outcomesSummary(file())
  assert.equal(s.unsigned.value, 1)
  assert.equal(s.unsigned.state, "measured")
  assert.equal(s.unsigned.N, 5)
  assert.equal(s.unsigned.out_of_scope, 5)
  assert.equal(s.oldest_unsigned_wait.value, "waiting at least 1 day")
  const none = outcomesSummary(file({ signoff: signoff({ delivered_unsigned: 0, waits: { signed: waits(), unsigned: waits() } }) }))
  assert.equal(none.unsigned.value, 0)
  assert.deepEqual(none.oldest_unsigned_wait.reasons, ["none_unsigned"])
})

test("an awaiting-sign-off yield is an upper bound, with jobs that predate sign-off out of scope", () => {
  const y = outcomesSummary(file()).first_pass_yield
  assert.equal(y.state, "partial")
  assert.equal(y.value, 0.75)
  assert.equal(y.bound, "upper")
  assert.equal(y.n, 2)
  assert.equal(y.N, 4)
  assert.equal(y.out_of_scope, 5)
  const lost = outcomesSummary(file({ first_pass_yield: yieldRollup({ excluded: [{ reason: "returns_not_fully_recorded", jobs: 1 }] }) })).first_pass_yield
  assert.equal(lost.N, 5)
  assert.ok(lost.reasons.includes("returns_not_fully_recorded"))
  assert.equal(lost.bound, "unknown")
  const whole = outcomesSummary(file({ first_pass_yield: yieldRollup({ state: "measured", reasons: [], awaiting_signoff: 0, signoff_unverified: 0, excluded: [] }) })).first_pass_yield
  assert.equal(whole.state, "measured")
  assert.ok(!("bound" in whole))
})

test("a yield whose every job awaits sign-off still shows its upper bound with n of zero", () => {
  const y = outcomesSummary(file({ first_pass_yield: yieldRollup({ value: 1, reasons: ["awaiting_signoff"], n: 2, N: 2, passed: 2, returned: 0, awaiting_signoff: 2, signoff_unverified: 0, excluded: [] }) })).first_pass_yield
  assert.equal(y.n, 0)
  assert.equal(y.state, "partial")
  assert.deepEqual(checkNumbers({ outcomes: { first_pass_yield: y } }), [])
})

test("no delivered job is no data for yield, never zero", () => {
  const y = outcomesSummary(file({ first_pass_yield: { state: "unavailable", reasons: ["no_delivered_jobs"], n: 0, N: 0, passed: 0, returned: 0, awaiting_signoff: 0, signoff_unverified: 0, changed_ask_only: 0, excluded: [] } })).first_pass_yield
  assert.equal(y.state, "unavailable")
  assert.ok(!("value" in y))
  assert.deepEqual(y.reasons, ["no_delivered_jobs"])
})

test("rework returns by catch point keep Desk's n of N, and changed-ask returns are apart", () => {
  const r = outcomesSummary(file()).rework
  assert.deepEqual(r.returns.map((x) => [x.caught, x.total.value]), [["in_task", 1], ["at_review", 1], ["after_delivery", 1]])
  assert.equal(r.returns[0].total.n, 5)
  assert.equal(r.returns[0].total.N, 9)
  assert.equal(r.returns[0].total.bound, "lower")
  assert.equal(r.changed_ask.value, 1)
  assert.equal(r.reason_check.disagree.state, "measured")
  assert.equal(r.defects.in_task_ms.state, "unavailable")
  assert.deepEqual(r.defects.in_task_ms.reasons, ["no_labels"])
})

test("rework with no recorded history is no data", () => {
  const r = outcomesSummary(file({ rework: { state: "unavailable", reasons: ["history_not_recorded"], n: 0, N: 4, reason_check: { state: "unavailable", reasons: ["not_recorded"] }, defects: { state: "unavailable", reasons: ["no_finished_jobs"], n: 0, N: 0 } } })).rework
  for (const x of r.returns) assert.equal(x.total.state, "unavailable")
  assert.equal(r.changed_ask.state, "unavailable")
})

test("a disagreement counted over unverified refusals is a lower bound", () => {
  const r = outcomesSummary(file({ rework: rework({ reason_check: { state: "measured", compared: 3, disagree: 1, compared_verified: 1, reasons: [] } }) })).rework
  assert.equal(r.reason_check.disagree.state, "partial")
  assert.equal(r.reason_check.disagree.bound, "lower")
  assert.deepEqual(r.reason_check.disagree.reasons, ["refusal_unverified"])
})

test("a headline with no accepted outcomes keeps its reason and shows no value", () => {
  const s = outcomesSummary(file({ signoff: signoff({ accepted: 0 }) }))
  assert.equal(s.attention.headline.state, "unavailable")
  const withAttention = outcomesSummary(file({ signoff: signoff({ accepted: 0 }), attention: { headline: { state: "unavailable", reasons: ["no_accepted_outcomes"], n: 0, N: 0 } } }))
  assert.deepEqual(withAttention.attention.headline.reasons, ["no_accepted_outcomes"])
  assert.ok(!("value" in withAttention.attention.headline))
})

test("a headline over three accepted outcomes is a thin sample", () => {
  const s = outcomesSummary(file({ signoff: signoff({ accepted: 3 }), attention: { headline: { state: "measured", value: 600000, reasons: [], n: 3, N: 3 } } }))
  assert.equal(s.attention.headline.value, 600000)
  assert.equal(s.attention.trust.status, "thin_sample")
})

test("a job with no signoff formula reads not recorded in the jobs table, and its figures carry their state", () => {
  const legacy = jobSummary({ job: "j", formulas: { status: { class: "declared", value: "done" } } }, "j.json")
  assert.equal(legacy.signoff.state, "unavailable")
  assert.deepEqual(legacy.signoff.reasons, ["not_recorded"])
  const unsigned = jobSummary(
    {
      job: "k",
      formulas: {
        status: { class: "declared", value: "done" },
        signoff: { class: "declared", state: "measured", value: "delivered_unsigned", reasons: [], verified: null, reason: null, wait: { class: "lt_7d", censored: true } },
        first_pass_yield: { class: "declared", state: "partial", value: 1, reasons: ["awaiting_signoff"], partial: true, partial_reasons: ["awaiting_signoff"] },
        rework: { class: "declared", state: "measured", value: { in_task: 1, at_review: 0, after_delivery: 0 }, reasons: [] },
      },
    },
    "k.json",
  )
  assert.equal(unsigned.signoff.value, "delivered, not signed yet")
  assert.equal(unsigned.signoff_wait.value, "waiting at least 1 day")
  assert.equal(unsigned.first_pass.state, "partial")
  assert.equal(unsigned.first_pass.bound, "upper")
  assert.equal(unsigned.returns.value, 1)
  const acceptedUnverified = jobSummary(
    { job: "m", formulas: { signoff: { class: "declared", state: "measured", value: "accepted", reasons: [], verified: false, reason: null, wait: { class: "lt_1h", censored: false } } } },
    "m.json",
  )
  assert.equal(acceptedUnverified.signoff.value, "accepted, not witnessed")
  assert.equal(acceptedUnverified.signoff_wait.value, "signed within an hour")
  assert.deepEqual(checkNumbers({ jobs: [unsigned, legacy, acceptedUnverified] }), [])
})

test("a censored wait reads waiting at least its lower edge; a signed one reads its class", () => {
  assert.equal(waitWords({ class: "lt_1h", censored: true }), "waiting under an hour so far")
  assert.equal(waitWords({ class: "lt_1d", censored: true }), "waiting at least 1 hour")
  assert.equal(waitWords({ class: "ge_7d", censored: true }), "waiting at least 7 days")
  assert.equal(waitWords({ class: "lt_7d", censored: false }), "signed after 1 to 7 days")
  assert.equal(waitWords({ class: "made_up", censored: false }), null)
})
