import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

// The RED run reports assertions about absent behavior, not an import crash.
const optional = async (url) => {
  try { return await import(url) } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND") return {}; throw e }
}
const values = await optional(new URL("../triage-values.mjs", import.meta.url))
const queue = await optional(new URL("../../../site/scripts/improvement-queue.mjs", import.meta.url))
const validate = (...args) => {
  assert.equal(typeof values.validateTriageValues, "function", "missing closed triage validator")
  return values.validateTriageValues(...args)
}
const change = (...args) => {
  assert.equal(typeof values.validateTriageChangeValues, "function", "missing contextual triage gate")
  return values.validateTriageChangeValues(...args)
}
const derive = (...args) => {
  assert.equal(typeof queue.deriveImprovementQueue, "function", "missing triage queue reducer")
  return queue.deriveImprovementQueue(...args)
}
const present = (...args) => {
  assert.equal(typeof queue.presentTriageContext, "function", "missing safe triage context")
  return queue.presentTriageContext(...args)
}
const fixtureBytes = readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url))
export const fixture = JSON.parse(fixtureBytes)
const clone = (v) => structuredClone(v)
const bytes = (v) => JSON.stringify(v) + "\n"
const PATH = `triage/${fixture.public.batch}.json`
const now = Date.parse("2026-10-10T12:00:00Z")
const row = (over = {}) => ({ ...clone(fixture.public.rows[0]), ...over })
const batch = (rows = [row()], over = {}) => ({ ...clone(fixture.public), rows, ...over })
const accepted = (value, committedAtMs = now) => ({
  path: `triage/${value.batch}.json`, bytes: bytes(value), committedAtMs,
})
function materialize(c) {
  const value = batch(c.rows ?? [row(c.row)])
  for (const k of ["schema", "producer_version", "rubric_version"]) if (c[k] !== undefined) value[k] = c[k]
  for (const k of ["coverage", "runner"]) if (c[k]) Object.assign(value[k], c[k])
  return value
}

test("triage_closed_contract and exact released D/S fixture byte pair", async () => {
  const desk = process.env.DESK_DIR
  if (desk) {
    assert.deepEqual(fixtureBytes, readFileSync(join(desk, "tests/desk/mcp/__tests__/factory/fixtures/v12-triage.json")))
    const d = await import(pathToFileURL(join(desk, "plugins/desk/mcp/src/factory/triage-schema.js")))
    assert.deepEqual(values.TRIAGE_RUNNER_STATES, d.TRIAGE_RUNNER_STATES)
    assert.equal(values.TRIAGE_PATH?.source, d.TRIAGE_PATH.source)
    for (const c of fixture.cases) {
      const b = bytes(materialize(c))
      assert.deepEqual(validate(b), { ok: d.validateTriageBytes(b).ok, codes: [...new Set(d.validateTriageBytes(b).errors.map((e) => e.code))].sort() }, c.name)
    }
  } else if (process.env.FACTORY_REQUIRE_DESK === "1") assert.fail("Desk parity required")
  for (const c of fixture.cases) assert.equal(validate(bytes(materialize(c))).ok, c.valid !== false, c.name)
  for (const bad of [
    { ...batch(), rows: Array(21).fill(row()) },
    batch([row({ revision: Number.MAX_SAFE_INTEGER + 1 })]),
    batch([row({ route: "run" })]),
    batch([row({ id: fixture.privacy_sentinels[0] })]),
    batch([row(), row()]),
    ...fixture.privacy_sentinels.map((s) => batch([row({ private_detail: s })])),
  ]) assert.equal(validate(bytes(bad)).ok, false)
  assert.deepEqual(validate('{"schema":"x","schema":"desk.factory.triage/1"}').codes, ["canonical"])
  assert.deepEqual(validate("not JSON").codes, ["json"])
})

test("accepted_batch_cannot_be_replaced_removed_or_renamed", () => {
  const good = { path: PATH, status: "added", bytes: bytes(batch()), trustedMaintainer: true }
  assert.deepEqual(change(good), { ok: true, codes: [] })
  for (const status of ["modified", "removed", "renamed", "copied", "type_changed", "unknown", undefined]) {
    assert.ok(change({ ...good, status }).codes.includes("triage_immutable"), String(status))
  }
  for (const previousBytes of [bytes(batch()), "", null]) assert.ok(change({ ...good, previousBytes }).codes.includes("triage_immutable"))
  assert.ok(change({ ...good, path: "triage/fedcba9876543210.json" }).codes.includes("triage_batch_mismatch"))
  assert.ok(change({ ...good, path: "triage/nested/a.json" }).codes.includes("path"))
})

test("other_intake_actor_cannot_advance_existing_triage_id and unacknowledged_first_assignment_not_current", () => {
  for (const revision of [1, 7]) for (const evidence of [[], [{ kind: "issue", ref: "https://github.com/example/project/issues/1", revision: 1 }]]) {
    const b = bytes(batch([row({ revision, evidence })]))
    for (const [trustedMaintainer, code] of [[false, "triage_untrusted_producer"], [undefined, "triage_authority_check_unavailable"], ["OWNER", "triage_authority_check_unavailable"]]) {
      assert.ok(change({ path: PATH, status: "added", bytes: b, trustedMaintainer }).codes.includes(code))
    }
  }
})

test("triage_ordering_and_absence", () => {
  const b7 = accepted(batch([row({ revision: 7 })]))
  const b6 = accepted(batch([row({ revision: 6 })]))
  const q = derive({ batches: [b7, b6], now })
  assert.equal(q.rows[0].revision, 7)
  assert.equal(q.rows[0].conflict, false)
  assert.deepEqual(derive({ batches: [b6, b7], now }), q)
  assert.equal(derive({ batches: [], now }).state, "not_reviewed")
  assert.equal(derive({ batches: [b7, accepted(batch([]))], now }).rows[0].revision, 7)
  const conflict = derive({ batches: [b7, accepted(batch([row({ revision: 7, route: "investigate", gate: null })]))], now })
  assert.equal(conflict.rows[0].conflict, true)
  assert.equal(conflict.rows[0].availability, "stale_or_conflicting")
  const withdrawn = derive({ batches: [b7, accepted(batch([row({ revision: 8, state: "withdrawn", route: null, gate: null })]))], now })
  assert.equal(withdrawn.rows[0].state, "withdrawn")
  assert.equal(withdrawn.rows[0].route, null)
  const issue = [{ kind: "issue", ref: "https://github.com/example/project/issues/1", revision: 1 }]
  const shared = derive({ batches: [accepted(batch([row({ evidence: issue }), row({ id: "f".repeat(32), evidence: issue })]))], now })
  assert.ok(shared.rows.every((r) => r.conflict))
})

test("triage freshness and coverage never sum conflicting generations or invent review times", () => {
  for (const committedAtMs of [null, now + 1, now - 72 * 3600000 - 1]) {
    const q = derive({ batches: [accepted(batch(), committedAtMs)], now })
    assert.equal(q.rows[0].availability, "stale_or_conflicting")
    assert.equal(q.coverage.state, "unknown")
  }
  assert.equal(derive({ batches: [accepted(batch(), now - 72 * 3600000)], now }).rows[0].availability, "private_detail_not_published")
  const two = derive({ batches: [accepted(batch()), accepted(batch([], { coverage: { ...fixture.public.coverage, generation: "f".repeat(32) } }))], now })
  assert.equal(two.coverage.state, "unknown")
  assert.equal(two.coverage.reviewed, null)
  const incomplete = derive({ batches: [accepted(materialize(fixture.cases.find((c) => c.name === "incomplete_scan")))], now })
  assert.equal(incomplete.state, "unknown")
  assert.equal(incomplete.coverage.state, "unknown")
  for (const state of ["source_unknown", "stale", "withdrawn"]) {
    const r = row({ state, ...(state === "withdrawn" ? { route: null, gate: null } : {}) })
    assert.equal(derive({ batches: [accepted(batch([r]))], now }).rows[0].availability, "stale_or_conflicting")
  }
  assert.equal(derive({ batches: [{ bytes: "bad" }], now }).state, "unknown")
  assert.equal(derive({ batches: [accepted(batch()), { bytes: "bad" }], now }).rows[0].availability, "stale_or_conflicting")
})

test("private_human_decision_without_public_issue_is_honest_and_actionable", () => {
  const r = derive({ batches: [accepted(batch())], now }).rows[0]
  assert.equal(r.availability, "private_detail_not_published")
  assert.equal(r.gate_explanation, "The desired outcome needs its owner's decision")
  assert.equal(r.next_action, "Ask your linked agent to inspect the local annotation")
  for (const k of ["decision", "recommendation", "safe_continuation"]) assert.deepEqual(r[k], { state: "unavailable", reason: "detail_not_published" })
  assert.equal(r.ownership, "not_published")
  assert.deepEqual(r.handoff, {
    annotation_id: r.id, revision: r.revision, basis: r.basis, route: r.route, gate: r.gate,
    availability: r.availability, evidence: [], data_path: "rollups/improvements.json",
    authority_limit: "inspect_only_no_new_authority",
  })
  const c = fixture.cases.find((c) => c.name === "verified_public_issue_context_no_decision_fields")
  const withPublic = derive({ batches: [accepted(materialize(c))], publicEvidence: c.publicEvidence, now }).rows[0]
  assert.equal(withPublic.availability, "verified_public_context")
  assert.deepEqual(withPublic.context, [{ kind: "issue", ref: c.publicEvidence[0].ref, revision: 1, label: "Synthetic issue" }])
  for (const k of ["decision", "recommendation", "safe_continuation"]) assert.deepEqual(withPublic[k], r[k])
  for (const publicEvidence of [
    [{ ...c.publicEvidence[0], visibility: "unknown" }],
    [{ ...c.publicEvidence[0], revision: 2 }],
    [{ ...c.publicEvidence[0], decision: fixture.privacy_sentinels[4] }],
  ]) {
    const p = present({ row: materialize(c).rows[0], publicEvidence })
    assert.deepEqual(p.decision, r.decision)
    assert.doesNotMatch(JSON.stringify(p), /PRIVATE_SYNTHETIC_DECISION_PROSE/)
  }
})

const CHECK = new URL("../check-triage.sh", import.meta.url).pathname
function gitRepo(before = {}) {
  const dir = mkdtempSync(join(tmpdir(), "triage-git-"))
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  const write = (p, b) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b) }
  git("init", "-q"); git("config", "user.name", "OWNER"); git("config", "user.email", "owner@example.invalid")
  write("README.md", "base\n")
  for (const [p, b] of Object.entries(before)) write(p, b)
  git("add", "."); git("commit", "-qm", "base")
  const base = git("rev-parse", "HEAD")
  const commit = () => { git("add", "-A"); git("commit", "-qm", "head"); return git("rev-parse", "HEAD") }
  const run = (head, trusted = "true") => spawnSync("bash", [CHECK, base, head, trusted], { cwd: dir, encoding: "utf8" })
  return { dir, git, write, base, commit, run }
}

test("real Git checker: immutable modes, removals, renames, copies, exact merged tree, similar new corrections", () => {
  for (const kind of ["add", "executable", "modify", "remove", "rename", "symlink", "copy", "similar", "nested"]) {
    const old = bytes(batch())
    const existing = !["add", "executable", "symlink", "nested"].includes(kind)
    const r = gitRepo(existing ? { [PATH]: old } : {})
    const newPath = "triage/fedcba9876543210.json"
    if (kind === "remove") rmSync(join(r.dir, PATH))
    else if (kind === "rename") r.git("mv", PATH, newPath)
    else if (kind === "symlink") {
      mkdirSync(join(r.dir, "triage"), { recursive: true })
      symlinkSync("../README.md", join(r.dir, PATH))
    }
    else if (kind === "copy") r.write(newPath, old)
    else if (kind === "similar") r.write(newPath, bytes(batch([row({ revision: 8 })], { batch: "fedcba9876543210" })))
    else if (kind === "nested") r.write("triage/nested/a.json", old)
    else {
      r.write(PATH, kind === "modify" ? bytes(batch([row({ revision: 8 })])) : old)
      if (kind === "executable") chmodSync(join(r.dir, PATH), 0o755)
    }
    const out = r.run(r.commit())
    assert.equal(out.status, ["add", "executable", "similar"].includes(kind) ? 0 : 1, `${kind}: ${out.stdout} ${out.stderr}`)
    if (kind === "add") {
      assert.equal(r.run(r.git("rev-parse", "HEAD"), "false").stdout, "triage_untrusted_producer\n")
      assert.equal(r.run(r.git("rev-parse", "HEAD"), "unknown").stdout, "triage_authority_check_unavailable\n")
    }
    rmSync(r.dir, { recursive: true, force: true })
  }
})

test("real Git checker: existing-on-base path cannot be relabeled as added from merge-base", () => {
  const r = gitRepo()
  r.git("branch", "candidate")
  r.write(PATH, bytes(batch())); const base = r.commit()
  r.git("checkout", "-q", "candidate")
  r.write(PATH, bytes(batch([row({ revision: 8 })]))); const head = r.commit()
  const out = spawnSync("bash", [CHECK, base, head, "true"], { cwd: r.dir, encoding: "utf8" })
  assert.equal(out.status, 1)
  assert.match(out.stdout, /triage_check_unavailable|triage_immutable/)
  rmSync(r.dir, { recursive: true, force: true })
})

test("candidate JSON snapshot cannot manufacture producer authority through the released Desk adapter", async () => {
  if (!process.env.DESK_DIR) {
    assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1", "Desk source required")
    return
  }
  const r = gitRepo()
  r.write(PATH, bytes(batch()))
  const head = r.commit()
  const snapshot = join(r.dir, "triage-api.json")
  writeFileSync(snapshot, JSON.stringify({
    repository: "example/project", pr: { number: 1, head: { sha: head }, user: { login: "OWNER" } },
    permission: { permission: "write" },
  }), { mode: 0o600 })
  try {
    const output = spawnSync(process.execPath, [
      new URL("../triage-values.mjs", import.meta.url).pathname, "--validate-pr", process.env.DESK_DIR, snapshot,
      "--base", r.base, "--head", head, "--author-association", "OWNER", "--repo", "example/project", "--pr", "1",
    ], { cwd: r.dir, encoding: "utf8", env: { ...process.env, RUNNER_TEMP: join(r.dir, "trusted-temp") } })
    const answer = JSON.parse(output.stdout)
    assert.equal(answer.ok, false)
    assert.ok(answer.errors.some((e) => e.code === "triage_authority_check_unavailable"))
  } finally { rmSync(r.dir, { recursive: true, force: true }) }
})

test("projection validator and publisher refuse plausible private detail and inconsistent handoff twins", async () => {
  const { publishData } = await import("../../../site/scripts/publish-files.mjs")
  const dir = mkdtempSync(join(tmpdir(), "triage-twin-"))
  const dist = join(dir, "dist"); mkdirSync(dist)
  const q = derive({ batches: [accepted(batch())], now })
  q.rows[0].handoff.authority_limit = "implement"
  writeFileSync(join(dist, "data.json"), JSON.stringify({ improvements: q }))
  assert.throws(() => publishData({ reports: join(dir, "reports"), dist }), /triage_projection_invalid/)
  rmSync(dir, { recursive: true, force: true })
})

test("reducer incomplete coverage cannot leave an agent-ready row apparently current", () => {
  const q = derive({ batches: [accepted(batch([row({ route: "agent_ready", gate: null })], {
    coverage: { ...fixture.public.coverage, scan: "unreadable" },
  }))], now })
  assert.equal(q.rows[0].state, "source_unknown")
  assert.equal(q.rows[0].availability, "stale_or_conflicting")
})

test("reducer explicit empty refusals and null inputs never mean a healthy reviewed queue", () => {
  assert.equal(derive(null).state, "unknown")
  assert.equal(derive({ batches: null, now }).state, "unknown")
  for (const coverage of [
    { ...fixture.public.coverage, reviewed: 0, refused: 1 },
    { ...fixture.public.coverage, reviewed: 0, deferred: 1 },
    { ...fixture.public.coverage, reviewed: 0, unreviewed: 1, more_unreviewed: true },
  ]) assert.equal(derive({ batches: [accepted(batch([], { coverage }))], now }).state, "unknown")
})

test("public context rejects contradictory visibility and duplicate context identities", () => {
  const c = fixture.cases.find((c) => c.name === "verified_public_issue_context_no_decision_fields")
  const r = materialize(c).rows[0]
  const contradicted = present({ row: r, publicEvidence: [c.publicEvidence[0], { ...c.publicEvidence[0], visibility: "private" }] })
  assert.equal(contradicted.availability, "private_detail_not_published")
  const double = present({ row: { ...r, evidence: [...r.evidence, ...r.evidence] }, publicEvidence: c.publicEvidence })
  assert.equal(double.context.length, 1)
})

test("reader refuses missing committed file, symlink, dirty bytes, filename mismatch and malformed main", () => {
  for (const kind of ["missing", "symlink", "dirty", "batch", "malformed"]) {
    const r = gitRepo({ [PATH]: bytes(batch()) })
    if (kind === "missing") rmSync(join(r.dir, PATH))
    else if (kind === "symlink") { rmSync(join(r.dir, PATH)); symlinkSync("../README.md", join(r.dir, PATH)) }
    else if (kind === "dirty") r.write(PATH, bytes(batch([row({ revision: 9 })])))
    else {
      r.write(PATH, kind === "batch" ? bytes(batch([], { batch: "f".repeat(16) })) : "{}\n")
      r.commit()
    }
    assert.throws(() => values.readTriageBatches(r.dir), /triage_/)
    rmSync(r.dir, { recursive: true, force: true })
  }
})

test("triage size and pointer/privacy boundary corpus stays paired with released validator", async () => {
  const d = process.env.DESK_DIR ? await import(pathToFileURL(join(process.env.DESK_DIR, "plugins/desk/mcp/src/factory/triage-schema.js"))) : null
  const cases = [
    batch([row({ private_text: "x".repeat(16385) })]),
    batch([row({ evidence: Array(17).fill({ kind: "issue", ref: "https://github.com/example/project/issues/1", revision: 1 }) })]),
    batch([row({ evidence: [{ kind: "job", ref: "file:///private", revision: 1 }] })]),
    batch([row({ gate: "execute" })]),
    batch([row({ rubric_version: 0 })]),
    batch([row({ producer_version: "1.4.0-ghpSECRET0123456789abcdefghijklmnop" })]),
    batch([row({ evidence: [{ kind: "issue", ref: "https://github.com/private2026secretpayload/project/issues/1", revision: 1 }] })]),
  ]
  for (const value of cases) {
    const b = bytes(value)
    assert.equal(validate(b).ok, false)
    if (d) assert.deepEqual(validate(b).codes, [...new Set(d.validateTriageBytes(b).errors.map((e) => e.code))].sort())
  }
})

test("unknown coarse review age cannot yield a healthy current queue just because publication is fresh", () => {
  for (const age of ["unknown", "never", "stale"]) {
    const q = derive({ batches: [accepted(batch([row({ age })]))], now })
    assert.notEqual(q.state, "reviewed")
    assert.equal(q.rows[0].availability, "stale_or_conflicting")
    assert.ok(queue.validateImprovementQueue(q).ok)
  }
})

test("queue conflict reduction is deterministic across permutations and never mutates accepted inputs", () => {
  const a = accepted(batch([row({ revision: 7 })]))
  const b = accepted(batch([row({ revision: 7, route: "investigate", gate: null })]))
  const c = accepted(batch([row({ revision: 6 })]))
  const inputs = [a, b, c], before = structuredClone(inputs)
  const expected = derive({ batches: [a, b, c], now })
  for (const permutation of [[c, b, a], [b, a, c], [a, c, b]]) assert.deepEqual(derive({ batches: permutation, now }), expected)
  assert.deepEqual(inputs, before)
  assert.equal(expected.rows[0].conflict, true)
})

test("a verified empty Git store has no triage yet, but missing Git history is unavailable not healthy absence", () => {
  const dir = mkdtempSync(join(tmpdir(), "triage-empty-store-"))
  execFileSync("git", ["init", "-q", dir])
  assert.deepEqual(values.readTriageBatches(dir), [])
  assert.equal(derive({ batches: values.readTriageBatches(dir), now }).state, "not_reviewed")
  rmSync(join(dir, ".git"), { recursive: true, force: true })
  assert.throws(() => values.readTriageBatches(dir), /triage_read_unavailable/)
  rmSync(dir, { recursive: true, force: true })
})

test("direct public presentation refuses unsafe identity/basis instead of leaking them into inspect-only handoff", () => {
  for (const bad of [
    row({ id: fixture.privacy_sentinels[0] }), null,
    row({ basis: { ...fixture.public.rows[0].basis, protected_path: fixture.privacy_sentinels[1] } }),
    row({ route: "execute" }),
  ]) assert.throws(() => present({ row: bad }), /triage_projection_invalid/)
})

test("a reports-only improvement queue cannot publish without the matching checked data twin", async () => {
  const { publishData } = await import("../../../site/scripts/publish-files.mjs")
  const dir = mkdtempSync(join(tmpdir(), "triage-orphan-twin-"))
  const reports = join(dir, "reports"), dist = join(dir, "dist")
  mkdirSync(join(reports, "rollups"), { recursive: true })
  writeFileSync(join(reports, "rollups/improvements.json"), JSON.stringify(derive({ batches: [], now })))
  assert.throws(() => publishData({ reports, dist }), /triage_projection_invalid/)
  rmSync(dir, { recursive: true, force: true })
})
