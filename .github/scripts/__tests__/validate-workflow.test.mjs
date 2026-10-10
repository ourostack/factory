import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

// The workflow is YAML and the suite has no YAML parser, so these tests read its text. They pin the parts that keep the pull
// request's own tests running without letting an untrusted pull request execute its code with a write token.
const text = readFileSync(new URL("../../workflows/validate.yml", import.meta.url), "utf8")
const section = (from, to) => {
  const start = text.indexOf(from)
  assert.notEqual(start, -1, `missing ${from}`)
  const end = to === undefined ? text.length : text.indexOf(to, start + from.length)
  return text.slice(start, end === -1 ? text.length : end)
}
const headJob = section("\n  head-tests:\n", "\n  factory-validate:\n")
const validateJob = section("\n  factory-validate:\n")

test("the pull request's own tests run in a job that factory-validate waits for and fails on", () => {
  assert.match(headJob, /node --test '\.github\/scripts\/__tests__\/\*\.test\.mjs'/)
  assert.match(validateJob, /needs: head-tests/)
  assert.match(validateJob, /if: \$\{\{ !cancelled\(\) \}\}/)
  assert.match(validateJob, /HEAD_TESTS: \$\{\{ needs\.head-tests\.result \}\}/)
  assert.match(validateJob, /!= success/)
})

test("the workflow stays on the pull_request event with a read-only token and no secrets", () => {
  assert.doesNotMatch(text, /pull_request_target/)
  assert.doesNotMatch(text, /secrets\./)
  assert.match(text, /^permissions:\n  contents: read\n/mu)
  assert.doesNotMatch(text, /contents: write|pull-requests: write|id-token/)
})

test("no checkout persists credentials, and the candidate is fetched as data before anything runs", () => {
  const checkouts = text.match(/uses: actions\/checkout@[^\n]+\n(?: {8,}[^\n]+\n)+/gu) ?? []
  assert.equal(checkouts.length, 2)
  for (const block of checkouts) assert.match(block, /persist-credentials: false/)
  assert.match(headJob, /Fetch the candidate as data/)
})

test("the head's code runs only for a maintainer, and never with the token in its environment", () => {
  assert.match(headJob, /head_tests_author_not_maintainer/)
  assert.match(headJob, /collaborators\/\$AUTHOR\/permission/)
  assert.match(headJob, /admin\|write\) maintainer=yes/)
  const run = section("Run the pull request's own tests", undefined).split("\n  factory-validate:")[0]
  assert.match(run, /if: steps\.scope\.outputs\.run == 'yes'/)
  assert.match(run, /env -i /)
  assert.doesNotMatch(run, /GH_TOKEN|github\.token|GITHUB_TOKEN/)
  // The only step of the job that holds the token reads the diff and the permission API; it runs no candidate file.
  const scope = section("      - name: Decide whether the candidate has code to run", "      - name: Clone Desk main")
  assert.doesNotMatch(scope, /node |npm |bash \.github|\.\/|node --test/)
})

// The step's own script, run for real against scratch repositories: what the workflow decides is what is tested.
function runScope(files) {
  const start = text.indexOf("      - name: Decide whether the candidate has code to run")
  const block = text.slice(start, text.indexOf("      - name: Clone Desk main", start))
  const run = block.slice(block.indexOf("run: |\n") + "run: |\n".length).split("\n").map((l) => l.slice(10)).join("\n")
  const dir = mkdtempSync(join(tmpdir(), "scope-"))
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
  git("init", "-q")
  git("config", "user.email", "x@example.com")
  git("config", "user.name", "x")
  writeFileSync(join(dir, "README.md"), "x\n")
  git("add", ".")
  git("commit", "-q", "-m", "base")
  const base = git("rev-parse", "HEAD")
  for (const path of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), "{}\n")
  }
  git("add", ".")
  git("commit", "-q", "-m", "head")
  const head = git("rev-parse", "HEAD")
  const out = join(dir, "out")
  const summary = join(dir, "summary")
  writeFileSync(out, "")
  const result = spawnSync("bash", ["-e", "-c", run], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: dir, GH_TOKEN: "none", REPOSITORY: "o/r", AUTHOR: "-", HEAD_REPOSITORY: "o/r", BASE_SHA: base, HEAD_SHA: head },
  })
  const decided = readFileSync(out, "utf8").trim()
  rmSync(dir, { recursive: true, force: true })
  return { status: result.status, decided, summary: result.stdout }
}

test("data at any depth, JSON only, skips the head's tests; everything else is code (an author who is not a maintainer is refused)", () => {
  const data = [
    ["facts/claude-code-1.json"],
    ["labels/c9235d85d3661b139658f4f89ce53dd7/25ae207f-0000-4000-8000-000000000000.json"],
    ["capture/0123456789abcdef.json"],
    ["facts/a.json", "labels/c9235d85d3661b139658f4f89ce53dd7/b.json", "capture/0123456789abcdef.json"],
  ]
  for (const files of data) assert.deepEqual(runScope(files), { status: 0, decided: "run=no", summary: runScope(files).summary }, files.join())
  const code = [
    ["facts/a.mjs"],
    ["labels/x/y/run.sh"],
    ["labels/c9235d85d3661b139658f4f89ce53dd7/b.JSON"],
    ["Facts/a.json"],
    ["corrections/claude-code-1.json"],
    ["factory.json"],
    [".github/scripts/x.mjs"],
    ["facts/a.json", "site/app.js"],
    ["facts/a.json\nfacts/b.json"], // one file whose name holds a newline, not two files
    ["facts/\u0001.json"],
  ]
  for (const files of code) {
    const r = runScope(files)
    assert.equal(r.status, 1, files.join())
    assert.equal(r.decided, "", files.join())
  }
})

test("a path read that fails is code, never data", () => {
  const start = text.indexOf("      - name: Decide whether the candidate has code to run")
  const block = text.slice(start, text.indexOf("      - name: Clone Desk main", start))
  assert.match(block, /git diff --no-renames --name-only -z/)
  assert.match(block, /head_tests_unavailable/)
  assert.match(block, /read -r -d ''/)
  assert.match(block, /head_tests_head_not_in_repository/)
})

test("the head's tests require Desk (a missing Desk fails them) and the base's run does not look at Desk", () => {
  assert.match(headJob, /FACTORY_REQUIRE_DESK=1 DESK_DIR=/)
  const base = section("      - name: Run the store's own script tests", "      - name: Decide whether the author maintains")
  assert.doesNotMatch(base, /DESK_DIR|FACTORY_REQUIRE_DESK/)
})

test("a drift from Desk's tables is raised by the build's issue-checks job, which opens the build-failing issue", () => {
  const build = readFileSync(new URL("../../workflows/build.yml", import.meta.url), "utf8")
  const issueChecks = build.slice(build.indexOf("\n  issue-checks:\n"), build.indexOf("\n  report:\n"))
  const step = issueChecks.slice(issueChecks.indexOf("Compare the store's copies of Desk's tables"), issueChecks.indexOf("Check the kaizen cards"))
  assert.match(step, /FACTORY_REQUIRE_DESK: "1"/)
  assert.match(step, /DESK_DIR: \$\{\{ runner\.temp \}\}\/desk/)
  assert.match(step, /session-numbers\.test\.mjs/)
  assert.match(step, /corrections\.test\.mjs/)
  assert.ok(issueChecks.indexOf("Clone Desk main") < issueChecks.indexOf("Compare the store's copies"))
  // A failed comparison must not skip the kaizen check, and the issue text names every cause.
  const kaizen = issueChecks.slice(issueChecks.indexOf("Check the kaizen cards"), issueChecks.indexOf("Pull the andon cord"))
  assert.match(kaizen, /if: \$\{\{ !cancelled\(\) && steps\.corrections\.outcome == 'success' \}\}/)
  assert.match(build.slice(build.indexOf("\n  report:\n")), /comparison of the store copies of the Desk tables[^"]*kaizen check or the andon check/)
})

test("triage_trusted_path_matrix", () => {
  assert.equal(runScope(["triage/0123456789abcdef.json"]).decided, "run=no")
  for (const path of ["triage/nested/a.json", "triage/a.json", "triage/0123456789abcdef.mjs"]) assert.equal(runScope([path]).status, 1)
  assert.match(validateJob, /gh api "repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER"/)
  assert.match(validateJob, /triage_authority_check_unavailable/)
  assert.match(validateJob, /--repo "\$REPOSITORY" --pr "\$PR_NUMBER"/)
  assert.match(validateJob, /bash \.github\/scripts\/check-triage\.sh "\$BASE_SHA" "\$HEAD_SHA" "\$TRUSTED_MAINTAINER"/)
  assert.match(validateJob, /actor.*changed|actor\/head.*changed/)
})

// Execute the actual trusted workflow bodies with real Git/Desk/store gates.
// Only the external gh API is replaced by a finite protocol fixture; action
// requests are recorded so a wrong guard causes an observable unwanted write.
const ROOT = new URL("../../../", import.meta.url).pathname
const mergeText = readFileSync(new URL("../../workflows/merge.yml", import.meta.url), "utf8")
function workflowRun(source, name) {
  const start = source.indexOf(`      - name: ${name}\n`)
  assert.ok(start >= 0, name)
  const end = source.indexOf("\n      - name:", start + 1)
  const block = source.slice(start, end < 0 ? undefined : end)
  const at = block.indexOf("        run: |\n")
  assert.ok(at >= 0, name)
  return block.slice(at + "        run: |\n".length).split("\n").map((l) => l.startsWith("          ") ? l.slice(10) : l).join("\n")
}
function authorityWorkflow(scenario, { factsOnly = false, actualBase = false, introducing = false, poisonHead = false, triagePath } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "triage-workflow-")))
  const dir = join(home, "repo"), temp = join(home, "trusted-temp"), bin = join(home, "bin")
  for (const p of [dir, temp, bin]) mkdirSync(p)
  if (actualBase) {
    // A physical, byte-identical released CLI entry point matches CI's clone.
    // A symlink-only Desk root makes its import-meta entry guard skip main.
    const cli = "plugins/desk/mcp/scripts/factory.js"
    mkdirSync(dirname(join(temp, "desk", cli)), { recursive: true })
    copyFileSync(join(process.env.DESK_DIR, cli), join(temp, "desk", cli))
    symlinkSync(join(process.env.DESK_DIR, "plugins/desk/mcp/src"), join(temp, "desk/plugins/desk/mcp/src"), "dir")
    copyFileSync(join(process.env.DESK_DIR, "plugins/desk/plugin.json"), join(temp, "desk/plugins/desk/plugin.json"))
  } else symlinkSync(process.env.DESK_DIR, join(temp, "desk"), "dir")
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  const write = (p, bytes) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), bytes) }
  if (actualBase) {
    // Exact prechange resources, NOT current candidate helpers copied into a
    // made-up base. Candidate objects stay in Git; checkout stays on old main.
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", ROOT, dir])
    git("checkout", "-qB", "main", "050c278a8119b6d7ebb681f4f0ab6b57ea800dd2")
    assert.equal(existsSync(join(dir, ".github/scripts/triage-values.mjs")), false)
    assert.equal(existsSync(join(dir, ".github/scripts/check-triage.sh")), false)
  } else {
    // Installed-era fixture for normal Node2 gates, not a bootstrap test.
    git("init", "-q", "--initial-branch=main")
    write("README.md", "trusted base\n")
    for (const p of [
      ".github/scripts/triage-values.mjs", ".github/scripts/check-triage.sh", ".github/scripts/check-capture.sh",
      ".github/scripts/check-intake-plugins.sh", ".github/scripts/check-corrections.mjs", ".github/scripts/lib/corrections.mjs", "intake.json",
    ]) write(p, readFileSync(join(ROOT, p)))
    git("add", "."); git("-c", "user.name=OWNER", "-c", "user.email=owner@example.invalid", "commit", "-qm", "installed base")
  }
  git("config", "user.name", "OWNER"); git("config", "user.email", "owner@example.invalid")
  const base = git("rev-parse", "HEAD")
  let head
  if (introducing) {
    head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    git("branch", "candidate", head)
  } else {
    git("checkout", "-qb", "candidate")
    const f = JSON.parse(readFileSync(join(ROOT, ".github/scripts/__tests__/fixtures/v12-triage.json"), "utf8"))
    if (factsOnly) {
      const name = readdirSync(join(ROOT, "facts")).find((n) => n.endsWith(".json"))
      const fact = JSON.parse(readFileSync(join(ROOT, "facts", name), "utf8"))
      if (actualBase) fact.session.duration_ms += 1
      write(`facts/${name}`, JSON.stringify(fact) + "\n")
    } else if (poisonHead) {
      write(".github/scripts/triage-values.mjs", `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(join(temp, "HEAD_EXECUTED"))}, "unsafe");\n`)
      write(".github/scripts/check-triage.sh", `touch ${JSON.stringify(join(temp, "HEAD_EXECUTED"))}\n`)
    } else write(triagePath ?? "triage/0123456789abcdef.json", JSON.stringify(f.public) + "\n")
    git("add", "."); git("commit", "-qm", "candidate data")
    head = git("rev-parse", "HEAD")
  }
  git("checkout", "-q", "main")
  if (actualBase) git("remote", "set-url", "origin", dir)
  else git("remote", "add", "origin", dir)
  const pr = { number: 1, state: "open", draft: false, labels: [], user: { login: "actual-actor" }, head: { sha: head, repo: { full_name: "example/project" } } }
  const config = join(home, "responses.json"), calls = join(home, "calls.json")
  writeFileSync(config, JSON.stringify({ pr, ...scenario })); writeFileSync(calls, "[]")
  const gh = join(bin, "gh")
  writeFileSync(gh, `#!${process.execPath}
const fs = require("node:fs"), cp = require("node:child_process");
const config = JSON.parse(fs.readFileSync(process.env.GH_FIXTURE, "utf8"));
const calls = JSON.parse(fs.readFileSync(process.env.GH_CALLS, "utf8"));
const args = process.argv.slice(2), endpoint = args[1] === "-X" ? args[3] : args[1];
const previous = calls.filter((c) => c.endpoint === endpoint).length;
calls.push({args,endpoint}); fs.writeFileSync(process.env.GH_CALLS, JSON.stringify(calls));
let response = {};
if (endpoint.includes("pulls?")) response = [config.pr];
else if (/\\/pulls\\/1$/.test(endpoint) && !args.includes("-X")) response = (config.prReads || [config.pr])[previous] || config.pr;
else if (endpoint.endsWith("/permission")) response = (config.permissionReads || [{permission:"write"}])[previous] || {permission:"write"};
if (response === "API_ERROR") process.exit(1);
const jq = args.indexOf("--jq");
if (jq >= 0) {
 const r = cp.spawnSync("jq", ["-r", args[jq+1]], {input:JSON.stringify(response),encoding:"utf8"});
 process.stdout.write(r.stdout || ""); process.exit(r.status);
}
process.stdout.write(JSON.stringify(response));
`)
  chmodSync(gh, 0o755)
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp,
    GITHUB_OUTPUT: join(temp, "outputs"), GITHUB_STEP_SUMMARY: join(temp, "summary"),
    GH_FIXTURE: config, GH_CALLS: calls, REPOSITORY: "example/project", DEFAULT_BRANCH: "main",
    PR_NUMBER: "1", HEAD_SHA: head, BASE_SHA: base, AUTHOR: "event-OWNER-is-not-authority",
    HEAD_REPOSITORY: "example/project", CONCLUSION: "success",
  }
  writeFileSync(env.GITHUB_OUTPUT, "")
  const run = (script, token = false, extra = {}) => {
    const scoped = { ...env, ...extra }
    delete scoped.GITHUB_TOKEN; delete scoped.GH_TOKEN
    if (token) scoped.GH_TOKEN = "SYNTHETIC_API_FIXTURE"
    return spawnSync("bash", ["-c", script], { cwd: dir, env: scoped, encoding: "utf8" })
  }
  return {
    home, dir, temp, pr, head, base, run,
    git,
    requests: () => JSON.parse(readFileSync(calls, "utf8")),
    outputs: () => Object.fromEntries(readFileSync(env.GITHUB_OUTPUT, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("="))),
    result: () => JSON.parse(readFileSync(join(temp, "factory-validate-1.json"), "utf8")),
    close: () => rmSync(home, { recursive: true, force: true }),
  }
}
const noActions = (r) => assert.ok(r.requests().every((c) => !c.args.includes("-X")), JSON.stringify(r.requests()))

test("actual merge workflow accepts real API write/admin, never event/Git OWNER, and re-reads actor/head before exact-sha merge", (t) => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  for (const permission of ["write", "admin", "maintain"]) {
    const r = authorityWorkflow({ permissionReads: [{ permission }, { permission }] })
    try {
      assert.equal(r.run(workflowRun(mergeText, "Find the pull requests at the validated head"), true).status, 0)
      const validated = r.run(workflowRun(mergeText, "Validate with Desk main (no token)"))
      assert.equal(validated.status, 0, validated.stderr)
      assert.equal(r.result().ok, true, JSON.stringify(r.result()))
      assert.equal(r.run(workflowRun(mergeText, "Merge or reject"), true).status, 0)
      const requests = r.requests()
      const action = requests.find((c) => c.endpoint.endsWith("/merge"))
      assert.ok(action, JSON.stringify(requests))
      assert.ok(action.args.includes(`sha=${r.head}`))
      assert.equal(requests.filter((c) => c.endpoint === "repos/example/project/pulls/1").length, 2)
      assert.ok(requests.some((c) => c.endpoint === "repos/example/project/collaborators/actual-actor/permission"))
      assert.ok(!requests.some((c) => c.endpoint.includes("event-OWNER")))
    } finally { r.close() }
  }
})

test("S2-1: real introducing maintenance head validates with exact 050c278a base resources, never preinstalled candidate helpers", (t) => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  const r = authorityWorkflow({}, { actualBase: true, introducing: true })
  try {
    assert.equal(r.base, "050c278a8119b6d7ebb681f4f0ab6b57ea800dd2")
    for (const p of [".github/scripts/check-capture.sh", ".github/scripts/check-corrections.mjs", ".github/scripts/check-intake-plugins.sh"]) {
      assert.deepEqual(readFileSync(join(r.dir, p)), execFileSync("git", ["-C", ROOT, "cat-file", "blob", `${r.base}:${p}`]))
    }
    assert.equal(r.run(workflowRun(text, "Decide whether the author maintains this repository"), true).status, 0)
    const outputs = r.outputs()
    const result = r.run(workflowRun(text, "Validate the pull request"), false, {
      AUTHOR_ASSOCIATION: outputs.association, TRUSTED_MAINTAINER: outputs.trusted_maintainer,
    })
    const diagnostic = result.status === 0 ? "" : (() => {
      const direct = r.run(`node "$RUNNER_TEMP/desk/plugins/desk/mcp/scripts/factory.js" validate-pr --base "$BASE_SHA" --head "$HEAD_SHA" --author-association "${outputs.association}"`)
      return `\nDirect released CLI exit ${direct.status}\n${direct.stdout}\n${direct.stderr}`
    })()
    assert.equal(result.status, 0, result.stdout + result.stderr + diagnostic)
    const answer = JSON.parse(readFileSync(join(r.temp, "factory-validate.json"), "utf8"))
    assert.equal(answer.ok, true)
    assert.equal(answer.maintenance, true)
    assert.equal(r.run(workflowRun(text, "Re-read the actual actor and head after validation"), true, {
      ACTOR: outputs.actor, TRUSTED_MAINTAINER: outputs.trusted_maintainer,
    }).status, 0)
    t.diagnostic(`exact introducing base=${r.base} head=${r.head}; old-helper bytes unchanged; maintenance passed`)
    assert.equal(existsSync(join(r.dir, ".github/scripts/triage-values.mjs")), false)
    assert.equal(existsSync(join(r.dir, ".github/scripts/check-triage.sh")), false)
    noActions(r)
  } finally { r.close() }
})

test("S2-1: actual prechange main merge controller validates introducing code and leaves it maintenance, not automerged", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  const r = authorityWorkflow({}, { actualBase: true, introducing: true })
  try {
    const oldMerge = readFileSync(join(r.dir, ".github/workflows/merge.yml"), "utf8")
    assert.equal(r.run(workflowRun(oldMerge, "Find the pull requests at the validated head"), true).status, 0)
    const validation = r.run(workflowRun(oldMerge, "Validate with Desk main (no token)"))
    assert.equal(validation.status, 0, validation.stdout + validation.stderr)
    assert.equal(r.result().ok, true)
    assert.equal(r.result().maintenance, true)
    const action = r.run(workflowRun(oldMerge, "Merge or reject"), true)
    assert.equal(action.status, 0, action.stdout + action.stderr)
    assert.ok(r.requests().some((c) => c.endpoint === "repos/example/project/issues/1/labels"))
    assert.ok(!r.requests().some((c) => c.endpoint.endsWith("/merge") || c.args.includes("state=closed")))
  } finally { r.close() }
})

test("S2-1: first landed main contains helpers atomically; merge/build/pages use them and never bootstrap missing installed helpers", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  const r = authorityWorkflow({}, { actualBase: true, introducing: true })
  try {
    // Simulate checkout of the complete actual introducing Git commit as main,
    // not copying just the new helpers into an old or invented base.
    r.git("reset", "--hard", r.head)
    assert.equal(existsSync(join(r.dir, ".github/scripts/triage-values.mjs")), true)
    assert.equal(existsSync(join(r.dir, ".github/scripts/check-triage.sh")), true)
    const build = readFileSync(join(r.dir, ".github/workflows/build.yml"), "utf8")
    const pages = readFileSync(join(r.dir, ".github/workflows/pages.yml"), "utf8")
    const reports = r.run(workflowRun(build, "Build the reports"), false, { FACTORY_SITE_OFFLINE: "1" })
    assert.equal(reports.status, 0, reports.stdout + reports.stderr)
    cpSync(join(r.dir, "_out"), join(r.dir, "_reports"), { recursive: true })
    const site = r.run(workflowRun(pages, "Build site data"), false, { FACTORY_SITE_OFFLINE: "1" })
    assert.equal(site.status, 0, site.stdout + site.stderr)
    assert.equal(r.run(workflowRun(mergeText, "Find the pull requests at the validated head"), true).status, 0)
    assert.equal(r.run(workflowRun(mergeText, "Validate with Desk main (no token)")).status, 0)
    assert.equal(r.result().ok, true)
    rmSync(join(r.dir, ".github/scripts/triage-values.mjs"))
    assert.notEqual(r.run(workflowRun(build, "Build the reports"), false, { FACTORY_SITE_OFFLINE: "1" }).status, 0)
    assert.notEqual(r.run(workflowRun(pages, "Build site data"), false, { FACTORY_SITE_OFFLINE: "1" }).status, 0)
    r.run(workflowRun(mergeText, "Validate with Desk main (no token)"))
    const held = r.run(workflowRun(mergeText, "Merge or reject"), true)
    assert.equal(held.status, 1)
    assert.match(held.stdout, /validator_unavailable|triage_check_unavailable/)
    noActions(r)
  } finally { r.close() }
})

test("S2-1: pristine-base bootstrap preserves facts checks and never executes hostile head helper replacements", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  for (const opts of [{ actualBase: true, factsOnly: true }, { actualBase: true, poisonHead: true }]) {
    const r = authorityWorkflow({}, opts)
    try {
      r.run(workflowRun(text, "Decide whether the author maintains this repository"), true)
      const outputs = r.outputs()
      const result = r.run(workflowRun(text, "Validate the pull request"), false, {
        AUTHOR_ASSOCIATION: outputs.association, TRUSTED_MAINTAINER: outputs.trusted_maintainer,
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(existsSync(join(r.temp, "HEAD_EXECUTED")), false)
      assert.equal(existsSync(join(r.dir, ".github/scripts/triage-values.mjs")), false)
      noActions(r)
    } finally { r.close() }
  }
})

test("S2-1: any triage change on pristine actual base is an explicit unavailable hold, not a head-helper fallback", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  for (const triagePath of ["triage/0123456789abcdef.json", "triage/nested/untrusted.mjs", "triage/bad\npath.json"]) {
    const r = authorityWorkflow({}, { actualBase: true, triagePath })
    try {
      r.run(workflowRun(text, "Decide whether the author maintains this repository"), true)
      const outputs = r.outputs()
      const result = r.run(workflowRun(text, "Validate the pull request"), false, {
        AUTHOR_ASSOCIATION: outputs.association, TRUSTED_MAINTAINER: outputs.trusted_maintainer,
      })
      assert.equal(result.status, 1)
      assert.match(result.stdout, /triage_check_unavailable/)
      assert.equal(existsSync(join(r.dir, ".github/scripts/triage-values.mjs")), false)
      noActions(r)
    } finally { r.close() }
  }
})

test("S2-1: installed missing/crashing helpers and helper deletion history never downgrade to legacy validation", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  for (const kind of ["missing", "crash", "deleted_history"]) {
    const r = authorityWorkflow({}, { factsOnly: true })
    try {
      if (kind === "missing") {
        rmSync(join(r.dir, ".github/scripts/check-triage.sh"))
      } else if (kind === "crash") {
        writeFileSync(join(r.dir, ".github/scripts/triage-values.mjs"), "process.exit(2)\n")
      } else {
        r.git("rm", ".github/scripts/triage-values.mjs", ".github/scripts/check-triage.sh")
        r.git("commit", "-qm", "delete installed helpers")
      }
      r.run(workflowRun(text, "Decide whether the author maintains this repository"), true)
      const outputs = r.outputs()
      const result = r.run(workflowRun(text, "Validate the pull request"), false, {
        AUTHOR_ASSOCIATION: outputs.association, TRUSTED_MAINTAINER: outputs.trusted_maintainer,
        ...(kind === "deleted_history" ? { BASE_SHA: r.git("rev-parse", "HEAD") } : {}),
      })
      assert.equal(result.status, 1)
      assert.match(result.stdout, /triage_check_unavailable|validator_unavailable/)
      noActions(r)
    } finally { r.close() }
  }
})

test("actual merge workflow permission unavailable holds triage, known read refuses, permission upgrade before rejection holds", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  for (const [first, last, wantAction] of [
    ["API_ERROR", "API_ERROR", false], [{ permission: "unexpected" }, { permission: "unexpected" }, false],
    [{ permission: "read" }, { permission: "read" }, true],
    [{ permission: "read" }, { permission: "write" }, false],
  ]) {
    const r = authorityWorkflow({ permissionReads: [first, last] })
    try {
      assert.equal(r.run(workflowRun(mergeText, "Find the pull requests at the validated head"), true).status, 0)
      r.run(workflowRun(mergeText, "Validate with Desk main (no token)"))
      r.run(workflowRun(mergeText, "Merge or reject"), true)
      assert.ok(!r.requests().some((c) => c.endpoint.endsWith("/merge")))
      if (wantAction) assert.ok(r.requests().some((c) => c.args.includes("state=closed")))
      else noActions(r)
    } finally { r.close() }
  }
})

test("actual validate workflow obtains its own API snapshot and detects stale actor/head and lost permission", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  for (const moved of ["none", "head", "actor", "permission", "api"]) {
    const r = authorityWorkflow({ permissionReads: [{ permission: "write" }, moved === "permission" ? "API_ERROR" : { permission: "write" }] })
    try {
      assert.equal(r.run(workflowRun(text, "Decide whether the author maintains this repository"), true).status, 0)
      const outputs = r.outputs()
      assert.equal(outputs.actor, "actual-actor")
      const validation = r.run(workflowRun(text, "Validate the pull request"), false, {
        AUTHOR_ASSOCIATION: outputs.association, TRUSTED_MAINTAINER: outputs.trusted_maintainer,
      })
      assert.equal(validation.status, 0, validation.stdout + validation.stderr)
      if (moved !== "none" && moved !== "permission") {
        const config = JSON.parse(readFileSync(join(r.home, "responses.json"), "utf8"))
        config.prReads = [r.pr, moved === "api" ? "API_ERROR" : {
          ...r.pr, ...(moved === "head" ? { head: { ...r.pr.head, sha: "f".repeat(40) } } : { user: { login: "other-actor" } }),
        }]
        writeFileSync(join(r.home, "responses.json"), JSON.stringify(config))
      }
      const final = r.run(workflowRun(text, "Re-read the actual actor and head after validation"), true, { ACTOR: outputs.actor, TRUSTED_MAINTAINER: outputs.trusted_maintainer })
      assert.equal(final.status, moved === "none" ? 0 : 1, final.stdout + final.stderr)
      noActions(r)
    } finally { r.close() }
  }
})

test("actual merge workflow final actor/head/permission drift, checker missing/crash, and forged snapshot remain no-action holds", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  for (const kind of ["head", "actor", "permission", "api", "missing", "crash", "snapshot", "snapshot_mode", "snapshot_link", "snapshot_json"]) {
    const r = authorityWorkflow({ permissionReads: [{ permission: "write" }, kind === "permission" ? "API_ERROR" : { permission: "write" }] })
    try {
      r.run(workflowRun(mergeText, "Find the pull requests at the validated head"), true)
      if (kind === "missing") rmSync(join(r.dir, ".github/scripts/check-triage.sh"))
      if (kind === "crash") writeFileSync(join(r.dir, ".github/scripts/check-triage.sh"), "exit 2\n")
      if (kind === "snapshot") {
        const p = join(r.temp, "triage-api-1.json")
        const m = JSON.parse(readFileSync(p, "utf8")); m.pr.head.sha = "f".repeat(40)
        writeFileSync(p, JSON.stringify(m))
      }
      if (kind === "snapshot_mode") chmodSync(join(r.temp, "triage-api-1.json"), 0o644)
      if (kind === "snapshot_link") {
        const p = join(r.temp, "triage-api-1.json"), candidate = join(r.dir, "forged-snapshot.json")
        copyFileSync(p, candidate); rmSync(p); symlinkSync(candidate, p)
      }
      if (kind === "snapshot_json") writeFileSync(join(r.temp, "triage-api-1.json"), "not JSON")
      r.run(workflowRun(mergeText, "Validate with Desk main (no token)"))
      if (["missing", "crash"].includes(kind)) assert.equal(r.result().unavailable, "triage_check_unavailable")
      if (["head", "actor", "api"].includes(kind)) {
        const config = JSON.parse(readFileSync(join(r.home, "responses.json"), "utf8"))
        config.prReads = [r.pr, kind === "api" ? "API_ERROR" : {
          ...r.pr, ...(kind === "head" ? { head: { ...r.pr.head, sha: "f".repeat(40) } } : { user: { login: "other-actor" } }),
        }]
        writeFileSync(join(r.home, "responses.json"), JSON.stringify(config))
      }
      r.run(workflowRun(mergeText, "Merge or reject"), true)
      noActions(r)
    } finally { r.close() }
  }
})

test("all validate and merge workflow run bodies parse as Bash before CI can execute them", () => {
  for (const source of [text, mergeText]) {
    const names = [...source.matchAll(/^      - name: (.+)$/gm)].map((m) => m[1])
    for (const name of names) {
      const start = source.indexOf(`      - name: ${name}\n`)
      const end = source.indexOf("\n      - name:", start + 1)
      if (!source.slice(start, end < 0 ? undefined : end).includes("        run: |\n")) continue
      const script = workflowRun(source, name).replace(/\$\{\{[^}]*\}\}/g, "x")
      const r = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" })
      assert.equal(r.status, 0, `${name}: ${r.stderr}`)
    }
  }
})

test("unknown maintainer permission does not revoke legacy contributor facts intake", () => {
  if (!process.env.DESK_DIR) { assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1"); return }
  const r = authorityWorkflow({ permissionReads: ["API_ERROR"] }, { factsOnly: true })
  try {
    r.run(workflowRun(mergeText, "Find the pull requests at the validated head"), true)
    r.run(workflowRun(mergeText, "Validate with Desk main (no token)"))
    assert.equal(r.result().ok, true, JSON.stringify(r.result()))
    r.run(workflowRun(mergeText, "Merge or reject"), true)
    assert.ok(r.requests().some((c) => c.endpoint.endsWith("/merge")))
  } finally { r.close() }
})
