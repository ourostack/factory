#!/usr/bin/env node
// Writes a short page for every retired job into a built reports folder.
// Usage:
//
//   node retired-job-pages.mjs --store <store checkout> --out <reports folder>
//
// Why this exists: a task card links its job's report the moment the task is
// done (`factory_report: .../blob/reports/jobs/<job>.md`), and the reports
// branch is rebuilt from scratch from the facts on `main` every time. When a
// later derivation stops crediting a job (newer binding rules move its
// sessions' credit to other work, a correction cuts it, or its sessions are
// withdrawn), the rebuild correctly drops the job's report, and the card's
// link starts answering 404. A dead link reads as a broken store, not as
// "no session is credited to this job now", which is the truth.
//
// A retired job is one whose ID appears in some facts file anywhere in the
// history of `main` and that the build just made no report for. For each one
// this writes `jobs/<job>.md` with a fixed text and nothing else: the job ID,
// a one-way hash `main`'s history already holds publicly, is the only value
// on the page. It writes no `.json`, so the site and the rollups, which read
// `jobs/*.json`, never count a retired job as a job.
//
// It reads Git objects only (never the working tree, which the corrections
// step rewrites in place), streams them one file at a time so memory stays
// bounded by the largest facts file however long history grows, and needs
// the full history: on a shallow checkout, a missing object or a failed Git
// call it stops with an error instead of quietly writing fewer pages,
// because a missing page is exactly the failure it exists to prevent.
//
// What it does not cover: a card whose job ID never appeared in any facts
// file on main (no session was ever credited to the job, or the desk
// publishes keyed job IDs while the card links the plain one) still links a
// missing page; the store cannot know such a job exists.
import { spawn } from "node:child_process"
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"

const JOB_ID = /^[0-9a-f]{32}$/u
const NULL_SHA = /^0+$/u
const RAW_LINE = /^:\d{6} \d{6} ([0-9a-f]{40}) ([0-9a-f]{40}) [A-Z]\d*\tfacts\/[^/]+\.json$/u
const BATCH_HEADER = /^([0-9a-f]{40}) blob (\d+)$/u

export const RETIRED_PAGE = `# Retired job

No session is credited to this job now, so this report holds no measurements.

Sessions that were once credited to it have since been re-derived under newer binding rules, corrected or withdrawn from this store, and none of them credits this job any more. Their time now counts toward other jobs or toward none.

A task card that links here names a job an earlier derivation credited. The link stays valid on purpose: it leads to this page instead of a missing file.
`

// One Git child process with its output as a stream: `{ stdout, stdin, done }`, where `done` resolves when it exits 0 and rejects
// otherwise. Nothing is buffered whole, so memory stays bounded by the largest single facts file, however long the history grows.
function spawnGit(store, args) {
  const child = spawn("git", ["-C", store, ...args], { stdio: ["pipe", "pipe", "pipe"] })
  const errors = []
  child.stderr.on("data", (chunk) => errors.push(chunk))
  const done = new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`retired-job-pages: git ${args[0]} failed: ${Buffer.concat(errors).toString("utf8").trim()}`))))
  })
  return { stdout: child.stdout, stdin: child.stdin, done }
}

/**
 * Reads `git cat-file --batch` output from `stream` and calls `onBlob(sha, bytes)` once per object, holding one object at a time.
 * Throws on anything but a blob with a whole size (a `missing` object, say) or on output cut short: a step that exists so no
 * page goes missing never quietly reads fewer files. Resolves to the number of blobs read.
 */
export async function readBatch(stream, onBlob) {
  let chunks = []
  let length = 0
  let need = null // `{ sha, size }` while a body is being read
  let count = 0
  const take = (size) => {
    const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length)
    const head = all.subarray(0, size)
    const rest = all.subarray(size)
    chunks = rest.length === 0 ? [] : [rest]
    length = rest.length
    return head
  }
  const drain = () => {
    for (;;) {
      if (need === null) {
        const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length)
        chunks = length === 0 ? [] : [all]
        const end = all.indexOf(0x0a)
        if (end === -1) return
        const header = take(end + 1).subarray(0, end).toString("utf8")
        const match = BATCH_HEADER.exec(header)
        if (match === null) throw new Error(`retired-job-pages: unexpected object in history: ${header}`)
        need = { sha: match[1], size: Number(match[2]) }
      }
      if (length < need.size + 1) return
      const body = take(need.size + 1)
      onBlob(need.sha, body.subarray(0, need.size))
      count += 1
      need = null
    }
  }
  for await (const chunk of stream) {
    chunks.push(chunk)
    length += chunk.length
    drain()
  }
  if (need !== null || length > 0) throw new Error("retired-job-pages: the object stream ended inside an object")
  return count
}

/** The job IDs one facts file holds; an unreadable file holds none. */
function jobsOf(bytes) {
  let facts
  try {
    facts = JSON.parse(bytes.toString("utf8"))
  } catch {
    return []
  }
  return (Array.isArray(facts?.jobs) ? facts.jobs : []).map((entry) => entry?.job).filter((job) => typeof job === "string" && JOB_ID.test(job))
}

/** Every job ID any facts file on `HEAD`'s history ever held, sorted. Throws on a shallow repository or a failed read. */
export async function historicalJobs(store, run = spawnGit) {
  const shallow = run(store, ["rev-parse", "--is-shallow-repository"])
  let answer = ""
  for await (const chunk of shallow.stdout) answer += chunk
  await shallow.done
  if (answer.trim() !== "false") throw new Error("retired-job-pages: the store checkout is shallow; fetch its full history first")

  const blobs = new Set()
  const log = run(store, ["log", "--format=", "--raw", "--no-abbrev", "--no-renames", "HEAD", "--", "facts/"])
  for await (const line of createInterface({ input: log.stdout, crlfDelay: Infinity })) {
    const match = RAW_LINE.exec(line)
    if (match === null) continue
    for (const sha of [match[1], match[2]]) if (!NULL_SHA.test(sha)) blobs.add(sha)
  }
  await log.done
  if (blobs.size === 0) return []

  const jobs = new Set()
  const batch = run(store, ["cat-file", "--batch"])
  batch.stdin.end(`${[...blobs].join("\n")}\n`)
  const read = await readBatch(batch.stdout, (sha, bytes) => {
    for (const job of jobsOf(bytes)) jobs.add(job)
  })
  await batch.done
  if (read !== blobs.size) throw new Error(`retired-job-pages: read ${read} of ${blobs.size} facts files from history`)
  return [...jobs].sort()
}

/** Writes a retired page for each historical job with no report in `<out>/jobs`. Resolves to `{ reported, retired }` (counts). */
export async function writeRetiredPages({ store, out, run = spawnGit }) {
  const jobsDir = path.join(out, "jobs")
  if (!existsSync(jobsDir)) throw new Error("retired-job-pages: the reports folder has no jobs/ folder; build the reports first")
  const reported = new Set(readdirSync(jobsDir).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3)))
  let retired = 0
  for (const job of await historicalJobs(store, run)) {
    if (reported.has(job)) continue
    writeFileSync(path.join(jobsDir, `${job}.md`), RETIRED_PAGE)
    retired += 1
  }
  return { reported: reported.size, retired }
}

function parseArgs(argv) {
  const options = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (typeof flag !== "string" || !flag.startsWith("--") || typeof value !== "string") return null
    options.set(flag.slice(2), value)
  }
  return options
}

export async function main({ argv = process.argv.slice(2), write = (text) => process.stdout.write(text), logError = (text) => process.stderr.write(text) } = {}) {
  const options = parseArgs(argv)
  const store = options?.get("store")
  const out = options?.get("out")
  if (options === null || store === undefined || out === undefined || options.size !== 2) {
    logError("Usage: retired-job-pages.mjs --store <store checkout> --out <reports folder>\n")
    return 1
  }
  try {
    write(`${JSON.stringify(await writeRetiredPages({ store, out }))}\n`)
    return 0
  } catch (error) {
    logError(`${error.message}\n`)
    return 1
  }
}

function isMainModule(importMetaUrl, argv1) {
  if (typeof argv1 !== "string") return false
  return importMetaUrl === pathToFileURL(argv1).href
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main()
}
