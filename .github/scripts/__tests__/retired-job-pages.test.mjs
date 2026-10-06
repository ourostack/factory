import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { test } from "node:test"

import { RETIRED_PAGE, historicalJobs, main, writeRetiredPages } from "../retired-job-pages.mjs"

const JOB_KEPT = "a".repeat(32)
const JOB_RETIRED = "b0174d12da0f501e34dd35b5fd0b2448"
const JOB_LATER = "c".repeat(32)
const FACTS = "facts/claude-code-11111111-1111-4111-8111-111111111111.json"
const OTHER = "facts/claude-code-22222222-2222-4222-8222-222222222222.json"

const sh = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" })
const facts = (...jobs) => `${JSON.stringify({ schema: "desk.factory.published/1", jobs: jobs.map((job) => ({ job })) })}\n`

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), "retired-store-"))
  sh(dir, ["init", "--quiet", "--initial-branch=main"])
  sh(dir, ["config", "user.email", "test@example.com"])
  sh(dir, ["config", "user.name", "Test"])
  mkdirSync(path.join(dir, "facts"))
  return dir
}

function commit(dir, files, message) {
  for (const [name, text] of Object.entries(files)) {
    if (text === null) rmSync(path.join(dir, name))
    else writeFileSync(path.join(dir, name), text)
  }
  sh(dir, ["add", "-A"])
  sh(dir, ["commit", "--quiet", "--allow-empty", "-m", message])
}

function reports(jobs) {
  const dir = mkdtempSync(path.join(tmpdir(), "retired-out-"))
  mkdirSync(path.join(dir, "jobs"))
  for (const job of jobs) {
    writeFileSync(path.join(dir, "jobs", `${job}.md`), "# report\n")
    writeFileSync(path.join(dir, "jobs", `${job}.json`), "{}\n")
  }
  return dir
}

test("a job a rebuild dropped keeps a page; a reported job's page is left as built", () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_KEPT, JOB_RETIRED) }, "intake")
  commit(dir, { [FACTS]: facts(JOB_KEPT), [OTHER]: facts(JOB_LATER, "not-a-job-id") }, "rebuild")
  const out = reports([JOB_KEPT, JOB_LATER])

  assert.deepEqual(writeRetiredPages({ store: dir, out }), { reported: 2, retired: 1 })
  assert.equal(readFileSync(path.join(out, "jobs", `${JOB_RETIRED}.md`), "utf8"), RETIRED_PAGE)
  assert.equal(existsSync(path.join(out, "jobs", `${JOB_RETIRED}.json`)), false, "no .json, so no rollup or site count")
  assert.equal(readFileSync(path.join(out, "jobs", `${JOB_KEPT}.md`), "utf8"), "# report\n")
})

test("a job whose facts file was withdrawn keeps a page too", () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_RETIRED), [OTHER]: facts(JOB_KEPT) }, "intake")
  commit(dir, { [FACTS]: null }, "retraction")
  const out = reports([JOB_KEPT])

  assert.deepEqual(writeRetiredPages({ store: dir, out }), { reported: 1, retired: 1 })
  assert.deepEqual(readdirSync(path.join(out, "jobs")).sort(), [`${JOB_KEPT}.json`, `${JOB_KEPT}.md`, `${JOB_RETIRED}.md`].sort())
})

test("the page carries the fixed text only: no date, path, session or person", () => {
  assert.doesNotMatch(RETIRED_PAGE, /\d{4}-\d{2}-\d{2}|\/Users\/|[0-9a-f]{8}-[0-9a-f]{4}/u)
})

test("a store with no facts history retires nothing", () => {
  const dir = store()
  commit(dir, {}, "empty")
  assert.deepEqual(historicalJobs(dir), [])
  assert.deepEqual(writeRetiredPages({ store: dir, out: reports([]) }), { reported: 0, retired: 0 })
})

test("an unreadable historical facts blob is skipped, not fatal", () => {
  const dir = store()
  commit(dir, { [FACTS]: "{ not json", [OTHER]: facts(JOB_RETIRED) }, "intake")
  commit(dir, { [FACTS]: `${JSON.stringify({ jobs: "nope" })}\n` }, "odd")
  assert.deepEqual(historicalJobs(dir), [JOB_RETIRED])
})

test("a shallow checkout stops the step instead of writing fewer pages", () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_RETIRED) }, "one")
  commit(dir, { [FACTS]: facts(JOB_KEPT) }, "two")
  const shallow = mkdtempSync(path.join(tmpdir(), "retired-shallow-"))
  execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${dir}`, shallow])
  assert.throws(() => historicalJobs(shallow), /shallow/u)
})

test("a reports folder without jobs/ is refused", () => {
  const dir = store()
  const out = mkdtempSync(path.join(tmpdir(), "retired-out-"))
  assert.throws(() => writeRetiredPages({ store: dir, out }), /no jobs\/ folder/u)
})

test("main prints the counts, and refuses bad arguments or a failed step with exit 1", () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_RETIRED) }, "intake")
  const out = reports([])
  const written = []
  const errors = []
  assert.equal(main({ argv: ["--store", dir, "--out", out], write: (text) => written.push(text), logError: (text) => errors.push(text) }), 0)
  assert.deepEqual(JSON.parse(written[0]), { reported: 0, retired: 1 })
  assert.equal(main({ argv: ["--store", dir], write: () => {}, logError: (text) => errors.push(text) }), 1)
  assert.equal(main({ argv: ["--store", dir, "--out"], write: () => {}, logError: (text) => errors.push(text) }), 1)
  assert.equal(main({ argv: ["--store", dir, "--out", path.join(out, "missing")], write: () => {}, logError: (text) => errors.push(text) }), 1)
  assert.match(errors.join(""), /Usage:/u)
  assert.match(errors.join(""), /no jobs\/ folder/u)
})
