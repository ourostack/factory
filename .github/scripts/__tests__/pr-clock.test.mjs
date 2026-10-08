// The PR clock (site/scripts/pr-clock.mjs): placing each pull request's
// GitHub opened and merged times on the task clock through the task's clock
// anchor, the anchor itself (median, outliers, spread), the D4 `created`
// flag, the lookup cap, and the operator-turn and pull-request list states
// the store states when Desk does not.
import assert from "node:assert/strict"
import { test } from "node:test"

import { ANCHOR_SPREAD_MS, MAX_PR_LOOKUPS, listStates, placePrs, prAnchor, prClock, prKey } from "../../../site/scripts/pr-clock.mjs"

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

test("an anchor whose kept pull requests span more than 2 minutes is partial, with no direction and the reason anchor_spread", () => {
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
  assert.equal(a.bound, null)
  assert.deepEqual(a.reasons, ["anchor_spread"])
  assert.equal(a.spread_ms, 220 * S)
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
  assert.deepEqual(a, { repo: "o/r", number: 1, created: true, opened_at_ms: 10 * M, opened_basis: "desk", merged_at_ms: 70 * M - 2 * S, merged_basis: "pr_anchor", state: "merged", reasons: [] })
  assert.deepEqual(b, { repo: "o/r", number: 2, created: true, opened_at_ms: 40 * M, opened_basis: "desk", merged_at_ms: null, merged_basis: "not_merged", state: "closed", reasons: [] })
  assert.deepEqual(d, { repo: "o/r", number: 3, created: null, opened_at_ms: 55 * M, opened_basis: "pr_anchor", merged_at_ms: null, merged_basis: "not_merged", state: "open", reasons: [] })
  assert.deepEqual(e, { repo: "o/private", number: 4, created: null, opened_at_ms: null, opened_basis: "not_placed", merged_at_ms: null, merged_basis: "not_placed", state: null, reasons: ["github_unreadable"] })
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

test("the site build reads every pull request on every task's timeline from GitHub once, keeps only the opened and merged times and state, and states its lookup cap", async () => {
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
  // A stand-in for GitHub: the two pull requests, and nothing else.
  const stub = join(dir, "stub.mjs")
  writeFileSync(
    stub,
    `const bodies = { "/repos/o/r/pulls/1": { title: "t", created_at: "2026-10-05T12:00:05Z", merged_at: "2026-10-05T13:00:00Z", state: "closed", merged: true, html_url: "https://github.com/o/r/pull/1", base: { repo: { private: false } } }, "/repos/o/r/pulls/2": { title: "u", created_at: "2026-10-05T12:30:00Z", merged_at: null, state: "open", base: { repo: { private: false } } } };
globalThis.fetch = async (url) => { const b = bodies[new URL(url).pathname]; return { ok: !!b, json: async () => b } };`,
  )
  const out = join(dir, "dist/data.json")
  const pullsOut = join(dir, "tmp/pulls.json")
  const run = (extra, env) => spawnSync("node", ["--import", stub, new URL("../../../site/scripts/build-data.mjs", import.meta.url).pathname, "--reports", reports, "--main", main, "--out", out, ...extra], { env: { ...process.env, GITHUB_TOKEN: "", FACTORY_SITE_OFFLINE: "", ...env }, encoding: "utf8" })
  const r = run(["--pulls-out", pullsOut], {})
  assert.equal(r.status, 0, r.stderr)
  const pulls = JSON.parse(readFileSync(pullsOut, "utf8"))
  assert.deepEqual(pulls.pulls, { "o/r#1": { created_at: "2026-10-05T12:00:05Z", merged_at: "2026-10-05T13:00:00Z", state: "closed" }, "o/r#2": { created_at: "2026-10-05T12:30:00Z", merged_at: null, state: "open" } })
  assert.deepEqual(pulls.capped, [])
  // The cap is a published constant.
  assert.equal(JSON.parse(readFileSync(out, "utf8")).config.max_pr_lookups, MAX_PR_LOOKUPS)
  // Offline, nothing is read, so no file is written and every pull request reads "GitHub not read".
  const offlineOut = join(dir, "tmp/offline.json")
  assert.equal(run(["--pulls-out", offlineOut], { FACTORY_SITE_OFFLINE: "1" }).status, 0)
  assert.equal(existsSync(offlineOut), false)
})

test("every reason the PR clock can give has the page's words, and the data index describes the map file's clock", async () => {
  const { createRequire } = await import("node:module")
  const F = createRequire(import.meta.url)("../../../site/src/format.js")
  for (const r of ["anchor_spread", "no_timed_pr", "no_created_timed_pr", "github_unreadable", "github_lookup_capped", "github_not_read", "merged_time_not_recorded"]) assert.ok(F.hasReasonText(r), r)
  const { llmsText } = await import("../../../site/scripts/publish-files.mjs")
  assert.match(llmsText("{{FILES}}", [{ path: "map/j1.json", bytes: 10 }]), /operator prompts \(each with its why\), the waits before them, and pull requests with their opened and merged times on the task clock/)
})
