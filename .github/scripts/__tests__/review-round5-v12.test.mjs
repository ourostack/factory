// Factory v1.2 review round 5 (2026-10-12): Compare shows one duration unit
// per view, chosen from its largest value; every conclusion is marked as
// such and the gate reads the marker, not a list of caveat phrases; and the
// preferences migration drops only the zone the old bug stored (UTC).
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")
const P = require("../../../site/src/preferences.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))

const m = (v) => ({ state: "measured", value: v, reasons: [] })
const p = (v, bound, reasons = ["log_truncated"]) => ({ state: "partial", value: v, reasons, bound, ...(bound === null ? { bound_reason: "bound_reasons_conflict" } : {}) })
const H = 3600000
const D = 24 * H

test("a view's unit comes from its largest value: days above 48 hours, hours from one hour, minutes below", () => {
  assert.equal(S.viewUnit(49 * H), "days")
  assert.equal(S.viewUnit(48 * H), "hours")
  assert.equal(S.viewUnit(H), "hours")
  assert.equal(S.viewUnit(30 * 60000), "minutes")
  assert.equal(S.viewUnit(0), "hours")
})

test("every figure in a unit reads in that unit, however small", () => {
  assert.equal(S.unitWords(2419 * H, "days"), "101 days")
  assert.equal(S.unitWords(7 * D, "days"), "7 days")
  assert.equal(S.unitWords(D, "days"), "1 day")
  assert.equal(S.unitWords(3.6 * H, "days"), "0.15 days")
  assert.equal(S.unitWords(60000, "days"), "under 0.01 days")
  assert.equal(S.unitWords(0, "days"), "none")
  assert.equal(S.unitWords(30 * 60000, "hours"), "0.5 hours")
  assert.equal(S.unitShort(2419 * H, "days"), "101d")
  assert.equal(S.unitShort(3.6 * H, "days"), "0.15d")
  assert.equal(S.unitShort(60000, "days"), "<0.01d")
  // No unit keeps the old behavior for the views this change does not cover.
  assert.equal(S.unitWords(5.5 * H), S.hoursWords(5.5 * H))
})

test("the axis takes the view's unit and is labelled with it", () => {
  const s = S.timeScale(200 * H * 1.15, undefined, "days")
  assert.equal(s.unit, "days")
  assert.equal(s.per, D)
  assert.ok(s.max_ms >= 230 * H && s.ticks.every((t) => (t / D) * 4 === Math.round((t / D) * 4)), "ticks fall on round days")
  // Without a unit the other charts keep hours and minutes.
  assert.equal(S.timeScale(200 * H).unit, "hours")
  const app = read("site/src/app.js")
  assert.match(app, /UNIT_TITLE\[scale\.unit\]/)
  assert.match(read("site/src/steps.js"), /days: \[DAY, "day", "d"\]/)
})

test("Compare's bar labels, lead sentence, sums and tables use one unit", () => {
  const job = (id, clocks) => ({ id, status: "done", finish_date: { state: "unavailable", reasons: ["not_recorded"] }, clocks })
  const clocks = (prod, active, rest) => ({ production_ms: m(prod), active_in_production_ms: p(active, "lower"), production_remainder_ms: p(rest, "upper"), request_to_delivery_ms: { state: "unavailable", reasons: ["original_request_not_recorded"] }, queue_ms: { state: "unavailable", reasons: ["original_request_not_recorded"] } })
  const jobs = [job("a".repeat(16), clocks(7 * D, 3.6 * H, 7 * D - 3.6 * H)), job("b".repeat(16), clocks(5 * H, 2 * H, 3 * H))]
  const bars = S.clockBars(jobs, "production", { unit: "days" })
  assert.deepEqual(bars.map((b) => b.unit), ["days", "days"])
  assert.deepEqual(bars.map((b) => b.words), ["7 days", "0.21 days"])
  assert.deepEqual(bars.map((b) => b.label), ["7d", "0.21d"])
  assert.match(S.exposureWords(bars), /: 7.2 days of task exposure/)
  const figures = S.clockFigures(jobs[0].clocks, F.reasonText, "days")
  assert.equal(figures.find((f) => f.key === "active_in_production_ms").text, "at least 0.15 days")
  assert.equal(S.groupWords({ ms: 3.6 * H, qualifier: "at least " }, "days"), "at least 0.15 days")
  assert.equal(S.compactRow({ job: "x", name: "x", state: "ok", label: "7d", unit: "days", groups: [{ key: "waiting", ms: 5 * H, qualifier: "" }] }).waiting, "0.21d")
  const app = read("site/src/app.js")
  // One unit for the whole view, from the largest figure it shows.
  assert.match(app, /const unit = S\.viewUnit\(/)
  assert.match(app, /S\.clockFigures\(clocks, F\.reasonText, unit\)/)
  assert.match(app, /writeConclusion\(allU\)/)
})

test("the gate finds every unit a text uses, so a mixed view fails", () => {
  assert.deepEqual(G.durationUnitsIn(["Start by inspecting x: 101 days so far.", "≥7d", "0.15d", "about 0.15 days (could be higher or lower)"]), ["days"])
  assert.deepEqual(G.durationUnitsIn(["7 days", "3.6 hours", "48m", "under a second"]), ["days", "hours", "minutes", "seconds"])
  assert.deepEqual(G.durationUnitsIn(["at least 4% of production time", "Not available", "none", "2026-10-03"]), [])
  assert.ok(G.REQUIRED_CHECKS.includes("compare_uses_one_duration_unit"))
  assert.ok(G.NEGATIVE_CONTROLS.includes("mixed_units_on_compare"))
})

test("each conclusion is marked as one, and the gate reads that marker instead of a caveat phrase list", () => {
  assert.equal(G.CAVEAT_PATTERN, undefined, "no phrase list decides what a conclusion is")
  assert.deepEqual(G.CONCLUSIONS, { task: "#view-task", compare: "#view-compare", overview: "#view-overview" })
  assert.equal(G.assessFirstScreen({ found: true, role: "conclusion", top: 300, text: "The recorded window is incomplete." }, 390), null, "wording alone never fails a marked conclusion")
  assert.match(G.assessFirstScreen({ found: true, role: "caveat", top: 300, text: "Keep the bounds in view." }, 390), /caveat/)
  assert.match(G.assessFirstScreen({ found: false }, 390), /no conclusion/)
  const html = read("site/src/index.html")
  assert.match(html, /<p id="overview-conclusion" [^>]*data-role="conclusion"/)
  assert.match(html, /<p id="comparison-conclusion" [^>]*data-role="conclusion"/)
  assert.match(html, /<p id="compare-lede" [^>]*data-role="caveat"/)
  const app = read("site/src/app.js")
  assert.match(app, /conclusion\.dataset\.role = "conclusion"/)
  assert.match(app, /caveat\.dataset\.role = "caveat"/)
  const gate = read("site/scripts/verify-v12-browser.mjs")
  assert.match(gate, /\[data-role="conclusion"\], \$\{scope\} \[data-role="caveat"\]/)
})

test("the preferences migration drops only the UTC the old bug stored, and keeps any other chosen zone", () => {
  const store = (zone) => {
    const s = new Map([["factory.preferences/1", JSON.stringify({ schema: "factory.preferences/1", dismissed: true, zone, previous: null })]])
    return { getItem: (k) => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)) }
  }
  assert.equal(P.readPreferences(store("UTC"), "America/Los_Angeles").zone, "America/Los_Angeles")
  const kept = P.readPreferences(store("Europe/London"), "America/Los_Angeles")
  assert.equal(kept.zone, "Europe/London")
  assert.equal(kept.dismissed, true)
  assert.equal(P.readPreferences(store("Not/AZone"), "America/Los_Angeles").zone, "America/Los_Angeles", "an invalid zone falls back")
})
