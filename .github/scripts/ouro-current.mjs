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
//   - what merging the head into the base lands (`git merge-tree`, over every
//     merge base, as GitHub merges it) adds, modifies or deletes regular files
//     only, and every path is `.github/ouro-hx-installed.json` or a file the
//     record lists at the base or in that merge;
//   - every file the merged record lists, and every file that changes, is
//     under an install root of the base's record: a listed path up to its
//     first `ouro` folder (`lib/ouro/`, `site/src/ouro/`). The roots come from
//     the base only. Nothing under `.github/` or a data path is a root.
//   - `ouro-check.json` may change only by adding `known` entries under a rule
//     that the update's release adds: a rule listed in
//     `registry/ouro/check/new-rules.json` at the record's new tag and not at
//     its old one. Every other key stays as it is, no entry or rule leaves
//     `known`, and an entry under a rule the old tag lists is refused. The
//     rule lists are read from ourostack/ouro-ui by `main`, at the two tags, so
//     `checkOuroCurrent` itself reads nothing but Git blobs.
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
//   ouro_current_known              an ouro-check.json change other than new-rule entries
//   ouro_current_empty              the pull request changes nothing
//   ouro_current_conflict           the head does not merge cleanly
//   ouro_current_check_unavailable  the snapshot, the commits or the rule lists could not be read
// The exit status is 0 only for `ok`.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { pathToFileURL } from "node:url"

export const OURO_CURRENT = Object.freeze({ login: "ouro-current[bot]", id: 357084126, type: "Bot", branch: "ouro-current/update" })
export const RECORD = ".github/ouro-hx-installed.json"
const CHECK = "ouro-check.json"
const GIT_REF = /^[0-9a-f]{40}$/u
const DIGEST = /^[0-9a-f]{64}$/u
const TAG = /^v\d+\.\d+\.\d+$/u
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

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

// The `tag` the record at `ref` names, or null.
function recordTag(runGit, ref) {
  try {
    const tag = JSON.parse(runGit(["cat-file", "blob", `${ref}:${RECORD}`]))?.tag
    return typeof tag === "string" ? tag : null
  } catch {
    return null
  }
}

// An object of lists, each a set of distinct strings.
const knownLists = (known) => isObject(known) && Object.values(known).every((list) => {
  return Array.isArray(list) && list.every((e) => typeof e === "string") && new Set(list).size === list.length
})

// The codes for a change to ouro-check.json: nothing but entries added to `known`,
// and only under the rules this update's release adds. Null when the rule lists
// it needs were not supplied.
function knownCodes({ runGit, base, tree, newRules }) {
  const read = (ref) => {
    try {
      const value = JSON.parse(runGit(["cat-file", "blob", `${ref}:${CHECK}`]))
      return isObject(value) ? value : null
    } catch {
      return null
    }
  }
  const before = read(base)
  const after = read(tree)
  if (!before || !after) return ["ouro_current_known"]
  const { known: was = {}, ...rest } = before
  const { known: now = {}, ...others } = after
  if (!isDeepStrictEqual(rest, others) || !knownLists(was) || !knownLists(now)) return ["ouro_current_known"]
  // Nothing leaves `known`: no rule and no entry.
  for (const [rule, entries] of Object.entries(was)) {
    if (!Object.hasOwn(now, rule) || !entries.every((entry) => now[rule].includes(entry))) return ["ouro_current_known"]
  }
  const fresh = (rule, entry) => !(Object.hasOwn(was, rule) && was[rule].includes(entry))
  const added = Object.entries(now).filter(([rule, entries]) => entries.some((entry) => fresh(rule, entry)))
  if (added.length === 0) return []
  if (!newRules?.base || !newRules?.head) return null
  // A rule is new when the new tag lists it and the old one did not. A finding of a rule the old tag lists is a regression, so it fails.
  const isNew = ([rule]) => newRules.head.includes(rule) && !newRules.base.includes(rule)
  return added.every(isNew) ? [] : ["ouro_current_known"]
}

export function checkOuroCurrent({ base, head, snapshot, runGit = git, newRules }) {
  const unavailable = fail("ouro_current_check_unavailable")
  if (!snapshot || typeof snapshot !== "object") return unavailable
  const identity = isOuroCurrent(snapshot)
  if (identity) return fail(identity)
  if (!GIT_REF.test(base ?? "") || !GIT_REF.test(head ?? "")) return unavailable

  // What merging the head lands, as GitHub merges it (every merge base, not
  // the one `base...head` picks), so a head cannot revert a path unseen.
  let tree
  try {
    tree = runGit(["merge-tree", "--write-tree", base, head]).trim()
  } catch (error) {
    return error?.status === 1 ? fail("ouro_current_conflict") : unavailable
  }
  if (!GIT_REF.test(tree)) return unavailable
  let entries
  try {
    const fields = runGit(["diff", "--no-renames", "--name-status", "-z", base, tree]).split("\0")
    if (fields.pop() !== "") return unavailable
    if (fields.length % 2 !== 0) return unavailable
    entries = []
    for (let i = 0; i < fields.length; i += 2) entries.push({ status: fields[i], path: fields[i + 1] })
  } catch {
    return unavailable
  }
  if (entries.length === 0) return fail("ouro_current_empty")

  const before = listed(runGit, base)
  const after = listed(runGit, tree)
  if (!before || !after) return fail("ouro_current_record")
  const roots = new Set([...before].map(rootOf).filter(Boolean))
  const underRoot = (path) => [...roots].some((root) => path.startsWith(root))
  if (roots.size === 0 || ![...after].every(underRoot)) return fail("ouro_current_path")

  const codes = new Set()
  let knownChanged = false
  for (const { status, path } of entries) {
    if (!safePath(path)) codes.add("ouro_current_path")
    else if (path === RECORD) {
      if (status !== "M") codes.add("ouro_current_change")
    } else if (path === CHECK) {
      if (status !== "M") codes.add("ouro_current_change")
      else knownChanged = true
    } else if (!underRoot(path) || !(before.has(path) || after.has(path))) codes.add("ouro_current_path")
    else if (status !== "A" && status !== "M" && status !== "D") codes.add("ouro_current_change")
  }
  if (knownChanged) {
    const found = knownCodes({ runGit, base, tree, newRules })
    // Without the rule lists the change can be judged neither way; a refusal already found stands on its own.
    if (found) for (const code of found) codes.add(code)
    else if (codes.size === 0) return unavailable
  }
  if (codes.size === 0) {
    // Every file the merge keeps must be a regular file: no symlink, no submodule.
    for (const { status, path } of entries) {
      if (status === "D") continue
      let entry
      try {
        entry = runGit(["ls-tree", "-z", tree, "--", path])
      } catch {
        return unavailable
      }
      if (!/^100(644|755) blob [0-9a-f]{40}\t/u.test(entry) || entry !== `${entry.split("\t")[0]}\t${path}\0`) codes.add("ouro_current_change")
    }
  }
  return { ok: codes.size === 0, codes: [...codes].sort() }
}

// The file's text, or null for a 404. Any other failure throws.
async function fetchRaw(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return response.text()
}

// The rules a release lists as new, or null when they cannot be read. A 404 is
// `missing`: an empty list for the base's release, which may predate the file.
// A value that is not a release tag is never fetched.
async function newRulesAt(tag, fetchText, missing) {
  if (typeof tag !== "string" || !TAG.test(tag)) return null
  let text
  try {
    text = await fetchText(`https://raw.githubusercontent.com/ourostack/ouro-ui/${tag}/registry/ouro/check/new-rules.json`)
  } catch {
    return null
  }
  if (text === null) return missing
  let list
  try {
    list = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(list) || !list.every((entry) => isObject(entry) && typeof entry.rule === "string")) return null
  return list.map((entry) => entry.rule)
}

// The rule lists a change to ouro-check.json needs, at the base's tag and at the
// tag the merge lands. Undefined when the change does not touch that file, so
// nothing is fetched; an identity or ref that fails is left for the check to refuse.
async function ruleListsFor({ base, head, snapshot, runGit, fetchText }) {
  if (!isObject(snapshot) || isOuroCurrent(snapshot) || !GIT_REF.test(base ?? "") || !GIT_REF.test(head ?? "")) return undefined
  let tree
  try {
    tree = runGit(["merge-tree", "--write-tree", base, head]).trim()
    if (runGit(["diff", "--name-only", "-z", base, tree, "--", CHECK]) === "") return undefined
  } catch {
    return undefined
  }
  return {
    base: await newRulesAt(recordTag(runGit, base), fetchText, []),
    head: await newRulesAt(recordTag(runGit, tree), fetchText, null),
  }
}

export async function main({ argv = process.argv.slice(2), write = (text) => process.stdout.write(text), runGit = git, fetchText = fetchRaw } = {}) {
  const [base, head, file] = argv
  let snapshot = null
  try {
    snapshot = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    snapshot = null
  }
  const newRules = await ruleListsFor({ base, head, snapshot, runGit, fetchText })
  const { ok, codes } = checkOuroCurrent({ base, head, snapshot, runGit, newRules })
  if (ok) write("ok\n")
  else for (const code of codes) write(`${code}\n`)
  return ok ? 0 : 1
}

if (typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
