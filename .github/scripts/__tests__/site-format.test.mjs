import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const F = createRequire(import.meta.url)("../../../site/src/format.js")

const m = (value) => ({ state: "measured", value, reasons: [] })
const p = (value, reasons, bound) => ({ state: "partial", value, reasons, ...(bound ? { bound } : {}) })
const u = (reasons) => ({ state: "unavailable", reasons })

test("the formatter refuses anything that is not a stated number", () => {
  for (const bad of [5, 0, null, undefined, NaN, "5", {}, { value: 3 }, { state: "measured" }]) {
    assert.throws(() => F.describe(bad, "count"), TypeError, String(bad))
  }
  assert.throws(() => F.describe(m(1), "furlongs"), TypeError)
})

test("a measured number shows plainly, and a measured zero is a zero", () => {
  assert.equal(F.toText(m(0), "count"), "0")
  assert.equal(F.toText(m(1234), "count"), "1,234")
  assert.equal(F.toText(m(65000), "duration"), "1m")
  assert.equal(F.toText(m(0.5), "pct"), "50%")
  assert.equal(F.toText(m(43531), "compact"), "43.5K")
  assert.equal(F.toText(m(7200000), "hours"), "2.0")
  const d = F.describe(m(0), "count")
  assert.equal(d.state, "measured")
  assert.equal(d.marker, null)
})

test("a partial number carries a marker word, its reason and its bound", () => {
  const d = F.describe(p(21, ["worker_split"], "lower"), "count")
  assert.equal(d.state, "partial")
  assert.equal(d.text, "≥ 21")
  assert.equal(d.marker, "partial")
  assert.match(d.reason, /split/)
  assert.match(F.toText(p(21, ["worker_split"], "lower"), "count"), /partial/)
  assert.equal(F.describe(p(5, ["worker_shared"], "upper"), "count").text, "≤ 5")
  assert.equal(F.describe(p(5, ["x"]), "count").text, "5")
})

test("no data says so, with its reason, and never prints a digit", () => {
  const d = F.describe(u(["host_does_not_record"]), "count")
  assert.equal(d.state, "unavailable")
  assert.equal(d.text, "no data")
  assert.match(d.reason, /host does not record/)
  assert.equal(/\d/.test(F.toText(u(["not_recorded"]), "duration")), false)
})

test("a rollup is shown with n of N and what it counts", () => {
  const r = { state: "partial", value: 38000, reasons: ["unmeasured_members"], n: 12, N: 31, of: "jobs" }
  assert.equal(F.describe(r, "duration").nofn, "12 of 31 jobs")
  assert.match(F.toText(r, "duration"), /12 of 31 jobs/)
  const none = { state: "unavailable", reasons: ["no_measured_members"], n: 0, N: 3, of: "jobs" }
  assert.equal(F.describe(none, "duration").nofn, "0 of 3 jobs")
})

test("an unknown reason code is still readable", () => {
  assert.equal(F.reasonText("some_new_reason"), "some new reason")
})

test("the page decides staleness itself from the build stamp", () => {
  const NOW = Date.parse("2026-10-05T12:00:00Z")
  const health = (builtAt, status = "alive") => ({
    built_at: builtAt,
    config: { stale_after_hours: 36 },
    verdict: { status, reason: "ok" },
  })
  assert.equal(F.pageVerdict(health("2026-10-05T10:00:00Z"), NOW).status, "alive")
  const stale = F.pageVerdict(health("2026-10-03T10:00:00Z"), NOW)
  assert.equal(stale.status, "stale")
  assert.match(stale.reason, /last built/)
  assert.equal(F.pageVerdict(health("2026-10-03T10:00:00Z", "broken"), NOW).status, "broken")
  assert.equal(F.pageVerdict(null, NOW).status, "broken")
  assert.equal(F.pageVerdict({ built_at: "nonsense", config: { stale_after_hours: 36 }, verdict: { status: "alive", reason: "" } }, NOW).status, "broken")
})

import { readFileSync } from "node:fs"

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

test("no call site formats a number on its own: app.js has no number formatting", () => {
  const app = read("site/src/app.js")
  for (const banned of [/\.toFixed\(/, /\.toLocaleString\((?!undefined, \{ dateStyle)/, /\bfmt[A-Z]\w*\(/, /\|\| 0\b/, /\?\? 0\b/]) {
    assert.equal(banned.test(app), false, String(banned))
  }
})

test("the page loads the formatter before the renderer, and the deploy copies it", () => {
  const html = read("site/src/index.html")
  assert.ok(html.indexOf('src="format.js"') > 0 && html.indexOf('src="format.js"') < html.indexOf('src="app.js"'))
  assert.match(read(".github/workflows/pages.yml"), /cp [^\n]*site\/src\/format\.js/)
})

test("the purpose and limit statements are on the page and in the README", () => {
  const html = read("site/src/index.html")
  const readme = read("README.md")
  for (const text of [html, readme]) {
    assert.match(text, /how much human attention does an accepted outcome cost/)
    assert.match(text, /Designed for many desks; proven on one so far\./)
  }
})
