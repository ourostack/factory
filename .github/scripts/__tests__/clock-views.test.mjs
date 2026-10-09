// The human-agent clock views (design v1.1 addendum §3, brief S4): where
// each operator prompt and each pull request time sits on the value stream
// map and its two ladder lanes, how marks that would overlap merge into a count, the
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

test("the ladder has two lanes, prompts and pull requests, never counted together; only marks that would overlap merge, drawn at the middle of their span", () => {
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
  const L = W.ladderLanes(c, [100, 100, 100], { origin: 0 })
  // Prompts 1 and 2 overlap (0.28 px apart, ticks 3 px wide); prompt 3 at 50 px stands alone.
  const p2 = L.prompts.filter((g) => g.item === 2)
  assert.deepEqual(p2.map((g) => [g.count, Math.round(g.pos)]), [[2, 0], [1, 50]])
  assert.equal(p2[0].short, "2 prompts")
  assert.equal(p2[0].label, "2 prompts (prompts 1 and 2), 3 hours after the task's start")
  assert.equal(p2[1].label, "Operator prompt 3, 3.5 hours after the task's start")
  // The pull request lane never holds a prompt: #8 first appeared at 25 px and #7 merged at 50 px, alone even where prompt 3 sits.
  const r2 = L.prs.filter((g) => g.item === 2)
  assert.deepEqual(r2.map((g) => [g.count, Math.round(g.pos), g.marks[0].kind]), [[1, 25, "opened"], [1, 50, "merged"]])
  assert.ok(L.prompts.every((g) => g.marks.every((x) => x.kind === "prompt")))
  assert.ok(L.prs.every((g) => g.marks.every((x) => x.kind !== "prompt")))
  // Until Desk flags created pull requests, a pull request's first mark says it first appeared, not that the task opened it.
  assert.equal(r2[0].label, "Pull request o/r#8 first appeared in this task's sessions (drawn at GitHub's opening time), at most 3.3 hours after the task's start")
  assert.equal(L.prs.find((g) => g.item === 0).label, "Pull request o/r#7 opened by this task, 30 minutes after the task's start")
  assert.equal(r2[1].label, "Pull request o/r#7 merged, 3.5 hours after the task's start")
})

test("marks merge only when their drawn shapes would overlap, a merged mark grows to its count's width, and it says what it counts", () => {
  const pos = (xs) => xs.map((x, i) => ({ pos: x, i }))
  // Glyphs 12 px wide: 0 and 11 overlap, 30 does not.
  assert.deepEqual(W.groupMarks(pos([0, 11, 30]), 12).map((g) => g.marks.map((m) => m.i)), [[0, 1], [2]])
  // A group's badge is wider than one glyph, so a neighbour it now covers joins it.
  assert.deepEqual(W.groupMarks(pos([0, 2, 20]), 12, () => 30).map((g) => g.marks.length), [3])
  // The drawn position is the middle of the span, never the first mark.
  const g = W.groupMarks(pos([10, 14, 18]), 12)[0]
  assert.deepEqual([g.from, g.to, g.pos], [10, 18, 14])
  for (const grp of W.groupMarks(pos([0, 5, 7, 40, 44, 90]), 12)) assert.ok(grp.pos >= grp.from && grp.pos <= grp.to)
  // A merged pull request mark says what it counts.
  const prMarks = (kinds) => kinds.map((kind, i) => ({ kind, pr: { repo: "o/r", number: i + 1, created: null }, ms: i * S, item: 0, frac: 0, outside: null, state: "measured", k: i }))
  const lanes = (kinds) => W.ladderLanes({ prompts: [], prs: prMarks(kinds) }, [100], { origin: 0 }).prs[0]
  assert.equal(lanes(["merged", "merged", "merged"]).short, "3 PRs merged")
  assert.equal(lanes(["opened", "opened"]).short, "2 PRs first appeared")
  assert.equal(lanes(["opened", "merged", "merged"]).short, "3 PR events: 1 first appeared, 2 merged")
  assert.match(lanes(["opened", "merged", "merged"]).label, /^3 PR events: 1 first appeared, 2 merged \(o\/r#1 first appeared, o\/r#2 merged, o\/r#3 merged\), from 0s to 2 seconds after the task's start$/)
})

test("a mark outside the lead window is never drawn at the map's edge: it goes to a marked margin with how far outside it lies", () => {
  const map = twoBursts({
    prs: [
      { repo: "o/r", number: 1, created: null, opened_at_ms: -16 * 24 * H, opened_basis: "pr_anchor", opened_state: { state: "measured", reasons: [] }, merged_at_ms: 24 * H, merged_basis: "pr_anchor", merged_state: { state: "measured", reasons: [] }, state: "merged", reasons: [] },
      { repo: "o/r", number: 2, created: null, opened_at_ms: 30 * M, opened_basis: "pr_anchor", opened_state: { state: "measured", reasons: [] }, merged_at_ms: 5 * H, merged_basis: "pr_anchor", merged_state: { state: "measured", reasons: [] }, state: "merged", reasons: [] },
    ],
  })
  const model = W.mapModel(map, { maxBoxes: 7 })
  const c = W.clockMarks(map, model)
  assert.deepEqual(c.prs.map((x) => [x.pr.number, x.kind, x.outside, x.outside_ms]), [[1, "opened", "before", 16 * 24 * H], [2, "opened", null, 0], [2, "merged", "after", H], [1, "merged", "after", 20 * H]])
  const L = W.ladderLanes(c, [100, 100, 100], { origin: 0 })
  assert.ok(L.prs.every((g) => g.marks.every((x) => x.outside === null)), "no outside mark in a lane")
  assert.equal(L.before.prs.length, 1)
  assert.equal(L.after.prs.length, 2)
  assert.equal(L.before.label, "Before the task started: 1 PR event, 16 days before")
  assert.equal(L.after.label, "After the task's lead time ended: 2 PR events, from 1 hour to 20 hours after")
  assert.equal(W.outsideWords(-16 * 24 * H, model), "16 days before the task started")
  assert.equal(W.outsideWords(24 * H, model), "20 hours after the task's lead time ended")
  assert.equal(W.outsideWords(H, model), null)
  // The drawer and the table say it too.
  const r = Object.fromEntries(W.drawer({ kind: "pr", pr: map.prs[0], k: 0 }, { origin_ms: 0, model, reasonText: F.reasonText }).rows)
  // "Before the task started" is said once: the clock words already say it.
  assert.equal(r.Opened, "16 days before the task's start")
  assert.equal(r.Merged, "24 hours after the task's start (20 hours after the task's lead time ended)")
})

test("the Handoffs table has one row per prompt, in clock order: when it came, the wait before it, how long the agent then worked, and the size classes", () => {
  const map = twoBursts({
    sessions: [{ id: "s1", host: "claude-code", offset_ms: 0, end_ms: 5 * H }],
    human_turns: [
      { session: "s1", at_ms: 0, basis: "first", window_ms: null, prompt_class: "m", output_class: "none" },
      { session: "s1", at_ms: 3 * H, basis: "after_stop", window_ms: 2 * H, prompt_class: "s", output_class: "l" },
      { session: "s1", at_ms: 3.5 * H, basis: "mid_turn", window_ms: 30 * M, prompt_class: "xs", output_class: "none" },
    ],
  })
  const c = W.clockMarks(map, W.mapModel(map, { maxBoxes: 7 }))
  const t = W.handoffTable(c, 0, F.reasonText, 4 * H)
  const rows = t.rows
  assert.deepEqual(rows.map((r) => r.n), [1, 2, 3])
  assert.equal(rows[0].clock, "at the task's start")
  // "Came" is folded into the wait before it.
  // Two waits, two names: the task's idle time (the map's waiting: no agent of the task working) and the main agent's stop.
  assert.equal(rows[0].idle, "none: the task starts here")
  assert.equal(rows[1].idle, "2 hours")
  assert.equal(rows[2].idle, "none: an agent of this task was working")
  assert.equal(rows[0].stopped, "first prompt of the session")
  assert.equal(rows[1].stopped, "2 hours")
  assert.equal(rows[2].stopped, "not stopped: it was still working, 30 minutes after the previous prompt")
  // The agent then worked: to its next stop (the next after-stop prompt's time minus its wait), still working at a mid-turn prompt, or no later prompt.
  assert.equal(rows[0].worked, "1 hour, then it stopped")
  assert.equal(rows[1].worked, "still working at the next prompt, 30 minutes later")
  assert.equal(rows[2].worked, "no later prompt in this session; it ended 1.5 hours later")
  assert.equal(rows[1].prompt, "short (21 to 200 characters)")
  assert.equal(rows[1].output, "long (1,001 to 5,000 characters)")
  // Columns with no data in any row are dropped, and the table says so once.
  assert.equal(t.show_why, false)
  assert.equal(t.note, "Desk does not publish why the agent stopped yet, so that column is left out until it does.")
  assert.equal(t.explain, "Task idle before this prompt is the map's waiting: no agent of this task was working. Main agent stopped before this prompt is how long the session's main agent had stopped before the operator prompted it; other agents of this task may have been working in that time, so the map can count it as working.")
  assert.equal(rows[1].why, "not known yet: Desk does not publish why the agent stopped")
  // With Desk's waits, the columns come back.
  const withWaits = twoBursts({ waits: [{ session: "s1", start_ms: H, end_ms: 3 * H, next_prompt_ms: 2 * H - 5 * M, why: null, why_source: "none", reasons: ["not_labeled"] }] })
  const t2 = W.handoffTable(W.clockMarks(withWaits, W.mapModel(withWaits, { maxBoxes: 7 })), 0, F.reasonText, 4 * H)
  assert.deepEqual([t2.show_why, t2.note], [true, null])
  assert.equal(t2.rows[1].why, "not known (the independent evaluator has not labeled this yet)")
  assert.equal(t2.rows[0].why, "—", "a first prompt follows no stop")
  // A prompt before the task's start says so.
  assert.equal(W.clockAt(-90 * S, 0), "2 minutes before the task's start")
  assert.equal(W.clockAt(30 * S, 0), "30 seconds after the task's start")
})

test("until Desk publishes why, the legend says every prompt is drawn in one color, in the same words as the table and the drawer", () => {
  const map = twoBursts()
  const c = W.clockMarks(map, W.mapModel(map, { maxBoxes: 7 }))
  assert.equal(W.NOT_KNOWN_WHY, "not known yet: Desk does not publish why the agent stopped")
  assert.equal(W.whyLegend(c), "Why the agent stopped is not known yet: Desk does not publish why the agent stopped, so every prompt is drawn in one color.")
  const known = twoBursts({ waits: [{ session: "s1", start_ms: H, end_ms: 3 * H, why: "acceptance", why_source: "evaluator" }] })
  assert.match(W.whyLegend(W.clockMarks(known, W.mapModel(known, { maxBoxes: 7 }))), /^A prompt drawn in the waiting color has a recorded why/)
  // A merged top-row marker takes its group's why only when every prompt shares it.
  assert.equal(W.groupWhy([{ why: "acceptance" }, { why: "acceptance" }]), "acceptance")
  assert.equal(W.groupWhy([{ why: "acceptance" }, { why: "not_known" }]), "not_known")
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
  assert.equal(rows["Task idle before this prompt"], "2 hours")
  assert.equal(rows["Main agent stopped before this prompt"], "2 hours")
  assert.equal(rows["Agent then worked"], "no later prompt in this session; it ended 1 hour later")
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
  assert.equal(after["Why the agent stopped"], "not known yet: Desk does not publish why the agent stopped")
  assert.equal(after["Counted as waiting"], undefined, "the row is left out until Desk publishes the wait")
  // A prompt outside the lead window says where it fell.
  const out = W.clockMarks(twoBursts({ human_turns: [{ session: "s1", at_ms: -2 * M, basis: "first", window_ms: null, prompt_class: "m", output_class: "none" }] }), model)
  assert.equal(Object.fromEntries(W.drawer({ kind: "prompt", mark: out.prompts[0] }, { origin_ms: 0, model }).rows)["On the task clock"], "2 minutes before the task's start, before the task's lead time began (drawn in the margin before the map)")
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
  assert.equal(p["What it is"], "A pull request that first appeared in this task's sessions (opened or mentioned; Desk does not say which yet); it is open")
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
  assert.equal(p.where, "It came at minute 180 after the task's start, 2 hours after the main agent stopped; the page never shows a prompt's text")
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

test("the data box counts the pull requests that first appeared in each box, the same marks the ladder draws there", () => {
  const map = twoBursts()
  const model = W.mapModel(map, { maxBoxes: 7 })
  const c = W.clockMarks(map, model)
  // Box 1 holds #7's first mark; box 2 holds #8's. The lane draws the same.
  const n0 = W.boxPrCount(c, 0, map.prs_state)
  assert.deepEqual([n0.state, n0.value, n0.bound], ["partial", 1, "lower"], "the list is partly recorded, and #9 and #10 are not placed")
  assert.equal(W.boxPrCount(c, 2, { state: "measured", reasons: [] }).value, 1)
  const rows = W.dataBox(model.items[0], model.session_count, n0)
  assert.deepEqual(rows.map((r) => r.label), ["Working time", "Agents", "Tool calls", "Failed tool calls", "Operator turns", "Pull requests first appeared", "Session"])
  assert.equal(rows.find((r) => r.key === "prs").text, "at least 1")
  // Without the clock (a map/1 file), Desk's burst count stands in; no count reads not recorded.
  assert.equal(W.dataBox(model.items[0], 1).find((r) => r.key === "prs").text, "1")
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
  assert.match(app, /W\.ladderLanes\(/)
  assert.match(app, /W\.handoffTable\(/)
  assert.match(app, /W\.operatorLane\(/)
  assert.match(app, /"Handoffs"/)
  assert.match(app, /opened, time not recorded/)
  // Every reason the clock views can give has the page's words.
  for (const r of ["clock_skew_conflict"]) assert.ok(F.hasReasonText(r), r)
  // One statement of the merge rule, the same in the legend and the merged mark's drawer; no "one pixel" or "one place" claim.
  assert.match(app, /const MERGE_RULE = "Marks that would overlap are shown as one count; select it for the list, each with its time\."/)
  assert.equal((app.match(/would overlap/g) || []).length, 1, "the merge rule is written once, as MERGE_RULE")
  assert.doesNotMatch(app, /within one pixel|marks at one place|Marks within a pixel|within one mark's width/)
  // On a phone the box's info row (its operator marker) shows whenever it has content.
  assert.match(app, /if \(info\.childNodes\.length\) body\.appendChild\(info\)/)
  // One anchor_spread text covers pull request times and finish days (M1); clock_skew_conflict reads plainly (M2).
  assert.equal(F.reasonText("anchor_spread"), "the task's pull requests disagree by more than 2 minutes about when the task started, so times placed through them (pull request times and the finish day) may be off by up to that much, either way")
  assert.match(F.reasonText("clock_skew_conflict"), /^GitHub's merge time, placed through the task's clock anchor, falls before the opening the session recorded/)
})

test("a merged mark's list gives each mark its time, to the minute, so marks that round to the same words still differ", () => {
  assert.equal(W.markLine({ kind: "prompt", n: 20, ms: 21 * H + 2 * M }, 0), "Prompt 20, 21 hours after the task's start (minute 1,262)")
  assert.equal(W.markLine({ kind: "merged", pr: { repo: "o/r", number: 7 }, ms: 30 * M, state: "partial", bound: "upper" }, 0), "o/r#7 merged, at most 30 minutes after the task's start (minute 30)")
  // A long group names its marks in the drawer, not in its label.
  const many = Array.from({ length: 8 }, (_, i) => ({ kind: "merged", pr: { repo: "o/r", number: i + 1 }, ms: i * S, item: 0, frac: 0, outside: null, state: "measured", k: i }))
  assert.equal(W.ladderLanes({ prompts: [], prs: many }, [100], { origin: 0 }).prs[0].label, "8 PRs merged, from 0s to 7 seconds after the task's start")
})


test("a data box never reads at least 0: a lower bound of zero reads none recorded, and a partial row carries its reasons", () => {
  const pz = (reasons) => ({ state: "partial", value: 0, bound: "lower", reasons })
  const box = { type: "box", working_ms: 0, working_state: pz(["host_records_partly"]), agents: pz(["host_records_partly"]), tool_calls: pz(["host_records_partly"]), tool_failures: pz(["host_records_partly"]), operator_turns: pz(["host_records_partly"]), prs: pz(["host_records_partly"]), session_numbers: [1] }
  const rows = W.dataBox(box, 1, pz(["host_records_partly", "pr_time_not_placed"]))
  for (const r of rows) assert.doesNotMatch(r.text, /at least 0\b/, r.key)
  for (const k of ["agents", "tool_calls", "tool_failures", "operator_turns", "prs"]) assert.equal(rows.find((r) => r.key === k).text, "none recorded", k)
  assert.deepEqual(rows.find((r) => r.key === "prs").reasons, ["host_records_partly", "pr_time_not_placed"])
  assert.deepEqual(rows.find((r) => r.key === "session").reasons, [])
  assert.equal(W.statedText({ state: "partial", value: 0, bound: "lower", reasons: [] }), "none recorded")
  assert.equal(W.statedText({ state: "partial", value: 3, bound: "lower", reasons: [] }), "at least 3")
  assert.ok(F.hasReasonText("pr_time_not_placed"))
})

test("a ladder mark sits over the step that holds its time: a box's working step for a time in a burst, its folded-wait step for a time in a folded gap", () => {
  // One box: burst 0-1h (working 1h), folded gap 1h-1h05m, burst 1h05m-2h05m (working 1h).
  const map = { lead_window: { state: "measured", reasons: [], start_ms: 0, end_ms: 2 * H + 5 * M }, bursts: [{ start_ms: 0, end_ms: H, working_ms: H }, { start_ms: H + 5 * M, end_ms: 2 * H + 5 * M, working_ms: H }], gaps: [{ start_ms: H, end_ms: H + 5 * M, waited_on: "unknown" }], human_turns: [{ session: "s", at_ms: H + 2 * M, basis: "first" }, { session: "s", at_ms: 1.5 * H + 5 * M, basis: "after_stop", window_ms: M }], prs: [] }
  const model = W.mapModel(map, { maxBoxes: 1, })
  assert.equal(model.items.length, 1)
  const it = model.items[0]
  assert.deepEqual(W.stepPlace(it, H + 2 * M), { step: "fold", frac: 2 / 5 })
  assert.deepEqual(W.stepPlace(it, 1.5 * H + 5 * M), { step: "work", frac: 0.75 })
  assert.deepEqual(W.stepPlace(it, H + 5 * M), { step: "work", frac: 0.5 }, "a time that ends a folded gap starts the next burst")
  const c = W.clockMarks(map, model)
  const L = W.ladderLanes(c, [{ work: [0, 98], fold: [98, 144] }], { origin: 0 })
  assert.deepEqual(L.prompts.map((g) => [g.step, Math.round(g.pos)]), [["work", 74], ["fold", 116]])
})

test("on the real maps, every in-window mark sits over the step whose time holds it (f735ccc8, 1f0ae588, 015ff969)", () => {
  const maps = JSON.parse(read(".github/scripts/__tests__/fixtures/clock-maps.json"))
  for (const [id, map] of Object.entries(maps)) {
    for (const maxBoxes of [4, 6]) {
      const model = W.mapModel(map, { maxBoxes })
      // A drawn layout: each box's working step, then its folded step; a wait is one step.
      const geo = model.items.map((it) => (it.type === "box" ? (it.inner_wait_ms > 0 ? { work: [0, 98], fold: [98, 144] } : { work: [0, 144] }) : { wait: [0, 96] }))
      const c = W.clockMarks(map, model)
      const L = W.ladderLanes(c, geo, { origin: map.lead_window.start_ms })
      let n = 0
      for (const g of [...L.prompts, ...L.prs]) {
        const it = model.items[g.item]
        const [a, b] = geo[g.item][g.step]
        assert.ok(g.pos >= a && g.pos <= b, `${id} item ${g.item} ${g.step}`)
        for (const x of g.marks) {
          assert.ok(x.ms >= it.start_ms && x.ms <= it.end_ms, `${id}: a mark lies in its item's time`)
          const inFold = it.type === "box" && it.folded.some((f) => x.ms >= f.start_ms && x.ms < f.end_ms)
          assert.equal(g.step, it.type === "wait" ? "wait" : inFold ? "fold" : "work", `${id}: mark at ${x.ms} on the ${g.step} step`)
          n++
        }
      }
      assert.ok(n > 0, id)
    }
  }
})

test("margins say how far outside in full words, never claim an end an open task has not reached, and never count prompts with pull requests", () => {
  const base = twoBursts({ lead_window: { state: "partial", reasons: ["censored"], start_ms: 0, end_ms: 4 * H }, human_turns: [{ session: "s1", at_ms: 6 * H, basis: "first" }], prs: [{ repo: "o/r", number: 1, created: null, opened_at_ms: 5 * H, opened_state: { state: "measured", reasons: [] }, merged_at_ms: null, merged_state: { state: "unavailable", reasons: ["not_merged"] }, state: "open", reasons: [] }] })
  const model = W.mapModel(base, { maxBoxes: 7 })
  const c = W.clockMarks(base, model)
  assert.equal(c.open, true)
  assert.equal(W.outsideWords(5 * H, model, true), "1 hour after the last recorded work")
  const L = W.ladderLanes(c, [100, 100, 100], { origin: 0 })
  assert.equal(L.after.title, "After the last recorded work")
  assert.equal(L.after.when, "from 1 hour to 2 hours after the last recorded work")
  assert.deepEqual([L.after.prompts.length, L.after.prs.length], [1, 1])
  const closed = W.ladderLanes(W.clockMarks(twoBursts({ prs: [] , human_turns: [{ session: "s1", at_ms: 5 * H, basis: "first" }] }), model), [100, 100, 100], { origin: 0 })
  assert.equal(closed.after.title, "After the task's lead time ended")
  assert.equal(closed.after.when, "1 hour after the task's lead time ended")
})

test("the prompt drawer says how long the agent then worked, and a pull request's copied prompt says first appeared and never a negative minute", () => {
  const map = twoBursts({ prs: [{ repo: "o/r", number: 5, created: null, opened_at_ms: -16 * 24 * H, opened_state: { state: "measured", reasons: [] }, merged_at_ms: 3.5 * H, merged_state: { state: "measured", reasons: [] }, state: "merged", reasons: [] }] })
  const model = W.mapModel(map, { maxBoxes: 7 })
  const c = W.clockMarks(map, model)
  const d = Object.fromEntries(W.drawer({ kind: "prompt", mark: c.prompts[0] }, { origin_ms: 0, model }).rows)
  assert.equal(d["Agent then worked"], "1 hour, then it stopped")
  const q = W.promptItem({ kind: "pr", pr: map.prs[0], k: 0 }, { origin_ms: 0, model })
  assert.equal(q.where, "It first appeared 23,040 minutes before the task's start, and merged at minute 210 after the task's start")
  assert.doesNotMatch(q.where, /minute -/)
})

test("the swimlane draws its operator pins and pull request glyphs through the same overlap rule as the ladder", () => {
  const app = read("site/src/app.js")
  const lane = app.slice(app.indexOf("function drawClockLanes"), app.indexOf("async function renderSwimlane"))
  assert.equal((lane.match(/W\.groupMarks\(/g) || []).length, 2)
  assert.match(app, /li\(el\("span", "lane-key-count", "2"\), MERGE_RULE\)/, "the swimlane legend states the one merge rule")
  assert.doesNotMatch(app, /Public pull requests the task's sessions referenced/)
})
