import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const F = createRequire(import.meta.url)("../../../site/src/format.js")

const m = (value) => ({ state: "measured", value, reasons: [] })
const p = (value, reasons, bound) => ({ state: "partial", value, reasons, ...(bound ? { bound } : {}) })
const u = (reasons) => ({ state: "unavailable", reasons })

// This allowance is only for these five report reasons, never the closed facts vocabulary.
const CLOCK_REPORT_REASONS_AHEAD_OF_DESK = [
  "original_request_not_recorded", "work_before_card", "late_work_without_reopen",
  "episode_boundary_not_recorded", "episode_history_incomplete",
]

test("clock report reason allowance expires individually when actual Desk report reasons catch up", async () => {
  for (const reason of CLOCK_REPORT_REASONS_AHEAD_OF_DESK) assert.ok(F.hasReasonText(reason), reason)
  if (!process.env.DESK_DIR) {
    assert.notEqual(process.env.FACTORY_REQUIRE_DESK, "1", "Desk report reasons required")
    return
  }
  const report = join(process.env.DESK_DIR, "plugins/desk/mcp/src/factory/pipeline/report.js")
  assert.ok(existsSync(report), "Desk's actual report reason source is required")
  const { REASON_TEXT } = await import(pathToFileURL(report).href)
  assert.deepEqual(CLOCK_REPORT_REASONS_AHEAD_OF_DESK.filter((r) => Object.hasOwn(REASON_TEXT, r)), [], "Desk now exposes clock reasons: remove caught-up entries from CLOCK_REPORT_REASONS_AHEAD_OF_DESK")
})

test("formatClock states provenance and producer direction visibly, refusing unsupported clocks", () => {
  assert.equal(typeof F.formatClock, "function")
  const c = { class: "declared", state: "partial", value: 65000, reasons: ["censored"], basis: ["latest_observation"], bound: "lower", so_far: true }
  assert.match(F.formatClock(c), /at least 1m/)
  assert.match(F.formatClock(c), /declared/)
  assert.match(F.formatClock(c), /so far/)
  assert.match(F.formatClock({ ...c, bound: "upper" }), /at most 1m/)
  const opposing = { ...c, bound: null, bound_reason: "bound_reasons_conflict" }
  assert.match(F.formatClock(opposing), /Direction not known/)
  for (const bad of [null, {}, { ...c, basis: ["unknown"] }, { ...c, bound: "unknown" }, { ...c, class: "unavailable" }]) assert.throws(() => F.formatClock(bad), TypeError)
  const reasons = {
    original_request_not_recorded: "the original request was not recorded",
    work_before_card: "recorded work began before the task card",
    late_work_without_reopen: "work was recorded after delivery without a recorded reopen",
    episode_boundary_not_recorded: "a production episode boundary was not recorded",
    episode_history_incomplete: "the recorded production episode history is incomplete",
  }
  for (const [reason, text] of Object.entries(reasons)) {
    assert.equal(F.reasonText(reason), text)
    assert.match(F.formatClock({ class: "unavailable", state: "unavailable", reasons: [reason], basis: [], so_far: false }), /no data/)
  }
})

test("the formatter refuses anything that is not a stated number", () => {
  for (const bad of [5, 0, null, undefined, NaN, "5", {}, { value: 3 }, { state: "measured" }]) {
    assert.throws(() => F.describe(bad, "count"), TypeError, String(bad))
  }
  assert.throws(() => F.describe(m(1), "furlongs"), TypeError)
})

test("a measured number shows plainly, and a measured zero is a zero", () => {
  assert.equal(F.toText(m(0), "count"), "0")
  assert.equal(F.toText(m(1234), "count"), "1,234")
  assert.equal(F.toText(m(65000), "duration"), "1m")
  assert.equal(F.toText(m(0.5), "pct"), "50%")
  assert.equal(F.toText(m(43531), "compact"), "43.5K")
  assert.equal(F.toText(m(7200000), "hours"), "2.0")
  const d = F.describe(m(0), "count")
  assert.equal(d.state, "measured")
  assert.equal(d.marker, null)
})

test("a partial number carries a marker word, its reason and its bound", () => {
  const d = F.describe(p(21, ["worker_split"], "lower"), "count")
  assert.equal(d.state, "partial")
  assert.equal(d.text, "at least 21")
  assert.equal(d.marker, "partial")
  assert.match(d.reason, /split/)
  assert.match(F.toText(p(21, ["worker_split"], "lower"), "count"), /partial/)
  assert.equal(F.describe(p(5, ["worker_shared"], "upper"), "count").text, "at most 5")
  assert.equal(F.describe(p(5, ["x"]), "count").text, "5")
})

test("no data says so, with its reason, and never prints a digit", () => {
  const d = F.describe(u(["host_does_not_record"]), "count")
  assert.equal(d.state, "unavailable")
  assert.equal(d.text, "no data")
  assert.match(d.reason, /host does not record/)
  assert.equal(/\d/.test(F.toText(u(["not_recorded"]), "duration")), false)
})

test("a rollup is shown with n of N and what it counts", () => {
  const r = { state: "partial", value: 38000, reasons: ["unmeasured_members"], n: 12, N: 31, of: "jobs" }
  assert.equal(F.describe(r, "duration").nofn, "12 of 31 jobs")
  assert.match(F.toText(r, "duration"), /12 of 31 jobs/)
  const none = { state: "unavailable", reasons: ["no_measured_members"], n: 0, N: 3, of: "jobs" }
  assert.equal(F.describe(none, "duration").nofn, "0 of 3 jobs")
})

test("an unknown reason code is still readable", () => {
  assert.equal(F.reasonText("some_new_reason"), "some new reason")
})

const NOW = Date.parse("2026-10-05T12:00:00Z")
const goodHealth = (over = {}) => ({
  schema: "factory-health/1",
  built_at: "2026-10-05T10:00:00Z",
  verdict: { status: "alive", reason: "ok" },
  last_data_build: { state: "measured", value: "2026-10-05T10:00:00Z", reasons: [] },
  newest_intake: { state: "measured", value: "under_1_day", reasons: [] },
  facts_by_host: [{ host: "claude-code", files: { state: "measured", value: 3, reasons: [] } }],
  factory_build: { state: "measured", value: "success", reasons: [] },
  slots: {},
  ...over,
})

test("the page decides staleness itself, with its own threshold", () => {
  assert.equal(F.STALE_AFTER_HOURS, 36)
  assert.equal(F.pageVerdict(goodHealth(), NOW).status, "alive")
  const stale = F.pageVerdict(goodHealth({ built_at: "2026-10-03T10:00:00Z" }), NOW)
  assert.equal(stale.status, "stale")
  assert.match(stale.reason, /last built/)
  // a file cannot loosen the limit
  assert.equal(F.pageVerdict(goodHealth({ built_at: "2026-10-03T10:00:00Z", config: { stale_after_hours: 99999 } }), NOW).status, "stale")
  assert.equal(F.pageVerdict(goodHealth({ built_at: "2026-10-03T10:00:00Z", verdict: { status: "broken", reason: "red" } }), NOW).status, "broken")
})

test("a file that cannot be trusted never shows alive", () => {
  const status = (h) => F.pageVerdict(h, NOW).status
  assert.equal(status(null), "unknown")
  assert.equal(status(undefined), "unknown")
  assert.equal(status("text"), "unknown")
  assert.equal(status(goodHealth({ built_at: "2026-10-06T10:00:00Z" })), "unknown")
  assert.equal(status(goodHealth({ built_at: "nonsense" })), "unknown")
  assert.equal(status(goodHealth({ verdict: { reason: "x" } })), "unknown")
  assert.equal(status(goodHealth({ verdict: { status: "foo", reason: "x" } })), "unknown")
  assert.equal(status(goodHealth({ verdict: "alive" })), "unknown")
  for (const field of ["verdict", "built_at", "newest_intake", "facts_by_host", "factory_build", "slots", "last_data_build"]) {
    const h = goodHealth()
    delete h[field]
    assert.notEqual(status(h), "alive", field)
  }
  assert.equal(status(goodHealth({ verdict: { status: "unknown", reason: "x" } })), "unknown")
  assert.equal(status(goodHealth({ factory_build: { state: "unavailable", reasons: ["x"] } })), "unknown")
  // every piece of evidence alive rests on must be present and measured
  assert.equal(status(goodHealth({ newest_intake: { state: "unavailable", reasons: ["no_intake_found"] } })), "unknown")
  assert.equal(status(goodHealth({ facts_by_host: [] })), "unknown")
  assert.equal(status(goodHealth({ last_data_build: { state: "unavailable", reasons: ["x"] } })), "unknown")
  assert.ok(F.REQUIRED_EVIDENCE.length >= 4)
  // a broken file with a future stamp is still broken
  assert.equal(status(goodHealth({ built_at: "2030-01-01T00:00:00Z", verdict: { status: "broken", reason: "red" } })), "broken")
})

test("safeGithubUrl allows only a github pull request, issue or run link", () => {
  const ok = ["https://github.com/o/r/pull/12", "https://github.com/o-1/r.x/issues/3", "https://github.com/o/r/actions/runs/99", "https://github.com/o/r/blob/main/facts/claude-code-ab-1.json", "https://github.com/o/r/blob/reports/jobs/0f12ab.md"]
  for (const u of ok) assert.equal(F.safeGithubUrl(u), u)
  for (const u of ["javascript:alert(1)", "http://github.com/o/r/pull/1", "https://evil.com/o/r/pull/1", "https://github.com/o/r/pull/x", "https://github.com/o/r/blob/main/x", "https://github.com/o/r/blob/main/facts/../x.json", "https://github.com/o/r/blob/main/README.md", "https://github.com.evil.com/o/r/pull/1", "https://github.com/o/r/pull/1?x=1", "https://github.com/a/../pull/1", "https://github.com/../b/pull/1", "https://github.com/./b/pull/1", "", null, 5, undefined]) {
    assert.equal(F.safeGithubUrl(u), null, String(u))
  }
})

test("a rollup shows n of N and what is out of scope; declared shows its basis", () => {
  const r = { kind: "rollup", state: "partial", value: 1, reasons: ["unmeasured_members"], n: 4, N: 7, of: "finished jobs", out_of_scope: 36 }
  assert.equal(F.describe(r, "count").nofn, "4 of 7 finished jobs \u00b7 36 out of scope")
  const none = { ...r, out_of_scope: 0 }
  assert.equal(F.describe(none, "count").nofn, "4 of 7 finished jobs")
  const d = F.describe({ state: "measured", value: 5, reasons: [], basis: "declared" }, "count")
  assert.equal(d.basis, "declared")
  assert.match(F.toText({ state: "measured", value: 5, reasons: [], basis: "declared" }, "count"), /declared/)
})

import { readFileSync } from "node:fs"

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

test("no call site formats a number on its own: app.js has no number formatting", () => {
  const app = read("site/src/app.js")
  for (const banned of [/\.toFixed\(/, /\.toLocaleString\((?!undefined, \{ dateStyle)/, /\bfmt[A-Z]\w*\(/, /\|\| 0\b/, /\?\? 0\b/]) {
    assert.equal(banned.test(app), false, String(banned))
  }
})

test("the page loads the formatter before the renderer, and the deploy copies it", () => {
  const html = read("site/src/index.html")
  assert.ok(html.indexOf('src="format.js"') > 0 && html.indexOf('src="format.js"') < html.indexOf('src="app.js"'))
  assert.match(read(".github/workflows/pages.yml"), /cp [^\n]*site\/src\/format\.js/)
})

test("the purpose and limit statements are on the page and in the README", () => {
  const html = read("site/src/index.html")
  const readme = read("README.md")
  for (const text of [html, readme]) {
    assert.match(text, /how much human attention does an accepted outcome cost/)
    assert.match(text, /Designed for many desks; proven on one so far\./)
  }
})

test("the health panel contains its own failures and links go through the guard", () => {
  const app = read("site/src/app.js")
  assert.match(app, /function renderHealth[\s\S]*?try \{[\s\S]*?\} catch/)
  for (const line of app.split("\n").filter((l) => /\.href = /.test(l))) assert.match(line, /= safe;|github\.com\/ourostack\/factory\/commit\//)
})

// Every reason that can reach a page has plain text (Desk contract section 3).
const FACTS_REASONS = [
  "host_does_not_record", "log_missing", "log_truncated", "session_open",
  "not_collected_in_slice_1", "source_unreadable", "capped", "desk_public",
  "field_absent", "host_records_partly", "withheld_public",
]
const REPORT_ONLY_REASONS = [
  "worker_split", "worker_shared", "censored", "mixed", "no_sessions", "partial", "open_job", "not_labeled",
  "cancelled", "status_unavailable", "wait_fields_unavailable", "job_offsets_unavailable", "zero_lead_time",
  "no_wait_intervals", "no_active_intervals", "not_reported_to_store", "not_in_published_facts", "facts_missing",
  "no_facts", "facts_ambiguous",
]

test("every facts reason and every report-only reason has plain text", () => {
  for (const r of [...FACTS_REASONS, ...REPORT_ONLY_REASONS]) {
    assert.equal(F.hasReasonText(r), true, r)
    assert.doesNotMatch(F.reasonText(r), /_/, r)
  }
  assert.equal(F.hasReasonText("a_reason_with_no_words"), false)
})

test("a labels file that contradicts itself has plain text", () => {
  assert.equal(F.hasReasonText("inconsistent"), true)
  assert.doesNotMatch(F.reasonText("inconsistent"), /_/)
})

test("every reason Desk gives for why the agent stopped, or why that is not known, has plain text", () => {
  for (const reason of ["could_not_tell", "stop_not_recorded", "outside_own_share", "stop_partly_classified"]) {
    assert.equal(F.hasReasonText(reason), true, reason)
    assert.doesNotMatch(F.reasonText(reason), /_/)
  }
})

test("the words for a wait whose why is not known fit a stop as well as labeled time", () => {
  assert.equal(F.reasonText("not_labeled"), "the independent evaluator has not labeled this yet")
  assert.equal(F.reasonText("stop_not_recorded"), "no recorded wait for the operator covers this time, so there is no record of why the agent stopped (some hosts do not record stops)")
  assert.equal(F.reasonText("stop_partly_classified"), "why the agent stopped is not known for some of this waiting, and some of that may belong here, so this is at least this much")
})

test("the job table opens a job page that shows each measure's state and reason in words", () => {
  const src = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")
  assert.match(src, /function renderJobDetail\(/)
  assert.match(src, /hashchange/)
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8")
  assert.match(html, /id="job-detail"/)
})

test("safeAnchor allows only a plain in-page id", () => {
  assert.equal(F.safeAnchor("job-abc_12"), "#job-abc_12")
  for (const bad of ["javascript:alert(1)", "a b", "", "x/y", "#x", null, 5]) assert.equal(F.safeAnchor(bad), null, String(bad))
})

test("a bound reads in words, a partial duration under a second shows milliseconds, and a lower bound of zero says none recorded", () => {
  assert.equal(F.describe(p(412, ["host_records_partly"], "lower"), "duration").text, "at least 412 ms")
  assert.equal(F.describe(p(0, ["host_records_partly"], "lower"), "count").text, "none recorded")
  assert.equal(F.describe(p(0, ["host_records_partly"], "lower"), "count").reason, "the host records only part of this, so the figure is a lower bound")
  assert.equal(F.describe(p(9, ["log_truncated"], "upper"), "count").text, "at most 9")
  const unknown = F.describe(p(0.5, ["log_truncated", "worker_shared"], "unknown"), "pct")
  assert.equal(unknown.text, "50%")
  assert.match(unknown.reason, /not known/)
  assert.equal(F.describe(m(0), "duration").text, "0s")
})

// A minimal document: enough of the DOM for render() to build its nodes.
function fakeDoc() {
  const node = (tag) => ({
    tag,
    className: "",
    textContent: "",
    title: "",
    children: [],
    appendChild(c) {
      this.children.push(c)
      return c
    },
  })
  return { createElement: node }
}
// What a sighted reader sees: every text that is not screen-reader only.
function visible(n) {
  if (n.className === "sr-only") return ""
  return [n.textContent, ...n.children.map(visible)].join("")
}

test("a partial number whose direction is unknown says so in visible text, not only on hover", () => {
  const n = p(0.4, ["worker_split", "worker_shared"], "unknown")
  assert.match(visible(F.render(fakeDoc(), n, "pct")), /could be higher or lower/)
  assert.match(visible(F.render(fakeDoc(), n, "pct", { flag: false })), /could be higher or lower/)
  assert.equal(F.describe(n, "pct").marker, "partial, could be higher or lower")
  // A known direction keeps its words in the figure and the plain marker.
  const lower = p(21, ["worker_split"], "lower")
  assert.doesNotMatch(visible(F.render(fakeDoc(), lower, "count")), /could be higher or lower/)
  assert.equal(F.describe(lower, "count").marker, "partial")
})

test("an unverified host says unverified in the visible marker, and the records cell says how many are unverified", () => {
  const share = { state: "partial", value: 0.25, reasons: ["unverified_host"], bound: "unknown", kind: "rollup", n: 0, N: 1, of: "machines' records with the host verified", out_of_scope: 0 }
  assert.equal(F.describe(share, "pct").marker, "unverified, could be higher or lower")
  assert.equal(F.recordsWords(1, 1), "1 record, unverified")
  assert.equal(F.recordsWords(2, 1), "2 records, 1 unverified")
  assert.equal(F.recordsWords(2, 0), "2 records")
  assert.equal(F.recordsWords(3, 3), "3 records, all unverified")
})

test("the trust line names the population of the coverage share", () => {
  assert.equal(F.coverageWords({ state: "measured", value: 0.81, reasons: [] }), "coverage: 81% of sessions still on disk")
  assert.equal(F.coverageWords({ state: "unavailable", reasons: ["not_recorded_yet"] }), "coverage: not recorded yet")
})

test("a table cell says the direction in visible text too, with no hover needed", () => {
  const doc = fakeDoc()
  const share = { state: "partial", value: 0.25, reasons: ["unverified_host"], bound: "unknown" }
  const node = F.render(doc, share, "pct", { nofn: false })
  assert.equal(node.children.find((c) => c.className === "num-flag").textContent.replace(/: .*/u, ""), "unverified, could be higher or lower")
  assert.match(visible(node), /could be higher or lower/)
  assert.match(node.title, /which way the true figure lies is not known/)
  const plain = F.render(doc, { state: "partial", value: 3, reasons: ["record_stale"], bound: "unknown" }, "count", { nofn: false })
  assert.match(visible(plain), /partial, could be higher or lower/)
})

test("the capture table keeps the whole marker visible and shows a scroll cue whenever it is wider than its card", async () => {
  const { readFileSync } = await import("node:fs")
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")
  const table = app.slice(app.indexOf("function renderCaptureCoverage"))
  assert.doesNotMatch(table, /shortMarker/)
  assert.doesNotMatch(table, /Point at a mark/)
  assert.match(table, /scroll-cue/)
  assert.match(table, /wrap\.scrollWidth > wrap\.clientWidth/)
})

test("the machines without a loop slot are not said to be on a Desk that does not send it yet", () => {
  assert.doesNotMatch(F.WITHOUT_LOOP_WORDS, /does not send|yet/)
  assert.match(F.WITHOUT_LOOP_WORDS, /older Desk/)
  assert.match(F.WITHOUT_LOOP_WORDS, /not measured for over three days/)
})

// ------------------------------------------------------------- finish days (S3 v1.1)

test("a finish day reads with its state and bound in words", () => {
  const y = { year: 2026 }
  const day = (extra) => ({ value: "2026-09-26", basis: "pr_anchor", ...extra })
  assert.equal(F.finishDay(day({ state: "measured", reasons: [] }), y).words, "on 26 Sep")
  assert.equal(F.finishDay(day({ state: "partial", reasons: ["finish_from_labels_landing"], bound: "upper" }), y).words, "on or before 26 Sep")
  assert.equal(F.finishDay(day({ state: "partial", reasons: ["anchor_unconfirmed"], bound: "lower" }), y).words, "on or after 26 Sep")
  assert.equal(F.finishDay(day({ state: "partial", reasons: ["anchor_spread"], bound: "unknown" }), y).words, "about 26 Sep (direction not known)")
  // The rollup and map files write no direction as null.
  assert.equal(F.finishDay(day({ state: "partial", reasons: ["anchor_unconfirmed", "finish_from_last_work"], bound: null, bound_reason: "bound_reasons_conflict" }), y).words, "about 26 Sep (direction not known)")
  // A day with no source says so, with the reason, never a guessed date.
  const none = F.finishDay({ state: "unavailable", reasons: ["no_finish_source"] }, y)
  assert.equal(none.words, `not dated yet: ${F.reasonText("no_finish_source")}`)
  assert.equal(none.day, null)
  assert.equal(F.finishDay(undefined, y).words, `not dated yet: ${F.reasonText("not_recorded")}`)
  assert.equal(F.finishDay({ state: "unavailable", reasons: ["open_job"] }, y).kind, "open")
})

test("a finish day has a short form for chart labels, a sort key, and its year when it is not this year", () => {
  const y = { year: 2026 }
  const f = (bound, state = "partial") => F.finishDay({ state, value: "2026-10-07", reasons: state === "measured" ? [] : ["x"], basis: "labels_landed", ...(bound !== undefined ? { bound } : {}) }, y)
  assert.equal(f(undefined, "measured").short, "7 Oct")
  assert.equal(f("upper").short, "≤7 Oct")
  assert.equal(f("lower").short, "≥7 Oct")
  assert.equal(f("unknown").short, "~7 Oct")
  assert.equal(F.finishDay({ state: "unavailable", reasons: ["no_finish_source"] }, y).short, "no date")
  assert.equal(f("upper").key, "2026-10-07")
  assert.equal(F.finishDay({ state: "measured", value: "2025-12-30", reasons: [], basis: "desk_transition" }, y).words, "on 30 Dec 2025")
  // A malformed day is not shown as a date.
  assert.equal(F.finishDay({ state: "measured", value: "2026-13-40", reasons: [] }, y).day, null)
})
