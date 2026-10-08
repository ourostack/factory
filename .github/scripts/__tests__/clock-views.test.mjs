// The human-agent clock views (design v1.1 addendum §3, brief S4): where
// each operator prompt and each pull request time sits on the value stream
// map and its ladder, how marks within one pixel merge into a count, the
// Handoffs table, the prompt and pull request drawers and their prompts for
// an agent, the list states in words, and the page text that no longer says
// prompts and pull requests stay off the clock.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const W = require("../../../site/src/walk.js")
const F = require("../../../site/src/format.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

const S = 1000
const M = 60 * S
const H = 60 * M
const m = (value) => ({ state: "measured", value, reasons: [] })

// Two work bursts with a wait between them: burst 1 from 0 to 1h, a
// next-prompt wait from 1h to 3h, burst 2 from 3h to 4h. The second prompt
// ends the wait, so it sits at the start of burst 2.
function twoBursts(over = {}) {
  return {
    lead_window: { state: "measured", reasons: [], start_ms: 0, end_ms: 4 * H },
    bursts: [
      { start_ms: 0, end_ms: H, working_ms: H, sessions: ["s1"], operator_turns: m(1), prs: m(1) },
      { start_ms: 3 * H, end_ms: 4 * H, working_ms: H, sessions: ["s1"], operator_turns: m(1), prs: m(0) },
    ],
    gaps: [{ start_ms: H, end_ms: 3 * H, waited_on: "next_prompt" }],
    sessions: [{ id: "s1", host: "claude-code", offset_ms: 0, end_ms: 4 * H }],
    human_turns_state: { state: "measured", reasons: [], basis: "store_from_hosts" },
    prs_state: { state: "partial", bound: "lower", reasons: ["host_records_partly"], basis: "store_from_hosts" },
    human_turns: [
      // Out of clock order on purpose: the marks are numbered in clock order.
      { session: "s1", host: "claude-code", at_ms: 3 * H, basis: "after_stop", window_ms: 2 * H, prompt_class: "s", output_class: "l", why: null },
      { session: "s1", host: "claude-code", at_ms: 0, basis: "first", window_ms: null, prompt_class: "m", output_class: "none", why: null },
    ],
    waits: [],
    prs: [
      { repo: "o/r", number: 7, created: true, opened_at_ms: 30 * M, opened_basis: "desk", opened_state: { state: "measured", reasons: [] }, merged_at_ms: 3.5 * H, merged_basis: "pr_anchor", merged_state: { state: "measured", reasons: [] }, state: "merged", reasons: [] },
      { repo: "o/r", number: 8, created: null, opened_at_ms: 3.25 * H, opened_basis: "pr_anchor", opened_state: { state: "partial", bound: "upper", reasons: ["anchor_unconfirmed"] }, merged_at_ms: null, merged_basis: "not_merged", merged_state: { state: "unavailable", reasons: ["not_merged"] }, state: "open", reasons: ["anchor_unconfirmed"], uncertainty_ms: 40 * S },
      { repo: "o/r", number: 9, created: null, opened_at_ms: null, opened_basis: "not_placed", opened_state: { state: "unavailable", reasons: ["anchor_spread_too_wide"] }, merged_at_ms: null, merged_basis: "not_placed", merged_state: { state: "unavailable", reasons: ["anchor_spread_too_wide"] }, state: "merged", reasons: ["anchor_spread_too_wide"] },
      { repo: "o/r", number: 10, created: null, opened_at_ms: null, opened_basis: "not_placed", opened_state: { state: "unavailable", reasons: ["github_lookup_capped"] }, merged_at_ms: null, merged_basis: "not_placed", merged_state: { state: "unavailable", reasons: ["github_lookup_capped"] }, state: null, reasons: ["github_lookup_capped"] },
    ],
    ...over,
  }
}

test("a time on the task clock is placed on the map item that holds it: a prompt that ends a wait sits at the start of the next box", () => {
  const model = W.mapModel(twoBursts(), { maxBoxes: 7 })
  assert.deepEqual(model.items.map((x) => x.type), ["box", "wait", "box"])
  assert.deepEqual(W.placeOnMap(model, 0), { item: 0, frac: 0, outside: null })
  assert.deepEqual(W.placeOnMap(model, 30 * M), { item: 0, frac: 0.5, outside: null })
  assert.deepEqual(W.placeOnMap(model, H), { item: 1, frac: 0, outside: null }, "a burst's end is the wait's start")
  assert.deepEqual(W.placeOnMap(model, 3 * H), { item: 2, frac: 0, outside: null }, "the wait's end is the next box's start")
  assert.deepEqual(W.placeOnMap(model, 4 * H), { item: 2, frac: 1, outside: null }, "the lead window's end stays on the last item")
  // A time outside the lead window sits at the nearest end, and says so.
  assert.deepEqual(W.placeOnMap(model, -5 * M), { item: 0, frac: 0, outside: "before" })
  assert.deepEqual(W.placeOnMap(model, 5 * H), { item: 2, frac: 1, outside: "after" })
  assert.equal(W.placeOnMap(model, null), null)
  assert.equal(W.placeOnMap(model, Number.NaN), null)
  assert.equal(W.placeOnMap({ items: [] }, 0), null)
})

test("the clock marks number the prompts in clock order, place each pull request time that has one, and list the rest at task level, never drawn", () => {
  const map = twoBursts()
  const model = W.mapModel(map, { maxBoxes: 7 })
  const c = W.clockMarks(map, model)
  assert.deepEqual(c.prompts.map((p) => [p.n, p.ms, p.item, p.idx]), [[1, 0, 0, 1], [2, 3 * H, 2, 0]])
  assert.equal(c.prompts[0].total, 2)
  // The top row: the prompts each box starts.
  assert.deepEqual(c.by_item, { 0: [0], 2: [1] })
  // Pull request times: #7 opened and merged, #8 opened (partial, at most), #9 and #10 not placed.
  assert.deepEqual(c.prs.map((x) => [x.pr.number, x.kind, x.ms, x.item, x.state, x.bound]), [
    [7, "opened", 30 * M, 0, "measured", null],
    [8, "opened", 3.25 * H, 2, "partial", "upper"],
    [7, "merged", 3.5 * H, 2, "measured", null],
  ])
  assert.deepEqual(c.unplaced.map((x) => [x.pr.number, x.what, x.reasons]), [
    [9, "opened", ["anchor_spread_too_wide"]],
    [9, "merged", ["anchor_spread_too_wide"]],
    [10, "opened", ["github_lookup_capped"]],
  ])
  // A pull request that has not merged has no merge to place, so it is not listed as missing one.
  assert.ok(!c.unplaced.some((x) => x.pr.number === 8))
  // Task 23e26d3f's shape: no time placed, so no mark at all.
  const none = W.clockMarks({ ...map, prs: map.prs.slice(2) }, model)
  assert.equal(none.prs.length, 0)
  assert.equal(none.unplaced.length, 3)
  // A map with no clock data draws nothing and lists nothing.
  const empty = W.clockMarks({ bursts: map.bursts, gaps: map.gaps }, model)
  assert.deepEqual([empty.prompts, empty.prs, empty.unplaced, empty.by_item], [[], [], [], {}])
})

test("a prompt joins the wait it ends: same session, the wait's end equal to the prompt's time", () => {
  const map = twoBursts({ waits: [{ session: "s1", start_ms: H, end_ms: 3 * H, next_prompt_ms: 2 * H, stop: { end: "end_turn", asks: false, pending_agents: false }, why: "acceptance", why_source: "evaluator", confidence: "high", reasons: [] }, { session: "other", start_ms: 0, end_ms: 3 * H, why: "decision" }] })
  const c = W.clockMarks(map, W.mapModel(map, { maxBoxes: 7 }))
  assert.equal(c.prompts[1].wait.why, "acceptance")
  assert.equal(c.prompts[0].wait, null)
  assert.equal(c.prompts[1].why, "acceptance", "the why comes from the wait when the turn has none")
  assert.equal(c.prompts[0].why, "not_known")
})

test("ladder marks within one pixel merge into a count; marks in different items never merge", () => {
  const map = twoBursts({
    human_turns: [
      { session: "s1", at_ms: 3 * H, basis: "after_stop", window_ms: 2 * H, prompt_class: "s", output_class: "l" },
      { session: "s1", at_ms: 3 * H + 10 * S, basis: "mid_turn", window_ms: 10 * S, prompt_class: "xs", output_class: "none" },
      { session: "s1", at_ms: 3 * H + 30 * M, basis: "mid_turn", window_ms: 30 * M, prompt_class: "xs", output_class: "none" },
    ],
  })
  const model = W.mapModel(map, { maxBoxes: 7 })
  const c = W.clockMarks(map, model)
  // Each item's ladder is 100 pixels: 10 seconds of a one-hour box is 0.28 px.
  const groups = W.ladderMarks(c, [100, 100, 100])
  const inBox2 = groups.filter((g) => g.item === 2)
  assert.deepEqual(inBox2.map((g) => [Math.round(g.pos), g.marks.map((x) => x.kind)]), [[0, ["prompt", "prompt"]], [50, ["prompt", "merged"]], [25, ["opened"]]].sort((a, b) => a[0] - b[0]))
  assert.equal(inBox2[0].count, 2)
  // Box 1 holds pull request 7's opening alone.
  assert.deepEqual(groups.filter((g) => g.item === 0).map((g) => [g.pos, g.count]), [[50, 1]])
  // Two pixels apart stay apart.
  const wide = W.ladderMarks(c, [100, 100, 100000])
  assert.deepEqual(wide.filter((g) => g.item === 2).slice(0, 2).map((g) => g.count), [1, 1])
  // The page merges marks closer than one mark's width (16 px), measured from the group's first mark.
  const page = W.ladderMarks(c, [100, 100, 100], 16)
  assert.deepEqual(page.filter((g) => g.item === 2).map((g) => [Math.round(g.pos), g.count]), [[0, 2], [25, 1], [50, 2]])
  assert.deepEqual(W.ladderMarks(c, [100, 100, 20], 16).filter((g) => g.item === 2).map((g) => g.count), [5])
  // Each group carries a text equivalent.
  assert.match(inBox2[0].label, /^2 marks: operator prompts 1 and 2$/)
  assert.match(inBox2[2].label, /^2 marks: operator prompt 3; pull request o\/r#7 merged$/)
  assert.equal(groups.find((g) => g.item === 0).label, "Pull request o/r#7 opened")
})

test("the Handoffs table has one row per prompt, in clock order, with the wait before it, why the agent stopped and the size classes", () => {
  const map = twoBursts({ waits: [{ session: "s1", start_ms: H, end_ms: 3 * H, next_prompt_ms: 2 * H - 5 * M, why: null, why_source: "none", reasons: ["not_labeled"] }] })
  const c = W.clockMarks(map, W.mapModel(map, { maxBoxes: 7 }))
  const rows = W.handoffRows(c, 0, F.reasonText)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.n), [1, 2])
  assert.equal(rows[0].clock, "at the task's start")
  assert.equal(rows[0].basis, "the session's first prompt")
  assert.equal(rows[0].waited, "none: the session's first prompt")
  assert.equal(rows[0].counted, "—", "a first prompt follows no stop")
  assert.equal(rows[0].why, "—")
  // An after-stop prompt with no wait from Desk reads not recorded; the caption says why once.
  const bare = W.handoffRows(W.clockMarks(twoBursts(), W.mapModel(twoBursts(), { maxBoxes: 7 })), 0, F.reasonText)
  assert.deepEqual([bare[1].counted, bare[1].why], ["not recorded", "not recorded"])
  assert.equal(rows[0].prompt, "medium (201 to 1,000 characters)")
  assert.equal(rows[0].output, "none")
  assert.equal(rows[1].clock, "3 hours after the task's start")
  assert.equal(rows[1].waited, "2 hours since the agent stopped")
  assert.equal(rows[1].counted, "1.9 hours")
  assert.equal(rows[1].why, "not known (not labeled for waste yet)")
  assert.equal(rows[1].prompt, "short (21 to 200 characters)")
  assert.equal(rows[1].output, "long (1,001 to 5,000 characters)")
  // A prompt before the task's start says so.
  assert.equal(W.clockAt(-90 * S, 0), "2 minutes before the task's start")
  assert.equal(W.clockAt(30 * S, 0), "30 seconds after the task's start")
})

test("the prompt and pull request lists state why they are empty: a host that records no prompts reads not recorded, never zero", () => {
  const words = (s) => W.clockListWords(s, "operator prompts", F.reasonText)
  assert.equal(words({ state: "measured", reasons: [] }), null)
  assert.equal(words({ state: "unavailable", reasons: ["host_does_not_record"] }), "operator prompts not recorded (the host does not record them)")
  assert.equal(words({ state: "unavailable", reasons: ["not_recorded"] }), "operator prompts not recorded (the store has no record of this)")
  assert.equal(words({ state: "partial", bound: "lower", reasons: ["host_records_partly"] }), "operator prompts only partly recorded, so there may be more than these (the host records only part of this, so the figure is a lower bound)")
  assert.equal(words(null), "operator prompts not recorded (the store has no record of this)")
})

test("a pull request time in words states its direction when it is partial, and its reason when it is not placed", () => {
  const t = (ms, st) => W.prTimeWords(ms, st, 0, F.reasonText)
  assert.equal(t(30 * M, { state: "measured", reasons: [] }), "30 minutes after the task's start")
  assert.equal(t(30 * M, { state: "partial", bound: "upper", reasons: ["anchor_unconfirmed"] }), "at most 30 minutes after the task's start: it happened then or earlier")
  assert.equal(t(30 * M, { state: "partial", bound: "lower", reasons: ["clock_skew"] }), "at least 30 minutes after the task's start: it happened then or later")
  assert.equal(t(30 * M, { state: "partial", bound: null, reasons: ["anchor_spread"] }), "about 30 minutes after the task's start; which way it may be off is not known")
  assert.match(t(null, { state: "unavailable", reasons: ["github_lookup_capped"] }), /^not placed on the task clock: the build reads a limited number/)
})

test("the drawer for a prompt gives its time, the wait before it, why the agent stopped, and the size classes; never the prompt's text", () => {
  const map = twoBursts({ waits: [{ session: "s1", start_ms: H, end_ms: 3 * H, next_prompt_ms: 2 * H, stop: { end: "end_turn", asks: true, pending_agents: false }, why: "acceptance", why_source: "evaluator", confidence: "medium", reasons: [] }] })
  const model = W.mapModel(map, { maxBoxes: 7 })
  const c = W.clockMarks(map, model)
  const d = W.drawer({ kind: "prompt", mark: c.prompts[1] }, { origin_ms: 0, lead_ms: 4 * H, reasonText: F.reasonText, model })
  assert.equal(d.title, "Operator prompt 2 of 2")
  assert.equal(d.mark, "prompt")
  const rows = Object.fromEntries(d.rows)
  assert.equal(rows["What it is"], "A prompt from the operator, after the agent had stopped")
  assert.equal(rows["On the task clock"], "3 hours after the task's start, at the start of work box 2 of 2")
  assert.equal(rows.Session, "session s1")
  assert.equal(rows["Wait before it"], "2 hours since the agent stopped")
  assert.equal(rows["Counted as waiting"], "2 hours (50% of the lead time)")
  assert.equal(rows["Why the agent stopped"], "it reported finished work for the operator's acceptance (the evaluator's label, medium confidence)")
  assert.equal(rows["How the agent's turn ended"], "it ended its turn normally; its last message ended with a question mark; none of its own background agents was running")
  assert.equal(rows["Prompt size"], "short (21 to 200 characters)")
  assert.equal(rows["Output the operator read"], "long (1,001 to 5,000 characters)")
  assert.ok(!JSON.stringify(d).includes("text\""), "no text field")
  // The session's first prompt follows no stop.
  const first = Object.fromEntries(W.drawer({ kind: "prompt", mark: c.prompts[0] }, { origin_ms: 0, lead_ms: 4 * H, reasonText: F.reasonText, model }).rows)
  assert.equal(first["Why the agent stopped"], "no stop before it: the session's first prompt")
  assert.equal(first["How the agent's turn ended"], undefined)
  // With no wait from Desk, the why is not known, with its reason.
  const bare = W.clockMarks(twoBursts(), model)
  const after = Object.fromEntries(W.drawer({ kind: "prompt", mark: bare.prompts[1] }, { origin_ms: 0, lead_ms: 4 * H, reasonText: F.reasonText, model }).rows)
  assert.equal(after["Why the agent stopped"], "not known: Desk does not record why the agent stopped before this prompt yet")
  assert.equal(after["Counted as waiting"], "not recorded: Desk does not publish the wait before this prompt yet")
  // A prompt outside the lead window says where it fell.
  const out = W.clockMarks(twoBursts({ human_turns: [{ session: "s1", at_ms: -2 * M, basis: "first", window_ms: null, prompt_class: "m", output_class: "none" }] }), model)
  assert.equal(Object.fromEntries(W.drawer({ kind: "prompt", mark: out.prompts[0] }, { origin_ms: 0, model }).rows)["On the task clock"], "2 minutes before the task's start, before the task's lead time began (drawn at its start)")
})

test("the drawer for a pull request gives its opened and merged times with their basis, how far off they may be, and the time from opening to merge", () => {
  const map = twoBursts()
  const model = W.mapModel(map, { maxBoxes: 7 })
  const ctx = { origin_ms: 0, lead_ms: 4 * H, reasonText: F.reasonText, model }
  const d = W.drawer({ kind: "pr", pr: map.prs[0], k: 0 }, ctx)
  assert.equal(d.title, "Pull request o/r#7")
  assert.equal(d.mark, "merged")
  const r = Object.fromEntries(d.rows)
  assert.equal(r["What it is"], "A pull request this task opened; it merged")
  assert.equal(r.Opened, "30 minutes after the task's start")
  assert.equal(r["Opened, from"], "the session that opened it, which timed it")
  assert.equal(r.Merged, "3.5 hours after the task's start")
  assert.equal(r["Merged, from"], "GitHub's merge time, placed through the task's clock anchor (to within seconds)")
  assert.equal(r["Opening to merge"], "3 hours")
  const p = Object.fromEntries(W.drawer({ kind: "pr", pr: map.prs[1], k: 1 }, ctx).rows)
  assert.equal(p["What it is"], "A pull request this task's sessions referenced; it is open")
  assert.equal(p.Opened, "at most 3.3 hours after the task's start: it happened then or earlier")
  assert.equal(p["Opened, from"], "GitHub's opening time, placed through the task's clock anchor")
  assert.equal(p.Merged, "not merged")
  assert.equal(p["How far off"], "up to 40 seconds, as far as the task's pull requests show")
  assert.match(p["Why partial"], /^nothing confirms when the task started/)
  assert.equal(p["Opening to merge"], undefined)
  const n = Object.fromEntries(W.drawer({ kind: "pr", pr: map.prs[2], k: 2 }, ctx).rows)
  assert.match(n.Opened, /^not placed on the task clock: the task's pull requests disagree by more than 15 minutes/)
  assert.match(n.Merged, /^not placed on the task clock/)
})

test("Copy as a prompt names the prompt or pull request, where it sits, the link that opens it, and where it is in the map file", () => {
  const map = twoBursts()
  const model = W.mapModel(map, { maxBoxes: 7 })
  const c = W.clockMarks(map, model)
  const p = W.promptItem({ kind: "prompt", mark: c.prompts[1] }, { origin_ms: 0, model })
  assert.equal(p.what, "operator prompt 2 of 2 (after the agent had stopped)")
  assert.equal(p.where, "It came at minute 180 after the task's start, 2 hours after the agent stopped; the page never shows a prompt's text")
  assert.equal(p.locator, "human_turns[0]")
  assert.equal(p.select, "prompt=2")
  const q = W.promptItem({ kind: "pr", pr: map.prs[0], k: 0 }, { origin_ms: 0, model })
  assert.equal(q.what, "pull request o/r#7")
  assert.equal(q.where, "It was opened at minute 30 and merged at minute 210 after the task's start")
  assert.equal(q.locator, "prs[0]")
  assert.equal(q.select, "pr=1")
  // The deep links parse.
  assert.deepEqual(F.parseRoute("#/task/abc?prompt=2"), { view: "task", job: "abc", select: { kind: "prompt", from: 2, to: 2 } })
  assert.deepEqual(F.parseRoute("#/task/abc?pr=1"), { view: "task", job: "abc", select: { kind: "pr", from: 1, to: 1 } })
})

test("the data box shows the pull requests opened in each box again", () => {
  const model = W.mapModel(twoBursts(), { maxBoxes: 7 })
  const rows = W.dataBox(model.items[0], model.session_count)
  assert.deepEqual(rows.map((r) => r.label), ["Working time", "Agents", "Tool calls", "Failed tool calls", "Operator turns", "Pull requests opened", "Session"])
  assert.equal(rows.find((r) => r.key === "prs").text, "1")
  // A partial count says at least; no count reads not recorded.
  const partial = W.mapModel(twoBursts({ bursts: [{ start_ms: 0, end_ms: H, working_ms: H, prs: { state: "partial", bound: "lower", value: 2, reasons: ["host_records_partly"] } }], gaps: [] }), { maxBoxes: 7 })
  assert.equal(W.dataBox(partial.items[0], 1).find((r) => r.key === "prs").text, "at least 2")
  const none = W.mapModel(twoBursts({ bursts: [{ start_ms: 0, end_ms: H, working_ms: H }], gaps: [] }), { maxBoxes: 7 })
  assert.equal(W.dataBox(none.items[0], 1).find((r) => r.key === "prs").text, "not recorded")
})

test("a wait and a labeled pause now carry their start and end on the task clock", () => {
  const map = twoBursts()
  const model = W.mapModel(map, { maxBoxes: 7 })
  const wait = model.items[1]
  const r = Object.fromEntries(W.drawer({ kind: "wait", item: wait }, { origin_ms: 0, lead_ms: 4 * H, model }).rows)
  assert.equal(r["On the task clock"], "from 1h to 3h after the task's start (2 hours)")
  const stretch = { start_ms: H, end_ms: 2 * H, class: "muda", waste: "waiting", waited_on: "next_prompt", evidence: [] }
  const sr = Object.fromEntries(W.drawer({ kind: "stretch", stretch, intervals: [], lanes: [] }, { origin_ms: 0, lead_ms: 4 * H }).rows)
  assert.equal(sr["On the task clock"], "from 1h to 2h after the task's start (1 hour)")
  const wp = W.promptItem({ kind: "wait", item: wait }, { origin_ms: 0, model })
  assert.equal(wp.where, "It lasted 2 hours, from minute 60 to minute 180 after the task's start")
})

test("the swimlane's operator lane: a tick per prompt of the session and a band from the agent's stop to the prompt", () => {
  const map = twoBursts({ human_turns: [...twoBursts().human_turns, { session: "other", at_ms: H, basis: "first", window_ms: null }, { session: "s1", at_ms: 3.5 * H, basis: "mid_turn", window_ms: 30 * M }] })
  const c = W.clockMarks(map, W.mapModel(map, { maxBoxes: 7 }))
  const lane = W.operatorLane(c, "s1")
  assert.deepEqual(lane.map((x) => [x.n, x.ms, x.band]), [[1, 0, null], [3, 3 * H, [H, 3 * H]], [4, 3.5 * H, null]])
  // The pull request lane: every placed time in the session's span, and how many fall outside it.
  const prl = W.prLane(c, 0, 2 * H)
  assert.deepEqual(prl.marks.map((x) => [x.pr.number, x.kind]), [[7, "opened"]])
  assert.equal(prl.outside, 2)
})

test("the page no longer says prompts and pull requests stay off the clock", () => {
  for (const f of ["site/src/app.js", "site/src/walk.js", "site/src/index.html"]) {
    const s = read(f)
    assert.doesNotMatch(s, /only as counts|never beside a box|which would place them on the clock|never its start and end on the clock|waits carry no clock|Idle bands carry no clock time|placing idle time on the task's clock is not shown/, f)
  }
  const about = read("site/src/index.html")
  assert.match(about, /<strong>Operator prompts are on the task's clock\.<\/strong>/)
  assert.match(about, /<strong>Pull requests are on the task's clock\.<\/strong>/)
  // The page draws the markers and the Handoffs table.
  const app = read("site/src/app.js")
  assert.match(app, /W\.clockMarks\(/)
  assert.match(app, /W\.ladderMarks\(/)
  assert.match(app, /W\.handoffRows\(/)
  assert.match(app, /W\.operatorLane\(/)
  assert.match(app, /"Handoffs"/)
  assert.match(app, /opened, time not recorded/)
  // Every reason the clock views can give has the page's words.
  for (const r of ["clock_skew_conflict"]) assert.ok(F.hasReasonText(r), r)
})
