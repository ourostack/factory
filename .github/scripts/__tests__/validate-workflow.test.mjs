import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("only data files skip the head's tests, and the data paths are the ones an intake pull request holds", () => {
  assert.match(headJob, /\^\(facts\|labels\|capture\)\/\[\^\/\]\+\\\.json\$/)
})

test("the store's tests run with Desk reachable and a missing Desk fails them instead of skipping", () => {
  const base = section("      - name: Run the store's own script tests", "      - name: Decide whether the author maintains")
  assert.match(base, /DESK_DIR: \$\{\{ runner\.temp \}\}\/desk/)
  assert.match(base, /FACTORY_REQUIRE_DESK: "1"/)
  assert.ok(validateJob.indexOf("Clone Desk main") < validateJob.indexOf("Run the store's own script tests"))
  assert.match(headJob, /FACTORY_REQUIRE_DESK=1 DESK_DIR=/)
})
