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

// Ruling (2026-10-12): one table for every value, with no carve-out for the
// hours kind below an hour, swept down to 0 seconds and its domain edge.
test("describe follows the one table from 0 seconds up, in both forms, with walk.js's words and its domain edge", () => {
  const values = [0, 1, 400, 999.4, 1000, 1500, 37 * SEC, 59.6 * SEC, 65 * SEC, 119 * SEC, 599.6 * SEC, 12.4 * MIN, 59.6 * MIN]
  for (let ms = 2; ms < 30 * DAY; ms = Math.ceil(ms * 1.09) + 3) values.push(ms)
  for (const ms of values) {
    for (const bound of [null, "lower", "upper"]) {
      if (bound === "lower" && ms === 0) continue
      const n = bound ? part(ms, bound) : { state: "measured", value: ms, reasons: [] }
      const q = bound === "lower" ? "at least " : bound === "upper" ? "at most " : ""
      // Long form (the hours kind) reads as walk.js's words; a measured zero is "0 seconds".
      const words = bound ? W.qualified(q, ms) : ms === 0 ? "0 seconds" : W.durationWords(ms)
      assert.equal(F.describe(n, "hours").text, words, `${ms} ms ${bound || "measured"}, long form`)
      // Short form (the duration kind) reads as walk.js's short form.
      const short = bound && ms === 0 ? "0s" : `${q}${W.durationShort(ms, bound || false)}`
      assert.equal(F.describe(n, "duration").text, short, `${ms} ms ${bound || "measured"}, short form`)
    }
  }
  // The domain edge: a zero with no known direction can only be higher.
  const zero = { state: "partial", value: 0, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["log_truncated"] }
  assert.equal(F.describe(zero, "hours").text, "0 seconds (could be higher)")
  assert.equal(F.describe(zero, "hours").text, W.qualified("about ", 0))
  assert.equal(F.describe(zero, "duration").text, W.statedText(zero, "duration"))
  assert.equal(F.describe({ ...zero, bound: "unknown" }, "hours").text, "0 seconds (could be higher)")
  assert.equal(F.describe(part(0, "lower"), "hours").text, "none recorded")
  // A share at its edges, the same rule.
  const share = (value, b) => F.describe({ state: "partial", value, bound: b, bound_reason: b === null ? "bound_reasons_conflict" : undefined, reasons: ["log_truncated"] }, "pct").text
  assert.equal(share(1, null), "100% (could be lower)")
  assert.equal(share(0, null), "0% (could be higher)")
  assert.equal(share(1, "lower"), "100%")
  assert.equal(share(0, "upper"), "0%")
  // A partial figure with no direction under a second keeps its milliseconds, as walk.js does.
  assert.equal(F.describe({ ...zero, value: 400 }, "duration").text, "400ms")
  assert.equal(F.describe({ ...zero, value: 400 }, "hours").text, "400 milliseconds")
})

// Round 10: the governing rule is that no figure moves by more than 10%; the
// table serves it, so seconds take tenths from 1 to 10 s, from 1 ms up.
test("no figure moves by more than 10%, from 1 ms up, bounded or not, in walk.js and describe alike", () => {
  const UNIT = { ms: 1, s: SEC, m: MIN, h: HR, d: DAY }
  assert.equal(W.qualified("at most ", 1002), "at most 1.1 seconds")
  assert.equal(W.durationShort(1002, "upper"), "1.1s")
  assert.equal(W.durationShort(9960, "upper"), "10s")
  assert.equal(W.durationShort(10020, "upper"), "11s")
  assert.equal(W.durationShort(999, "upper"), "999ms")
  assert.equal(F.describe(part(1002, "upper"), "duration").text, "at most 1.1s")
  let checked = 0
  for (let ms = 1; ms < 40 * DAY; ms = ms < 3000 ? ms + 1 : Math.ceil(ms * 1.013) + 1) {
    for (const bound of ["lower", "upper", true, false]) {
      const p = W.durationParts(ms, bound)
      if (!p) { assert.ok(ms < SEC && !bound, `${ms} ms: only an unbounded figure under a second has no number`); continue }
      const shown = p.n * UNIT[p.unit] + (p.s || 0) * SEC
      assert.ok(Math.abs(shown - ms) <= 0.1 * ms + 1e-6, `${ms} ms (${bound}): ${JSON.stringify(p)} moves ${((Math.abs(shown - ms) / ms) * 100).toFixed(1)}%`)
      if (bound === "lower") assert.ok(shown <= ms + 1e-6, `${ms} ms lower: ${JSON.stringify(p)}`)
      if (bound === "upper") assert.ok(shown >= ms - 1e-6, `${ms} ms upper: ${JSON.stringify(p)}`)
      if (typeof bound === "string") {
        const q = bound === "lower" ? "at least " : "at most "
        assert.equal(F.describe(part(ms, bound), "duration").text, `${q}${W.durationShort(ms, bound)}`, `${ms} ms ${bound}, short`)
        assert.equal(F.describe(part(ms, bound), "hours").text, W.qualified(q, ms), `${ms} ms ${bound}, long`)
      }
      checked += 1
    }
  }
  assert.ok(checked > 10000)
})

test("a share is at its edge only at exactly 100%: a lower bound above it keeps its at least", () => {
  const share = (value, b) => F.describe({ state: "partial", value, bound: b, reasons: ["log_truncated"] }, "pct").text
  assert.equal(share(1.2, "lower"), "at least 120%")
  assert.equal(share(1, "lower"), "100%")
  assert.equal(F.describe({ state: "partial", value: 1.2, bound: null, bound_reason: "bound_reasons_conflict", reasons: ["x"] }, "pct").text, "120%")
  assert.deepEqual(W.atEdge("at least ", 1.2, undefined, 1), ["at least ", ""])
  const r = (w, p, b) => S.clockShareWords({ state: "partial", value: w, bound: b, reasons: ["x"] }, { state: "measured", value: p, reasons: [] })
  assert.equal(r(1200, 1000, "lower"), "at least 120% of production time")
  assert.equal(r(1000, 1000, "lower"), "100% of production time")
})

test("the session loading note carries the shared marker, and the gate's controls prove the budget check and a lingering marker fail", async () => {
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /el\("p", "chart-empty", "Loading the session…"\)/)
  assert.match(app, /loadingNote\("p", "Loading the session…"\)/)
  const { fileURLToPath } = await import("node:url")
  const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))
  assert.ok(G.NEGATIVE_CONTROLS.includes("loading_marker_never_clears"))
  assert.throws(() => G.settleBudget([{ view: "task", ms: 700 }, { view: "cause", ms: 10300, where: "planted" }]), /1 of 2 over 5 s: cause \(planted\): 10\.3 s, not re-timed/)
  assert.equal(G.settleBudget([{ view: "task", ms: 700 }]).settled, 1)
  const gate = read("site/scripts/verify-v12-browser.mjs")
  assert.match(gate, /check\("pages_settle_within_budget", async \(\) => settleBudget\(SETTLE_TIMES\)\)/)
  const control = gate.slice(gate.indexOf('expectFailure("slow_data_file"'), gate.indexOf('expectFailure("bound_before_under_on_compare"'))
  assert.doesNotMatch(control, /UNTIMED/)
  assert.match(control, /settleBudget\(\[\.\.\.SETTLE_TIMES, slowed\], SETTLE_BUDGET_MS, new Map\(\[\.\.\.RETIMES, \[settleKey\(slowed\), await retime\(slowed, 10000\)\]\]\)\)/)
})
