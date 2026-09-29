import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { test } from "node:test"

import { applyCorrection, correctionChanges, validateCorrectionRecord } from "../lib/corrections.mjs"
import { applyCorrectionsToStore, CorrectionsInvalidError } from "../apply-corrections.mjs"
import { checkCorrections } from "../check-corrections.mjs"

const SESSION = "12d19fc5-1e3c-4d19-ad4c-c03b1b94aeb3"
const FILE_NAME = `claude-code-${SESSION}.json`

function validRecord(overrides = {}) {
  return {
    schema: "factory.correction/1",
    file: FILE_NAME,
    fields: { jobs: [{ job: "2927a4630f97b7869a71f387a4a757f1", basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: null }] },
    reason: "Re-derived with the housekeeping exclusion; an old client keeps republishing the pre-exclusion bindings.",
    date: "2026-09-29",
    pr: 101,
    ...overrides,
  }
}

// --- validateCorrectionRecord ------------------------------------------------

test("validateCorrectionRecord accepts a well-formed record", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord(), FILE_NAME)
  assert.equal(ok, true)
  assert.deepEqual(errors, [])
})

test("validateCorrectionRecord rejects a non-object", () => {
  for (const bad of [null, [], "x", 1, undefined]) {
    const { ok, errors } = validateCorrectionRecord(bad, FILE_NAME)
    assert.equal(ok, false)
    assert.ok(errors.some((e) => e.code === "correction_type"))
  }
})

test("validateCorrectionRecord rejects an unrecognized schema string", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ schema: "factory.correction/2" }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_schema_mismatch"))
})

test("validateCorrectionRecord rejects a missing required key", () => {
  const record = validRecord()
  delete record.reason
  const { ok, errors } = validateCorrectionRecord(record, FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_missing_key" && e.path === "reason"))
})

test("validateCorrectionRecord rejects an unknown key", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ extra: true }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_unknown_key" && e.path === "extra"))
})

test("validateCorrectionRecord rejects a file name that does not look like a facts file", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ file: "not-a-facts-file.json" }), "not-a-facts-file.json")
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_file_invalid"))
})

test("validateCorrectionRecord rejects a file that disagrees with the record's own file name", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord(), "claude-code-00000000-0000-4000-8000-000000000000.json")
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_file_mismatch"))
})

test("validateCorrectionRecord rejects an empty fields object", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: {} }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_fields_invalid"))
})

test("validateCorrectionRecord rejects a field name that is not a correctable top-level field", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { schema: "x" } }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_field_unknown" && e.path === "fields.schema"))
})

test("validateCorrectionRecord rejects an empty reason", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ reason: "   " }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_reason_invalid"))
})

test("validateCorrectionRecord rejects a date that is not a real calendar date", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ date: "2026-02-30" }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_date_invalid"))
})

test("validateCorrectionRecord rejects a non-positive-integer pr", () => {
  for (const bad of [0, -1, 1.5, "101"]) {
    const { ok, errors } = validateCorrectionRecord(validRecord({ pr: bad }), FILE_NAME)
    assert.equal(ok, false)
    assert.ok(errors.some((e) => e.code === "correction_pr_invalid"))
  }
})

// --- applyCorrection / correctionChanges ------------------------------------

test("applyCorrection overlays only the named fields", () => {
  const current = { schema: "desk.factory.published/1", session: { duration_ms: 100 }, jobs: [1, 2, 3], plugins: ["a"] }
  const record = { fields: { jobs: [4, 5] } }
  const corrected = applyCorrection(current, record)
  assert.deepEqual(corrected.jobs, [4, 5])
  assert.deepEqual(corrected.session, { duration_ms: 100 })
  assert.deepEqual(corrected.plugins, ["a"])
})

test("correctionChanges is false once the fields already match", () => {
  const current = { jobs: [1, 2] }
  assert.equal(correctionChanges(current, { fields: { jobs: [1, 2] } }), false)
  assert.equal(correctionChanges(current, { fields: { jobs: [1, 3] } }), true)
})

// --- applyCorrectionsToStore -------------------------------------------------

function memoryStore(files) {
  const store = new Map(Object.entries(files))
  const writes = []
  return {
    readDir: (dir) => [...store.keys()].filter((f) => path.dirname(f) === dir).map((f) => path.basename(f)),
    readText: (file) => {
      if (!store.has(file)) throw new Error(`ENOENT: ${file}`)
      return store.get(file)
    },
    writeText: (file, text) => {
      store.set(file, text)
      writes.push(file)
    },
    exists: (file) => store.has(file) || [...store.keys()].some((f) => f.startsWith(`${file}/`)),
    writes,
    store,
  }
}

test("a republish with polluted bindings keeps the corrected ones while other fields still update", () => {
  const storeDir = "/store"
  const correctionPath = `${storeDir}/corrections/${FILE_NAME}`
  const factsPath = `${storeDir}/facts/${FILE_NAME}`
  const republished = {
    schema: "desk.factory.published/1",
    session: { host: "claude-code", id: SESSION, duration_ms: 31887607 },
    jobs: Array.from({ length: 22 }, (_, i) => ({ job: `polluted-${i}`, basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: null })),
    plugins: [{ name: "desk", version: "3.2.0-alpha.130" }],
  }
  const correctedJobs = [
    { job: "2927a4630f97b7869a71f387a4a757f1", basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: null },
    { job: "4d2ddeafaa4aa2fbaca01d6f4996b5d2", basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: { status: "done", offset_ms: null } },
  ]
  const store = memoryStore({
    [correctionPath]: JSON.stringify(validRecord({ fields: { jobs: correctedJobs } })),
    [factsPath]: JSON.stringify(republished),
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.deepEqual(result.applied, [FILE_NAME])
  const written = JSON.parse(store.store.get(factsPath))
  assert.deepEqual(written.jobs, correctedJobs)
  assert.equal(written.session.duration_ms, 31887607, "the republish's own updated duration still lands")
  assert.deepEqual(written.plugins, republished.plugins, "an untouched field still comes from the republish")
})

test("a facts file with no correction record is left alone", () => {
  const storeDir = "/store"
  const otherFile = "claude-code-00000000-0000-4000-8000-000000000000.json"
  const original = JSON.stringify({ schema: "desk.factory.published/1", jobs: [] })
  const store = memoryStore({
    [`${storeDir}/facts/${otherFile}`]: original,
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.equal(result.checked, 0)
  assert.deepEqual(result.applied, [])
  assert.equal(store.store.get(`${storeDir}/facts/${otherFile}`), original)
  assert.deepEqual(store.writes, [])
})

test("a correction for a facts file that is not present is reported as missing, not applied", () => {
  const storeDir = "/store"
  const store = memoryStore({
    [`${storeDir}/corrections/${FILE_NAME}`]: JSON.stringify(validRecord()),
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.deepEqual(result.missing, [FILE_NAME])
  assert.deepEqual(result.applied, [])
})

test("a malformed correction record fails loudly and applies nothing", () => {
  const storeDir = "/store"
  const goodFile = FILE_NAME
  const badFile = "claude-code-00000000-0000-4000-8000-000000000000.json"
  const store = memoryStore({
    [`${storeDir}/corrections/${goodFile}`]: JSON.stringify(validRecord()),
    [`${storeDir}/corrections/${badFile}`]: JSON.stringify({ schema: "factory.correction/1" }), // missing required keys
    [`${storeDir}/facts/${goodFile}`]: JSON.stringify({ schema: "desk.factory.published/1", jobs: [1, 2, 3] }),
  })

  assert.throws(() => applyCorrectionsToStore({ storeDir, ...store }), CorrectionsInvalidError)
  assert.deepEqual(store.writes, [], "nothing is written once any record fails validation")
})

test("invalid JSON in a correction record fails loudly", () => {
  const storeDir = "/store"
  const store = memoryStore({
    [`${storeDir}/corrections/${FILE_NAME}`]: "{ not json",
  })
  assert.throws(() => applyCorrectionsToStore({ storeDir, ...store }), CorrectionsInvalidError)
})

// --- checkCorrections (git-backed) -------------------------------------------

function sh(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" })
}

function initRepo(dir) {
  sh(dir, ["init", "--quiet", "--initial-branch=main"])
  sh(dir, ["config", "user.email", "test@example.com"])
  sh(dir, ["config", "user.name", "Test"])
  mkdirSync(path.join(dir, "facts"), { recursive: true })
  writeFileSync(path.join(dir, "facts", ".gitkeep"), "")
}

function commitAll(dir, message) {
  sh(dir, ["add", "-A"])
  sh(dir, ["commit", "--quiet", "-m", message])
  return sh(dir, ["rev-parse", "HEAD"]).trim()
}

function checkCorrectionsIn(dir, { base, head }) {
  return checkCorrections({ base, head, runGit: (args) => sh(dir, args) })
}

test("checkCorrections passes a valid added correction record", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "corrections-"))
  try {
    initRepo(dir)
    const base = commitAll(dir, "base")
    mkdirSync(path.join(dir, "corrections"), { recursive: true })
    writeFileSync(path.join(dir, "corrections", FILE_NAME), JSON.stringify(validRecord()))
    const head = commitAll(dir, "add correction")

    const { ok, codes } = checkCorrectionsIn(dir, { base, head })
    assert.equal(ok, true)
    assert.deepEqual(codes, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("checkCorrections fails loudly on a malformed added correction record", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "corrections-"))
  try {
    initRepo(dir)
    const base = commitAll(dir, "base")
    mkdirSync(path.join(dir, "corrections"), { recursive: true })
    writeFileSync(path.join(dir, "corrections", FILE_NAME), JSON.stringify({ schema: "factory.correction/1" }))
    const head = commitAll(dir, "add malformed correction")

    const { ok, codes } = checkCorrectionsIn(dir, { base, head })
    assert.equal(ok, false)
    assert.ok(codes.length > 0)
    assert.ok(codes.every((c) => /^correction_/.test(c)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("checkCorrections ignores a pull request that never touches corrections/", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "corrections-"))
  try {
    initRepo(dir)
    writeFileSync(path.join(dir, "facts", FILE_NAME), "{}")
    const base = commitAll(dir, "base")
    writeFileSync(path.join(dir, "facts", FILE_NAME), '{"changed":true}')
    const head = commitAll(dir, "republish")

    const { ok, codes } = checkCorrectionsIn(dir, { base, head })
    assert.equal(ok, true)
    assert.deepEqual(codes, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
