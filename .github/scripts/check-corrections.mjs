#!/usr/bin/env node
// check-corrections.mjs <base-sha> <head-sha>
//
// The store's own intake rule on correction records, the schema gate for
// `corrections/*.json` (`validateCorrectionRecord` in `lib/corrections.mjs`).
// Every `corrections/` file a pull request adds or modifies must parse as
// JSON and pass that schema; a malformed record fails this check loudly
// instead of merging silently. Mirrors `check-intake-plugins.sh`'s contract
// on purpose: run from the base checkout, read the candidate's files as Git
// blobs (never executed, never checked out), print one stable code per line
// on failure and nothing on success, exit 0 when every added or modified
// `corrections/` file passes.
//
//   correction_invalid_json    a corrections/ file is not parseable JSON
//   correction_path_invalid    a corrections/ path is not corrections/<name>.json
//   correction_*               validateCorrectionRecord's own codes (see lib/corrections.mjs)
//   corrections_check_unavailable  the two commits or a blob could not be read
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import { validateCorrectionRecord } from "./lib/corrections.mjs"

const GIT_REF = /^[0-9a-f]{40}$/u
const CORRECTIONS_PATH = /^corrections\/([^/]+\.json)$/u

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
}

export function checkCorrections({ base, head, runGit = git }) {
  if (!GIT_REF.test(base) || !GIT_REF.test(head)) return { ok: false, codes: ["corrections_check_unavailable"] }

  let added
  try {
    added = runGit(["diff", "--no-renames", "--name-only", "--diff-filter=AM", "-z", `${base}...${head}`, "--", "corrections/"])
      .split("\0")
      .filter((entry) => entry !== "")
  } catch {
    return { ok: false, codes: ["corrections_check_unavailable"] }
  }

  const codes = new Set()
  for (const filePath of added) {
    const match = CORRECTIONS_PATH.exec(filePath)
    if (match === null) {
      codes.add("correction_path_invalid")
      continue
    }
    let blob
    try {
      blob = runGit(["cat-file", "blob", `${head}:${filePath}`])
    } catch {
      codes.add("corrections_check_unavailable")
      continue
    }
    let record
    try {
      record = JSON.parse(blob)
    } catch {
      codes.add("correction_invalid_json")
      continue
    }
    const { ok, errors } = validateCorrectionRecord(record, match[1])
    if (!ok) for (const error of errors) codes.add(error.code)
  }

  return { ok: codes.size === 0, codes: [...codes].sort() }
}

export function main({ argv = process.argv.slice(2), write = (text) => process.stdout.write(text) } = {}) {
  const [base, head] = argv
  const { ok, codes } = checkCorrections({ base, head })
  for (const code of codes) write(`${code}\n`)
  return ok ? 0 : 1
}

function isMainModule(importMetaUrl, argv1) {
  if (typeof argv1 !== "string") return false
  return importMetaUrl === pathToFileURL(argv1).href
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = main()
}
