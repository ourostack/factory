// The whole-walk review's fixes (S6): the landing rule, the "agent on
// another task" wait and each gap's own split, the share-of-task mode, the
// agent twins (the store's fields on tasks.json, reasons.json, which files
// state a figure's direction), a cause's A3 already taken on, Act's plain
// titles and count, and the prompts' index line. Every rule lives in
// site/src (walk.js, steps.js, format.js) or site/scripts/publish-files.mjs.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

import { boundCoverage, directionText, enrichTasks, llmsText, publishData, reasonsDoc } from "../../../site/scripts/publish-files.mjs"

const require = createRequire(import.meta.url)
const S = require("../../../site/src/steps.js")
const W = require("../../../site/src/walk.js")
const F = require("../../../site/src/format.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const H = 3600000
const M = 60000
const m = (value) => ({ state: "measured", value, reasons: [] })
const p = (value, reasons, extra) => ({ state: "partial", value, reasons, ...(extra || {}) })

// ------------------------------------------- the agent on another task (I-2)

test("an idle stretch while the agent worked another task reads as its own cause, never as cause not recorded", () => {
  assert.ok(W.WAIT_KEYS.includes("other_task"))
  assert.equal(W.causeWords("waiting:other_task"), "Waiting · agent on another task")
  assert.equal(W.waitCauseLabel("other_task"), "Agent on another task")
  assert.equal(W.waitedOnWords("other_task", "long"), "the agent was working on another task")
  assert.ok(S.isCauseKey("waiting:other_task"))
  assert.equal(S.causeRoute("waiting:other_task"), "#/causes/waiting:other_task")
  // The three idle causes that sound alike are worded apart, everywhere.
  assert.equal(W.waitedOnWords("unknown", "long"), "no agent was working on this task, and the cause was not recorded")
  assert.equal(W.waitedOnWords("no_session", "long"), "no session of this task was running")
  for (const k of ["unknown", "no_session", "other_task"]) assert.doesNotMatch(W.waitedOnWords(k, "long"), /nothing was running/)
  assert.match(read("site/src/styles.css"), /--c-wait-other_task: #[0-9a-f]{6};[\s\S]*--c-wait-other_task: #[0-9a-f]{6};/, "its own color in light and dark")
  assert.match(read("site/src/styles.css"), /\.wait-other_task \{ --sw: var\(--c-wait-other_task\)/)
})

test("a task row with an other_task split draws it on the bar, ranks it in the lede and keeps the totals", () => {
  const row = {
    job: "j",
    lead_time_ms: m(10 * H),
    working_ms: m(H),
    idle_ms: m(9 * H),
    waiting_by_waited_on_ms: { other_task: m(6 * H), next_prompt: m(2 * H), unknown: m(H) },
    flow_efficiency: m(0.1),
    value_in_working_ms: m(20 * M),
  }
  const idle = W.idleSplit(row, null)
  assert.deepEqual(idle.by.map((x) => x.key), ["other_task", "next_prompt", "unknown"])
  const bar = W.timeBar({ job: "j", lead_time_ms: m(10 * H), working_ms: m(H), idle_ms: m(9 * H), working: { class_ms: { value: m(20 * M), support: m(40 * M) } }, idle: {} }, row, idle, F.SEGMENTS)
  const waiting = bar.groups[1]
  assert.deepEqual(waiting.segments.map((s) => s.key), ["wait_next_prompt", "wait_other_task", "wait_unknown"], "the bar keeps one fixed order")
  assert.equal(waiting.segments.reduce((a, s) => a + s.ms, 0), 9 * H)
  const text = W.ledeText(W.lede(row, F.reasonText, { idle }))
  assert.match(text, /The largest part, 6 hours, was while the agent was working on another task\./)
  // Compare's lede names it in its own words.
  const all = S.stackBars([{ id: "j", status: "done", finish_order: m(1), finish_basis: "labels" }], [{ job: "j", lead_time_ms: m(10 * H), working_ms: m(H), idle_ms: m(9 * H), working: {}, idle: {} }], [row], { segments: F.SEGMENTS })
  assert.match(S.compareLede(all, [row]).text, /mostly while the agent was working on another task \(6 hours\)/)
  // A longest wait on it reads "also" in its words.
  const one = { ...row, waiting_by_waited_on_ms: { other_task: m(9 * H) }, longest_gap: m({ duration_ms: 5 * H, waited_on: "other_task" }) }
  assert.match(W.ledeText(W.lede(one, F.reasonText)), /The longest single wait was 5 hours, also while the agent was on another task\./)
})

// ---------------------------------------------------- each gap's own split

test("a gap with Desk's per-gap split is split exactly; without one it is its dominant cause", () => {
  const exact = { start_ms: 0, end_ms: 10 * H, waited_on: "other_task", idle_by_waited_on_ms: { other_task: 7 * H, next_prompt: { state: "measured", value: 3 * H, reasons: [] } } }
  assert.deepEqual(W.gapIdleBy(exact), { other_task: 7 * H, next_prompt: 3 * H })
  assert.deepEqual(W.gapCauses(exact), ["other_task", "next_prompt"])
  assert.deepEqual(W.gapIdleBy({ start_ms: 0, end_ms: H, waited_on: "next_prompt" }), { next_prompt: H })
  // A split that leaves time over gives the rest to "cause not recorded"; one that overshoots is scaled to fit.
  assert.deepEqual(W.gapIdleBy({ start_ms: 0, end_ms: 4 * H, waited_on: "api_retry", idle_by_waited_on_ms: { api_retry: H } }), { api_retry: H, unknown: 3 * H })
  assert.deepEqual(W.gapIdleBy({ start_ms: 0, end_ms: 2 * H, waited_on: "other_task", idle_by_waited_on_ms: { other_task: 3 * H, next_prompt: H } }), { other_task: 1.5 * H, next_prompt: 0.5 * H })
  // An empty or unreadable split falls back to the dominant cause; an unknown key reads as not recorded.
  assert.deepEqual(W.gapIdleBy({ start_ms: 0, end_ms: H, waited_on: "long_tool_call", idle_by_waited_on_ms: { next_prompt: 0 } }), { long_tool_call: H })
  assert.deepEqual(W.gapIdleBy({ start_ms: 0, end_ms: H, waited_on: "x", idle_by_waited_on_ms: { brand_new: H } }), { unknown: H })
})

test("the map uses each gap's split for its waits, its folded waits and the task's waiting split", () => {
  const map = {
    bursts: [{ start_ms: 0, end_ms: H, working_ms: H }, { start_ms: 11 * H, end_ms: 12 * H, working_ms: H }, { start_ms: 12 * H + 5 * M, end_ms: 13 * H, working_ms: 55 * M }],
    gaps: [
      { start_ms: H, end_ms: 11 * H, waited_on: "other_task", idle_by_waited_on_ms: { other_task: 7 * H, next_prompt: 3 * H } },
      { start_ms: 12 * H, end_ms: 12 * H + 5 * M, waited_on: "next_prompt", idle_by_waited_on_ms: { other_task: 4 * M, next_prompt: M } },
    ],
  }
  const row = { lead_time_ms: m(13 * H), working_ms: m(2 * H + 55 * M) }
  const idle = W.idleSplit(row, map)
  assert.equal(idle.source, "map")
  assert.equal(idle.gap_split, true)
  assert.deepEqual(Object.fromEntries(idle.by.map((x) => [x.key, x.ms])), { other_task: 7 * H + 4 * M, next_prompt: 3 * H + M })
  const model = W.mapModel(map, { maxBoxes: 2 })
  const wait = model.items.find((x) => x.type === "wait")
  assert.equal(wait.waited_on, "mixed", "a wait with two causes says so")
  assert.deepEqual(wait.causes, ["other_task", "next_prompt"])
  const box = model.items.filter((x) => x.type === "box").pop()
  assert.deepEqual(box.inner_by, { other_task: 4 * M, next_prompt: M }, "a folded gap keeps its split inside the box")
  const d = W.drawer({ kind: "wait", item: wait }, { model, lead_ms: 13 * H })
  const rows = Object.fromEntries(d.rows)
  assert.equal(rows["Waited on"], "agent on another task, 7 hours; next prompt (the agent had stopped), 3 hours")
  assert.equal(d.cause, "other_task", "the drawer wears the largest cause's own swatch")
  // The slim map file keeps the split.
  const slim = W.slimMap({ job: { id: "j" }, timeline: { gaps: map.gaps, bursts: [] } })
  assert.deepEqual(slim.gaps[0].idle_by_waited_on_ms, { other_task: 7 * H, next_prompt: 3 * H })
  assert.equal("idle_by_waited_on_ms" in W.slimMap({ job: { id: "j" }, timeline: { gaps: [{ start_ms: 0, end_ms: 1, waited_on: "unknown" }] } }).gaps[0], false)
})

test("the drawer's swatch is the wait's own cause, so one cause never wears two swatches (M-2)", () => {
  const model = W.mapModel({ bursts: [{ start_ms: 0, end_ms: H, working_ms: H }], gaps: [{ start_ms: H, end_ms: 3 * H, waited_on: "unknown" }] }, { maxBoxes: 4 })
  const wait = model.items.find((x) => x.type === "wait")
  assert.equal(W.drawer({ kind: "wait", item: wait }, { model }).cause, "unknown")
  const app = read("site/src/app.js")
  assert.match(app, /content\.cause \? waitSwatch\(content\.cause\) : swatch\(content\.segment\)/)
})

// ----------------------------------------------- the lede's bases (M-3, M-10)

test("every share in the lede and the bar names its base, and mostly unlabeled working time is said", () => {
  const row = { lead_time_ms: m(10 * H), working_ms: m(4 * H), idle_ms: m(6 * H), waiting_by_waited_on_ms: { next_prompt: m(5.9 * H), unknown: m(0.1 * H) }, value_in_working_ms: m(1000), flow_efficiency: m(0.4) }
  const text = W.ledeText(W.lede(row, F.reasonText, { unlabeled_ms: 3 * H }))
  assert.match(text, /nearly all of it \(98% of the waiting\) while/)
  assert.match(text, /More than half of that working time, 3 hours \(75% of the working time\), carries no label from the evaluator, so what it was is not known yet\./)
  assert.doesNotMatch(W.ledeText(W.lede(row, F.reasonText, { unlabeled_ms: 2 * H })), /More than half/, "exactly half is not more than half")
  assert.doesNotMatch(W.ledeText(W.lede(row, F.reasonText)), /More than half/, "no bar, no claim")
  // The unlabeled time comes from the task's bar.
  const bar = { state: "ok", groups: [{ key: "working", segments: [{ key: "value", ms: 1 }, { key: "agents_working_unlabeled", ms: 2 * H }, { key: "not_labeled", ms: H }] }, { key: "waiting", segments: [] }] }
  assert.equal(W.unlabeledMs(bar), 3 * H)
  assert.equal(W.unlabeledMs({ state: "lead_only" }), null)
  const app = read("site/src/app.js")
  assert.match(app, /of the lead time\$\{g\.key === "waiting"/, "the bar's group heads say what the share is of")
  assert.match(app, /\$\{W\.pctWords\(s\.share\)\} of the lead time`/, "and so do its legend rows")
})

// ---------------------------------------- the task bar opens evidence (I-6)

test("each part of a task's bar lights its evidence on the map: working parts their boxes, waiting causes their waits", () => {
  assert.equal(W.highlightSelector("class", { seg: "value" }), ".vsm-box.has-value, .sum-value")
  assert.equal(W.highlightSelector("class", { seg: "defects" }), ".vsm-box.has-defects")
  assert.equal(W.highlightSelector("class", { seg: "support" }), ".vsm-box, .lad-low, .sum-working")
  assert.equal(W.highlightSelector("wait_cause", { cause: "other_task" }), ".vsm-wait.has-other_task, .lad-high.has-other_task")
  const app = read("site/src/app.js")
  assert.match(app, /el\("button", `tw-seg tw-part tw-\$\{s\.key\}`\)/, "each segment is a button")
  assert.match(app, /el\("button", "tw-row tw-part"\)/, "each legend row is a button")
  assert.match(app, /light\(s\.cause \? \{ key: "wait_cause", cause: s\.cause \} : \{ key: "class", seg: s\.key \}, btn\)/)
  assert.match(app, /tokens\.push\(\.\.\.twEl\.querySelectorAll\("\.tw-part"\)\)/, "they share one pressed state with the lede's numbers")
  assert.match(app, /"Rank this cause"/, "a waiting cause offers its page on Rank causes")
  assert.match(app, /has-value" : ""\}\$\{hasMs\(it\.defect_stretches\) \? " has-defects"/)
})

// ------------------------------------------------- the landing view (I-1)

test("#/ opens today's latest task, 825084c9, from the real snapshot", () => {
  const snap = JSON.parse(read(".github/fixtures/walk/snapshot.json"))
  const jobs = snap.jobs
  assert.ok(Array.isArray(jobs) && jobs.length > 0)
  const labeled = jobs.filter((j) => j.finish_basis === "labels" && j.finish_order && j.finish_order.state === "measured")
  const latest = labeled.reduce((a, j) => (!a || j.finish_order.value > a.finish_order.value ? j : a), null)
  assert.equal(F.defaultTask(jobs).id, latest.id)
  assert.equal(latest.id.slice(0, 8), "825084c9")
  // The rule is said the same way to people and to agents.
  assert.match(read("site/src/index.html"), /opens on the finished task with the latest finish position, named or private/)
  assert.match(read("site/src/llms-template.txt"), /`#\/` opens on the finished task with the latest finish position \(`finish_order`\), named or private/)
})

// ------------------------------------------------- share of each task (I-4)

test("share mode draws every bar as its own lead time, 0 to 100%, in the same parts and order", () => {
  const jobs = [
    { id: "a", status: "done", finish_order: m(1), finish_basis: "labels" },
    { id: "b", status: "done", finish_order: m(2), finish_basis: "labels" },
    { id: "c", status: "done", finish_order: m(3), finish_basis: "labels" },
    { id: "d", status: "processing", finish_order: m(4), finish_basis: "facts" },
  ]
  const stack = (job, lead, work) => ({ job, lead_time_ms: m(lead), working_ms: m(work), idle_ms: m(lead - work), working: { class_ms: { value: m(work / 2), support: m(work / 2) } }, idle: {} })
  const task = (job, lead, work, extra) => ({ job, lead_time_ms: m(lead), working_ms: m(work), idle_ms: m(lead - work), waiting_by_waited_on_ms: { next_prompt: m(lead - work) }, flow_efficiency: m(work / lead), ...(extra || {}) })
  const stackRows = [stack("a", 20 * M, 10 * M), stack("b", 200 * H, 20 * H)]
  const taskRows = [task("a", 20 * M, 10 * M), task("b", 200 * H, 20 * H, { working_ms: p(20 * H, ["log_truncated"], { bound: "lower" }), flow_efficiency: p(0.1, ["log_truncated"], { bound: "lower" }) }), { job: "c", lead_time_ms: m(5 * H), working_ms: { state: "unavailable", reasons: ["source_unreadable"] } }]
  const all = S.stackBars(jobs, stackRows, taskRows, { segments: F.SEGMENTS })
  const share = S.shareBars(all, taskRows)
  assert.deepEqual(share.map((b) => b.job), all.map((b) => b.job), "the same order")
  const [a, b, c, d] = share
  for (const x of [a, b]) {
    assert.equal(x.total_ms, 1)
    assert.ok(Math.abs(x.segments.reduce((s, g) => s + g.ms, 0) - 1) < 1e-9, "the parts add up to 100%")
    assert.ok(x.share)
  }
  assert.deepEqual(a.segments.map((s) => s.key), all[0].segments.map((s) => s.key), "the same parts in the same order")
  assert.equal(a.segments[0].ms, 0.25)
  assert.equal(a.label, "50% working")
  assert.equal(b.label, "≥10% working", "the task row's bound carries into the label")
  assert.equal(a.lead_ms, 20 * M, "the lead time is kept for the words")
  // A split not known stays one hatched part, never 100% of one class.
  assert.equal(c.state, "unsplit")
  assert.deepEqual(c.segments, [{ key: "unsplit", label: "Split not known", ms: 1 }])
  assert.equal(c.label, "split not known")
  assert.equal(d.state, "no_data", "no lead time stays the no-data stub")
  assert.equal(S.mostWaste(share, "share"), null, "full-height bars carry no single callout")
  assert.equal(S.shortPct(0.004), "<1%")
  assert.equal(S.shortPct(0.856), "86%")
})

test("the share mode lives in the URL and the page draws it on a 0 to 100% axis", () => {
  assert.deepEqual(F.parseRoute("#/compare?mode=share"), { view: "compare", mode: "share" })
  assert.deepEqual(F.parseRoute("#/causes?mode=share"), { view: "causes" }, "Rank causes has no share mode")
  assert.deepEqual(F.parseRoute("#/compare?mode=working"), { view: "compare", mode: "working" })
  const html = read("site/src/index.html")
  assert.match(html, /<button type="button" class="mode-btn" data-mode="share" aria-pressed="false">Share of each task<\/button>/)
  const app = read("site/src/app.js")
  assert.match(app, /const scale = share \? \{ unit: "share", per: 1, max_ms: 1, ticks: \[0, 0\.25, 0\.5, 0\.75, 1\] \}/)
  assert.match(app, /mode === "share" \? S\.shareBars\(all, taskRows\) : all/)
  assert.match(read("site/src/llms-template.txt"), /`\?mode=share`/)
})

// ------------------------------------------ the agent twins (I-3, M-9)

test("the store adds each task's name and finish order to tasks.json, and never a bound Desk did not state", () => {
  const tasks = { schema: "desk.factory.rollups/1", jobs: [
    { job: "pub", working_ms: p(3, ["log_truncated"]), idle_ms: p(5, ["log_truncated"], { bound: "upper" }) },
    { job: "priv", working_ms: m(1) },
    { job: "gone", working_ms: m(2) },
  ] }
  const data = { jobs: [
    { id: "pub", name: "Fix the build", finish_order: m(4), finish_group: m(2), finish_basis: "labels" },
    { id: "priv", finish_order: m(9), finish_group: m(2), finish_basis: "labels" },
  ] }
  const out = enrichTasks(tasks, data)
  assert.deepEqual(out.store_fields, ["name", "finish_order", "finish_group", "finish_basis", "finish_date"])
  assert.deepEqual(out.jobs[0], { ...tasks.jobs[0], name: "Fix the build", finish_order: m(4), finish_group: m(2), finish_basis: "labels", finish_date: null })
  assert.equal(out.jobs[1].name, null, "a private task has no name, as on the page")
  assert.deepEqual([out.jobs[2].name, out.jobs[2].finish_order, out.jobs[2].finish_basis], [null, null, null])
  assert.equal("bound" in out.jobs[0].working_ms, false, "no direction is invented")
  assert.equal(out.jobs[0].idle_ms.bound, "upper")
  assert.equal(enrichTasks(null, data), null)
  assert.deepEqual(boundCoverage(tasks), { partials: 2, bounded: 1 })
  assert.deepEqual(boundCoverage({ a: [p(1, [], { bound: null }), p(2, [], { bound: "lower" })] }), { partials: 2, bounded: 2 }, "bound: null (no direction known) counts as stated")
})

test("llms.txt says which files state a partial figure's direction, from the files themselves", () => {
  const some = directionText({ "rollups/tasks.json": { partials: 215, bounded: 12 }, "rollups/stackup.json": { partials: 235, bounded: 6 }, "rollups/causes.json": { partials: 1, bounded: 1 } })
  assert.match(some, /^`data\.json` gives `bound` on every partial figure\. So does `rollups\/causes\.json` \(1\)\. The rollups give it on only some: `rollups\/tasks\.json` on 12 of its 215 and `rollups\/stackup\.json` on 6 of its 235\. Where the key is absent, the file does not say which way the figure is off, so do not assume one; the store does not add a direction Desk did not state\./)
  assert.equal(some.match(/idle time is lead time minus working time/g).length, 1, "the rule is said once")
  assert.equal(directionText({}), "`data.json` gives `bound` on every partial figure.")
  assert.equal(directionText({ "rollups/tasks.json": { partials: 2, bounded: 2 }, "rollups/stackup.json": { partials: 3, bounded: 3 } }), "`data.json` gives `bound` on every partial figure. So do `rollups/tasks.json` (2) and `rollups/stackup.json` (3).")
  const txt = llmsText(read("site/src/llms-template.txt"), [{ path: "data.json", bytes: 10 }, { path: "reasons.json", bytes: 10 }, { path: "rollups/tasks.json", bytes: 10 }], { "rollups/tasks.json": { partials: 3, bounded: 1 } })
  assert.match(txt, /`rollups\/tasks\.json` on 1 of its 3\./)
  assert.doesNotMatch(txt, /\{\{/)
  assert.doesNotMatch(txt, /in the page's words/, "tasks.json holds keys and milliseconds, and says so")
  assert.match(txt, /## Reading the reasons\n\n- reasons\.json/)
  assert.match(txt, /plus the store's `name` \(null for a private task\), `finish_order`, `finish_group`, `finish_basis` and `finish_date`/)
  assert.match(txt, /`other_task` \(a session of the task was running, but its agent was working on another task; the other task is never named\)/)
  assert.match(txt, /where Desk gives `gaps\[\]\.idle_by_waited_on_ms`, that is the gap's exact split/)
  assert.match(txt, /kaizen_issues \(the problems in hand, each with the `cause` key it works on when one is known\)/)
})

test("reasons.json gives the page's words for every reason code, and the Pages build writes it with the enriched tasks file", () => {
  const doc = reasonsDoc()
  assert.equal(doc.schema, "factory.site.reasons/1")
  for (const code of ["censored", "card_dates_shorter_than_work", "log_truncated", "labels_from_shared_session"]) assert.equal(doc.reasons[code], F.reasonText(code), code)
  for (const [code, text] of Object.entries(doc.reasons)) assert.ok(F.hasReasonText(code) && typeof text === "string" && text, code)
  const dir = mkdtempSync(join(tmpdir(), "s6-publish-"))
  const reports = join(dir, "reports")
  const dist = join(dir, "dist")
  write(join(dist, "data.json"), JSON.stringify({ jobs: [{ id: "x1", name: "Public", finish_order: m(1), finish_group: m(1), finish_basis: "labels" }] }))
  write(join(reports, "rollups/tasks.json"), JSON.stringify({ jobs: [{ job: "x1", working_ms: m(1) }] }))
  const { files } = publishData({ reports, dist })
  assert.ok(files.some((f) => f.path === "reasons.json"))
  assert.deepEqual(JSON.parse(readFileSync(join(dist, "reasons.json"), "utf8")), doc)
  const t = JSON.parse(readFileSync(join(dist, "rollups/tasks.json"), "utf8"))
  assert.equal(t.jobs[0].name, "Public")
  assert.deepEqual(t.jobs[0].finish_order, m(1))
})

test("every prompt ends with the index of every data file (M-9)", () => {
  const base = { what: "the wait", taskName: "factory task x (private)", route: "https://s/#/task/x", select: "gaps=1", locator: "gaps[0]", dataUrl: "https://s/map/x.json" }
  assert.match(W.promptText({ ...base, indexUrl: "https://s/llms.txt" }), / Explain what happened and what we could change\. Index of every data file: https:\/\/s\/llms\.txt$/)
  const d = { label: "Waiting · next prompt (the agent had stopped)", key: "waiting:next_prompt", ms: 36 * H, tasks: [], jobs: 1, all: { rank: 2, of: 4, share: 0.23 } }
  assert.match(S.a3Prompt(d, { route: "https://s/#/causes/waiting:next_prompt", dataUrl: "https://s/rollups/causes.json", indexUrl: "https://s/llms.txt" }), /check it worked with labeled tasks from before and after it shipped\. Index of every data file: https:\/\/s\/llms\.txt$/)
  const app = read("site/src/app.js")
  assert.match(app, /indexUrl: absolute\("llms\.txt"\) \}\);/, "the drawer's prompt")
  assert.match(app, /indexUrl: absolute\("llms\.txt"\), existing \}\);/, "the cause page's prompt")
})

// ------------------------------------- a cause's A3 already taken on (I-5)

test("a cause the mapping table links to a kaizen issue shows that issue and asks to check or extend it, not start another", () => {
  const issues = [
    { ref: "#53", title: "Kaizen: desk skill friction, human_wait", issue_state: "closed", url: "https://github.com/ourostack/factory/issues/53", resolution: { kind: "countermeasure", ref: "#65", url: "https://github.com/ourostack/desk/pull/65", merged: true } },
    { ref: "#54", title: "Kaizen: desk skill friction, retouches", issue_state: "closed", url: "https://github.com/ourostack/factory/issues/54", resolution: { kind: "countermeasure", ref: "#65", url: "https://github.com/ourostack/desk/pull/65", merged: true } },
  ]
  const rows = S.actRows(issues, null)
  const taken = S.causeIssues(rows, "waiting:next_prompt")
  assert.equal(taken.length, 1)
  assert.equal(S.takenOnWords(taken), "Already taken on: factory#53, with countermeasure desk#65 (merged, not yet checked).")
  assert.deepEqual(S.causeIssues(rows, "waiting:other_task"), [])
  assert.equal(S.takenOnWords([]), "")
  const d = { label: "Waiting · next prompt (the agent had stopped)", key: "waiting:next_prompt", ms: 36 * H, tasks: [], jobs: 1, all: { rank: 2, of: 4, share: 0.23 } }
  const text = S.a3Prompt(d, { route: "https://s/#/causes/waiting:next_prompt", dataUrl: "https://s/rollups/causes.json", indexUrl: "https://s/llms.txt", existing: taken })
  assert.match(text, /^Factory cause "Waiting · next prompt \(the agent had stopped\)" \(waiting:next_prompt\): an A3 already exists at ourostack\/factory#53 \(https:\/\/github\.com\/ourostack\/factory\/issues\/53\), with countermeasure ourostack\/desk#65, merged, not yet checked; help me check or extend it\./)
  assert.doesNotMatch(text, /start an A3/i)
  assert.match(text, /Index of every data file: https:\/\/s\/llms\.txt$/)
  // The mapping is published as data: each kaizen issue's cause, from the same table.
  assert.equal(S.kaizenCauseOf("https://github.com/ourostack/factory/issues/53"), "waiting:next_prompt")
  assert.equal(S.kaizenCauseOf("https://github.com/ourostack/factory/issues/54"), null)
  assert.equal(S.kaizenCauseOf("javascript:alert(1)"), null)
  assert.match(read("site/scripts/build-data.mjs"), /const cause = kaizenCauseOf\(i\.url\);\n  return cause \? \{ \.\.\.i, cause \} : i;/, "an unmapped issue carries no cause key: the number check refuses a null")
  // A row reads the published cause first, so data.json and the page agree.
  const stated = S.actRows([{ ...issues[1], cause: "waiting:api_retry" }], null)
  assert.equal(stated[0].cause.key, "waiting:api_retry")
  assert.equal(S.actRows([{ ...issues[1], cause: "<bad>" }], null)[0].cause, null, "a malformed published cause is ignored")
  const app = read("site/src/app.js")
  assert.match(app, /S\.causeIssues\(S\.actRows\(data\.kaizen_issues, doc\), key\)/)
  assert.match(app, /"Check or extend the A3 with your agent"/)
})

// ------------------------------------------------------------ Act (M-7)

test("Act's rows read as plain sentences and its count says how many are closed and that none is checked", () => {
  for (const ref of ["ourostack/factory#39", "ourostack/factory#50", "ourostack/factory#51", "ourostack/factory#52", "ourostack/factory#53", "ourostack/factory#54"]) {
    const t = S.issueTitle(ref, "x")
    assert.match(t, /^[A-Z].*\.$/, ref)
    assert.doesNotMatch(t, /_|friction,/, ref)
  }
  assert.equal(S.issueTitle("ourostack/factory#99", "Kaizen: desk release friction, api_retries"), "Friction in Desk's release, measured by api retries.")
  assert.equal(S.issueTitle("ourostack/factory#99", "Kaizen: desk mcp_tool friction"), "Friction in Desk's mcp tool.")
  assert.equal(S.issueTitle("ourostack/factory#99", "Checkout guard fails closed"), "Checkout guard fails closed")
  assert.equal(S.issueTitle("ourostack/factory#99", undefined), null)
  const closed = (n) => ({ ref: `x#${n}`, state: "closed" })
  assert.equal(S.actSummary([1, 2, 3, 4, 5, 6].map(closed)), "6 problems taken on so far. All 6 are closed; none is checked yet, because no countermeasure has labeled tasks on both sides of it.")
  assert.equal(S.actSummary([closed(1), { ref: "x#2", state: "open" }]), "2 problems taken on so far. 1 of 2 is open and 1 closed; none is checked yet, because no countermeasure has labeled tasks on both sides of it.")
  assert.equal(S.actSummary([]), "")
  assert.match(read("site/src/app.js"), /el\("p", "act-summary", S\.actSummary\(rows\)\)/)
})

// --------------------------------------- the status line and glossary (M-1, M-11)

test("the status line is one line whose alarm words open their glossary entries, with the detail behind Health details", () => {
  assert.equal(F.glossaryRoute("capture-coverage"), "#/why?term=capture-coverage")
  assert.equal(F.glossaryRoute("x\"><script>"), null)
  assert.deepEqual(F.parseRoute("#/why?term=improvement-loop"), { view: "why", term: "improvement-loop" })
  assert.deepEqual(F.parseRoute("#/why?term=<x>"), { view: "why" })
  const html = read("site/src/index.html")
  for (const id of ["capture-coverage", "improvement-loop", "job-hours", "evaluator", "session", "card", "operator", "sign-off", "agent-on-another-task", "labeled-pause", "timeline-ladder", "andon"]) assert.match(html, new RegExp(`<dt id="g-${id}">`), id)
  const app = read("site/src/app.js")
  assert.match(app, /el\("details", "status-details"\)/)
  assert.match(app, /el\("summary", null, "Health details"\)/)
  assert.match(app, /if \(k\.startsWith\("capture:"\) \|\| k === "capture_alarm"\) return \{ text: "capture coverage", term: "capture-coverage" \}/)
  assert.match(app, /const safe = F\.glossaryRoute\(t\.term\);/)
})

test("the picker starts at the top with a skip link before it, and the sign-off line is said once (M-8, M-11)", () => {
  const app = read("site/src/app.js")
  assert.match(app, /el\("a", "skip-map", "Skip to the map"\)/)
  assert.ok(app.indexOf('container.appendChild(skip);') < app.indexOf('container.appendChild(wrap);', app.indexOf('container.appendChild(skip);')), "the skip link comes before the list in Tab order")
  assert.match(app, /list\.scrollTop = 0;/)
  assert.doesNotMatch(app, /cur\.parentElement\.offsetTop/)
  assert.match(app, /sign-off is the operator's recorded acceptance or return of a delivery; /)
  // A shared session's row says its figures are the whole session's (M-4).
  assert.match(app, / shared with \$\{others\} other task\$\{others === 1 \? "" : "s"\}; these figures are the whole session's/)
})

test("the store's intake chart gives every day its place on the axis (M-5), and the phone ranking uses short forms (R2-1)", () => {
  const app = read("site/src/app.js")
  assert.match(app, /for \(let n = 1; n <= lastDay; n\+\+\)/)
  assert.match(app, /item\.quiet \? "mark mark-quiet" : "mark"/)
  assert.match(app, /phone \? S\.hoursShort\(b\.ms\) : S\.hoursWords\(b\.ms\)/)
  assert.match(app, /phone \? S\.shortPct\(b\.share\) : W\.pctWords\(b\.share\)/)
  assert.equal(S.hoursShort(117 * H), "117h")
  assert.equal(S.hoursShort(17 * M), "17m")
})

// ------------------------------------- Desk's coming fields (forward compatible)

test("a partial figure Desk marks bound: null reads with no direction, never a guessed one", () => {
  const pn = (v) => p(v, ["log_truncated"], { bound: null })
  assert.equal(W.boundOf(pn(1)), null)
  assert.equal(W.boundOf(p(1, ["log_truncated"])), "lower", "an absent bound keeps the reason-based reading")
  assert.equal(S.feBound({ flow_efficiency: pn(0.1), working_ms: p(H, ["log_truncated"], { bound: "lower" }) }), null)
  const row = { job: "j", lead_time_ms: pn(10 * H), working_ms: pn(H), idle_ms: pn(9 * H), waiting_by_waited_on_ms: { other_task: pn(6 * H), unknown: pn(3 * H) }, flow_efficiency: pn(0.1), value_in_working_ms: pn(20 * M) }
  const text = W.ledeText(W.lede(row, F.reasonText, { idle: W.idleSplit(row, null) }))
  assert.match(text, /Agents were working for 1 hour of it;/)
  assert.doesNotMatch(text, /at least|at most|lower bound|upper bound/)
  assert.match(text, /The largest part, 6 hours, was while the agent was working on another task\./)
  assert.equal(F.describe(pn(H), "duration").text, F.describe(m(H), "duration").text, "no direction word")
})

test("Desk's new reason codes have words, and a figure with no direction says why", () => {
  for (const code of ["session_work_unattributed", "bound_reasons_conflict", "bound_not_moved", "bound_not_one_quantity", "bound_direction_undecided"]) assert.ok(F.hasReasonText(code), code)
  // Desk's own words for the five (Desk #235's final table).
  assert.equal(F.reasonText("bound_not_moved"), "its reasons do not change this figure, so it is exact for the task's window as stated")
  assert.equal(F.reasonText("bound_direction_undecided"), "one of its reasons has no decided direction yet, so the true figure may be higher or lower")
  assert.match(F.describe({ state: "partial", value: H, reasons: ["card_dates_shorter_than_work"], bound: null, bound_reason: "bound_not_moved" }, "duration").reason, /; its reasons do not change this figure, so it is exact for the task's window as stated$/, "an exact-in-window figure is not called direction not known")
  const und = W.ledeText(W.lede({ job: "j", lead_time_ms: m(10 * H), working_ms: { state: "partial", value: H, reasons: ["log_truncated"], bound: null, bound_reason: "bound_direction_undecided" }, idle_ms: m(9 * H), waiting_by_waited_on_ms: { next_prompt: m(9 * H) }, flow_efficiency: m(0.1) }, F.reasonText))
  assert.match(und, /Agents were working for 1 hour of it \(direction not known, because one of its reasons has no decided direction yet, so the true figure may be higher or lower\)/)
  const n = { state: "partial", value: H, reasons: ["log_truncated"], bound: null, bound_reason: "bound_reasons_conflict" }
  const d = F.describe(n, "duration")
  assert.equal(d.text, F.describe(m(H), "duration").text)
  assert.match(d.reason, /; direction not known, because its reasons pull it both ways, so the true figure may be higher or lower$/)
  // Desk's lower or upper bound wins over anything the site would work out.
  assert.equal(W.boundOf({ state: "partial", value: 1, reasons: ["card_dates_shorter_than_work"], bound: "upper" }), "upper")
  const row = { job: "j", lead_time_ms: m(10 * H), working_ms: { ...n }, idle_ms: { state: "partial", value: 9 * H, reasons: ["log_truncated"], bound: null, bound_reason: "bound_not_moved" }, waiting_by_waited_on_ms: { other_task: m(9 * H) }, flow_efficiency: m(0.1) }
  const text = W.ledeText(W.lede(row, F.reasonText))
  assert.match(text, /Agents were working for 1 hour of it \(direction not known, because its reasons pull it both ways, so the true figure may be higher or lower\)/)
  assert.match(text, /for 9 hours the agent was working on another task\./, "a figure no reason moves reads plain in the lede")
  const conflict = W.ledeText(W.lede({ ...row, idle_ms: { ...row.idle_ms, bound_reason: "bound_reasons_conflict" } }, F.reasonText))
  assert.match(conflict, /for 9 hours the agent was working on another task \(direction not known, because its reasons pull it both ways, so the true figure may be higher or lower\)\./)
})

test("the site never turns Desk's bound: null into a direction; only an absent bound falls back to the site's rule (Desk review M-5)", () => {
  const pn = (v, why) => ({ state: "partial", value: v, reasons: ["log_truncated"], bound: null, bound_reason: why || "bound_reasons_conflict" })
  // stated() keeps null and its reason.
  assert.deepEqual(W.stated(pn(5)), { state: "partial", value: 5, reasons: ["log_truncated"], bound: null, bound_reason: "bound_reasons_conflict" })
  assert.equal("bound" in W.stated(p(5, ["log_truncated"])), false, "an absent bound stays absent")
  // A sum with a no-direction part has no direction; missing parts alone make a lower bound.
  assert.equal(W.sumStated([m(1), pn(2)]).bound, null)
  assert.equal(W.sumStated([m(1), p(2, ["log_truncated"], { bound: "upper" })]).bound, null)
  assert.equal(W.sumStated([m(1), { state: "unavailable", reasons: ["x"] }]).bound, "lower")
  assert.equal(W.sumStated([m(1), p(2, ["log_truncated"])]).bound, "lower")
  // Flow efficiency: Desk's lower/upper wins; null says no direction; absent uses the site's rule.
  const lead = p(10 * H, ["card_dates_shorter_than_work"])
  assert.equal(W.feWords({ flow_efficiency: { ...pn(0.3), bound: "lower" }, lead_time_ms: lead, working_ms: m(3 * H) }), "at least 30%")
  assert.equal(W.feWords({ flow_efficiency: pn(0.3), lead_time_ms: lead, working_ms: m(3 * H) }), "30% (partial, direction not known)")
  assert.equal(W.feWords({ flow_efficiency: p(0.3, ["card_dates_shorter_than_work"]), lead_time_ms: lead, working_ms: m(3 * H) }), "at most 30%")
  // An open task's working time is "at least" only when Desk did not say null.
  const open = (w) => W.ledeText(W.lede({ status: "open", lead_time_ms: p(10 * H, ["censored"]), working_ms: w, idle_ms: p(7 * H, ["censored"]), waiting_by_waited_on_ms: { next_prompt: m(7 * H) }, flow_efficiency: p(0.3, ["censored"]) }, F.reasonText))
  assert.doesNotMatch(open({ ...pn(3 * H), reasons: ["censored"], bound_reason: "bound_not_moved" }), /working for at least/)
  // A box's figure capped by a task-wide partial takes Desk's direction, or lower for older data.
  const map = { bursts: [{ start_ms: 0, end_ms: H, working_ms: H, operator_turns: 2 }], gaps: [] }
  const capped = (env) => W.mapModel(map, { maxBoxes: 3, jobStates: { operator_turns: env } }).items[0].operator_turns
  assert.equal(capped({ state: "partial", value: 2, reasons: ["log_truncated"], bound: null, bound_reason: "bound_not_moved" }).bound, null)
  assert.equal(capped({ state: "partial", value: 2, reasons: ["log_truncated"] }).bound, "lower")
})

test("the final review's fixes: one legend shape, a padded Pareto frame, the picker's single partial, two new glossary entries", () => {
  const css = read("site/src/styles.css")
  assert.match(css, /\.tw-legend-buttons li \{ display: grid; grid-template-columns: minmax\(min\(10em, 100%\), 1fr\) auto;/, "the cause link has its own column")
  assert.match(css, /\.tw-row > \.tw-ms \{ grid-column: 2;/, "every row puts its figure under its name")
  const app = read("site/src/app.js")
  assert.match(app, /const plotW = colW \* n \+ \(phone \? rightW : 8\);/)
  assert.match(app, /share \? \(phone \? "% of lead time" : "% of each task's lead time"\)/)
  const html = read("site/src/index.html")
  assert.match(html, /<dt id="g-work-burst">Work burst<\/dt>/)
  assert.match(html, /<dt id="g-rework">Rework<\/dt>/)
  // The picker says "partial" once.
  const pn = { state: "partial", value: 1, reasons: ["log_truncated"], bound: null, bound_reason: "bound_reasons_conflict" }
  const rows = W.pickerRows([{ id: "a1", finish_basis: "labels", finish_order: m(1), status: "done" }, { id: "b2", finish_basis: "labels", finish_order: m(2), status: "done" }], [{ job: "a1", lead_time_ms: m(H), flow_efficiency: pn }, { job: "b2", lead_time_ms: p(H, ["log_truncated"], { bound: "lower" }), flow_efficiency: p(0.5, ["log_truncated"], { bound: "upper" }) }], (j) => j.id)
  const a = rows.find((r) => r.id === "a1")
  assert.equal(a.feText, "100% (partial, direction not known)")
  assert.equal(a.badge, null)
  assert.equal(rows.find((r) => r.id === "b2").badge, "partial", "a bounded partial keeps its badge")
})

// ------------------------------------------- the live tour's polish fixes (S7)

test("a cold load of a deep link shows the routed step's own shell, and an unrouted hash shows none", () => {
  assert.equal(F.loadingView(""), "task")
  assert.equal(F.loadingView("#/"), "task")
  assert.equal(F.loadingView("#/act"), "act")
  assert.equal(F.loadingView("#/causes"), "causes")
  assert.equal(F.loadingView("#/compare?mode=share"), "compare")
  assert.equal(F.loadingView("#/causes/waiting:next_prompt"), "cause")
  assert.equal(F.loadingView("#/why?term=capture-coverage"), "why")
  assert.equal(F.loadingView("#/task/abc123/session/def456"), "session")
  // Not yet a view: only the status line's "Loading the store…" shows.
  for (const h of ["#main", "#job-abc123", "#nonsense", "#/nope"]) assert.equal(F.loadingView(h), null, h)
  const app = read("site/src/app.js")
  assert.match(app, /async function main\(\) \{\n    showLoadingShell\(\);/, "the shell is chosen before any fetch")
})

test("every pair of neighbouring waiting causes differs clearly, in light and in dark", () => {
  const css = read("site/src/styles.css")
  const order = ["next_prompt", "other_task", "api_retry", "tool_failure", "long_tool_call", "queue_before_start", "no_session"]
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lab = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)))
    const [l, mm, s] = [0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b].map(Math.cbrt)
    return [0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s]
  }
  const dE = (a, b) => 100 * Math.hypot(...lab(a).map((x, i) => x - lab(b)[i]))
  const [light, dark] = css.split("@media (prefers-color-scheme: dark)")
  for (const [name, block] of [["light", light], ["dark", dark]]) {
    const hex = order.map((k) => new RegExp(`--c-wait-${k}: (#[0-9a-f]{6});`).exec(block)[1])
    for (let i = 0; i < hex.length - 1; i++) assert.ok(dE(hex[i], hex[i + 1]) >= 11, `${name}: ${order[i]} and ${order[i + 1]} are too close`)
  }
})
