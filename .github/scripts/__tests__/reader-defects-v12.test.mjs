// Factory v1.2 cold-walk reader defects (2026-10-12): the top attention item
// must land on an alarm that states its effect, owner and next action; the
// main navigation is a clean general entry; one task table; one label per
// cause; a map legend that matches the map.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")
const W = require("../../../site/src/walk.js")
const B = require("../../../site/src/briefing.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

const loop = (codes) => ({ alarms: codes.map((code) => ({ code })), verdict: { status: "alarm" } })

test("improvement-system alarms state their effect, owner or unassigned, and next action", () => {
  const unowned = S.improvementAlarms(F.statusLine({ loop: loop(["loop_alarms_open"]), alarmIssues: [], alarmIssuesVerification: "verified" }))
  assert.equal(unowned.length, 1)
  const a = unowned[0]
  assert.equal(a.key, "loop:loop_alarms_open")
  assert.match(a.title, /raised an alarm about itself/)
  assert.match(a.effect, /may not be current/)
  assert.equal(a.owner, null)
  assert.match(a.ownerText, /^Unassigned/)
  assert.match(a.next, /factory-alarm/)
  assert.match(a.next, /loop:loop_alarms_open/)
  const owned = S.improvementAlarms(F.statusLine({ loop: loop(["steps_stale"]), alarmIssues: [{ issue_state: "open", keys: ["loop:steps_stale"], ref: "#12", url: "https://github.com/ourostack/factory/issues/12" }], alarmIssuesVerification: "verified" }))
  assert.deepEqual(owned[0].owner, { ref: "#12", url: "https://github.com/ourostack/factory/issues/12" })
  assert.match(owned[0].effect, /stopped succeeding/)
  assert.doesNotMatch(owned[0].next, /Assign an owner/)
  // Capture alarms are not improvement-system alarms.
  assert.deepEqual(S.improvementAlarms(F.statusLine({ capture: { alarms: [{ host: "x", code: "coverage_dropped" }] } })), [])
  // The Improvements view leads with them, and the Overview link lands there.
  const html = read("site/src/index.html")
  assert.ok(html.indexOf('id="improvement-alarms"') > 0 && html.indexOf('id="improvement-alarms"') < html.indexOf('id="improvement-status"'), "alarms come first on Improvements")
  const app = read("site/src/app.js")
  assert.match(app, /S\.improvementAlarms\(/)
  assert.match(app, /Open this alarm on Improvements/)
  assert.match(app, /focusAfterRender = "improvement-alarms"/)
})

test("the main navigation never carries task, filter or selection context", () => {
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /setLocalHref\(link, F\.routeWithContext\(path, context\)\)/)
  assert.match(app, /for \(const link of document\.querySelectorAll\("nav\.steps a"\)\) setLocalHref\(link, link\.dataset\.destination/)
  for (const internal of ["Navigation context retained", "Selection requested:", "Investigation context: ${context.cause}"]) assert.ok(!app.includes(internal), internal)
})

test("one task table: Tasks and the task page share columns, sort and lifecycle words, and explain partial and declared in place", () => {
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /\["Overall recorded elapsed", ""\]/)
  assert.doesNotMatch(app, /\["Work \/ elapsed", ""\]/)
  assert.match(app, /const TASK_COLUMNS = \[\["Task", ""\], \["Recorded lifecycle", ""\], \["Finish day \(UTC\)", ""\], \["Recorded elapsed", ""\], \["Recorded working", ""\]\]/)
  assert.match(app, /function renderTaskList\(data\) \{[\s\S]{0,1200}renderPicker\(/)
  assert.match(app, /TASK_TABLE_KEY/)
  assert.match(app, /“at least” or “at most”/)
  assert.match(app, /declared/)
  // On the task page the other tasks are below the task, collapsed.
  const html = read("site/src/index.html")
  const view = html.slice(html.indexOf('id="view-task"'), html.indexOf('id="view-session"'))
  assert.ok(view.indexOf('id="task-head"') < view.indexOf('id="task-picker"'), "the task title comes before the list of tasks")
  assert.match(view, /<details id="other-tasks" class="other-tasks">\s*<summary>/)
})

test("one reader-facing label per cause, and no raw cause code in reader text", () => {
  assert.equal(W.causeWords("waiting:other_task"), "Recorded work on other tasks")
  assert.equal(W.causeWords("waiting:no_session"), "No recorded task session")
  assert.equal(W.waitCauseLabel("other_task"), "Recorded work on other tasks")
  assert.equal(W.waitCauseLabel("no_session"), "No recorded task session")
  const html = read("site/src/index.html")
  assert.doesNotMatch(html, />Agent on another task</)
  // Rank causes with a task filter says one coherent thing.
  const app = read("site/src/app.js")
  assert.match(app, /document\.getElementById\("pareto-caption"\)\.textContent = all\.state === "absent" \|\| filtered \? "" :/)
})

test("the map legend lists only the markers on this map, in plain words", () => {
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /so no prompt is drawn rather than none/)
  assert.doesNotMatch(app, /`card: \$\{m\.status\}/)
  assert.match(app, /All marker types/)
  assert.match(app, /const present = \{/)
  // A Clear selection control sits with the map.
  assert.match(read("site/src/index.html"), /id="map-clear"/)
  assert.equal(W.cardStatusWords("done", true), "Delivered (card moved to done; last observed)")
  assert.equal(W.cardStatusWords("cancelled", false), "Cancelled")
  assert.equal(W.cardStatusWords("doing", false), "In progress (doing)")
})

test("Inspect recorded tasks opens the affected deliveries, filtered", () => {
  const data = JSON.parse(read(".github/scripts/__tests__/fixtures/v12-triage.json"))
  assert.ok(data)
  const app = read("site/src/app.js")
  assert.match(app, /Inspect the \$\{n\} affected deliveries/)
  const src = read("site/src/briefing.js")
  assert.match(src, /#\/tasks\?status=awaiting_signoff/)
  assert.equal(B.validateBriefing({ schema: "factory-overview/1", generation: "factory-site/3:2026-10-11T19:28:19.148Z", attention: [], agents: [], investigation: [{ id: "finding:awaiting_signoff", family: "production", title: "t", impact: "i", ownership: "not_published", next_action: "n", href: "#/tasks?status=awaiting_signoff" }], changes: { state: "first_visit", added: 0, removed: 0, complete_history: false, previous_visit: null }, state: "attention", reasons: [] }).ok, true)
})

test("the display time zone lives in a compact control and never changes without the reader", () => {
  const html = read("site/src/index.html")
  const header = html.slice(0, html.indexOf('<main'))
  assert.doesNotMatch(header, /Supported instants use your display zone/)
  assert.match(html, /<details id="display-settings" class="display-settings">/)
  // Storage that cannot keep preferences is said on the visible summary line.
  assert.match(html, /<summary>Time zone: <span id="zone-current">[^<]*<\/span><span id="zone-saved"><\/span><\/summary>/)
  assert.match(read("site/src/app.js"), /not saved: browser storage is unavailable\)/)
  const P = require("../../../site/src/preferences.js")
  const store = new Map()
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
  P.savePreferences(storage, { zone: "America/Los_Angeles" })
  assert.equal(P.readPreferences(storage, "UTC").zone, "America/Los_Angeles", "a saved zone wins over the device default")
  P.savePreferences(storage, { dismissed: true })
  assert.equal(P.readPreferences(storage, "UTC").zone, "America/Los_Angeles", "saving another preference keeps the chosen zone")
  // The cold walk's Pacific-to-UTC switch: a first save of another preference
  // (the overview's visit summary) must not pin the zone to UTC.
  const fresh = new Map()
  const s2 = { getItem: (k) => (fresh.has(k) ? fresh.get(k) : null), setItem: (k, v) => fresh.set(k, String(v)) }
  P.savePreferences(s2, { dismissed: true }, "America/Los_Angeles")
  assert.equal(P.readPreferences(s2, "America/Los_Angeles").zone, "America/Los_Angeles")
  assert.match(read("site/src/app.js"), /P\.savePreferences\(storage, patch, deviceZone\)|savePreferences\([^)]*, deviceZone\)/)
})
