#!/usr/bin/env node
// maintenance-allowlist.mjs <base-sha> <head-sha> <desk-dir>
//
// Decides whether a maintenance pull request may merge without waiting for a
// maintainer. factory-merge calls it only for a pull request Desk's validator
// passed as maintenance, whose head is in this repository (not a fork),
// whose author maintains this repository, and whose factory-validate run
// passed; this script adds the path and schema rules:
//
//   - every change adds or modifies a file, and every path is a correction
//     record (`corrections/<name>.json`) or `factory.json`, nothing else: not
//     `intake.json` (it widens what the store accepts), not `capture.json`
//     (it switches on capture records), not `.github/` (the code that judges
//     intake), not `facts/`, `labels/` or `capture/` mixed in;
//   - every correction record passes `check-corrections.mjs`;
//   - `factory.json` passes Desk main's `parseStoreConfig` (loaded from the
//     Desk clone, never from the candidate).
//
// The candidate's files are read as Git blobs and parsed as data; nothing
// from them is executed or echoed. Output is `ok`, or one stable code per
// line:
//   maintenance_path               a path outside the allowlist
//   maintenance_delete             a deletion (or a rename, which is one)
//   maintenance_change             any other kind of change (a type change)
//   maintenance_empty              the pull request changes nothing
//   maintenance_factory_config     factory.json fails parseStoreConfig
//   correction_*                   check-corrections.mjs's own codes
//   maintenance_check_unavailable  the commits, a blob or Desk's rule could
//                                  not be read
// The exit status is 0 only for `ok`.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { checkCorrections } from "./check-corrections.mjs"

const GIT_REF = /^[0-9a-f]{40}$/u
export const ALLOWLIST = Object.freeze([/^corrections\/[A-Za-z0-9._-]+\.json$/, /^factory\.json$/])

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
}

export async function checkMaintenance({ base, head, runGit = git, parseStoreConfig }) {
  const unavailable = { ok: false, codes: ["maintenance_check_unavailable"] }
  if (!GIT_REF.test(base ?? "") || !GIT_REF.test(head ?? "") || typeof parseStoreConfig !== "function") return unavailable

  let entries
  try {
    const fields = runGit(["diff", "--no-renames", "--name-status", "-z", `${base}...${head}`]).split("\0")
    entries = []
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (fields[i] === "") break
      entries.push({ status: fields[i], path: fields[i + 1] })
    }
  } catch {
    return unavailable
  }
  if (entries.length === 0) return { ok: false, codes: ["maintenance_empty"] }

  const codes = new Set()
  for (const { status, path } of entries) {
    if (!ALLOWLIST.some((re) => re.test(path))) codes.add("maintenance_path")
    else if (status === "D") codes.add("maintenance_delete")
    else if (status !== "A" && status !== "M") codes.add("maintenance_change")
  }
  if (codes.size === 0) {
    if (entries.some((e) => e.path.startsWith("corrections/"))) {
      const corrections = checkCorrections({ base, head, runGit })
      for (const code of corrections.codes) codes.add(code)
    }
    if (entries.some((e) => e.path === "factory.json")) {
      let text
      try {
        text = runGit(["cat-file", "blob", `${head}:factory.json`])
      } catch {
        return unavailable
      }
      let verdict
      try {
        verdict = parseStoreConfig(text)
      } catch {
        verdict = { ok: false }
      }
      if (!verdict || verdict.ok !== true) codes.add("maintenance_factory_config")
    }
  }
  return { ok: codes.size === 0, codes: [...codes].sort() }
}

export async function main({ argv = process.argv.slice(2), write = (text) => process.stdout.write(text) } = {}) {
  const [base, head, desk] = argv
  let parseStoreConfig = null
  const andon = desk ? join(desk, "plugins/desk/mcp/src/factory/pipeline/andon.js") : null
  if (andon && existsSync(andon)) {
    try {
      ;({ parseStoreConfig } = await import(pathToFileURL(andon).href))
    } catch {
      parseStoreConfig = null
    }
  }
  const { ok, codes } = await checkMaintenance({ base, head, parseStoreConfig })
  if (ok) write("ok\n")
  else for (const code of codes) write(`${code}\n`)
  return ok ? 0 : 1
}

if (typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
