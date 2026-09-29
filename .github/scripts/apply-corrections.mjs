#!/usr/bin/env node
// Applies every correction record in a store checkout to the matching facts
// file on disk, in place. Usage:
//
//   node apply-corrections.mjs --store <store directory>
//
// This never touches Git: it only rewrites files already on disk in the
// checkout it is given. Two callers use it that way on purpose. The report
// build (`build.yml`) and the site data build (`pages.yml`) each run it,
// against their own ephemeral checkout, immediately before the step that
// reads `facts/`, so the report and the site always see corrected data no
// matter how many more times a stale client republishes the polluted
// version to `main` in between. (Landing the correction back onto `main`
// itself would need a commit outside a pull request, which this store's
// branch ruleset does not allow even for a maintainer; see the changelog
// entry and the pull request description for why intake cannot rewrite an
// incoming republish's content before it merges.)
//
// It is narrow on purpose: a facts file with no `corrections/<name>.json`
// record is never touched. A correction record that fails
// `validateCorrectionRecord` stops the whole run with a thrown error
// instead of being skipped — an invalid record must never look like "no
// correction to apply", which would silently leave a session's stale data
// standing, or like "apply it anyway", which would silently write
// unvalidated data into the store's output. The same is true of a record
// whose target facts file is gone from `facts/`: that is a stale record,
// not "nothing to do", and it stops the run and names the file rather than
// being quietly dropped from the result. Removing a stale record is a
// deliberate edit to `corrections/`, reviewed like any other change there —
// never an inference this script makes on its own.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"

import { applyCorrection, correctionChanges, validateCorrectionRecord } from "./lib/corrections.mjs"

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

export class CorrectionsInvalidError extends Error {
  constructor(problems) {
    super(`apply-corrections: ${problems.length} correction record(s) could not be applied`)
    this.name = "CorrectionsInvalidError"
    this.problems = problems
  }
}

/**
 * `applyCorrectionsToStore({ storeDir, ... }) -> { checked, applied, unchanged }`.
 * `applied`/`unchanged` list facts file names (not paths). Throws
 * `CorrectionsInvalidError` (never returns partial results, never writes
 * anything) when any correction record under `<storeDir>/corrections/`
 * fails schema validation, or when any schema-valid record names a facts
 * file that is not present under `<storeDir>/facts/`.
 */
export function applyCorrectionsToStore({
  storeDir,
  readDir = readdirSync,
  readText = (file) => readFileSync(file, "utf8"),
  writeText = writeFileSync,
  exists = existsSync,
}) {
  const correctionsDir = path.join(storeDir, "corrections")
  const factsDir = path.join(storeDir, "facts")
  const names = exists(correctionsDir) ? readDir(correctionsDir).filter((name) => name.endsWith(".json")).sort() : []

  const records = []
  const problems = []
  for (const name of names) {
    let record
    try {
      record = JSON.parse(readText(path.join(correctionsDir, name)))
    } catch {
      problems.push({ file: name, errors: [{ code: "correction_invalid_json", path: "" }] })
      continue
    }
    const { ok, errors } = validateCorrectionRecord(record, name)
    if (!ok) {
      problems.push({ file: name, errors })
      continue
    }
    records.push(record)
  }
  if (problems.length > 0) throw new CorrectionsInvalidError(problems)

  // A schema-valid record whose target facts file is gone is stale, not
  // "nothing to apply": fail the whole run before writing anything, rather
  // than silently dropping it from the result. Checked as its own pass, so
  // one missing target never lets an earlier record's write happen while a
  // later record's target is still missing.
  const missingProblems = records
    .filter((record) => !exists(path.join(factsDir, record.file)))
    .map((record) => ({ file: record.file, errors: [{ code: "correction_facts_missing", path: record.file }] }))
  if (missingProblems.length > 0) throw new CorrectionsInvalidError(missingProblems)

  const applied = []
  const unchanged = []
  for (const record of records) {
    const factsPath = path.join(factsDir, record.file)
    const current = JSON.parse(readText(factsPath))
    if (!correctionChanges(current, record)) {
      unchanged.push(record.file)
      continue
    }
    const corrected = applyCorrection(current, record)
    writeText(factsPath, `${JSON.stringify(corrected)}\n`)
    applied.push(record.file)
  }

  return { checked: records.length, applied, unchanged }
}

export async function main({ argv = process.argv.slice(2), write = (text) => process.stdout.write(text), logError = (text) => process.stderr.write(text) } = {}) {
  const options = parseArgs(argv)
  const storeDir = options?.get("store")
  if (options === null || storeDir === undefined || options.size !== 1) {
    logError("Usage: apply-corrections.mjs --store <store directory>\n")
    return 1
  }
  try {
    const result = applyCorrectionsToStore({ storeDir })
    write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    if (error instanceof CorrectionsInvalidError) {
      logError(`${error.message}\n`)
      for (const problem of error.problems) {
        for (const item of problem.errors) logError(`corrections/${problem.file}: ${item.code}${item.path ? ` (${item.path})` : ""}\n`)
      }
      return 1
    }
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
