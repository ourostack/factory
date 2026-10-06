import assert from "node:assert/strict"
import { test } from "node:test"

import { AGE_ALARM_DAYS, BLOCKING_HEADLESS, HEALTHY_RESTS_ON, LOOP_KEYS, QUIET_AFTER_HOURS, summarizeLoop } from "../../../site/scripts/loop-health.mjs"
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"

const HOUR = 3600 * 1000
const NOW = Date.parse("2026-10-05T12:00:00Z")
const host = { on_disk: 3, derived: 1, held: 0, frozen: 0, pending: 0, not_seen: 2, not_in_a_desk: 0, unverified: false }
const loop = (over = {}) => ({
  v: 1,
  improvement_open: 3,
  improvement_claimed: 1,
  improvement_shipped: 0,
  improvement_verifying: 2,
  oldest_open_age_days: 4,
  closed_confirmed_month: 5,
  closed_unverified_month: 1,
  loop_alarms_open: 0,
  steps_stale: 0,
  headless: "ran",
  ...over,
})
const rec = (l, hosts = { "claude-code": host }) => ({ schema: "desk.factory.capture/1", basis: "still_on_disk", hosts, ...(l ? { loop: l } : {}) })
const file = (r, ageHours = 2) => ({ text: JSON.stringify(r), committedAtMs: NOW - ageHours * HOUR, previousText: null })

test("the loop slot keys are the closed, content-free set the capture record's loop slot allows", () => {
  for (const k of LOOP_KEYS) assert.match(k, /^[a-z_]{1,32}$/)
  // The whole slot, at its widest, fits the 512-byte limit Desk's capture schema sets for it.
  const widest = Object.fromEntries(LOOP_KEYS.map((k) => [k, k === "headless" ? "x".repeat(32) : k === "v" ? 1 : 1000000]))
  assert.ok(Buffer.byteLength(JSON.stringify(widest)) <= 512, String(Buffer.byteLength(JSON.stringify(widest))))
})

test("with no capture record, every loop figure is no data, never zero", () => {
  const l = summarizeLoop({ files: [], nowMs: NOW })
  for (const key of ["open", "in_progress", "oldest_open_age_days", "closed_confirmed_month", "loop_alarms_open", "steps_stale"]) {
    assert.equal(l[key].state, "unavailable", key)
    assert.deepEqual(l[key].reasons, ["no_records"], key)
  }
  assert.deepEqual(l.alarms, [])
  assert.deepEqual(checkNumbers({ loop_health: l }), [])
})

test("records from machines that send no loop slot give no data with that reason", () => {
  const l = summarizeLoop({ files: [file(rec(null))], nowMs: NOW })
  assert.equal(l.open.state, "unavailable")
  assert.deepEqual(l.open.reasons, ["no_loop_records"])
  assert.equal(l.machines.without_loop.value, 1)
})

test("one machine's slot is read whole, with n of N machines", () => {
  const l = summarizeLoop({ files: [file(rec(loop()))], nowMs: NOW })
  assert.equal(l.open.value, 3)
  assert.equal(l.in_progress.value, 3)
  assert.equal(l.not_closed.value, 6)
  assert.equal(l.oldest_open_age_days.value, 4)
  assert.equal(l.open.n, 1)
  assert.equal(l.open.N, 1)
  assert.equal(l.open.state, "measured")
  assert.deepEqual(l.headless, [{ code: "ran", machines: { state: "measured", value: 1, reasons: [] } }])
  assert.deepEqual(checkNumbers({ loop_health: l }), [])
})

test("machines may share a desk, so counts are the largest any machine reports, never a sum", () => {
  const l = summarizeLoop({ files: [file(rec(loop())), file(rec(loop({ improvement_open: 7, oldest_open_age_days: 2 })))], nowMs: NOW })
  assert.equal(l.open.value, 7)
  assert.equal(l.oldest_open_age_days.value, 4)
  assert.equal(l.open.n, 2)
})

test("a machine without a slot, or with a key it did not record, is left out of n and makes the figure partial", () => {
  const l = summarizeLoop({ files: [file(rec(loop())), file(rec(null)), file(rec(loop({ steps_stale: null })))], nowMs: NOW })
  assert.equal(l.open.n, 2)
  assert.equal(l.open.N, 3)
  assert.equal(l.open.state, "partial")
  assert.ok(l.open.reasons.includes("machine_sent_no_loop_record"))
  assert.equal(l.steps_stale.n, 1)
  assert.deepEqual(checkNumbers({ loop_health: l }), [])
})

test("no open card means no oldest age, said as none open, never zero days", () => {
  const l = summarizeLoop({ files: [file(rec(loop({ improvement_open: 0, improvement_claimed: 0, oldest_open_age_days: null })))], nowMs: NOW })
  assert.equal(l.open.value, 0)
  assert.equal(l.oldest_open_age_days.state, "unavailable")
  assert.deepEqual(l.oldest_open_age_days.reasons, ["none_open"])
})


test("a machine with nothing open counts as answering for the oldest age, beside a machine that has an open item", () => {
  const l = summarizeLoop({ files: [file(rec(loop({ improvement_open: 0, improvement_claimed: 0, oldest_open_age_days: null }))), file(rec(loop({ oldest_open_age_days: 2 })))], nowMs: NOW })
  assert.equal(l.oldest_open_age_days.value, 2)
  assert.equal(l.oldest_open_age_days.n, 2)
  assert.equal(l.oldest_open_age_days.state, "measured")
  assert.ok(!l.oldest_open_age_days.reasons.includes("machine_sent_no_loop_record"))
})
test("an open item older than the age limit raises the age alarm", () => {
  const l = summarizeLoop({ files: [file(rec(loop({ oldest_open_age_days: AGE_ALARM_DAYS })))], nowMs: NOW })
  assert.deepEqual(l.alarms.map((a) => a.code), ["improvement_age"])
  const quietOk = summarizeLoop({ files: [file(rec(loop()))], nowMs: NOW })
  assert.deepEqual(quietOk.alarms, [])
})

test("a stale step or a loop alarm on any machine is an alarm too", () => {
  const l = summarizeLoop({ files: [file(rec(loop({ steps_stale: 2, loop_alarms_open: 1 })))], nowMs: NOW })
  assert.deepEqual(l.alarms.map((a) => a.code).sort(), ["loop_alarms_open", "steps_stale"])
})

test("a record not updated for over 72 hours is a quiet machine, still read, with its ages aged by the record's age", () => {
  const l = summarizeLoop({ files: [file(rec(loop({ oldest_open_age_days: 1 })), QUIET_AFTER_HOURS + 1)], nowMs: NOW })
  assert.equal(l.machines.quiet.value, 1)
  assert.equal(l.open.value, 3)
  assert.equal(l.oldest_open_age_days.value, 1 + Math.floor((QUIET_AFTER_HOURS + 1) / 24))
  assert.deepEqual(l.alarms, [])
})

test("a record sent 40 days ago that said oldest 5 days shows 45 days and raises the age alarm", () => {
  const l = summarizeLoop({ files: [file(rec(loop({ oldest_open_age_days: 5 })), 40 * 24)], nowMs: NOW })
  assert.equal(l.oldest_open_age_days.value, 45)
  assert.deepEqual(l.alarms.map((a) => a.code), ["improvement_age"])
  assert.equal(l.verdict.quiet.value, 1)
  assert.equal(l.verdict.status, "alarm")
})

test("a record past the 45-day stale rule is not read as current: its machine stays in N and every figure says so", () => {
  const l = summarizeLoop({ files: [file(rec(loop())), file(rec(loop({ improvement_open: 9 })), 46 * 24)], nowMs: NOW })
  assert.equal(l.open.value, 3)
  assert.equal(l.open.n, 1)
  assert.equal(l.open.N, 2)
  assert.equal(l.open.state, "partial")
  assert.ok(l.open.reasons.includes("record_stale"))
  assert.equal(l.machines.stale.value, 1)
  assert.equal(l.verdict.status, "cannot_tell")
  const only = summarizeLoop({ files: [file(rec(loop()), 46 * 24)], nowMs: NOW })
  assert.equal(only.open.state, "unavailable")
  assert.deepEqual(only.open.reasons, ["record_stale"])
  assert.deepEqual(checkNumbers({ loop_health: l }), [])
})
test("a slot of another version, a bad value or a code that is not a plain code is not read as a number", () => {
  const l = summarizeLoop({
    files: [file(rec({ ...loop(), v: 2 })), file(rec(loop({ improvement_open: -1, headless: "Has Spaces" })))],
    nowMs: NOW,
  })
  assert.equal(l.machines.unreadable_loop.value, 1)
  assert.equal(l.open.state, "unavailable")
  assert.deepEqual(l.headless, [])
})

test("the no-alarm verdict is healthy only when every figure it rests on is measured, for every combination of missing figures", () => {
  const keyOf = { oldest_open_age_days: "oldest_open_age_days", loop_alarms_open: "loop_alarms_open", steps_stale: "steps_stale" }
  for (let mask = 0; mask < 1 << HEALTHY_RESTS_ON.length; mask++) {
    const dropped = HEALTHY_RESTS_ON.filter((_, i) => mask & (1 << i))
    const over = Object.fromEntries(dropped.map((k) => [keyOf[k], null]))
    const l = summarizeLoop({ files: [file(rec(loop({ oldest_open_age_days: 2, ...over })))], nowMs: NOW })
    if (dropped.length === 0) {
      assert.equal(l.verdict.status, "healthy")
      assert.deepEqual(l.verdict.missing, [])
    } else {
      assert.equal(l.verdict.status, "cannot_tell", dropped.join(","))
      assert.deepEqual(l.verdict.missing.map((m) => m.figure), dropped)
      for (const m of l.verdict.missing) assert.ok(m.codes.length > 0)
    }
  }
  // The reviewer's case: a slot with only the open count.
  const thin = summarizeLoop({ files: [file(rec({ v: 1, improvement_open: 2 }))], nowMs: NOW })
  assert.equal(thin.verdict.status, "cannot_tell")
  assert.deepEqual(thin.verdict.missing.map((m) => m.figure), [...HEALTHY_RESTS_ON])
  // Nothing open anywhere is a measured fact, not a missing figure.
  const none = summarizeLoop({ files: [file(rec(loop({ improvement_open: 0, improvement_claimed: 0, oldest_open_age_days: null })))], nowMs: NOW })
  assert.equal(none.verdict.status, "healthy")
})

test("a blocked headless evaluator is a notice with a machine count, not an alarm; an unknown sign-in says could not tell", () => {
  for (const code of BLOCKING_HEADLESS) {
    const l = summarizeLoop({ files: [file(rec(loop({ headless: code })))], nowMs: NOW })
    assert.deepEqual(l.alarms, [], code)
    assert.deepEqual(l.notices.map((n) => [n.code, n.machines.value]), [["headless_blocked", 1]], code)
  }
  const unsure = summarizeLoop({ files: [file(rec(loop({ headless: "sign_in_unknown" })))], nowMs: NOW })
  assert.deepEqual(unsure.notices.map((n) => n.code), ["headless_unknown"])
  for (const code of ["disabled", "disabled_would_bill", "budget_exhausted", "ran"]) {
    const l = summarizeLoop({ files: [file(rec(loop({ headless: code })))], nowMs: NOW })
    assert.deepEqual([l.alarms, l.notices], [[], []], code)
  }
  assert.deepEqual(checkNumbers({ loop_health: unsure }), [])
})

test("a machine silent for 40 days with every figure at zero cannot read as healthy", () => {
  const zero = loop({ improvement_open: 0, improvement_claimed: 0, improvement_shipped: 0, improvement_verifying: 0, oldest_open_age_days: null, loop_alarms_open: 0, steps_stale: 0 })
  const l = summarizeLoop({ files: [file(rec(zero), 40 * 24)], nowMs: NOW })
  assert.deepEqual(l.alarms, [])
  assert.equal(l.verdict.status, "cannot_tell")
  assert.equal(l.verdict.quiet.value, 1)
  assert.equal(l.verdict.stale.value, 0)
  const fresh = summarizeLoop({ files: [file(rec(zero))], nowMs: NOW })
  assert.equal(fresh.verdict.status, "healthy")
  const stale = summarizeLoop({ files: [file(rec(zero)), file(rec(zero), 46 * 24)], nowMs: NOW })
  assert.equal(stale.verdict.status, "cannot_tell")
  assert.equal(stale.verdict.stale.value, 1)
})
test("the store's capture gate allows exactly the loop slot keys the site reads", async () => {
  const { readFileSync } = await import("node:fs")
  const gate = readFileSync(new URL("../check-capture.sh", import.meta.url), "utf8")
  const listed = gate.match(/keys - \[("v"[^\]]*)\]/)[1].split(",").map((k) => JSON.parse(k.trim()))
  assert.deepEqual([...listed].sort(), [...LOOP_KEYS].sort())
})
