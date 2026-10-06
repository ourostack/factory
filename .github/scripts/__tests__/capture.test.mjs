import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

const SCRIPT = new URL("../check-capture.sh", import.meta.url).pathname
const WORKFLOWS = new URL("../../workflows/", import.meta.url).pathname

const ID = "0123456789abcdef"
const host = { on_disk: 3, derived: 1, held: 0, frozen: 0, pending: 0, not_seen: 2, not_in_a_desk: 0, unverified: false }
const valid = { schema: "desk.factory.capture/1", basis: "still_on_disk", hosts: { "claude-code": host } }

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
}

// A repository with one base commit and one head commit that writes `files`.
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "capture-check-"))
  git(dir, "init", "-q")
  git(dir, "config", "user.email", "x@example.com")
  git(dir, "config", "user.name", "x")
  writeFileSync(join(dir, "README.md"), "x\n")
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "base")
  const base = git(dir, "rev-parse", "HEAD")
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === "string" ? content : `${JSON.stringify(content)}\n`)
  }
  git(dir, "add", ".")
  git(dir, "commit", "-q", "--allow-empty", "-m", "head")
  return { dir, base, head: git(dir, "rev-parse", "HEAD") }
}

function check(files) {
  const r = repo(files)
  const out = spawnSync("bash", [SCRIPT, r.base, r.head], { cwd: r.dir, encoding: "utf8" })
  return { status: out.status, codes: out.stdout.split("\n").filter(Boolean) }
}

test("a pull request with no capture file passes", () => {
  assert.deepEqual(check({ "facts/claude-code-s1.json": { x: 1 } }), { status: 0, codes: [] })
})

test("a valid record passes, with and without the optional loop slot", () => {
  assert.deepEqual(check({ [`capture/${ID}.json`]: valid }), { status: 0, codes: [] })
  assert.deepEqual(check({ [`capture/${ID}.json`]: { ...valid, loop: { v: 1 } } }), { status: 0, codes: [] })
  assert.deepEqual(check({ [`capture/${ID}.json`]: { ...valid, hosts: {} } }), { status: 0, codes: [] })
})

test("a record with an extra key at the top level fails as capture_keys", () => {
  assert.deepEqual(check({ [`capture/${ID}.json`]: { ...valid, when: "x" } }), { status: 1, codes: ["capture_keys"] })
  const missing = { ...valid }
  delete missing.basis
  assert.deepEqual(check({ [`capture/${ID}.json`]: missing }), { status: 1, codes: ["capture_keys"] })
})

test("an extra or missing key in a host entry, or an unknown host, fails", () => {
  assert.deepEqual(check({ [`capture/${ID}.json`]: { ...valid, hosts: { "claude-code": { ...host, path: "x" } } } }).codes, ["capture_keys"])
  const short = { ...host }
  delete short.unverified
  assert.deepEqual(check({ [`capture/${ID}.json`]: { ...valid, hosts: { "claude-code": short } } }).codes, ["capture_keys"])
  assert.deepEqual(check({ [`capture/${ID}.json`]: { ...valid, hosts: { "other-cli": host } } }).codes, ["capture_keys"])
})

test("a record over 2 KiB fails", () => {
  assert.deepEqual(check({ [`capture/${ID}.json`]: `${JSON.stringify(valid)}${" ".repeat(2100)}` }).codes, ["capture_size"])
})

test("a record that is not a JSON object fails", () => {
  assert.deepEqual(check({ [`capture/${ID}.json`]: "{" }).codes, ["capture_keys"])
  assert.deepEqual(check({ [`capture/${ID}.json`]: "[]" }).codes, ["capture_keys"])
})

test("two capture files in one pull request fail", () => {
  assert.deepEqual(check({ [`capture/${ID}.json`]: valid, "capture/fedcba9876543210.json": valid }).codes, ["capture_many"])
})

test("a wrong path fails", () => {
  assert.deepEqual(check({ "capture/0123.json": valid }).codes, ["capture_path"])
  assert.deepEqual(check({ [`capture/nested/${ID}.json`]: valid }).codes, ["capture_path"])
  assert.deepEqual(check({ [`capture/${ID.toUpperCase()}.json`]: valid }).codes, ["capture_path"])
})

test("unreadable commits give capture_check_unavailable", () => {
  const r = repo({})
  const out = spawnSync("bash", [SCRIPT, "nothex", r.head], { cwd: r.dir, encoding: "utf8" })
  assert.equal(out.status, 1)
  assert.deepEqual(out.stdout.split("\n").filter(Boolean), ["capture_check_unavailable"])
})

test("the codes are stable lines and nothing from the candidate is echoed", () => {
  const sentinel = "SENTINEL_capture_9f3"
  const out = check({ [`capture/${ID}.json`]: { ...valid, [sentinel]: sentinel } })
  assert.equal(out.status, 1)
  for (const line of out.codes) assert.match(line, /^capture_[a-z_]+$/)
  assert.ok(!out.codes.join("\n").includes(sentinel))
})

test("merge.yml and validate.yml both call the script", () => {
  for (const name of ["validate.yml", "merge.yml"]) {
    const text = readFileSync(join(WORKFLOWS, name), "utf8")
    assert.match(text, /bash \.github\/scripts\/check-capture\.sh "\$(BASE_SHA|base_sha)" "\$HEAD_SHA"/, name)
  }
})

test("the README names both caveats, the store's rule and the accept flag file", () => {
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")
  assert.match(readme, /\*\*Of sessions still on disk\.\*\*/)
  assert.match(readme, /\*\*Self-reported\.\*\*/)
  assert.match(readme, /check-capture\.sh/)
  assert.match(readme, /`capture\.json`/)
})
