// The overview's data shaping: each task's waste from its label files, the
// trend by Desk release, the "what to fix next" list, the task fields the
// task table reads, and the private-names overlay staying out of the public
// build.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { checkNumbers } from "../../../site/scripts/check-numbers.mjs"
import { fixNext, SHOWN, WASTE_ACTIONS } from "../../../site/scripts/fix-next.mjs"
import { jobSummary, sessionsOf } from "../../../site/scripts/job-summary.mjs"
import { releaseTrend } from "../../../site/scripts/outcomes.mjs"
import { compareVersions, jobWaste, labeledWaste, ownShare, WASTE_NAMES } from "../../../site/scripts/waste.mjs"
import { measured, unavailable } from "../../../site/scripts/state.mjs"
import { createRequire } from "node:module"

const F = createRequire(import.meta.url)("../../../site/src/format.js")

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const stretch = (start, end, cls, waste = null, confidence) => ({ start_ms: start, end_ms: end, class: cls, waste, ...(confidence ? { confidence } : {}) })

const label = (session, stretches, job = "j") => ({ job, session, stretches })
// The job owns all of each named session, as a session with one job does.
const owns = (...ids) => new Map(ids.map((id) => [id, [[0, 1e12]]]))

test("a task with no label file has no waste rows and zero sessions labeled, never zero waste", () => {
  const w = jobWaste([], ["s1", "s2"], owns("s1", "s2"))
  assert.deepEqual(w.rows, [])
  assert.equal(w.sessions_labeled.value, 0)
  assert.equal(w.sessions_on_timeline.value, 2)
})

test("a task's labeled time sums per class and waste, largest first, with confidence per level", () => {
  const doc = label("s1", [stretch(0, 100, "value", null, "high"), stretch(100, 400, "muda", "waiting", "high"), stretch(400, 450, "muda", "waiting", "low"), stretch(450, 470, "unknown", "unknown", "medium")])
  const w = jobWaste([doc], ["s1"], owns("s1"))
  assert.deepEqual(w.rows.map((r) => [r.key, r.kind, r.total_ms.value, r.total_ms.state]), [["waiting", "waste", 350, "measured"], ["value", "value", 100, "measured"], ["unknown", "unknown", 20, "measured"]])
  const waiting = w.rows[0]
  assert.equal(waiting.confidence.high_ms.value, 300)
  assert.equal(waiting.confidence.low_ms.value, 50)
  assert.deepEqual(waiting.qualifiers, ["low_confidence"])
  assert.deepEqual(w.rows[2].qualifiers, ["unknown_label"])
  assert.deepEqual(checkNumbers({ jobs: [{ waste: w }] }), [])
})

test("with some timeline sessions unlabeled every row is at least its figure, and a /1 label has no recorded confidence", () => {
  const w = jobWaste([label("s1", [stretch(0, 60, "muda", "defects")])], ["s1", "s2", "s3"], owns("s1", "s2", "s3"))
  const r = w.rows[0]
  assert.equal(r.total_ms.state, "partial")
  assert.equal(r.total_ms.bound, "lower")
  assert.deepEqual(r.total_ms.reasons, ["some_sessions_not_labeled"])
  assert.equal(r.confidence.high_ms.state, "unavailable")
  assert.deepEqual(r.qualifiers, ["confidence_not_recorded"])
  assert.deepEqual(checkNumbers({ jobs: [{ waste: w }] }), [])
})

test("a label counts for a task only when its session is on the task's timeline, matched by session, not by count", () => {
  // The label file names this job, but its session belongs to another job's timeline.
  const foreign = label("other", [stretch(0, 9000, "muda", "waiting", "high")])
  const w = jobWaste([foreign], ["s1", "s2"], owns("s1", "s2", "other"))
  assert.deepEqual(w.rows, [])
  assert.equal(w.sessions_labeled.value, 0)
  assert.equal(w.foreign_sessions.value, 1)
  // Two label files for a two-session task are not "whole" when one is foreign.
  const mixed = jobWaste([label("s1", [stretch(0, 60, "muda", "defects", "high")]), foreign], ["s1", "s2"], owns("s1", "s2"))
  assert.equal(mixed.sessions_labeled.value, 1)
  assert.equal(mixed.rows.length, 1)
  assert.equal(mixed.rows[0].total_ms.state, "partial")
  assert.equal(mixed.foreign_sessions.value, 1)
  // Two labels of the same session count once.
  const twice = jobWaste([label("s1", [stretch(0, 10, "value", null, "high")]), label("s1", [stretch(10, 20, "value", null, "high")])], ["s1", "s2"], owns("s1", "s2"))
  assert.equal(twice.sessions_labeled.value, 1)
  assert.equal(twice.rows[0].total_ms.state, "partial")
  // The foreign label raises an alarm naming the task, and drives no waste item.
  const items = fixNext({ jobs: [task("c", { waste: w })], outcomes: { signoff: { accepted: measured(1) }, attention: { headline: measured(1) } } })
  assert.deepEqual(items.map((i) => i.id), ["labels_mismatch", "unlabeled"])
  assert.deepEqual(items[0].examples.map((e) => e.job), ["c"])
  assert.deepEqual(checkNumbers({ jobs: [{ waste: w }, { waste: mixed }], fix_next: items }), [])
})

test("a session shared by several jobs counts for each only inside its own segments, never whole", () => {
  // One session, 0..1000, labeled whole by each job's evaluator; job a owns 0..300 and 600..700, job b owns 300..600.
  const whole = [stretch(0, 200, "value", null, "high"), stretch(200, 800, "muda", "waiting", "high"), stretch(800, 1000, "muda", "defects", "low")]
  const bindings = [
    { job: "a", segments: [{ start_ms: 600, end_ms: 700 }, { start_ms: 0, end_ms: 300 }] },
    { job: "b", segments: [{ start_ms: 300, end_ms: 600 }] },
  ]
  const a = jobWaste([label("s1", whole, "a")], ["s1"], new Map([["s1", ownShare(bindings, "a")]]))
  const b = jobWaste([label("s1", whole, "b")], ["s1"], new Map([["s1", ownShare(bindings, "b")]]))
  assert.deepEqual(a.rows.map((r) => [r.key, r.total_ms.value, r.total_ms.state]), [["value", 200, "measured"], ["waiting", 200, "measured"]])
  assert.deepEqual(b.rows.map((r) => [r.key, r.total_ms.value]), [["waiting", 300]])
  assert.equal(a.rows[1].confidence.high_ms.value, 200, "confidence follows the clipped time")
  // The overview sums the shares, so the session's waiting time (600) is counted at most once: 200 + 300.
  const lw = labeledWaste([{ status: "done", waste: a }, { status: "done", waste: b }])
  assert.deepEqual(lw.rows.map((r) => [r.key, r.total_ms.value, r.jobs.value]), [["waiting", 500, 2]])
  assert.deepEqual(checkNumbers({ jobs: [{ waste: a }, { waste: b }], labeled_waste: lw }), [])
})

test("a shared segment counts for each job that holds it, and once in the overview", () => {
  // Jobs a and b both hold 0..100 (a shared segment); a also owns 100..300. Each labeled the session whole, differently.
  const bindings = [{ job: "a", segments: [{ start_ms: 0, end_ms: 100, shared: true }, { start_ms: 100, end_ms: 300 }] }, { job: "b", segments: [{ start_ms: 0, end_ms: 100, shared: true }] }]
  const a = jobWaste([label("s1", [stretch(0, 300, "muda", "waiting", "high")], "a")], ["s1"], new Map([["s1", ownShare(bindings, "a")]]))
  const b = jobWaste([label("s1", [stretch(0, 50, "muda", "defects", "high"), stretch(50, 300, "muda", "waiting", "high")], "b")], ["s1"], new Map([["s1", ownShare(bindings, "b")]]))
  assert.deepEqual(a.rows.map((r) => [r.key, r.total_ms.value]), [["waiting", 300]])
  assert.deepEqual(b.rows.map((r) => [r.key, r.total_ms.value]), [["defects", 50], ["waiting", 50]])
  assert.ok(!Object.keys(a).includes("pieces"), "the counted stretches are not published")
  // The first job by ID keeps the shared time: the session's 300 ms count once, all as a's waiting.
  const lw = labeledWaste([{ id: "b", status: "done", waste: b }, { id: "a", status: "done", waste: a }])
  assert.deepEqual(lw.rows.map((r) => [r.key, r.total_ms.value, r.jobs.value]), [["waiting", 300, 2], ["defects", 0, 1]])
  assert.equal(JSON.parse(JSON.stringify(a)).pieces, undefined)
  // Rows built without counted stretches are summed as they are.
  const bare = { status: "done", waste: { rows: [{ key: "motion", kind: "waste", total_ms: measured(7) }, { key: "value", kind: "value", total_ms: measured(9) }] } }
  assert.deepEqual(labeledWaste([bare]).rows.map((r) => [r.key, r.total_ms.value, r.jobs.value]), [["motion", 7, 1]])
})

test("a label file with no stretch inside the job's share is not labeled for the job, never a zero", () => {
  const w = jobWaste([label("s1", [stretch(500, 900, "muda", "waiting", "high")])], ["s1"], new Map([["s1", [[0, 100]]]]))
  assert.deepEqual(w.rows, [])
  assert.equal(w.sessions_labeled.value, 0)
  const mixed = jobWaste([label("s1", [stretch(500, 900, "muda", "waiting", "high")]), label("s2", [stretch(0, 40, "muda", "defects", "high")])], ["s1", "s2"], new Map([["s1", [[0, 100]]], ["s2", [[0, 100]]]]))
  assert.equal(mixed.sessions_labeled.value, 1)
  assert.deepEqual(mixed.rows[0].total_ms.reasons, ["some_sessions_not_labeled"])
  // An empty label file (the evaluator found nothing) still counts as labeled.
  assert.equal(jobWaste([label("s1", [])], ["s1"], owns("s1")).sessions_labeled.value, 1)
})

test("a labeled session whose share is not known adds nothing and leaves the rows partial, never full-session", () => {
  const doc = label("s2", [stretch(0, 9000, "muda", "waiting", "high")])
  const known = label("s1", [stretch(0, 60, "muda", "defects", "high")])
  // No binding, a binding without segments, and segments that are not spans are all unknown.
  for (const bindings of [undefined, [], [{ job: "x", segments: [{ start_ms: 0, end_ms: 10 }] }], [{ job: "j", agents: [0] }], [{ job: "j", segments: [{ start_ms: 5, end_ms: 5 }, null, { start_ms: "0", end_ms: 9 }] }]]) {
    assert.equal(ownShare(bindings, "j"), null)
    const w = jobWaste([known, doc], ["s1", "s2"], new Map([["s1", [[0, 100]]], ["s2", ownShare(bindings, "j")]]))
    assert.deepEqual(w.rows.map((r) => [r.key, r.total_ms.value, r.total_ms.state]), [["defects", 60, "partial"]])
    assert.deepEqual(w.rows[0].total_ms.reasons, ["job_share_unknown"])
    assert.equal(w.rows[0].total_ms.bound, "lower")
    assert.equal(w.sessions_labeled.value, 2)
    assert.equal(w.sessions_share_unknown.value, 1)
    assert.deepEqual(checkNumbers({ jobs: [{ waste: w }] }), [])
  }
  // An older binding with no segments and no workers owns the whole session only when it is the session's one job.
  assert.deepEqual(ownShare([{ job: "j" }], "j"), [[0, Infinity]])
  assert.equal(ownShare([{ job: "j" }, { job: "k" }], "j"), null)
  assert.equal(ownShare([{ job: "j", agents: [3] }], "j"), null, "a subagent-only binding does not own the session")
  const legacy = jobWaste([doc], ["s2"], new Map([["s2", ownShare([{ job: "j" }], "j")]]))
  assert.deepEqual(legacy.rows.map((r) => [r.key, r.total_ms.value, r.total_ms.state]), [["waiting", 9000, "measured"]])
  // Without any shares at all nothing counts: no rows, never the whole session.
  const none = jobWaste([doc], ["s2"])
  assert.deepEqual(none.rows, [])
  assert.equal(none.sessions_share_unknown.value, 1)
  // Both reasons together when a session is also unlabeled.
  const both = jobWaste([known, doc], ["s1", "s2", "s3"], new Map([["s1", [[0, 100]]]]))
  assert.deepEqual(both.rows[0].total_ms.reasons, ["some_sessions_not_labeled", "job_share_unknown"])
  // Overlapping and touching segments merge, so no time counts twice.
  assert.deepEqual(ownShare([{ job: "j", segments: [{ start_ms: 50, end_ms: 80 }, { start_ms: 0, end_ms: 60 }, { start_ms: 80, end_ms: 90 }, { start_ms: 100, end_ms: 120, shared: true }] }], "j"), [[0, 90], [100, 120]])
  const once = jobWaste([label("s1", [stretch(0, 200, "muda", "waiting", "high")])], ["s1"], new Map([["s1", ownShare([{ job: "j", segments: [{ start_ms: 0, end_ms: 60 }, { start_ms: 50, end_ms: 80 }] }], "j")]]))
  assert.equal(once.rows[0].total_ms.value, 80)
})

test("the waste overview sums the same per-task labels, partial until every finished task is labeled", () => {
  const a = { status: "done", waste: jobWaste([label("s1", [stretch(0, 100, "muda", "waiting", "high"), stretch(100, 150, "value", null, "high")])], ["s1"], owns("s1")) }
  const b = { status: "done", waste: jobWaste([], ["s2"], owns("s2")) }
  const lw = labeledWaste([a, b])
  assert.equal(lw.jobs_with_labels.value, 1)
  assert.equal(lw.jobs_finished.value, 2)
  assert.deepEqual(lw.rows.map((r) => r.key), ["waiting"])
  assert.equal(lw.rows[0].total_ms.state, "partial")
  assert.equal(lw.rows[0].total_ms.value, 100)
  assert.deepEqual(lw.rows[0].total_ms.reasons, ["not_all_labeled"])
  assert.equal(labeledWaste([b]).rows.length, 0)
  assert.deepEqual(checkNumbers({ labeled_waste: lw }), [])
  // Every waste key the page can show has a plain name, shipped in the data.
  for (const k of ["defects", "overproduction", "waiting", "non_utilized_talent", "transportation", "inventory", "motion", "extra_processing", "unknown", "value", "support"]) assert.ok(WASTE_NAMES[k] && !WASTE_NAMES[k].includes("_"), k)
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
  // Desk's own accepted count per release, never the site's sum with unverified ones.
  assert.equal(t[1].accepted.value, 1)
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
  waste: { sessions_labeled: measured(0), sessions_on_timeline: measured(1), foreign_sessions: measured(0), rows: [] },
  ...over,
})

test("what to fix next lists alarms first, then sign-off, then waste with its tasks, then open cards, then signals", () => {
  const labeled = task("w", { waste: { sessions_labeled: measured(1), sessions_on_timeline: measured(1), foreign_sessions: measured(0), rows: [{ key: "waiting", kind: "waste", total_ms: measured(9000) }, { key: "value", kind: "value", total_ms: measured(99999) }] } })
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
  assert.deepEqual(items.map((i) => i.id), ["andon", "awaiting_signoff", "headline_blocked", "waste_waiting", "unlabeled", "kaizen_open", "signal_tool_failures"])
  // The two headline blockers are one item, with one step for each.
  const blocked = items.find((i) => i.id === "headline_blocked")
  assert.match(blocked.action, /task_signoff/)
  assert.match(blocked.action, /operator's turns/)
  // It says why the band above can read no data while these tasks exist.
  assert.match(blocked.action, /count only deliveries that have a sign-off record/)
  assert.deepEqual(blocked.examples, [{ job: "b" }, { job: "w" }])
  // An example carries a figure only when it supports the action.
  assert.deepEqual(items.find((i) => i.id === "unlabeled").examples.map((e) => Object.keys(e)), [["job"], ["job"]])
  // Each count says what it counts.
  for (const i of items) if (i.count) assert.ok(Array.isArray(i.noun) && i.noun.length === 2, i.id)
  assert.equal(SHOWN, 5)
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

test("the private-names overlay names tasks as text, and a missing or malformed file is the public view", () => {
  // The page's own render path: format.js parses the file and picks each label.
  const names = F.parseLocalNames({
    version: 1,
    jobs: {
      abc: { title: "<img src=x onerror=alert(1)>Real name", track: { x: 1 }, task: "ship-it" },
      num: { title: 42 },
      "../bad": { title: "path" },
      __proto__: { title: "proto" },
    },
  })
  assert.equal(F.jobLabel(names, "abc"), "<img src=x onerror=alert(1)>Real name")
  assert.equal(names.abc.track, "")
  assert.equal(names.abc.task, "ship-it")
  assert.equal(F.jobLabel(names, "num"), "Task num")
  assert.equal(F.jobLabel(names, "../bad"), "Task ../bad")
  assert.equal(F.jobLabel(names, "0123456789abcdef"), "Task 0123456789")
  assert.equal(F.jobLabel(names, "__proto__"), "Task __proto__")
  for (const bad of [null, "{", [], { version: 2, jobs: { abc: { title: "x" } } }, { version: 1, jobs: [] }, { version: 1 }]) {
    assert.deepEqual(Object.keys(F.parseLocalNames(bad)), [])
    assert.equal(F.jobLabel(F.parseLocalNames(bad), "abc"), "Task abc")
  }
  // The page inserts every label as text only, and gives up on the file after a second.
  const app = read("site/src/app.js")
  assert.match(app, /fetch\("\.\/local-names\.json"/)
  assert.match(app, /setTimeout\(\(\) => ctrl\.abort\(\), 1000\)/)
  assert.doesNotMatch(app, /innerHTML = [^"']/)
  // The public build never produces or names the file.
  for (const p of [".github/workflows/pages.yml", "site/scripts/build-data.mjs"]) assert.doesNotMatch(read(p), /local-names/, p)
  assert.match(read(".github/workflows/pages.yml"), /cp site\/src\/index\.html site\/src\/styles\.css site\/src\/format\.js site\/src\/app\.js site\/dist\//)
})

test("the page has the overview's parts and a guide on how to read it", () => {
  const html = read("site/src/index.html")
  for (const id of ["answer", "status-line", "fix", "tasks", "rest", "labeled-waste", "guide", "more", "view-job", "view-session"]) assert.match(html, new RegExp(`id="${id}"`), id)
  assert.match(html, /recorded by the agent through Desk's sign-off tool|on the operator's word/)
  assert.doesNotMatch(html, /witnessed/)
  // The order the operator reads: the answer, what to fix, every task, then the rest.
  const at = (id) => html.indexOf(`id="${id}"`)
  assert.ok(at("answer") < at("fix") && at("fix") < at("tasks") && at("tasks") < at("rest") && at("rest") < at("guide"))
  // "Declared" is explained in the guide.
  assert.match(html, /"Declared" means taken from the task card/)
})

test("a partial figure in a list keeps its reason in the title and for screen readers, not in the visible text", () => {
  const doc = { createElement: () => ({ className: "", textContent: "", title: "", children: [], appendChild(c) { this.children.push(c); return c } }) }
  const text = (n) => (n.className === "sr-only" ? "" : [n.textContent, ...n.children.map(text)].join(""))
  const n = F.render(doc, { state: "partial", value: 431, reasons: ["session_open"], bound: "lower" }, "count", { flag: "short", nofn: false })
  assert.doesNotMatch(text(n), /session had not ended/)
  assert.match(n.children.find((c) => c.className === "num-flag").title, /session had not ended/)
})

test("a no-data count line says the reason once, in words, and the page code does not print it twice", () => {
  assert.equal(F.reasonText("no_signoff_records"), "no delivered job has a sign-off record yet")
  const app = read("site/src/app.js")
  assert.match(app, /shared \|\| reasons\[i\] \? el\("span", "num num-unavailable", "no data"\)/)
})
