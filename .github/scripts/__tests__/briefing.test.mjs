import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deriveImprovementQueue } from "../../../site/scripts/improvement-queue.mjs"
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { publishData } from "../../../site/scripts/publish-files.mjs"

const require = createRequire(import.meta.url)
const file = new URL("../../../site/src/briefing.js", import.meta.url)
const B = existsSync(file) ? require(file.pathname) : {}
const m = (value) => ({ state: "measured", value, reasons: [] })
const now = Date.parse("2026-10-11T16:00:00Z")
const base = () => ({ schema: "factory-site/3", built_at: "2026-10-11T15:00:00Z", reports_commit: "a".repeat(40), jobs: [], fix_next: [], andon_issues: [], andon_verification: "unavailable" })
const build = (data = base(), improvements = deriveImprovementQueue({ batches: [], now }), previous = null) => {
  assert.equal(typeof B.buildBriefing, "function")
  return B.buildBriefing({ data, improvements, previous, now })
}

test("monitoring_absence_is_not_no_problems", () => {
  const absent = build()
  assert.equal(absent.state, "unknown")
  assert.ok(absent.reasons.includes("monitoring_not_available"))
  assert.equal(absent.agents.length, 0)
  assert.match(absent.investigation[0].next_action, /check|inspect/i)
  const data = base()
  data.fix_next = [
    { id: "optimization", severity: "investigate", title: "Read this later", count: m(99), action: "Inspect recorded evidence" },
    { id: "labels_mismatch", severity: "alarm", title: "Labels do not match", count: m(2), action: "Inspect the affected labels" },
    { id: "loop_alarm", severity: "alarm", title: "A loop step stopped", count: m(1), action: "Inspect loop records" },
  ]
  data.capture_coverage = { alarms: [{ host: "claude-code", code: "coverage_dropped" }] }
  data.andon_verification = "github"
  data.andon_issues = [{ issue_state: "open", ref: "#7", url: "https://github.com/example/project/issues/7" }]
  const out = build(data)
  assert.equal(out.state, "attention")
  assert.ok(out.attention.some((r) => r.family === "production"))
  assert.ok(out.attention.some((r) => r.family === "collection"))
  assert.ok(out.attention.some((r) => r.family === "improvement_system"))
  assert.ok(out.attention.every((r) => !/sav(e|ings)/i.test(r.title)))
  assert.deepEqual(checkNumbers({ overview: out }), [])
})

test("private_human_decision_without_public_issue_is_honest_and_actionable", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
  const queue = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(fx.public), committedAtMs: now }], now })
  const out = build(base(), queue)
  const row = out.attention.find((r) => r.triage)
  assert.ok(row)
  assert.equal(row.ownership, "not_published")
  assert.deepEqual(row.triage.handoff, queue.rows[0].handoff)
  for (const k of ["decision", "recommendation", "safe_continuation"]) assert.deepEqual(row.triage[k], { state: "unavailable", reason: "detail_not_published" })
  assert.equal(row.triage.gate_explanation, queue.rows[0].gate_explanation)
  assert.equal(out.agents.length, 0, "route alone is not a claim")
  assert.equal(row.triage.availability, "private_detail_not_published")
  for (const sentinel of fx.privacy_sentinels) assert.ok(!JSON.stringify(out).includes(sentinel))
  const claimed = structuredClone(fx.public)
  claimed.rows[0].ownership = "claimed"
  claimed.rows[0].route = "agent_ready"
  claimed.rows[0].gate = null
  const owned = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(claimed), committedAtMs: now }], now })
  assert.equal(build(base(), owned).agents.length, 1)
  const supported = fx.cases.find((c) => c.name === "verified_public_issue_context_no_decision_fields")
  const publicBatch = structuredClone(fx.public)
  Object.assign(publicBatch.rows[0], supported.row)
  const publicQueue = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(publicBatch), committedAtMs: now }], publicEvidence: supported.publicEvidence, now })
  const publicRow = build(base(), publicQueue).attention.find((r) => r.triage)
  assert.deepEqual(publicRow.triage.context, publicQueue.rows[0].context)
  assert.equal(publicRow.triage.context[0].label, "Synthetic issue")
  assert.equal(publicRow.triage.decision.state, "unavailable", "a public label cannot invent a specific decision")
  const stale = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(claimed), committedAtMs: now - 80 * 3600000 }], now })
  assert.equal(build(base(), stale).agents.length, 0, "a stale claimed row is not current agent work")
})

test("closed overview refuses extra prose, malformed number and nested measurement exemptions", () => {
  const doc = build()
  assert.equal(typeof B.validateBriefing, "function")
  assert.equal(B.validateBriefing(doc).ok, true)
  for (const mutate of [(d) => { d.private_path = "/private" }, (d) => { d.attention.push({ id: "made_up", value: 5 }) }, (d) => { d.changes.added = -1 }]) {
    const d = structuredClone(doc); mutate(d)
    assert.equal(B.validateBriefing(d).ok, false)
    assert.ok(checkNumbers({ overview: d }).some((e) => e.code === "overview_projection_invalid"))
  }
  assert.ok(checkNumbers({ nested: { overview: doc } }).length)
  assert.ok(checkNumbers({ overview: doc, measurement: 1 }).length)
})

test("overview figures keep the ordinary stated-number rules despite the presentation envelope", () => {
  const data = base()
  data.fix_next = [{ id: "investigate", severity: "act", title: "Inspect evidence", action: "Read the recorded evidence", count: m(2) }]
  const good = build(data)
  assert.equal(good.investigation[0].number.value, 2)
  for (const n of [
    null,
    { ...m(2), bound: "lower" },
    { ...m(2), reasons: ["capped"] },
    { state: "partial", value: 2, reasons: [], bound: "lower" },
    { ...m(2), basis: "made_up" },
  ]) {
    const doc = structuredClone(good); doc.investigation[0].number = n
    assert.ok(checkNumbers({ overview: doc }).length, JSON.stringify(n))
  }
})

test("a claimed overview row needs a current validated public claim, not a forged display label", () => {
  const doc = build()
  const row = structuredClone(doc.investigation[0])
  row.id = "fake_claim"; row.ownership = "claimed"
  doc.agents.push(row)
  assert.equal(B.validateBriefing(doc).ok, false)
  assert.ok(checkNumbers({ overview: doc }).length)
})

test("publisher refuses an invalid overview figure before copying any twin", () => {
  const data = base()
  data.fix_next = [{ id: "investigate", severity: "act", title: "Inspect evidence", action: "Read the recorded evidence", count: m(2) }]
  const overview = build(data)
  overview.investigation[0].number.bound = "lower"
  const dir = mkdtempSync(join(tmpdir(), "overview-publish-"))
  try {
    mkdirSync(join(dir, "dist")); mkdirSync(join(dir, "reports"))
    writeFileSync(join(dir, "dist/data.json"), JSON.stringify({ overview }))
    assert.throws(() => publishData({ reports: join(dir, "reports"), dist: join(dir, "dist") }), /overview_projection_invalid/)
    assert.equal(existsSync(join(dir, "dist/rollups/overview.json")), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
