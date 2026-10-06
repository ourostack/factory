import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { test } from "node:test"

import { Readable } from "node:stream"

import { RETIRED_PAGE, historicalJobs, main, readBatch, spawnGit, writeRetiredPages } from "../retired-job-pages.mjs"

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

test("a job a rebuild dropped keeps a page; a reported job's page is left as built", async () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_KEPT, JOB_RETIRED) }, "intake")
  commit(dir, { [FACTS]: facts(JOB_KEPT), [OTHER]: facts(JOB_LATER, "not-a-job-id") }, "rebuild")
  const out = reports([JOB_KEPT, JOB_LATER])

  assert.deepEqual(await writeRetiredPages({ store: dir, out }), { reported: 2, retired: 1 })
  assert.equal(readFileSync(path.join(out, "jobs", `${JOB_RETIRED}.md`), "utf8"), RETIRED_PAGE)
  assert.equal(existsSync(path.join(out, "jobs", `${JOB_RETIRED}.json`)), false, "no .json, so no rollup or site count")
  assert.equal(readFileSync(path.join(out, "jobs", `${JOB_KEPT}.md`), "utf8"), "# report\n")
})

test("a job whose facts file was withdrawn keeps a page too", async () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_RETIRED), [OTHER]: facts(JOB_KEPT) }, "intake")
  commit(dir, { [FACTS]: null }, "retraction")
  const out = reports([JOB_KEPT])

  assert.deepEqual(await writeRetiredPages({ store: dir, out }), { reported: 1, retired: 1 })
  assert.deepEqual(readdirSync(path.join(out, "jobs")).sort(), [`${JOB_KEPT}.json`, `${JOB_KEPT}.md`, `${JOB_RETIRED}.md`].sort())
})

test("the page carries the fixed text only: no date, path, session or person", () => {
  assert.doesNotMatch(RETIRED_PAGE, /\d{4}-\d{2}-\d{2}|\/Users\/|[0-9a-f]{8}-[0-9a-f]{4}/u)
  // True for a card finished before or after its job was retired.
  assert.doesNotMatch(RETIRED_PAGE, /was finished while/u)
  assert.match(RETIRED_PAGE, /names a job an earlier derivation credited/u)
})

test("a store with no facts history retires nothing", async () => {
  const dir = store()
  commit(dir, {}, "empty")
  assert.deepEqual(await historicalJobs(dir), [])
  assert.deepEqual(await writeRetiredPages({ store: dir, out: reports([]) }), { reported: 0, retired: 0 })
})

test("an unreadable historical facts blob is skipped, not fatal", async () => {
  const dir = store()
  commit(dir, { [FACTS]: "{ not json", [OTHER]: facts(JOB_RETIRED) }, "intake")
  commit(dir, { [FACTS]: `${JSON.stringify({ jobs: "nope" })}\n` }, "odd")
  assert.deepEqual(await historicalJobs(dir), [JOB_RETIRED])
})

test("a shallow checkout stops the step instead of writing fewer pages", async () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_RETIRED) }, "one")
  commit(dir, { [FACTS]: facts(JOB_KEPT) }, "two")
  const shallow = mkdtempSync(path.join(tmpdir(), "retired-shallow-"))
  execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${dir}`, shallow])
  await assert.rejects(historicalJobs(shallow), /shallow/u)
})

test("a reports folder without jobs/ is refused", async () => {
  const dir = store()
  const out = mkdtempSync(path.join(tmpdir(), "retired-out-"))
  await assert.rejects(writeRetiredPages({ store: dir, out }), /no jobs\/ folder/u)
})

test("main prints the counts, and refuses bad arguments or a failed step with exit 1", async () => {
  const dir = store()
  commit(dir, { [FACTS]: facts(JOB_RETIRED) }, "intake")
  const out = reports([])
  const written = []
  const errors = []
  assert.equal(await main({ argv: ["--store", dir, "--out", out], write: (text) => written.push(text), logError: (text) => errors.push(text) }), 0)
  assert.deepEqual(JSON.parse(written[0]), { reported: 0, retired: 1 })
  assert.equal(await main({ argv: ["--store", dir], write: () => {}, logError: (text) => errors.push(text) }), 1)
  assert.equal(await main({ argv: ["--store", dir, "--out"], write: () => {}, logError: (text) => errors.push(text) }), 1)
  assert.equal(await main({ argv: ["--store", dir, "--out", path.join(out, "missing")], write: () => {}, logError: (text) => errors.push(text) }), 1)
  assert.match(errors.join(""), /Usage:/u)
  assert.match(errors.join(""), /no jobs\/ folder/u)
})

// --- streaming ----------------------------------------------------------------

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const object = (sha, text) => Buffer.concat([Buffer.from(`${sha} blob ${Buffer.byteLength(text)}\n`), Buffer.from(text), Buffer.from("\n")])
// A stream that hands out `bytes` in pieces of `size`, so headers and bodies split across chunks.
const pieces = (bytes, size) => Readable.from(Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size)))

test("readBatch reads every object one at a time, whatever the chunking, and counts bytes not characters", async () => {
  const first = facts(JOB_KEPT)
  const second = `{"jobs":[{"job":"${JOB_RETIRED}"}],"note":"é ü"}`
  const bytes = Buffer.concat([object(SHA_A, first), object(SHA_B, second)])
  for (const size of [1, 3, 7, 64, bytes.length]) {
    const seen = []
    assert.equal(await readBatch(pieces(bytes, size), (sha, body) => seen.push([sha, body.toString("utf8")])), 2, `chunk size ${size}`)
    assert.deepEqual(seen, [[SHA_A, first], [SHA_B, second]], `chunk size ${size}`)
  }
  assert.equal(await readBatch(Readable.from([]), () => assert.fail("no objects")), 0)
})

test("readBatch stops loudly on a missing object instead of reading fewer files", async () => {
  const bytes = Buffer.concat([Buffer.from(`${SHA_A} missing\n`), object(SHA_B, facts(JOB_RETIRED))])
  await assert.rejects(readBatch(Readable.from([bytes]), () => {}), /unexpected object in history/u)
  await assert.rejects(readBatch(Readable.from([Buffer.from(`${SHA_A} tree 4\nabcd\n`)]), () => {}), /unexpected object/u)
})

test("readBatch stops loudly when the stream ends inside an object", async () => {
  const whole = object(SHA_A, facts(JOB_KEPT))
  await assert.rejects(readBatch(Readable.from([whole.subarray(0, whole.length - 5)]), () => {}), /ended inside an object/u)
  await assert.rejects(readBatch(Readable.from([Buffer.from(`${SHA_A} blob`)]), () => {}), /ended inside an object/u)
})

// A fake Git: answers each command from `outputs` (by its first argument) and exits with `codes`.
function fakeGit(outputs, codes = {}) {
  return (store, args) => {
    const stdout = Readable.from([Buffer.from(outputs[args[0]] ?? "")])
    const code = codes[args[0]] ?? 0
    return { stdout, stdin: { end: () => {} }, done: code === 0 ? Promise.resolve() : Promise.reject(new Error(`retired-job-pages: git ${args[0]} failed: boom`)) }
  }
}
const rawLine = (sha) => `:100644 100644 ${"0".repeat(40)} ${sha} A\tfacts/claude-code-11111111-1111-4111-8111-111111111111.json\n`

test("historicalJobs refuses to go on when history yields fewer files than it listed", async () => {
  const git = fakeGit({ "rev-parse": "false\n", log: rawLine(SHA_A) + rawLine(SHA_B), "cat-file": object(SHA_A, facts(JOB_KEPT)).toString("utf8") })
  await assert.rejects(historicalJobs("/store", git), /read 1 of 2 facts files/u)
})

test("historicalJobs stops on a failed Git call", async () => {
  await assert.rejects(historicalJobs("/store", fakeGit({ "rev-parse": "false\n", log: rawLine(SHA_A) }, { log: 128 })), /git log failed/u)
  const real = store()
  commit(real, {}, "empty")
  await assert.rejects(historicalJobs(path.join(real, "missing-folder")), /git rev-parse failed/u)
})

test("readBatch holds one object at a time: 600 MiB of history, more than the old 512 MiB buffer, reads in bounded memory", async () => {
  const MiB = 1024 * 1024
  const body = Buffer.alloc(MiB, 0x78)
  async function* history() {
    for (let n = 0; n < 600; n += 1) {
      yield Buffer.from(`${n.toString(16).padStart(40, "0")} blob ${MiB}\n`)
      for (let at = 0; at < MiB; at += 64 * 1024) yield body.subarray(at, at + 64 * 1024)
      yield Buffer.from("\n")
    }
  }
  let peak = 0
  const read = await readBatch(Readable.from(history()), () => {
    peak = Math.max(peak, process.memoryUsage().arrayBuffers)
  })
  assert.equal(read, 600)
  assert.ok(peak < 256 * MiB, `peak buffer memory ${Math.round(peak / MiB)} MiB`)
})

test("historicalJobs reads many files through the real Git", async () => {
  const dir = store()
  const files = {}
  for (let n = 0; n < 200; n += 1) files[`facts/claude-code-${String(n).padStart(8, "0")}-1111-4111-8111-111111111111.json`] = facts(n.toString(16).padStart(32, "0"))
  commit(dir, files, "many")
  assert.equal((await historicalJobs(dir)).length, 200)
})

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test("a Git child that fails after its caller stopped reading is not an unhandled rejection", async () => {
  const seen = []
  const listener = (reason) => seen.push(reason)
  process.on("unhandledRejection", listener)
  try {
    const dir = store()
    // The caller never awaits `done`, as when `readBatch` threw first.
    spawnGit(dir, ["rev-parse", "--verify", "no-such-ref"])
    await pause(500)
    assert.deepEqual(seen, [])
    rmSync(dir, { recursive: true, force: true })
  } finally {
    process.off("unhandledRejection", listener)
  }
})

test("a Git child that dies before it reads its input fails loudly through `done`, never as an uncaught write error", async () => {
  const uncaught = []
  const listener = (error) => uncaught.push(error)
  process.on("uncaughtException", listener)
  try {
    const dir = store()
    const git = spawnGit(dir, ["rev-parse", "--verify", "no-such-ref"])
    await pause(300) // the child has exited and closed its end of the pipe
    git.stdin.write(Buffer.alloc(1 << 20))
    await assert.rejects(git.done, /retired-job-pages: git rev-parse failed/)
    await pause(100)
    assert.deepEqual(uncaught, [])
    rmSync(dir, { recursive: true, force: true })
  } finally {
    process.off("uncaughtException", listener)
  }
})
