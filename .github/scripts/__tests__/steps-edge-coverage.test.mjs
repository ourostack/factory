import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { deriveImprovementQueue } from "../../../site/scripts/improvement-queue.mjs"

const require = createRequire(import.meta.url)
const S = require("../../../site/src/steps.js")
const F = require("../../../site/src/format.js")
const W = require("../../../site/src/walk.js")
const H = 3600000
const m = (value) => ({ state: "measured", value, reasons: [] })
const p = (value, bound) => ({ state: "partial", value, bound, reasons: ["log_truncated"] })
const u = (...reasons) => ({ state: "unavailable", reasons })
const key = (why) => `waiting:next_prompt:${why}`
const causes = (rows, extra = {}) => ({ n: 2, N: 3, basis: "job_hours", causes: rows, ...extra })
const cause = (name, total_ms, jobs = [], spans = []) => ({ cause: name, total_ms, jobs, spans })

test("the browser script exposes the same number semantics with self and legacy global roots", () => {
  const filename = fileURLToPath(new URL("../../../site/src/steps.js", import.meta.url))
  const source = readFileSync(filename, "utf8")
  for (const self of [true, false]) {
    const context = vm.createContext({ FactoryWalk: W, FactoryFormat: F, __coverage__: globalThis.__coverage__ })
    if (self) context.self = context
    vm.runInContext(source, context, { filename })
    assert.equal(context.FactorySteps.totalWords(p(65001, "upper"), false), "at most 1 minute 6 seconds")
    assert.equal(context.FactorySteps.isOpen(null, null), false)
  }
})

test("zero, absent, unitary and directed durations never invent a measured value", () => {
  assert.equal(S.totalWords(null, false), null)
  assert.equal(S.totalWords(u(), false), null)
  assert.equal(S.totalWords(p(0, null), false), "0 seconds (could be higher)")
  assert.equal(S.totalWords(p(0, null), true, "days"), "0 days so far (could be higher)")
  assert.equal(S.unitWords(null, "hours"), "none")
  assert.equal(S.unitWords(3600000, "hours"), "1 hour")
  assert.equal(S.unitWords(3600000, "hours", "upper"), "1 hour")
  assert.equal(S.hoursShort(undefined), "0s")
  assert.equal(S.hoursWords(12.3 * H, "upper"), "13 hours")
  assert.equal(S.hoursWords(12.3 * H, "lower"), "12 hours")
  assert.equal(S.isOpen(undefined), false)
  assert.equal(S.clockWords(p(0, "upper"), F.reasonText).text, "0 seconds")
  assert.equal(S.clockWords({ ...u(), so_far: true }, () => "").state, "unavailable")
  assert.match(S.clockWords({ ...u(), so_far: true }, () => "").why, /not publish.*still open/)
  assert.equal(S.exposureWords([], "hours"), "")
  assert.match(S.exposureWords([{ state: "ok", total_ms: 0, partial: true, bound: null, open: false }], "minutes"), /0 minutes.*task exposure/)
})

test("working bars use the stack's fallback measurement and retain upper and unknown bounds", () => {
  for (const [measurement, expected] of [[p(65001, "upper"), "≤1m 6s"], [p(65001, null), "~1m 5s"], [m(0), "none"]]) {
    const stack = { job: "a", lead_time_ms: m(H), working_ms: measurement, value_ms: measurement, waste_ms: {} }
    const task = { job: "a", lead_time_ms: m(H), idle_ms: m(H - measurement.value) }
    const [bar] = S.stackBars([{ id: "a", status: "processing" }], [stack], [task], { mode: "working", segments: F.SEGMENTS, unit: "hours" })
    assert.equal(bar.label, expected)
  }
  const [missing] = S.stackBars([{ id: "missing" }], [], [])
  assert.equal(missing.status, null)
  assert.equal(missing.state, "no_data")
  assert.equal(S.groupWords({ ms: 0 }), "none")
  assert.equal(S.groupWords(null), "none")
  assert.equal(S.groupWords({ ms: 60000 }), "1 minute")
})

test("lifecycle absence and coarse acceptance remain explicit outside production", () => {
  assert.match(S.productionRelation({}, 0), /not available.*recorded elapsed \(not available\)/)
  assert.equal(S.acceptanceFigure({ signoff_wait: m(0) }).text, "Not available")
  assert.match(S.acceptanceFigure({}).why, /no acceptance record/)
  assert.equal(S.causeAddressedWords([], "invalid"), null)
  assert.match(S.causeAddressedWords([{ cause: { key: "defects:all" }, ref: "#1" }, { cause: { key: "defects:all" }, ref: "#2" }], "defects:all"), /2 published improvement issues address/)
  assert.match(S.productionJourney({ production_periods: { state: "measured", items: [], reasons: [] } }).words, /not publish/)
})

test("comparison coverage accounts for only unavailable tasks and never adds their zeros", () => {
  const none = S.workingView([{ job: "a", state: "no_data" }, { job: "b", state: "no_data" }])
  assert.equal(none.bars.length, 0)
  assert.match(none.text, /2 have no working time measured/)
  const done = S.workingView([{ state: "ok", open: false, total_ms: 0, name: "A", segments: [] }, { state: "ok", open: false, total_ms: H, name: "B", segments: [] }])
  assert.match(done.text, /2 done.*hold/)
  const emptySplit = S.shareBars([{ job: "a", state: "ok", total_ms: 0 }], [])
  assert.equal(emptySplit[0].state, "unsplit")
  const noWorking = S.shareBars([{ job: "a", state: "ok", total_ms: H, groups: [{ key: "other", ms: H }], segments: [] }], [])
  assert.equal(noWorking[0].label, "split not known")
  assert.equal(S.feBound({ flow_efficiency: { state: "partial", value: 0.5, reasons: [] }, working_ms: m(1), lead_time_ms: m(2) }), null)
  assert.equal(S.feBound({ flow_efficiency: { state: "partial", value: 0.5, reasons: [] }, working_ms: p(1, "upper"), lead_time_ms: p(2, "upper") }), "unknown")
})

test("cause prose, missing classifications and empty toggles keep their evidence limits", () => {
  assert.equal(S.whyAmountWords(null, false), "")
  assert.equal(S.whyShareWords(null, true), "")
  assert.match(S.causeMeaning("defects:shell"), /failed shell tool calls/)
  assert.match(S.causeMeaning("waiting:api_retry"), /Waiting is idle time/)
  assert.match(S.causeMeaning(key("decision")), /human gate/)
  assert.match(S.findingMeaning("motion:all"), /working time/)
  assert.match(S.paretoNote({ state: "ok", n: null, N: null, basis: null, reasons: ["custom_reason"] }), /custom reason/)
  assert.equal(S.unsplitNote([]), null)
  assert.match(S.unsplitOf({ n: 2, n_unsplit: 1 }).words, /store has no record/)
  assert.equal(S.unsplitOf({ n: 0, n_unsplit: 1 }).n, 0)
  assert.match(S.paretoCaption({ mode: "working", n: null, N: null }), /waiting is left out/)
  assert.match(S.paretoCaption(), /Every cause/)
  assert.equal(S.whyToggleState({ bars: [{ key: "waiting:next_prompt", why_split: "off" }] }).pressed, false)
})

test("cause fallback uses stack totals and tool spans without losing truncation bounds", () => {
  const row = cause("defects:all", 3000, ["b", "a"])
  const d = S.causeDetail(causes([row]), "defects:all", { stackRows: [{ job: "a", waste_ms: { defects: m(1000) } }] })
  assert.equal(d.tasks.find((r) => r.job === "a").source, "stackup")
  assert.equal(d.tasks.find((r) => r.job === "b").ms, null)
  const tools = S.causeDetail(causes([cause("defects:shell", 3000, ["a"], [{ job: "a", start_ms: 0, end_ms: 1000 }])], { references_per_cause: 1 }), "defects:shell")
  assert.equal(tools.tasks[0].bound, "lower")
  assert.equal(tools.tasks[0].source, "spans")
})

test("a classified why uses the task's own upper, unknown and exact interval envelopes", () => {
  const children = [cause(key("question"), 2000, ["a"]), cause(key("not_known"), 3000, ["a"])]
  const doc = causes([{ ...cause("waiting:next_prompt", 5000, ["a"]), children }], { total_ms: 0 })
  for (const [number, bound] of [[p(2000, "upper"), "upper"], [p(2000, null), "none"], [m(2000), null]]) {
    const d = S.causeDetail(doc, key("question"), { taskRows: [{ job: "a", next_prompt_by_why_ms: { question: number, not_known: m(3000) } }] })
    assert.equal(d.tasks[0].bound, bound)
    assert.equal(d.tasks[0].source, "why")
    assert.equal(d.total_ms, 5000)
  }
  const doc2 = causes([{ ...cause("waiting:next_prompt", 5000, ["a"]), children: [cause(key("question"), 2500, ["a"]), cause(key("acceptance"), 2500, ["a"])] }])
  assert.equal(S.causeDetail(doc2, key("question")).child.rank, 1)
  assert.equal(S.causeDetail(doc2, key("acceptance")).child.rank, 2)
  const noParent = S.causeDetail(causes([]), key("question"))
  assert.equal(noParent.state, "not_ranked")
  const noChild = S.causeDetail(doc2, key("interrupted"))
  assert.equal(noChild.state, "none")
})

test("rank ordinals in the handoff come from a real full cause ranking, including eleven through thirteen", () => {
  const rows = Array.from({ length: 14 }, (_, i) => cause(`defects:tool-${String.fromCharCode(97 + i)}`, (14 - i) * H))
  assert.ok(rows.every((r) => S.isCauseKey(r.cause)), "fixture tool keys pass the public route contract")
  const doc = causes(rows)
  for (const [i, ordinal] of [[3, "4th"], [10, "11th"], [11, "12th"], [12, "13th"], [13, "14th"]]) {
    const d = S.causeDetail(doc, rows[i].cause)
    assert.equal(d.all.rank, i + 1)
    assert.match(S.a3Prompt(d, { route: "#/causes", dataUrl: "rollups/causes.json" }), new RegExp(`ranks ${ordinal} of 14`))
  }
})

test("point stops and legacy envelope bursts select actual periods without inventing waits", () => {
  const map = { gaps: { items: [{ start_ms: 20, end_ms: 30 }] }, bursts: { items: [null, { start_ms: 0, end_ms: 20 }] } }
  assert.deepEqual(S.spanItem(map, { start_ms: 10, end_ms: 10 }), { kind: "bursts", n: 2 })
  assert.equal(S.spanItem(map, { start_ms: 40, end_ms: 40 }), null)
  const d = { state: "ok", why: "question", ms: 50, tasks: [{ job: "a" }] }
  const out = S.whyWaitRows(d, { a: { bursts: { items: [{ start_ms: 0, end_ms: 20 }] }, waits: [
    null, { why: "question", next_prompt_ms: -1 }, { why: "question", next_prompt_ms: 0, start_ms: 10, end_ms: 10, why_source: "none" },
    { why: "question", next_prompt_ms: 0, start_ms: 40, end_ms: 40, why_source: "none" },
  ] } })
  assert.equal(out.rows.length, 2)
  assert.equal(out.overlapped, 1)
  assert.equal(out.held_ms, 0)
  assert.equal(out.rest_ms, 50)
  assert.match(S.whyWaitsSummary(out, d), /None of them.*1 because/)
  assert.equal(S.whyWaitsSummary({ rows: [] }, d), "")
})

test("same-duration stops retain deterministic task and source order", () => {
  const wait = { why: "question", next_prompt_ms: 10, start_ms: 0, end_ms: 10, why_source: "none" }
  const d = { state: "ok", why: "question", ms: 30, tasks: [{ job: "b" }, { job: "a" }], scan_jobs: ["b", "a", "missing"] }
  const out = S.whyWaitRows(d, { a: { waits: [wait, wait] }, b: { waits: [wait] } })
  assert.deepEqual(out.rows.map((r) => [r.job, r.k]), [["a", 0], ["a", 1], ["b", 0]])
  assert.deepEqual(out.missing, [])
})

test("cause-only alarms and unverified ownership stay inspectable, not silently assigned", () => {
  assert.equal(S.alarmKeyWords("unknown:value"), "unknown:value")
  assert.deepEqual(S.alarmRows([{ issue_state: "open", url: "invalid", ref: "#17", keys: ["unknown:value"] }])[0].owns, ["unknown:value"])
  const a = S.improvementAlarms({ alarms: [{ key: "loop:new_code", text: "unknown loop alarm", ownerText: "owner not checked" }] })[0]
  assert.match(a.ownerText, /not checked/)
  assert.match(a.effect, /may not be current/)
  assert.equal(a.owner, null)
})

test("related rows are numbered in page order and off-page references remain counts", () => {
  const rows = [{ id: "a", related_ids: ["c", "b", "c", "away"] }, { id: "b" }, { id: "c" }]
  assert.equal(S.improvementLinks(rows)[0].related, "Related, not shown to be the same problem: improvements 2, 3 on this page and 1 not listed on this page.")
  assert.equal(S.improvementFacts(null).length, 0)
  for (const state of ["withdrawn", "source_unknown", "stale", "reviewed"]) {
    const facts = S.improvementFacts({ state, route: null })
    assert.equal(facts.at(-1).text, "none")
  }
})

test("sort ties keep original rows and narrow plots omit rather than clip labels", () => {
  const rows = ["b", "a", "c"].map((id) => ({ id, group: "finished" }))
  assert.deepEqual(S.sortPicker(rows, () => ({ key: null })).map((r) => r.id), ["b", "a", "c"])
  assert.deepEqual(S.feLayout(0, 0), { xs: [], label: null })
  assert.equal(S.feLayout(10, 20).label, null)
  assert.equal(S.weekAxis(1, 0).scroll, true)
})

test("unwrapped legacy figures are not silently promoted to a stated measurement", () => {
  const row = { job: "a", lead_time_ms: 2000, working_ms: 1000, idle_ms: m(1000) }
  const [bar] = S.stackBars([{ id: "a", status: "done" }], [row], [row])
  assert.equal(bar.state, "no_data")
  assert.equal(bar.label, "no data")
  assert.equal(bar.words, undefined)
})

test("bar constructors admit only finite envelopes to their numeric labels", () => {
  const envelopes = [m(0), m(5000), p(5000, "lower"), p(5000, "upper"), p(5000, null), u("source_unreadable"), null]
  for (const lead of envelopes) for (const work of envelopes) {
    const row = { job: "a", lead_time_ms: lead, working_ms: work, idle_ms: m(0) }
    const [all] = S.stackBars([{ id: "a", status: "done" }], [row], [row])
    const [working] = S.stackBars([{ id: "a", status: "done" }], [row], [row], { mode: "working" })
    if (all.state !== "no_data") assert.ok(lead && Number.isFinite(lead.value) && lead.state !== "unavailable")
    if (working.state !== "no_data") assert.ok(work && Number.isFinite(work.value) && work.state !== "unavailable")
    if (all.state === "no_data") assert.equal(all.label, "no data")
    if (working.state === "no_data") assert.equal(working.label, "no data")
  }
})

test("unknown why splits and empty causes describe absence instead of a ranked zero", () => {
  const notRanked = S.causeDetail(causes([]), key("question"))
  assert.match(S.whyCauseLede(notRanked), /No task.*waited/)
  const old = S.causeDetail(causes([cause("waiting:next_prompt", H)]), key("question"))
  assert.match(S.whyCauseLede(old), /does not publish.*No figure/)
  const mismatch = S.causeDetail(causes([{ ...cause("waiting:next_prompt", H), children: [cause(key("question"), H / 2)] }]), key("question"))
  assert.equal(mismatch.mismatch, true)
  assert.match(S.whyCauseLede(mismatch), /does not add up.*wrong ones/)
  assert.equal(S.whyToggleState(null).disabled, true)
  assert.match(S.causesLede({ state: "ok", bars: [] }), /No cause/)
  const all = S.paretoModel(causes([cause("defects:all", H)]), "all")
  all.n = null; all.N = null
  assert.match(S.causesLede(all, { bars: [] }), /^The largest cause.*No labeled waste/)
})

test("why spans tie in source order and invalid wait coordinates cannot acquire a duration", () => {
  const spans = [{ job: "a", start_ms: 0, end_ms: 10 }, { job: "a", start_ms: 20, end_ms: 30 }]
  const doc = causes([{ ...cause("waiting:next_prompt", 100, ["a"]), children: [cause(key("question"), 100, ["a"], spans)] }])
  assert.deepEqual(S.causeDetail(doc, key("question")).spans.map((s) => s.k), [0, 1])
  assert.equal(S.whyWaitRows(null, {}).rows.length, 0)
  const d = { state: "ok", why: "question", ms: 100, tasks: [{ job: "a" }] }
  assert.equal(S.whyWaitRows(d, { a: { waits: [{ why: "question", next_prompt_ms: 10 }] } }).rows.length, 0)
})

test("working cause ties sort stably and population filters refuse missing identities and evidence", () => {
  const r = { top_causes: m([cause("defects:all", 10), cause("motion:all", 20)]) }
  assert.deepEqual(S.taskCauses(r, null).working.map((c) => c.ms), [20, 10])
  assert.deepEqual(S.selectTaskPopulation([null, {}, { id: "a" }], { evidence: "measured" }), [])
})

test("a fully active recorded window has no waiting and remains task exposure", () => {
  const row = { job: "a", lead_time_ms: m(H), working_ms: m(H), idle_ms: m(0) }
  const bars = S.stackBars([{ id: "a", status: "done", finish_order: m(1), finish_basis: "labels" }], [row], [row], { segments: F.SEGMENTS })
  const lead = S.compareLede(bars, [row])
  assert.equal(lead.facts.waiting_ms, 0)
  assert.match(lead.text, /None of it was waiting/)
  assert.doesNotMatch(lead.text, /factory utilization/)
  assert.equal(S.workingView([{ state: "no_data" }]).left_out, 1)
  assert.match(S.workingView([{ state: "no_data" }]).text, /1 has no working time/)
  assert.equal(S.hoursWords(1.5 * H, "upper"), "1.5 hours")
  assert.equal(S.clockWords(m(0), F.reasonText, "hours").text, "0 hours")
  assert.equal(S.clockWords(m(H), F.reasonText, "hours").text, "1 hour")
  assert.match(S.exposureWords([{ state: "ok", total_ms: 0, partial: true, bound: null }]), /0 seconds/)
})

const finished = (day) => ({ state: "measured", value: day, reasons: [], basis: "pr_anchor" })
function twoExactWeeks(n1 = 3, n2 = 3) {
  const ids1 = Array.from({ length: n1 }, (_, i) => `a${i}`)
  const ids2 = Array.from({ length: n2 }, (_, i) => `b${i}`)
  const week = (week, starts_on, ids, share) => ({ week, starts_on, n: ids.length, jobs: ids, lead_ms: m(ids.length * H), working_ms: m(ids.length * H * share), idle_ms: m(ids.length * H * (1 - share)), idle_by_waited_on_ms: { next_prompt: m(ids.length * H * (1 - share)) }, by_waste_ms: {}, flow_efficiency: { median: m(share), n: ids.length, N: ids.length } })
  return {
    schema: "factory.site.by_week/1",
    weeks: [week("2026-W40", "2026-09-28", ids1, 0.25), week("2026-W41", "2026-10-05", ids2, 0.5)],
    tasks: [...ids1.map((job) => ({ job, finish_date: finished("2026-09-28"), flow_efficiency: m(0.25), lead_time_ms: m(H) })), ...ids2.map((job) => ({ job, finish_date: finished("2026-10-05"), flow_efficiency: m(0.5), lead_time_ms: m(H) }))],
    unplaced: { n: 0, jobs: [], reasons: [] },
  }
}

test("weekly evidence distinguishes solid endpoints, thin hints and bounded missing days", () => {
  const doc = twoExactWeeks()
  const ot = S.overTime(doc)
  assert.equal(ot.trend.claimed, true)
  assert.match(ot.trend.words, /25%.*50%/)
  assert.doesNotMatch(ot.trend.words, /thin/)
  const thin = S.overTime(twoExactWeeks(1, 1))
  assert.match(thin.trend.words, /Both weeks are thin/)
  const mixed = S.overTime(twoExactWeeks(3, 1))
  assert.match(mixed.trend.words, /week.*is thin/)
  doc.unplaced = { n: 1, jobs: ["undated"], reasons: ["no_finish_source"] }
  const bounded = S.overTime(doc, { taskRows: [{ job: "undated", lead_time_ms: p(H, "lower") }] })
  assert.match(bounded.summary.words, /6 of 7.*≥6h.*≥7h/)
})

test("week figures retain explicit upper, unknown, absent and bound-not-moved states", () => {
  for (const [node, fragment] of [[p(500, "lower"), /sliver/], [p(500, "upper"), /under a second/], [p(500, null), /direction not known/]]) assert.match(S.overTimeCell(node, false, "hours").words, fragment)
  const unmoved = { ...p(0.5, null), bound_reason: "bound_not_moved" }
  assert.equal(S.overTimeCell(unmoved, false, "share").state, "partial")
  assert.equal(S.overTimeCell(unmoved, false, "share").bound, null)
  assert.equal(S.shareOf(unmoved, m(1)).bound, null)
  assert.equal(S.shareOf(unmoved, m(1)).bound_reason, "bound_not_moved")
  assert.match(S.shareQualify(0.5, "unknown"), /direction not known/)
  assert.equal(S.feDots([{ job: "x" }], [{ job: "x", flow_efficiency: u() }]).omitted, 1)
})

test("unlimited cause detail retains every source row while bounded charts still fold", () => {
  const doc = causes(Array.from({ length: 14 }, (_, i) => cause(`defects:tool-${String.fromCharCode(97 + i)}`, (14 - i) * H)))
  assert.equal(S.paretoModel(doc, "all", { maxBars: Infinity }).bars.length, 14)
  for (const maxBars of [undefined, 0, 1, "2"]) assert.equal(S.paretoModel(doc, "all", { maxBars }).bars.length, 10)
  assert.equal(S.paretoModel(doc, "all", { maxBars: 2 }).bars.length, 2)
  const tied = S.paretoModel({ causes: [cause("defects:all", H), cause("motion:all", H)] }, "all")
  assert.deepEqual(tied.bars.map((b) => b.key), ["defects:all", "motion:all"])
  assert.equal(tied.n, null)
  assert.equal(tied.N, null)
  assert.equal(tied.basis, null)
  assert.match(S.causeMeaning("unrecognized:all"), /could not classify/)
  assert.match(S.causeMeaning(key("not_known")), /not known/)
  assert.match(S.unlabeledWords(2, "act"), /they cannot/)
  assert.match(S.unlabeledWords(1, "causes"), /leaves it out/)
})

test("why uncertainty and missing task totals never turn missing records into zero", () => {
  const base = cause("waiting:next_prompt", 4000, ["b", "a"])
  const children = [cause(key("question"), 2000, ["b", "a"]), cause(key("not_known"), 2000, ["b", "a"])]
  const doc = causes([{ ...base, children }])
  const d = S.causeDetail(doc, key("question"))
  assert.equal(d.tasks[0].ms, null)
  assert.equal(d.tasks[1].ms, null)
  assert.deepEqual(d.tasks.map((t) => t.job), ["a", "b"])
  const none = S.causeDetail(causes([{ ...base, children: [cause(key("question"), 4000)] }]), key("not_known"))
  assert.equal(none.not_known_ms, 0)
  assert.deepEqual(none.not_known_reasons, [])
  assert.match(S.whyCauseLede({ state: "none", why: "not_known", parent_ms: H, not_known_ms: H, not_known_reasons: [] }), /not known/)
  assert.equal(S.whyAmountWords({ ms: H, bound: "lower" }, true), "≥1h")
  assert.equal(S.whyAmountWords({ ms: H }, true), "1h")
})

test("handoffs retain absent totals, existing work and uncounted stops without fabricated rank", () => {
  const d = { label: "Question", key: key("question"), ms: H, jobs: 1, tasks: [{ job: "a", ms: H }], child: { why: "question", parent: "waiting:next_prompt", parent_ms: H, share_of_parent: 1, of: 1, rank: 1 } }
  const text = S.a3Prompt(d, { route: "#/causes", dataUrl: "rollups/causes.json", stops: { rows: [{ counted: false, job: "a", span_ms: H }] } })
  assert.match(text, /1 stop.*none of it counted as waiting.*same kind of stop/)
  assert.match(text, /factory task a/)
  assert.doesNotMatch(text, /of all the time ranked/)
  const existing = S.a3Prompt(d, { existing: [{ ref: "#1", url: "https://github.com/ourostack/factory/issues/1" }, { ref: "#2", url: "https://github.com/ourostack/factory/issues/2", countermeasure: { ref: "#3", merged: false } }] })
  assert.match(existing, /#1.*#2.*not yet merged/)
  assert.match(S.a3Prompt({ label: "Defects", key: "defects:all", ms: H, tasks: [], jobs: 0 }), /start an A3/)
})

test("issue summaries distinguish closed, mixed, unknown and missing references", () => {
  assert.equal(S.refOf(null), null)
  assert.match(S.issueTitle(null, "another tools friction"), /another's tools/)
  const rows = S.actRows([{ url: "invalid", issue_state: "unknown", title: "Unverified issue", resolution: { url: "invalid", merged: false } }], null)
  assert.equal(rows[0].state, "unknown")
  assert.equal(rows[0].ref, "issue")
  for (const states of [["closed"], ["closed", "closed"], ["closed", "closed", "closed"], ["open"], ["open", "open"], ["open", "closed"], ["unknown", "unknown"]]) {
    const text = S.actSummary(states.map((state) => ({ state, check: "unknown", countermeasure: null })))
    assert.match(text, /issue|closed|open/)
  }
  assert.match(S.takenOnWords([{ ref: "#1", countermeasure: { ref: "#2", merged: false } }]), /not yet merged/)
})

test("model clock modes preserve an explicitly supplied request number without relabeling production", () => {
  const [bar] = S.clockBars([{ id: "a", clocks: { request_to_delivery_ms: p(4000, "upper") } }], "request")
  assert.equal(bar.status, null)
  assert.equal(bar.label, "≤4s")
  assert.deepEqual(bar.segments.map((s) => s.key), ["clock_total"])
  assert.equal(bar.segments[0].label, "Request to delivery")
  assert.equal(S.clockWords(p(H, "lower"), F.reasonText, "hours").text, "at least 1 hour")
  assert.equal(S.clockWords(p(0, "upper"), F.reasonText, "hours").text, "0 hours")
})

test("zero classified work and legacy flow bounds do not invent a missing denominator", () => {
  assert.equal(S.workingView([{ state: "ok", total_ms: 0, open: false, segments: [{ key: "value", ms: 0 }] }]).bars.length, 0)
  const base = { flow_efficiency: { state: "partial", value: 0.5, reasons: [] }, working_ms: m(H), lead_time_ms: m(2 * H) }
  assert.equal(S.feBound({ ...base, working_ms: p(H, "lower") }), "lower")
  assert.equal(S.feBound({ ...base, working_ms: p(H, "upper") }), "upper")
  const a = { job: "a", group: "finished", state: "ok", total_ms: H, words: "1 hour", name: "A", groups: [{ key: "working", ms: 0, segments: [] }, { key: "waiting", ms: H, segments: [{ cause: "unsupported", ms: H }] }] }
  const b = { ...a, job: "b", name: "B" }
  const row = (job, bound) => ({ job, flow_efficiency: p(0, bound), working_ms: m(0), lead_time_ms: m(H) })
  assert.equal(S.compareLede([a, b], [row("a", "upper"), row("b", "lower")]).facts.bound, "unknown")
  assert.match(S.compareLede([a], []).text, /cause not recorded/)
})

test("finish-day and flow-evidence gaps cannot become an exact weekly trend", () => {
  const missing = twoExactWeeks(1, 1)
  missing.weeks[0].starts_on = "not-a-date"
  missing.tasks = []
  missing.weeks[0].flow_efficiency = {}
  missing.weeks[1].flow_efficiency = { median: p(0.5, null) }
  const ot = S.overTime(missing)
  assert.equal(ot.weeks[0].label, "not-a-date")
  assert.equal(ot.trend.claimed, false)
  assert.match(ot.summary.words, /all .*days are bounds/)
  assert.equal(ot.fe.omitted.length, 2)
  assert.match(ot.fe.weeks[0].median.words, /not recorded/)
  assert.match(ot.fe.weeks[1].median.words, /measured tasks only/)
  const upper = twoExactWeeks(1, 1)
  upper.tasks[0].flow_efficiency = p(0.25, "upper")
  const up = S.overTime(upper, { taskRows: [{ job: "a0" }] })
  assert.equal(up.fe.weeks[0].marks[0].kind, "at_most")
})

test("dated task ties preserve finish order rather than inventing time-of-day ordering", () => {
  const base = { group: "finished", state: "ok", finish: { kind: "on", day: "1 Oct", key: "2026-10-01" } }
  const rows = [{ ...base, job: "b", pos: 2 }, { ...base, job: "a", pos: 1 }, { ...base, job: "c" }, { ...base, job: "d", finish: { kind: "on", day: "2 Oct", key: "2026-10-02" } }]
  assert.deepEqual(S.eachTaskBars(rows).map((r) => r.job), ["c", "a", "b", "d"])
})

test("known small parent differences retain honest zero-division and explicit bounds", () => {
  const row = { ...cause("waiting:next_prompt", 0), children: [{ ...cause(key("question"), 100), bound: "lower" }, { ...cause(key("not_known"), 100), bound: null }] }
  const out = S.whyChildren(row, true)
  assert.equal(out.children[0].share_of_parent, 0)
  assert.equal(out.children[0].ceiling_share, 0)
  assert.equal(out.children[0].bound, "lower")
  const nonLower = S.whyChildren({ ...row, total_ms: 200, children: [{ ...cause(key("question"), 100), bound: null }, cause(key("not_known"), 100)] }, true)
  assert.equal(nonLower.children[0].bound, null)
})

test("cause coverage and explanatory vital-few counts remain separate from ownership", () => {
  const mk = (n) => S.paretoModel(causes(Array.from({ length: n }, (_, i) => cause(`defects:tool-${String.fromCharCode(97 + i)}`, H * (n === 4 && i < 3 ? 3 : 1)))), "all")
  assert.match(S.causesLede(mk(4), null), /Three causes/)
  assert.match(S.causesLede(mk(6), null), /5 causes/)
  assert.match(S.paretoNote({ state: "ok", n: 1, N: 1, reasons: [], basis: "job_hours" }), /counts 1 of 1 tasks/)
  const tied = S.causeDetail(causes([cause("defects:all", 2000, ["b", "a"])]), "defects:all", { taskRows: [{ job: "a", top_causes: m([cause("defects:all", 1000)]) }, { job: "b", top_causes: m([cause("defects:all", 1000)]) }] })
  assert.deepEqual(tied.tasks.map((t) => t.job), ["a", "b"])
  const nested = S.causeDetail(causes([cause("defects:all", 1000, ["a"])]), "defects:all", { stackRows: [{ job: "a", working: { waste_ms: { defects: m(1000) } } }] })
  assert.equal(nested.tasks[0].source, "stackup")
  const absent = S.causeDetail(causes([cause("waiting:api_retry", 0, ["a"])]), "waiting:api_retry")
  assert.equal(absent.tasks[0].ms, null)
})

test("uncounted stop wording preserves singular, plural and missing maps", () => {
  const d = { state: "ok", why: "question", ms: 0, tasks: [] }
  assert.deepEqual(S.whyWaitRows(d).rows, [])
  for (const [n, c, u, o, jobs] of [[1, 0, 1, 1, ["a"]], [2, 1, 1, 0, []], [3, 2, 1, 1, []], [3, 1, 2, 2, ["a", "b"]], [2, 2, 0, 0, []]]) {
    const text = S.whyWaitsSummary({ rows: Array.from({ length: n }, () => ({})), counted: c, uncounted: u, overlapped: o, held_ms: c * H, uncounted_jobs: jobs }, d)
    assert.match(text, /stop|stops/)
    if (u) assert.match(text, /none of/)
  }
})

test("week stack and cause-table models tolerate legacy missing totals but disclose unavailable shares", () => {
  const doc = twoExactWeeks(1, 1)
  doc.classes = ["value", "new_class"]
  doc.wastes = ["defects", "motion"]
  for (const w of doc.weeks) {
    w.by_class_ms = { new_class: m(1000) }
    w.by_waste_ms = { defects: m(1000), motion: m(1000) }
    w.working_ms = u()
    w.idle_ms = u()
  }
  doc.weeks[0].lead_ms = m(0)
  doc.weeks[1].lead_ms = { ...p(H, null), bound_reason: "bound_not_moved" }
  const ot = S.overTime(doc)
  const shared = S.weekBars(ot, "share")
  assert.equal(shared[0].segments[0].share, 0)
  assert.equal(shared[0].segments[0].state, "partial")
  assert.ok(shared[1].segments.some((s) => s.bound === null))
  assert.ok(shared[0].segments.some((s) => s.label === "new_class"))
  assert.ok(S.weekBars({ weeks: ot.weeks }, "all")[0].segments.some((s) => s.key === "motion"))
  const table = S.causeTable({ weeks: ot.weeks.map(({ unsplit, ...w }) => w) }, "share")
  assert.equal(table.rows.length, 3)
  assert.equal(table.scale.max, 0.5)
  const high = structuredClone(ot)
  high.weeks[1].raw.by_waste_ms.defects = m(2 * H)
  assert.equal(S.causeTable(high, "share").scale.max, 1)
})

test("comparison sums retain mixed source directions, empty waiting and undefined metadata", () => {
  const bar = (job, work, wait, segments) => ({ job, group: "finished", state: "ok", total_ms: work + wait, words: "recorded", name: job, groups: [{ key: "working", ms: work, segments: [] }, { key: "waiting", ms: wait, segments }] })
  const a = bar("a", H, H, [{ cause: "api_retry", ms: H / 3 }, { cause: "tool_failure", ms: H / 3 }, { cause: "other_task", ms: H / 3 }])
  const b = bar("b", H, H, [])
  for (const [w, l] of [[p(H, null), m(2 * H)], [p(H, "upper"), m(2 * H)], [m(H), p(2 * H, "lower")]]) {
    assert.match(S.compareLede([a], [{ job: "a", working_ms: w, lead_time_ms: l }]).text, /elapsed time/)
  }
  const mixed = S.compareLede([a, b], [{ job: "a", working_ms: p(H, "lower"), lead_time_ms: m(2 * H) }, { job: "b", working_ms: p(H, "upper"), lead_time_ms: m(2 * H) }])
  assert.equal(mixed.facts.bound, "unknown")
  assert.match(mixed.text, /largest part/)
  const zero = S.compareLede([bar("a", 0, 0, [])], [])
  assert.equal(zero.facts.share, 0)
  const absent = { job: "c", group: "finished", state: "unsplit", total_ms: H, words: "recorded", groups: [] }
  assert.match(S.compareLede([a, absent], []).text, /not recorded/)
})

test("cause absence, ties and unknown sources preserve task identity without an inferred measurement", () => {
  const row = cause("motion:all", 1000, ["a", "b"])
  const noBasis = S.causeDetail({ causes: [row] }, "motion:all")
  assert.equal(noBasis.basis, null)
  assert.deepEqual(noBasis.tasks.map((t) => t.job), ["a", "b"])
  const stack = [{ job: "a", working: "not supported" }]
  assert.equal(S.causeDetail(causes([row]), "motion:all", { stackRows: stack }).tasks[0].ms, null)
  const zero = S.causeDetail(causes([cause("defects:all", 0)]), "defects:all")
  assert.equal(zero.all.share, undefined)
  const all = S.paretoModel(causes([cause("defects:all", H, ["a"])]), "all")
  assert.match(S.causesLede(all, null, { doc: { causes: [] } }), /largest cause/)
  assert.doesNotMatch(S.paretoNote({ state: "ok", n: 1, N: 1, reasons: [], basis: null }), /partial/)
})

test("why tasks and overlapped stops preserve deterministic ties and invalid burst exclusions", () => {
  const child = cause(key("question"), 1000, ["a", "b"])
  const doc = { causes: [{ ...cause("waiting:next_prompt", 1000), children: [child] }] }
  const rows = ["a", "b"].map((job) => ({ job, next_prompt_by_why_ms: { question: m(500) } }))
  const d = S.causeDetail(doc, key("question"), { taskRows: rows })
  assert.deepEqual(d.tasks.map((t) => t.job), ["a", "b"])
  assert.match(S.whyCauseLede(d), /2 tasks have it/)
  const waits = [{ why: "question", start_ms: 0, end_ms: 4000, next_prompt_ms: 0, why_source: "none" }, { why: "question", start_ms: 20000, end_ms: 28000, next_prompt_ms: 0, why_source: "none" }]
  const out = S.whyWaitRows({ ...d, scan_jobs: ["a"] }, { a: { waits, bursts: { unsupported: true } } })
  assert.equal(out.rows[0].span_ms, 8000)
  assert.equal(out.overlapped, 0)
  const invalid = S.whyWaitRows({ ...d, scan_jobs: ["a"] }, { a: { waits, bursts: [null, {}] } })
  assert.equal(invalid.overlapped, 0)
})

test("malformed legacy references, population options and table rows stay bounded", () => {
  const rows = S.actRows([{ url: "invalid", issue_state: "open" }, { url: "invalid-two", issue_state: "open" }])
  assert.equal(rows[0].ref, "issue")
  assert.match(S.takenOnWords([{ ref: "#1" }]), /no countermeasure/)
  assert.equal(S.alarmRows([{ url: "invalid", issue_state: "open", keys: [] }])[0].ref, "issue")
  const a = S.improvementAlarms({ alarms: [{ key: "loop:steps_stale", text: "stale step" }] })[0]
  assert.match(a.ownerText, /Unassigned/)
  assert.equal(S.taskCauses(null, null).working_state, "unavailable")
  assert.deepEqual(S.selectTaskPopulation([{ id: "a" }], { evidence: 5 }), [{ id: "a" }])
  assert.deepEqual(S.selectTaskPopulation([{ id: "a" }]), [{ id: "a" }])
  assert.deepEqual(S.bodyCellColumns(null), [])
  assert.deepEqual(S.bodyCellColumns([null]), [[]])
})

test("review presentation rejects bad IDs and distinguishes unverified, unknown and null lifecycle", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
  const value = structuredClone(fixture.public)
  value.rows[0].lifecycle = null
  const q = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000 })
  assert.equal(S.improvementPresentation(q.rows[0]).verification, "Result not published or checked")
  const row = structuredClone(q.rows[0])
  row.related_ids = [5, "bad", row.id, "b".repeat(32)]
  row.duplicate_ids = null
  assert.deepEqual(S.improvementPresentation(row).related_ids, ["b".repeat(32)])
  assert.deepEqual(S.improvementPresentation(row).duplicate_ids, [])
  assert.match(S.improvementStatus({ queue: q, issues: -1, issuesVerified: true }), /no improvement issue/)
  assert.ok(S.triageCoverageWords({ schema: "factory-improvements/1", state: "unknown", coverage: { state: "unknown" } }).length)
})

test("weekly certainty distinguishes entirely bounded days, an upper efficiency and stable undated positions", () => {
  const doc = twoExactWeeks(1, 1)
  for (const t of doc.tasks) t.finish_date = p(t.finish_date.value, "upper")
  for (const w of doc.weeks) { w.n_day_measured = 0; w.n_day_on_or_before = w.n }
  doc.tasks[0].flow_efficiency = p(0.5, "upper")
  const ot = S.overTime(doc)
  assert.match(ot.summary.words, /all 2 days are bounds/)
  assert.equal(ot.fe.weeks.flatMap((w) => w.marks).find((r) => r.job === doc.tasks[0].job).kind, "at_most")
  const sameDay = { finish: { day: "2026-10-12", key: "2026-10-12" } }
  assert.equal(S.eachTaskBars([{ job: "a", ...sameDay }, { job: "b", ...sameDay }])[0].job, "a")
  const one = twoExactWeeks(1, 0)
  one.weeks = one.weeks.filter((w) => w.n > 0)
  one.tasks[0].flow_efficiency = p(0.5, null)
  const single = S.overTime(one)
  assert.match(single.summary.words, /every day is exact, but/)
  assert.equal(single.fe.weeks[0].marks[0].kind, "unknown")
})

test("equal cause totals retain lexical order in both incoming orders", () => {
  for (const names of [["motion", "defects"], ["defects", "motion"]]) {
    const doc = twoExactWeeks(1, 1)
    doc.wastes = names
    for (const w of doc.weeks) w.by_waste_ms = Object.fromEntries(names.map((k) => [k, m(H)]))
    const ot = S.overTime(doc)
    const keys = S.causeTable(ot, "working").rows.map((r) => r.key)
    assert.deepEqual(keys, ["defects:all", "motion:all"])
    assert.equal(S.paretoModel(causes(names.map((k) => cause(`${k}:all`, H)))).bars[0].key, "defects:all")
  }
})

test("rounding-tolerated why residuals disclose zero total and classify multiple bounded tasks", () => {
  const nearZero = causes([{ ...cause("waiting:next_prompt", 0), children: [cause(key("question"), 500)] }])
  const small = S.causeDetail(nearZero, key("question"))
  assert.equal(small.state, "ok")
  assert.equal(small.all.share, 0)
  const doc = causes([{ ...cause("waiting:next_prompt", H), children: [cause(key("question"), H / 2, ["a", "b"]), cause(key("not_known"), H / 2)] }])
  const d = S.causeDetail(doc, key("question"))
  assert.match(S.whyCauseLede(d), /2 tasks have classified time/)
  assert.deepEqual(S.whyWaitRows(d, null).missing, ["a", "b"])
  const waits = [{ why: "question", start_ms: 0, end_ms: 4000, next_prompt_ms: 0, why_source: "none" }, { why: "question", start_ms: 10000, end_ms: 14000, next_prompt_ms: 4000, why_source: "none" }]
  const out = S.whyWaitRows({ ...d, scan_jobs: ["a"] }, { a: { waits, bursts: [null, {}] } })
  assert.equal(out.rows[0].counted, true)
  assert.equal(out.overlapped, 0)
})

test("fresh rows followed by withdrawn reviews do not imply a refresh", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
  const value = structuredClone(fixture.public)
  Object.assign(value.rows[0], { revision: 2, state: "withdrawn", route: null, gate: null })
  value.rows.push({ ...structuredClone(value.rows[0]), id: "b".repeat(32) })
  const queue = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000 })
  const words = S.improvementStatus({ queue, issues: 0, issuesVerified: true })
  assert.match(words, /with 2 withdrawn reviews last/)
  assert.doesNotMatch(words, /refresh/)
})
