import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { test } from "node:test"

import {
  PUBLISHED_UNAVAILABLE_FIELDS,
  UNAVAILABLE_LIMIT,
  UNAVAILABLE_REASONS,
  applyCorrection,
  checkCorrectionAgainstFacts,
  correctionChanges,
  validateCorrectionRecord,
} from "../lib/corrections.mjs"
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

test("validateCorrectionRecord rejects a jobs value of the wrong type outright", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { jobs: "oops" } }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_field_type" && e.path === "fields.jobs"))
})

test("validateCorrectionRecord rejects a jobs entry missing a required key", () => {
  const badJob = { job: "2927a4630f97b7869a71f387a4a757f1", basis: ["desk_commit"], session_offset_ms: null, transitions: [] } // no `observed`
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { jobs: [badJob] } }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_field_missing" && e.path === "fields.jobs.0.observed"))
})

test("validateCorrectionRecord rejects a jobs entry with an out-of-enum status", () => {
  const badJob = {
    job: "2927a4630f97b7869a71f387a4a757f1",
    basis: ["desk_commit"],
    session_offset_ms: null,
    transitions: [],
    observed: { status: "not-a-real-status", offset_ms: null },
  }
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { jobs: [badJob] } }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_field_enum" && e.path === "fields.jobs.0.observed.status"))
})

test("validateCorrectionRecord rejects a jobs entry whose basis repeats an entry", () => {
  const badJob = { job: "2927a4630f97b7869a71f387a4a757f1", basis: ["desk_commit", "desk_commit"], session_offset_ms: null, transitions: [], observed: null }
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { jobs: [badJob] } }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_field_duplicate" && e.path === "fields.jobs.0.basis"))
})

// --- applyCorrection / correctionChanges ------------------------------------

const jobEntry = (job, extra = {}) => ({ job, basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: null, ...extra })
const JOB_A = "2927a4630f97b7869a71f387a4a757f1"
const JOB_B = "4d2ddeafaa4aa2fbaca01d6f4996b5d2"
const JOB_C = "5819103ed254066a2ae78270584041f0"

test("applyCorrection overlays the named fields and leaves the rest", () => {
  const current = { schema: "desk.factory.published/1", session: { duration_ms: 100 }, jobs: [], plugins: ["a"] }
  const record = { fields: { plugins: ["b"] } }
  const corrected = applyCorrection(current, record)
  assert.deepEqual(corrected.plugins, ["b"])
  assert.deepEqual(corrected.session, { duration_ms: 100 })
  assert.deepEqual(corrected.jobs, [])
})

test("a jobs correction is a ceiling: it cuts an over-bound republish back to the jobs it lists", () => {
  const current = { jobs: [jobEntry(JOB_A), jobEntry(JOB_B), jobEntry(JOB_C)] }
  const corrected = applyCorrection(current, { fields: { jobs: [jobEntry(JOB_A), jobEntry(JOB_B)] } })
  assert.deepEqual(corrected.jobs.map((entry) => entry.job), [JOB_A, JOB_B])
})

test("a jobs correction never adds credit a later derivation no longer finds", () => {
  // Session 1cd05863: the record pins 11 jobs; the re-derivation under binding version 5 holds none.
  assert.deepEqual(applyCorrection({ jobs: [] }, { fields: { jobs: [jobEntry(JOB_A), jobEntry(JOB_B)] } }).jobs, [])
  // A re-derivation that keeps fewer jobs shows exactly those, as it derived them (newer keys included).
  const derived = jobEntry(JOB_B, { session_offset_ms: 5, agents: [0], segments: [{ start_ms: 0, end_ms: 10 }] })
  assert.deepEqual(applyCorrection({ jobs: [derived] }, { fields: { jobs: [jobEntry(JOB_A), jobEntry(JOB_B)] } }).jobs, [derived])
})

test("a jobs correction keeps nothing from facts whose jobs are missing or malformed", () => {
  const record = { fields: { jobs: [jobEntry(JOB_A)] } }
  assert.deepEqual(applyCorrection({}, record).jobs, [])
  assert.deepEqual(applyCorrection({ jobs: [1, null, { job: 7 }] }, record).jobs, [])
})

test("correctionChanges is false once the facts are within the correction", () => {
  assert.equal(correctionChanges({ plugins: ["a"] }, { fields: { plugins: ["a"] } }), false)
  assert.equal(correctionChanges({ plugins: ["a"] }, { fields: { plugins: ["b"] } }), true)
  const record = { fields: { jobs: [jobEntry(JOB_A), jobEntry(JOB_B)] } }
  assert.equal(correctionChanges({ jobs: [jobEntry(JOB_A)] }, record), false, "a derivation already within the ceiling is left alone")
  assert.equal(correctionChanges({ jobs: [] }, record), false)
  assert.equal(correctionChanges({ jobs: [jobEntry(JOB_A), jobEntry(JOB_C)] }, record), true)
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
  const correctedJobs = [
    jobEntry(JOB_A),
    jobEntry(JOB_B, { observed: { status: "done", offset_ms: null } }),
  ]
  const polluted = Array.from({ length: 20 }, (_, i) => jobEntry(`${String(i).padStart(2, "0")}${"e".repeat(30)}`))
  const republished = {
    schema: "desk.factory.published/1",
    session: { host: "claude-code", id: SESSION, duration_ms: 31887607 },
    jobs: [...correctedJobs, ...polluted],
    plugins: [{ name: "desk", version: "3.2.0-alpha.130" }],
  }
  const store = memoryStore({
    [correctionPath]: JSON.stringify(validRecord({ fields: { jobs: correctedJobs } })),
    [factsPath]: JSON.stringify(republished),
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.deepEqual(result.applied, [FILE_NAME])
  assert.deepEqual(result.withheld, { [FILE_NAME]: 20 }, "the build summary counts the credit the ceiling withheld")
  const written = JSON.parse(store.store.get(factsPath))
  assert.deepEqual(written.jobs, correctedJobs)
  assert.equal(written.session.duration_ms, 31887607, "the republish's own updated duration still lands")
  assert.deepEqual(written.plugins, republished.plugins, "an untouched field still comes from the republish")
})

test("a re-derivation that credits no job leaves the stale correction nothing to do", () => {
  const storeDir = "/store"
  const factsPath = `${storeDir}/facts/${FILE_NAME}`
  const rederived = JSON.stringify({ schema: "desk.factory.published/1", session: { host: "claude-code", id: SESSION, duration_ms: 70446 }, jobs: [] })
  const store = memoryStore({
    [`${storeDir}/corrections/${FILE_NAME}`]: JSON.stringify(validRecord({ fields: { jobs: [jobEntry(JOB_A), jobEntry(JOB_B), jobEntry(JOB_C)] } })),
    [factsPath]: rederived,
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.deepEqual(result, { checked: 1, applied: [], unchanged: [FILE_NAME], moot: [], withheld: {} })
  assert.equal(store.store.get(factsPath), rederived)
  assert.deepEqual(store.writes, [])
})

test("a correction that changes no jobs withholds nothing, even when it rewrites another field", () => {
  const storeDir = "/store"
  const factsPath = `${storeDir}/facts/${FILE_NAME}`
  const store = memoryStore({
    [`${storeDir}/corrections/${FILE_NAME}`]: JSON.stringify(validRecord({ fields: { plugins: [] } })),
    [factsPath]: JSON.stringify({ schema: "desk.factory.published/1", plugins: [{ name: "desk", version: "3.2.0" }] }),
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.deepEqual(result.applied, [FILE_NAME])
  assert.deepEqual(result.withheld, {})
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

test("a correction whose target facts file is gone is moot: reported, not an error, and nothing is written", () => {
  const storeDir = "/store"
  const store = memoryStore({
    [`${storeDir}/corrections/${FILE_NAME}`]: JSON.stringify(validRecord()),
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.deepEqual(result, { checked: 1, applied: [], unchanged: [], moot: [FILE_NAME], withheld: {} })
  assert.deepEqual(store.writes, [])
})

test("a moot record does not stop the others: every other record still applies, and moot is sorted", () => {
  const storeDir = "/store"
  const otherFile = "claude-code-00000000-0000-4000-8000-000000000000.json"
  const lateFile = "claude-code-ffffffff-0000-4000-8000-000000000000.json"
  const store = memoryStore({
    [`${storeDir}/corrections/${lateFile}`]: JSON.stringify(validRecord({ file: lateFile })),
    [`${storeDir}/corrections/${FILE_NAME}`]: JSON.stringify(validRecord()),
    [`${storeDir}/corrections/${otherFile}`]: JSON.stringify(validRecord({ file: otherFile })),
    [`${storeDir}/facts/${otherFile}`]: JSON.stringify({ schema: "desk.factory.published/1", jobs: [1, 2, 3] }),
  })

  const result = applyCorrectionsToStore({ storeDir, ...store })

  assert.equal(result.checked, 3)
  assert.deepEqual(result.applied, [otherFile])
  assert.deepEqual(result.moot, [FILE_NAME, lateFile].sort())
  assert.equal(store.writes.length, 1)
})

test("a record that is moot while its facts file is gone applies again when the file returns", () => {
  const storeDir = "/store"
  const factsPath = `${storeDir}/facts/${FILE_NAME}`
  const store = memoryStore({
    [`${storeDir}/corrections/${FILE_NAME}`]: JSON.stringify(validRecord()),
  })

  const gone = applyCorrectionsToStore({ storeDir, ...store })
  assert.deepEqual(gone.moot, [FILE_NAME])

  store.store.set(factsPath, JSON.stringify({ schema: "desk.factory.published/1", jobs: [1, 2, 3] }))
  const back = applyCorrectionsToStore({ storeDir, ...store })

  assert.deepEqual(back.moot, [])
  assert.deepEqual(back.applied, [FILE_NAME])
  assert.equal(store.writes.length, 1)
})

test("an invalid record alongside a moot one still stops the run and writes nothing", () => {
  const storeDir = "/store"
  const badFile = "claude-code-00000000-0000-4000-8000-000000000000.json"
  const store = memoryStore({
    [`${storeDir}/corrections/${FILE_NAME}`]: JSON.stringify(validRecord()),
    [`${storeDir}/corrections/${badFile}`]: "{not json",
  })

  assert.throws(() => applyCorrectionsToStore({ storeDir, ...store }), CorrectionsInvalidError)
  assert.deepEqual(store.writes, [])
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

test("checkCorrections rejects a correction record whose jobs value is the wrong shape", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "corrections-"))
  try {
    initRepo(dir)
    const base = commitAll(dir, "base")
    mkdirSync(path.join(dir, "corrections"), { recursive: true })
    writeFileSync(path.join(dir, "corrections", FILE_NAME), JSON.stringify(validRecord({ fields: { jobs: "oops" } })))
    const head = commitAll(dir, "add correction with malformed jobs value")

    const { ok, codes } = checkCorrectionsIn(dir, { base, head })
    assert.equal(ok, false)
    assert.deepEqual(codes, ["correction_field_type"])
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

// --- published facts /2: the unavailable vocabulary and its limit ------------

// Desk's published schema /2 (`schema.js` ENUMS): 20 fields and 11 reasons.
const V2_FIELDS = [
  "tokens", "requests", "models", "turns", "tool_durations", "permission_waits",
  "human_waits", "api_retries", "commits", "ci_runs", "plugins", "ended_at",
  "compaction_waits", "agents", "prs", "reasoning_tokens", "entrypoint", "tool_outcomes", "job_segments",
  "job_offsets",
]
const V2_REASONS = [
  "host_does_not_record", "log_missing", "log_truncated", "session_open",
  "not_collected_in_slice_1", "source_unreadable", "capped", "desk_public",
  "field_absent", "host_records_partly", "withheld_public",
]

test("the unavailable list limit is every field with every reason once, computed from the two lists, and human_turns is a field", () => {
  assert.ok(PUBLISHED_UNAVAILABLE_FIELDS.includes("human_turns"))
  assert.ok(PUBLISHED_UNAVAILABLE_FIELDS.includes("outcomes"))
  assert.deepEqual([...PUBLISHED_UNAVAILABLE_FIELDS].sort(), [...V2_FIELDS, "human_turns", "outcomes"].sort())
  assert.deepEqual([...UNAVAILABLE_REASONS].sort(), [...V2_REASONS].sort())
  assert.equal(UNAVAILABLE_LIMIT, PUBLISHED_UNAVAILABLE_FIELDS.length * UNAVAILABLE_REASONS.length)
  assert.equal(UNAVAILABLE_LIMIT, 242)
})

test("a correction may carry every /2 unavailable field and reason, every pair at once", () => {
  const all = PUBLISHED_UNAVAILABLE_FIELDS.flatMap((field) => UNAVAILABLE_REASONS.map((reason) => ({ field, reason })))
  assert.equal(all.length, UNAVAILABLE_LIMIT)
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { unavailable: all } }), FILE_NAME)
  assert.deepEqual(errors, [])
  assert.equal(ok, true)
})

test("a correction's unavailable list over the limit is refused as too many", () => {
  const all = PUBLISHED_UNAVAILABLE_FIELDS.flatMap((field) => UNAVAILABLE_REASONS.map((reason) => ({ field, reason })))
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { unavailable: [...all, all[0]] } }), FILE_NAME)
  assert.equal(ok, false)
  assert.ok(errors.some((e) => e.code === "correction_field_too_many"))
})

test("an unavailable field or reason outside the /2 vocabulary is still refused", () => {
  for (const entry of [{ field: "tokens", reason: "made_up" }, { field: "made_up", reason: "field_absent" }]) {
    const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { unavailable: [entry] } }), FILE_NAME)
    assert.equal(ok, false)
    assert.ok(errors.some((e) => e.code === "correction_field_enum"))
  }
})

test("a correction may restore a null token or request counter: null is not recorded, not zero", () => {
  const models = [{ id: "m1", requests: null, tokens: { input: null, output: null, cache_read: null, cache_write: null, reasoning: null } }]
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { models } }), FILE_NAME)
  assert.deepEqual(errors, [])
  assert.equal(ok, true)
})

// --- the mirror against Desk's vocabulary (H51) -------------------------------

import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { MIRRORED_VOCABULARY, STORE_AHEAD_OF_DESK } from "../lib/corrections.mjs"

test("a correction for a Codex job is accepted, not refused by the file name or the host", () => {
  const file = `codex-cli-${SESSION}.json`
  const record = validRecord({
    file,
    fields: { session: { host: "codex-cli", id: SESSION, duration_ms: 1000, started_offset_ms: 0 } },
  })
  const codes = validateCorrectionRecord(record, file).errors.map((e) => e.code)
  assert.ok(!codes.includes("correction_file_invalid"), codes.join())
  assert.ok(!codes.includes("correction_file_mismatch"), codes.join())
  const hostErrors = validateCorrectionRecord(record, file).errors.filter((e) => e.path === "fields.session.host")
  assert.deepEqual(hostErrors, [])
})

test("a job whose basis is spawn_brief or inherited is accepted; an unknown basis is still refused", () => {
  const job = (basis) => ({ job: "2927a4630f97b7869a71f387a4a757f1", basis, session_offset_ms: null, transitions: [], observed: null })
  for (const basis of [["spawn_brief"], ["inherited"], ["desk_tool", "inherited"]]) {
    assert.deepEqual(validateCorrectionRecord(validRecord({ fields: { jobs: [job(basis)] } }), FILE_NAME).errors, [], basis.join())
  }
  assert.ok(validateCorrectionRecord(validRecord({ fields: { jobs: [job(["made_up"])] } }), FILE_NAME).errors.some((e) => e.code === "correction_field_enum"))
})

// Desk's schema module imports nothing, so it can be loaded straight from a Desk checkout. In CI (FACTORY_REQUIRE_DESK=1) an
// unreachable Desk fails the test instead of skipping it: a skipped comparison is a drift nobody sees.
const deskSchema = process.env.DESK_DIR ? path.join(process.env.DESK_DIR, "plugins/desk/mcp/src/factory/schema.js") : null
const deskSchemaReachable = Boolean(deskSchema && existsSync(deskSchema))

test("the mirror's vocabulary equals Desk's, list for list, except values the store accepts first", { skip: deskSchemaReachable || process.env.FACTORY_REQUIRE_DESK === "1" ? false : "Desk is not reachable: set DESK_DIR to a Desk checkout" }, async () => {
  assert.ok(deskSchemaReachable, "FACTORY_REQUIRE_DESK is set but DESK_DIR does not hold Desk's schema.js")
  const { ENUMS } = await import(pathToFileURL(deskSchema).href)
  for (const [name, mirrored] of Object.entries(MIRRORED_VOCABULARY)) {
    const ahead = new Set(STORE_AHEAD_OF_DESK[name] ?? [])
    // Desk has a value the store lacks: the store must catch up (a drift, andon).
    assert.deepEqual([...ENUMS[name]].filter((value) => !mirrored.includes(value)), [], `Desk's ${name} list has a value the mirror lacks`)
    // A store-first value Desk already has must leave the allowance (andon): it would otherwise hide a later drift.
    assert.deepEqual([...ahead].filter((value) => ENUMS[name].includes(value)), [], `Desk's ${name} list now has ${[...ahead].filter((value) => ENUMS[name].includes(value)).join(", ")}: remove it from STORE_AHEAD_OF_DESK in lib/corrections.mjs`)
    // The store has a value Desk lacks and it is not a declared store-first value: a drift.
    assert.deepEqual(mirrored.filter((value) => !ENUMS[name].includes(value) && !ahead.has(value)), [], `the mirror's ${name} list has a value Desk lacks and STORE_AHEAD_OF_DESK does not allow`)
  }
})

test("every store-first value is in the mirror, and the allowance names only vocabularies the mirror holds", () => {
  for (const [name, values] of Object.entries(STORE_AHEAD_OF_DESK)) {
    assert.ok(Object.hasOwn(MIRRORED_VOCABULARY, name), name)
    for (const value of values) assert.ok(MIRRORED_VOCABULARY[name].includes(value), `${name} ${value}`)
  }
})

test("a correction may restore the outcomes flag, and a session that cut outcomes can say so", () => {
  const { ok, errors } = validateCorrectionRecord(validRecord({ fields: { unavailable: [{ field: "outcomes", reason: "capped" }] } }), FILE_NAME)
  assert.deepEqual(errors, [])
  assert.equal(ok, true)
})

test("a correction's refs accept a commit with or without a time, a PR with or without its worker and time, and nothing more", () => {
  const sha = "a".repeat(40)
  const refs = (extra) => ({ prs: [], commits: [{ repo: "ourostack/desk", sha, ...extra }], private: { prs: 0, commits: 0 } })
  const check = (value) => validateCorrectionRecord(validRecord({ fields: { refs: value } }), FILE_NAME)
  assert.deepEqual(check(refs({})).errors, [])
  assert.deepEqual(check(refs({ at_ms: 1234 })).errors, [])
  assert.ok(check(refs({ at_ms: -1 })).errors.some((e) => e.code === "correction_field_integer"))
  assert.ok(check(refs({ at_ms: "5" })).errors.some((e) => e.code === "correction_field_integer"))
  assert.ok(check(refs({ at: 5 })).errors.some((e) => e.code === "correction_field_unknown_key"))
  const pr = (extra) => ({ prs: [{ repo: "ourostack/desk", number: 7, ...extra }], commits: [], private: { prs: 0, commits: 0 } })
  assert.deepEqual(check(pr({})).errors, [])
  assert.deepEqual(check(pr({ agent: 2, at_ms: 99 })).errors, [])
  assert.ok(check(pr({ who: "x" })).errors.some((e) => e.code === "correction_field_unknown_key"))
})

test("a correction may not write a commit time or an outcomes flag into a /1 or /2 file, nor a PR time into a /1 file", () => {
  const sha = "a".repeat(40)
  const rec = (fields) => validRecord({ fields })
  const commit = rec({ refs: { prs: [], commits: [{ repo: "ourostack/desk", sha, at_ms: 5 }], private: { prs: 0, commits: 0 } } })
  const bare = rec({ refs: { prs: [], commits: [{ repo: "ourostack/desk", sha }], private: { prs: 0, commits: 0 } } })
  const pr = rec({ refs: { prs: [{ repo: "ourostack/desk", number: 1, at_ms: 5 }], commits: [], private: { prs: 0, commits: 0 } } })
  const flag = rec({ unavailable: [{ field: "outcomes", reason: "capped" }] })
  const at = (n) => ({ schema: `desk.factory.published/${n}` })
  const codes = (current, record) => checkCorrectionAgainstFacts(current, record).map((e) => e.code)
  for (const r of [commit, flag]) {
    assert.deepEqual(codes(at(1), r), ["correction_version_mismatch"])
    assert.deepEqual(codes(at(2), r), ["correction_version_mismatch"])
    assert.deepEqual(codes(at(3), r), [])
  }
  assert.deepEqual(codes(at(1), pr), ["correction_version_mismatch"])
  assert.deepEqual(codes(at(2), pr), [])
  for (const n of [1, 2, 3]) assert.deepEqual(codes(at(n), bare), [], "the old form is accepted in every version")
  assert.deepEqual(codes({}, commit), ["correction_version_mismatch"], "an unreadable version is not assumed to be new")
  assert.deepEqual(codes({}, bare), [])
})

test("applying corrections stops on a correction the target file's version does not allow, and writes nothing", async () => {
  const { dir, cleanup } = (() => { const d = mkdtempSync(path.join(tmpdir(), "ver-")); return { dir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) } })()
  try {
    mkdirSync(path.join(dir, "facts"), { recursive: true })
    mkdirSync(path.join(dir, "corrections"), { recursive: true })
    const original = JSON.stringify({ schema: "desk.factory.published/2", unavailable: [] })
    writeFileSync(path.join(dir, "facts", FILE_NAME), original)
    writeFileSync(path.join(dir, "corrections", FILE_NAME), JSON.stringify(validRecord({ fields: { unavailable: [{ field: "outcomes", reason: "capped" }] } })))
    assert.throws(() => applyCorrectionsToStore({ storeDir: dir }), (err) => err instanceof CorrectionsInvalidError && err.problems[0].errors[0].code === "correction_version_mismatch")
    assert.equal(readFileSync(path.join(dir, "facts", FILE_NAME), "utf8"), original)
  } finally {
    cleanup()
  }
})

test("the pull request check also refuses a correction the target facts file's version does not allow", () => {
  const record = JSON.stringify(validRecord({ fields: { unavailable: [{ field: "outcomes", reason: "capped" }] } }))
  const run = (schema) => (args) => {
    if (args[0] === "diff") return `corrections/${FILE_NAME}\0`
    if (args[1] === "blob" && args[2].includes(":corrections/")) return record
    if (args[1] === "blob" && args[2].includes(":facts/")) return JSON.stringify({ schema })
    throw new Error("unexpected")
  }
  const base = "a".repeat(40)
  assert.deepEqual(checkCorrections({ base, head: base, runGit: run("desk.factory.published/2") }).codes, ["correction_version_mismatch"])
  assert.deepEqual(checkCorrections({ base, head: base, runGit: run("desk.factory.published/3") }).codes, [])
})

// --- published facts /4: finish day, created pull requests, why the agent stopped ------------

const JOB_X = "2927a4630f97b7869a71f387a4a757f1"
const JOB_Y = "3a27a4630f97b7869a71f387a4a757f2"
const STOP = { end: "end_turn", asks: false, pending_agents: null }
const ZERO_PRIVATE = { prs: 0, commits: 0 }

// A complete, valid `/4` facts file; `over` replaces top-level keys.
function facts4(over = {}) {
  return {
    schema: "desk.factory.published/4",
    session: { host: "claude-code", id: SESSION, host_version: "2.0.0", entrypoint: "cli", duration_ms: 1000, ended: true, end_reason: "other" },
    plugins: [],
    models: [],
    agents: [{ n: 0, parent: null, model: "claude-opus-4", agent_type: "main", requested_model: "opus" }],
    intervals: [
      { kind: "turn", agent: 0, start_ms: 0, end_ms: 5 },
      { kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10, stop: STOP },
      { kind: "human_wait", agent: 0, start_ms: 20, end_ms: 30, stop: { end: "ask_question", asks: true, pending_agents: true } },
    ],
    counts: { tool_calls: {}, tool_failures: {}, tool_retries: 0, api_retries: 0, compactions: 0 },
    refs: {
      prs: [{ repo: "ourostack/desk", number: 7, created: false }, { repo: "ourostack/desk", number: 8, at_ms: 9, created: false }],
      commits: [],
      private: ZERO_PRIVATE,
    },
    jobs: [
      { job: JOB_X, basis: ["desk_commit"], session_offset_ms: null, transitions: [{ to: "done", offset_ms: 5 }], observed: { status: "done", offset_ms: 5 }, finished_on: "2026-10-01", finished_basis: "transition" },
      { job: JOB_Y, basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: null, finished_on: null, finished_basis: null },
    ],
    unavailable: [],
    ...over,
  }
}

// The same file as `/3` content: no `/4` key anywhere.
function facts3() {
  const f = facts4({ schema: "desk.factory.published/3" })
  f.intervals = f.intervals.map(({ stop, ...rest }) => rest)
  f.refs = { ...f.refs, prs: f.refs.prs.map(({ created, ...rest }) => rest) }
  f.jobs = f.jobs.map(({ finished_on, finished_basis, ...rest }) => rest)
  return f
}

const rec4 = (fields) => validRecord({ fields })
const codes4 = (current, record) => checkCorrectionAgainstFacts(current, record).map((e) => e.code)
const bareJob = (job) => ({ job, basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: null })

test("a correction record may carry the /4 keys: a PR's created flag, a human wait's stop, a job's finish day", () => {
  const stopped = { kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10, stop: STOP }
  assert.deepEqual(validateCorrectionRecord(rec4({ intervals: [stopped] }), FILE_NAME), { ok: true, errors: [] })
  assert.deepEqual(validateCorrectionRecord(rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 7, created: false }], commits: [], private: ZERO_PRIVATE } }), FILE_NAME).errors, [])
  const jobs = facts4().jobs
  assert.deepEqual(validateCorrectionRecord(rec4({ jobs }), FILE_NAME).errors, [])
})

test("the /4 keys are checked for shape: a bad stop, created flag or finish day is refused with its path", () => {
  const wait = (stop) => rec4({ intervals: [{ kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10, stop }] })
  const errs = (record) => validateCorrectionRecord(record, FILE_NAME).errors.map((e) => `${e.code}@${e.path}`)
  assert.deepEqual(errs(wait({ ...STOP, end: "sleeping" })), ["correction_field_enum@fields.intervals.0.stop.end"])
  assert.deepEqual(errs(wait({ end: "end_turn", asks: false })), ["correction_field_missing@fields.intervals.0.stop.pending_agents"])
  assert.deepEqual(errs(wait({ ...STOP, asks: "yes" })), ["correction_field_type@fields.intervals.0.stop.asks"])
  assert.deepEqual(errs(wait({ ...STOP, text: "x" })), ["correction_field_unknown_key@fields.intervals.0.stop"])
  assert.deepEqual(errs(wait({ end: "end_turn", asks: null, pending_agents: null })), [])
  const pr = (created) => rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 7, created }], commits: [], private: ZERO_PRIVATE } })
  assert.deepEqual(errs(pr("no")), ["correction_field_type@fields.refs.prs.0.created"])
  const job = (extra) => rec4({ jobs: [{ ...bareJob(JOB_X), ...extra }] })
  assert.deepEqual(errs(job({ finished_on: "2026-13-40", finished_basis: "transition" })), ["correction_field_pattern@fields.jobs.0.finished_on"])
  assert.deepEqual(errs(job({ finished_on: "2024-12-31", finished_basis: "transition" })), ["correction_field_range@fields.jobs.0.finished_on"])
  assert.deepEqual(errs(job({ finished_on: "2026-10-01T10:00:00Z", finished_basis: "transition" })), ["correction_field_pattern@fields.jobs.0.finished_on"])
  assert.deepEqual(errs(job({ finished_on: "2026-10-01", finished_basis: "guess" })), ["correction_field_enum@fields.jobs.0.finished_basis"])
  assert.deepEqual(errs(job({ finished_on: 5, finished_basis: null })), ["correction_field_type@fields.jobs.0.finished_on"])
  assert.deepEqual(errs(job({ finished_on: "2026-10-01" })), ["correction_field_missing@fields.jobs.0.finished_basis"])
  assert.deepEqual(errs(job({ finished_basis: "transition" })), ["correction_field_missing@fields.jobs.0.finished_on"])
  assert.deepEqual(errs(job({ finished_on: null, finished_basis: null })), [])
})

test("a stop belongs only on a human wait: on any other interval it is still an unknown key", () => {
  const record = rec4({ intervals: [{ kind: "turn", agent: 0, start_ms: 0, end_ms: 5, stop: STOP }] })
  assert.deepEqual(validateCorrectionRecord(record, FILE_NAME).errors, [{ code: "correction_field_unknown_key", path: "fields.intervals.0" }])
})

test("a correction may not write a /4 key into a file older than /4, and /3 corrections keep working", () => {
  const withStop = rec4({ intervals: [{ kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10, stop: STOP }] })
  const withCreated = rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 7, created: false }], commits: [], private: ZERO_PRIVATE } })
  const withFinish = rec4({ jobs: [{ ...bareJob(JOB_X), finished_on: null, finished_basis: null }] })
  for (const n of [1, 2, 3]) {
    const old = { schema: `desk.factory.published/${n}` }
    assert.deepEqual(codes4(old, withStop), ["correction_version_mismatch"])
    assert.deepEqual(codes4(old, withCreated), ["correction_version_mismatch"])
    assert.deepEqual(codes4(old, withFinish), ["correction_version_mismatch", "correction_version_mismatch"])
  }
  assert.deepEqual(codes4({}, withStop), ["correction_version_mismatch"], "an unreadable version is not assumed to be new")
  for (const r of [withStop, withCreated, withFinish]) assert.deepEqual(codes4(facts4(), r), [])
  // The /3 forms still pass against a /3 file and a /4 file.
  const old3 = rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 7, at_ms: 3 }], commits: [], private: ZERO_PRIVATE } })
  assert.deepEqual(codes4(facts3(), old3), [])
})

test("a /4 file keeps every /4 key through a correction that does not name it", () => {
  const current = facts4()
  // A /3-shaped replacement of refs, intervals and the jobs ceiling: the record knows no /4 key.
  const record = rec4({
    refs: { prs: [{ repo: "ourostack/desk", number: 8, at_ms: 9 }, { repo: "ourostack/desk", number: 7 }], commits: [], private: ZERO_PRIVATE },
    intervals: [
      { kind: "human_wait", agent: 0, start_ms: 20, end_ms: 30 },
      { kind: "turn", agent: 0, start_ms: 0, end_ms: 5 },
      { kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10 },
    ],
    jobs: [bareJob(JOB_X)],
  })
  assert.deepEqual(validateCorrectionRecord(record, FILE_NAME).errors, [])
  assert.deepEqual(codes4(current, record), [])
  const out = applyCorrection(current, record)
  assert.deepEqual(out.refs.prs, [{ repo: "ourostack/desk", number: 8, at_ms: 9, created: false }, { repo: "ourostack/desk", number: 7, created: false }])
  assert.deepEqual(out.intervals.map((i) => i.stop), [{ end: "ask_question", asks: true, pending_agents: true }, undefined, STOP])
  assert.deepEqual(out.jobs, [current.jobs[0]], "the ceiling keeps the current job exactly, finish day included")
  assert.equal(out.schema, "desk.factory.published/4")
})

test("a correction that names a /4 key wins over the current value", () => {
  const current = facts4()
  const record = rec4({
    refs: { prs: [{ repo: "ourostack/desk", number: 7, created: true }], commits: [], private: ZERO_PRIVATE },
    intervals: [{ kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10, stop: { end: "interrupted", asks: null, pending_agents: false } }],
  })
  const out = applyCorrection(current, record)
  assert.deepEqual(out.refs.prs, [{ repo: "ourostack/desk", number: 7, created: true }])
  assert.deepEqual(out.intervals[0].stop, { end: "interrupted", asks: null, pending_agents: false })
})

test("a jobs correction never rewrites a job's finish day, even when its entry carries another", () => {
  const current = facts4()
  const record = rec4({ jobs: [{ ...bareJob(JOB_X), finished_on: "2026-01-02", finished_basis: "card_updated" }, bareJob(JOB_Y)] })
  const out = applyCorrection(current, record)
  assert.deepEqual(out.jobs, current.jobs)
  assert.equal(correctionChanges(current, record), false)
})

test("a /4 key the correction drops and the file cannot supply is refused, not silently left out", () => {
  const current = facts4()
  const newPr = rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 99 }], commits: [], private: ZERO_PRIVATE } })
  assert.deepEqual(checkCorrectionAgainstFacts(current, newPr), [{ code: "correction_v4_key_missing", path: "fields.refs.prs.0.created" }])
  const newWait = rec4({ intervals: [{ kind: "human_wait", agent: 0, start_ms: 40, end_ms: 50 }, { kind: "turn", agent: 0, start_ms: 0, end_ms: 5 }] })
  assert.deepEqual(checkCorrectionAtFacts(newWait), [{ code: "correction_v4_key_missing", path: "fields.intervals.0.stop" }])
  function checkCorrectionAtFacts(record) { return checkCorrectionAgainstFacts(current, record) }
  // Naming the key is enough.
  const named = rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 99, created: false }], commits: [], private: ZERO_PRIVATE } })
  assert.deepEqual(checkCorrectionAgainstFacts(current, named), [])
  // /3 files need nothing.
  assert.deepEqual(checkCorrectionAgainstFacts(facts3(), rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 99 }], commits: [], private: ZERO_PRIVATE } })), [])
})

test("a public desk never publishes a created pull request, and a correction cannot say otherwise", () => {
  const pub = facts4({ unavailable: [{ field: "job_offsets", reason: "desk_public" }] })
  const created = (flag, extra = {}) => rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 7, created: flag }], commits: [], private: ZERO_PRIVATE }, ...extra })
  assert.deepEqual(checkCorrectionAgainstFacts(pub, created(true)), [{ code: "correction_inconsistent", path: "fields.refs.prs.0.created" }])
  assert.deepEqual(checkCorrectionAgainstFacts(pub, created(false)), [])
  assert.deepEqual(checkCorrectionAgainstFacts(facts4(), created(true)), [], "a desk that is not public may say created")
  // The record can itself make the file public.
  assert.deepEqual(checkCorrectionAgainstFacts(facts4(), created(true, { unavailable: [{ field: "job_offsets", reason: "desk_public" }] })).map((e) => e.code), ["correction_inconsistent"])
  // And it can lift it.
  assert.deepEqual(checkCorrectionAgainstFacts(pub, created(true, { unavailable: [] })), [])
})

test("applying and checking corrections handle a /4 file end to end, and Desk accepts the result", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "v4-"))
  try {
    mkdirSync(path.join(dir, "facts"), { recursive: true })
    mkdirSync(path.join(dir, "corrections"), { recursive: true })
    const current = facts4()
    writeFileSync(path.join(dir, "facts", FILE_NAME), `${JSON.stringify(current)}\n`)
    const record = rec4({
      refs: { prs: [{ repo: "ourostack/desk", number: 7 }], commits: [], private: ZERO_PRIVATE },
      intervals: [{ kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10 }],
      jobs: [bareJob(JOB_X)],
    })
    writeFileSync(path.join(dir, "corrections", FILE_NAME), JSON.stringify(record))
    const result = applyCorrectionsToStore({ storeDir: dir })
    assert.deepEqual(result.applied, [FILE_NAME])
    const written = readFileSync(path.join(dir, "facts", FILE_NAME), "utf8")
    const out = JSON.parse(written)
    assert.deepEqual(out.refs.prs, [{ repo: "ourostack/desk", number: 7, created: false }])
    assert.deepEqual(out.intervals, [{ kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10, stop: STOP }])
    assert.deepEqual(out.jobs, [current.jobs[0]])
    // A second pass finds nothing to change.
    assert.deepEqual(applyCorrectionsToStore({ storeDir: dir }).unchanged, [FILE_NAME])
    if (deskPublished) {
      const { validatePublishedBytes } = await import(pathToFileURL(deskPublished).href)
      assert.deepEqual(validatePublishedBytes(written), { ok: true, errors: [] }, "Desk's validator accepts the corrected /4 file")
      assert.deepEqual(validatePublishedBytes(`${JSON.stringify(current)}\n`), { ok: true, errors: [] }, "the fixture itself is a valid /4 file")
    } else {
      assert.ok(process.env.FACTORY_REQUIRE_DESK !== "1", "FACTORY_REQUIRE_DESK is set but DESK_DIR does not hold Desk's published-schema.js")
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const deskPublished = process.env.DESK_DIR && existsSync(path.join(process.env.DESK_DIR, "plugins/desk/mcp/src/factory/published-schema.js"))
  ? path.join(process.env.DESK_DIR, "plugins/desk/mcp/src/factory/published-schema.js")
  : null

test("a /3 file and a /3-shaped correction behave exactly as before", () => {
  const current = facts3()
  const record = rec4({
    refs: { prs: [{ repo: "ourostack/desk", number: 7 }], commits: [], private: ZERO_PRIVATE },
    intervals: [{ kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10 }],
  })
  assert.deepEqual(checkCorrectionAgainstFacts(current, record), [])
  const out = applyCorrection(current, record)
  assert.deepEqual(out.refs.prs, [{ repo: "ourostack/desk", number: 7 }])
  assert.deepEqual(out.intervals, [{ kind: "human_wait", agent: 0, start_ms: 5, end_ms: 10 }])
})

test("the pull request check refuses a /4 correction that drops a /4 key, and passes one that keeps it", () => {
  const run = (record) => (args) => {
    if (args[0] === "diff") return `corrections/${FILE_NAME}\0`
    if (args[1] === "blob" && args[2].includes(":corrections/")) return JSON.stringify(record)
    if (args[1] === "blob" && args[2].includes(":facts/")) return JSON.stringify(facts4())
    throw new Error("unexpected")
  }
  const base = "a".repeat(40)
  const drops = rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 99 }], commits: [], private: ZERO_PRIVATE } })
  const keeps = rec4({ refs: { prs: [{ repo: "ourostack/desk", number: 7 }], commits: [], private: ZERO_PRIVATE } })
  assert.deepEqual(checkCorrections({ base, head: base, runGit: run(drops) }).codes, ["correction_v4_key_missing"])
  assert.deepEqual(checkCorrections({ base, head: base, runGit: run(keeps) }).codes, [])
})

test("the mirror's /4 vocabulary equals Desk's", { skip: deskSchemaReachable || process.env.FACTORY_REQUIRE_DESK === "1" ? false : "Desk is not reachable: set DESK_DIR to a Desk checkout" }, async () => {
  assert.ok(deskSchemaReachable, "FACTORY_REQUIRE_DESK is set but DESK_DIR does not hold Desk's schema.js")
  const { ENUMS } = await import(pathToFileURL(deskSchema).href)
  assert.deepEqual([...MIRRORED_VOCABULARY.stopEnd], [...ENUMS.stopEnd])
  assert.deepEqual([...MIRRORED_VOCABULARY.finishedBasis], [...ENUMS.finishedBasis])
})
