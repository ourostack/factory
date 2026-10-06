// The overview's data shaping: each task's waste from its label files, the
// trend by Desk release, the "what to fix next" list, the task fields the
// task table reads, and the private-names overlay staying out of the public
// build.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { fixNext, WASTE_ACTIONS } from "../../../site/scripts/fix-next.mjs"
import { jobSummary, sessionsOf } from "../../../site/scripts/job-summary.mjs"
import { releaseTrend } from "../../../site/scripts/outcomes.mjs"
import { compareVersions, jobWaste } from "../../../site/scripts/waste.mjs"
import { measured, unavailable } from "../../../site/scripts/state.mjs"

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const stretch = (start, end, cls, waste = null, confidence) => ({ start_ms: start, end_ms: end, class: cls, waste, ...(confidence ? { confidence } : {}) })

test("a task with no label file has no waste rows and zero sessions labeled, never zero waste", () => {
  const w = jobWaste([], measured(2))
  assert.deepEqual(w.rows, [])
  assert.equal(w.sessions_labeled.value, 0)
})

test("a task's labeled time sums per class and waste, largest first, with confidence per level", () => {
  const doc = { job: "j", stretches: [stretch(0, 100, "value", null, "high"), stretch(100, 400, "muda", "waiting", "high"), stretch(400, 450, "muda", "waiting", "low"), stretch(450, 470, "unknown", "unknown", "medium")] }
  const w = jobWaste([doc], measured(1))
  assert.deepEqual(w.rows.map((r) => [r.key, r.kind, r.total_ms.value, r.total_ms.state]), [["waiting", "waste", 350, "measured"], ["value", "value", 100, "measured"], ["unknown", "unknown", 20, "measured"]])
  const waiting = w.rows[0]
  assert.equal(waiting.confidence.high_ms.value, 300)
  assert.equal(waiting.confidence.low_ms.value, 50)
  assert.deepEqual(waiting.qualifiers, ["low_confidence"])
  assert.deepEqual(w.rows[2].qualifiers, ["unknown_label"])
  assert.deepEqual(checkNumbers({ jobs: [{ waste: w }] }), [])
})

test("with fewer label files than bound sessions every row is at least its figure, and a /1 label has no recorded confidence", () => {
  const w = jobWaste([{ job: "j", stretches: [stretch(0, 60, "muda", "defects")] }], measured(3))
  const r = w.rows[0]
  assert.equal(r.total_ms.state, "partial")
  assert.equal(r.total_ms.bound, "lower")
  assert.deepEqual(r.total_ms.reasons, ["some_sessions_not_labeled"])
  assert.equal(r.confidence.high_ms.state, "unavailable")
  assert.deepEqual(r.qualifiers, ["confidence_not_recorded"])
  // An unknown session count cannot say the labels are whole.
  assert.equal(jobWaste([{ job: "j", stretches: [stretch(0, 60, "support")] }], unavailable(["not_recorded"])).rows[0].total_ms.state, "partial")
  assert.deepEqual(checkNumbers({ jobs: [{ waste: w }] }), [])
})

test("a task summary carries its outcome, operator turns, public pull requests and sessions", () => {
  const j = jobSummary(
    {
      job: "abc",
      formulas: {
        status: { class: "declared", state: "measured", value: "done", reasons: [] },
        attention: { class: "inferred", state: "partial", value: 90000, turns: 4, reasons: ["turns_not_recorded"] },
        references: { class: "measured", state: "measured", reasons: [], value: { public_prs: 2, public_pull_requests: [{ repo: "o/r", number: 7 }, { repo: "bad repo", number: 8 }] } },
      },
      timeline: { intervals: [{ session_id: "s1", host: "claude-code" }, { session_id: "s1", host: "claude-code" }, { session_id: "s2", host: "copilot-cli" }, { session_id: "../x" }] },
    },
    "abc.json",
  )
  assert.equal(j.outcome, "delivered")
  assert.equal(j.attention_ms.value, 90000)
  assert.equal(j.attention_ms.bound, "lower")
  assert.equal(j.human_turns.value, 4)
  assert.equal(j.human_turns.state, "partial")
  assert.deepEqual(j.pull_requests, [{ ref: "#7", url: "https://github.com/o/r/pull/7" }])
  assert.deepEqual(j.sessions, [{ session_id: "s1", host: "claude-code" }, { session_id: "s2", host: "copilot-cli" }])
  assert.deepEqual(sessionsOf({}), [])
  // No attention record: no data, never zero turns.
  const none = jobSummary({ job: "x", formulas: {} }, "x.json")
  assert.equal(none.human_turns.state, "unavailable")
  assert.equal(none.outcome, "unknown")
  assert.deepEqual(checkNumbers({ jobs: [j, none] }), [])
})

test("the trend reads Desk's release groupings oldest first, with several releases last, and passes the numbers check", () => {
  const outcomes = {
    groupings: {
      plugin_version: {
        "3.2.0-alpha.10": { signoff: { recorded: true, jobs: 2, accepted: 1, accepted_unverified: 1, refused: 0, delivered_unsigned: 0, not_recorded: 0, not_delivered: 0, no_record: 0 } },
        mixed: { signoff: { recorded: false } },
        "3.2.0-alpha.9": { signoff: { recorded: false } },
      },
    },
  }
  const measures = { groupings: { plugin_version: { "3.2.0-alpha.10": { jobs: 2, measures: { flow_efficiency: { N: 2, n: 1, median: 0.4, state: "partial", jobs_excluded: [{ jobs: 1, reason: "open_job" }] } } } } } }
  const t = releaseTrend(outcomes, measures, compareVersions)
  assert.deepEqual(t.map((r) => r.version), ["3.2.0-alpha.9", "3.2.0-alpha.10", "mixed"])
  assert.equal(t[1].accepted.value, 2)
  assert.equal(t[1].flow_efficiency.state, "partial")
  assert.equal(t[1].flow_efficiency.n, 1)
  assert.equal(t[0].jobs.state, "unavailable")
  assert.deepEqual(t[0].accepted.reasons, ["signoff_not_published"])
  assert.deepEqual(checkNumbers({ trend: t }), [])
  assert.deepEqual(releaseTrend(null, null, compareVersions), [])
})

const task = (id, over = {}) => ({
  id,
  status: "done",
  outcome: "delivered",
  lead_time_ms: measured(1000),
  active_time_ms: measured(500),
  human_wait_ms: unavailable(["host_does_not_record"]),
  api_retry_ms: measured(0),
  tool_failures: measured(0),
  signoff_wait: unavailable(["not_delivered"]),
  waste: { sessions_labeled: measured(0), rows: [] },
  ...over,
})

test("what to fix next lists alarms first, then sign-off, then waste with its tasks, then open cards, then signals", () => {
  const labeled = task("w", { waste: { sessions_labeled: measured(1), rows: [{ key: "waiting", kind: "waste", total_ms: measured(9000) }, { key: "value", kind: "value", total_ms: measured(99999) }] } })
  const items = fixNext({
    jobs: [task("a", { outcome: "awaiting_signoff", signoff_wait: measured("waiting at least 1 day"), tool_failures: measured(5) }), task("b"), labeled],
    outcomes: { signoff: { accepted: measured(0) }, attention: { headline: unavailable(["no_accepted_outcomes", "no_turn_records"]) } },
    kaizenIssues: [
      { ref: "#2", url: "https://github.com/o/r/issues/2", issue_state: "open", age_days: measured(3) },
      { ref: "#1", url: "https://github.com/o/r/issues/1", issue_state: "open", age_days: measured(9), title: "Kaizen: x" },
      { ref: "#0", url: "https://github.com/o/r/issues/0", issue_state: "closed", age_days: measured(20) },
    ],
    andonIssues: [{ ref: "#5", url: "https://github.com/o/r/issues/5", issue_state: "open", age_days: measured(1) }],
    capture: { alarms: [] },
    loop: { alarms: [] },
  })
  assert.deepEqual(items.map((i) => i.id), ["andon", "awaiting_signoff", "no_accepted", "no_turn_records", "waste_waiting", "unlabeled", "kaizen_open", "signal_tool_failures"])
  const waste = items.find((i) => i.id === "waste_waiting")
  assert.equal(waste.action, WASTE_ACTIONS.waiting)
  assert.deepEqual(waste.examples.map((e) => e.job), ["w"])
  // Value time is never listed as waste.
  assert.ok(!items.some((i) => i.id === "waste_value"))
  // The oldest open card first; a closed card is not listed.
  assert.deepEqual(items.find((i) => i.id === "kaizen_open").links.map((l) => l.ref), ["#1", "#2"])
  assert.deepEqual(items.find((i) => i.id === "awaiting_signoff").examples.map((e) => e.job), ["a"])
  // Every item says what to do, and every number is a stated number.
  for (const i of items) assert.ok(i.action && i.title)
  assert.deepEqual(checkNumbers({ fix_next: items }), [])
})

test("an accepted outcome, no waiting delivery and nothing labeled leaves only what is true", () => {
  const items = fixNext({ jobs: [task("a", { status: "processing", outcome: "in_progress" })], outcomes: { signoff: { accepted: measured(2) }, attention: { headline: measured(1) } } })
  assert.deepEqual(items, [])
})

test("the private-names overlay is read by the page and never produced by the public build", () => {
  const app = read("site/src/app.js")
  assert.match(app, /fetch\("\.\/local-names\.json"/)
  assert.match(app, /file\.version === 1/)
  for (const p of [".github/workflows/pages.yml", "site/scripts/build-data.mjs"]) assert.doesNotMatch(read(p), /local-names/, p)
  // The deploy copies an explicit list of files, so nothing else reaches the site.
  assert.match(read(".github/workflows/pages.yml"), /cp site\/src\/index\.html site\/src\/styles\.css site\/src\/format\.js site\/src\/app\.js site\/dist\//)
})

test("the page has the overview's parts and a guide on how to read it", () => {
  const html = read("site/src/index.html")
  for (const id of ["glance", "answer", "fix", "rest", "tasks", "guide", "view-job", "view-session"]) assert.match(html, new RegExp(`id="${id}"`), id)
  assert.match(html, /recorded by the agent through Desk's sign-off tool|on the operator's word/)
  assert.doesNotMatch(html, /witnessed/)
})
