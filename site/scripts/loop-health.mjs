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
//
// A record is only as current as its last refresh. An age it reports is aged
// by the record's own age before it is shown or compared with the alarm
// threshold, and a record past the 45-day stale rule is not read: its machine
// stays in N, and every figure says some records are stale.

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
// Headless evaluator states that block it. The store shows them as a notice,
// not an alarm: Desk opens its own `loop_alarm:headless_blocked` card after
// two blocked days, and that card reaches the page through loop_alarms_open.
// `sign_in_unknown` is "could not tell", not blocked.
export const BLOCKING_HEADLESS = Object.freeze(["no_agent_cli", "no_credentials", "unsupported_host"])
export const UNKNOWN_HEADLESS = Object.freeze(["sign_in_unknown"])
// The figures the "no loop alarm" sentence rests on.
export const HEALTHY_RESTS_ON = Object.freeze(["oldest_open_age_days", "loop_alarms_open", "steps_stale"])

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
// A machine that reported it has nothing open: no oldest age, by fact.
const NONE = Symbol("none open")
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

// The largest value the machines report. `members` is one entry per machine
// in N: { stale } for a record past the stale rule, { slot: null } for one
// that sent no readable slot, or { slot, ageDays }.
function largest(members, valueOf) {
  const N = members.length
  const rollup = (reasons, n = 0) => ({ ...unavailable(reasons), kind: "rollup", n, N, of: MACHINES, out_of_scope: 0 })
  if (N === 0) return rollup(["no_loop_records"])
  const stale = members.filter((m) => m.stale).length
  const readable = members.filter((m) => !m.stale && m.slot)
  const values = readable.map((m) => valueOf(m.slot, m.ageDays)).filter((v) => v !== null)
  const reasons = []
  if (stale) reasons.push("record_stale")
  if (values.length < N - stale) reasons.push(readable.length === 0 ? "no_loop_records" : "machine_sent_no_loop_record")
  if (values.length === 0) return rollup(reasons.length ? reasons : ["no_loop_records"])
  const numbers = values.filter((v) => v !== NONE)
  // Every machine that answered has nothing open: there is no oldest item.
  if (numbers.length === 0) return rollup(["none_open", ...reasons])
  return declareRollup({ value: Math.max(...numbers), n: values.length, N, of: MACHINES, measure: "max", reasons })
}

const sumOrNull = (...xs) => (xs.every((x) => x !== null) ? xs.reduce((a, b) => a + b, 0) : null)

// `files`: the capture files as build-data reads them ({ text, committedAtMs }).
export function summarizeLoop({ files, nowMs }) {
  const list = Array.isArray(files) ? files : []
  const members = []
  let withoutLoop = 0
  let unreadable = 0
  let quiet = 0
  let stale = 0
  for (const f of list) {
    const parsed = parseCaptureRecord(f?.text)
    if (!parsed.ok || Object.keys(parsed.record.hosts).length === 0) continue
    const ageMs = Number.isFinite(f.committedAtMs) ? Math.max(0, nowMs - f.committedAtMs) : Infinity
    if (ageMs > STALE_DAYS * DAY) {
      stale += 1
      members.push({ stale: true })
      continue
    }
    if (ageMs > QUIET_AFTER_HOURS * HOUR) quiet += 1
    if (!("loop" in parsed.record)) {
      withoutLoop += 1
      members.push({ slot: null })
      continue
    }
    const slot = slotOf(parsed.record.loop)
    if (slot === null) unreadable += 1
    members.push({ slot, ageDays: Math.floor(ageMs / DAY) })
  }
  const slots = members.filter((m) => m.slot).map((m) => m.slot)

  const fig = (valueOf) => largest(members, valueOf)
  const open = fig((s) => s.improvement_open)
  const inProgress = fig((s) => sumOrNull(s.improvement_claimed, s.improvement_shipped, s.improvement_verifying))
  const notClosed = fig((s) => sumOrNull(s.improvement_open, s.improvement_claimed, s.improvement_shipped, s.improvement_verifying))
  // The oldest age is aged by the record's own age: a record sent 40 days
  // ago that said 5 days means at least 45 days now.
  const oldest = fig((s, ageDays) => {
    if (s.oldest_open_age_days !== null) return s.oldest_open_age_days + ageDays
    return s.improvement_open === 0 && s.improvement_claimed === 0 ? NONE : null
  })

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
  const notices = []
  const blocked = slots.filter((s) => BLOCKING_HEADLESS.includes(s.headless)).length
  if (blocked) notices.push({ code: "headless_blocked", machines: measured(blocked) })
  const unsure = slots.filter((s) => UNKNOWN_HEADLESS.includes(s.headless)).length
  if (unsure) notices.push({ code: "headless_unknown", machines: measured(unsure) })

  // The "no loop alarm" sentence is said only when every figure it rests on
  // is measured from current records; otherwise the page names the figures
  // that are not recorded, with why. "None open" is a measured fact.
  const known = (key) => figures[key].state === "measured" || (key === "oldest_open_age_days" && figures[key].reasons.length === 1 && figures[key].reasons[0] === "none_open")
  const missing = HEALTHY_RESTS_ON.filter((key) => !known(key)).map((key) => ({ figure: key, codes: [...figures[key].reasons] }))
  // A quiet or stale machine's figures are not known to be true today, so
  // the loop cannot be called healthy while any machine in N is either.
  const silent = quiet + stale
  const verdict = alarms.length ? "alarm" : missing.length || silent ? "cannot_tell" : "healthy"

  return {
    contract: "loop_slot_v1",
    ...figures,
    headless,
    machines: {
      reporting: measured(slots.length),
      without_loop: measured(withoutLoop),
      unreadable_loop: measured(unreadable),
      quiet: measured(quiet),
      stale: measured(stale),
    },
    alarms,
    notices,
    verdict: { status: verdict, missing, quiet: measured(quiet), stale: measured(stale) },
  }
}
