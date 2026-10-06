// Capture coverage per host, from the content-free records Desk publishes at
// `capture/<intake id>.json` (one per machine per store).
//
// A host that a machine could not count at all is `{ "not_counted": true }`
// in place of its counts: no count is sent, so none can be read as a zero. The
// site leaves that machine out of the host's sums and shares, counts it in the
// host's N, and says so (`host_not_counted`) instead of reading it as "no
// sessions" or dropping the record.
//
// A record holds counts per host only: how many root session files a host
// still keeps on disk, and how many of them were derived into facts, held on
// purpose, frozen, pending, never seen, or not in a desk. Desk's validator is
// the authority on the record's shape (the store runs it on every intake);
// this module checks the shape again, so a file that slipped past is left
// out of every sum and counted as invalid instead of breaking the build.
//
// What the site publishes: sums per host over the machines whose record is
// fresh and valid, each with n of N machines, and two shares per host. It
// publishes no date, no intake id and no per-machine figure. The age of a
// record is read from Git history by the caller (`committedAtMs`) and used
// only to leave out a record older than 45 days.

import { declareRollup, measured, unavailable } from "./state.mjs"
import { direct } from "./bounds.mjs"

export const CAPTURE_SCHEMA = "desk.factory.capture/1"
export const CAPTURE_FILE = /^[0-9a-f]{16}\.json$/
export const HOSTS = Object.freeze(["claude-code", "copilot-cli", "codex-cli"])
export const BUCKETS = Object.freeze(["derived", "held", "frozen", "pending", "not_seen", "not_in_a_desk"])
const HOST_KEYS = Object.freeze(["on_disk", ...BUCKETS, "unverified"])
const NOT_COUNTED_KEYS = Object.freeze(["not_counted"])
const TOP_KEYS = new Set(["schema", "basis", "hosts", "loop"])

export const MAX_BYTES = 2048
export const MAX_COUNT = 1_000_000
export const MAX_RECORDS = 200
export const STALE_DAYS = 45
// The alarm reads the capturable share: below LOW_SHARE with at least
// MIN_SESSIONS in its denominator is `coverage_low`; a fall of DROP_POINTS or
// more against the same machine's previous record is `coverage_dropped`.
export const LOW_SHARE = 0.8
export const MIN_SESSIONS = 10
export const DROP_POINTS = 0.15

const DAY = 24 * 3600 * 1000
const MACHINES = "machines' records"
// A share's n of N: the records whose host the machine could verify, over
// every record that has the host. An unverified record is still counted in
// every figure beside it; the records column says how many are unverified.
const VERIFIED = "machines' records with the host verified"
// The store-wide share's n of N: the current records whose every host is
// verified, over every record that is not a retraction.
const CURRENT_VERIFIED = "machines' records, current and verified"

export const CAVEATS = Object.freeze([
  Object.freeze({
    code: "still_on_disk",
    text: "Of sessions still on disk: a host that deleted old transcripts is invisible here, so coverage is an upper bound.",
  }),
  Object.freeze({ code: "self_reported", text: "Each machine reports its own counts; the store cannot check them." }),
])

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x)
const isCount = (x) => Number.isSafeInteger(x) && x >= 0 && x <= MAX_COUNT

// One record's text, checked. `{ ok: true, record }` or `{ ok: false, code }`
// with a stable code; nothing from the text is echoed.
export function parseCaptureRecord(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES) return { ok: false, code: "capture_size" }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, code: "capture_json" }
  }
  if (!isObject(value)) return { ok: false, code: "capture_type" }
  for (const key of Object.keys(value)) if (!TOP_KEYS.has(key)) return { ok: false, code: "capture_keys" }
  if (!("schema" in value) || !("basis" in value) || !("hosts" in value)) return { ok: false, code: "capture_keys" }
  if (value.schema !== CAPTURE_SCHEMA) return { ok: false, code: "capture_schema" }
  if (value.basis !== "still_on_disk") return { ok: false, code: "capture_basis" }
  if (!isObject(value.hosts)) return { ok: false, code: "capture_type" }
  if ("loop" in value && !isObject(value.loop)) return { ok: false, code: "capture_type" }
  for (const [host, entry] of Object.entries(value.hosts)) {
    if (!HOSTS.includes(host) || !isObject(entry)) return { ok: false, code: "capture_keys" }
    const keys = Object.keys(entry)
    if (keys.length === NOT_COUNTED_KEYS.length && keys[0] === NOT_COUNTED_KEYS[0]) {
      if (entry.not_counted !== true) return { ok: false, code: "capture_type" }
      continue
    }
    if (keys.length !== HOST_KEYS.length || !HOST_KEYS.every((k) => keys.includes(k))) return { ok: false, code: "capture_keys" }
    if (typeof entry.unverified !== "boolean") return { ok: false, code: "capture_type" }
    for (const key of ["on_disk", ...BUCKETS]) {
      if (key === "not_in_a_desk" && entry[key] === null) continue
      if (!isCount(entry[key])) return { ok: false, code: "capture_range" }
    }
    const total = BUCKETS.reduce((s, k) => s + (entry[k] ?? 0), 0)
    if (total !== entry.on_disk) return { ok: false, code: "capture_inconsistent" }
  }
  return { ok: true, record: value }
}

export const isNotCounted = (e) => e?.not_counted === true
const capturable = (e) => e.derived + e.frozen + e.pending + e.not_seen

// A share as a rollup over machines: the value is a ratio of sums, `n` the
// machines whose host entry is verified, `N` the machines that report the
// host (counted or not). A machine that could not count the host adds to N and
// to nothing else. With every machine unverified the value still stands,
// flagged `unverified_host` (the numbers check allows a value with n of zero
// only for such named reasons). With no machine able to count the host there
// is no value at all: `host_not_counted`, never a zero.
function shareOf(num, den, n, N, reasonIfZero, { counted, notCounted = 0 } = {}) {
  const base = { kind: "rollup", n, N, of: VERIFIED, out_of_scope: 0 }
  if (N === 0) return { ...unavailable(["no_records"]), ...base, n: 0 }
  if (counted === 0) return { ...unavailable(["host_not_counted"]), ...base, n: 0 }
  if (den === 0) return { ...unavailable([reasonIfZero, ...(notCounted > 0 ? ["host_not_counted"] : [])]), ...base, n: 0 }
  const value = num / den
  if (n === N) return { ...measured(value), ...base }
  const reasons = []
  if (n < counted) reasons.push("unverified_host")
  if (notCounted > 0) reasons.push("host_not_counted")
  return direct({ state: "partial", value, reasons, ...base }, "capture_share")
}

function sumOf(entries, key, notCounted = 0) {
  const present = entries.filter((e) => e[key] !== null)
  const N = entries.length + notCounted
  if (N === 0) return { ...unavailable(["no_records"]), kind: "rollup", n: 0, N: 0, of: MACHINES, out_of_scope: 0 }
  if (entries.length === 0) return { ...unavailable(["host_not_counted"]), kind: "rollup", n: 0, N, of: MACHINES, out_of_scope: 0 }
  if (present.length === 0) return { ...unavailable(["host_does_not_say_desk"]), kind: "rollup", n: 0, N, of: MACHINES, out_of_scope: 0 }
  return declareRollup({
    value: present.reduce((s, e) => s + e[key], 0),
    n: present.length,
    N,
    of: MACHINES,
    measure: "sum",
    reasons: [...(present.length < entries.length ? ["host_does_not_say_desk"] : []), ...(notCounted > 0 ? ["host_not_counted"] : [])],
  })
}

// `files`: [{ text, committedAtMs, previousText }], one per capture file on
// the default branch, `previousText` being the same file at its previous
// commit (or null). Returns the `capture_coverage` object of data.json.
export function summarizeCapture({ files, nowMs }) {
  const list = Array.isArray(files) ? files : []
  const counts = { counted: 0, empty: 0, stale: 0, invalid: 0, over_limit: 0 }
  const fresh = []
  list.forEach((f, index) => {
    if (index >= MAX_RECORDS) {
      counts.over_limit += 1
      return
    }
    const parsed = parseCaptureRecord(f?.text)
    if (!parsed.ok) {
      counts.invalid += 1
      return
    }
    if (Object.keys(parsed.record.hosts).length === 0) {
      counts.empty += 1
      return
    }
    if (!Number.isFinite(f.committedAtMs) || nowMs - f.committedAtMs > STALE_DAYS * DAY) {
      counts.stale += 1
      return
    }
    counts.counted += 1
    const previous = f.previousText ? parseCaptureRecord(f.previousText) : null
    fresh.push({ record: parsed.record, previous: previous?.ok ? previous.record : null })
  })

  const alarms = []
  const hosts = HOSTS.map((host) => {
    const reported = fresh.map((r) => r.record.hosts[host]).filter(Boolean)
    const entries = reported.filter((e) => !isNotCounted(e))
    const notCounted = reported.length - entries.length
    const N = reported.length
    const verified = entries.filter((e) => e.unverified === false).length
    const total = (key) => entries.reduce((s, e) => s + (e[key] ?? 0), 0)
    const row = { host }
    for (const key of ["on_disk", ...BUCKETS]) row[key] = sumOf(entries, key, notCounted)
    const split = { counted: entries.length, notCounted }
    row.share = shareOf(total("derived"), total("on_disk"), verified, N, "no_sessions_on_disk", split)
    const den = entries.reduce((s, e) => s + capturable(e), 0)
    row.capturable_share = shareOf(total("derived"), den, verified, N, "nothing_capturable", split)
    row.records = measured(N)
    row.unverified_machines = N === 0 ? unavailable(["no_records"]) : measured(entries.length - verified)
    row.not_counted_machines = N === 0 ? unavailable(["no_records"]) : measured(notCounted)
    if (N > 0 && den >= MIN_SESSIONS && total("derived") / den < LOW_SHARE) alarms.push({ host, code: "coverage_low" })
    const dropped = fresh.some(({ record, previous }) => {
      const now = record.hosts[host]
      const before = previous?.hosts?.[host]
      if (!now || !before || isNotCounted(now) || isNotCounted(before) || capturable(now) === 0 || capturable(before) === 0) return false
      return before.derived / capturable(before) - now.derived / capturable(now) >= DROP_POINTS
    })
    if (dropped) alarms.push({ host, code: "coverage_dropped" })
    return row
  })

  const machines = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, measured(v)]))
  machines.files = measured(list.length)

  // The store-wide share: every host's derived sessions over every host's
  // sessions on disk, over the fresh records. `n` is the fresh machines whose
  // every host is verified; `N` every machine with a non-empty record. Old,
  // invalid or over-limit records are machines left out, and an unverified
  // host is a machine not counted whole, so either makes the figure partial
  // with why. A retraction (empty record) is out of scope.
  const N = counts.counted + counts.stale + counts.invalid + counts.over_limit
  const whole = fresh.filter((r) => Object.values(r.record.hosts).every((e) => !isNotCounted(e) && e.unverified === false)).length
  const anyNotCounted = fresh.some((r) => Object.values(r.record.hosts).some(isNotCounted))
  const reasons = []
  if (counts.stale) reasons.push("record_stale")
  if (counts.invalid) reasons.push("record_invalid")
  if (counts.over_limit) reasons.push("records_over_limit")
  if (fresh.some((r) => Object.values(r.record.hosts).some((e) => !isNotCounted(e) && e.unverified !== false))) reasons.push("unverified_host")
  if (anyNotCounted) reasons.push("host_not_counted")
  const base = { kind: "rollup", n: whole, N, of: CURRENT_VERIFIED, out_of_scope: counts.empty }
  const sumAll = (key) => fresh.reduce((s, r) => s + Object.values(r.record.hosts).reduce((t, e) => t + (isNotCounted(e) ? 0 : e[key]), 0), 0)
  const derived = sumAll("derived")
  const onDisk = sumAll("on_disk")
  let share
  if (counts.counted === 0) share = { ...unavailable(["no_records", ...reasons]), ...base, n: 0 }
  else if (onDisk === 0) {
    const anyCounted = fresh.some((r) => Object.values(r.record.hosts).some((e) => !isNotCounted(e)))
    share = { ...unavailable([...(anyCounted ? ["no_sessions_on_disk"] : []), ...(anyNotCounted ? ["host_not_counted"] : [])]), ...base, n: 0 }
  }
  else if (reasons.length === 0) share = { ...measured(derived / onDisk), ...base }
  else share = direct({ state: "partial", value: derived / onDisk, reasons: reasons.sort(), ...base }, "capture_share")

  return {
    method: "capture_coverage_v1",
    share,
    machines,
    caveats: counts.counted === 0 ? [] : CAVEATS.map((c) => ({ ...c })),
    hosts,
    alarms,
  }
}
