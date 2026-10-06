import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DROP_POINTS,
  LOW_SHARE,
  MAX_RECORDS,
  MIN_SESSIONS,
  STALE_DAYS,
  parseCaptureRecord,
  summarizeCapture,
} from "../../../site/scripts/capture-coverage.mjs"
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"

const DAY = 24 * 3600 * 1000
const NOW = Date.parse("2026-10-05T12:00:00Z")

const claude = (over = {}) => ({ on_disk: 280, derived: 248, held: 0, frozen: 0, pending: 2, not_seen: 18, not_in_a_desk: 12, unverified: false, ...over })
const copilot = (over = {}) => ({ on_disk: 188, derived: 49, held: 0, frozen: 0, pending: 0, not_seen: 139, not_in_a_desk: null, unverified: false, ...over })
const codex = (over = {}) => ({ on_disk: 4, derived: 1, held: 0, frozen: 0, pending: 0, not_seen: 3, not_in_a_desk: null, unverified: true, ...over })

const record = (hosts, extra = {}) => ({ schema: "desk.factory.capture/1", basis: "still_on_disk", hosts, ...extra })
const file = (rec, { ageDays = 1, previous = null } = {}) => ({
  text: typeof rec === "string" ? rec : JSON.stringify(rec),
  committedAtMs: NOW - ageDays * DAY,
  previousText: previous === null ? null : JSON.stringify(previous),
})

const host = (cov, name) => cov.hosts.find((h) => h.host === name)

test("a valid record parses, including the empty record and a null not_in_a_desk", () => {
  assert.equal(parseCaptureRecord(JSON.stringify(record({ "claude-code": claude(), "copilot-cli": copilot() }))).ok, true)
  assert.equal(parseCaptureRecord(JSON.stringify(record({}))).ok, true)
  assert.equal(parseCaptureRecord(JSON.stringify(record({ "codex-cli": codex() }))).ok, true)
})

test("a record that breaks the shape is invalid, with a stable code", () => {
  const cases = [
    ["not json", "capture_json"],
    [JSON.stringify([]), "capture_type"],
    [JSON.stringify(record({}, { extra: 1 })), "capture_keys"],
    [JSON.stringify({ ...record({}), basis: "everything" }), "capture_basis"],
    [JSON.stringify({ ...record({}), schema: "desk.factory.capture/2" }), "capture_schema"],
    [JSON.stringify(record({ "other-cli": claude() })), "capture_keys"],
    [JSON.stringify(record({ "claude-code": { ...claude(), where: "x" } })), "capture_keys"],
    [JSON.stringify(record({ "claude-code": claude({ derived: 249 }) })), "capture_inconsistent"],
    [JSON.stringify(record({ "claude-code": claude({ on_disk: 1000001, derived: 1000001 - 32 }) })), "capture_range"],
    [JSON.stringify(record({ "claude-code": claude({ held: -1, on_disk: 279 }) })), "capture_range"],
    [JSON.stringify(record({ "claude-code": claude({ held: 0.5 }) })), "capture_range"],
    [JSON.stringify(record({ "claude-code": claude({ unverified: "no" }) })), "capture_type"],
    [JSON.stringify(record({}, { loop: [] })), "capture_type"],
    ["x".repeat(2049), "capture_size"],
  ]
  for (const [text, code] of cases) {
    const r = parseCaptureRecord(text)
    assert.equal(r.ok, false, text.slice(0, 80))
    assert.equal(r.code, code, text.slice(0, 80))
  }
})

test("an empty store gives no data with no_records, never zero", () => {
  const cov = summarizeCapture({ files: [], nowMs: NOW })
  assert.equal(cov.share.state, "unavailable")
  assert.deepEqual(cov.share.reasons, ["no_records"])
  assert.deepEqual(cov.caveats, [])
  assert.ok(!("value" in cov.share))
  for (const h of cov.hosts) {
    assert.equal(h.share.state, "unavailable")
    assert.ok(h.share.reasons.includes("no_records"))
    assert.ok(!("value" in h.on_disk))
  }
  assert.deepEqual(cov.alarms, [])
  assert.deepEqual(checkNumbers({ capture_coverage: cov }), [])
})

test("two machines' counts are summed per host, with n of N machines", () => {
  const cov = summarizeCapture({
    files: [file(record({ "claude-code": claude() })), file(record({ "claude-code": claude({ on_disk: 20, derived: 10, not_seen: 10, pending: 0, not_in_a_desk: 0 }) }))],
    nowMs: NOW,
  })
  const c = host(cov, "claude-code")
  assert.equal(c.on_disk.value, 300)
  assert.equal(c.derived.value, 258)
  assert.equal(c.on_disk.n, 2)
  assert.equal(c.on_disk.N, 2)
  assert.equal(c.share.state, "measured")
  assert.equal(c.share.value, 258 / 300)
  assert.equal(c.capturable_share.value, 258 / (258 + 2 + 28))
  assert.equal(cov.machines.counted.value, 2)
  assert.equal(cov.share.state, "measured")
  assert.deepEqual(checkNumbers({ capture_coverage: cov }), [])
})

test("a retracted (empty) record is counted as empty and adds nothing", () => {
  const cov = summarizeCapture({ files: [file(record({ "claude-code": claude() })), file(record({}))], nowMs: NOW })
  assert.equal(cov.machines.empty.value, 1)
  assert.equal(cov.machines.counted.value, 1)
  assert.equal(host(cov, "claude-code").on_disk.value, 280)
  assert.equal(cov.share.state, "measured")
})

test("a stale record is left out and counted as stale, which makes the total partial", () => {
  const cov = summarizeCapture({
    files: [file(record({ "claude-code": claude() })), file(record({ "claude-code": claude() }), { ageDays: STALE_DAYS + 1 })],
    nowMs: NOW,
  })
  assert.equal(cov.machines.stale.value, 1)
  assert.equal(host(cov, "claude-code").on_disk.value, 280)
  assert.equal(cov.share.state, "partial")
  assert.ok(cov.share.reasons.includes("record_stale"))
  assert.equal(cov.share.n, 1)
  assert.equal(cov.share.N, 2)
  assert.deepEqual(checkNumbers({ capture_coverage: cov }), [])
})

test("an unverified host makes that host partial with unverified_host, even when it is the only record", () => {
  const cov = summarizeCapture({ files: [file(record({ "codex-cli": codex() }))], nowMs: NOW })
  const x = host(cov, "codex-cli")
  assert.equal(x.share.state, "partial")
  assert.deepEqual(x.share.reasons, ["unverified_host"])
  assert.equal(x.share.value, 0.25)
  assert.equal(x.unverified_machines.value, 1)
  assert.equal(cov.share.state, "partial")
  assert.equal(cov.share.n, 0)
  assert.deepEqual(cov.share.reasons, ["unverified_host"])
  assert.deepEqual(checkNumbers({ capture_coverage: cov }), [])
})

test("share and capturable share are no data when their denominator is 0", () => {
  const zero = { on_disk: 0, derived: 0, held: 0, frozen: 0, pending: 0, not_seen: 0, not_in_a_desk: 0, unverified: false }
  const held = { ...zero, on_disk: 3, held: 3 }
  const cov = summarizeCapture({ files: [file(record({ "claude-code": zero, "copilot-cli": { ...held, not_in_a_desk: null } }))], nowMs: NOW })
  assert.equal(host(cov, "claude-code").share.state, "unavailable")
  assert.ok(host(cov, "claude-code").share.reasons.includes("no_sessions_on_disk"))
  assert.equal(host(cov, "claude-code").on_disk.value, 0)
  assert.equal(host(cov, "copilot-cli").share.value, 0)
  assert.equal(host(cov, "copilot-cli").capturable_share.state, "unavailable")
  assert.ok(host(cov, "copilot-cli").capturable_share.reasons.includes("nothing_capturable"))
  assert.deepEqual(checkNumbers({ capture_coverage: cov }), [])
})

test("a host whose folders do not say which desk a session is in has no not_in_a_desk figure, never zero", () => {
  const cov = summarizeCapture({ files: [file(record({ "copilot-cli": copilot() }))], nowMs: NOW })
  const c = host(cov, "copilot-cli")
  assert.equal(c.not_in_a_desk.state, "unavailable")
  assert.deepEqual(c.not_in_a_desk.reasons, ["host_does_not_say_desk"])
})

test("coverage_low fires under the threshold only with enough sessions", () => {
  const low = { on_disk: 20, derived: 10, held: 0, frozen: 0, pending: 0, not_seen: 10, not_in_a_desk: 0, unverified: false }
  const small = { on_disk: 5, derived: 1, held: 0, frozen: 0, pending: 0, not_seen: 4, not_in_a_desk: null, unverified: false }
  const cov = summarizeCapture({ files: [file(record({ "claude-code": low, "copilot-cli": small }))], nowMs: NOW })
  assert.deepEqual(cov.alarms.map((a) => [a.host, a.code]), [["claude-code", "coverage_low"]])
  assert.ok(LOW_SHARE > 0.5 && MIN_SESSIONS === 10)
})

test("coverage_dropped fires on a fall against the machine's previous record and not on a rise", () => {
  const before = record({ "claude-code": claude() })
  const fell = record({ "claude-code": claude({ derived: 150, not_seen: 116 }) })
  const rose = record({ "copilot-cli": copilot({ derived: 170, not_seen: 18 }) })
  const cov = summarizeCapture({
    files: [file(fell, { previous: before }), file(rose, { previous: record({ "copilot-cli": copilot() }) })],
    nowMs: NOW,
  })
  assert.ok(cov.alarms.some((a) => a.host === "claude-code" && a.code === "coverage_dropped"))
  assert.ok(!cov.alarms.some((a) => a.host === "copilot-cli" && a.code === "coverage_dropped"))
  assert.ok(DROP_POINTS === 0.15)
})

test("the caveats are always present when there is data and fixed", () => {
  const cov = summarizeCapture({ files: [file(record({ "claude-code": claude() }))], nowMs: NOW })
  assert.deepEqual(cov.caveats.map((c) => c.code), ["still_on_disk", "self_reported"])
  assert.match(cov.caveats[0].text, /still on disk/)
})

test("no date, no intake id and no per-machine figure appears in the output", () => {
  const cov = summarizeCapture({
    files: [file(record({ "claude-code": claude() })), file(record({ "copilot-cli": copilot() }))],
    nowMs: NOW,
  })
  const text = JSON.stringify(cov)
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/)
  assert.doesNotMatch(text, /"[0-9a-f]{16}"/)
  assert.doesNotMatch(text, /capture\//)
  assert.ok(!("machines_detail" in cov))
  for (const h of cov.hosts) assert.ok(!Array.isArray(h.machines))
})

test("an invalid record is counted under machines but never in sums, and does not stop the build", () => {
  const cov = summarizeCapture({ files: [file(record({ "claude-code": claude() })), file("{"), file(record({ "claude-code": claude({ derived: 1 }) }))], nowMs: NOW })
  assert.equal(cov.machines.invalid.value, 2)
  assert.equal(cov.machines.counted.value, 1)
  assert.equal(host(cov, "claude-code").on_disk.value, 280)
  assert.ok(cov.share.reasons.includes("record_invalid"))
})

test("a record whose commit time is unknown is left out as of unknown age", () => {
  const cov = summarizeCapture({ files: [{ text: JSON.stringify(record({ "claude-code": claude() })), committedAtMs: null, previousText: null }], nowMs: NOW })
  assert.equal(cov.share.state, "unavailable")
  assert.ok(cov.share.reasons.includes("no_records"))
  assert.equal(cov.machines.stale.value, 1)
})

test("more than the record limit is bounded", () => {
  const files = Array.from({ length: MAX_RECORDS + 5 }, () => file(record({ "claude-code": claude() })))
  const cov = summarizeCapture({ files, nowMs: NOW })
  assert.equal(cov.machines.counted.value, MAX_RECORDS)
  assert.equal(cov.machines.over_limit.value, 5)
  assert.equal(cov.share.state, "partial")
  assert.ok(cov.share.reasons.includes("records_over_limit"))
})
