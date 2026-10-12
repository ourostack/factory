// Round 9 (2026-10-12): one rounding rule for every duration, chosen so that
// directed rounding never moves a figure by more than about 10%, in walk.js
// (words and short form) and format.js describe alike; and the round-9 lows.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")
const W = require("../../../site/src/walk.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const SEC = 1000, MIN = 60 * SEC, HR = 60 * MIN, DAY = 24 * HR
const part = (value, bound) => ({ state: "partial", value, bound, reasons: ["log_truncated"] })

test("the rule: seconds, minutes and seconds to 10 minutes, minutes, tenths of an hour, hours, tenths of a day", () => {
  assert.equal(W.durationWords(37 * SEC), "37 seconds")
  assert.equal(W.durationShort(37 * SEC), "37s")
  assert.equal(W.durationWords(65 * SEC), "1 minute 5 seconds")
  assert.equal(W.durationShort(65 * SEC), "1m 5s")
  assert.equal(W.durationWords(2 * MIN), "2 minutes")
  assert.equal(W.durationShort(9 * MIN + 59 * SEC), "9m 59s")
  assert.equal(W.durationWords(12 * MIN + 40 * SEC), "13 minutes")
  assert.equal(W.durationShort(4.33 * HR), "4.3h")
  assert.equal(W.durationShort(32.7 * HR), "33h")
  assert.equal(W.durationShort(2.25 * DAY + HR), "2.3d")
  // Carries: 59.6 s is 1 minute; 599.6 s is 10 minutes; 59.6 minutes is 1 hour.
  assert.equal(W.durationShort(59.6 * SEC), "1m")
  assert.equal(W.durationShort(599.6 * SEC), "10m")
  assert.equal(W.durationShort(59.6 * MIN), "1h")
})

test("directed rounding under the rule never moves a figure by more than 10% from a minute up", () => {
  assert.equal(W.qualified("at most ", 65 * SEC), "at most 1 minute 5 seconds")
  assert.equal(W.qualified("at least ", 119 * SEC), "at least 1 minute 59 seconds")
  assert.equal(W.durationShort(65.2 * SEC, "upper"), "1m 6s")
  assert.equal(W.durationShort(10.02 * HR, "upper"), "11h")
  for (let ms = MIN; ms < 30 * DAY; ms = Math.ceil(ms * 1.037) + 7) {
    for (const bound of ["lower", "upper"]) {
      const p = W.durationParts(ms, bound)
      const unit = { s: SEC, m: MIN, h: HR, d: DAY }[p.unit]
      const shown = p.n * unit + (p.s || 0) * SEC
      assert.ok(Math.abs(shown - ms) / ms <= 0.1, `${ms} ms as ${bound}: ${JSON.stringify(p)}`)
      assert.ok(bound === "lower" ? shown <= ms + 1e-6 : shown >= ms - 1e-6, `${ms} ms as ${bound} rounds the wrong way: ${JSON.stringify(p)}`)
    }
  }
})

test("format.js describe uses the same rule and steps as walk.js, bounded or not", () => {
  for (let ms = 1500; ms < 30 * DAY; ms = Math.ceil(ms * 1.061) + 13) {
    assert.equal(F.describe({ state: "measured", value: ms, reasons: [] }, "duration").text, W.durationShort(ms), `${ms} ms`)
    assert.equal(F.describe(part(ms, "lower"), "duration").text, `at least ${W.durationShort(ms, "lower")}`, `${ms} ms lower`)
    assert.equal(F.describe(part(ms, "upper"), "duration").text, `at most ${W.durationShort(ms, "upper")}`, `${ms} ms upper`)
  }
  // Round 7's carry, in describe too.
  assert.equal(F.describe({ state: "measured", value: 59.6 * SEC, reasons: [] }, "duration").text, "1m")
  // Bounded hours: tenths below 10 hours, whole hours to 48.
  assert.equal(F.describe(part(32.7 * HR, "lower"), "duration").text, "at least 32h")
  assert.equal(F.describe(part(10.02 * HR, "upper"), "duration").text, "at most 11h")
  assert.equal(F.describe(part(5.51 * HR, "upper"), "hours").text, "at most 5.6 hours")
  assert.equal(F.describe(part(32.7 * HR, "lower"), "hours").text, "at least 32 hours")
  assert.equal(S.hoursWords(32.7 * HR, "lower"), "32 hours")
})

test("the task page's Recorded working card and its unsplit segment read the figure as the time bar does", () => {
  const work = { state: "partial", value: 400, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["log_truncated"] }
  const row = { job: "a", status: { state: "measured", value: "done", reasons: [] }, lead_time_ms: { state: "measured", value: 10 * SEC, reasons: [] }, working_ms: work, agents_working_unlabeled_ms: { state: "measured", value: 5 * SEC, reasons: [] }, labels_from_shared_session: true }
  const sum = W.taskSummary(row, F.reasonText)
  const card = sum.figures.find((f) => f.label === "Recorded working")
  assert.match(card.text, /^about 400 milliseconds\b/)
  const bar = W.timeBar(row, row, W.idleSplit(row, null), F.SEGMENTS)
  const seg = bar.groups[0].segments.find((s) => s.key === "working_unsplit")
  assert.ok(seg, "an unsplit working segment")
  assert.equal(seg.q, "about ")
  const app = read("site/src/app.js")
  assert.match(app, /W\.qualified\(s\.why \? W\.qualOf\(s\) : s\.q \|\| "", s\.ms\)/)
})

test("the gate scans the task pages for a bound before under, and budgets each page's time to settle", async () => {
  const { fileURLToPath } = await import("node:url")
  const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))
  assert.ok(G.REQUIRED_CHECKS.includes("task_pages_no_bound_before_under"))
  assert.ok(G.NEGATIVE_CONTROLS.includes("bound_before_under_on_task_page"))
  assert.ok(G.REQUIRED_CHECKS.includes("pages_settle_within_budget"))
  assert.ok(G.NEGATIVE_CONTROLS.includes("slow_data_file"))
  assert.equal(G.SETTLE_BUDGET_MS, 5000)
  assert.deepEqual(G.assessSettle([{ view: "task", ms: 800 }, { view: "cause", ms: 4999 }]), [])
  assert.equal(G.assessSettle([{ view: "task", ms: 800 }, { view: "cause", ms: 10400 }]).length, 1)
  // Loading is a shared class, not the literal text.
  const gate = read("site/scripts/verify-v12-browser.mjs")
  const settle = gate.slice(gate.indexOf("async function settle("), gate.indexOf("export async function main("))
  assert.doesNotMatch(settle, /Loading…/)
  assert.match(settle, /\[aria-busy="true"\], \.is-loading/)
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /"chart-empty", "Loading…"/)
  assert.match(app, /function loadingNote\(/)
})

// Ruling (2026-10-12): one quantity reads one way, so the hours kind takes the
// same steps bounded or not: tenths from 1 to 10 hours, whole hours from 10
// to 48, tenths of a day from 48, the same numbers walk.js gives.
test("the hours kind follows the duration rule's steps, bounded or not, as walk.js does", () => {
  const hoursOf = (p) => (p.unit === "h" ? `${p.n} hour${p.n === 1 ? "" : "s"}` : p.unit === "d" ? `${p.n} day${p.n === 1 ? "" : "s"}` : null)
  let checked = 0
  for (let ms = HR; ms < 30 * DAY; ms = Math.ceil(ms * 1.043) + 11) {
    for (const bound of [null, "lower", "upper"]) {
      const want = hoursOf(W.durationParts(ms, bound || false))
      if (!want) continue
      const n = bound ? part(ms, bound) : { state: "measured", value: ms, reasons: [] }
      const q = bound === "lower" ? "at least " : bound === "upper" ? "at most " : ""
      assert.equal(F.describe(n, "hours").text, `${q}${want}`, `${ms} ms ${bound || "unbounded"}`)
      checked += 1
    }
  }
  assert.ok(checked > 100)
  assert.equal(F.toText({ state: "measured", value: 32.7 * HR, reasons: [] }, "hours"), "33 hours")
  assert.equal(F.toText({ state: "measured", value: 172.7 * HR, reasons: [] }, "hours"), "7.2 days")
  // The featured session's caption says its own unit.
  assert.doesNotMatch(read("site/src/app.js"), /" hours in one session"/)
})
