// The PR clock (site/scripts/pr-clock.mjs): placing each pull request's
// GitHub opened and merged times on the task clock through the task's clock
// anchor, the anchor itself (median, outliers, spread), the D4 `created`
// flag, the lookup cap, and the operator-turn and pull-request list states
// the store states when Desk does not.
import assert from "node:assert/strict"
import { test } from "node:test"

import { ANCHOR_PLACE_LIMIT_MS, ANCHOR_SPREAD_MS, MAX_PR_LOOKUPS, createPullReader, listStates, placePrs, prAnchor, prClock, prKey } from "../../../site/scripts/pr-clock.mjs"

const S = 1000
const M = 60 * S
// The instant the task card was created, as GitHub's clock sees it.
const T0 = Date.parse("2026-10-05T12:00:00Z")
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
const gh = (entries) => new Map(entries.map(([k, v]) => [k, v]))
const pull = (openedMs, { merged = null, state = merged === null ? "open" : "closed" } = {}) => ({ created_at: iso(openedMs), merged_at: merged === null ? null : iso(merged), state })

test("the anchor is the median of created_at minus at_ms over the timed pull requests, and agrees within seconds", () => {
  const prs = [
    { repo: "o/r", number: 1, at_ms: 10 * M },
    { repo: "o/r", number: 2, at_ms: 50 * M },
    { repo: "o/r", number: 3, at_ms: 90 * M },
  ]
  // Tool-result time against GitHub's created_at: a few seconds apart.
  const g = gh([
    ["o/r#1", pull(T0 + 10 * M + 3 * S)],
    ["o/r#2", pull(T0 + 50 * M + 5 * S)],
    ["o/r#3", pull(T0 + 90 * M + 11 * S)],
  ])
  const a = prAnchor(prs, g)
  assert.equal(a.state, "measured")
  assert.equal(a.value_ms, T0 + 5 * S)
  assert.equal(a.n, 3)
  assert.equal(a.spread_ms, 8 * S)
  assert.equal(a.basis, "timed")
  assert.deepEqual(a.reasons, [])
})

test("before Desk flags created pull requests, a pull request the session only looked at is dropped as an outlier more than 2 minutes from the median", () => {
  const prs = [
    { repo: "o/r", number: 1, at_ms: 10 * M },
    { repo: "o/r", number: 2, at_ms: 20 * M },
    { repo: "o/r", number: 3, at_ms: 30 * M },
    // Mentioned 30 minutes in, opened two days before the task.
    { repo: "o/old", number: 9, at_ms: 30 * M },
  ]
  const g = gh([
    ["o/r#1", pull(T0 + 10 * M + 2 * S)],
    ["o/r#2", pull(T0 + 20 * M + 4 * S)],
    ["o/r#3", pull(T0 + 30 * M + 6 * S)],
    ["o/old#9", pull(T0 - 48 * 60 * M)],
  ])
  const a = prAnchor(prs, g)
  assert.equal(a.state, "measured")
  assert.equal(a.value_ms, T0 + 4 * S)
  assert.equal(a.n, 3)
  assert.equal(a.dropped, 1)
})

test("an anchor whose kept pull requests span more than 2 minutes is partial, a lower bound, with the reason anchor_spread", () => {
  const prs = [
    { repo: "o/r", number: 1, at_ms: 0 },
    { repo: "o/r", number: 2, at_ms: 0 },
    { repo: "o/r", number: 3, at_ms: 0 },
  ]
  const g = gh([
    ["o/r#1", pull(T0)],
    ["o/r#2", pull(T0 + 110 * S)],
    ["o/r#3", pull(T0 + 220 * S)],
  ])
  const a = prAnchor(prs, g)
  assert.equal(a.state, "partial")
  // A mention never precedes its pull request's creation, so every timed sample is at most the true anchor: the anchor is a lower bound.
  assert.equal(a.bound, "lower")
  assert.deepEqual(a.reasons, ["anchor_spread"])
  assert.equal(a.spread_ms, 220 * S)
  assert.equal(a.uncertainty_ms, 220 * S)
  assert.ok(a.spread_ms > ANCHOR_SPREAD_MS)
})

test("once Desk flags created pull requests (D4), only those anchor the clock, with no outlier rule", () => {
  const prs = [
    { repo: "o/r", number: 1, at_ms: 10 * M, created: true },
    // Only looked at: never an anchor, even when it agrees.
    { repo: "o/r", number: 2, at_ms: 20 * M, created: false },
    { repo: "o/r", number: 3, at_ms: 30 * M, created: true },
  ]
  const g = gh([
    ["o/r#1", pull(T0 + 10 * M + 2 * S)],
    ["o/r#2", pull(T0 - 5 * 60 * M)],
    ["o/r#3", pull(T0 + 30 * M + 4 * S)],
  ])
  const a = prAnchor(prs, g)
  assert.equal(a.basis, "created")
  assert.equal(a.n, 2)
  assert.equal(a.value_ms, T0 + 3 * S)
  assert.equal(a.state, "measured")
})

test("a task with no created and timed pull request has no anchor, and says why", () => {
  assert.deepEqual(prAnchor([], gh([])).reasons, ["no_timed_pr"])
  assert.equal(prAnchor([{ repo: "o/r", number: 1 }], gh([["o/r#1", pull(T0)]])).state, "unavailable")
  // Every pull request is flagged and none was created by the task's sessions.
  const flagged = prAnchor([{ repo: "o/r", number: 1, at_ms: 5, created: false }], gh([["o/r#1", pull(T0)]]))
  assert.deepEqual(flagged, { state: "unavailable", reasons: ["no_created_timed_pr"], basis: "created", n: 0 })
  // Timed, but GitHub could not be read.
  assert.deepEqual(prAnchor([{ repo: "o/r", number: 1, at_ms: 5 }], gh([["o/r#1", null]])).reasons, ["github_unreadable"])
  // Timed, but beyond the build's lookup cap.
  assert.deepEqual(prAnchor([{ repo: "o/r", number: 1, at_ms: 5 }], gh([]), { capped: new Set(["o/r#1"]) }).reasons, ["github_lookup_capped"])
  // Timed, but the build read no GitHub data at all.
  assert.deepEqual(prAnchor([{ repo: "o/r", number: 1, at_ms: 5 }], null).reasons, ["github_not_read"])
})

test("each pull request is placed: from the session when created, through the anchor otherwise, and never invented", () => {
  const prs = [
    { repo: "o/r", number: 1, at_ms: 10 * M, created: true },
    { repo: "o/r", number: 2, at_ms: 40 * M, created: true },
    // Not timed by the facts: placed from GitHub through the anchor.
    { repo: "o/r", number: 3 },
    // Not readable on GitHub (a private repository): not placed.
    { repo: "o/private", number: 4 },
  ]
  const g = gh([
    ["o/r#1", pull(T0 + 10 * M + 2 * S, { merged: T0 + 70 * M, state: "closed" })],
    ["o/r#2", pull(T0 + 40 * M + 2 * S, { state: "closed" })],
    ["o/r#3", pull(T0 + 55 * M + 2 * S)],
    ["o/private#4", null],
  ])
  const c = prClock(prs, g)
  assert.equal(c.anchor.state, "measured")
  assert.equal("value_ms" in c.anchor, false, "the map file holds offsets only, never an epoch value")
  const [a, b, d, e] = c.prs
  const ok = { state: "measured", reasons: [] }
  const notMerged = { state: "unavailable", reasons: ["not_merged"] }
  assert.deepEqual(a, { repo: "o/r", number: 1, created: true, opened_at_ms: 10 * M, opened_basis: "desk", opened_state: ok, merged_at_ms: 70 * M - 2 * S, merged_basis: "pr_anchor", merged_state: ok, state: "merged", reasons: [] })
  assert.deepEqual(b, { repo: "o/r", number: 2, created: true, opened_at_ms: 40 * M, opened_basis: "desk", opened_state: ok, merged_at_ms: null, merged_basis: "not_merged", merged_state: notMerged, state: "closed", reasons: [] })
  assert.deepEqual(d, { repo: "o/r", number: 3, created: null, opened_at_ms: 55 * M, opened_basis: "pr_anchor", opened_state: ok, merged_at_ms: null, merged_basis: "not_merged", merged_state: notMerged, state: "open", reasons: [] })
  const unread = { state: "unavailable", reasons: ["github_unreadable"] }
  assert.deepEqual(e, { repo: "o/private", number: 4, created: null, opened_at_ms: null, opened_basis: "not_placed", opened_state: unread, merged_at_ms: null, merged_basis: "not_placed", merged_state: unread, state: null, reasons: ["github_unreadable"] })
  for (const p of c.prs) if (p.merged_at_ms !== null && p.opened_at_ms !== null) assert.ok(p.merged_at_ms >= p.opened_at_ms)
})

test("before D2, a timed pull request is placed through the anchor (its own mention agrees within seconds)", () => {
  const prs = [
    { repo: "o/r", number: 1, at_ms: 10 * M },
    { repo: "o/r", number: 2, at_ms: 20 * M },
  ]
  const g = gh([
    ["o/r#1", pull(T0 + 10 * M + 4 * S, { merged: T0 + 15 * M })],
    ["o/r#2", pull(T0 + 20 * M + 6 * S)],
  ])
  const c = prClock(prs, g)
  assert.equal(c.prs[0].opened_basis, "pr_anchor")
  assert.equal(c.prs[0].opened_at_ms, 10 * M - S)
  assert.equal(c.prs[0].merged_at_ms, 15 * M - 5 * S)
  assert.ok(Math.abs(c.prs[1].opened_at_ms - 20 * M) <= 2 * M)
})

// ------------------------------------------- confirming the anchor (fix round 1)

test("one timed pull request with no created flag is an unconfirmed anchor whose error cannot be measured: partial, a lower bound, and nothing is placed through it", () => {
  // The session may only have mentioned it: here it was opened 3 days before the mention, so placing through it would put times 72 hours late.
  const prs = [{ repo: "o/r", number: 1, at_ms: 20 * M }, { repo: "o/r", number: 2 }]
  const g = gh([["o/r#1", pull(T0 - 72 * 60 * M + 20 * M)], ["o/r#2", pull(T0 + 50 * M + 3 * S, { merged: T0 + 60 * M + 3 * S })]])
  const c = prClock(prs, g)
  assert.deepEqual([c.anchor.state, c.anchor.bound, c.anchor.reasons, c.anchor.n], ["partial", "lower", ["anchor_unconfirmed"], 1])
  assert.equal(c.anchor.uncertainty_ms, null, "one sample cannot measure its own error")
  const two = c.prs[1]
  assert.equal(two.opened_at_ms, null)
  assert.equal(two.opened_basis, "not_placed")
  assert.equal(two.merged_at_ms, null)
  assert.equal(two.merged_basis, "not_placed")
  assert.deepEqual(two.opened_state, { state: "unavailable", reasons: ["anchor_unconfirmed"] })
  assert.deepEqual(two.merged_state, { state: "unavailable", reasons: ["anchor_unconfirmed"] })
  assert.equal("uncertainty_ms" in two, false)
  assert.equal(two.state, "merged", "GitHub's state is still known")
  // Once Desk flags it as created, the same task places again.
  const flagged = prClock([{ ...prs[0], created: true }, prs[1]], g)
  assert.equal(flagged.anchor.state, "measured")
  assert.equal(flagged.prs[1].opened_basis, "pr_anchor")
})

test("one pull request Desk flags as created by the session confirms the anchor: measured", () => {
  const a = prAnchor([{ repo: "o/r", number: 1, at_ms: 20 * M, created: true }], gh([["o/r#1", pull(T0 + 20 * M + 3 * S)]]))
  assert.deepEqual([a.state, a.basis, a.n, a.reasons], ["measured", "created", 1, []])
})

test("three timed pull requests a day apart: no majority agrees, so the anchor is unconfirmed, and nothing is placed through it", () => {
  const D = 24 * 60 * M
  const prs = [{ repo: "o/r", number: 1, at_ms: 0 }, { repo: "o/r", number: 2, at_ms: 0 }, { repo: "o/r", number: 3, at_ms: 0 }, { repo: "o/r", number: 4 }]
  const g = gh([["o/r#1", pull(T0 - D)], ["o/r#2", pull(T0)], ["o/r#3", pull(T0 + D)], ["o/r#4", pull(T0 + 5 * M)]])
  const c = prClock(prs, g)
  assert.equal(c.anchor.state, "partial")
  assert.deepEqual(c.anchor.reasons, ["anchor_unconfirmed"])
  assert.equal(c.anchor.spread_ms, 2 * D, "the spread is over every readable sample, not only the kept one")
  assert.equal(c.anchor.uncertainty_ms, D)
  for (const p of c.prs) {
    assert.equal(p.opened_basis, "not_placed")
    assert.deepEqual(p.reasons, ["anchor_spread_too_wide"])
  }
})

test("two agreeing pull requests against one: the majority confirms the anchor only when no sample lies above it", () => {
  const H3 = 3 * 60 * M
  const prs = [{ repo: "o/r", number: 1, at_ms: 10 * M }, { repo: "o/r", number: 2, at_ms: 20 * M }, { repo: "o/r", number: 3, at_ms: 30 * M }]
  // Majority right: the odd one out lies below (a pull request opened before the session mentioned it).
  const right = prAnchor(prs, gh([["o/r#1", pull(T0 + 10 * M + 2 * S)], ["o/r#2", pull(T0 + 20 * M + 4 * S)], ["o/r#3", pull(T0 + 30 * M - H3)]]))
  assert.deepEqual([right.state, right.n, right.dropped, right.reasons], ["measured", 2, 1, []])
  // Majority wrong: two mentions agree, but the third sample lies 3 hours above them, and no sample can lie above the true anchor.
  const wrong = prAnchor(prs, gh([["o/r#1", pull(T0 + 10 * M - H3)], ["o/r#2", pull(T0 + 20 * M - H3)], ["o/r#3", pull(T0 + 30 * M)]]))
  assert.deepEqual([wrong.state, wrong.bound, wrong.reasons], ["partial", "lower", ["anchor_unconfirmed"]])
  assert.equal(wrong.uncertainty_ms, H3)
  assert.ok(wrong.uncertainty_ms > ANCHOR_PLACE_LIMIT_MS)
})

test("a partial anchor within the placing limit places pull requests as partial, with its reasons, its direction and how far off they may be", () => {
  assert.equal(ANCHOR_PLACE_LIMIT_MS, 15 * M, "the map's bursts split at 15 idle minutes, so a wider error could put a marker beside the wrong box")
  // Timed: 0 and 5 minutes; a strict majority of two, but they disagree by more than 2 minutes.
  const prs = [{ repo: "o/r", number: 1, at_ms: 0 }, { repo: "o/r", number: 2, at_ms: 0 }, { repo: "o/r", number: 3 }]
  const c = prClock(prs, gh([["o/r#1", pull(T0)], ["o/r#2", pull(T0 + 5 * M)], ["o/r#3", pull(T0 + 40 * M)]]))
  assert.deepEqual([c.anchor.state, c.anchor.bound, c.anchor.reasons], ["partial", "lower", ["anchor_spread"]])
  const three = c.prs[2]
  assert.equal(three.opened_basis, "pr_anchor")
  assert.deepEqual(three.opened_state, { state: "partial", bound: "upper", reasons: ["anchor_spread"] })
  assert.equal(three.uncertainty_ms, 5 * M)
  // Created: the samples are the true anchor give or take the clock skew, so a spread has no direction.
  const cr = prClock([{ repo: "o/r", number: 1, at_ms: 0, created: true }, { repo: "o/r", number: 2, at_ms: 0, created: true }, { repo: "o/r", number: 3 }], gh([["o/r#1", pull(T0)], ["o/r#2", pull(T0 + 3 * M)], ["o/r#3", pull(T0 + 40 * M)]]))
  assert.deepEqual([cr.anchor.state, cr.anchor.bound, cr.anchor.reasons], ["partial", null, ["anchor_spread"]])
  assert.deepEqual(cr.prs[2].opened_state, { state: "partial", bound: null, reasons: ["anchor_spread"] })
})

test("a merge never lands before its opening: a skewed pair is clamped and says so", () => {
  // Opening from the session (tool-result time); merge through the anchor median, 5.5 s later than this PR's own sample.
  const prs = [{ repo: "o/r", number: 1, at_ms: 10 * M, created: true }, { repo: "o/r", number: 2, at_ms: 20 * M, created: true }]
  const g = gh([["o/r#1", pull(T0 + 10 * M, { merged: T0 + 10 * M + 3 * S })], ["o/r#2", pull(T0 + 20 * M + 11 * S)]])
  const one = prClock(prs, g).prs[0]
  assert.equal(one.opened_at_ms, 10 * M)
  assert.equal(one.merged_at_ms, 10 * M)
  assert.deepEqual(one.merged_state, { state: "partial", bound: "lower", reasons: ["clock_skew"] })
  assert.deepEqual(one.reasons, ["clock_skew"])
  // Through a partial anchor, the clamp adds its reason to the anchor's; it never replaces them.
  const spread = [{ repo: "o/r", number: 1, at_ms: 10 * M, created: true }, { repo: "o/r", number: 2, at_ms: 20 * M, created: true }]
  const g2 = gh([["o/r#1", pull(T0 + 10 * M, { merged: T0 + 10 * M + 30 * S })], ["o/r#2", pull(T0 + 20 * M + 189 * S)]])
  const c2 = prClock(spread, g2)
  assert.deepEqual(c2.anchor.reasons, ["anchor_spread"])
  const skewed = c2.prs[0]
  assert.equal(skewed.merged_at_ms, skewed.opened_at_ms)
  // The merge came after the session's own opening time, so the clamped time is a lower bound whatever the anchor's spread.
  assert.deepEqual(skewed.merged_state, { state: "partial", bound: "lower", reasons: ["anchor_spread", "clock_skew"] })
  assert.deepEqual(skewed.reasons, ["anchor_spread", "clock_skew"])
})

test("a clamped merge whose anchor said at most has no known direction, and is published as unknown, never as at least", () => {
  // A merge placed through an anchor that is a lower bound is an upper bound
  // ("at most"). If it still lands before the session's own opening time,
  // the two say opposite things, so its direction is not known.
  const anchor = { state: "partial", bound: "lower", reasons: ["anchor_unconfirmed"], basis: "timed", n: 2, candidates: 3, uncertainty_ms: 90 * S, value_ms: T0 }
  const prs = [{ repo: "o/r", number: 1, at_ms: 10 * M, created: true }]
  const g = gh([["o/r#1", pull(T0 + 9 * M, { merged: T0 + 9 * M + 30 * S })]])
  const one = placePrs(prs, g, anchor)[0]
  assert.equal(one.opened_basis, "desk")
  assert.equal(one.merged_at_ms, one.opened_at_ms)
  assert.deepEqual(one.merged_state, { state: "partial", bound: null, reasons: ["anchor_unconfirmed", "clock_skew_conflict"] })
  assert.deepEqual(one.reasons, ["anchor_unconfirmed", "clock_skew_conflict"])
  // Through a measured anchor, or one with no direction, the clamp stays a lower bound with clock_skew.
  const measured = placePrs(prs, g, { ...anchor, state: "measured", reasons: [], bound: undefined })[0]
  assert.deepEqual(measured.merged_state, { state: "partial", bound: "lower", reasons: ["clock_skew"] })
  // prClock itself never builds that case: a created pull request makes the anchor's basis "created", whose partial anchor has no direction.
  const c = prClock([...prs, { repo: "o/r", number: 2, at_ms: 30 * M, created: true }], gh([["o/r#1", pull(T0 + 10 * M, { merged: T0 + 10 * M + 30 * S })], ["o/r#2", pull(T0 + 30 * M + 200 * S)]]))
  assert.equal(c.anchor.bound, null)
  assert.notDeepEqual(c.prs[0].merged_state.reasons, ["anchor_unconfirmed", "clock_skew_conflict"])
})

test("when the pull requests that set the clock could not be read, a pull request that was read says so, not that it was unreadable", () => {
  const prs = [{ repo: "o/r", number: 1, at_ms: 5 * M }, { repo: "o/r", number: 2 }]
  const c = prClock(prs, gh([["o/r#1", null], ["o/r#2", pull(T0, { merged: T0 + M })]]))
  assert.deepEqual(c.prs[0].reasons, ["github_unreadable"])
  assert.deepEqual(c.prs[1].reasons, ["anchor_github_unreadable"])
  const capped = prClock(prs, gh([["o/r#2", pull(T0)]]), { capped: new Set(["o/r#1"]) })
  assert.deepEqual(capped.prs[1].reasons, ["anchor_github_lookup_capped"])
})

test("with no anchor, a created and timed pull request keeps its session time, and every other one is not placed with the anchor's reason", () => {
  // A merge time needs the anchor even when the opening is known.
  const created = prClock([{ repo: "o/r", number: 1, at_ms: 5 * M, created: true }], gh([["o/r#1", null]]))
  assert.equal(created.prs[0].opened_at_ms, 5 * M)
  assert.equal(created.prs[0].opened_basis, "desk")
  assert.equal(created.prs[0].merged_basis, "not_placed")
  assert.deepEqual(created.prs[0].reasons, ["github_unreadable"])
  // Task 23e26d3f's shape: twelve pull requests, none timed.
  const prs = Array.from({ length: 12 }, (_, i) => ({ repo: "o/r", number: i + 1 }))
  const g = gh(prs.map((p) => [prKey(p), pull(T0 + p.number * M, { merged: T0 + p.number * M + M })]))
  const c = prClock(prs, g)
  assert.deepEqual(c.anchor.reasons, ["no_timed_pr"])
  for (const p of c.prs) {
    assert.equal(p.opened_basis, "not_placed")
    assert.equal(p.opened_at_ms, null)
    assert.equal(p.merged_at_ms, null)
    assert.equal(p.state, "merged", "GitHub's state is known even when the time is not placed")
    assert.deepEqual(p.reasons, ["no_timed_pr"])
  }
})

test("a pull request beyond the lookup cap is not placed, with the reason github_lookup_capped; the cap covers today's pull requests", () => {
  const prs = [
    { repo: "o/r", number: 1, at_ms: M },
    { repo: "o/r", number: 2, at_ms: 2 * M },
  ]
  const c = prClock(prs, gh([["o/r#1", pull(T0 + M)]]), { capped: new Set(["o/r#2"]) })
  assert.equal(c.prs[1].opened_basis, "not_placed")
  assert.deepEqual(c.prs[1].reasons, ["github_lookup_capped"])
  // 341 pull requests across every task on 2026-10-08, with room to grow.
  assert.ok(MAX_PR_LOOKUPS >= 500)
})

test("a pull request listed twice keeps its earliest timed mention, and the list keeps Desk's order", () => {
  const prs = [
    { repo: "o/r", number: 2, at_ms: 9 * M },
    { repo: "o/r", number: 1, at_ms: 5 * M },
    { repo: "o/r", number: 2, at_ms: 3 * M },
  ]
  const g = gh([
    ["o/r#1", pull(T0 + 5 * M)],
    ["o/r#2", pull(T0 + 3 * M)],
  ])
  const c = prClock(prs, g)
  assert.deepEqual(c.prs.map((p) => p.number), [2, 1])
  assert.equal(c.prs[0].opened_at_ms, 3 * M)
  assert.equal(placePrs([], g, c.anchor).length, 0)
})

test("the store states the operator-turn and pull-request lists from the hosts when Desk does not, and Desk's own state wins", () => {
  const cc = (id) => ({ id, host: "claude-code" })
  // Every Claude Code session recorded its first prompt: the list is whole.
  assert.deepEqual(listStates({ sessions: [cc("s1")], human_turns: [{ session: "s1", at_ms: 0 }] }).human_turns_state, { state: "measured", reasons: [], basis: "store_from_hosts" })
  // A task with no turns reads "not recorded", never "no prompts".
  assert.deepEqual(listStates({ sessions: [cc("s1")], human_turns: [] }).human_turns_state, { state: "unavailable", reasons: ["not_recorded"], basis: "store_from_hosts" })
  // A Claude Code session with no turn (older facts) makes the list a lower bound.
  assert.deepEqual(listStates({ sessions: [cc("s1"), cc("s2")], human_turns: [{ session: "s1", at_ms: 0 }] }).human_turns_state, { state: "partial", bound: "lower", reasons: ["not_recorded"], basis: "store_from_hosts" })
  // Codex records no turns; Copilot records them partly.
  assert.deepEqual(listStates({ sessions: [{ id: "x", host: "codex-cli" }], human_turns: [] }).human_turns_state, { state: "unavailable", reasons: ["host_does_not_record"], basis: "store_from_hosts" })
  assert.deepEqual(listStates({ sessions: [cc("s1"), { id: "c", host: "copilot-cli" }, { id: "x", host: "codex-cli" }], human_turns: [{ session: "s1" }, { session: "c" }] }).human_turns_state, { state: "partial", bound: "lower", reasons: ["host_does_not_record", "host_records_partly"], basis: "store_from_hosts" })
  // Every host records pull requests only partly.
  assert.deepEqual(listStates({ sessions: [cc("s1")], prs: [] }).prs_state, { state: "partial", bound: "lower", reasons: ["host_records_partly"], basis: "store_from_hosts" })
  // Desk's D4 envelopes win.
  const desk = listStates({ sessions: [cc("s1")], human_turns: [], human_turns_state: { state: "partial", reasons: ["log_truncated"], bound: "lower" }, prs_state: { state: "measured", reasons: [] } })
  assert.deepEqual(desk.human_turns_state, { state: "partial", reasons: ["log_truncated"], bound: "lower", basis: "desk" })
  assert.deepEqual(desk.prs_state, { state: "measured", reasons: [], basis: "desk" })
})

test("the Pages build places each task's pull requests from the build's GitHub reads, and takes the finish date from data.json", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { publishData, readPulls } = await import("../../../site/scripts/publish-files.mjs")
  const root = mkdtempSync(join(tmpdir(), "pr-clock-"))
  const reports = join(root, "reports")
  const dist = join(root, "dist")
  mkdirSync(join(reports, "jobs"), { recursive: true })
  mkdirSync(dist, { recursive: true })
  const timeline = {
    prs: [
      { repo: "o/r", number: 1, at_ms: 10 * M },
      { repo: "o/r", number: 2, at_ms: 20 * M },
      { repo: "o/r", number: 3 },
    ],
    human_turns: [{ at_ms: 0, session: "s1", basis: "first" }],
    sessions: [{ id: "s1", host: "claude-code", offset_ms: 0 }],
    bursts: [],
    gaps: [],
  }
  writeFileSync(join(reports, "jobs", "j1.json"), JSON.stringify({ job: { id: "j1" }, timeline }))
  writeFileSync(join(dist, "data.json"), JSON.stringify({ jobs: [{ id: "j1", finish_date: { state: "measured", value: "2026-10-05", basis: "pr_anchor", reasons: [] } }] }))
  const pullsFile = join(root, "pulls.json")
  writeFileSync(
    pullsFile,
    JSON.stringify({
      schema: "factory.site.pulls/1",
      pulls: { "o/r#1": pull(T0 + 10 * M + 2 * S, { merged: T0 + 30 * M }), "o/r#2": pull(T0 + 20 * M + 4 * S) },
      capped: ["o/r#3"],
    }),
  )
  publishData({ reports, dist, pulls: readPulls(pullsFile) })
  const map = JSON.parse(readFileSync(join(dist, "map", "j1.json"), "utf8"))
  assert.equal(map.schema, "factory.site.map/2")
  assert.equal(map.pr_anchor.state, "measured")
  assert.deepEqual(map.prs.map((p) => [p.number, p.opened_basis, p.state]), [
    [1, "pr_anchor", "merged"],
    [2, "pr_anchor", "open"],
    [3, "not_placed", null],
  ])
  assert.equal(map.prs[0].merged_at_ms, 30 * M - 3 * S)
  assert.deepEqual(map.prs[2].reasons, ["github_lookup_capped"])
  assert.deepEqual(map.finish_date, { state: "measured", value: "2026-10-05", basis: "pr_anchor", reasons: [] })
  // No GitHub time leaves the build: no ISO time and no epoch value in the map file.
  assert.doesNotMatch(JSON.stringify(map), /\d{4}-\d{2}-\d{2}T|"value_ms"|"created_at"|"merged_at"/)
  // An unreadable or missing pulls file reads as "GitHub not read", never as no pull requests.
  assert.equal(readPulls(join(root, "missing.json")), null)
  publishData({ reports, dist, pulls: null })
  const bare = JSON.parse(readFileSync(join(dist, "map", "j1.json"), "utf8"))
  assert.deepEqual(bare.prs.map((p) => p.reasons), [["github_not_read"], ["github_not_read"], ["github_not_read"]])
})

test("the site build reads every pull request on every task's timeline from GitHub once, caches the reads across builds, reads less the second time, and holds its lookup cap", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join, dirname } = await import("node:path")
  const { spawnSync, execFileSync } = await import("node:child_process")
  const { pullsDoc } = await import("../../../site/scripts/pr-clock.mjs")
  // The pure part: only the three fields, and the capped keys.
  const doc = pullsDoc(new Map([["o/r#1", { title: "secret", created_at: "2026-10-05T12:00:00Z", merged_at: null, state: "open", user: { login: "x" } }], ["o/r#2", null]]), new Set(["o/r#3", "o/other#4"]), ["o/r#1", "o/r#2", "o/r#3"])
  assert.deepEqual(doc, { schema: "factory.site.pulls/1", max_lookups: MAX_PR_LOOKUPS, pulls: { "o/r#1": { created_at: "2026-10-05T12:00:00Z", merged_at: null, state: "open" }, "o/r#2": null }, capped: ["o/r#3"] })

  const dir = mkdtempSync(join(tmpdir(), "pr-clock-build-"))
  const reports = join(dir, "reports")
  const main = join(dir, "main")
  const json = (p, o) => {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(o))
  }
  json(join(reports, "rollups/coverage.json"), { sessions_with_facts: 0, jobs: 1, jobs_open: 0, labels: { files: 0 } })
  json(join(reports, "rollups/measures.json"), { groupings: {} })
  json(join(reports, "rollups/muda.json"), { groupings: { overall: { all: { jobs: 1, jobs_labeled: 0, wastes: [] } } }, wastes: [] })
  json(join(reports, "jobs/j1.json"), { job: "j1", formulas: { status: { class: "declared", value: "done" } }, timeline: { prs: [{ repo: "o/r", number: 1, at_ms: 5 }, { repo: "o/r", number: 2 }, { repo: "o/r", number: 1, at_ms: 9 }] } })
  mkdirSync(join(main, "facts"), { recursive: true })
  execFileSync("git", ["init", "-q", main])
  json(join(reports, "jobs/j2.json"), { job: "j2", formulas: { status: { class: "declared", value: "done" } }, timeline: { prs: [{ repo: "o/private", number: 3, at_ms: 7 }] } })
  // A stand-in for GitHub: two pull requests with ETags, a private one it will not show, and a log of every pull request request.
  const stub = join(dir, "stub.mjs")
  const log = join(dir, "requests.log")
  writeFileSync(
    stub,
    `import { appendFileSync } from "node:fs";
const bodies = { "/repos/o/r/pulls/1": { title: "t", created_at: "2026-10-05T12:00:05Z", merged_at: "2026-10-05T13:00:00Z", state: "closed", merged: true, html_url: "https://github.com/o/r/pull/1", base: { repo: { private: false } }, user: { login: "someone" } }, "/repos/o/r/pulls/2": { title: "u", created_at: "2026-10-05T12:30:00Z", merged_at: null, state: "open", merged: false, html_url: "https://github.com/o/r/pull/2", base: { repo: { private: false } } } };
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const h = init.headers || {};
  if (path.includes("/pulls/")) appendFileSync(process.env.STUB_LOG, path + " " + (h["If-None-Match"] || "-") + "\\n");
  const b = bodies[path];
  const etag = b ? '"e-' + path.split("/").pop() + '"' : null;
  if (b && h["If-None-Match"] === etag) return { ok: false, status: 304, headers: new Headers({ etag }), json: async () => null };
  return { ok: !!b, status: b ? 200 : 404, headers: new Headers(b ? { etag } : {}), json: async () => b };
};`,
  )
  const out = join(dir, "dist/data.json")
  const pullsOut = join(dir, "tmp/pulls.json")
  const cache = join(dir, "tmp/pulls-cache.json")
  const requests = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [])
  const run = (extra, env) => spawnSync("node", ["--import", stub, new URL("../../../site/scripts/build-data.mjs", import.meta.url).pathname, "--reports", reports, "--main", main, "--out", out, ...extra], { env: { ...process.env, GITHUB_TOKEN: "", FACTORY_SITE_OFFLINE: "", FACTORY_SITE_MAX_PR_LOOKUPS: "", STUB_LOG: log, ...env }, encoding: "utf8" })
  const r = run(["--pulls-out", pullsOut, "--pulls-cache", cache], {})
  assert.equal(r.status, 0, r.stderr)
  const pulls = JSON.parse(readFileSync(pullsOut, "utf8"))
  assert.deepEqual(pulls.pulls, { "o/private#3": null, "o/r#1": { created_at: "2026-10-05T12:00:05Z", merged_at: "2026-10-05T13:00:00Z", state: "closed" }, "o/r#2": { created_at: "2026-10-05T12:30:00Z", merged_at: null, state: "open" } })
  assert.deepEqual(pulls.capped, [])
  assert.equal(requests().length, 3, "each pull request is read once, however many tasks and uses name it")
  assert.match(r.stdout, /GitHub pull request reads: 3 requests \(2 fetched, 0 not modified, 0 final from the cache, 1 failed, 0 capped, 0 invalid\)/)
  // The cache keeps only the fields the build uses, with each ETag; never the author.
  const cached = JSON.parse(readFileSync(cache, "utf8"))
  assert.equal(cached.schema, "factory.site.pulls-cache/1")
  assert.deepEqual(Object.keys(cached.pulls).sort(), ["o/r#1", "o/r#2"])
  assert.doesNotMatch(JSON.stringify(cached), /someone|login/)
  // The second build reads less: the merged pull request is final, the open one is asked with its ETag (304), the unreadable one is asked again.
  writeFileSync(log, "")
  const r2 = run(["--pulls-out", pullsOut, "--pulls-cache", cache], {})
  assert.equal(r2.status, 0, r2.stderr)
  assert.deepEqual(requests().sort(), ["/repos/o/private/pulls/3 -", '/repos/o/r/pulls/2 "e-2"'])
  assert.match(r2.stdout, /GitHub pull request reads: 2 requests \(0 fetched, 1 not modified, 1 final from the cache, 1 failed, 0 capped, 0 invalid\)/)
  assert.deepEqual(JSON.parse(readFileSync(pullsOut, "utf8")).pulls, pulls.pulls, "the same answer from fewer reads")
  // The cap holds: with a cap of 1 and no cache, the first pull request is read and the rest are capped.
  writeFileSync(log, "")
  const r3 = run(["--pulls-out", pullsOut], { FACTORY_SITE_MAX_PR_LOOKUPS: "1" })
  assert.equal(r3.status, 0, r3.stderr)
  assert.equal(requests().length, 1)
  assert.deepEqual(JSON.parse(readFileSync(pullsOut, "utf8")).capped, ["o/r#1", "o/r#2"])
  assert.equal(JSON.parse(readFileSync(out, "utf8")).config.max_pr_lookups, 1, "the published cap is the one the build used")
  run(["--pulls-out", pullsOut], {})
  assert.equal(JSON.parse(readFileSync(out, "utf8")).config.max_pr_lookups, MAX_PR_LOOKUPS)
  // Offline, nothing is read, so no file is written and every pull request reads "GitHub not read".
  const offlineOut = join(dir, "tmp/offline.json")
  assert.equal(run(["--pulls-out", offlineOut], { FACTORY_SITE_OFFLINE: "1" }).status, 0)
  assert.equal(existsSync(offlineOut), false)
})

test("every reason the PR clock can give has the page's words, and the data index describes the map file's clock", async () => {
  const { createRequire } = await import("node:module")
  const F = createRequire(import.meta.url)("../../../site/src/format.js")
  for (const r of ["anchor_spread", "anchor_unconfirmed", "anchor_spread_too_wide", "anchor_github_unreadable", "anchor_github_lookup_capped", "clock_skew", "not_merged", "no_timed_pr", "no_created_timed_pr", "github_unreadable", "github_lookup_capped", "github_not_read", "merged_time_not_recorded", "clock_skew_conflict"]) assert.ok(F.hasReasonText(r), r)
  const { llmsText } = await import("../../../site/scripts/publish-files.mjs")
  assert.match(llmsText("{{FILES}}", [{ path: "map/j1.json", bytes: 10 }]), /operator prompts \(each with its why\), the waits before them, and pull requests with their opened and merged times on the task clock/)
  // The placing limit is stated where agents read it.
  assert.match(llmsText("{{FILES}}", [{ path: "map/j1.json", bytes: 10 }]), /not placed when the task's clock anchor may be off by more than 15 minutes/)
})

test("the pull reader treats only merged pull requests in its cache as final, asks about open and closed ones with their ETag, and never answers a failed read with an old body", async () => {
  const calls = []
  const replies = new Map()
  const fetchImpl = async (url, headers) => {
    calls.push([new URL(url).pathname, headers["If-None-Match"] || null])
    const r = replies.get(new URL(url).pathname)
    if (!r) throw new Error("network down")
    return r
  }
  const body = (over) => ({ title: "t", created_at: "2026-10-05T12:00:00Z", merged_at: null, state: "open", merged: false, html_url: "https://github.com/o/r/pull/1", base: { repo: { private: false } }, ...over })
  const cache = {
    schema: "factory.site.pulls-cache/1",
    pulls: {
      "o/r#1": { etag: '"m"', body: body({ merged_at: "2026-10-05T13:00:00Z", state: "closed", merged: true }) },
      "o/r#2": { etag: '"c"', body: body({ state: "closed" }) },
      "o/r#3": { etag: '"o"', body: body({}) },
      "o/r#4": { etag: '"x"', body: body({}) },
    },
  }
  replies.set("/repos/o/r/pulls/3", { ok: false, status: 304, headers: new Headers({ etag: '"o"' }), json: async () => null })
  // Closed, not merged: it may be reopened or merged later, so it is asked again (a 304 costs nothing).
  replies.set("/repos/o/r/pulls/2", { ok: false, status: 304, headers: new Headers({ etag: '"c"' }), json: async () => null })
  const reader = createPullReader({ fetch: fetchImpl, cache, max: 10 })
  assert.equal((await reader.read("o/r", 1)).merged, true)
  assert.equal((await reader.read("o/r", 2)).state, "closed")
  assert.equal((await reader.read("o/r", 3)).state, "open")
  // A failed read is unreadable this build, even with an older body in the cache.
  assert.equal(await reader.read("o/r", 4), null)
  // Read once per build.
  await reader.read("o/r", 3)
  assert.deepEqual(calls, [["/repos/o/r/pulls/2", '"c"'], ["/repos/o/r/pulls/3", '"o"'], ["/repos/o/r/pulls/4", '"x"']])
  assert.deepEqual(reader.counts, { requests: 3, fetched: 0, not_modified: 2, final_from_cache: 1, failed: 1, capped: 0, invalid: 0 })
  assert.equal(reader.bodies.get("o/r#4"), null)
  // The old entry stays for the next build to ask about again.
  assert.ok(reader.cacheDoc().pulls["o/r#4"])
  // The cap counts requests only: final cache hits are free.
  const capped = createPullReader({ fetch: fetchImpl, cache, max: 0 })
  assert.equal((await capped.read("o/r", 1)).merged, true)
  assert.equal(await capped.read("o/r", 3), null)
  assert.deepEqual([...capped.capped], ["o/r#3"])
  assert.match(capped.summary(), /GitHub pull request reads: 0 requests \(0 fetched, 0 not modified, 1 final from the cache, 0 failed, 1 capped, 0 invalid\)/)
})

test("M1: the pull reader never asks GitHub for a malformed owner/name or number, and counts it as invalid", async () => {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ created_at: "2026-10-05T12:00:00Z", state: "open", base: { repo: { private: false } } }) }
  }
  const reader = createPullReader({ fetch: fetchImpl, max: 10 })
  for (const [repo, number] of [["../../x", 1], ["/name", 1], ["owner/", 1], ["o/..", 1], ["o/r/extra", 1], ["-o/r", 1], ["o/r", 0], ["o/r", -3], ["o/r", 1.5]]) {
    assert.equal(await reader.read(repo, number), null, `${repo}#${number}`)
  }
  assert.deepEqual(asked, [])
  assert.equal(reader.counts.invalid, 9)
  assert.match(reader.summary(), /9 invalid/)
  assert.ok(await reader.read("ourostack/factory", 202))
  assert.deepEqual(asked, ["https://api.github.com/repos/ourostack/factory/pulls/202"])
})

test("M1: the shared anchor and the placement skip malformed pull requests; a negative time stays a time on the task clock", () => {
  const g = gh([["o/r#1", pull(T0 + 10 * M)], ["../x#2", pull(T0 + 5 * M)], ["o/r#3", pull(T0 - 5 * S)]])
  // A negative offset is real: work can begin before the card was created.
  const a = prAnchor([{ repo: "o/r", number: 1, at_ms: 10 * M, created: true }, { repo: "../x", number: 2, at_ms: 10 * M, created: true }, { repo: "o/r", number: 3, at_ms: -5 * S, created: true }], g)
  assert.deepEqual([a.n, a.state, a.value_ms], [2, "measured", T0])
  const placed = placePrs([{ repo: "../x", number: 2, at_ms: 10 * M }, { repo: "o/r", number: 0, at_ms: 10 * M }, { repo: "o", number: 4, at_ms: 1 }], g, a)
  assert.deepEqual(placed, [])
})
