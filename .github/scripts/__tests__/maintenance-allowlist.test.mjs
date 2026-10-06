import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { ALLOWLIST, checkMaintenance } from "../maintenance-allowlist.mjs"

const SCRIPT = new URL("../maintenance-allowlist.mjs", import.meta.url).pathname
const MERGE = new URL("../../workflows/merge.yml", import.meta.url).pathname

// The real rule, as Desk main's andon.js has it: exactly { andon: { plugins } }.
function parseStoreConfig(text) {
  try {
    const c = JSON.parse(text)
    const ok = c && Object.keys(c).join() === "andon" && Object.keys(c.andon || {}).join() === "plugins" && Array.isArray(c.andon.plugins)
    return ok ? { ok: true, plugins: c.andon.plugins } : { ok: false, code: "invalid_config" }
  } catch {
    return { ok: false, code: "invalid_json" }
  }
}

const FILE = "claude-code-3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c.json"
const correction = () => ({
  schema: "factory.correction/1",
  file: FILE,
  fields: { jobs: [{ job: "2927a4630f97b7869a71f387a4a757f1", basis: ["desk_commit"], session_offset_ms: null, transitions: [], observed: null }] },
  reason: "a test correction",
  date: "2026-10-01",
  pr: 1,
})

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
}

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), typeof content === "string" ? content : `${JSON.stringify(content)}\n`)
}

// A repository whose base holds `before` and whose head changes it by `change`
// ({ path: content | null }, null deletes).
function repo(change, before = {}) {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-"))
  git(dir, "init", "-q")
  git(dir, "config", "user.email", "x@example.com")
  git(dir, "config", "user.name", "x")
  write(dir, "README.md", "x\n")
  write(dir, "factory.json", { andon: { plugins: ["desk"] } })
  for (const [p, c] of Object.entries(before)) write(dir, p, c)
  git(dir, "add", ".")
  git(dir, "commit", "-q", "-m", "base")
  const base = git(dir, "rev-parse", "HEAD")
  for (const [p, c] of Object.entries(change)) {
    if (c === null) rmSync(join(dir, p))
    else write(dir, p, c)
  }
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "--allow-empty", "-m", "head")
  return { dir, base, head: git(dir, "rev-parse", "HEAD") }
}

async function check(change, before) {
  const r = repo(change, before)
  const runGit = (args) => execFileSync("git", args, { cwd: r.dir, encoding: "utf8" })
  return checkMaintenance({ base: r.base, head: r.head, runGit, parseStoreConfig })
}

test("the allowlist is a correction record and factory.json, nothing else", () => {
  assert.deepEqual(ALLOWLIST.map((re) => re.source), ["^corrections\\/[A-Za-z0-9._-]+\\.json$", "^factory\\.json$"])
})

test("paths corrections/<name>.json and factory.json only: ok", async () => {
  assert.deepEqual(await check({ [`corrections/${FILE}`]: correction(), "factory.json": { andon: { plugins: ["desk", "other"] } } }), { ok: true, codes: [] })
  assert.deepEqual(await check({ "factory.json": { andon: { plugins: [] } } }), { ok: true, codes: [] })
})

test("any path outside the list is refused with maintenance_path", async () => {
  for (const path of ["intake.json", ".github/workflows/x.yml", "facts/claude-code-s1.json", "labels/j/s.json", "capture.json", "capture/0123456789abcdef.json", "README.md", "corrections/nested/a.json"]) {
    const r = await check({ [path]: path.endsWith(".json") ? { a: 1 } : "changed\n" })
    assert.equal(r.ok, false, path)
    assert.ok(r.codes.includes("maintenance_path"), `${path}: ${r.codes}`)
  }
  const mixed = await check({ [`corrections/${FILE}`]: correction(), "intake.json": { public_plugins: ["desk"] } })
  assert.deepEqual(mixed.codes, ["maintenance_path"])
})

test("a deletion of a record or a rename into the list is refused", async () => {
  const del = await check({ [`corrections/${FILE}`]: null }, { [`corrections/${FILE}`]: correction() })
  assert.deepEqual(del.codes, ["maintenance_delete"])
  const rename = await check({ "README.md": null, [`corrections/${FILE}`]: correction() })
  assert.ok(rename.codes.includes("maintenance_delete") || rename.codes.includes("maintenance_path"))
  assert.equal(rename.ok, false)
})

test("an invalid correction record or a factory.json the store config rule refuses is refused", async () => {
  const bad = await check({ [`corrections/${FILE}`]: { schema: "x" } })
  assert.equal(bad.ok, false)
  assert.ok(bad.codes.some((c) => c.startsWith("correction")))
  const cfg = await check({ "factory.json": { andon: { plugins: ["desk"] }, capture: 1 } })
  assert.deepEqual(cfg.codes, ["maintenance_factory_config"])
})

test("an empty change, bad commits or a missing config rule leave the pull request alone", async () => {
  assert.deepEqual((await check({})).codes, ["maintenance_empty"])
  assert.deepEqual((await checkMaintenance({ base: "x", head: "y", parseStoreConfig })).codes, ["maintenance_check_unavailable"])
  const r = repo({ "factory.json": { andon: { plugins: [] } } })
  const runGit = (args) => execFileSync("git", args, { cwd: r.dir, encoding: "utf8" })
  assert.deepEqual((await checkMaintenance({ base: r.base, head: r.head, runGit, parseStoreConfig: null })).codes, ["maintenance_check_unavailable"])
})

test("the command prints ok or stable codes, loads the config rule from Desk, and never echoes the candidate", () => {
  const desk = mkdtempSync(join(tmpdir(), "desk-"))
  write(desk, "plugins/desk/mcp/src/factory/pipeline/andon.js", `export ${parseStoreConfig.toString()}\n`)
  const good = repo({ "factory.json": { andon: { plugins: ["desk"] }, "SENTINEL_x": 1 } })
  const out = spawnSync("node", [SCRIPT, good.base, good.head, desk], { cwd: good.dir, encoding: "utf8" })
  assert.equal(out.status, 1)
  assert.equal(out.stdout, "maintenance_factory_config\n")
  const fine = repo({ "factory.json": { andon: { plugins: [] } } })
  const ok = spawnSync("node", [SCRIPT, fine.base, fine.head, desk], { cwd: fine.dir, encoding: "utf8" })
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(ok.stdout, "ok\n")
  const noDesk = spawnSync("node", [SCRIPT, fine.base, fine.head, join(desk, "missing")], { cwd: fine.dir, encoding: "utf8" })
  assert.equal(noDesk.stdout, "maintenance_check_unavailable\n")
})

test("merge.yml merges an allowed maintenance pull request only from the same repository, by a maintainer, after a green validation, at the validated head", () => {
  const text = readFileSync(MERGE, "utf8")
  assert.match(text, /node \.github\/scripts\/maintenance-allowlist\.mjs "\$base_sha" "\$HEAD_SHA" "\$RUNNER_TEMP\/desk"/)
  assert.match(text, /\.head\.repo\.full_name/)
  const block = text.slice(text.indexOf("factory-allow-"))
  assert.match(block, /association" = COLLABORATOR/)
  assert.match(block, /same_repo" = true/)
  assert.match(text, /CONCLUSION" = "success"/)
  // Every merge call passes the validated head as sha.
  const calls = text.match(/pulls\/\$[0-9a-z]+\/merge[^\n]*/g)
  assert.ok(calls.length >= 1)
  for (const call of calls) assert.match(call, /sha="\$HEAD_SHA"/)
})

test("merge.yml leaves a held pull request alone, and a refused merge fails only that pull request", () => {
  const yml = readFileSync(new URL("../../workflows/merge.yml", import.meta.url), "utf8")
  assert.match(yml, /\.draft == true or \(\[\.labels\[\]\.name\] \| index\("hold"\) != null\)/)
  assert.match(yml, /merge_at_head\(\) \{/)
  assert.doesNotMatch(yml, /gh api -X PUT "repos\/\$REPOSITORY\/pulls\/\$number\/merge"/)
  assert.match(yml, /merge_refused; left open/)
})

test("every run block in merge.yml is valid bash", () => {
  const lines = readFileSync(new URL("../../workflows/merge.yml", import.meta.url), "utf8").split("\n")
  let blocks = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run: \|\s*$/)
    if (!m) continue
    const body = []
    let j = i + 1
    for (; j < lines.length && (lines[j].trim() === "" || lines[j].match(/^\s*/)[0].length > m[1].length); j++) body.push(lines[j])
    const script = body.join("\n").replace(/\$\{\{[^}]*\}\}/g, "x")
    const r = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" })
    assert.equal(r.status, 0, r.stderr)
    blocks += 1
  }
  assert.ok(blocks >= 3)
})
