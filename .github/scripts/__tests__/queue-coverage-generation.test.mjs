// The queue reads one source's coverage from the newest batch of its
// generation, and reads a row as fresh from its newest identical publication.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { deriveImprovementQueue as derive, validateImprovementQueue } from "../../../site/scripts/improvement-queue.mjs"
import { validateTriageChangeValues } from "../triage-values.mjs"

const fixture = JSON.parse(readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url)))
const clone = (v) => structuredClone(v)
const bytes = (v) => JSON.stringify(v) + "\n"
const HOUR = 3600000
const now = Date.parse("2026-10-10T12:00:00Z")
const GEN = fixture.public.coverage.generation
const OTHER = "f".repeat(32)
const row = (over = {}) => ({ ...clone(fixture.public.rows[0]), ...over })
const second = (over = {}) => row({ id: "1".repeat(32), route: "investigate", gate: null, ...over })
let serial = 0
// Each batch is its own file, as Desk writes it: a new batch id every time.
const batch = (rows, coverage = {}, hoursAgo = 0) => {
  const value = { ...clone(fixture.public), batch: (++serial).toString(16).padStart(16, "0"), rows, coverage: { ...fixture.public.coverage, ...coverage } }
  return { path: `triage/${value.batch}.json`, bytes: bytes(value), committedAtMs: hoursAgo === null ? null : now - hoursAgo * HOUR }
}
const orders = (list) => list.length < 2 ? [list] : list.flatMap((x, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]))
// Every order of the batches gives the same queue, and the queue is valid.
const queue = (...batches) => {
  const all = orders(batches).map((o) => derive({ batches: o, now }))
  for (const q of all) assert.deepEqual(q, all[0])
  assert.deepEqual(validateImprovementQueue(all[0]), { ok: true, codes: [] })
  return all[0]
}
const states = (q) => Object.fromEntries(q.rows.map((r) => [r.id.slice(0, 1), r.state]))

test("one machine with changing counts reads known", () => {
  // Monday: one card reviewed. Tuesday: a second card, so the counts change.
  const q = queue(
    batch([row()], { reviewed: 1, unreviewed: 1 }, 26),
    batch([second()], { reviewed: 2, unreviewed: 0 }, 2),
  )
  assert.equal(q.state, "reviewed")
  assert.deepEqual(q.reasons, [])
  assert.deepEqual(q.coverage, { state: "known", generation: GEN, scan: "complete", reviewed: 2, unreviewed: 0, refused: 0, deferred: 0, more_unreviewed: false })
  assert.deepEqual(states(q), { a: "reviewed", 1: "reviewed" })
  // The newest batch speaks for the generation, even when it reports less.
  assert.equal(queue(batch([row()], { reviewed: 5 }, 30), batch([], { reviewed: 3 }, 1)).coverage.reviewed, 3)
  // A batch of the same generation that is no longer fresh is not read.
  assert.equal(queue(batch([row({ revision: 1 })], { reviewed: 9 }, 80), batch([row({ revision: 2 })], { reviewed: 1 }, 1)).coverage.reviewed, 1)
})

test("two fresh generations read unknown", () => {
  const q = queue(batch([row()], {}, 26), batch([second()], { generation: OTHER }, 2))
  assert.equal(q.state, "unknown")
  assert.deepEqual(q.reasons, ["triage_coverage_unknown"])
  assert.deepEqual(q.coverage, { state: "unknown", generation: null, scan: null, reviewed: null, unreviewed: null, refused: null, deferred: null, more_unreviewed: null })
  assert.deepEqual(states(q), { a: "source_unknown", 1: "source_unknown" })
  // Identical counts under two generations are still two sources.
  assert.equal(queue(batch([row()]), batch([], { generation: OTHER })).coverage.state, "unknown")
  // Once the other generation is older than 72 hours, one source remains.
  const settled = queue(batch([row()], {}, 2), batch([], { generation: OTHER }, 73))
  assert.equal(settled.coverage.state, "known")
  assert.equal(settled.state, "reviewed")
  // Two batches of one generation committed at the same time cannot be
  // ordered: they speak for it only when they say the same.
  assert.equal(queue(batch([row()], { reviewed: 1 }, 2), batch([second()], { reviewed: 2 }, 2)).coverage.state, "unknown")
  assert.equal(queue(batch([row()], { reviewed: 2 }, 2), batch([second()], { reviewed: 2 }, 2)).coverage.state, "known")
  assert.equal(queue(batch([row()], { reviewed: 1 }, 2), batch([second()], { reviewed: 2 }, 2), batch([], { reviewed: 2 }, 1)).coverage.state, "known")
})

test("a re-attested row is fresh past 72 hours from its first commit", () => {
  // First published four days ago; the same row bytes again 90 minutes ago.
  const q = queue(batch([row()], {}, 96), batch([row()], {}, 48), batch([row()], {}, 1.5))
  assert.equal(q.state, "reviewed")
  assert.deepEqual(q.reasons, [])
  assert.equal(q.rows[0].state, "reviewed")
  assert.equal(q.rows[0].conflict, false)
  assert.equal(q.rows[0].availability, "private_detail_not_published")
  assert.equal(q.coverage.state, "known")
  // The contract's case: published, then attested again at 48 and 96 hours,
  // read at 100 hours. An attestation with no rows refreshes coverage only.
  const quiet = queue(batch([row()], {}, 100), batch([row()], {}, 52), batch([row()], {}, 4))
  assert.equal(quiet.state, "reviewed")
  assert.equal(quiet.coverage.state, "known")
  const empty = queue(batch([row()], {}, 100), batch([], {}, 4))
  assert.equal(empty.coverage.state, "known")
  assert.equal(empty.rows[0].state, "stale")
  // A publication whose time is unknown or in the future refreshes nothing
  // and hides nothing.
  for (const bad of [null, -1]) {
    assert.equal(queue(batch([row()], {}, 96), batch([row()], {}, bad)).rows[0].state, "stale", String(bad))
    assert.equal(queue(batch([row()], {}, 2), batch([row()], {}, bad)).rows[0].availability, "private_detail_not_published", String(bad))
  }
  // A fresh attestation of an older revision does not refresh the newer one.
  const older = queue(batch([row({ revision: 2 })], {}, 96), batch([row({ revision: 1 })], {}, 1))
  assert.equal(older.rows[0].revision, 2)
  assert.equal(older.rows[0].state, "stale")
  // The same id and revision with different content is a conflict, and a
  // conflict is not made fresh by being repeated.
  const conflict = queue(batch([row()], {}, 96), batch([row({ route: "investigate", gate: null })], {}, 1))
  assert.equal(conflict.state, "conflicting")
  assert.equal(conflict.rows[0].conflict, true)
  assert.ok(conflict.reasons.includes("triage_publication_stale"))
  // A withdrawal still wins over any later attestation of the row it withdrew.
  const withdrawn = queue(batch([row()], {}, 96), batch([row({ revision: 2, state: "withdrawn", route: null, gate: null })], {}, 50), batch([row()], {}, 1))
  assert.equal(withdrawn.rows[0].state, "withdrawn")
})

test("a row not re-attested goes stale", () => {
  // Two rows four days ago; only the first is attested again.
  const q = queue(batch([row(), second()], { reviewed: 2 }, 96), batch([row()], { reviewed: 2 }, 1))
  assert.deepEqual(states(q), { a: "reviewed", 1: "stale" })
  assert.equal(q.state, "stale")
  assert.deepEqual(q.reasons, ["triage_publication_stale"])
  assert.equal(q.coverage.state, "known")
  // With no attestation at all, a quiet queue reads unknown: its coverage has
  // expired with its rows.
  const quiet = queue(batch([row()], {}, 73))
  assert.equal(quiet.state, "unknown")
  assert.equal(quiet.rows[0].state, "stale")
  assert.deepEqual(quiet.reasons, ["triage_coverage_unknown", "triage_publication_stale"])
  // Exactly 72 hours is still fresh.
  assert.equal(queue(batch([row()], {}, 72)).state, "reviewed")
})

test("null counts read unknown", () => {
  for (const k of ["reviewed", "unreviewed", "refused", "deferred", "more_unreviewed"]) {
    const q = queue(batch([row()], { [k]: null }, 1))
    assert.equal(q.coverage.state, "unknown", k)
    assert.equal(q.state, "unknown", k)
    assert.equal(q.rows[0].state, "source_unknown", k)
  }
  // The newest batch decides: null counts after known ones read unknown, and
  // known counts after null ones read known.
  assert.equal(queue(batch([row()], {}, 20), batch([], { refused: null, deferred: null }, 1)).coverage.state, "unknown")
  assert.equal(queue(batch([row()], { refused: null, deferred: null }, 20), batch([], {}, 1)).coverage.state, "known")
  // A scan that did not complete reads unknown as before.
  assert.equal(queue(batch([row()], {}, 20), batch([], { scan: "truncated" }, 1)).coverage.state, "unknown")
  // An invalid batch still makes coverage unknown.
  const invalid = derive({ batches: [batch([row()], {}, 1), { path: "triage/0000000000000000.json", bytes: "bad", committedAtMs: now }], now })
  assert.equal(invalid.coverage.state, "unknown")
  assert.ok(invalid.reasons.includes("triage_invalid"))
})

test("a new batch file may repeat rows an earlier file already holds", () => {
  const first = batch([row()], {}, 96), again = batch([row()], { reviewed: 1 }, 1)
  assert.equal(JSON.stringify(JSON.parse(first.bytes).rows), JSON.stringify(JSON.parse(again.bytes).rows))
  assert.deepEqual(validateTriageChangeValues({ path: again.path, status: "added", bytes: again.bytes, trustedMaintainer: true }), { ok: true, codes: [] })
  // The real Git checker, on a store that already holds the first file.
  const dir = mkdtempSync(join(tmpdir(), "triage-reattest-"))
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
    const write = (p, b) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b) }
    git("init", "-q"); git("config", "user.name", "OWNER"); git("config", "user.email", "owner@example.invalid")
    write(first.path, first.bytes); git("add", "."); git("commit", "-qm", "base")
    const base = git("rev-parse", "HEAD")
    write(again.path, again.bytes); git("add", "."); git("commit", "-qm", "head")
    const out = spawnSync("bash", [new URL("../check-triage.sh", import.meta.url).pathname, base, git("rev-parse", "HEAD"), "true"], { cwd: dir, encoding: "utf8" })
    assert.equal(out.status, 0, `${out.stdout} ${out.stderr}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
