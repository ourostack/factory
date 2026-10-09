// Why the agent stopped (design v1.1 addendum §4, store brief S5): the
// lede's templates, the map's triangles and wait drawer, the time bar's
// split, the Pareto's split and toggle, each why's cause page, the colors
// and llms.txt. Fixtures are shaped exactly as Desk's reports D5 publishes
// them (`next_prompt_by_why_ms`, `not_known_by_reason_ms`, `idle_by_why_ms`,
// `waits[].why`, `longest_gap.value.why`, causes `children`), and every view
// must also read today's data, which has none of these keys.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const W = require("../../../site/src/walk.js")
const S = require("../../../site/src/steps.js")
const F = require("../../../site/src/format.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

const H = 3600000
const M = 60000
const m = (value) => ({ state: "measured", value, reasons: [] })
const lower = (value, reasons) => ({ state: "partial", value, bound: "lower", reasons: reasons || ["stop_partly_classified"] })
const u = (reasons) => ({ state: "unavailable", value: null, reasons })
const CLASSES = ["stopped_short", "question", "error_limit", "interrupted", "decision", "approval", "acceptance"]

// A task row as Desk D5 writes it: 36 h of next-prompt waiting, 17.1 h after
// a completion report, 2 h stopped short, 16.9 h not known (not labeled).
function row(split, opts) {
  const o = opts || {}
  const total = Object.values(split).reduce((a, x) => a + x, 0) + (o.notKnown || 0)
  const partly = (o.notKnown || 0) > 0
  const by = Object.fromEntries(CLASSES.map((k) => [k, partly ? lower(split[k] || 0) : m(split[k] || 0)]))
  by.not_known = m(o.notKnown || 0)
  const reasons = { not_labeled: m(0), could_not_tell: m(0), stop_not_recorded: m(0), outside_own_share: m(0), not_in_published_facts: m(0), ...(o.reasons || {}) }
  const lead = total + 4 * H
  return {
    job: "825084c9676f1da79f49e868ff950abb",
    lead_time_ms: m(lead),
    working_ms: m(4 * H),
    idle_ms: m(total),
    value_in_working_ms: m(2 * H),
    flow_efficiency: m(4 * H / lead),
    waiting_by_waited_on_ms: { next_prompt: m(total), other_task: m(0), api_retry: m(0), tool_failure: m(0), long_tool_call: m(0), queue_before_start: m(0), no_session: m(0), unknown: m(0) },
    next_prompt_by_why_ms: by,
    not_known_by_reason_ms: reasons,
    longest_gap: m({ start_ms: 0, end_ms: 18.7 * H, duration_ms: 18.7 * H, waited_on: "next_prompt", why: o.longestWhy || "acceptance" }),
  }
}
const partlyRow = () => row({ acceptance: 17.1 * H, stopped_short: 2 * H }, { notKnown: 16.9 * H, reasons: { not_labeled: m(16.9 * H) } })
// Today's published row: no why keys at all.
const todayRow = () => {
  const r = partlyRow()
  delete r.next_prompt_by_why_ms
  delete r.not_known_by_reason_ms
  delete r.longest_gap.value.why
  return r
}
const ledeOf = (r) => W.ledeText(W.lede(r, F.reasonText, { idle: W.idleSplit(r, null) }))

// ------------------------------------------------------------ vocabulary

test("the classes are Desk's, in the page's stacking order: the actionable ones, then the human gates, then not known", () => {
  assert.deepEqual(W.WHY_KEYS, [...CLASSES, "not_known"])
  assert.deepEqual(W.WHY_KEYS.map(W.whyGroup), ["actionable", "actionable", "actionable", "actionable", "gate", "gate", "gate", "not_known"])
  for (const k of W.WHY_KEYS) {
    assert.ok(W.whyName(k) && !/_/.test(W.whyName(k)), k)
    assert.doesNotMatch(W.whyTriangle(k, ["not_labeled"]), /_/)
  }
  for (const k of CLASSES) assert.ok(W.WHY_AFTER[k] && W.WHY_WORDS[k], k)
  assert.equal(W.whyName("acceptance"), "Human gate: acceptance")
})

test("every reason a why is not known has words, short and long, and none shows an underscore", () => {
  for (const r of [...W.WHY_REASON_KEYS, "stop_partly_classified"]) {
    assert.doesNotMatch(W.whyReasonWords(r), /_/, r)
  }
  // Long words come from format.js where #210 (or earlier) supplied them.
  for (const r of ["not_labeled", "not_in_published_facts"]) assert.equal(F.hasReasonText(r), true, r)
})

// --------------------------------------------------------------- the lede

test("the lede names the top classes in hours and the not-known rest with its reason (partly classified)", () => {
  const t = ledeOf(partlyRow())
  assert.match(t, /Of the 36 hours it waited for the operator's next prompt, at least 17 hours \(up to 34 hours\) came after it reported finished work for acceptance, at least 2 hours \(up to 19 hours\) after it stopped short of what it could have done, and 17 hours is not known \(why: not labeled yet\)\./)
  assert.match(t, /The longest single wait was 19 hours, also for the next prompt, after it reported finished work for acceptance\./)
})

test("the lede has a template for each state: all classified, not labeled yet, stops not recorded, other reasons", () => {
  const all = ledeOf(row({ acceptance: 5 * H, stopped_short: 2 * H, question: 30 * M }))
  assert.match(all, /Of the 7\.5 hours it waited for the operator's next prompt, 5 hours came after it reported finished work for acceptance, 2 hours after it stopped short of what it could have done, and 30 minutes after it asked for information only the operator has\./)
  assert.doesNotMatch(all, /not known/)
  const notLabeled = ledeOf(row({}, { notKnown: 6 * H, reasons: { not_labeled: m(6 * H) } }))
  assert.match(notLabeled, /Why the agent stopped before its 6 hours of waiting for the operator's next prompt is not known yet: the evaluator has not labeled those stops\./)
  const notRecorded = ledeOf(row({}, { notKnown: 6 * H, reasons: { not_in_published_facts: m(5 * H), stop_not_recorded: m(1 * H) } }))
  assert.match(notRecorded, /is not known: older facts record no stop, 5 hours; the stop was not recorded, 1 hour\./)
  const other = ledeOf(row({}, { notKnown: 6 * H, reasons: { could_not_tell: m(6 * H) } }))
  assert.match(other, /is not known \(why: the evaluator could not tell\)\./)
})

test("more than three classes: the rest are summed in one phrase, never dropped", () => {
  const t = ledeOf(row({ acceptance: 5 * H, stopped_short: 4 * H, question: 3 * H, decision: 2 * H, error_limit: 1 * H }))
  assert.match(t, /5 hours came after it reported finished work for acceptance, 4 hours after it stopped short of what it could have done, 3 hours after it asked for information only the operator has, and 3 hours after 2 other kinds of stop\./)
})

test("with today's data (no split) the lede says why is not known yet and shows no split, never a zero", () => {
  const t = ledeOf(todayRow())
  assert.match(t, /Why the agent stopped before the 36 hours it waited for the operator's next prompt is not known yet: Desk does not publish it for this task, so that waiting is not split\./)
  assert.doesNotMatch(t, /stopped short|\b0 hours|none came/)
  assert.match(t, /The longest single wait was 19 hours, also for the next prompt\./)
})

test("a split that does not add up, or a waiting figure that is not measured, shows no split", () => {
  const r = partlyRow()
  r.next_prompt_by_why_ms.acceptance = lower(30 * H)
  assert.equal(W.nextPromptWhy(r).state, "mismatch")
  assert.match(ledeOf(r), /its parts do not add up to its 36 hours of waiting for the next prompt, so no split is shown/)
  const v = partlyRow()
  v.waiting_by_waited_on_ms.next_prompt = u(["source_unreadable"])
  for (const k of W.WHY_KEYS) v.next_prompt_by_why_ms[k] = u(["source_unreadable"])
  assert.equal(W.nextPromptWhy(v).state, "unavailable")
  assert.equal(W.whyLedeParts(W.nextPromptWhy(v), 0).length, 0)
})

test("the lede's class figures carry their state: a lower bound reads at least, and the split adds up to the total", () => {
  const s = W.nextPromptWhy(partlyRow())
  assert.equal(s.state, "ok")
  assert.equal(s.template, "partly")
  assert.equal(s.parts.reduce((a, p) => a + p.ms, 0), s.total.value)
  assert.deepEqual(s.parts.map((p) => p.why), ["stopped_short", "acceptance", "not_known"])
  assert.equal(W.qualOf(s.parts[0].n), "at least ")
  const tokens = W.lede(partlyRow(), F.reasonText, { idle: W.idleSplit(partlyRow(), null) }).parts.filter((p) => p && p.key === "why")
  assert.deepEqual(tokens.map((x) => x.why), ["acceptance", "stopped_short", "not_known"])
})

// ----------------------------------------------------------- the time bar

const segs = F.SEGMENTS
const stackOf = (r) => ({ job: r.job, lead_time_ms: r.lead_time_ms, working_ms: r.working_ms, idle_ms: r.idle_ms, working: { class_ms: { value: m(2 * H), support: m(2 * H) }, waste_ms: {}, agents_working_unlabeled_ms: m(0), not_labeled_ms: m(0) }, idle: r.waiting_by_waited_on_ms, next_prompt_by_why_ms: r.next_prompt_by_why_ms })

test("the time bar splits the next-prompt segment by class, not known as its own segment, and the parts sum to the lead time", () => {
  const r = partlyRow()
  const bar = W.timeBar(stackOf(r), r, W.idleSplit(r, null), segs)
  const wait = bar.groups[1].segments
  assert.deepEqual(wait.map((x) => x.why), ["stopped_short", "acceptance", "not_known"])
  assert.ok(wait.every((x) => x.cause === "next_prompt"))
  assert.equal(wait.find((x) => x.why === "not_known").reasons[0], "not_labeled")
  assert.equal(wait.find((x) => x.why === "acceptance").bound, "lower")
  const sum = bar.segments.reduce((a, x) => a + x.ms, 0)
  assert.ok(Math.abs(sum - bar.total_ms) < 1000)
  assert.equal(bar.why_state, "ok")
})

test("with today's data the time bar keeps one next-prompt segment and says why is not known yet", () => {
  const r = todayRow()
  const bar = W.timeBar(stackOf(r), r, W.idleSplit(r, null), segs)
  assert.deepEqual(bar.groups[1].segments.map((x) => x.key), ["wait_next_prompt"])
  assert.ok(bar.notes.some((n) => /not known yet: Desk does not publish it/.test(n)))
})

// --------------------------------------------------------------- the map

// A map file (factory.site.map/2) with D5's keys: two waits for the next
// prompt, one labeled acceptance, one not labeled yet.
function mapFile(withWhy) {
  const g1 = { start_ms: 1 * H, end_ms: 19.7 * H, waited_on: "next_prompt", idle_by_waited_on_ms: { next_prompt: 18.7 * H } }
  const g2 = { start_ms: 20.7 * H, end_ms: 37.8 * H, waited_on: "next_prompt", idle_by_waited_on_ms: { next_prompt: 17.1 * H } }
  if (withWhy) {
    g1.idle_by_why_ms = { acceptance: 18.7 * H }
    g2.idle_by_why_ms = { not_known: 17.1 * H }
  }
  const waits = [
    { session: "s1", start_ms: 1 * H, end_ms: 19.7 * H, next_prompt_ms: 18.7 * H, stop: { end: "end_turn", asks: false, pending_agents: false }, why: "acceptance", why_source: "evaluator", confidence: "high", reasons: [] },
    { session: "s1", start_ms: 20.7 * H, end_ms: 37.8 * H, next_prompt_ms: 17.1 * H, stop: { end: "end_turn", asks: true, pending_agents: true }, why: "not_known", why_source: "none", confidence: null, reasons: ["not_labeled"] },
  ]
  return {
    schema: "factory.site.map/2",
    lead_window: { start_ms: 0, end_ms: 38.8 * H, state: "measured", reasons: [] },
    bursts: [
      { start_ms: 0, end_ms: 1 * H, working_ms: m(1 * H), sessions: ["s1"] },
      { start_ms: 19.7 * H, end_ms: 20.7 * H, working_ms: m(1 * H), sessions: ["s1"] },
      { start_ms: 37.8 * H, end_ms: 38.8 * H, working_ms: m(1 * H), sessions: ["s1"] },
    ],
    gaps: [g1, g2],
    sessions: [{ id: "s1", host: "claude-code", offset_ms: 0, end_ms: 38.8 * H }],
    human_turns: [
      { session: "s1", at_ms: 19.7 * H, basis: "after_stop", window_ms: 18.7 * H, prompt_class: "s", output_class: "m", why: withWhy ? "acceptance" : null },
      { session: "s1", at_ms: 37.8 * H, basis: "after_stop", window_ms: 17.1 * H, prompt_class: "xs", output_class: "l", why: withWhy ? "not_known" : null },
    ],
    waits: withWhy ? waits : [],
    prs: [],
  }
}

test("each triangle names why the agent stopped: a class, or why not known with its reason", () => {
  const model = W.mapModel(mapFile(true), { maxBoxes: 7 })
  const waits = model.items.filter((x) => x.type === "wait")
  assert.deepEqual(waits.map((w) => w.why), ["acceptance", "not_known"])
  assert.deepEqual(waits.map(W.waitTitle), ["waiting for the next prompt: agent asked for acceptance", "waiting for the next prompt: why not known (not labeled yet)"])
  // A wait that no recorded stop holds: the stop was not recorded.
  const f = mapFile(true)
  f.waits = []
  const w2 = W.mapModel(f, { maxBoxes: 7 }).items.filter((x) => x.type === "wait")[1]
  assert.equal(W.waitTitle(w2), "waiting for the next prompt: why not known (the stop was not recorded)")
})

test("with today's map the triangles keep their old words: no why is invented", () => {
  const waits = W.mapModel(mapFile(false), { maxBoxes: 7 }).items.filter((x) => x.type === "wait")
  assert.deepEqual(waits.map((w) => w.why), [null, null])
  assert.deepEqual(waits.map(W.waitTitle), ["next prompt (the agent had stopped)", "next prompt (the agent had stopped)"])
})

test("the wait drawer gives why, who decided it, its confidence and the stop facts, and no text", () => {
  const model = W.mapModel(mapFile(true), { maxBoxes: 7 })
  const [a, b] = model.items.filter((x) => x.type === "wait")
  const rowsA = new Map(W.drawer({ kind: "wait", item: a }, { model, lead_ms: 38.8 * H, origin_ms: 0 }).rows)
  assert.equal(rowsA.get("Why the agent stopped"), "human gate: acceptance, 19 hours")
  assert.equal(rowsA.get("Stop: why"), "it reported finished work for the operator's acceptance")
  assert.equal(rowsA.get("Stop: decided by"), "the evaluator's label")
  assert.equal(rowsA.get("Stop: confidence"), "high")
  assert.equal(rowsA.get("Stop: how the turn ended"), "it ended its turn normally; its last message did not end with a question mark; none of its own background agents was running")
  const dB = W.drawer({ kind: "wait", item: b }, { model, lead_ms: 38.8 * H, origin_ms: 0 })
  const rowsB = new Map(dB.rows)
  assert.equal(rowsB.get("Stop: why"), "not known (not labeled yet)")
  assert.equal(rowsB.get("Stop: confidence"), "none: not classified")
  assert.match(rowsB.get("Stop: how the turn ended"), /ended with a question mark; some of its own background agents were still running/)
  assert.equal(dB.why, "not_known")
  // Without Desk's split the drawer says why is not known yet.
  const m0 = W.mapModel(mapFile(false), { maxBoxes: 7 })
  const r0 = new Map(W.drawer({ kind: "wait", item: m0.items.find((x) => x.type === "wait") }, { model: m0 }).rows)
  assert.equal(r0.get("Why the agent stopped"), W.NOT_KNOWN_WHY)
})

test("the map file keeps each gap's and burst's split by why, as milliseconds, and leaves it out when Desk has none", () => {
  const env = (v) => ({ state: "partial", value: v, bound: "lower", reasons: ["stop_partly_classified"] })
  const report = { job: { id: "j" }, timeline: { gaps: [{ start_ms: 0, end_ms: 10, waited_on: "next_prompt", idle_by_waited_on_ms: { next_prompt: 10 }, idle_by_why_ms: { acceptance: env(6), stopped_short: env(0), not_known: m(4) } }], bursts: [{ start_ms: 10, end_ms: 20, working_ms: 5, idle_by_why_ms: { question: env(5) } }] } }
  const slim = W.slimMap(report, {})
  assert.deepEqual(slim.gaps[0].idle_by_why_ms, { acceptance: 6, not_known: 4 })
  assert.deepEqual(slim.bursts[0].idle_by_why_ms, { question: 5 })
  const old = W.slimMap({ job: { id: "j" }, timeline: { gaps: [{ start_ms: 0, end_ms: 10, waited_on: "next_prompt" }], bursts: [{ start_ms: 10, end_ms: 20, working_ms: 5 }] } }, {})
  assert.equal("idle_by_why_ms" in old.gaps[0], false)
  assert.equal("idle_by_why_ms" in old.bursts[0], false)
})

test("a prompt marker takes the class of the wait it ends, and the legend lists the classes drawn", () => {
  const f = mapFile(true)
  const clock = W.clockMarks(f, W.mapModel(f, { maxBoxes: 7 }))
  assert.deepEqual(clock.prompts.map((p) => p.why), ["acceptance", "not_known"])
  assert.deepEqual(W.whyKeysIn(clock), ["acceptance", "not_known"])
  assert.match(W.whyLegend(clock), /takes the color of why the agent had stopped/)
  const c0 = W.clockMarks(mapFile(false), W.mapModel(mapFile(false), { maxBoxes: 7 }))
  assert.match(W.whyLegend(c0), /not known yet: Desk does not publish why the agent stopped/)
})

test("a lede figure for a class lights the triangles of that class", () => {
  assert.equal(W.highlightSelector("why", { why: "acceptance" }), ".vsm-wait.has-why-acceptance, .lad-high.has-why-acceptance")
  assert.equal(W.highlightSelector("wait_cause", { cause: "next_prompt", why: "stopped_short" }), ".vsm-wait.has-why-stopped_short, .lad-high.has-why-stopped_short")
})

// ------------------------------------------------------- Rank causes, split

// causes.json with D5's children under waiting:next_prompt.
function causesDoc(children) {
  const parent = { cause: "waiting:next_prompt", waste: "waiting", total_ms: 40 * H, hours: 40, share: 0.8, cumulative_share: 0.8, jobs: ["j1", "j2"], spans: [{ job: "j1", start_ms: 1 * H, end_ms: 19.7 * H }] }
  if (children !== undefined) parent.children = children
  return {
    schema: "desk.factory.rollups/1",
    basis: "job_hours",
    state: "measured",
    reasons: [],
    n: 2,
    N: 3,
    references_per_cause: 10,
    total_ms: 50 * H,
    causes: [parent, { cause: "defects:shell", waste: "defects", total_ms: 10 * H, hours: 10, share: 0.2, cumulative_share: 1, jobs: ["j2"], spans: [] }],
  }
}
const child = (why, hours, jobs, extra) => ({ cause: `waiting:next_prompt:${why}`, parent: "waiting:next_prompt", waste: "waiting", total_ms: hours * H, hours, share: hours / 50, jobs, spans: [{ job: jobs[0], start_ms: 1 * H, end_ms: (1 + hours) * H }], ...(extra || {}) })
const kids = () => [child("stopped_short", 5, ["j1"]), child("question", 3, ["j2"]), child("acceptance", 20, ["j1", "j2"]), child("not_known", 12, ["j1"], { reasons: ["not_labeled"] })]

test("the next-prompt bar stacks by class, actionable classes from the base, then gates, then not known; the toggle turns it off", () => {
  const on = S.paretoModel(causesDoc(kids()), "all")
  const bar = on.bars.find((b) => b.key === "waiting:next_prompt")
  assert.equal(bar.why_split, "on")
  assert.deepEqual(bar.children.map((c) => c.why), ["stopped_short", "question", "acceptance", "not_known"])
  assert.equal(bar.children.reduce((a, c) => a + c.ms, 0), bar.ms)
  assert.equal(bar.children[0].href, "#/causes/waiting:next_prompt:stopped_short")
  // The ranking and its running total are the parent's: the split adds no bar.
  assert.deepEqual(on.bars.map((b) => b.key), ["waiting:next_prompt", "defects:shell"])
  const off = S.paretoModel(causesDoc(kids()), "all", { split: false })
  assert.equal(off.bars[0].why_split, "off")
})

test("the Pareto never splits wrongly: no children is 'absent', children that do not add up are 'mismatch'", () => {
  assert.equal(S.paretoModel(causesDoc(), "all").bars[0].why_split, "absent")
  assert.equal(S.paretoModel(causesDoc([child("acceptance", 20, ["j1"])]), "all").bars[0].why_split, "mismatch")
})

test("each why has its own route, and only the known classes are routes", () => {
  for (const k of W.WHY_KEYS) assert.deepEqual(F.parseRoute(`#/causes/waiting:next_prompt:${k}`), { view: "cause", cause: `waiting:next_prompt:${k}` })
  assert.deepEqual(F.parseRoute("#/causes/waiting%3Anext_prompt%3Astopped_short"), { view: "cause", cause: "waiting:next_prompt:stopped_short" })
  for (const bad of ["#/causes/waiting:next_prompt:nope", "#/causes/defects:shell:stopped_short", "#/causes/waiting:next_prompt:stopped_short:x"]) assert.deepEqual(F.parseRoute(bad), { view: "missing" }, bad)
  assert.equal(W.causeWords("waiting:next_prompt:stopped_short"), "Waiting · next prompt · stopped short")
  assert.equal(S.causeRoute("waiting:next_prompt:acceptance"), "#/causes/waiting:next_prompt:acceptance")
})

test("a why's page has its time, its share of the next-prompt waiting, its tasks with their own stated figures, and a state for every gap in the data", () => {
  const taskRows = [
    { job: "j1", next_prompt_by_why_ms: { stopped_short: lower(5 * H) } },
    { job: "j2", next_prompt_by_why_ms: { stopped_short: m(0) } },
  ]
  const d = S.causeDetail(causesDoc(kids()), "waiting:next_prompt:stopped_short", { taskRows })
  assert.equal(d.state, "ok")
  assert.equal(d.ms, 5 * H)
  assert.equal(d.child.share_of_parent, 5 / 40)
  assert.equal(d.child.rank, 2)
  assert.equal(d.child.of, 3)
  assert.deepEqual(d.tasks.map((t) => [t.job, t.ms, t.bound]), [["j1", 5 * H, "lower"]])
  assert.match(S.causeMeaning("waiting:next_prompt:stopped_short"), /it stopped short: its authorization covered the next step/)
  assert.match(S.causeMeaning("waiting:next_prompt:decision"), /human gate/)
  assert.equal(S.causeDetail(causesDoc(), "waiting:next_prompt:stopped_short", {}).state, "not_split")
  assert.equal(S.causeDetail(causesDoc(kids()), "waiting:next_prompt:interrupted", {}).state, "none")
  const nothing = causesDoc(kids())
  nothing.causes = nothing.causes.slice(1)
  assert.equal(S.causeDetail(nothing, "waiting:next_prompt:stopped_short", {}).state, "not_ranked")
})

test("a why's page lists every wait of that class from the tasks' map files, with its stop facts, source and confidence, longest first", () => {
  const d = S.causeDetail(causesDoc([child("acceptance", 18.7, ["j1"]), child("not_known", 21.3, ["j1"], { reasons: ["not_labeled"] })]), "waiting:next_prompt:acceptance", {})
  const out = S.whyWaitRows(d, { j1: mapFile(true) })
  assert.equal(out.rows.length, 1)
  const r = out.rows[0]
  assert.equal(r.ms, 18.7 * H)
  assert.equal(r.source, "the evaluator's label")
  assert.equal(r.confidence, "high")
  assert.match(r.stop, /ended its turn normally/)
  assert.deepEqual(r.item, { kind: "gaps", n: 1 })
  assert.equal(out.rest_ms, 0)
  // A task whose map file is not published is named, not dropped.
  assert.deepEqual(S.whyWaitRows(d, {}).missing, ["j1"])
})

test("Copy as a prompt asks the why's A3 question and says where its data sits", () => {
  const d = S.causeDetail(causesDoc(kids()), "waiting:next_prompt:stopped_short", { taskRows: [{ job: "j1", next_prompt_by_why_ms: { stopped_short: lower(5 * H) } }] })
  const t = S.a3Prompt(d, { route: "https://x.test/#/causes/waiting:next_prompt:stopped_short", dataUrl: "https://x.test/rollups/causes.json" })
  assert.match(t, /why do agents stop short of what their authorization covers\?/)
  assert.match(t, /the entry with cause "waiting:next_prompt:stopped_short" in the children of the entry with cause "waiting:next_prompt"/)
  assert.match(t, /at least 13% \(up to 43%\) of the 40 hours of waiting for the next prompt/)
  assert.match(t, /at least 5 hours/)
  for (const k of W.WHY_KEYS) assert.ok(S.WHY_A3[k], k)
})

// ------------------------------------------------- colors, page and index

test("every class has its own color in both themes and a pattern, so no class is told by hue alone", () => {
  const css = read("site/src/styles.css")
  const html = read("site/src/index.html")
  const light = css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"))
  const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"))
  for (const k of ["stopped_short", "question", "error_limit", "interrupted", "gate"]) {
    assert.match(light, new RegExp(`--c-why-${k}:`), `light ${k}`)
    assert.match(dark, new RegExp(`--c-why-${k}:`), `dark ${k}`)
  }
  for (const k of W.WHY_KEYS) {
    assert.match(css, new RegExp(`\\.why-fill-${k}\\b`), `css fill ${k}`)
    assert.match(html, new RegExp(`id="why-pat-${k}"`), `svg pattern ${k}`)
  }
})

test("llms.txt describes every new key and the sub-cause routes", () => {
  const t = read("site/src/llms-template.txt")
  for (const k of ["next_prompt_by_why_ms", "not_known_by_reason_ms", "idle_by_why_ms", "waits[]", "why_source", "longest_gap", "children", "waiting:next_prompt:<why>", "stop_partly_classified"]) assert.ok(t.includes(k), k)
  for (const k of W.WHY_KEYS) assert.ok(t.includes(`\`${k}\``), k)
})

test("the page draws the split: the Pareto toggle is on by default and every why view is wired", () => {
  const html = read("site/src/index.html")
  assert.match(html, /id="why-toggle"[^>]*aria-pressed="true"/)
  assert.match(html, /Split by why/)
  const app = read("site/src/app.js")
  for (const name of ["whyFill", "drawWhyLegend", "renderWhyWaits"]) assert.match(app, new RegExp(`function ${name}\\(`), name)
})

// ------------------------------------------- review fix round 1 (S5 v1.1)

test("I1: while some time has no known why, every class figure states its floor and its ceiling (at least X, up to X + not known)", () => {
  // The lede: each class it names, and the summed rest.
  const t = ledeOf(partlyRow())
  assert.match(t, /at least 17 hours \(up to 34 hours\) came after it reported finished work for acceptance, at least 2 hours \(up to 19 hours\) after it stopped short/)
  const many = row({ acceptance: 5 * H, stopped_short: 4 * H, question: 3 * H, decision: 2 * H, error_limit: 1 * H }, { notKnown: 6 * H, reasons: { not_labeled: m(6 * H) } })
  assert.match(ledeOf(many), /at least 3 hours \(up to 9 hours\) after 2 other kinds of stop/)
  // Fully classified: no bound, no ceiling.
  assert.doesNotMatch(ledeOf(row({ acceptance: 5 * H, stopped_short: 2 * H })), /up to/)
  // The time bar's class segments carry their ceiling.
  const r = partlyRow()
  const wait = W.timeBar(stackOf(r), r, W.idleSplit(r, null), segs).groups[1].segments
  assert.equal(wait.find((x) => x.why === "acceptance").ceiling_ms, 34 * H)
  assert.equal(wait.find((x) => x.why === "not_known").ceiling_ms, undefined)
  assert.equal(W.boundedWords(17.1 * H, 34 * H, W.durationWords), "at least 17 hours (up to 34 hours)")
  assert.equal(W.boundedWords(5 * H, 5 * H, W.durationWords), "5 hours")
})

test("I1: the Pareto children, a why's page, its tasks and its A3 prompt state the ceiling", () => {
  const bar = S.paretoModel(causesDoc(kids()), "all").bars[0]
  const ss = bar.children.find((c) => c.why === "stopped_short")
  assert.equal(ss.bound, "lower")
  assert.equal(ss.ceiling_ms, 17 * H)
  assert.equal(S.whyAmountWords(ss), "at least 5 hours (up to 17 hours)")
  assert.equal(S.whyShareWords(ss), "at least 13% (up to 43%)")
  assert.equal(S.whyAmountWords(ss, true), "≥5h (≤17h)")
  const nk = bar.children.find((c) => c.why === "not_known")
  assert.equal(nk.bound, null)
  assert.equal(S.whyAmountWords(nk), "12 hours")
  const exact = S.paretoModel(causesDoc([child("stopped_short", 10, ["j1"]), child("acceptance", 30, ["j1"])]), "all").bars[0]
  assert.equal(S.whyAmountWords(exact.children[0]), "10 hours")
  const taskRows = [{ job: "j1", next_prompt_by_why_ms: { stopped_short: lower(5 * H), not_known: m(12 * H) } }]
  const d = S.causeDetail(causesDoc(kids()), "waiting:next_prompt:stopped_short", { taskRows })
  assert.equal(d.ceiling_ms, 17 * H)
  assert.equal(d.tasks[0].ceiling_ms, 17 * H)
  assert.match(S.whyCauseLede(d), /it cost at least 5 hours \(up to 17 hours\) \(counted per task\): at least 13% \(up to 43%\) of the 40 hours of/)
  const a3 = S.a3Prompt(d, { route: "r", dataUrl: "u" })
  assert.match(a3, /It cost at least 5 hours \(up to 17 hours\), counted per task/)
  assert.match(a3, /at least 13% \(up to 43%\) of the 40 hours of waiting for the next prompt/)
  assert.match(a3, /factory task j1, at least 5 hours \(up to 17 hours\)/)
})

test("I2: a class with no classified wait is never stated as zero while some time has no known why", () => {
  const d = S.causeDetail(causesDoc(kids()), "waiting:next_prompt:interrupted", {})
  assert.equal(d.state, "none")
  assert.equal(d.not_known_ms, 12 * H)
  assert.deepEqual(d.not_known_reasons, ["not_labeled"])
  const t = S.whyCauseLede(d)
  assert.match(t, /No wait is classified as interrupted by the operator yet\. Up to 12 hours of the 40 hours of .* whose why is not known may hold some \(why: not labeled yet\)\./)
  assert.doesNotMatch(t, /^None|None of/)
  // With every wait classified, "none" is a true zero.
  const all = S.causeDetail(causesDoc([child("stopped_short", 10, ["j1"]), child("acceptance", 30, ["j1"])]), "waiting:next_prompt:interrupted", {})
  assert.match(S.whyCauseLede(all), /None of the 40 hours of .* has this why: every one of them is classified\./)
})

test("m3: a why's page ranks only the known classes, and not known is the unclassified part", () => {
  const d = S.causeDetail(causesDoc(kids()), "waiting:next_prompt:stopped_short", {})
  assert.equal(d.child.rank, 2)
  assert.equal(d.child.of, 3)
  assert.match(S.whyCauseLede(d), /the 2nd of 3 known reasons the agent stopped, by time/)
  const n = S.causeDetail(causesDoc(kids()), "waiting:next_prompt:not_known", {})
  assert.equal(n.child.rank, null)
  const t = S.whyCauseLede(n)
  assert.match(t, /the part of the waiting whose why is not classified/)
  // m2: the stop's own reason words, never the waste labels'.
  assert.match(t, /Why it is not known: not labeled yet\./)
  assert.doesNotMatch(t, /for waste/)
  assert.doesNotMatch(S.a3Prompt(n, { route: "r", dataUrl: "u" }), /of \d+ reasons the agent stopped/)
})

test("m1: the toggle is disabled, never pressed, when there is nothing to split", () => {
  const on = S.paretoModel(causesDoc(kids()), "all")
  assert.deepEqual(S.whyToggleState(on), { state: "on", pressed: true, disabled: false, note: "" })
  assert.equal(S.whyToggleState(S.paretoModel(causesDoc(kids()), "all", { split: false })).pressed, false)
  const none = S.whyToggleState(S.paretoModel(causesDoc(), "all"))
  assert.equal(none.disabled, true)
  assert.equal(none.pressed, false)
  assert.match(none.note, /nothing to split/)
  assert.equal(S.whyToggleState(S.paretoModel(causesDoc([child("acceptance", 20, ["j1"])]), "all")).disabled, true)
  const app = read("site/src/app.js")
  assert.match(app, /aria-disabled/)
})

test("m4: a mixed wait is labeled mostly its largest class and lights for every class it holds", () => {
  const f = mapFile(true)
  f.gaps[0].idle_by_why_ms = { acceptance: 12 * H, stopped_short: 6.7 * H }
  const w = W.mapModel(f, { maxBoxes: 7 }).items.filter((x) => x.type === "wait")[0]
  assert.deepEqual(w.whys, ["stopped_short", "acceptance"])
  assert.equal(W.waitTitle(w), "waiting for the next prompt: mostly agent asked for acceptance")
  assert.equal(W.highlightSelector("why", { why: "stopped_short" }), ".vsm-wait.has-why-stopped_short, .lad-high.has-why-stopped_short")
  assert.equal(W.highlightSelector("wait_cause", { cause: "next_prompt", why: "stopped_short" }), ".vsm-wait.has-why-stopped_short, .lad-high.has-why-stopped_short")
  assert.match(read("site/src/app.js"), /has-why-\$\{/)
})

test("m5: the wait drawer's prompt names why the agent stopped", () => {
  const model = W.mapModel(mapFile(true), { maxBoxes: 7 })
  const a = model.items.filter((x) => x.type === "wait")[0]
  const p = W.promptText({ ...W.promptItem({ kind: "wait", item: a }, { model, origin_ms: 0 }), name: "825084c9", route: "r", dataUrl: "u" })
  assert.match(p, /why the agent stopped: human gate: acceptance, 19 hours/)
})

test("m7: the legend promises a class color only where a mark holds one prompt", () => {
  const f = mapFile(true)
  const clock = W.clockMarks(f, W.mapModel(f, { maxBoxes: 7 }))
  assert.match(W.whyLegend(clock), /^Where a mark holds one prompt, it takes the color of why the agent had stopped before it/)
})

test("I1: Desk's own bound on a class row is used where it is stated", () => {
  const stated = [child("stopped_short", 5, ["j1"], { bound: "lower", reasons: ["stop_partly_classified"] }), child("acceptance", 23, ["j1"], { bound: "lower", reasons: ["stop_partly_classified"] }), child("not_known", 12, ["j1"], { reasons: ["not_labeled"] })]
  const ss = S.paretoModel(causesDoc(stated), "all").bars[0].children[0]
  assert.equal(ss.bound, "lower")
  assert.equal(S.whyAmountWords(ss), "at least 5 hours (up to 17 hours)")
  // A class Desk states as exact stays exact.
  const exact = [child("stopped_short", 10, ["j1"], { reasons: [] }), child("acceptance", 30, ["j1"], { reasons: [] })]
  assert.equal(S.paretoModel(causesDoc(exact), "all").bars[0].children[0].bound, null)
  // A lower bound with no known ceiling still says at least.
  assert.equal(S.whyAmountWords({ ms: 5 * H, bound: "lower" }), "at least 5 hours")
})
