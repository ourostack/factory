import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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
  assert.equal(health.verdict.status, "unknown")
  assert.equal(health.facts_by_host[0].files.value, 3)
  assert.equal(health.newest_intake.value, "under_1_day")
  assert.equal(health.factory_build.state, "unavailable")
})

test("triage queue/data/twin absence and private human handoff stay value identical", async () => {
  const fx = fixture()
  assert.equal(build(fx).status, 0)
  const absent = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(absent.improvements?.state, "not_reviewed")
  const paired = JSON.parse(readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
  commitCapture(fx.main, "../triage/0123456789abcdef.json", paired.public, new Date().toISOString())
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(data.improvements.rows[0].availability, "private_detail_not_published")
  assert.equal(data.improvements.rows[0].handoff.authority_limit, "inspect_only_no_new_authority")
  const { publishData } = await import("../../../site/scripts/publish-files.mjs")
  publishData({ reports: fx.reports, dist: dirname(fx.out) })
  assert.deepEqual(JSON.parse(readFileSync(join(dirname(fx.out), "rollups/improvements.json"), "utf8")), data.improvements)
  for (const sentinel of paired.privacy_sentinels) assert.ok(!JSON.stringify(data.improvements).includes(sentinel))
})

test("malformed triage on main stops build rather than healthy absence", () => {
  const fx = fixture()
  write(join(fx.main, "triage/0123456789abcdef.json"), { schema: "invalid" })
  const r = build(fx)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /triage_/)
})

test("paired released Desk builds with absence and immutable triage fixture publish identical checked JSON twins", () => {
  if (!process.env.DESK_DIR) {
    assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1", "paired Desk build required")
    return
  }
  const source = new URL("../../../", import.meta.url).pathname
  const paired = JSON.parse(readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
  for (const withTriage of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), "paired-triage-build-"))
    const main = join(dir, "main"), reports = join(dir, "reports"), dist = join(dir, "dist")
    mkdirSync(join(main, "facts"), { recursive: true })
    const fact = readdirSync(join(source, "facts")).find((n) => n.endsWith(".json"))
    writeFileSync(join(main, "facts", fact), readFileSync(join(source, "facts", fact)))
    writeFileSync(join(main, "factory.json"), readFileSync(join(source, "factory.json")))
    if (withTriage) {
      mkdirSync(join(main, "triage"))
      writeFileSync(join(main, "triage/0123456789abcdef.json"), JSON.stringify(paired.public) + "\n")
    }
    execFileSync("git", ["init", "-q", main])
    execFileSync("git", ["-C", main, "add", "."])
    execFileSync("git", ["-C", main, "-c", "user.name=x", "-c", "user.email=x@example.invalid", "commit", "-qm", "accepted fixture"])
    const env = { ...process.env, FACTORY_SITE_OFFLINE: "1", GITHUB_TOKEN: "", GH_TOKEN: "" }
    try {
      const d = spawnSync(process.execPath, [
        join(process.env.DESK_DIR, "plugins/desk/mcp/scripts/factory.js"), "build", "--store", main, "--out", reports,
      ], { env, encoding: "utf8" })
      assert.equal(d.status, 0, d.stdout + d.stderr)
      const out = join(dist, "data.json")
      const site = spawnSync(process.execPath, [SCRIPT, "--reports", reports, "--main", main, "--out", out,
        "--pulls-out", join(dir, "pulls.json"), "--pulls-cache", join(dir, "pulls-cache.json")], { env, encoding: "utf8" })
      assert.equal(site.status, 0, site.stdout + site.stderr)
      const publish = spawnSync(process.execPath, [join(source, "site/scripts/publish-files.mjs"), "--reports", reports,
        "--dist", dist, "--template", join(source, "site/src/llms-template.txt"), "--pulls", join(dir, "pulls.json")], { env, encoding: "utf8" })
      assert.equal(publish.status, 0, publish.stdout + publish.stderr)
      const data = JSON.parse(readFileSync(out, "utf8"))
      assert.deepEqual(checkNumbers(data), [])
      assert.deepEqual(JSON.parse(readFileSync(join(dist, "rollups/improvements.json"), "utf8")), data.improvements)
      assert.equal(data.improvements.state, withTriage ? "reviewed" : "not_reviewed")
      if (withTriage) {
        assert.equal(data.improvements.rows[0].availability, "private_detail_not_published")
        assert.deepEqual(data.improvements.rows[0].decision, { state: "unavailable", reason: "detail_not_published" })
        for (const s of paired.privacy_sentinels) assert.ok(!JSON.stringify(data.improvements).includes(s))
      }
      assert.match(readFileSync(join(dist, "llms.txt"), "utf8"), /inspect_only_no_new_authority/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
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
  assert.equal(active.median.N, 2)
  assert.equal(active.median.out_of_scope, 1)
  assert.equal(active.median.value, 500)
  assert.equal(active.median.state, "partial")
  // No capture record: coverage is not measured, which outranks a thin sample.
  assert.equal(active.trust.status, "coverage_unknown")
  assert.ok(active.trust.causes.includes("thin_sample"))
})

test("every headline carries a trust state, and with no capture record its coverage is no data, never a share", () => {
  const fx = fixture()
  build(fx)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.ok(data.headlines.length >= 5)
  for (const h of data.headlines) {
    assert.equal(h.trust.status, "coverage_unknown", h.id)
    assert.doesNotMatch(h.trust.reason, /no_records/, h.id)
    assert.ok(h.trust.reason.length > 0, h.id)
    assert.equal(h.trust.coverage.state, "unavailable", h.id)
    assert.deepEqual(h.trust.coverage.reasons, ["no_records"], h.id)
  }
  assert.equal(data.capture_coverage.share.state, "unavailable")
  const health = JSON.parse(readFileSync(join(dirname(fx.out), "health.json"), "utf8"))
  assert.deepEqual(health.slots.capture_coverage.reasons, ["no_records"])
})

const captureHost = (over = {}) => ({ on_disk: 20, derived: 18, held: 0, frozen: 0, pending: 0, not_seen: 2, not_in_a_desk: 0, unverified: false, ...over })
const captureRecord = (hosts) => ({ schema: "desk.factory.capture/1", basis: "still_on_disk", hosts })

function commitCapture(main, name, rec, date) {
  write(join(main, "capture", name), rec)
  execFileSync("git", ["-C", main, "add", "."])
  execFileSync("git", ["-C", main, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", "capture"], {
    env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
  })
}

test("capture records on main fill capture coverage, the health slot and every trust line", () => {
  const fx = fixture()
  const now = new Date().toISOString()
  commitCapture(fx.main, "0123456789abcdef.json", captureRecord({ "claude-code": captureHost() }), now)
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.deepEqual(checkNumbers(data), [])
  assert.equal(data.capture_coverage.share.state, "measured")
  assert.equal(data.capture_coverage.share.value, 0.9)
  assert.equal(data.coverage.capture.value, 0.9)
  for (const h of data.headlines) assert.equal(h.trust.coverage.value, 0.9, h.id)
  const health = JSON.parse(readFileSync(join(dirname(fx.out), "health.json"), "utf8"))
  assert.deepEqual(checkNumbers(health), [])
  assert.equal(health.slots.capture_coverage.value, 0.9)
  assert.equal(health.details.capture_coverage.find((d) => d.host === "claude-code").share.value, 0.9)
  assert.doesNotMatch(JSON.stringify(data.capture_coverage), /0123456789abcdef/)
})

test("a capture record committed over 45 days ago is left out, and a fall against its previous commit raises an alarm", () => {
  const fx = fixture()
  const old = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString()
  commitCapture(fx.main, "aaaaaaaaaaaaaaaa.json", captureRecord({ "claude-code": captureHost() }), old)
  commitCapture(fx.main, "bbbbbbbbbbbbbbbb.json", captureRecord({ "claude-code": captureHost() }), new Date().toISOString())
  commitCapture(fx.main, "bbbbbbbbbbbbbbbb.json", captureRecord({ "claude-code": captureHost({ derived: 10, not_seen: 10 }) }), new Date().toISOString())
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const cov = JSON.parse(readFileSync(fx.out, "utf8")).capture_coverage
  assert.equal(cov.machines.stale.value, 1)
  assert.equal(cov.share.state, "partial")
  assert.deepEqual(cov.alarms.map((a) => a.code).sort(), ["coverage_dropped", "coverage_low"])
  for (const h of JSON.parse(readFileSync(fx.out, "utf8")).headlines) assert.ok(h.trust.reason.length > 0)
})

test("a store whose capture share is low marks its headlines low coverage", () => {
  const fx = fixture()
  commitCapture(fx.main, "cccccccccccccccc.json", captureRecord({ "claude-code": captureHost({ derived: 5, not_seen: 15 }) }), new Date().toISOString())
  build(fx)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  for (const h of data.headlines) assert.equal(h.trust.status, "low_coverage", h.id)
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

// --- reports built by a Desk that writes state and reasons (published facts /2) ---

const leaf = (over) => ({ N: 3, n: 3, reasons: [], state: "measured", value: 3, ...over })
const totals = () => ({
  schema: "desk.factory.rollups/1",
  hosts: {},
  all: {
    sessions: leaf({}),
    tool_calls: leaf({ n: 2, reasons: ["log_truncated"], state: "partial", value: 60 }),
    tool_failures: leaf({ n: 2, reasons: ["log_truncated"], state: "partial", value: 6 }),
    model_requests: leaf({ n: 1, reasons: ["field_absent"], state: "partial", value: 4 }),
    tokens: { input: leaf({}), output: leaf({}), cache_read: leaf({}), cache_write: leaf({}), reasoning: leaf({ n: 0, reasons: ["host_does_not_record"], state: "unavailable", value: undefined }) },
    subagent_dispatches: leaf({ value: 1 }),
  },
})

test("headline totals come from the pipeline's totals, over every published session, with n of N", () => {
  const fx = fixture()
  write(join(fx.reports, "rollups/totals.json"), totals())
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const h = Object.fromEntries(data.headlines.map((x) => [x.id, x.number]))
  assert.deepEqual(
    { state: h.model_requests.state, value: h.model_requests.value, n: h.model_requests.n, N: h.model_requests.N, reasons: h.model_requests.reasons, of: h.model_requests.of },
    { state: "partial", value: 4, n: 1, N: 3, reasons: ["field_absent"], of: "published sessions" },
  )
  assert.equal(h.tool_calls.value, 60)
  assert.equal(h.tool_calls.state, "partial")
  assert.equal(h.subagent_dispatches.state, "measured")
  assert.deepEqual(checkNumbers(data), [])
})

test("a malformed totals leaf is no data, and the build still passes its check", () => {
  const fx = fixture()
  const t = totals()
  t.all.model_requests = { N: 3, n: 5, reasons: [], state: "measured", value: 0 }
  write(join(fx.reports, "rollups/totals.json"), t)
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const m = data.headlines.find((x) => x.id === "model_requests").number
  assert.equal(m.state, "unavailable")
  assert.equal("value" in m, false)
})

test("tool kinds come from the pipeline's rows when they carry a state; a row with no counts is no data", () => {
  const fx = fixture()
  write(join(fx.reports, "rollups/tool-kinds.json"), {
    schema: "desk.factory.rollups/1",
    sessions: 3,
    tool_kinds: [
      { N: 3, calls: 40, failures: 4, n: 2, reasons: ["log_truncated"], sessions: 3, state: "partial", tool: "shell" },
      { N: 1, n: 0, reasons: ["capped"], sessions: 1, state: "unavailable", tool: "read" },
    ],
  })
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const by = Object.fromEntries(data.tool_kinds.map((t) => [t.tool, t]))
  assert.equal(by.shell.calls.value, 40)
  assert.equal(by.shell.calls.n, 2)
  assert.equal(by.shell.failure_rate.value, 0.1)
  assert.equal(by.shell.failure_rate.state, "partial")
  assert.equal(by.read.calls.state, "unavailable")
  assert.deepEqual(by.read.calls.reasons, ["capped"])
  assert.equal(by.read.failure_rate.state, "unavailable")
  assert.deepEqual(checkNumbers(data), [])
})

test("a job report with state and reasons reaches the job page with all three states", () => {
  const fx = fixture()
  write(join(fx.reports, "jobs/d.json"), {
    job: "d",
    formulas: {
      status: { class: "declared", reasons: [], state: "measured", value: "done" },
      waits: {
        human_wait_ms: { class: "measured", reasons: [], state: "measured", value: 0 },
        permission_wait_ms: { class: "unavailable", reason: "host_does_not_record", reasons: ["host_does_not_record"], state: "unavailable", value: null },
        api_retry_ms: { class: "measured", partial: true, partial_reasons: ["host_records_partly"], reasons: ["host_records_partly"], state: "partial", value: 3 },
      },
    },
  })
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const d = data.jobs.find((j) => j.id === "d")
  const states = new Set(d.details.map((x) => x.number.state))
  assert.deepEqual([...states].sort(), ["measured", "partial", "unavailable"])
  assert.deepEqual(checkNumbers(data), [])
})

test("harness worker counts say how many sessions they rest on", () => {
  const fx = fixture()
  write(join(fx.main, "facts/claude-code-s4.json"), facts("s4", { agents: [], unavailable: [{ field: "agents", reason: "source_unreadable" }] }))
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  const h = data.harnesses[0]
  assert.equal(h.workers.kind, "rollup")
  assert.equal(h.workers.N, h.sessions.value)
  assert.ok(h.workers.n < h.workers.N)
})

// --- one stated population per caption ---

const FMT = createRequire(import.meta.url)("../../../site/src/format.js")
const WORD = { published: "published session", substantial: "substantial session" }
const OF = { published: "published sessions", substantial: "substantial sessions" }

function populationsAgree(data) {
  const s = data.scopes
  // Each caption names its section's population and not the other one.
  for (const [section, key] of Object.entries({ headlines: "headlines", tool_calls: "tool_kinds", tool_failures: "tool_kinds", models: "models", subagents: "subagents", harnesses: "harnesses" })) {
    const text = FMT.caption(section, s[key])
    const other = s[key] === "published" ? "substantial" : "published"
    assert.ok(text.includes(WORD[s[key]]), `${section}: ${text}`)
    assert.equal(text.includes(WORD[other]), false, `${section}: ${text}`)
  }
  // ...and each section's numbers count exactly that population.
  for (const id of ["subagent_dispatches", "tool_calls", "model_requests"]) {
    assert.equal(data.headlines.find((h) => h.id === id).number.of, OF[s.headlines], id)
  }
  for (const k of data.tool_kinds) for (const f of ["calls", "failures", "failure_rate"]) assert.equal(k[f].of, OF[s.tool_kinds], `${k.tool}.${f}`)
  for (const m of data.models) assert.equal(m.requests.of, OF[s.models], m.id)
  for (const b of Object.values(data.subagents.buckets)) assert.equal(b.of, OF[s.subagents])
  for (const h of data.harnesses) assert.equal(h.workers.of, OF[s.harnesses], h.host)
  // A takeaway names the population it reads, with its count shown.
  for (const t of data.takeaways) {
    if (t.id === "tool_failures") assert.ok(t.template.includes(s.tool_kinds === "published" ? "every published session" : "{scoped} substantial sessions"), t.template)
    if (t.id === "model_concentration" || t.id === "subagents") assert.ok(t.template.includes("{scoped} substantial sessions"), t.template)
  }
}

test("with the pipeline's totals and tool-kind rows, every caption names the population its numbers count", () => {
  const fx = fixture()
  write(join(fx.reports, "rollups/totals.json"), totals())
  write(join(fx.reports, "rollups/tool-kinds.json"), {
    schema: "desk.factory.rollups/1",
    sessions: 3,
    tool_kinds: [{ N: 3, calls: 40, failures: 4, n: 3, reasons: [], sessions: 3, state: "measured", tool: "shell" }],
  })
  assert.equal(build(fx).status, 0)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(data.scopes.headlines, "published")
  assert.equal(data.scopes.tool_kinds, "published")
  populationsAgree(data)
})

test("without them, every caption and number says substantial sessions", () => {
  const fx = fixture()
  assert.equal(build(fx).status, 0)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(data.scopes.headlines, "substantial")
  assert.equal(data.scopes.tool_kinds, "substantial")
  populationsAgree(data)
})

test("the page takes every section caption from the caption table, and the scope paragraph names the headline population", () => {
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8")
  assert.match(app, /F\.caption\(section, data\.scopes\[SCOPE_OF\[section\]\]\)/)
  assert.match(app, /F\.caption\("headlines", data\.scopes\.headlines\)/)
  assert.doesNotMatch(app, /Everything above and below/)
  // No blanket population claim: the takeaways each name their own.
  assert.doesNotMatch(app, /Everything else in this section/)
  assert.match(app, /Each takeaway names the sessions it counts/)
  for (const section of FMT.CAPTION_SECTIONS.filter((x) => x !== "headlines")) {
    assert.match(html, new RegExp(`<p class="chart-caption" id="caption-${section}"></p>`), section)
  }
  assert.doesNotMatch(html, /across the substantial sessions/)
})

test("with no outcomes rollup the outcome figures and the unsigned deliveries slot read not recorded yet", () => {
  const fx = fixture()
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.deepEqual(data.outcomes.first_pass_yield.reasons, ["not_recorded_yet"])
  const health = JSON.parse(readFileSync(join(dirname(fx.out), "health.json"), "utf8"))
  assert.deepEqual(health.slots.unsigned_deliveries.reasons, ["not_recorded_yet"])
  for (const j of data.jobs) assert.deepEqual(j.signoff.reasons, ["not_recorded"])
})

test("an outcomes rollup fills sign-off, yield and the unsigned deliveries slot, and passes the numbers check", () => {
  const fx = fixture()
  const w = (o = {}) => ({ lt_1h: 0, lt_1d: 0, lt_7d: 0, ge_7d: 0, ...o })
  write(join(fx.reports, "rollups/outcomes.json"), {
    schema: "desk.factory.rollups/1",
    signoff: { recorded: true, jobs: 2, accepted: 1, delivered_unsigned: 1, refused: 0, reopened: 0, not_recorded: 0, not_delivered: 0, no_record: 1, jobs_without_work_record: 0, refusal_reasons: { not_what_was_asked: 0, defect: 0, changed_ask: 0, incomplete: 0, other: 0 }, waits: { signed: w({ lt_1h: 1 }), unsigned: w({ ge_7d: 1 }) } },
    first_pass_yield: { state: "partial", value: 1, reasons: ["awaiting_signoff"], n: 2, N: 2, passed: 2, returned: 0, awaiting_signoff: 1, changed_ask_only: 0, excluded: [{ reason: "not_recorded", jobs: 1 }] },
    rework: { state: "measured", reasons: [], n: 2, N: 2, returns: { in_task: { agent_error: 0, changed_ask: 0, new_information: 0, external: 0 }, at_review: { agent_error: 0, changed_ask: 0, new_information: 0, external: 0 }, after_delivery: { agent_error: 0, changed_ask: 0, new_information: 0, external: 0 } }, changed_ask: 0, reason_check: { state: "unavailable", reasons: ["no_refusals"] }, defects: { state: "unavailable", reasons: ["no_labels"], n: 0, N: 2 } },
  })
  write(join(fx.reports, "jobs/a.json"), job("a", "done", { signoff: { class: "declared", state: "measured", value: "accepted", reasons: [], verified: true, reason: null, wait: { class: "lt_1h", censored: false } } }))
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.deepEqual(checkNumbers(data), [])
  assert.equal(data.outcomes.signoff.accepted.value, 1)
  assert.equal(data.outcomes.first_pass_yield.bound, "upper")
  assert.equal(data.jobs.find((j) => j.id === "a").signoff.value, "accepted")
  const health = JSON.parse(readFileSync(join(dirname(fx.out), "health.json"), "utf8"))
  assert.deepEqual(checkNumbers(health), [])
  assert.equal(health.slots.unsigned_deliveries.value, 1)
  assert.equal(health.details.unsigned_deliveries[0].number.value, "waiting at least 7 days")
})

test("the attention headline's trust rests on the same capture share as every other trust line", () => {
  const fx = fixture()
  commitCapture(fx.main, "eeeeeeeeeeeeeeee.json", captureRecord({ "claude-code": captureHost() }), new Date().toISOString())
  write(join(fx.reports, "rollups/outcomes.json"), {
    schema: "desk.factory.rollups/1",
    signoff: { recorded: true, jobs: 1, accepted: 1, delivered_unsigned: 0, refused: 0, reopened: 0, not_recorded: 0, not_delivered: 0, no_record: 0, jobs_without_work_record: 0, refusal_reasons: {}, waits: { signed: { lt_1h: 1, lt_1d: 0, lt_7d: 0, ge_7d: 0 }, unsigned: { lt_1h: 0, lt_1d: 0, lt_7d: 0, ge_7d: 0 } } },
    attention: { headline: { state: "measured", value: 60000, reasons: [], n: 1, N: 1 } },
  })
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(data.capture_coverage.share.state, "measured")
  assert.deepEqual(data.outcomes.attention.trust.coverage, data.capture_coverage.share)
})

test("a capture record's loop slot fills the open improvement items slot and the loop figures", () => {
  const fx = fixture()
  const loop = { v: 1, improvement_open: 2, improvement_claimed: 1, improvement_shipped: 0, improvement_verifying: 0, oldest_open_age_days: 9, closed_confirmed_month: 1, closed_unverified_month: 0, loop_alarms_open: 0, steps_stale: 0, headless: "no_credentials" }
  commitCapture(fx.main, "dddddddddddddddd.json", { ...captureRecord({ "claude-code": captureHost() }), loop }, new Date().toISOString())
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.equal(data.loop_health.open.value, 2)
  assert.deepEqual(data.loop_health.alarms.map((a) => a.code), ["improvement_age"])
  assert.deepEqual(data.loop_health.notices.map((n) => n.code), ["headless_blocked"])
  const health = JSON.parse(readFileSync(join(dirname(fx.out), "health.json"), "utf8"))
  assert.deepEqual(checkNumbers(health), [])
  assert.equal(health.slots.open_improvement_items.value, 3)
  assert.equal(health.details.open_improvement_items[0].number.value, 9)
})

test("with no loop slot anywhere the open improvement items slot is no data, never zero", () => {
  const fx = fixture()
  build(fx)
  const health = JSON.parse(readFileSync(join(dirname(fx.out), "health.json"), "utf8"))
  assert.equal(health.slots.open_improvement_items.state, "unavailable")
  assert.ok(!("value" in health.slots.open_improvement_items))
})

test("the build gives each task its waste from its label files and its sessions, and adds the trend and what to fix next", () => {
  const fx = fixture()
  write(join(fx.reports, "jobs/a.json"), { ...job("a", "done"), timeline: { intervals: [{ session_id: "s1", host: "claude-code" }] } })
  write(join(fx.reports, "jobs/c.json"), { ...job("c", "done"), timeline: { intervals: [{ session_id: "s1", host: "claude-code" }] } })
  // Session s1 holds jobs a (0..1000) and c (1000..1500); each job's evaluator labeled the whole session.
  write(join(fx.main, "facts/claude-code-s1.json"), facts("s1", { jobs: [{ job: "a", segments: [{ start_ms: 0, end_ms: 1000 }] }, { job: "c", segments: [{ start_ms: 1000, end_ms: 1500 }] }] }))
  write(join(fx.main, "labels/a/s1.json"), { schema: "desk.factory.labels/1", job: "a", session: "s1", stretches: [{ start_ms: 0, end_ms: 1500, class: "muda", waste: "waiting" }] })
  write(join(fx.main, "labels/c/s1.json"), { schema: "desk.factory.labels/1", job: "c", session: "s1", stretches: [{ start_ms: 0, end_ms: 1500, class: "muda", waste: "waiting" }] })
  // A label file naming another job is not this job's.
  write(join(fx.main, "labels/a/s9.json"), { schema: "desk.factory.labels/1", job: "b", session: "s9", stretches: [{ start_ms: 0, end_ms: 5, class: "muda", waste: "motion" }] })
  const r = build(fx)
  assert.equal(r.status, 0, r.stderr)
  const data = JSON.parse(readFileSync(fx.out, "utf8"))
  assert.deepEqual(checkNumbers(data), [])
  const a = data.jobs.find((j) => j.id === "a")
  assert.deepEqual(a.waste.rows.map((x) => [x.key, x.total_ms.value, x.total_ms.state]), [["waiting", 1000, "measured"]])
  assert.deepEqual(data.jobs.find((j) => j.id === "c").waste.rows.map((x) => [x.key, x.total_ms.value]), [["waiting", 500]])
  assert.deepEqual(data.labeled_waste.rows.map((x) => [x.key, x.total_ms.value]), [["waiting", 1500]], "the shared session counts once in all")
  assert.deepEqual(data.jobs.find((j) => j.id === "b").waste.rows, [])
  assert.deepEqual(data.sessions.map((s) => s.session_id), ["s1"])
  assert.match(data.sessions[0].facts_url, /\/blob\/main\/facts\/claude-code-s1\.json$/)
  assert.ok(Array.isArray(data.trend))
  assert.ok(data.fix_next.some((i) => i.id === "waste_waiting" && i.examples[0].job === "a"))
  assert.equal(typeof data.waste_actions.waiting, "string")
})
