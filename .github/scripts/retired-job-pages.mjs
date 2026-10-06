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
// step rewrites in place) and needs the full history: on a shallow checkout
// it stops with an error instead of quietly writing fewer pages, because a
// missing page is exactly the failure it exists to prevent.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"

const JOB_ID = /^[0-9a-f]{32}$/u
const NULL_SHA = /^0+$/u
const RAW_LINE = /^:\d{6} \d{6} ([0-9a-f]{40}) ([0-9a-f]{40}) [A-Z]\d*\tfacts\/[^/]+\.json$/u

export const RETIRED_PAGE = `# Retired job

No session is credited to this job now, so this report holds no measurements.

Sessions that were once credited to it have since been re-derived under newer binding rules, corrected or withdrawn from this store, and none of them credits this job any more. Their time now counts toward other jobs or toward none.

A task card that links here was finished while an earlier derivation credited the job. The link stays valid on purpose: it leads to this page instead of a missing file.
`

// Text output by default; `cat-file --batch` is read as bytes, since its sizes count bytes.
function git(store, args, input) {
  const bytes = execFileSync("git", ["-C", store, ...args], { input, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] })
  return args[0] === "cat-file" ? bytes : bytes.toString("utf8")
}

/** Every job ID any facts file on `HEAD`'s history ever held, sorted. Throws on a shallow repository. */
export function historicalJobs(store, runGit = git) {
  if (runGit(store, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
    throw new Error("retired-job-pages: the store checkout is shallow; fetch its full history first")
  }
  const blobs = new Set()
  const raw = runGit(store, ["log", "--format=", "--raw", "--no-abbrev", "--no-renames", "HEAD", "--", "facts/"])
  for (const line of raw.split("\n")) {
    const match = RAW_LINE.exec(line)
    if (match === null) continue
    for (const sha of [match[1], match[2]]) if (!NULL_SHA.test(sha)) blobs.add(sha)
  }
  if (blobs.size === 0) return []
  const jobs = new Set()
  const batch = runGit(store, ["cat-file", "--batch"], `${[...blobs].join("\n")}\n`)
  let at = 0
  while (at < batch.length) {
    const headerEnd = batch.indexOf(0x0a, at)
    const [, type, size] = batch.subarray(at, headerEnd).toString("utf8").split(" ")
    const bodyStart = headerEnd + 1
    const body = batch.subarray(bodyStart, bodyStart + Number(size)).toString("utf8")
    at = bodyStart + Number(size) + 1
    if (type !== "blob") continue
    let facts
    try {
      facts = JSON.parse(body)
    } catch {
      continue
    }
    for (const entry of Array.isArray(facts?.jobs) ? facts.jobs : []) if (typeof entry?.job === "string" && JOB_ID.test(entry.job)) jobs.add(entry.job)
  }
  return [...jobs].sort()
}

/** Writes a retired page for each historical job with no report in `<out>/jobs`. Returns `{ reported, retired }` (counts). */
export function writeRetiredPages({ store, out, runGit = git }) {
  const jobsDir = path.join(out, "jobs")
  if (!existsSync(jobsDir)) throw new Error("retired-job-pages: the reports folder has no jobs/ folder; build the reports first")
  const reported = new Set(readdirSync(jobsDir).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3)))
  let retired = 0
  for (const job of historicalJobs(store, runGit)) {
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

export function main({ argv = process.argv.slice(2), write = (text) => process.stdout.write(text), logError = (text) => process.stderr.write(text) } = {}) {
  const options = parseArgs(argv)
  const store = options?.get("store")
  const out = options?.get("out")
  if (options === null || store === undefined || out === undefined || options.size !== 2) {
    logError("Usage: retired-job-pages.mjs --store <store checkout> --out <reports folder>\n")
    return 1
  }
  try {
    write(`${JSON.stringify(writeRetiredPages({ store, out }))}\n`)
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
  process.exitCode = main()
}
