// A navigation over the settle budget is re-timed twice in the same kind of
// page (width, text scale, theme), back to back with main's same route. It
// passes only when the re-timed route is within budget (a spike), or main is
// itself over budget in the same run (a busy machine) and the route is at
// most twice main's time. On a quiet machine the budget stays a hard limit,
// and a settle that followed an action on the page is never excused
// (2026-10-12 rulings, review rounds 16 and 17).
import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const G = await import(fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url)))
const gate = readFileSync(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url), "utf8")
const at = (ms, where = "#/", kind = {}) => ({ view: "overview", ms, where, width: 1280, height: 900, scale: 1, theme: "light", after: "navigation", ...kind })
const re = (t, ms, main_ms) => new Map([[G.settleKey(t), { ms, main_ms }]])
const fails = (t, ms, main_ms) => G.assessSettle([t], 5000, re(t, ms, main_ms)).length === 1

test("a route over budget passes only as a spike, or beside a main that is over budget too and within twice its time", () => {
  assert.equal(G.SETTLE_BUDGET_MS, 5000)
  assert.equal(G.SETTLE_RATIO, 2)
  // The round-15 case: 16.8 s once, 0.6 s when re-timed.
  assert.equal(fails(at(16800), 600, 590), false)
  // A busy machine: slow on both builds, within twice main's.
  assert.equal(fails(at(16800), 16000, 12000), false)
  // A quiet machine keeps the hard limit: main is under budget.
  assert.equal(fails(at(5100), 5100, 2600), true)
  assert.equal(fails(at(9700), 9700, 4900), true)
  assert.deepEqual(G.assessSettle([at(16800)], 5000, re(at(0), 16800, 600)), ["overview (#/) at 1280 px: 16.8 s, re-timed 16.8 s (main 0.6 s)"])
  // Main over budget does not excuse more than twice its time.
  assert.equal(fails(at(18000), 18000, 6000), true)
  assert.equal(fails(at(12000), 12000, 6000), false)
  assert.equal(fails(at(12001), 12001, 6000), true)
  // Under budget passes untouched; over budget with no re-timing fails.
  assert.deepEqual(G.assessSettle([at(4900)], 5000, new Map()), [])
  assert.deepEqual(G.assessSettle([at(5100)], 5000, new Map()), ["overview (#/) at 1280 px: 5.1 s, not re-timed"])
})

test("a re-timing excuses only the same route in the same kind of page", () => {
  const desktop = re(at(0), 600, 590)
  assert.equal(G.assessSettle([at(9000, "#/compare")], 5000, desktop).length, 1, "another route")
  assert.deepEqual(G.assessSettle([at(9000, "#/", { width: 390 })], 5000, desktop), ["overview (#/) at 390 px: 9.0 s, not re-timed"])
  assert.deepEqual(G.assessSettle([at(9000, "#/", { scale: 2 })], 5000, desktop), ["overview (#/) at 1280 px, text 2x: 9.0 s, not re-timed"])
  assert.deepEqual(G.assessSettle([at(9000, "#/", { theme: "dark" })], 5000, desktop), ["overview (#/) at 1280 px, dark: 9.0 s, not re-timed"])
  const phone = at(9000, "#/", { width: 390, scale: 2, theme: "dark" })
  assert.deepEqual(G.assessSettle([phone], 5000, re(phone, 700, 690)), [])
})

test("a settle that followed an action on the page is never excused", () => {
  const acted = at(6600, "#/task/x", { after: "interaction" })
  assert.deepEqual(G.assessSettle([acted], 5000, re(acted, 600, 590)), ["overview (#/task/x) at 1280 px: 6.6 s, after an action on the page, so not re-timed"])
  assert.deepEqual(G.assessSettle([acted], 5000, re(acted, 9000, 8000)), ["overview (#/task/x) at 1280 px: 6.6 s, after an action on the page, so not re-timed"])
  assert.deepEqual(G.assessSettle([at(4000, "#/task/x", { after: "interaction" })], 5000, new Map()), [])
  assert.deepEqual(G.settleExcused([acted], 5000, re(acted, 600, 590)), [])
  // The gate marks each settle from its page: a navigation only at the URL the last goto asked for.
  assert.match(gate, /page\.goto = async \(to, \.\.\.a\) => \{ const nav = \{ from: page\.url\(\), asked: to, landed: null \}; NAVIGATED\.set\(page, nav\); const r = await goto\(to, \.\.\.a\); nav\.landed = page\.url\(\); return r \}/)
  assert.match(gate, /const after = settleAfter\(asked, page\.url\(\)\)/)
  assert.match(gate, /width: size\.width, height: size\.height, scale: kind\.scale, theme: kind\.theme, after, altered: !!kind\.altered \}/)
  assert.equal(G.sameUrl("http://127.0.0.1:1/#/", "http://127.0.0.1:1/#/"), true)
  assert.equal(G.sameUrl("http://127.0.0.1:1/#/", "http://127.0.0.1:1/#/tasks"), false, "a goto and then a click is an action")
  assert.equal(G.sameUrl("http://127.0.0.1:1#/tasks", "http://127.0.0.1:1/#/tasks"), true)
  const control = gate.slice(gate.indexOf('expectFailure("slow_after_action"'), gate.indexOf('expectFailure("loading_marker_never_clears"'))
  assert.match(control, /a settle after a goto and a click was recorded as/)
  assert.match(control, /a settle after a goto that only changed the hash was recorded as/)
  assert.match(gate, /t\.after !== "interaction" && !t\.altered && !RETIMES\.has\(settleKey\(t\)\)/)
  assert.ok(G.NEGATIVE_CONTROLS.includes("slow_after_action"))
})

test("a settle on a page the check altered is never excused", () => {
  // Storage denied, a refused clipboard or planted data is not replayed by a re-timing.
  const altered = at(9000, "#/tasks", { altered: true })
  assert.deepEqual(G.assessSettle([altered], 5000, re(altered, 600, 590)), ["overview (#/tasks) at 1280 px: 9.0 s, on a page the check altered, so not re-timed"])
  assert.equal(G.assessSettle([altered], 5000, re(altered, 9000, 8000)).length, 1)
  assert.deepEqual(G.settleExcused([altered], 5000, re(altered, 600, 590)), [])
  assert.deepEqual(G.assessSettle([at(4000, "#/tasks", { altered: true })], 5000, new Map()), [])
  assert.match(gate, /const kind = \{ scale, theme, altered: init\.length > 0 \}/)
  assert.match(gate, /page\.route = \(\.\.\.a\) => \{ kind\.altered = true; return route\(\.\.\.a\) \}/)
  assert.match(gate, /t\.after !== "interaction" && !t\.altered && !RETIMES/)
})

test("settleBudget lists every excused route with why and the load average, and each is warned about on stderr", () => {
  const spike = at(16800), busy = at(13000, "#/tasks", { width: 390, scale: 2 })
  const retimes = new Map([[G.settleKey(spike), { ms: 600, main_ms: 590 }], [G.settleKey(busy), { ms: 12000, main_ms: 9000 }]])
  const r = G.settleBudget([at(700), spike, busy], 5000, retimes)
  assert.equal(r.settled, 3)
  assert.deepEqual(r.over_budget_excused.map((x) => [x.where, x.retimed_ms, x.main_ms, x.because]), [["#/", 600, 590, "within budget when re-timed"], ["#/tasks", 12000, 9000, "main was over budget too"]])
  assert.equal(r.load.length, 3)
  assert.equal(G.excusedWarning(r.over_budget_excused[1]), "warning: overview (#/tasks) at 390 px, text 2x settled in 13.0 s, over the 5 s budget, and was excused: main was over budget too (re-timed 12.0 s, main 9.0 s)")
  assert.match(gate, /for \(const x of settleExcused\(SETTLE_TIMES\)\) process\.stderr\.write\(excusedWarning\(x\) \+ "\\n"\)/)
  assert.throws(() => G.settleBudget([at(700), at(16800)], 5000, re(at(0), 16800, 600)), /^Error: 1 of 2 over 5 s: overview \(#\/\) at 1280 px: 16\.8 s, re-timed 16\.8 s \(main 0\.6 s\)$/)
})

test("the gate re-times in the same kind of page, alternating with main, before its last check, records the load, and proves a 3x slowdown still fails", () => {
  assert.ok(G.NEGATIVE_CONTROLS.includes("slowdown_3x_over_budget"))
  const end = gate.indexOf("await retimeOver(SETTLE_TIMES)\n    if (mainServer)")
  assert.ok(end > 0 && end < gate.indexOf('await check("pages_settle_within_budget"'))
  assert.match(gate, /newPage\(\{ width: t\.width \|\| 1280, height: t\.height \|\| 900, scale: t\.scale \|\| 1, theme: t\.theme \|\| "light" \}\)/)
  assert.match(gate, /for \(let i = 0; i < 2; i\+\+\) \{ here\.push\(await timeRoute\(false, t, delay\)\); main\.push\(await timeRoute\(true, t, mainDelay\)\) \}/)
  assert.match(gate, /return \{ ms: Math\.min\(\.\.\.here\), main_ms: Math\.min\(\.\.\.main\), load: loadavg\(\) \}/)
  assert.match(gate, /load_at_start: loadavg\(\)/)
  assert.match(gate, /resources\.load_at_end = loadavg\(\)/)
  const control = gate.slice(gate.indexOf('expectFailure("slowdown_3x_over_budget"'), gate.indexOf('expectFailure("slow_after_action"'))
  assert.match(control, /retime\(t, 3 \* main, 2500\)/)
  assert.match(control, /if \(r\.ms < 3 \* r\.main_ms\) throw/)
})

test("a goto that only changes the hash counts as an action, so its settle is never excused", () => {
  const o = "http://127.0.0.1:1/"
  assert.equal(G.hashOnly(`${o}#/`, `${o}#/compare`), true)
  assert.equal(G.hashOnly(`${o}#/compare`, `${o}#/compare?mode=share`), true)
  assert.equal(G.hashOnly(o, `${o}#/compare`), true, "from the bare page to a route")
  assert.equal(G.hashOnly(`${o}#/tasks`, o), false, "a goto with no hash reloads the page")
  assert.equal(G.hashOnly(o, o), false, "a goto to the same address with no hash reloads the page")
  assert.equal(G.hashOnly("about:blank", `${o}#/compare`), false, "a fresh page loads")
  assert.equal(G.hashOnly(`${o}#/`, `${o}?v=2#/`), false, "a new query string loads")
  assert.equal(G.hashOnly(`${o}#/`, "http://127.0.0.1:2/#/"), false, "another site loads")
  assert.equal(G.hashOnly(`${o}#/`, "#/compare"), false, "a URL that does not parse is not called hash-only")

  const fresh = { from: "about:blank", asked: `${o}#/compare`, landed: `${o}#/compare` }
  assert.equal(G.settleAfter(fresh, `${o}#/compare`), "navigation")
  assert.equal(G.settleAfter({ ...fresh, landed: `${o}#/tasks` }, `${o}#/tasks`), "navigation", "the site's own redirect")
  assert.equal(G.settleAfter(fresh, `${o}#/tasks`), "interaction", "a click moved the page on")
  assert.equal(G.settleAfter(undefined, `${o}#/compare`), "interaction", "no goto")
  const hash = { from: `${o}#/`, asked: `${o}#/compare`, landed: `${o}#/compare` }
  assert.equal(G.settleAfter(hash, `${o}#/compare`), "interaction")

  const slow = at(6600, "#/compare", { after: G.settleAfter(hash, `${o}#/compare`) })
  assert.deepEqual(G.assessSettle([slow], 5000, re(slow, 600, 590)), ["overview (#/compare) at 1280 px: 6.6 s, after an action on the page, so not re-timed"])
  assert.deepEqual(G.settleExcused([slow], 5000, re(slow, 600, 590)), [])
  const loaded = at(6600, "#/compare", { after: G.settleAfter(fresh, `${o}#/compare`) })
  assert.deepEqual(G.assessSettle([loaded], 5000, re(loaded, 600, 590)), [], "a fresh load can still be excused")
})
