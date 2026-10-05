import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"

const SCRIPT = new URL("../../../site/scripts/build-data.mjs", import.meta.url).pathname

function write(path, obj) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(obj))
}

const facts = (id, over = {}) => ({
  schema: "desk.factory.published/1",
  session: { host: "claude-code", id, duration_ms: 600000, ended: true, entrypoint: "cli", host_version: "1" },
  models: [],
  agents: [],
  intervals: [{ kind: "turn", start_ms: 0, end_ms: 400000 }],
  counts: { tool_calls: { shell: 30 }, tool_failures: { shell: 3 }, api_retries: 0, compactions: 0, tool_retries: 0 },
  refs: { prs: [] },
  jobs: [],
  unavailable: [],
  ...over,
})

function job(id, status, over = {}) {
  return {
    job: id,
    formulas: {
      status: { class: "declared", value: status },
      lead_time_ms: { class: "declared", value: 1000 },
      active_time_ms: { class: "measured", value: 500 },
      flow_efficiency: { class: "inferred", value: 0.5 },
      queue_before_start_ms: { class: "measured", value: 0 },
      waits: { human_wait_ms: { class: "measured", value: 100 }, api_retry_ms: { class: "measured", value: 0 } },
      references: { class: "measured", value: { public_prs: 0 } },
      sessions: { class: "measured", value: { bound: 1 } },
      ...over,
    },
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "build-data-"))
  const reports = join(dir, "reports")
  const main = join(dir, "main")
  write(join(reports, "rollups/coverage.json"), { sessions_with_facts: 3, jobs: 3, jobs_open: 1, labels: { files: 0 } })
  write(join(reports, "rollups/measures.json"), { groupings: {} })
  write(join(reports, "rollups/muda.json"), { groupings: { overall: { all: { jobs: 3, jobs_labeled: 0, wastes: [] } } }, wastes: ["defects"] })
  write(join(reports, "jobs/a.json"), job("a", "done"))
  write(join(reports, "jobs/b.json"), job("b", "done", { active_time_ms: { class: "measured", partial: true, partial_reasons: ["worker_shared"], value: 9 } }))
  write(join(reports, "jobs/c.json"), job("c", "processing", { active_time_ms: { class: "unavailable", reason: "job_offsets_unavailable", value: null } }))
  write(join(main, "facts/claude-code-s1.json"), facts("s1", { models: [{ id: "m1", requests: 4, tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4, reasoning: null } }] }))
  write(join(main, "facts/claude-code-s2.json"), facts("s2"))
  write(join(main, "facts/claude-code-s3.json"), facts("s3", { agents: [{ n: 1, parent: null }, { n: 2, parent: 1 }] }))
  execFileSync("git", ["init", "-q", main])
  execFileSync("git", ["-C", main, "add", "."])
  execFileSync("git", ["-C", main, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", "intake"], {
    env: { ...process.env, GIT_COMMITTER_DATE: new Date().toISOString(), GIT_AUTHOR_DATE: new Date().toISOString() },
  })
  return { dir, reports, main, out: join(dir, "dist/data.json") }
}

function build(fx) {
  return spawnSync("node", [SCRIPT, "--reports", fx.reports, "--main", fx.main, "--out", fx.out], {
    env: { ...process.env, FACTORY_SITE_OFFLINE: "1", GITHUB_TOKEN: "" },
    encoding: "utf8",
  })
}

test("the build writes data.json and health.json that pass the numbers check", () => {
  const fx = fixture()
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.deepEqual(checkNumbers(data), [])
  const health = JSON.parse(readFileSync(join(dirname(fx.out), "health.json"), "utf8"))
  assert.deepEqual(checkNumbers(health), [])
  assert.ok(["alive", "stale", "broken"].includes(health.verdict.status))
  assert.equal(health.facts_by_host[0].files.value, 3)
  assert.equal(health.newest_intake.value, "under_1_day")
  assert.equal(health.factory_build.state, "unavailable")
})

test("sessions with no models are unmeasured, not zero", () => {
  const fx = fixture()
  build(fx)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const total = data.headlines.find((h) => h.id === "model_requests").number
  assert.equal(total.value, 4)
  assert.equal(total.n, 1)
  assert.equal(total.N, 3)
  assert.equal(total.state, "partial")
})

test("rollups over jobs take only measured members and show n of N", () => {
  const fx = fixture()
  build(fx)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const active = data.time_breakdown.find((r) => r.key === "active_time")
  assert.equal(active.median.n, 1)
  assert.equal(active.median.N, 3)
  assert.equal(active.median.value, 500)
  assert.equal(active.median.state, "partial")
  assert.equal(active.trust.status, "thin_sample")
})

test("every headline carries a trust state and coverage that says not recorded yet", () => {
  const fx = fixture()
  build(fx)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.ok(data.headlines.length >= 5)
  for (const h of data.headlines) {
    assert.ok(["ok", "thin_sample", "partial", "low_coverage"].includes(h.trust.status), h.id)
    assert.ok(h.trust.reason.length > 0, h.id)
    assert.deepEqual(h.trust.coverage.reasons, ["not_recorded_yet"], h.id)
  }
})

test("a count the reports cannot supply is unavailable, not zero", () => {
  const fx = fixture()
  write(join(fx.reports, "rollups/coverage.json"), { sessions_with_facts: 3, jobs: "NaN" })
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(data.coverage.jobs.state, "unavailable")
  assert.equal(data.coverage.jobs_open.state, "unavailable")
  assert.equal("value" in data.coverage.jobs_open, false)
})

test("the build runs the numbers check before it writes anything, and fails on a violation", () => {
  const src = readFileSync(SCRIPT, "utf8")
  const check = src.indexOf("checkNumbers(")
  const write = src.indexOf("writeFileSync(outFile")
  assert.ok(check > 0 && write > check, "the check must run before data.json is written")
  assert.match(src.slice(check, write), /process\.exit\(1\)/)
})

test("no author, login or avatar field reaches data.json", () => {
  const fx = fixture()
  build(fx)
  const text = readFileSync(fx.out, "utf8")
  for (const word of ['"user"', '"login"', '"author"', "avatar"]) assert.equal(text.includes(word), false, word)
})
