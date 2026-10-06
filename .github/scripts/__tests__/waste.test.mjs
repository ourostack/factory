import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { compareVersions, confidenceFigures, confidenceOf, evaluatorVersions, qualifiersOf } from "../../../site/scripts/waste.mjs"

const SCRIPT = new URL("../../../site/scripts/build-data.mjs", import.meta.url).pathname

// --- the rules, one by one ----------------------------------------------------

test("confidence is recorded only when all three levels are whole numbers that add up to the row's total", () => {
  assert.deepEqual(confidenceOf({ total_ms: 100, confidence_ms: { high: 60, medium: 30, low: 10 } }), { recorded: true, parts: { high: 60, medium: 30, low: 10 } })
  assert.equal(confidenceOf({ total_ms: 0, confidence_ms: { high: 0, medium: 0, low: 0 } }).recorded, true, "a row of no time is covered by no time")
  for (const bad of [undefined, null, {}, { high: 1, medium: 2 }, { high: 1, medium: 2, low: null }, { high: 1, medium: 2, low: -1 }, { high: 1, medium: 2, low: "3" }, { high: 1.5, medium: 2, low: 3 }, { high: 101, medium: 0, low: 0 }, [1, 2, 3]]) {
    assert.equal(confidenceOf({ total_ms: 100, confidence_ms: bad }).recorded, false, JSON.stringify(bad))
  }
})

test("a confidence that covers none or only part of the row's time is not recorded, so the row is not sound", () => {
  for (const parts of [{ high: 0, medium: 0, low: 0 }, { high: 60, medium: 0, low: 0 }, { high: 60, medium: 30, low: 20 }]) {
    const c = confidenceOf({ total_ms: 100, confidence_ms: parts })
    assert.equal(c.recorded, false, JSON.stringify(parts))
    assert.deepEqual(qualifiersOf("waiting", c), ["confidence_not_recorded"])
  }
  assert.equal(confidenceOf({ total_ms: null, confidence_ms: { high: 0, medium: 0, low: 0 } }).recorded, false, "no total, nothing to cover")
})

test("a row is sound only when its confidence is recorded, none is low, and it is not unknown", () => {
  const rec = (low) => ({ recorded: true, parts: { high: 1, medium: 1, low } })
  const none = { recorded: false, parts: null }
  assert.deepEqual(qualifiersOf("waiting", rec(0)), [])
  assert.deepEqual(qualifiersOf("waiting", rec(5)), ["low_confidence"])
  assert.deepEqual(qualifiersOf("waiting", none), ["confidence_not_recorded"])
  assert.deepEqual(qualifiersOf("unknown", rec(0)), ["unknown_label"])
  assert.deepEqual(qualifiersOf("unknown", none), ["unknown_label", "confidence_not_recorded"])
})

test("an unrecorded confidence figure is unavailable, never a measured zero", () => {
  const figures = confidenceFigures({ recorded: false, parts: null })
  for (const level of ["high_ms", "medium_ms", "low_ms"]) {
    assert.equal(figures[level].state, "unavailable")
    assert.equal("value" in figures[level], false)
  }
  assert.equal(confidenceFigures({ recorded: true, parts: { high: 0, medium: 0, low: 0 } }).low_ms.value, 0)
})

test("evaluator versions keep only real versions, once each; none recorded is null, not an empty list", () => {
  assert.deepEqual(evaluatorVersions(["3.2.0-alpha.98", "3.2.0", "3.2.0", "not a version", 5, "2026-10-06"]), ["3.2.0-alpha.98", "3.2.0"])
  assert.deepEqual(evaluatorVersions(["3.2.0-alpha.198", "3.10.0", "3.2.0-alpha.98", "3.2.0-beta.1", "3.2.0-rc.2", "3.9.1"]), ["3.2.0-alpha.98", "3.2.0-alpha.198", "3.2.0-beta.1", "3.2.0-rc.2", "3.9.1", "3.10.0"], "by version, not text")
  assert.ok(compareVersions("3.2.0", "3.2.0-rc.9") > 0)
  for (const bad of [undefined, null, [], ["x"], "3.2.0", {}]) assert.equal(evaluatorVersions(bad), null)
})

// --- through the build --------------------------------------------------------

function write(path, obj) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(obj))
}

const facts = (id, over = {}) => ({
  schema: "desk.factory.published/2",
  session: { host: "claude-code", id, duration_ms: 600000, ended: true, entrypoint: "cli", host_version: "1" },
  models: [],
  agents: [],
  intervals: [{ kind: "turn", start_ms: 0, end_ms: 400000 }],
  counts: { tool_calls: { shell: 30 }, tool_failures: { shell: 3 }, api_retries: 0, compactions: 0, tool_retries: 0 },
  refs: { prs: [], commits: [], private: { prs: 0, commits: 0 } },
  jobs: [],
  unavailable: [],
  ...over,
})

function fixture(muda, factsFiles) {
  const dir = mkdtempSync(join(tmpdir(), "waste-"))
  const reports = join(dir, "reports")
  const main = join(dir, "main")
  write(join(reports, "rollups/coverage.json"), { sessions_with_facts: 1, jobs: 3, jobs_open: 0, labels: { files: 2 } })
  write(join(reports, "rollups/measures.json"), { groupings: {} })
  write(join(reports, "rollups/muda.json"), muda)
  for (const [name, body] of Object.entries(factsFiles)) write(join(main, "facts", name), body)
  execFileSync("git", ["init", "-q", main])
  execFileSync("git", ["-C", main, "add", "."])
  execFileSync("git", ["-C", main, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", "intake"])
  return { reports, main, out: join(dir, "dist/data.json") }
}

function build(fx) {
  const r = spawnSync("node", [SCRIPT, "--reports", fx.reports, "--main", fx.main, "--out", fx.out], { env: { ...process.env, FACTORY_SITE_OFFLINE: "1", GITHUB_TOKEN: "" }, encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(readFileSync(fx.out, "utf8"))
}

const ALL = ["defects", "overproduction", "waiting", "non_utilized_talent", "transportation", "inventory", "motion", "extra_processing", "unknown"]
const muda = (rows, extra = {}) => ({ wastes: ALL, groupings: { overall: { all: { jobs: 3, jobs_labeled: 2, wastes: rows, ...extra } } } })

test("an unknown label keeps its own row, is never folded into another, and is not sound", () => {
  const rows = [
    { waste: "waiting", total_ms: 600000, jobs: 2, share: 0.6, confidence_ms: { high: 600000, medium: 0, low: 0 }, evaluator_versions: ["3.2.0-alpha.98"] },
    { waste: "unknown", total_ms: 400000, jobs: 1, share: 0.4, confidence_ms: { high: 400000, medium: 0, low: 0 }, evaluator_versions: ["3.2.0-alpha.98", "3.2.0-alpha.198"] },
  ]
  const data = build(fixture(muda(rows), { "claude-code-s1.json": facts("s1") }))
  assert.deepEqual(checkNumbers(data), [])
  assert.deepEqual(data.waste.breakdown.map((r) => r.waste), ["waiting", "unknown"])
  const [waiting, unknown] = data.waste.breakdown
  assert.equal(waiting.total_ms.value, 600000)
  assert.equal(unknown.total_ms.value, 400000)
  assert.deepEqual(waiting.qualifiers, [])
  assert.deepEqual(unknown.qualifiers, ["unknown_label"])
  assert.ok(data.waste.wastes.includes("unknown"))
  assert.equal(waiting.evaluator_versions.value, "3.2.0-alpha.98")
  assert.equal(unknown.evaluator_versions.value, "3.2.0-alpha.98, 3.2.0-alpha.198", "per row, in version order")
})

test("time on low-confidence labels is flagged, and a row with no recorded confidence is not sound", () => {
  const rows = [
    { waste: "defects", total_ms: 1000, jobs: 1, share: 0.5, confidence_ms: { high: 400, medium: 100, low: 500 } },
    { waste: "motion", total_ms: 1000, jobs: 1, share: 0.5 },
    { waste: "inventory", total_ms: 1000, jobs: 1, share: 0.5, confidence_ms: { high: 0, medium: 0, low: 0 } },
  ]
  const data = build(fixture(muda(rows), { "claude-code-s1.json": facts("s1") }))
  assert.deepEqual(checkNumbers(data), [])
  const [defects, motion, inventory] = data.waste.breakdown
  assert.deepEqual(defects.qualifiers, ["low_confidence"])
  assert.equal(defects.confidence.low_ms.value, 500)
  assert.deepEqual(motion.qualifiers, ["confidence_not_recorded"])
  assert.equal(motion.confidence.low_ms.state, "unavailable", "not recorded is not a zero")
  assert.deepEqual(inventory.qualifiers, ["confidence_not_recorded"], "a confidence covering none of the row's time is not recorded")
  assert.equal(inventory.confidence.low_ms.state, "unavailable")
  assert.equal(motion.evaluator_versions.state, "unavailable", "no version listed is not recorded, not none")
})

test("a published /3 facts file whose commit carries a time builds, and counts like any other", () => {
  const sha = "b".repeat(40)
  const v3 = facts("s3", { schema: "desk.factory.published/3", refs: { prs: [], commits: [{ repo: "ourostack/desk", sha, at_ms: 1200 }], private: { prs: 0, commits: 0 } }, unavailable: [{ field: "outcomes", reason: "capped" }] })
  const data = build(fixture(muda([]), { "claude-code-s1.json": facts("s1"), "claude-code-s3.json": v3 }))
  assert.deepEqual(checkNumbers(data), [])
  assert.equal(data.headlines.find((h) => h.id === "substantial_sessions").number.value >= 0, true)
})
