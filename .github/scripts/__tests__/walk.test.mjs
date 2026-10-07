// The Lean walk's shell: routes and old-link redirects, the task that #/
// opens, task names, finish order, the three-state status line, the bar
// scale rule, the published data files and llms.txt, and the page's own
// rules (no decorative cards, no "you", no calendar dates).
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { finishOrder, firstAdded } from "../../../site/scripts/finish-order.mjs"
import { cleanTitle, orderByOpened, prOpenedAt, taskNames } from "../../../site/scripts/task-names.mjs"
import { READ_WHOLE_BYTES, llmsText, publishData, sizeLine } from "../../../site/scripts/publish-files.mjs"
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { measured, unavailable } from "../../../site/scripts/state.mjs"

const F = createRequire(import.meta.url)("../../../site/src/format.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

// ------------------------------------------------------------------ routes

test("each route names its view, and #/ is the task that finished last", () => {
  assert.deepEqual(F.parseRoute(""), { view: "task", job: null })
  assert.deepEqual(F.parseRoute("#/"), { view: "task", job: null })
  assert.deepEqual(F.parseRoute("#"), { view: "task", job: null })
  assert.deepEqual(F.parseRoute("#/task/abc_12-x"), { view: "task", job: "abc_12-x" })
  assert.deepEqual(F.parseRoute("#/task/abc/session/s-1"), { view: "session", job: "abc", session: "s-1" })
  assert.deepEqual(F.parseRoute("#/session/s-1"), { view: "session", job: null, session: "s-1" })
  for (const v of ["compare", "causes", "act", "why", "about", "store"]) {
    assert.deepEqual(F.parseRoute(`#/${v}`), { view: v })
    assert.deepEqual(F.parseRoute(`#/${v}/`), { view: v })
  }
  assert.deepEqual(F.parseRoute("#main"), { view: "skip" })
  for (const bad of ["#/nope", "#/task", "#/task/a/b", "#/task/../x", "#/task/a b", "#/task/<x>", "#/session/a/b", "#nonsense", "javascript:alert(1)"]) {
    assert.deepEqual(F.parseRoute(bad), { view: "missing" }, bad)
  }
  // The tab that shows as current.
  assert.equal(F.stepOf("task"), "task")
  assert.equal(F.stepOf("session"), "task")
  for (const v of ["compare", "causes", "act"]) assert.equal(F.stepOf(v), v)
  for (const v of ["why", "about", "store", "missing"]) assert.equal(F.stepOf(v), null)
})

test("old links redirect: #job- to the task, #session- to the session under its task when the task is known", () => {
  const jobOf = (s) => ({ s1: "j1", bad: "../x" })[s] || null
  assert.deepEqual(F.parseRoute("#job-abc123", jobOf), { view: "redirect", to: "#/task/abc123" })
  assert.deepEqual(F.parseRoute("#session-s1", jobOf), { view: "redirect", to: "#/task/j1/session/s1" })
  assert.deepEqual(F.parseRoute("#session-s2", jobOf), { view: "redirect", to: "#/session/s2" })
  assert.deepEqual(F.parseRoute("#session-bad", jobOf), { view: "redirect", to: "#/session/bad" }, "a malformed job never reaches a link")
  assert.deepEqual(F.parseRoute("#session-s1"), { view: "redirect", to: "#/session/s1" })
  assert.deepEqual(F.parseRoute("#job-a/b"), { view: "missing" })
  // The first site's section anchors land on their new pages.
  assert.deepEqual(F.parseRoute("#fix"), { view: "redirect", to: "#/causes" })
  assert.deepEqual(F.parseRoute("#tasks"), { view: "redirect", to: "#/compare" })
  assert.deepEqual(F.parseRoute("#guide"), { view: "redirect", to: "#/about" })
  assert.deepEqual(F.parseRoute("#answer"), { view: "redirect", to: "#/store" })
  for (const to of Object.values(F.OLD_ANCHORS)) assert.notEqual(F.parseRoute(to).view, "missing", to)
  // Every redirect target is itself a route.
  for (const h of ["#job-abc", "#session-s1"]) assert.notEqual(F.parseRoute(F.parseRoute(h, jobOf).to).view, "missing")
})

test("route links built from data are plain segments only", () => {
  assert.equal(F.safeRoute("task", "abc"), "#/task/abc")
  assert.equal(F.safeRoute("task", "abc", "session", "s-1"), "#/task/abc/session/s-1")
  for (const bad of [["task", "../x"], ["task", "a b"], ["task", ""], ["task", 5], ["javascript:alert(1)"]]) assert.equal(F.safeRoute(...bad), null, String(bad))
})

test("#/ opens the labeled done task that finished last, and falls back without one", () => {
  const j = (id, status, order, basis) => ({ id, status, finish_order: order === null ? unavailable(["no_facts"]) : measured(order), finish_basis: basis })
  assert.equal(F.defaultTask([j("a", "done", 1, "labels"), j("b", "done", 3, "labels"), j("c", "processing", 4, "facts"), j("d", "done", 5, "facts")]).id, "b")
  assert.equal(F.defaultTask([j("c", "processing", 2, "facts"), j("d", "done", 1, "facts")]).id, "d", "a done task without labels when none has labels")
  assert.equal(F.defaultTask([j("c", "processing", 2, "facts"), j("e", "drafting", 1, "facts")]).id, "c")
  assert.equal(F.defaultTask([j("x", "drafting", null, "none")]).id, "x")
  assert.equal(F.defaultTask([]), null)
})

test("#/ lands on a done task with at least ten minutes of work from the latest finish group, preferring a named one", () => {
  const j = (id, order, group, workMs, name, status = "done") => ({ id, status, finish_order: measured(order), finish_group: measured(group), finish_basis: "labels", active_time_ms: workMs === null ? unavailable(["source_unreadable"]) : measured(workMs), ...(name ? { name } : {}) })
  const MIN = 60000
  // Group 2 is the latest; within it the 37-second task is skipped, and the named task wins over a later unnamed one.
  const jobs = [j("old", 1, 1, 50 * MIN, "Old named"), j("tiny", 6, 2, 30000), j("unnamed", 5, 2, 40 * MIN), j("named", 4, 2, 12 * MIN, "Fix the build"), j("unread", 3, 2, null, "No working time")]
  assert.equal(F.defaultTask(jobs).id, "named")
  // Without a named task in the group, the latest position with enough work.
  assert.equal(F.defaultTask(jobs.filter((x) => x.id !== "named")).id, "unnamed")
  // A partial working time counts by its lower bound.
  assert.equal(F.defaultTask([j("p", 2, 1, 0), { ...j("q", 1, 1, 0), active_time_ms: { state: "partial", value: 11 * MIN, reasons: ["session_open"], bound: "lower" } }]).id, "q")
  // When the latest group has nothing long enough, an earlier group is used.
  assert.equal(F.defaultTask([j("tiny", 3, 2, 1000), j("old", 1, 1, 50 * MIN)]).id, "old")
  // An open task never lands, however long.
  assert.equal(F.defaultTask([j("open", 9, 3, 90 * MIN, "Open", "processing"), j("old", 1, 1, 50 * MIN)]).id, "old")
  assert.equal(F.LANDING_MIN_WORK_MS, 10 * MIN)
  // About states both rules.
  const about = read("site/src/index.html")
  assert.match(about, /Tasks whose labels landed together are ordered by lead time, so the longest of them takes the latest position\./)
  assert.match(about, /opens on a done task with at least ten minutes of agent working time from the latest group of tasks to finish, preferring one with a public name\./)
})

test("tasks first labeled in the same commit share a finish group and are ordered by lead time, the longest latest", () => {
  const lead = (v) => (v === null ? unavailable(["not_recorded"]) : measured(v))
  const jobs = [
    { id: "short", lead_time_ms: lead(37000), sessions: [{ session_id: "s1" }] },
    { id: "long", lead_time_ms: lead(9e6), sessions: [{ session_id: "s2" }] },
    { id: "mid", lead_time_ms: { state: "partial", value: 5e6, reasons: ["censored"], bound: "lower" }, sessions: [{ session_id: "s3" }] },
    { id: "none", lead_time_ms: lead(null), sessions: [{ session_id: "s4" }] },
    { id: "first", lead_time_ms: lead(1), sessions: [{ session_id: "s5" }] },
  ]
  const labelAdded = new Map([["labels/first/a.json", 0], ...["short", "long", "mid", "none"].map((id) => [`labels/${id}/a.json`, 3])])
  const out = finishOrder(jobs, { labelAdded })
  const order = [...out].sort((a, b) => a[1].finish_order.value - b[1].finish_order.value).map(([id]) => id)
  assert.deepEqual(order, ["first", "none", "short", "mid", "long"])
  assert.deepEqual(out.get("first").finish_group, measured(1))
  for (const id of ["short", "long", "mid", "none"]) assert.deepEqual(out.get(id).finish_group, measured(2))
  assert.deepEqual(checkNumbers({ jobs: [...out.values()] }), [])
})

test("a task is named after its earliest-opened public pull request, on the job clock, falling back to the report's order", async () => {
  const pr = (repo, n) => ({ ref: `#${n}`, url: `https://github.com/${repo}/pull/${n}` })
  const list = [pr("o/desk", 1), pr("o/desk", 2), pr("o/app", 7)]
  // From facts: session s2 starts later on the job clock, but its reference to app#7 comes first overall.
  const report = { timeline: { sessions: [{ id: "s1", offset_ms: -5000 }, { id: "s2", offset_ms: 1000 }] } }
  const prsOfSession = new Map([
    ["s1", [{ repo: "o/desk", number: 1, at_ms: 9000 }, { repo: "o/desk", number: 2, at_ms: 20000 }, { repo: "o/app", number: 7 }]],
    ["s2", [{ repo: "o/app", number: 7, at_ms: 100 }, { repo: "o/desk", number: 1, at_ms: 50 }]],
  ])
  const at = prOpenedAt(report, prsOfSession)
  assert.deepEqual([...at].sort(), [["o/app#7", 1100], ["o/desk#1", 1050], ["o/desk#2", 15000]].sort())
  assert.deepEqual(orderByOpened(list, at).map((p) => p.url.split("/").slice(-3).join("/")), ["desk/pull/1", "app/pull/7", "desk/pull/2"])
  // The report's own pull request times, when present, win.
  const withTimes = prOpenedAt({ timeline: { prs: [{ repo: "o/desk", number: 2, at_ms: -3 }], sessions: report.timeline.sessions } }, prsOfSession)
  assert.deepEqual([...withTimes], [["o/desk#2", -3]])
  assert.equal(orderByOpened(list, withTimes)[0].url, "https://github.com/o/desk/pull/2")
  // No time at all: the report's order stands.
  assert.deepEqual(orderByOpened(list, prOpenedAt({}, new Map())), list)
  // The name follows the order it is given.
  const names = await taskNames([{ id: "j", pull_requests: orderByOpened(list, at) }], async (repo, n) => ({ title: `${repo} ${n}`, private: false }))
  assert.equal(names.get("j").name, "o/desk 1")
  const names2 = await taskNames([{ id: "j", pull_requests: orderByOpened(list, withTimes) }], async (repo, n) => ({ title: `${repo} ${n}`, private: false }))
  assert.equal(names2.get("j").name, "o/desk 2")
  // The build wires it in and publishes no time.
  const build = read("site/scripts/build-data.mjs")
  assert.match(build, /j\.pull_requests = orderByOpened\(j\.pull_requests, prOpenedAt\(jobReports\.get\(j\.id\), prsOfSession\)\)/)
})

test("the Act lede does not promise a check that does not exist yet", () => {
  const html = read("site/src/index.html")
  const act = html.slice(html.indexOf('id="view-act"'), html.indexOf('id="view-why"'))
  assert.match(act, /a check needs labeled tasks on both sides of the countermeasure, before and after it shipped, and no issue has that yet/)
  assert.doesNotMatch(act, /a check that the countermeasure worked/)
})

test("ordinals read in words a reader expects", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(F.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th"])
})

// -------------------------------------------------------------- task names

test("a task is named after its first public pull request and N more, or is a private task with a short key", () => {
  assert.deepEqual(F.taskName({}, { id: "0123456789abcdef", name: "Fix the build", more_prs: measured(3), pull_requests: [{}, {}, {}, {}] }), { title: "Fix the build", more: 3, kind: "public", short: "01234567" })
  assert.equal(F.taskNameText({}, { id: "x", name: "Fix the build", more_prs: measured(3) }), "Fix the build and 3 more")
  assert.equal(F.taskNameText({}, { id: "x", name: "Fix the build", more_prs: measured(0) }), "Fix the build")
  assert.equal(F.taskNameText({}, { id: "0123456789abcdef", pull_requests: [] }), "Private task 01234567")
  assert.equal(F.taskName({}, { id: "0123456789abcdef", pull_requests: [{ ref: "#1" }] }).kind, "unnamed", "public pull requests whose titles were not fetched are not called private")
  // On the operator's own machine, the local name wins.
  const names = F.parseLocalNames({ version: 1, jobs: { x: { title: "Real card title" } } })
  assert.equal(F.taskNameText(names, { id: "x", name: "PR title", more_prs: measured(2) }), "Real card title")
})

test("the build names a task from its first readable public pull request title, and never from a private repository", async () => {
  const pulls = {
    "o/pub#1": { title: "First  public\ttitle\u0007", private: false },
    "o/pub#2": { title: "Second", private: false },
    "o/priv#5": { title: "Secret", private: true },
  }
  const calls = []
  const get = async (repo, n) => {
    calls.push(`${repo}#${n}`)
    return pulls[`${repo}#${n}`] || null
  }
  const pr = (repo, n) => ({ ref: `#${n}`, url: `https://github.com/${repo}/pull/${n}` })
  const out = await taskNames(
    [
      { id: "a", pull_requests: [pr("o/pub", 1), pr("o/pub", 2), pr("o/pub", 3)] },
      { id: "b", pull_requests: [pr("o/priv", 5)] },
      { id: "c", pull_requests: [] },
      { id: "d", pull_requests: [pr("o/gone", 9), pr("o/pub", 2)] },
    ],
    get,
  )
  assert.deepEqual(out.get("a"), { name: "First public title", more_prs: measured(2) })
  assert.deepEqual(out.get("b"), {}, "a private repository never names a task")
  assert.deepEqual(out.get("c"), {})
  assert.deepEqual(out.get("d"), { name: "Second", more_prs: measured(1) }, "an unreadable pull request is skipped")
  assert.ok(!calls.includes("o/pub#3"), "only as many pull requests are read as it takes")
  assert.equal(cleanTitle("   "), null)
  assert.equal(cleanTitle("x".repeat(400)).length, 160)
  // A title that is only digits still passes the numbers check as a name.
  assert.deepEqual(checkNumbers({ jobs: [{ id: "a", name: "1234", more_prs: measured(0), finish_order: measured(1) }] }), [])
})

// ------------------------------------------------------------- finish order

test("finish order is the order of each task's first label commit, then open tasks by first facts, with ties broken the same way every time", () => {
  const jobs = [
    { id: "late", sessions: [{ session_id: "s3" }] },
    { id: "early", sessions: [{ session_id: "s1" }] },
    { id: "tieB", sessions: [{ session_id: "s2" }] },
    { id: "tieA", sessions: [{ session_id: "s4" }] },
    { id: "open2", sessions: [{ session_id: "s6" }] },
    { id: "open1", sessions: [{ session_id: "s5" }, { session_id: "s7" }] },
    { id: "nothing", sessions: [] },
  ]
  const labelAdded = new Map([
    ["labels/early/s1.json", 0],
    ["labels/tieA/s4.json", 2],
    ["labels/tieB/s2.json", 2],
    ["labels/late/s3.json", 5],
    ["labels/late/other.json", 1],
    ["labels/bad path/x.json", 0],
  ])
  const factsAdded = new Map([["facts/f1.json", 0], ["facts/f2.json", 1], ["facts/f3.json", 1], ["facts/f4.json", 3], ["facts/f5.json", 4], ["facts/f6.json", 2], ["facts/f7.json", 9]])
  const factsFileOf = new Map([["s1", "f1.json"], ["s2", "f2.json"], ["s3", "f3.json"], ["s4", "f4.json"], ["s5", "f5.json"], ["s6", "f6.json"], ["s7", "f7.json"]])
  const out = finishOrder(jobs, { labelAdded, factsAdded, factsFileOf })
  const order = [...out].filter(([, v]) => v.finish_order.state === "measured").sort((a, b) => a[1].finish_order.value - b[1].finish_order.value).map(([id]) => id)
  // "late" got its first label in commit 1, so it finished second; tieB and tieA landed together and tieB's first facts came first.
  assert.deepEqual(order, ["early", "late", "tieB", "tieA", "open2", "open1"])
  assert.equal(out.get("early").finish_basis, "labels")
  assert.equal(out.get("open1").finish_basis, "facts")
  assert.deepEqual(out.get("nothing"), { finish_order: unavailable(["no_facts"]), finish_basis: "none" })
  assert.deepEqual(checkNumbers({ jobs: [...out.values()] }), [])
})

test("finish order reads git history: the commit that first added a path, oldest first, and only the position", () => {
  const dir = mkdtempSync(join(tmpdir(), "finish-order-"))
  execFileSync("git", ["init", "-q", dir])
  const commit = (files, msg) => {
    for (const [p, t] of Object.entries(files)) write(join(dir, p), t)
    execFileSync("git", ["-C", dir, "add", "."])
    execFileSync("git", ["-C", dir, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", msg])
  }
  commit({ "facts/a.json": "{}", "facts/b.json": "{}" }, "intake")
  commit({ "labels/jb/b.json": "{}" }, "labels b")
  commit({ "labels/ja/a.json": "{}", "facts/c.json": "{}" }, "labels a")
  commit({ "labels/jb/b.json": "{\"changed\":1}" }, "relabel b")
  const labels = firstAdded(dir, "labels/")
  assert.deepEqual([...labels], [["labels/jb/b.json", 0], ["labels/ja/a.json", 1]], "a later change to a label file does not move its task")
  const facts = firstAdded(dir, "facts/")
  assert.equal(facts.get("facts/a.json"), 0)
  assert.equal(facts.get("facts/c.json"), 1)
  assert.deepEqual([...firstAdded(join(dir, "nope"), "labels/")], [])
  const out = finishOrder([{ id: "ja", sessions: [{ session_id: "a" }] }, { id: "jb", sessions: [{ session_id: "b" }] }], { labelAdded: labels, factsAdded: facts, factsFileOf: new Map([["a", "a.json"], ["b", "b.json"]]) })
  assert.equal(out.get("jb").finish_order.value, 1)
  assert.equal(out.get("ja").finish_order.value, 2)
  // No date anywhere in what is published.
  assert.doesNotMatch(JSON.stringify([...out]), /\d{4}-\d{2}-\d{2}|T\d{2}:/)
})

test("the build publishes finish order and the name fields on every task row", () => {
  const dir = mkdtempSync(join(tmpdir(), "walk-build-"))
  const reports = join(dir, "reports")
  const main = join(dir, "main")
  const json = (p, o) => write(p, JSON.stringify(o))
  json(join(reports, "rollups/coverage.json"), { sessions_with_facts: 2, jobs: 2, jobs_open: 1, labels: { files: 1 } })
  json(join(reports, "rollups/measures.json"), { groupings: {} })
  json(join(reports, "rollups/muda.json"), { groupings: { overall: { all: { jobs: 2, jobs_labeled: 1, wastes: [] } } }, wastes: [] })
  const job = (id, status, session) => ({ job: id, formulas: { status: { class: "declared", value: status }, lead_time_ms: { class: "declared", value: 1000 } }, timeline: { intervals: [{ session_id: session, host: "claude-code" }] } })
  json(join(reports, "jobs/done1.json"), job("done1", "done", "s1"))
  json(join(reports, "jobs/open1.json"), job("open1", "processing", "s2"))
  const facts = (id, jobId) => ({ schema: "desk.factory.published/1", session: { host: "claude-code", id, duration_ms: 600000, ended: true, entrypoint: "cli", host_version: "1" }, models: [], agents: [], intervals: [{ kind: "turn", start_ms: 0, end_ms: 400000 }], counts: { tool_calls: {}, tool_failures: {}, api_retries: 0, compactions: 0, tool_retries: 0 }, refs: { prs: [] }, jobs: [{ job: jobId }], unavailable: [] })
  json(join(main, "facts/claude-code-s2.json"), facts("s2", "open1"))
  execFileSync("git", ["init", "-q", main])
  const commit = (msg) => {
    execFileSync("git", ["-C", main, "add", "."])
    execFileSync("git", ["-C", main, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", msg])
  }
  commit("open task's facts first")
  json(join(main, "facts/claude-code-s1.json"), facts("s1", "done1"))
  json(join(main, "labels/done1/s1.json"), { job: "done1", session: "s1", stretches: [] })
  commit("done task")
  const out = join(dir, "dist/data.json")
  const r = spawnSync("node", [new URL("../../../site/scripts/build-data.mjs", import.meta.url).pathname, "--reports", reports, "--main", main, "--out", out], { env: { ...process.env, FACTORY_SITE_OFFLINE: "1", GITHUB_TOKEN: "" }, encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(out, "utf8"))
  const by = Object.fromEntries(data.jobs.map((j) => [j.id, j]))
  assert.deepEqual([by.done1.finish_order, by.done1.finish_basis], [measured(1), "labels"], "a labeled task comes before open ones, even if its facts came later")
  assert.deepEqual([by.open1.finish_order, by.open1.finish_basis], [measured(2), "facts"])
  // Offline, no title is read, so no task is named.
  assert.ok(!("name" in by.done1) && !("name" in by.open1))
  assert.deepEqual(checkNumbers(data), [])
})

// -------------------------------------------------------------- status line

const healthyLoop = { verdict: { status: "healthy", missing: [] }, alarms: [] }
const measuredCapture = { share: { state: "measured", value: 0.9, reasons: [] }, alarms: [] }
const alive = { status: "alive", reason: "fine" }

test("the status line is normal only when everything it rests on was checked, and names what was checked", () => {
  const s = F.statusLine({ verdict: alive, andon: [], andonVerification: "verified", capture: measuredCapture, loop: healthyLoop })
  assert.equal(s.state, "normal")
  assert.deepEqual(s.checked, ["the site's own build", "andon issues", "capture coverage", "the improvement loop"])
  assert.deepEqual(s.alarms, [])
})

test("empty alarms with no monitoring data read not monitored, never normal, and say what is not recorded", () => {
  // Today's store: no capture records, no loop records, no andon issue.
  const s = F.statusLine({
    verdict: alive,
    andon: [],
    andonVerification: "verified",
    capture: { share: { state: "unavailable", reasons: ["no_records"] }, alarms: [] },
    loop: { verdict: { status: "cannot_tell", missing: [{ figure: "x", codes: ["no_loop_records"] }] }, alarms: [] },
  })
  assert.equal(s.state, "not_monitored")
  assert.equal(s.missing.length, 2)
  assert.match(s.missing[0], /capture coverage \(no machine has published a capture record yet\)/)
  assert.match(s.missing[1], /improvement loop's health \(no machine has sent its improvement loop's health yet\)/)
  // Nothing at all: still not monitored.
  assert.equal(F.statusLine({}).state, "not_monitored")
  assert.equal(F.statusLine({ verdict: alive, andonVerification: "unavailable", capture: measuredCapture, loop: healthyLoop }).state, "not_monitored")
  assert.equal(F.statusLine({ verdict: { status: "unknown", reason: "no health record" }, andonVerification: "verified", capture: measuredCapture, loop: healthyLoop }).state, "not_monitored")
})

test("any alarm is abnormal, names itself, and says who is on it or that no one is", () => {
  const andon = [{ ref: "#9", url: "https://github.com/o/r/issues/9", issue_state: "open" }, { ref: "#8", url: "https://github.com/o/r/issues/8", issue_state: "closed" }]
  const s = F.statusLine({ verdict: alive, andon, andonVerification: "verified", capture: { ...measuredCapture, alarms: [{ host: "codex", code: "coverage_low" }] }, loop: { verdict: { status: "alarm", missing: [] }, alarms: [{ code: "steps_stale" }] } })
  assert.equal(s.state, "abnormal")
  assert.equal(s.alarms.length, 3, "a closed andon issue is not an alarm")
  assert.deepEqual(s.alarms[0].owner, { ref: "#9", url: "https://github.com/o/r/issues/9" })
  assert.match(s.alarms[1].text, /codex/)
  assert.equal(s.alarms[1].owner, null)
  assert.match(s.alarms[2].text, /stopped succeeding/)
  // A stale or broken site is abnormal too, even with nothing else recorded.
  assert.equal(F.statusLine({ verdict: { status: "stale", reason: "built 3 days ago" } }).state, "abnormal")
  assert.equal(F.statusLine({ verdict: { status: "broken", reason: "reports missing" } }).state, "abnormal")
  // The page says "no one is on this" for an alarm without an owner.
  assert.match(read("site/src/app.js"), /"no one is on this"/)
})

// --------------------------------------------------------------- bar scales

test("bar scales are linear from zero: shares run 0 to 100%, counts and durations to a stated round maximum", () => {
  const share = F.barScale([0.092, 0.055], { kind: "pct1" })
  assert.equal(share.max, 1)
  assert.equal(share.label, "scale 0 to 100%")
  // 9.2% draws longer than 5.5%, in proportion, on the same scale.
  assert.ok(share.width(0.092) > share.width(0.055))
  assert.ok(Math.abs(share.width(0.092) / share.width(0.055) - 0.092 / 0.055) < 1e-9)
  assert.equal(share.width(0.092), 9.2)
  const counts = F.barScale([1830, 12, 0], { kind: "count" })
  assert.equal(counts.max, 2000)
  assert.equal(counts.label, "scale 0 to 2,000")
  assert.equal(counts.width(1000), 50)
  assert.equal(counts.width(0), 0)
  assert.equal(counts.width(-5), 0)
  assert.equal(F.barScale([7], { kind: "compact" }).max, 8)
  const hours = F.barScale([53.7 * 3600000, 600000], { kind: "duration" })
  assert.equal(hours.max, 60 * 3600000)
  assert.equal(hours.label, "scale 0 to 60 hours")
  const minutes = F.barScale([37 * 60000], { kind: "duration" })
  assert.equal(minutes.label, "scale 0 to 40 minutes")
  assert.equal(F.barScale([], { kind: "count" }).max, 1, "an empty list still has a scale, never a division by zero")
  // A bar never runs past its track.
  assert.equal(counts.width(5000), 100)
  for (const v of [1, 7, 9.5, 10, 11, 99, 101, 1234567]) assert.ok(F.niceMax(v) >= v && F.niceMax(v) <= v * 2.5, v)
})

test("a log scale is never drawn as bars, and every bar list states its scale", () => {
  assert.throws(() => F.barScale([1, 100], { kind: "count", scale: "log" }), /never drawn as bars/)
  assert.throws(() => F.barScale([1], { kind: "text" }), /no bar scale/)
  const app = read("site/src/app.js")
  assert.doesNotMatch(app, /scale: "log"/)
  assert.doesNotMatch(app, /Math\.log1p/)
  assert.match(app, /const scale = F\.barScale\(values, \{ kind: opts\.kind, scale: opts\.scale \}\)/)
  assert.match(app, /el\("span", "bars-scale", ` (·|\\u00b7) \$\{scale\.label\}/)
  // The track spans the row and the fill sits inside it, so the track stays visible behind a full bar.
  const css = read("site/src/styles.css")
  assert.match(css, /\.bar-fill \{\n  position: absolute;\n  left: 2px;\n  top: 2px;\n  bottom: 2px;\n  max-width: calc\(100% - 4px\);/)
  assert.doesNotMatch(css, /grid-template-columns: minmax\(72px, 130px\) 1fr auto/)
})

// ------------------------------------------------------- the color system

test("every meaning color is defined for light and dark, in one fixed stacking order", () => {
  const css = read("site/src/styles.css")
  const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"))
  const light = css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"))
  const tokens = [...F.SEGMENTS.map((x) => x.token), "--c-alarm", "--c-accent"]
  for (const t of tokens) {
    assert.match(light, new RegExp(`${t}: #[0-9a-f]{6};`), `light ${t}`)
    assert.match(dark, new RegExp(`${t}: #[0-9a-f]{6};`), `dark ${t}`)
  }
  assert.deepEqual(F.SEGMENTS.slice(0, 2).map((x) => x.key), ["value", "support"], "value-adding at the base, necessary next")
  assert.deepEqual(F.SEGMENTS.slice(-3).map((x) => x.key), ["agents_working_unlabeled", "not_labeled", "no_session"])
  assert.equal(new Set(F.SEGMENTS.map((x) => x.token)).size, F.SEGMENTS.length, "one color per meaning")
  // Hatches come from the tokens, for CSS and for SVG.
  assert.match(css, /--hatch-agents-working: repeating-linear-gradient\(135deg, var\(--c-agents-working\)/)
  const html = read("site/src/index.html")
  assert.match(html, /<pattern id="hatch-agents-working"[\s\S]*?var\(--c-agents-working\)/)
  assert.match(html, /<pattern id="hatch-no-session"[\s\S]*?var\(--c-no-session\)/)
})

// ------------------------------------------------------- the page's rules

test("no decorative cards: no stat tiles, takeaway cards, pipeline steps or chart cards remain", () => {
  const html = read("site/src/index.html")
  const app = read("site/src/app.js")
  const css = read("site/src/styles.css")
  for (const cls of ["stat-tile", "chart-card", "pipeline-step", "takeaway\"", "featured-card", "kpi-row\" class"]) {
    assert.ok(!html.includes(cls) && !app.includes(`"${cls.replace(/"$/, "")}"`), cls)
  }
  for (const sel of [".stat-tile", ".chart-card", ".pipeline", ".featured-card", ".takeaway {"]) assert.ok(!css.includes(sel), sel)
  // The privacy rules and the data's journey are prose lists on About, with the finish-order rule.
  const about = html.slice(html.indexOf('id="view-about"'), html.indexOf('id="view-store"'))
  assert.match(about, /<h2 class="block-title">How this data gets here<\/h2>\s*<ol class="plain-list">/)
  assert.match(about, /<h2 class="block-title">No who, no when, just how<\/h2>\s*<ul class="plain-list">/)
  assert.match(about, /Only the position \(1st, 2nd, 3rd\) is published, never the date/)
})

test("public copy says the operator, not you, and shows no calendar date", () => {
  const html = read("site/src/index.html")
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ")
  assert.doesNotMatch(text, /\byou(r|rs|rself)?\b/i)
  const app = read("site/src/app.js")
  const strings = app.match(/"[^"\n]*"|`[^`\n]*`/g).join("\n")
  assert.doesNotMatch(strings, /\byou(r|rs|rself)?\b/i)
  assert.doesNotMatch(app, /dateStyle/)
  assert.doesNotMatch(app, /toLocaleDateString|toISOString/)
})

test("Why Lean? gives the eight wastes as our mapping, the glossary, and its sources inline", () => {
  const html = read("site/src/index.html")
  const why = html.slice(html.indexOf('id="view-why"'), html.indexOf('id="view-about"'))
  for (const w of ["Waiting", "Defects", "Extra processing", "Overproduction", "Motion", "Transportation", "Inventory", "Non-utilized talent"]) assert.match(why, new RegExp(`</span>${w}</dt>`), w)
  assert.match(why, /our own mapping/)
  for (const term of ["Lead time", "Working time", "Flow efficiency", "Value-adding", "Necessary", "Waste", "Value stream map", "Timeline ladder", "Inventory triangle", "Yamazumi", "Pareto chart", "A3", "Kaizen", "Andon"]) assert.match(why, new RegExp(`<dt>(<span[^>]*></span>)?${term}`), term)
  assert.match(why, /counts as the waiting waste, not the inventory waste/)
  assert.match(why, /classic yamazumi stacks each operator's work against takt/)
  assert.ok((why.match(/href="https:/g) || []).length >= 10, "sources are linked inline")
})

// ---------------------------------------------------- publishing the files

test("the Pages build copies the job and rollup files, tolerates missing ones, and writes the size line and llms.txt", () => {
  const dir = mkdtempSync(join(tmpdir(), "publish-"))
  const reports = join(dir, "reports")
  const dist = join(dir, "dist")
  write(join(dist, "data.json"), "{}")
  write(join(dist, "health.json"), "{}")
  write(join(reports, "jobs/aaaaaaaa11.json"), JSON.stringify({ x: "y".repeat(300 * 1024) }))
  write(join(reports, "jobs/aaaaaaaa11.md"), "# not published")
  write(join(reports, "jobs/aaaaaaaa11/session-1.json"), "{}")
  write(join(reports, "jobs/aaaaaaaa11/deeper/nope.json"), "{}")
  write(join(reports, "rollups/muda.json"), "{}")
  write(join(reports, "rollups/tasks.json"), "{}")
  write(join(reports, "rollups/index.md"), "#")
  const { copied, files } = publishData({ reports, dist })
  assert.deepEqual(copied.sort(), ["jobs/aaaaaaaa11.json", "jobs/aaaaaaaa11/session-1.json", "rollups/muda.json", "rollups/tasks.json"])
  assert.deepEqual(files.map((f) => f.path).sort(), ["data.json", "health.json", "jobs/aaaaaaaa11.json", "jobs/aaaaaaaa11/session-1.json", "rollups/muda.json", "rollups/tasks.json"])
  assert.match(sizeLine(files), /^Published data files: 6 files, 0\.29 MB total, largest jobs\/aaaaaaaa11\.json \(0\.29 MB\)$/)
  assert.equal(sizeLine([]), "Published data files: none")
  const txt = llmsText(read("site/src/llms-template.txt"), files)
  assert.match(txt, /^# The factory/)
  assert.match(txt, /1\. Follow a task[\s\S]*2\. Compare tasks[\s\S]*3\. Rank causes[\s\S]*4\. Act/)
  assert.match(txt, /- data\.json \(1 KB, small enough to read whole\)/)
  assert.match(txt, /- jobs\/aaaaaaaa11\.json \(\d+ KB, large: read only the parts you need\)/)
  assert.match(txt, /- rollups\/tasks\.json \(1 KB, small enough to read whole\): each task's lead time/)
  // A file the pipeline does not write yet is not listed.
  assert.doesNotMatch(txt, /stackup\.json|causes\.json \(/)
  assert.doesNotMatch(txt, /\{\{/)
  assert.ok(READ_WHOLE_BYTES >= 64 * 1024)
  // Nothing at all to copy is fine.
  assert.deepEqual(publishData({ reports: join(dir, "missing"), dist: join(dir, "empty") }).files, [])
})

test("the Pages workflow publishes the data files and llms.txt, and writes the size line to the step summary", () => {
  const wf = read(".github/workflows/pages.yml")
  assert.match(wf, /node site\/scripts\/publish-files\.mjs --reports _reports --dist site\/dist --template site\/src\/llms-template\.txt \| tee -a "\$GITHUB_STEP_SUMMARY"/)
  // It runs after the data build and before the upload.
  assert.ok(wf.indexOf("Build site data") < wf.indexOf("Publish data files") && wf.indexOf("Publish data files") < wf.indexOf("Upload Pages artifact"))
})

// A text cell must never collapse to a few characters wide on a phone (the
// store page's sign-off labels once rendered one letter per line at 390 px).
// The browser check behind this is in the S1 report; these are the CSS rules
// that cause or prevent it, checked without a browser.
test("no label or value column can collapse to a sliver at 320 or 390 px", () => {
  const css = read("site/src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "")
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2], at: m.index }))
  // 1. No grid gives its text column a zero minimum beside an auto column sized by the content.
  for (const r of rules) {
    assert.doesNotMatch(r.body, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/, `${r.sel} lets its label column shrink to nothing`)
  }
  // 2. Every grid of label/value pairs becomes one column at phone width, and that phone rule comes after (or is as specific as) any wider rule for it.
  const phoneOneCol = (sel) => {
    const re = new RegExp(`@media \\(max-width: (\\d+)px\\)\\s*\\{[^@]*?${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(,[^{]*)?\\{\\s*grid-template-columns:\\s*1fr;`, "g")
    return [...css.matchAll(re)].filter((m) => Number(m[1]) >= 560).map((m) => m.index)
  }
  for (const sel of [".health-facts", ".outcome-block .health-facts", ".facts-list"]) {
    const wide = rules.filter((r) => r.sel === sel && /grid-template-columns/.test(r.body) && !/grid-template-columns:\s*1fr;/.test(r.body)).map((r) => r.at)
    const phone = phoneOneCol(sel)
    assert.ok(phone.length, `${sel} has no one-column rule for phones`)
    assert.ok(Math.max(...phone) > Math.max(...wide), `${sel}: a wider rule after its phone rule would win on a phone`)
  }
  // 3. A label column that does keep two columns keeps a readable minimum width.
  const outcome = rules.find((r) => r.sel === ".outcome-block .health-facts" && /minmax/.test(r.body))
  assert.match(outcome.body, /minmax\(min\(12em, 100%\)/)
  // 4. A bar label keeps a readable minimum width; its value wraps between its own parts instead of squeezing the label.
  const label = rules.find((r) => r.sel === ".bar-label")
  const value = rules.find((r) => r.sel === ".bar-value")
  assert.match(label.body, /min-width:\s*min\(9em, 45%\)/)
  assert.match(value.body, /white-space:\s*normal/)
  assert.match(value.body, /min-width:\s*5em/)
  // 5. Grid and table cells may wrap long words rather than force their column wider.
  assert.match(css, /\.health-facts dt, \.health-facts dd \{ min-width: 0; overflow-wrap: break-word; \}/)
})

test("the store page renders each outcome section once, and the headline figure only once", () => {
  const app = read("site/src/app.js")
  const body = app.slice(app.indexOf("function renderOutcomes("), app.indexOf("// --------------------------------------------------------------- jobs"))
  for (const h of ["Sign-off", "First-pass yield", "What was sent back, and where it was caught"]) {
    assert.equal(body.split(`"${h}"`).length - 1, 1, h)
  }
  // The cost per accepted outcome is the headline above; this section does not repeat it.
  assert.doesNotMatch(body, /attention per accepted outcome|o\.attention\.headline/)
  assert.equal((app.match(/renderOutcomes\(document/g) || []).length, 1)
})

test("the task table shows a finish position only for a labeled task; an open one says open", () => {
  const app = read("site/src/app.js")
  assert.match(app, /const pos = j\.finish_basis === "labels" && placed \? F\.ordinal\(j\.finish_order\.value\) : !placed \? "no session" : j\.status === "done" \? "not labeled" : "open";/)
})
