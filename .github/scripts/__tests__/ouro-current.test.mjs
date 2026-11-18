import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { OURO_CURRENT, checkOuroCurrent, main } from "../ouro-current.mjs"

// Ouro Current's update of the installed Ouro UI files: the rule, then the real workflow steps that apply it.
const ROOT = new URL("../../../", import.meta.url).pathname
const RECORD = ".github/ouro-hx-installed.json"
const validateText = readFileSync(new URL("../../workflows/validate.yml", import.meta.url), "utf8")
const mergeText = readFileSync(new URL("../../workflows/merge.yml", import.meta.url), "utf8")
const BOT = { login: OURO_CURRENT.login, id: OURO_CURRENT.id, type: "Bot" }
const pr = ({ user = BOT, repo = "example/project", ref = "ouro-current/update" } = {}) => ({ user, head: { ref, repo: { full_name: repo } } })
const sha256 = (text) => createHash("sha256").update(text).digest("hex")
const record = (files, tag = "v1.0.1") => `${JSON.stringify({ tag, tagCommit: "0".repeat(40), files: Object.fromEntries(Object.entries(files).map(([p, t]) => [p, sha256(t)])) }, null, 2)}\n`

// A store whose base installs two Ouro files under lib/ouro/ and site/src/ouro/, as factory's own record does.
const installed = { "lib/ouro/ax/a.ts": "a1\n", "site/src/ouro/b.css": "b1\n" }
// The update Current opens: a changed file, a new one, and the record naming both.
const update = { "lib/ouro/ax/a.ts": "a2\n", "lib/ouro/check/c.ts": "c\n" }
const withRecord = (files, extra = {}) => ({ ...files, [RECORD]: record({ ...installed, ...files, ...extra }) })

function store({ trusted = false, extra = {} } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ouro-current-")))
  const dir = join(home, "repo")
  mkdirSync(dir)
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  const write = (p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text) }
  git("init", "-q", "--initial-branch=main")
  git("config", "user.email", "x@example.com")
  git("config", "user.name", "x")
  write("README.md", "x\n")
  for (const [p, t] of Object.entries(installed)) write(p, t)
  write(RECORD, record(installed))
  for (const [p, t] of Object.entries(extra)) write(p, t)
  if (trusted) {
    for (const p of [
      ".github/scripts/ouro-current.mjs", ".github/scripts/triage-values.mjs", ".github/scripts/check-triage.sh", ".github/scripts/check-capture.sh",
      ".github/scripts/check-intake-plugins.sh", ".github/scripts/check-corrections.mjs", ".github/scripts/lib/corrections.mjs", "intake.json",
    ]) write(p, readFileSync(join(ROOT, p)))
  }
  git("add", ".")
  git("commit", "-q", "-m", "base")
  const base = git("rev-parse", "HEAD")
  // change: { path: text | null | { symlink: target } }, null deletes.
  const candidate = (change) => {
    git("checkout", "-q", "-B", "candidate", base)
    for (const [p, c] of Object.entries(change)) {
      if (c === null) rmSync(join(dir, p))
      else if (typeof c === "object") { mkdirSync(dirname(join(dir, p)), { recursive: true }); rmSync(join(dir, p), { force: true }); symlinkSync(c.symlink, join(dir, p)) }
      else write(p, c)
    }
    git("add", "-A")
    git("commit", "-q", "--allow-empty", "-m", "head")
    const head = git("rev-parse", "HEAD")
    git("checkout", "-q", "main")
    return head
  }
  return { home, dir, base, git, candidate, close: () => rmSync(home, { recursive: true, force: true }) }
}

function check(change, snapshot = { repository: "example/project", pr: pr() }, { newRules, extra } = {}) {
  const s = store({ extra })
  try {
    const head = s.candidate(change)
    const runGit = (args) => execFileSync("git", args, { cwd: s.dir, encoding: "utf8" })
    return checkOuroCurrent({ base: s.base, head, snapshot, runGit, newRules })
  } finally { s.close() }
}

test("Ouro Current's update of the files its record lists, under the base's install roots, passes", () => {
  assert.deepEqual(check(withRecord(update)), { ok: true, codes: [] })
  // A file the update no longer ships is deleted from the tree and the record.
  const { "site/src/ouro/b.css": _, ...kept } = installed
  assert.deepEqual(check({ "site/src/ouro/b.css": null, [RECORD]: record(kept) }), { ok: true, codes: [] })
})

test("the bot touching a workflow, a script, a data path or a file outside the roots is refused", () => {
  for (const [path, text] of [[".github/workflows/x.yml", "on: push\n"], [".github/scripts/x.mjs", "x\n"], ["facts/claude-code-1.json", "{}\n"], ["factory.json", "{}\n"], ["package.json", "{}\n"], ["lib/other/d.ts", "d\n"]]) {
    // Unlisted, and listed in the head's record too: the record never widens the roots.
    assert.deepEqual(check({ ...withRecord(update), [path]: text }).codes, ["ouro_current_path"], path)
    assert.deepEqual(check(withRecord({ ...update, [path]: text })).codes, ["ouro_current_path"], `${path} listed`)
  }
  assert.deepEqual(check({ ...withRecord(update), "lib/ouro/ax/unlisted.ts": "u\n" }).codes, ["ouro_current_path"])
  // A control character in a changed path, or in a path the record names.
  assert.deepEqual(check({ ...withRecord(update), "lib/ouro/a\u0001.ts": "x\n" }).codes, ["ouro_current_path"])
  assert.deepEqual(check(withRecord({ "lib/ouro/a\u0001.ts": "x\n" })).codes, ["ouro_current_record"])
})

test("a symlink, a deleted record, a malformed record or an empty change is refused", () => {
  assert.deepEqual(check(withRecord({ "lib/ouro/ax/a.ts": { symlink: "../../../.github/workflows/merge.yml" } }, { "lib/ouro/ax/a.ts": "a\n" })).codes, ["ouro_current_change"])
  assert.deepEqual(check({ ...update, [RECORD]: null }).codes, ["ouro_current_record"])
  assert.deepEqual(check({ ...update, [RECORD]: "{\"files\":{\"lib/ouro/ax/a.ts\":\"not a digest\"}}\n" }).codes, ["ouro_current_record"])
  assert.deepEqual(check({}).codes, ["ouro_current_empty"])
})

test("a head with two merge bases is judged by what merging it lands, so it cannot quietly revert main's .github", () => {
  const s = store()
  try {
    const at = (day) => ({ ...process.env, GIT_AUTHOR_DATE: `2026-01-0${day}T00:00:00Z`, GIT_COMMITTER_DATE: `2026-01-0${day}T00:00:00Z` })
    const run = (day, ...args) => execFileSync("git", args, { cwd: s.dir, env: at(day), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
    const write = (p, text) => { mkdirSync(dirname(join(s.dir, p)), { recursive: true }); writeFileSync(join(s.dir, p), text) }
    // Main fixes a script (M1) while an earlier update (Y) is open, then merges Y with a merge commit.
    write(".github/scripts/x.mjs", "fixed\n")
    run(1, "add", "-A"); run(1, "commit", "-q", "-m", "M1")
    const m1 = run(1, "rev-parse", "HEAD")
    run(2, "checkout", "-q", "-b", "y", s.base)
    for (const [p, t] of Object.entries(withRecord({ "lib/ouro/ax/a.ts": "a2\n" }))) write(p, t)
    run(2, "add", "-A"); run(2, "commit", "-q", "-m", "Y")
    run(3, "checkout", "-q", "main"); run(3, "merge", "-q", "--no-ff", "-m", "merge Y", "y")
    const main = run(3, "rev-parse", "HEAD")
    // The next head merges M1 into Y but drops M1's fix, and changes only Ouro files on top.
    run(4, "checkout", "-q", "y"); run(4, "merge", "-q", "--no-ff", "--no-commit", m1)
    run(4, "rm", "-q", "-f", ".github/scripts/x.mjs")
    for (const [p, t] of Object.entries(withRecord({ "lib/ouro/ax/a.ts": "a3\n" }))) write(p, t)
    run(4, "add", "-A"); run(4, "commit", "-q", "-m", "H")
    const head = run(4, "rev-parse", "HEAD")
    run(4, "checkout", "-q", "main")
    assert.equal(run(4, "merge-base", "--all", main, head).split("\n").length, 2)
    const runGit = (args) => execFileSync("git", args, { cwd: s.dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    assert.deepEqual(checkOuroCurrent({ base: main, head, snapshot: { repository: "example/project", pr: pr() }, runGit }).codes, ["ouro_current_path"])
  } finally { s.close() }
})

test("a head that does not merge cleanly is refused", () => {
  const s = store()
  try {
    const head = s.candidate(withRecord(update))
    writeFileSync(join(s.dir, "lib/ouro/ax/a.ts"), "main's own\n")
    s.git("commit", "-q", "-am", "main")
    const runGit = (args) => execFileSync("git", args, { cwd: s.dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    assert.deepEqual(checkOuroCurrent({ base: s.git("rev-parse", "HEAD"), head, snapshot: { repository: "example/project", pr: pr() }, runGit }).codes, ["ouro_current_conflict"])
  } finally { s.close() }
})

test("anyone else, a fork, or another branch with the same change is not Ouro Current", () => {
  const change = withRecord(update)
  for (const user of [{ login: "someone", id: 1, type: "User" }, { ...BOT, type: "User" }, { ...BOT, id: 1 }, { ...BOT, login: "ouro-current" }]) {
    assert.deepEqual(check(change, { repository: "example/project", pr: pr({ user }) }).codes, ["ouro_current_author"], JSON.stringify(user))
  }
  assert.deepEqual(check(change, { repository: "example/project", pr: pr({ repo: "fork/project" }) }).codes, ["ouro_current_head"])
  assert.deepEqual(check(change, { repository: "example/project", pr: pr({ ref: "ouro-current/update-2" }) }).codes, ["ouro_current_head"])
  assert.deepEqual(check(change, { repository: "example/project", pr: null }).codes, ["ouro_current_author"])
  assert.deepEqual(check(change, null).codes, ["ouro_current_check_unavailable"])
})

// ouro-check.json: factory's Ouro check file, whose `known` lists the findings Ouro Current's update may record for the rules it adds.
const CHECK = "ouro-check.json"
const checkFile = (value) => `${JSON.stringify(value, null, 2)}\n`
const BASE_CHECK = { waive: { "**": { "layout-shift": "A waiver." } }, known: { "off-theme": ["#act-unlabeled sets color: red"] } }
const KNOWN_BASE = { [CHECK]: checkFile(BASE_CHECK) }
// The base's release lists off-theme; the new tag adds new-rule.
const RULES = { base: ["off-theme"], head: ["off-theme", "new-rule"] }
// The update at a new tag (the record names it), with ouro-check.json as `value`.
const knownUpdate = (value, tag = "v1.0.2") => ({ [RECORD]: record(installed, tag), [CHECK]: checkFile(value) })
const withKnown = (known) => ({ ...BASE_CHECK, known })
const OFF_THEME = BASE_CHECK.known["off-theme"]

test("an update adds known entries only under a rule its release adds", () => {
  const added = withKnown({ "off-theme": OFF_THEME, "new-rule": ["#b sets color: red", "#c sets color: blue"] })
  assert.deepEqual(check(knownUpdate(added), undefined, { newRules: RULES, extra: KNOWN_BASE }), { ok: true, codes: [] })
  // The base's release lists no new-rules file, so every rule the head lists is new.
  assert.deepEqual(check(knownUpdate(added), undefined, { newRules: { base: [], head: ["new-rule"] }, extra: KNOWN_BASE }), { ok: true, codes: [] })
})

test("an entry under a rule the base's release lists, or under one neither release lists, is refused", () => {
  const existing = withKnown({ "off-theme": [...OFF_THEME, "#b sets color: red"] })
  assert.deepEqual(check(knownUpdate(existing), undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"])
  const made = withKnown({ ...BASE_CHECK.known, "made-up": ["#b sets color: red"] })
  assert.deepEqual(check(knownUpdate(made), undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"])
  // One new rule does not excuse another, nor a new entry under an old rule beside it.
  const mixed = withKnown({ "off-theme": [...OFF_THEME, "#b sets color: red"], "new-rule": ["#c sets color: blue"] })
  assert.deepEqual(check(knownUpdate(mixed), undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"])
})

test("an update that removes a known entry or a rule, or changes a waiver, is refused", () => {
  for (const known of [{ "off-theme": [] }, {}]) {
    assert.deepEqual(check(knownUpdate(withKnown(known)), undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"], JSON.stringify(known))
  }
  const waived = { ...BASE_CHECK, waive: { "**": { "layout-shift": "Changed." } } }
  assert.deepEqual(check(knownUpdate(waived), undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"])
  const waivedAndAdded = { ...withKnown({ "off-theme": OFF_THEME, "new-rule": ["#b sets color: red"] }), waive: {} }
  assert.deepEqual(check(knownUpdate(waivedAndAdded), undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"])
})

test("ouro-check.json that does not parse, has duplicate or non-string entries, or is added or deleted is refused", () => {
  const added = withKnown({ "off-theme": OFF_THEME, "new-rule": ["#b sets color: red"] })
  assert.deepEqual(check({ [RECORD]: record(installed, "v1.0.2"), [CHECK]: "{ not json\n" }, undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"])
  for (const known of [{ "off-theme": OFF_THEME, "new-rule": ["#b", "#b"] }, { "off-theme": OFF_THEME, "new-rule": ["#b", 1] }, { "off-theme": OFF_THEME, "new-rule": "#b" }, []]) {
    assert.deepEqual(check(knownUpdate({ ...BASE_CHECK, known }), undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_known"], JSON.stringify(known))
  }
  // Only a modification is allowed: a file the base lacks, or one the update deletes.
  assert.deepEqual(check(knownUpdate(added)).codes, ["ouro_current_change"])
  assert.deepEqual(check({ ...knownUpdate(added), [CHECK]: null }, undefined, { newRules: RULES, extra: KNOWN_BASE }).codes, ["ouro_current_change"])
})

test("without the rule lists a change to ouro-check.json is unavailable, and a waiver change needs none", () => {
  const added = knownUpdate(withKnown({ "off-theme": OFF_THEME, "new-rule": ["#b sets color: red"] }))
  for (const newRules of [undefined, { base: [], head: null }, { base: null, head: ["new-rule"] }]) {
    assert.deepEqual(check(added, undefined, { newRules, extra: KNOWN_BASE }), { ok: false, codes: ["ouro_current_check_unavailable"] }, JSON.stringify(newRules))
  }
  const waived = knownUpdate({ ...BASE_CHECK, waive: {} })
  assert.deepEqual(check(waived, undefined, { newRules: undefined, extra: KNOWN_BASE }).codes, ["ouro_current_known"])
  // A refusal already found stands; the lists do not turn it into a hold.
  const withPath = { ...added, "facts/x.json": "{}\n" }
  assert.deepEqual(check(withPath, undefined, { newRules: undefined, extra: KNOWN_BASE }).codes, ["ouro_current_path"])
})

// main fetches the rule lists itself, through the fetch it is given; every URL it asks for is recorded.
const RULES_URL = (tag) => `https://raw.githubusercontent.com/ourostack/ouro-ui/${tag}/registry/ouro/check/new-rules.json`
const rules = (names) => JSON.stringify(names.map((rule) => ({ rule, summary: `${rule} is new.` })))

async function runMain(change, answers, { extra = KNOWN_BASE, snapshot = { repository: "example/project", pr: pr() } } = {}) {
  const s = store({ extra })
  try {
    const head = s.candidate(change)
    const file = join(s.home, "snapshot.json")
    writeFileSync(file, JSON.stringify(snapshot))
    const runGit = (args) => execFileSync("git", args, { cwd: s.dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const urls = []
    const fetchText = async (url) => {
      urls.push(url)
      if (!Object.hasOwn(answers, url)) throw new Error(`no answer for ${url}`)
      return answers[url]
    }
    const out = []
    const status = await main({ argv: [s.base, head, file], write: (text) => out.push(text), runGit, fetchText })
    return { status, output: out.join(""), urls }
  } finally { s.close() }
}

test("main reads both tags' rule lists, for a change to ouro-check.json only, and refuses a tag that is not a release tag unfetched", async () => {
  const added = knownUpdate(withKnown({ "off-theme": OFF_THEME, "new-rule": ["#b sets color: red"] }))
  const both = { [RULES_URL("v1.0.1")]: rules(["off-theme"]), [RULES_URL("v1.0.2")]: rules(["off-theme", "new-rule"]) }
  assert.deepEqual(await runMain(added, both, { extra: KNOWN_BASE }), { status: 0, output: "ok\n", urls: [RULES_URL("v1.0.1"), RULES_URL("v1.0.2")] })
  // A 404 at the base's tag is an empty list, as a release from before the file has none.
  const noBase = { [RULES_URL("v1.0.1")]: null, [RULES_URL("v1.0.2")]: rules(["new-rule"]) }
  assert.deepEqual(await runMain(added, noBase, { extra: KNOWN_BASE }), { status: 0, output: "ok\n", urls: [RULES_URL("v1.0.1"), RULES_URL("v1.0.2")] })
  // A 404 at the new tag leaves the lists unavailable.
  const noHead = { [RULES_URL("v1.0.1")]: rules(["off-theme"]), [RULES_URL("v1.0.2")]: null }
  assert.deepEqual(await runMain(added, noHead, { extra: KNOWN_BASE }), { status: 1, output: "ouro_current_check_unavailable\n", urls: [RULES_URL("v1.0.1"), RULES_URL("v1.0.2")] })
  // A list that is not an array of rules is unavailable too.
  const bad = { [RULES_URL("v1.0.1")]: rules(["off-theme"]), [RULES_URL("v1.0.2")]: "{}" }
  assert.equal((await runMain(added, bad, { extra: KNOWN_BASE })).output, "ouro_current_check_unavailable\n")

  // A record tag that is not a release tag is never fetched: the head's lists are unavailable.
  for (const tag of ["v1.0.2/../x", "main", "v1.0", "V1.0.2"]) {
    const unsafe = knownUpdate(withKnown({ "off-theme": OFF_THEME, "new-rule": ["#b sets color: red"] }), tag)
    assert.deepEqual(await runMain(unsafe, both, { extra: KNOWN_BASE }), { status: 1, output: "ouro_current_check_unavailable\n", urls: [RULES_URL("v1.0.1")] }, tag)
  }

  // Unchanged ouro-check.json: nothing is fetched, and the update is judged as before.
  assert.deepEqual(await runMain(withRecord(update), {}), { status: 0, output: "ok\n", urls: [] })
  // Not Ouro Current's update: refused by identity before anything is fetched.
  const fork = { repository: "example/project", pr: pr({ repo: "fork/project" }) }
  assert.deepEqual(await runMain(added, both, { extra: KNOWN_BASE, snapshot: fork }), { status: 1, output: "ouro_current_head\n", urls: [] })
})

// The workflows' own steps, run for real; only the gh API is a fixture, and every request is recorded.
function workflowRun(source, name) {
  const start = source.indexOf(`      - name: ${name}\n`)
  assert.ok(start >= 0, name)
  const end = source.indexOf("\n      - name:", start + 1)
  const block = source.slice(start, end < 0 ? undefined : end)
  const at = block.indexOf("        run: |\n")
  return block.slice(at + "        run: |\n".length).split("\n").map((l) => l.startsWith("          ") ? l.slice(10) : l).join("\n")
}

function workflow(change, { user = BOT, repo = "example/project", ref = "ouro-current/update", permission = "read" } = {}) {
  const s = store({ trusted: true })
  const head = s.candidate(change)
  s.git("remote", "add", "origin", s.dir)
  const temp = join(s.home, "temp"), bin = join(s.home, "bin")
  mkdirSync(temp)
  mkdirSync(bin)
  if (process.env.DESK_DIR) symlinkSync(process.env.DESK_DIR, join(temp, "desk"), "dir")
  const pull = { number: 1, state: "open", draft: false, labels: [], user, head: { sha: head, ref, repo: { full_name: repo } } }
  const config = join(s.home, "responses.json"), calls = join(s.home, "calls.json")
  writeFileSync(config, JSON.stringify({ pr: pull, permission: { permission } }))
  writeFileSync(calls, "[]")
  writeFileSync(join(bin, "gh"), `#!${process.execPath}
const fs = require("node:fs"), cp = require("node:child_process");
const config = JSON.parse(fs.readFileSync(process.env.GH_FIXTURE, "utf8"));
const calls = JSON.parse(fs.readFileSync(process.env.GH_CALLS, "utf8"));
const args = process.argv.slice(2), endpoint = args[1] === "-X" ? args[3] : args[1];
calls.push({ args, endpoint }); fs.writeFileSync(process.env.GH_CALLS, JSON.stringify(calls));
let response = {};
if (endpoint.includes("pulls?")) response = [config.pr];
else if (/\\/pulls\\/1$/.test(endpoint) && !args.includes("-X")) response = config.pr;
else if (endpoint.endsWith("/permission")) response = config.permission;
const jq = args.indexOf("--jq");
if (jq >= 0) {
  const r = cp.spawnSync("jq", ["-r", args[jq + 1]], { input: JSON.stringify(response), encoding: "utf8" });
  process.stdout.write(r.stdout || ""); process.exit(r.status);
}
process.stdout.write(JSON.stringify(response));
`)
  chmodSync(join(bin, "gh"), 0o755)
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: s.home, RUNNER_TEMP: temp, GITHUB_OUTPUT: join(temp, "outputs"), GITHUB_STEP_SUMMARY: join(temp, "summary"),
    GH_FIXTURE: config, GH_CALLS: calls, REPOSITORY: "example/project", DEFAULT_BRANCH: "main", PR_NUMBER: "1", BASE_SHA: s.base, HEAD_SHA: head,
    AUTHOR: user.login, AUTHOR_ID: String(user.id), AUTHOR_TYPE: user.type, HEAD_REPOSITORY: repo, HEAD_REF: ref, CONCLUSION: "success",
  }
  writeFileSync(env.GITHUB_OUTPUT, "")
  const run = (script, extra = {}) => spawnSync("bash", ["-c", script], { cwd: s.dir, env: { ...env, ...extra }, encoding: "utf8" })
  const merge = () => {
    run(workflowRun(mergeText, "Find the pull requests at the validated head"), { GH_TOKEN: "fixture" })
    run(workflowRun(mergeText, "Validate with Desk main (no token)"))
    run(workflowRun(mergeText, "Merge or reject"), { GH_TOKEN: "fixture" })
    return JSON.parse(readFileSync(calls, "utf8")).filter((c) => c.args.includes("-X")).map((c) => `${c.args[2]} ${c.endpoint}`)
  }
  const headTests = () => {
    run(workflowRun(validateText, "Decide whether this is Ouro Current's update"))
    const scope = run(workflowRun(validateText, "Decide whether the candidate has code to run"), {
      GH_TOKEN: "fixture", OURO_CURRENT: /^ok=(\w+)$/mu.exec(readFileSync(env.GITHUB_OUTPUT, "utf8"))?.[1] ?? "",
    })
    return { status: scope.status, output: scope.stdout, run: /^run=(\w+)$/mu.exec(readFileSync(env.GITHUB_OUTPUT, "utf8"))?.[1] ?? "" }
  }
  return { ...s, head, merge, headTests }
}

const MERGED = ["PUT repos/example/project/pulls/1/merge"]
const REJECTED = ["POST repos/example/project/issues/1/comments", "PATCH repos/example/project/pulls/1"]

test("factory-merge merges Ouro Current's update on its own, at the validated head, with no maintainer", () => {
  const w = workflow(withRecord(update))
  try {
    assert.deepEqual(w.merge(), MERGED)
    const merge = JSON.parse(readFileSync(join(w.home, "calls.json"), "utf8")).find((c) => c.endpoint.endsWith("/merge"))
    assert.ok(merge.args.includes(`sha=${w.head}`))
  } finally { w.close() }
})

test("factory-merge never merges the bot's change to a workflow, a data path or a file outside the roots, nor the same update from anyone else or a fork", () => {
  const cases = [
    [{ ...withRecord(update), ".github/workflows/x.yml": "on: push\n" }, {}],
    [{ ...withRecord(update), "facts/claude-code-1.json": "{}\n" }, {}],
    [withRecord({ ...update, "lib/other/d.ts": "d\n" }), {}],
    [withRecord(update), { user: { login: "someone", id: 1, type: "User" } }],
    [withRecord(update), { repo: "fork/project" }],
  ]
  for (const [change, who] of cases) {
    const w = workflow(change, who)
    try {
      const actions = w.merge()
      // With Desk's validator to hand (the pull request's own tests have it), each is rejected as before; never merged.
      if (process.env.DESK_DIR) assert.deepEqual(actions, REJECTED, JSON.stringify(who))
      else assert.deepEqual(actions, [], JSON.stringify(who))
    } finally { w.close() }
  }
})

test("factory-head-tests runs Ouro Current's update as a maintainer's, and still refuses anyone else, a fork or another path", () => {
  const ok = workflow(withRecord(update))
  try { assert.deepEqual(ok.headTests(), { status: 0, output: "factory-head-tests: Ouro Current's update of the installed Ouro UI files\n", run: "yes" }) } finally { ok.close() }
  for (const [change, who, code] of [
    [{ ...withRecord(update), ".github/workflows/x.yml": "on: push\n" }, {}, "head_tests_author_not_maintainer"],
    [withRecord(update), { user: { login: "someone", id: 1, type: "User" } }, "head_tests_author_not_maintainer"],
    [withRecord(update), { repo: "fork/project" }, "head_tests_author_not_maintainer"],
    [withRecord(update), { repo: "fork/project", user: { login: "someone", id: 1, type: "User" }, permission: "write" }, "head_tests_head_not_in_repository"],
  ]) {
    const w = workflow(change, who)
    try {
      const r = w.headTests()
      assert.equal(r.status, 1, JSON.stringify(who))
      assert.equal(r.run, "", JSON.stringify(who))
      assert.match(r.output, new RegExp(`factory-rejected: ${code}`), JSON.stringify(who))
    } finally { w.close() }
  }
})

test("factory-validate passes Ouro Current's update without Desk, by the base's rule on its own API read, in a step with no token", () => {
  const step = workflowRun(validateText, "Validate the pull request")
  assert.match(step, /node \.github\/scripts\/ouro-current\.mjs "\$BASE_SHA" "\$HEAD_SHA" "\$RUNNER_TEMP\/triage-api\.json"/)
  const decide = validateText.slice(validateText.indexOf("      - name: Decide whether this is Ouro Current's update"), validateText.indexOf("      - name: Decide whether the candidate has code to run"))
  assert.doesNotMatch(decide, /GH_TOKEN|github\.token/)
  const mergeValidate = mergeText.slice(mergeText.indexOf("      - name: Validate with Desk main (no token)"), mergeText.indexOf("      - name: Merge or reject"))
  assert.match(mergeValidate, /node \.github\/scripts\/ouro-current\.mjs "\$base_sha" "\$HEAD_SHA" "\$RUNNER_TEMP\/triage-api-\$number\.json"/)
  assert.doesNotMatch(mergeValidate, /GH_TOKEN|github\.token/)
})
