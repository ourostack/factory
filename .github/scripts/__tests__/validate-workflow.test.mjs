import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
