#!/usr/bin/env node
// ouro-current.mjs <base-sha> <head-sha> <snapshot.json>
//
// Decides whether a pull request is Ouro Current's update of the Ouro UI files
// this store installs, which may merge without a maintainer so the store stays
// within a day of each Ouro UI release. The snapshot is the trusted workflow's
// own API read, `{ repository, pr }`, never a file of the candidate.
//
//   - the author is the Ouro Current app (`ouro-current[bot]`, a Bot, with its
//     account id): a `[bot]` login is GitHub's own and no person can take it;
//   - the head is the branch `ouro-current/update` in this repository (not a
//     fork);
//   - every change adds, modifies or deletes a regular file, and every path is
//     `.github/ouro-hx-installed.json` or a file the record lists at the base
//     or at the head;
//   - every file the head's record lists, and every file that changes, is
//     under an install root of the base's record: a listed path up to its
//     first `ouro` folder (`lib/ouro/`, `site/src/ouro/`). The roots come from
//     the base only. Nothing under `.github/` or a data path is a root.
//
// The candidate's files are read as Git blobs and parsed as data; nothing
// from them is executed or echoed. The installed files' digests are checked by
// `ouro-hx-installed.test.mjs`, in the pull request's own tests. Output is
// `ok`, or one stable code per line:
//   ouro_current_author             the author is not the Ouro Current app
//   ouro_current_head               a fork, or a branch other than its own
//   ouro_current_path               a path that is not an installed file
//   ouro_current_change             a type change, or a file that is not regular
//   ouro_current_record             the record is missing or malformed
//   ouro_current_empty              the pull request changes nothing
//   ouro_current_check_unavailable  the snapshot or the commits could not be read
// The exit status is 0 only for `ok`.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const OURO_CURRENT = Object.freeze({ login: "ouro-current[bot]", id: 357084126, type: "Bot", branch: "ouro-current/update" })
export const RECORD = ".github/ouro-hx-installed.json"
const GIT_REF = /^[0-9a-f]{40}$/u
const DIGEST = /^[0-9a-f]{64}$/u
// Never a root: the code that judges intake and every data path.
const NOT_ROOT = new Set([".github", "facts", "labels", "capture", "triage", "context", "corrections"])

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
}

const fail = (code) => ({ ok: false, codes: [code] })

export function isOuroCurrent(snapshot) {
  const pr = snapshot?.pr
  const user = pr?.user
  if (user?.login !== OURO_CURRENT.login || user?.type !== OURO_CURRENT.type || user?.id !== OURO_CURRENT.id) return "ouro_current_author"
  if (typeof snapshot.repository !== "string" || pr?.head?.repo?.full_name !== snapshot.repository || pr?.head?.ref !== OURO_CURRENT.branch) {
    return "ouro_current_head"
  }
  return null
}

// A plain relative path: no empty, `.` or `..` segment, no control character.
function safePath(path) {
  return typeof path === "string" && !/[\u0000-\u001f\u007f\\]/u.test(path) && path.split("/").every((s) => s !== "" && s !== "." && s !== "..")
}

// The listed files of the record at `ref`, or null when it is missing or malformed.
function listed(runGit, ref) {
  let record
  try {
    record = JSON.parse(runGit(["cat-file", "blob", `${ref}:${RECORD}`]))
  } catch {
    return null
  }
  const files = record?.files
  if (!files || typeof files !== "object" || Array.isArray(files)) return null
  const paths = Object.keys(files)
  if (paths.length === 0 || !paths.every((p) => safePath(p) && typeof files[p] === "string" && DIGEST.test(files[p]))) return null
  return new Set(paths)
}

function rootOf(path) {
  const segments = path.split("/")
  const at = segments.indexOf("ouro")
  if (at < 1 || at === segments.length - 1 || NOT_ROOT.has(segments[0])) return null
  return `${segments.slice(0, at + 1).join("/")}/`
}

export function checkOuroCurrent({ base, head, snapshot, runGit = git }) {
  const unavailable = fail("ouro_current_check_unavailable")
  if (!snapshot || typeof snapshot !== "object") return unavailable
  const identity = isOuroCurrent(snapshot)
  if (identity) return fail(identity)
  if (!GIT_REF.test(base ?? "") || !GIT_REF.test(head ?? "")) return unavailable

  let entries
  try {
    const fields = runGit(["diff", "--no-renames", "--name-status", "-z", `${base}...${head}`]).split("\0")
    if (fields.pop() !== "") return unavailable
    if (fields.length % 2 !== 0) return unavailable
    entries = []
    for (let i = 0; i < fields.length; i += 2) entries.push({ status: fields[i], path: fields[i + 1] })
  } catch {
    return unavailable
  }
  if (entries.length === 0) return fail("ouro_current_empty")

  const before = listed(runGit, base)
  const after = listed(runGit, head)
  if (!before || !after) return fail("ouro_current_record")
  const roots = new Set([...before].map(rootOf).filter(Boolean))
  const underRoot = (path) => [...roots].some((root) => path.startsWith(root))
  if (roots.size === 0 || ![...after].every(underRoot)) return fail("ouro_current_path")

  const codes = new Set()
  for (const { status, path } of entries) {
    if (!safePath(path)) codes.add("ouro_current_path")
    else if (path === RECORD) {
      if (status !== "M") codes.add("ouro_current_change")
    } else if (!underRoot(path) || !(before.has(path) || after.has(path))) codes.add("ouro_current_path")
    else if (status !== "A" && status !== "M" && status !== "D") codes.add("ouro_current_change")
  }
  if (codes.size === 0) {
    // Every file the head keeps must be a regular file: no symlink, no submodule.
    for (const { status, path } of entries) {
      if (status === "D") continue
      let entry
      try {
        entry = runGit(["ls-tree", "-z", head, "--", path])
      } catch {
        return unavailable
      }
      if (!/^100(644|755) blob [0-9a-f]{40}\t/u.test(entry) || entry !== `${entry.split("\t")[0]}\t${path}\0`) codes.add("ouro_current_change")
    }
  }
  return { ok: codes.size === 0, codes: [...codes].sort() }
}

export function main({ argv = process.argv.slice(2), write = (text) => process.stdout.write(text), runGit = git } = {}) {
  const [base, head, file] = argv
  let snapshot = null
  try {
    snapshot = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    snapshot = null
  }
  const { ok, codes } = checkOuroCurrent({ base, head, snapshot, runGit })
  if (ok) write("ok\n")
  else for (const code of codes) write(`${code}\n`)
  return ok ? 0 : 1
}

if (typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
