// Is the improvement loop closing? Read from the loop slot each machine
// sends inside its capture record (`capture/<intake id>.json`, key `loop`).
//
// The slot is flat and content-free, so it fits the rule Desk's capture
// schema already sets for it (keys and codes match ^[a-z_]{1,32}$, values are
// whole numbers up to 1,000,000, null or such a code, at most 512 bytes) and
// carries no date, title, path or name. Desk fills it from the loop's own
// health record; the store reads only these keys (`v` is the slot's version):
//
//   v                         1
//   improvement_open          cards open, not yet taken
//   improvement_claimed       cards an agent has taken
//   improvement_shipped       cards whose fix is merged, not yet released
//   improvement_verifying     cards whose fix is released, being checked
//   oldest_open_age_days      age of the oldest open or claimed card
//                             (null when none is open)
//   closed_confirmed_month    cards closed in the last 30 days, confirmed
//   closed_unverified_month   ... closed without a confirming measure
//   loop_alarms_open          the loop's own alarm cards not closed
//   steps_stale               loop steps that have stopped succeeding
//   headless                  the headless evaluator's state, a code
//
// A null, a missing key or a bad value is "this machine did not record it",
// never zero. Improvement cards live on a desk, and two machines can work the
// same desk, so counts across machines are never added: each figure is the
// largest any one machine reports, with n of N machines.

import { declareRollup, measured, unavailable } from "./state.mjs"
import { STALE_DAYS, parseCaptureRecord } from "./capture-coverage.mjs"

export const LOOP_VERSION = 1
export const LOOP_KEYS = Object.freeze([
  "v",
  "improvement_open",
  "improvement_claimed",
  "improvement_shipped",
  "improvement_verifying",
  "oldest_open_age_days",
  "closed_confirmed_month",
  "closed_unverified_month",
  "loop_alarms_open",
  "steps_stale",
  "headless",
])
// One week matches the desk's weekly sitting; the loop's own age alarm uses
// the same number.
export const AGE_ALARM_DAYS = 7
// A record not updated for this long is a quiet machine (no session started
// there), shown as such, not an alarm.
export const QUIET_AFTER_HOURS = 72

const HOUR = 3600 * 1000
const MACHINES = "machines' records"
const CODE = /^[a-z_]{1,32}$/
const isCount = (x) => Number.isSafeInteger(x) && x >= 0 && x <= 1_000_000

function slotOf(loop) {
  if (!loop || typeof loop !== "object" || Array.isArray(loop) || loop.v !== LOOP_VERSION) return null
  const slot = {}
  for (const key of LOOP_KEYS) {
    if (key === "v") continue
    const v = loop[key]
    if (key === "headless") slot[key] = typeof v === "string" && CODE.test(v) ? v : null
    else slot[key] = isCount(v) ? v : null
  }
  return slot
}

function largest(slots, N, valueOf) {
  if (N === 0) return { ...unavailable(["no_records"]), kind: "rollup", n: 0, N: 0, of: MACHINES, out_of_scope: 0 }
  const values = slots.map(valueOf).filter((v) => v !== null)
  if (slots.length === 0) return { ...unavailable(["no_loop_records"]), kind: "rollup", n: 0, N, of: MACHINES, out_of_scope: 0 }
  return declareRollup({
    value: values.length ? Math.max(...values) : null,
    n: values.length,
    N,
    of: MACHINES,
    measure: "max",
    reasons: values.length < N ? ["machine_sent_no_loop_record"] : [],
  })
}

const sumOrNull = (...xs) => (xs.every((x) => x !== null) ? xs.reduce((a, b) => a + b, 0) : null)

// `files`: the capture files as build-data reads them ({ text, committedAtMs }).
export function summarizeLoop({ files, nowMs }) {
  const list = Array.isArray(files) ? files : []
  let N = 0
  let withoutLoop = 0
  let unreadable = 0
  let quiet = 0
  const slots = []
  for (const f of list) {
    const parsed = parseCaptureRecord(f?.text)
    if (!parsed.ok || Object.keys(parsed.record.hosts).length === 0) continue
    if (!Number.isFinite(f.committedAtMs) || nowMs - f.committedAtMs > STALE_DAYS * 24 * HOUR) continue
    N += 1
    if (nowMs - f.committedAtMs > QUIET_AFTER_HOURS * HOUR) quiet += 1
    if (!("loop" in parsed.record)) {
      withoutLoop += 1
      continue
    }
    const slot = slotOf(parsed.record.loop)
    if (slot === null) unreadable += 1
    else slots.push(slot)
  }

  const fig = (valueOf) => largest(slots, N, valueOf)
  const open = fig((s) => s.improvement_open)
  const inProgress = fig((s) => sumOrNull(s.improvement_claimed, s.improvement_shipped, s.improvement_verifying))
  const notClosed = fig((s) => sumOrNull(s.improvement_open, s.improvement_claimed, s.improvement_shipped, s.improvement_verifying))
  let oldest = fig((s) => s.oldest_open_age_days)
  // Nothing open or taken anywhere that reported: there is no oldest card.
  const noneOpen =
    slots.length > 0 && slots.every((s) => s.oldest_open_age_days === null && s.improvement_open === 0 && s.improvement_claimed === 0)
  if (oldest.state === "unavailable" && noneOpen) oldest = { ...unavailable(["none_open"]), kind: "rollup", n: 0, N, of: MACHINES, out_of_scope: 0 }

  const figures = {
    open,
    in_progress: inProgress,
    not_closed: notClosed,
    oldest_open_age_days: oldest,
    closed_confirmed_month: fig((s) => s.closed_confirmed_month),
    closed_unverified_month: fig((s) => s.closed_unverified_month),
    loop_alarms_open: fig((s) => s.loop_alarms_open),
    steps_stale: fig((s) => s.steps_stale),
  }

  const codes = new Map()
  for (const s of slots) if (s.headless) codes.set(s.headless, (codes.get(s.headless) || 0) + 1)
  const headless = [...codes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, n]) => ({ code, machines: measured(n) }))

  const alarms = []
  const over = (f, limit) => f.state !== "unavailable" && f.value >= limit
  if (over(oldest, AGE_ALARM_DAYS)) alarms.push({ code: "improvement_age" })
  if (over(figures.loop_alarms_open, 1)) alarms.push({ code: "loop_alarms_open" })
  if (over(figures.steps_stale, 1)) alarms.push({ code: "steps_stale" })

  return {
    contract: "loop_slot_v1",
    ...figures,
    headless,
    machines: {
      reporting: measured(slots.length),
      without_loop: measured(withoutLoop),
      unreadable_loop: measured(unreadable),
      quiet: measured(quiet),
    },
    alarms,
  }
}
