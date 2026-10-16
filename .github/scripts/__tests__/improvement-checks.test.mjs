import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

import { buildImprovementChecks, validateImprovementChecks } from "../../../site/scripts/improvement-checks.mjs"
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"

const ROOT = new URL("../../../", import.meta.url).pathname
const issue = (over = {}) => ({
  number: 53, url: "https://github.com/ourostack/factory/issues/53", state: "closed",
  title: "PRIVATE_TITLE", body: "PRIVATE_BODY", author: "PRIVATE_IDENTITY", created_at: 1792167000000,
  ...over,
})
const card = (over = {}) => ({
  kaizen: 1, signal: "human_wait", job_class: "any", evidence_jobs: ["a".repeat(32)],
  countermeasure: "https://github.com/ourostack/desk/pull/65", plugin: "desk",
  version: "3.2.0-alpha.108", hypothesis: { measure: "human_wait", direction: "down" }, ...over,
})
const result = (over = {}) => ({
  status: "checked", verdict: "confirmed", state: "measured", reasons: [],
  jobs: 13, excluded: [{ reason: "open_job", jobs: 1 }],
  comparison: {
    before: { jobs: 6, groups: 6, median: 100 }, after: { jobs: 6, groups: 6, median: 30 },
    change: -70, interval: [-80, -60], direction: "down",
  }, ...over,
})
const build = (over = {}) => buildImprovementChecks({
  issues: [issue()], records: [], parseCard: () => ({ ok: true, card: card() }),
  checkCard: () => result(), ...over,
})
const row = (doc) => doc.checks["ourostack/factory#53"]

test("current canonical verdicts remain distinct from closed lifecycle", () => {
  for (const [verdict, direction, interval, change] of [
    ["confirmed", "down", [-80, -60], -70],
    ["not_confirmed", "up", [60, 80], 70],
    ["no_clear_change", null, [-10, 20], 5],
    ["too_few_jobs", null, null, null],
  ]) {
    const checked = result({ verdict })
    checked.comparison = verdict === "too_few_jobs"
      ? { before: { jobs: 0, groups: 0, median: null }, after: { jobs: 5, groups: 1, median: 30 }, change, interval, direction }
      : { ...checked.comparison, after: { jobs: 6, groups: 6, median: 100 + change }, change, interval, direction }
    if (verdict === "too_few_jobs") checked.jobs = 6
    const doc = build({ checkCard: () => checked })
    assert.equal(row(doc).status, "checked")
    assert.equal(row(doc).result.verdict, verdict)
    assert.equal(row(doc).issue_state, "closed")
    assert.deepEqual(row(doc).result.comparison, checked.comparison)
    assert.equal(validateImprovementChecks(doc).ok, true)
    assert.deepEqual(checkNumbers({ improvement_checks: doc }), [])
  }
})

test("all open and closed cards use one shared record snapshot and issue-number seed", () => {
  const records = [{ private: "/Users/private/PRIVATE_PATH" }]
  const calls = []
  const doc = build({
    issues: [issue(), issue({ number: 54, url: "https://github.com/ourostack/factory/issues/54", state: "open" })],
    records,
    checkCard: (parsed, actual, options) => { calls.push([parsed, actual, options]); return result() },
  })
  assert.equal(doc.checks["ourostack/factory#54"].issue_state, "open")
  assert.deepEqual(calls.map((c) => c[2]), [{ seed: 53 }, { seed: 54 }])
  assert.ok(calls.every((c) => c[1] === records))
})

test("missing card, refused card and waiting version are not checks that ran", () => {
  for (const [errors, status] of [[[{ code: "no_block" }], "no_check"], [[{ code: "syntax", line: 2 }], "refused"]]) {
    const doc = build({ parseCard: () => ({ ok: false, errors }), checkCard: () => assert.fail("must not compare invalid card") })
    assert.equal(row(doc).status, status)
    assert.ok(!("result" in row(doc)))
    assert.ok(!("card" in row(doc)))
  }
  const waiting = build({
    parseCard: () => ({ ok: true, card: card({ version: null }) }),
    checkCard: () => ({ status: "waiting_for_version" }),
  })
  assert.equal(row(waiting).status, "waiting_for_version")
  assert.equal(row(waiting).card.version, null)
  assert.ok(!("result" in row(waiting)))
})

test("unavailable optional source and partial issue enumeration never claim healthy emptiness", () => {
  for (const over of [{ parseCard: undefined }, { checkCard: undefined }, { records: undefined }]) {
    const doc = build(over)
    assert.equal(doc.availability, "unavailable")
    assert.equal(row(doc).status, "unavailable")
    assert.ok(doc.reasons.includes("canonical_source_unavailable"))
  }
  const absent = build({ issues: { verification: "unavailable", issues: [] } })
  assert.equal(absent.availability, "unavailable")
  assert.deepEqual(absent.checks, {})
  const partial = build({ issues: { verification: "verified", truncated: true, issues: [issue()] } })
  assert.equal(partial.availability, "partial")
  assert.deepEqual(partial.reasons, ["first_page_only"])
  assert.equal(row(partial).status, "checked")
})

test("partial canonical numbers retain lower-bound values without claiming a bounded change", () => {
  const doc = build({ checkCard: () => result({ state: "partial", reasons: ["host_records_partly"] }) })
  assert.equal(row(doc).result.state, "partial")
  assert.deepEqual(row(doc).result.reasons, ["host_records_partly"])
  assert.deepEqual(row(doc).result.bounds, { before: "lower", after: "lower", change: "unknown", interval: "unknown" })
  assert.deepEqual(row(doc).result.excluded, [{ reason: "open_job", jobs: 1 }])
})

test("real counter exclusions preserve worker-split jobs rather than refusing the whole source", () => {
  const doc = build({ checkCard: () => result({ excluded: [{ reason: "worker_split", jobs: 1 }] }) })
  assert.deepEqual(row(doc).result.excluded, [{ reason: "worker_split", jobs: 1 }])
  assert.deepEqual(checkNumbers({ improvement_checks: doc }), [])
})

test("closed projection cannot publish raw prose, identities, paths, job ids or epoch clocks", () => {
  const doc = build()
  const text = JSON.stringify(doc)
  for (const secret of ["PRIVATE_BODY", "PRIVATE_TITLE", "PRIVATE_IDENTITY", "1792167000000", "a".repeat(32), "/Users/"]) {
    assert.ok(!text.includes(secret), secret)
  }
  assert.equal(row(doc).card.measure, "human_wait")
  assert.equal(row(doc).card.plugin, "desk")
  assert.equal(row(doc).card.version, "3.2.0-alpha.108")
  assert.equal(row(doc).card.direction, "down")
  assert.equal(row(doc).card.countermeasure, "https://github.com/ourostack/desk/pull/65")
  assert.throws(() => build({ issues: [issue({ url: "https://evil.test/issues/53" })] }), /improvement_checks_/)
  assert.throws(() => build({ issues: [issue(), issue()] }), /improvement_checks_/)
})

test("canonical validated version spelling is preserved without a second stricter semver parser", () => {
  const doc = build({ parseCard: () => ({ ok: true, card: card({ version: "03.2.0-alpha.01" }) }) })
  assert.equal(row(doc).card.version, "03.2.0-alpha.01")
})

test("runtime parse or comparison failures propagate rather than becoming unavailable success", () => {
  for (const over of [
    { parseCard: () => { throw new Error("parse exploded") } },
    { checkCard: () => { throw new Error("check exploded") } },
    { checkCard: () => result({ verdict: "invented" }) },
    { checkCard: () => result({ excluded: [{ reason: "/Users/private", jobs: 1 }] }) },
    { parseCard: () => ({ ok: true, card: card({ plugin: "/Users/private" }) }) },
  ]) assert.throws(() => build(over))
})

test("number allowance is exact, closed, finite and does not exempt other measurements", () => {
  const doc = build()
  for (const mutate of [
    (d) => { row(d).result.comparison.before.jobs = -1 },
    (d) => { row(d).result.comparison.before.groups = 7 },
    (d) => { row(d).result.comparison.before.median = Infinity },
    (d) => { row(d).result.comparison.interval = [1, -1] },
    (d) => { row(d).result.jobs = 99 },
    (d) => { row(d).result.comparison.change = 99 },
    (d) => { row(d).result.private = "PRIVATE" },
    (d) => { row(d).result.reasons = ["PRIVATE"] },
    (d) => { row(d).result.bounds = { change: "lower" } },
    (d) => { row(d).card.path = "/private" },
    (d) => { d.method.confidence = 1 },
    (d) => { d.sources.facts = "epoch:1792167000000" },
  ]) {
    const changed = structuredClone(doc)
    mutate(changed)
    assert.deepEqual(checkNumbers({ improvement_checks: changed }), [{ path: "improvement_checks", code: "improvement_checks_invalid" }])
  }
  assert.ok(checkNumbers({ nested: { improvement_checks: doc } }).length)
  assert.ok(checkNumbers({ improvement_checks: doc, raw: 4 }).some((v) => v.code === "bare_number"))
})

const FIXTURES = join(ROOT, "site/dist/task1-validation", `checks-${process.pid}`)
let fixtureIndex = 0
function fixture() {
  const dir = join(FIXTURES, String(++fixtureIndex))
  const main = join(dir, "main"), reports = join(dir, "reports"), desk = join(dir, "desk"), out = join(dir, "dist/data.json")
  for (const d of [main, reports, dirname(out)]) mkdirSync(d, { recursive: true })
  for (const name of ["main", "reports", "desk"]) {
    const path = join(dir, name)
    mkdirSync(path, { recursive: true })
    execFileSync("git", ["init", "-q", path])
    execFileSync("git", ["-C", path, "-c", "user.name=Fixture", "-c", "user.email=16390116+arimendelow@users.noreply.github.com", "commit", "-qm", "fixture", "--allow-empty"])
  }
  const pipeline = join(desk, "plugins/desk/mcp/src/factory/pipeline")
  mkdirSync(pipeline, { recursive: true })
  const write = (file, text) => writeFileSync(join(pipeline, file), text)
  writeFileSync(join(desk, "plugins/desk/mcp/package.json"), '{"type":"module"}')
  write("kaizen.js", "export const parseCard = () => ({ok:false,errors:[{code:'no_block'}]}); export const checkCard = () => {throw Error('check runtime')}")
  write("compare.js", "export const CONFIDENCE=0.95, BOOTSTRAP_RESAMPLES=10000, MIN_GROUPS_PER_SIDE=6")
  write("build.js", "let calls=0; export function storeRecords() { if (++calls !== 1) throw Error('records read twice'); return [] }")
  writeFileSync(out, "LAST_GOOD_DEPLOY")
  console.log(`Created task-owned fixture: ${dir}`)
  return { dir, main, reports, desk, out, write }
}
function runBuild(fx, extra = [], offline = true, nodeArgs = []) {
  return spawnSync(process.execPath, [
    ...nodeArgs, join(ROOT, "site/scripts/build-data.mjs"), "--main", fx.main, "--reports", fx.reports, "--out", fx.out, ...extra,
  ], { encoding: "utf8", env: { ...process.env, FACTORY_SITE_OFFLINE: offline ? "1" : "0", GITHUB_TOKEN: "", GH_TOKEN: "" } })
}

test("offline builds publish explicit unavailable checks; production requires an explicit Desk source", () => {
  const fx = fixture()
  const offline = runBuild(fx)
  assert.equal(offline.status, 0, offline.stderr)
  assert.equal(JSON.parse(readFileSync(fx.out)).improvement_checks.availability, "unavailable")
  writeFileSync(fx.out, "LAST_GOOD_DEPLOY")
  const production = runBuild(fx, [], false)
  assert.notEqual(production.status, 0)
  assert.match(production.stderr, /desk.*required/i)
  assert.equal(readFileSync(fx.out, "utf8"), "LAST_GOOD_DEPLOY")
})

test("explicit Desk imports preserve ESM and records are read once even without fetched cards", () => {
  const fx = fixture()
  const built = runBuild(fx, ["--desk", fx.desk])
  assert.equal(built.status, 0, built.stderr)
  const data = JSON.parse(readFileSync(fx.out))
  assert.deepEqual(checkNumbers(data), [])
  assert.match(data.improvement_checks.sources.desk, /^[a-f0-9]{40}$/)
  assert.match(data.improvement_checks.sources.facts, /^[a-f0-9]{40}$/)
  assert.match(data.improvement_checks.sources.reports, /^[a-f0-9]{40}$/)
})

test("missing imports and runtime storeRecords failures fail explicitly without overwriting the last deploy", () => {
  for (const [file, source, pattern] of [
    ["kaizen.js", "export const parseCard = () => null", /canonical|export|checkCard/i],
    ["build.js", "import './missing.js'; export const storeRecords=()=>[]", /missing|canonical/i],
    ["build.js", "export function storeRecords(){throw Error('records runtime')}", /records runtime/],
    ["build.js", "export function storeRecords(){return null}", /records|canonical/i],
  ]) {
    const fx = fixture()
    fx.write(file, source)
    const built = runBuild(fx, ["--desk", fx.desk])
    assert.notEqual(built.status, 0, file)
    assert.match(built.stderr, pattern)
    assert.equal(readFileSync(fx.out, "utf8"), "LAST_GOOD_DEPLOY")
  }
})

test("production evaluates fetched open and closed cards but never catches comparison runtime failures", () => {
  const fx = fixture()
  const preload = join(fx.dir, "public-fetch.mjs")
  const issues = [issue(), issue({ number: 54, state: "open", url: "https://github.com/ourostack/factory/issues/54" })]
    .map((i) => ({ ...i, html_url: i.url }))
  writeFileSync(preload, `globalThis.fetch=async(url)=>({ok:true,headers:new Headers(),json:async()=>String(url).includes('labels=kaizen')?${JSON.stringify(issues)}:[]})`)
  fx.write("kaizen.js", `export const parseCard=()=>({ok:true,card:${JSON.stringify(card())}}); export const checkCard=()=>{throw Error('check runtime')}`)
  const failed = runBuild(fx, ["--desk", fx.desk], false, ["--import", preload])
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /check runtime/)
  assert.equal(readFileSync(fx.out, "utf8"), "LAST_GOOD_DEPLOY")
  fx.write("kaizen.js", `export const parseCard=()=>({ok:true,card:${JSON.stringify(card())}}); export function checkCard(card, records, {seed}) {
    if (![53,54].includes(seed)) throw Error('wrong seed');
    return ${JSON.stringify(result())}
  }`)
  const built = runBuild(fx, ["--desk", fx.desk], false, ["--import", preload])
  assert.equal(built.status, 0, built.stderr)
  const doc = JSON.parse(readFileSync(fx.out)).improvement_checks
  assert.equal(row(doc).result.verdict, "confirmed")
  assert.equal(doc.checks["ourostack/factory#54"].issue_state, "open")
  assert.equal(row(doc).issue_state, "closed")
  assert.equal(doc.availability, "available")
})

test("a missing ESM package boundary cannot silently turn canonical imports into an unavailable preview", () => {
  const fx = fixture()
  writeFileSync(join(fx.desk, "plugins/desk/mcp/package.json"), '{"type":"commonjs"}')
  const built = runBuild(fx, ["--desk", fx.desk])
  assert.notEqual(built.status, 0)
  assert.equal(readFileSync(fx.out, "utf8"), "LAST_GOOD_DEPLOY")
})

test("current Desk real card checks preserve the missing-baseline result and shared-session groups", async () => {
  if (!process.env.DESK_DIR) {
    assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1", "current Desk source required")
    return
  }
  const pipeline = join(resolve(process.env.DESK_DIR), "plugins/desk/mcp/src/factory/pipeline")
  const { parseCard, checkCard } = await import(pathToFileURL(join(pipeline, "kaizen.js")))
  const raw = "```yaml\nkaizen: 1\nsignal: human_wait\njob_class: any\nevidence_jobs: []\ncountermeasure: https://github.com/ourostack/desk/pull/65\nplugin: desk\nversion: 3.2.0-alpha.108\nhypothesis: { measure: human_wait, direction: down }\n```"
  const records = Array.from({ length: 5 }, (_, n) => ({
    job: String(n), sessions: ["shared"], job_class: "other", finished: true,
    plugins: { desk: { min: "3.2.0-alpha.108", max: "3.2.0-alpha.108" } },
    measures: { human_wait: { state: "measured", value: 30 } },
  }))
  const doc = build({ issues: [issue({ body: raw })], records, parseCard, checkCard })
  assert.equal(row(doc).result.verdict, "too_few_jobs")
  assert.deepEqual(row(doc).result.comparison.before, { jobs: 0, groups: 0, median: null })
  assert.deepEqual(row(doc).result.comparison.after, { jobs: 5, groups: 1, median: 30 })
  assert.equal(row(doc).result.comparison.interval, null)
})
