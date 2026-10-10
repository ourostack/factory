// Self-contained public-only mirror of released Desk triage-schema.js.
// No runtime/card imports, candidate prose, or permission inferred from data.
// Desk parity is a maintained required-table gate, not a production dependency.
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const TRIAGE_PATH = /^triage\/[0-9a-f]{16}\.json$/u
export const TRIAGE_RUNNER_STATES = Object.freeze([
  "ran", "no_agent_cli", "unsupported_host", "no_credentials", "disabled_would_bill",
  "sign_in_unknown", "scope_unqualified", "scope_changed", "timeout", "budget_exceeded",
  "failed", "headless_session", "no_time_for_a_run",
])
const SOURCES = ["andon", "friction_candidate", "reconcile_class", "desk_problem", "store_build", "evaluator", "loop_alarm", "flush_health"]
const LIFECYCLES = ["open", "claimed", "shipped", "verifying", "closed_confirmed", "closed_unverified"]
const ROUTES = ["agent_ready", "investigate", "human_decision"]
const GATES = ["intent", "scope", "approval", "voice", "spend", "account", "irreversible"]
const AGE = ["recent", "aging", "stale", "never", "unknown"]
const HEX32 = /^[0-9a-f]{32}$/u
const HEX16 = /^[0-9a-f]{16}$/u
const SHA = /^[0-9a-f]{40}$/u
const MAX_BYTES = 20 * 16384 + 4096
const REPO = "[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}"
const POINTERS = {
  issue: new RegExp(`^https://github\\.com/${REPO}/issues/[1-9][0-9]{0,9}$`, "u"),
  pr: new RegExp(`^https://github\\.com/${REPO}/pull/[1-9][0-9]{0,9}$`, "u"),
  job: new RegExp(`^https://github\\.com/${REPO}/blob/reports/jobs/[0-9a-f]{32}\\.md$`, "u"),
}
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const codesOf = (codes) => ({ ok: codes.length === 0, codes: [...new Set(codes)].sort() })
const fail = (code) => codesOf([code])

// Exact credential.js rules. Fixed random IDs are not free-token fields.
function credentialLike(value) {
  if (/^(ghp_|gho_|ghs_|ghu_|ghr_|github_pat_|sk-)/iu.test(value)) return true
  return [value, value.replace(/\.[A-Za-z0-9]{1,10}$/u, "")].some((candidate) => {
    const words = candidate.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean)
    if (words.some((w) => w.length >= 16 && (/^[0-9a-f]+$/u.test(w) || (/[0-9]/u.test(w) && /[a-z]/u.test(w))))) return true
    if (words.some((w, i) => i + 1 < words.length && ["pw", "pwd", "passwd"].includes(w))) return true
    return words.some((_, i) => i + 4 <= words.length && words.slice(i, i + 4).every((w) => /^\d{1,3}$/u.test(w) && Number(w) <= 255))
  })
}
const shapeCode = (v) => /\d{4}-\d{2}-\d{2}/u.test(v) ? "date" : /\d{2}:\d{2}/u.test(v) ? "time" : null
const enumeration = (allowed) => (v, c) => {
  if (typeof v !== "string") c.push("type")
  else if (!allowed.includes(v)) c.push("enum")
}
const pattern = (re, publicShape = false) => (v, c) => {
  if (typeof v !== "string") c.push("type")
  else if (!re.test(v)) c.push("pattern")
  else if (publicShape && shapeCode(v)) c.push(shapeCode(v))
}
const integer = (min) => (v, c) => { if (!Number.isSafeInteger(v) || v < min) c.push("range") }
const nullable = (check) => (v, c) => { if (v !== null) check(v, c) }
const boolean = (v, c) => { if (typeof v !== "boolean") c.push("type") }
const object = (spec, post) => (v, c) => {
  if (!plain(v)) { c.push("type"); return }
  for (const k of Object.keys(v)) if (!Object.hasOwn(spec, k)) c.push("unknown_key")
  for (const [k, check] of Object.entries(spec)) {
    if (!Object.hasOwn(v, k)) c.push("missing")
    else check(v[k], c)
  }
  if (post) post(v, c)
}
const list = (check, max) => (v, c) => {
  if (!Array.isArray(v)) c.push("type")
  else if (v.length > max) c.push("too_many")
  else for (const item of v) check(item, c)
}
const version = (v, c) => {
  if (typeof v === "string" && v.length > 64) { c.push("size"); return }
  const before = c.length
  pattern(/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]{1,32})?$/u, true)(v, c)
  if (c.length === before && credentialLike(v)) c.push("credential_like")
}
const evidence = (v, c) => object({
  kind: enumeration(["issue", "pr", "job"]),
  ref: (ref, errors) => {
    const re = POINTERS[v?.kind]
    if (!re) { errors.push("pattern"); return }
    const before = errors.length
    pattern(re, true)(ref, errors)
    if (errors.length === before) {
      const [, owner, repo] = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\//u.exec(ref)
      if (credentialLike(owner) || credentialLike(repo)) errors.push("credential_like")
    }
  },
  revision: integer(1),
})(v, c)
const evidenceList = list(evidence, 16)
const basis = object({ generation: pattern(HEX32), evidence_revisions: evidenceList })
const row = (v, c) => {
  if (Buffer.byteLength(JSON.stringify(v)) > 16384) { c.push("size"); return }
  object({
    id: pattern(HEX32), revision: integer(1),
    state: enumeration(["reviewed", "stale", "withdrawn", "source_unknown"]),
    source: enumeration(SOURCES), lifecycle: nullable(enumeration(LIFECYCLES)),
    ownership: enumeration(["claimed", "not_published"]), route: nullable(enumeration(ROUTES)),
    gate: nullable(enumeration(GATES)), evidence: evidenceList, basis,
    related_ids: list(pattern(HEX32), 16), duplicate_ids: list(pattern(HEX32), 16),
    age: enumeration(AGE), producer_version: version, rubric_version: integer(1),
  }, (r, codes) => {
    if ((r.state === "reviewed" && r.route === null) ||
        (r.state === "withdrawn" && (r.route !== null || r.gate !== null)) ||
        (r.route === "human_decision" ? r.gate === null : r.gate !== null)) codes.push("inconsistent")
  })(v, c)
}
const envelope = object({
  schema: enumeration(["desk.factory.triage/1"]), batch: pattern(HEX16),
  producer_version: version, rubric_version: integer(1),
  coverage: object({
    generation: pattern(HEX32), scan: enumeration(["complete", "truncated", "unreadable"]),
    reviewed: nullable(integer(0)), unreviewed: nullable(integer(0)), refused: nullable(integer(0)),
    deferred: nullable(integer(0)), more_unreviewed: nullable(boolean),
  }),
  runner: object({ state: enumeration(TRIAGE_RUNNER_STATES), last_success_age: enumeration(AGE) }),
  rows: list(row, 20),
})

export function validateTriageValues(bytes) {
  if (typeof bytes !== "string" && !Buffer.isBuffer(bytes)) return fail("type")
  if (Buffer.byteLength(bytes) > MAX_BYTES) return fail("size")
  let value
  const text = bytes.toString()
  try { value = JSON.parse(text) } catch { return fail("json") }
  const canonical = JSON.stringify(value)
  if (text !== canonical && text !== canonical + "\n") return fail("canonical")
  const codes = []
  envelope(value, codes)
  if (Array.isArray(value?.rows) && value.rows.length <= 20) {
    const seen = new Set()
    for (const r of value.rows) {
      if (typeof r?.id !== "string" || !HEX32.test(r.id)) continue
      if (seen.has(r.id)) codes.push("duplicate")
      seen.add(r.id)
    }
  }
  return codesOf(codes)
}

export function validateTriageChangeValues({ path, status, bytes, previousBytes, trustedMaintainer } = {}) {
  const codes = []
  if (typeof path !== "string" || !TRIAGE_PATH.test(path)) codes.push("path")
  if (status !== "added" || previousBytes !== undefined) codes.push("triage_immutable")
  if (trustedMaintainer !== true) codes.push(trustedMaintainer === false ? "triage_untrusted_producer" : "triage_authority_check_unavailable")
  if (codes.length) return codesOf(codes)
  const result = validateTriageValues(bytes)
  if (!result.ok) return result
  if (`triage/${JSON.parse(bytes.toString()).batch}.json` !== path) codes.push("triage_batch_mismatch")
  return codesOf(codes)
}

const runGit = (dir, args) => execFileSync("git", ["-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024,
})
const triagePrefix = (p) => p === "triage" || p.startsWith("triage/")
function treeEntry(dir, ref, path) {
  const raw = runGit(dir, ["ls-tree", "-z", ref, "--", path])
  if (raw === "") return null
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)\0$/u.exec(raw)
  return match && match[3] === path ? { regular: true } : { regular: false }
}

// Reads Git objects only. merge-tree lands exactly what Desk validates, without
// checking out or executing candidate files. Copies require byte identity;
// similar higher-revision correction additions are NOT mutations.
export function checkTriageGit({ base, head, trustedMaintainer, dir = process.cwd() }) {
  try {
    if (!SHA.test(base ?? "") || !SHA.test(head ?? "")) return fail("triage_check_unavailable")
    const tree = runGit(dir, ["merge-tree", "--write-tree", base, head]).trim()
    if (!SHA.test(tree)) return fail("triage_check_unavailable")
    const fields = runGit(dir, ["diff", "--name-status", "-z", "--find-renames", "-C100%", "--find-copies-harder", base, tree]).split("\0")
    if (fields.pop() !== "") return fail("triage_check_unavailable")
    const changes = new Map()
    for (let i = 0; i < fields.length;) {
      const code = fields[i++], from = fields[i++]
      if (!code || from === undefined) return fail("triage_check_unavailable")
      if (/^[RC][0-9]+$/u.test(code)) {
        const to = fields[i++]
        if (to === undefined) return fail("triage_check_unavailable")
        for (const p of [from, to]) if (triagePrefix(p)) changes.set(p, code[0] === "R" ? "renamed" : "copied")
      } else if (triagePrefix(from)) changes.set(from, ({ A: "added", M: "modified", D: "removed", T: "type_changed" })[code] ?? "unknown")
    }
    const codes = []
    for (const [path, status] of changes) {
      if (!TRIAGE_PATH.test(path)) { codes.push("path"); continue }
      const previous = treeEntry(dir, base, path)
      const current = treeEntry(dir, tree, path)
      const change = {
        path, status: status === "added" && current?.regular !== true ? "type_changed" : status,
        trustedMaintainer,
        ...(previous !== null ? { previousBytes: previous.regular ? runGit(dir, ["cat-file", "blob", `${base}:${path}`]) : null } : {}),
        ...(current?.regular === true ? { bytes: runGit(dir, ["cat-file", "blob", `${tree}:${path}`]) } : {}),
      }
      codes.push(...validateTriageChangeValues(change).codes)
    }
    return codesOf(codes)
  } catch { return fail("triage_check_unavailable") }
}

// Main-only reader. Working bytes must be the committed regular Git blob.
// Failure is explicit and content-free; malformed/unreadable is never absence.
export function readTriageBatches(dir) {
  const root = join(dir, "triage")
  if (!existsSync(root)) {
    try {
      if (runGit(dir, ["ls-tree", "HEAD", "--", "triage"]).trim() !== "") throw new Error("triage_read_unavailable")
    } catch {
      // A verified newly initialized store has no accepted batches yet.
      // Failed/missing Git or an unreadable populated history is NOT absence.
      try {
        if (runGit(dir, ["rev-list", "--all", "--count"]).trim() !== "0") throw new Error("triage_read_unavailable")
      } catch { throw new Error("triage_read_unavailable") }
    }
    return []
  }
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("triage_read_unavailable")
  const names = readdirSync(root).sort()
  const tracked = runGit(dir, ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", "triage"]).split("\0").filter(Boolean).sort()
  if (JSON.stringify(tracked) !== JSON.stringify(names.map((n) => `triage/${n}`))) throw new Error("triage_read_unavailable")
  return names.map((name) => {
    const path = `triage/${name}`, full = join(root, name)
    if (!TRIAGE_PATH.test(path) || !lstatSync(full).isFile() || lstatSync(full).isSymbolicLink()) throw new Error("triage_path")
    const entry = treeEntry(dir, "HEAD", path)
    if (entry?.regular !== true) throw new Error("triage_read_unavailable")
    const bytes = runGit(dir, ["cat-file", "blob", `HEAD:${path}`])
    if (!readFileSync(full).equals(Buffer.from(bytes))) throw new Error("triage_read_unavailable")
    const result = validateTriageValues(bytes)
    if (!result.ok) throw new Error("triage_invalid")
    if (`triage/${JSON.parse(bytes).batch}.json` !== path) throw new Error("triage_batch_mismatch")
    let committedAtMs = null
    try {
      const seconds = Number(runGit(dir, ["log", "-1", "--diff-filter=A", "--format=%ct", "HEAD", "--", path]).trim())
      if (Number.isSafeInteger(seconds) && seconds > 0) committedAtMs = seconds * 1000
    } catch { /* Unknown publication age stays unknown. */ }
    return { path, bytes, committedAtMs }
  })
}

// Released Desk CLI already has an injected runner seam. Supply only the
// successful API responses captured by the trusted workflow's token step.
// This keeps the subsequent Git/blob validation step token-free. This file is
// runner-temp trusted metadata, NEVER a PR file or a candidate-provided grant.
// A final *live* actor/head/permission read in the workflow guards action.
export async function validateWithDeskSnapshot({ desk, argv, snapshot }) {
  const repo = argv[argv.indexOf("--repo") + 1]
  const pr = argv[argv.indexOf("--pr") + 1]
  const head = argv[argv.indexOf("--head") + 1]
  let metadata
  try {
    // The caller is the trusted base workflow. Accept ONLY its protected
    // runner-temp artifact, never a candidate path, symlink, or writable file.
    const root = process.env.RUNNER_TEMP
    const st = lstatSync(snapshot)
    if (!root || ![join(root, "triage-api.json"), join(root, `triage-api-${pr}.json`)].includes(resolve(snapshot)) ||
        dirname(realpathSync(snapshot)) !== realpathSync(root) || st.isSymbolicLink() || !st.isFile() ||
        (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid())) throw new Error("untrusted_snapshot")
    metadata = JSON.parse(readFileSync(snapshot, "utf8"))
  } catch { metadata = null }
  const valid = metadata?.pr?.head?.sha === head && metadata?.pr?.number === Number(pr) &&
    typeof metadata?.pr?.user?.login === "string" && metadata.repository === repo
  const runner = async (args) => {
    if (!valid || args[0] !== "api") return { code: 1, stdout: "" }
    if (args[1] === `repos/${repo}/pulls/${pr}`) return { code: 0, stdout: JSON.stringify(metadata.pr) }
    if (args[1] === `repos/${repo}/collaborators/${encodeURIComponent(metadata.pr.user.login)}/permission` &&
        metadata.permission !== null) return { code: 0, stdout: JSON.stringify(metadata.permission) }
    return { code: 1, stdout: "" }
  }
  const { runValidatePrCommand } = await import(pathToFileURL(join(desk, "plugins/desk/mcp/scripts/factory.js")))
  return runValidatePrCommand({ argv, runner, env: {} })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, a, b, authority] = process.argv.slice(2)
  let result
  if (mode === "--validate-pr") {
    try {
      const answer = await validateWithDeskSnapshot({ desk: a, snapshot: b, argv: process.argv.slice(5) })
      console.log(JSON.stringify(answer))
      process.exitCode = answer.ok ? 0 : 1
    } catch { console.log(JSON.stringify({ unavailable: "triage_check_unavailable" })); process.exitCode = 1 }
  } else {
  if (mode === "--check-change") result = checkTriageGit({
    base: a, head: b, trustedMaintainer: authority === "true" ? true : authority === "false" ? false : undefined,
  })
  else if (mode === "--store" && a && !b) {
    try { readTriageBatches(a); result = codesOf([]) } catch { result = fail("triage_read_unavailable") }
  } else result = fail("triage_check_unavailable")
  if (!result.ok) console.log(result.codes.join("\n"))
  process.exitCode = result.ok ? 0 : 1
  }
}
