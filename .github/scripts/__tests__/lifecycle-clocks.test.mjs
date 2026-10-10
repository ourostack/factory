import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { existsSync, readFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { enrichTasks, publishData } from "../../../site/scripts/publish-files.mjs"
import { isoWeek } from "../../../site/scripts/finish-date.mjs"
import { buildByWeek } from "../../../site/scripts/by-week.mjs"
import { jobSummary } from "../../../site/scripts/job-summary.mjs"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")
const fixture = JSON.parse(readFileSync(new URL("./fixtures/v12-clocks.json", import.meta.url), "utf8"))
const source = new URL("../../../", import.meta.url).pathname
const clock = fixture.cases[0].expected.production_ms
const read = (c) => S.readLifecycleClocks({ clocks: c })

// Catches invented absence, reclassification, direction guessing and timezone day shifts.
test("legacy_and_new_clock_precision", () => {
  assert.equal(typeof S.readLifecycleClocks, "function")
  assert.equal(typeof F.formatClock, "function")
  const legacy = { formulas: { lead_time_ms: { class: "declared", value: 65000 } }, acceptance_wait: { class: "declared", state: "measured", value: 1000, reasons: [] } }
  const before = structuredClone(legacy)
  const summary = jobSummary(legacy, "legacy.json")
  assert.equal(S.readLifecycleClocks(legacy), null)
  assert.deepEqual(legacy, before)
  assert.equal(F.toText(summary.lead_time_ms, "duration"), "1m (declared)")
  for (const c of fixture.cases) {
    assert.deepEqual(read(c.expected), c.expected, c.id)
    assert.deepEqual(checkNumbers({ jobs: [{ clocks: c.expected }] }), [], c.id)
    assert.match(F.formatClock(c.expected.request_to_delivery_ms, { zone: "America/Los_Angeles" }), /original request was not recorded/)
    assert.ok(!F.formatClock(c.expected.queue_ms).includes("0 ms"))
  }
  const opposing = fixture.cases.find((c) => c.id === "opposing_bounds").expected.production_remainder_ms
  assert.match(F.formatClock(opposing), /Direction not known/)
  for (const klass of ["measured", "declared", "inferred"]) {
    const row = { formulas: { signoff: { class: klass, value: "accepted", wait: { class: klass, value: "under_1_day" } } }, acceptance_wait: { ...clock, class: klass }, clocks: fixture.cases[0].expected }
    const copy = structuredClone(row)
    S.readLifecycleClocks(row)
    assert.deepEqual(row, copy, "acceptance is not converted to a Clock")
    const summary = jobSummary(row, "acceptance.json")
    assert.equal(summary.signoff.value, "accepted")
    assert.equal(summary.outcome, "accepted")
  }
  const day = { state: "measured", value: "2026-10-05", reasons: [], basis: "desk_transition" }
  assert.equal(F.finishDay(day, 2026).key, "2026-10-05")
  assert.deepEqual(isoWeek(day.value), { week: "2026-W41", starts_on: "2026-10-05" })
  const weekly = buildByWeek({
    stackup: { jobs: [{ job: "monday", status: { state: "measured", value: "done", reasons: [] }, lead_time_ms: { state: "measured", value: 4000, reasons: [] }, clocks: fixture.cases[0].expected }] },
    tasks: { jobs: [] },
    finishDates: new Map([["monday", day]]),
  })
  assert.equal(weekly.weeks[0].starts_on, "2026-10-05", "UTC Monday stays in its UTC week in Pacific")
  assert.equal(F.formatClock(clock, { zone: "America/Los_Angeles" }), F.formatClock(clock, { zone: "UTC" }), "durations have no wall clock timezone")
})

test("readers refuse malformed clocks instead of deriving episodes from timeline or prose", () => {
  assert.equal(typeof S.readLifecycleClocks, "function")
  for (const value of [null, {}, [], "private", 5]) assert.throws(() => read(value), TypeError)
  const mutations = [
    (c) => { delete c.production_ms },
    (c) => { c.private_prose = "PRIVATE_SENTINEL" },
    (c) => { c.production_ms.value = -1 },
    (c) => { c.production_ms.basis = ["declared"] },
    (c) => { c.request_to_delivery_ms = { ...clock, basis: ["recorded_activity"] } },
    (c) => { c.queue_ms = { ...clock, basis: ["original_request_not_recorded"] } },
    (c) => { c.production_periods.items[0].end_ms = null },
    (c) => { c.production_periods.items[0].end_basis = "private_epoch" },
    (c) => { c.production_periods.items[0].start_ms = 7000 },
    (c) => { c.production_periods.state = "unavailable" },
  ]
  for (const mutate of mutations) {
    const c = structuredClone(fixture.cases[0].expected)
    mutate(c)
    assert.throws(() => read(c), TypeError)
    assert.ok(checkNumbers({ jobs: [{ clocks: c }] }).length)
  }
  const row = { clocks: fixture.cases[3].expected, timeline: { transitions: [] }, private_request: "invent me" }
  assert.deepEqual(S.readLifecycleClocks(row), fixture.cases[3].expected, "only the producer's periods are read")
})

test("task twins retain producer clocks byte-for-value without store-owned episodes", () => {
  const clocks = fixture.cases[3].expected
  const enriched = enrichTasks({ jobs: [{ job: "a", clocks }] }, { jobs: [{ id: "a" }] })
  assert.deepEqual(enriched.jobs[0].clocks, clocks)
  assert.throws(() => enrichTasks({ jobs: [{ job: "a", clocks: {} }] }, { jobs: [] }), /clock/i)
})

for (const basis of ["terminal_observation", "recorded_work_end", "latest_observation"]) {
  test(`fallback production period (${basis}) cannot masquerade as an exact episode`, () => {
    const c = structuredClone(fixture.cases[0].expected)
    c.production_periods.items[0].end_basis = basis
    assert.ok(checkNumbers({ jobs: [{ clocks: c }] }).some((e) => e.code === "fallback_period_measured"), basis)
    assert.throws(() => read(c), TypeError)
  })
}
test("truncated production history cannot masquerade as an exact episode list", () => {
  const c = structuredClone(fixture.cases.find((c) => c.id === "truncated_segments").expected)
  c.production_periods = structuredClone(fixture.cases[0].expected.production_periods)
  assert.ok(checkNumbers({ jobs: [{ clocks: c }] }).some((e) => e.code === "episode_history_not_exact"))
  assert.throws(() => read(c), TypeError)
})

test("the exact ten synthetic clock cases remain pairable with Desk when its producer lands", () => {
  assert.deepEqual(fixture.cases.map((c) => c.id), ["new_request_unknown", "adopted_positive_uncaptured", "adopted_negative", "reopened", "late_work", "untimed_boundary", "root_wait_child_work", "ask_wait", "opposing_bounds", "truncated_segments"])
  assert.equal(fixture.synthetic, true)
  if (!process.env.DESK_DIR) {
    assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1", "Desk parity must run in CI")
    return
  }
  const producer = join(process.env.DESK_DIR, "plugins/desk/mcp/src/factory/pipeline/lifecycle-clocks.js")
  const pair = join(process.env.DESK_DIR, "tests/desk/mcp/__tests__/factory/fixtures/v12-clocks.json")
  if (existsSync(pair)) assert.deepEqual(readFileSync(pair), readFileSync(new URL("./fixtures/v12-clocks.json", import.meta.url)))
  if (existsSync(producer)) assert.ok(existsSync(pair), "Desk clock producer requires the byte-identical paired fixture")
})

// Catches build-data dropping additive keys, map/twin disagreement, and legacy regressions.
test("paired legacy Desk fixture build and synthetic clock projection preserve every legacy job", () => {
  if (!process.env.DESK_DIR) {
    assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1", "paired Desk build required")
    return
  }
  const dir = mkdtempSync(join(tmpdir(), "paired-clock-build-"))
  const main = join(dir, "main"), reports = join(dir, "reports"), dist = join(dir, "dist")
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, FACTORY_SITE_OFFLINE: "1", GH_TOKEN: "", GITHUB_TOKEN: "" } })
    console.log("paired-clock command:", JSON.stringify([process.execPath, ...args]), "exit:", r.status, "\n" + (r.stdout + r.stderr).slice(0, 65536))
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  try {
    mkdirSync(join(main, "facts"), { recursive: true })
    const fact = readdirSync(join(source, "facts")).find((n) => n.endsWith(".json") && JSON.parse(readFileSync(join(source, "facts", n), "utf8")).jobs?.length)
    writeFileSync(join(main, "facts", fact), readFileSync(join(source, "facts", fact)))
    writeFileSync(join(main, "factory.json"), readFileSync(join(source, "factory.json")))
    execFileSync("git", ["init", "-q", main])
    execFileSync("git", ["-C", main, "add", "."])
    execFileSync("git", ["-C", main, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "accepted legacy fixture"])
    run([join(process.env.DESK_DIR, "plugins/desk/mcp/scripts/factory.js"), "build", "--store", main, "--out", reports])
    const build = () => run([join(source, "site/scripts/build-data.mjs"), "--reports", reports, "--main", main, "--out", join(dist, "data.json")])
    build()
    const legacy = JSON.parse(readFileSync(join(dist, "data.json"), "utf8"))
    publishData({ reports, dist })
    const files = readdirSync(join(reports, "jobs")).filter((n) => n.endsWith(".json"))
    assert.ok(files.length > 0, "the actual legacy fixture must produce jobs")
    const oldMaps = new Map(files.filter((f) => existsSync(join(dist, "map", f))).map((f) => [f, JSON.parse(readFileSync(join(dist, "map", f), "utf8"))]))
    for (const c of fixture.cases) {
      // Synthetic reader input only: not evidence that the held Desk producer ran.
      for (const file of files) {
        const p = join(reports, "jobs", file)
        const doc = JSON.parse(readFileSync(p, "utf8"))
        doc.clocks = c.expected
        writeFileSync(p, JSON.stringify(doc))
      }
      for (const file of ["tasks.json", "stackup.json"]) {
        const p = join(reports, "rollups", file)
        if (!existsSync(p)) continue
        const doc = JSON.parse(readFileSync(p, "utf8"))
        for (const row of doc.jobs || []) row.clocks = c.expected
        writeFileSync(p, JSON.stringify(doc))
      }
      build()
      const data = JSON.parse(readFileSync(join(dist, "data.json"), "utf8"))
      assert.deepEqual(data.jobs.map(({ clocks, ...row }) => row), legacy.jobs, c.id)
      assert.deepEqual(checkNumbers(data), [])
      for (const row of data.jobs) assert.deepEqual(row.clocks, c.expected, c.id)
      publishData({ reports, dist })
      for (const file of ["tasks.json", "stackup.json"]) {
        const p = join(dist, "rollups", file)
        if (existsSync(p)) for (const row of JSON.parse(readFileSync(p, "utf8")).jobs || []) assert.deepEqual(row.clocks, c.expected)
      }
      for (const file of files) {
        const report = JSON.parse(readFileSync(join(dist, "jobs", file), "utf8"))
        assert.deepEqual(report.clocks, c.expected)
        const id = String(report.job?.id || report.timeline?.job || "")
        if (id && report.timeline) {
          const map = JSON.parse(readFileSync(join(dist, "map", `${id}.json`), "utf8"))
          assert.deepEqual(map.clocks, c.expected)
          const { clocks, ...rest } = map
          assert.deepEqual(rest, oldMaps.get(file), "legacy map is unchanged")
        }
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("whole golden legacy facts build retains pinned baseline numbers and report twins", () => {
  if (!process.env.DESK_DIR) {
    assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1", "whole legacy Desk build required")
    return
  }
  const dir = mkdtempSync(join(tmpdir(), "whole-legacy-clock-build-"))
  const base = join(dir, "base"), reports = join(dir, "reports")
  const baseline = join(dir, "baseline"), current = join(dir, "current")
  const env = { ...process.env, FACTORY_SITE_OFFLINE: "1", GH_TOKEN: "", GITHUB_TOKEN: "" }
  const run = (command, args, options = {}) => {
    const r = spawnSync(command, args, { env, encoding: "utf8", ...options })
    console.log("whole-legacy command:", JSON.stringify([command, ...args]), "exit:", r.status, "\n" + (String(r.stdout) + String(r.stderr)).slice(0, 65536))
    assert.equal(r.status, 0, String(r.stdout) + String(r.stderr))
    return r
  }
  try {
    mkdirSync(base)
    // Baseline code and golden public records are read from the approved base
    // into this test's owned temporary fixture, never another owner's worktree.
    const archive = execFileSync("git", ["-C", source, "archive", "45ace0ea51b07210c79af5a2619ed2178c86e2bb", "site", ".github/scripts", "facts", "labels", "corrections", "capture", "factory.json", "capture.json"], { maxBuffer: 64 * 1024 * 1024 })
    run("tar", ["-x", "-C", base], { input: archive })
    run("git", ["init", "-q", base])
    run("git", ["-C", base, "add", "."])
    run("git", ["-C", base, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "pinned golden fixture"])
    run(process.execPath, [join(base, ".github/scripts/apply-corrections.mjs"), "--store", base])
    run(process.execPath, [join(process.env.DESK_DIR, "plugins/desk/mcp/scripts/factory.js"), "build", "--store", base, "--out", reports])
    for (const [code, dist] of [[base, baseline], [source, current]]) {
      run(process.execPath, [join(code, "site/scripts/build-data.mjs"), "--reports", reports, "--main", base, "--out", join(dist, "data.json")])
      run(process.execPath, [join(code, "site/scripts/publish-files.mjs"), "--reports", reports, "--dist", dist, "--template", join(code, "site/src/llms-template.txt")])
    }
    const old = JSON.parse(readFileSync(join(baseline, "data.json"), "utf8"))
    const now = JSON.parse(readFileSync(join(current, "data.json"), "utf8"))
    assert.deepEqual(checkNumbers(now), [])
    assert.ok(now.jobs.length > 0 && now.sessions.length > 0)
    console.log("whole-legacy checked:", now.jobs.length, "jobs;", now.sessions.length, "sessions; only built_at excluded from baseline comparison")
    assert.ok(now.jobs.every((j) => !Object.hasOwn(j, "clocks")), "legacy has no manufactured clock envelope")
    const { built_at: oldStamp, ...oldData } = old
    const { built_at: nowStamp, ...nowData } = now
    assert.deepEqual(nowData, oldData, "only the build timestamp may differ")
    for (const [sub, names] of [["jobs", readdirSync(join(reports, "jobs")).filter((n) => n.endsWith(".json"))], ["rollups", ["tasks.json", "stackup.json", "by_week.json", "improvements.json"]]]) {
      for (const file of names) {
        if (existsSync(join(baseline, sub, file))) assert.deepEqual(readFileSync(join(current, sub, file)), readFileSync(join(baseline, sub, file)), `${sub}/${file}`)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
