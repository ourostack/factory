import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { buildImprovementChecks } from "../../../site/scripts/improvement-checks.mjs";
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs";
import { buildByWeek } from "../../../site/scripts/by-week.mjs";
import { publishData } from "../../../site/scripts/publish-files.mjs";

const require = createRequire(import.meta.url);
const { buildLearning, validateLearning } = require("../../../site/src/learning.js");
const F = require("../../../site/src/format.js");
const A = "c87c243fe6149fafb9296c32cd11dca0";
const B = "70d7a6090fe01ecfcf6a730f7c4cd1fe";
const sha = "41541eb0e1a1f04879cc14110ff321962c90fe18";
const m = (value) => ({ state: "measured", value, reasons: [] });
const u = () => ({ state: "unavailable", reasons: ["not_recorded"] });
const p = (value, bound = "lower") => ({ state: "partial", value, reasons: ["log_truncated"], bound });
const roll = (value, n, N) => ({ ...m(value), kind: "rollup", n, N, of: "accepted outcomes", out_of_scope: 0 });
const data = () => ({
  schema: "factory-site/3", reports_commit: sha,
  jobs: [{ id: A, status: "done", lead_time_ms: p(400000), signoff: m("not_recorded") }],
  outcomes: { signoff: { jobs: m(82), accepted: m(1) }, attention: { headline: roll(1200, 1, 1), turns_per_accepted: roll(2, 1, 1) },
    first_pass_yield: u(), rework: { returns: [{ caught: "at_review", total: p(5),
      by_reason: { agent_error: m(2), changed_ask: m(1), new_information: m(2), external: m(0) } }] } },
  capture_coverage: { share: p(0.8, "unknown") }, kaizen_issues: [], trend: [],
});
const causes = () => ({
  schema: "desk.factory.rollups/1", basis: "job_hours", state: "partial", bound: null,
  bound_reason: "bound_not_one_quantity", reasons: ["log_truncated"], n: 1, N: 2,
  causes: [
    { cause: "waiting:other_task", total_ms: 300000, jobs: [A], spans: [{ job: A, start_ms: 0, end_ms: 300000 }] },
    { cause: "waiting:next_prompt", total_ms: 33467, jobs: [A], spans: [{ job: A, start_ms: 238212, end_ms: 271679 }],
      children: [{ cause: "waiting:next_prompt:stopped_short", parent: "waiting:next_prompt", total_ms: 33467,
        bound: "lower", reasons: ["stop_partly_classified"], jobs: [A], spans: [{ job: A, start_ms: 238212, end_ms: 271679 }] }] },
    { cause: "defects:all", total_ms: 500, jobs: [A], spans: [{ job: A, start_ms: 20, end_ms: 520 }] },
  ],
});
const evidence = () => [{ job: A, timeline: {
  waits: [{ start_ms: 238212, end_ms: 271679, stop: { end: "end_turn", asks: false, pending_agents: false },
    why: "stopped_short", why_source: "evaluator", confidence: "medium", reasons: [], session: "PRIVATE_ASSOCIATION", worker: 0 }],
  agents: [{ n: 0, parent: null, session: "PRIVATE_ASSOCIATION" }, { n: 1, parent: 0, session: "PRIVATE_ASSOCIATION" }],
} }];
function checks({ verdict = "too_few_jobs", partial = false, version = "3.2.0-alpha.108", before = 0, after = 20 } = {}) {
  const issues = [{ number: 53, url: "https://github.com/ourostack/factory/issues/53", state: "closed", body: "PRIVATE_BODY" }];
  const doc = buildImprovementChecks({
    issues, records: [],
    parseCard: () => ({ ok: true, card: { signal: "human_wait", job_class: "any", hypothesis: { measure: "human_wait", direction: "down" },
      plugin: "desk", version, countermeasure: "https://github.com/ourostack/desk/pull/65", evidence_jobs: ["PRIVATE_TRIGGER"] } }),
    checkCard: () => version === null ? { status: "waiting_for_version" } : {
      status: "checked", verdict, state: partial ? "partial" : "measured", reasons: partial ? ["host_records_partly"] : [],
      jobs: before + after + 34, excluded: [{ reason: "open_job", jobs: 25 }, { reason: "plugin_not_reported", jobs: 9 }],
      comparison: { before: { jobs: before, groups: before ? 6 : 0, median: before ? 100 : null },
        after: { jobs: after, groups: 9, median: verdict === "not_confirmed" ? 120 : verdict === "no_clear_change" ? 100 : 0 },
        change: before ? (verdict === "not_confirmed" ? 20 : verdict === "no_clear_change" ? 0 : -100) : null,
        interval: verdict === "too_few_jobs" ? null : verdict === "confirmed" ? [-110, -90] : verdict === "not_confirmed" ? [10, 30] : [-5, 5],
        direction: verdict === "confirmed" ? "down" : verdict === "not_confirmed" ? "up" : null },
    },
  });
  doc.sources = { desk: "26ede3d8e93fe1724f2900f3206b1870648b40b3", facts: "5c44d875d8c611b0cad84f46cad5233529bc3d25", reports: sha };
  return doc;
}
function input() {
  const d = data();
  d.kaizen_issues = [{ url: "https://github.com/ourostack/factory/issues/53", cause: "waiting:next_prompt", issue_state: "closed",
    resolution: { kind: "countermeasure", url: "https://github.com/ourostack/desk/pull/65", merged: true } }];
  return { data: d, causes: causes(), history: { by_week: null, evidence: evidence() }, checks: checks() };
}

test("no sources means unavailable learning, not zero work or a healthy result", () => {
  const doc = buildLearning({});
  assert.equal(doc.schema, "factory-learning/1");
  assert.deepEqual(validateLearning(doc), { ok: true, codes: [] });
  assert.equal(doc.overview.code, "evidence_unavailable");
  assert.equal(doc.scope.accepted_outcomes.state, "unavailable");
  assert.equal(doc.scope.timed_tasks.state, "unavailable");
  assert.equal(doc.improvements.availability, "unavailable");
  assert.equal(doc.evolution.weeks.state, "unavailable");
  assert.equal(doc.findings.length, 0);
  assert.match(doc.overview.href, /^#\//);
  assert.deepEqual(checkNumbers({ learning: doc }), []);
});

test("overview conclusion points to its actual finding and material exposure/capture limits", () => {
  const x = input();
  const before = JSON.stringify(x);
  const doc = buildLearning(x);
  assert.equal(JSON.stringify(x), before, "projection is pure");
  assert.equal(doc.overview.code, "recorded_process_observation");
  assert.equal(doc.overview.finding, "waiting:other_task");
  assert.equal(doc.overview.href, "#/causes/waiting:other_task");
  assert.match(doc.overview.conclusion, /other tasks/i);
  assert.ok(doc.overview.limits.includes("task_exposure_not_factory_time"));
  assert.ok(doc.overview.limits.includes("capture_is_partial"));
  assert.equal(doc.overview.improvement, "ourostack/factory#53");
});

test("accepted outcomes and attention retain the all-outcome denominator, not timed task signoffs", () => {
  const x = input();
  x.data.jobs[0].signoff = m("accepted");
  x.data.outcomes.signoff.accepted = m(12);
  x.data.outcomes.attention.headline = { ...p(1500, "unknown"), kind: "rollup", n: 2, N: 12, of: "accepted outcomes", out_of_scope: 0 };
  x.data.outcomes.attention.turns_per_accepted = u();
  const s = buildLearning(x).scope;
  assert.equal(s.outcome_records.value, 82);
  assert.equal(s.accepted_outcomes.value, 12);
  assert.equal(s.timed_tasks.value, 1);
  assert.deepEqual(s.attention, x.data.outcomes.attention.headline);
  x.data.outcomes.signoff.accepted = m(0);
  assert.equal(buildLearning(x).scope.attention.state, "unavailable", "no ratio beside zero acceptances");
});

test("task report rows with no captured clock do not become timed tasks", () => {
  const x = input();
  x.data.jobs.push({ id: B, lead_time_ms: u() });
  const s = buildLearning(x).scope;
  assert.equal(s.task_reports.value, 2);
  assert.equal(s.timed_tasks.value, 1);
  assert.equal(s.outcome_records.value, 82);
});

test("source generations remain independent and mismatched reports are a material conclusion limit", () => {
  const x = input();
  x.checks.sources.reports = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const doc = buildLearning(x);
  assert.equal(doc.sources.alignment, "different_reports");
  assert.equal(doc.sources.reports, sha);
  assert.equal(doc.sources.checks.facts, "5c44d875d8c611b0cad84f46cad5233529bc3d25");
  assert.ok(doc.overview.limits.includes("source_generations_differ"));
  delete x.data.reports_commit;
  assert.equal(buildLearning(x).sources.alignment, "unknown");
});

test("fully classified children still retain partial cohort coverage and valid published tool-kind defects", () => {
  const x = input();
  const child = x.causes.causes[1].children[0];
  child.reasons = [];
  delete child.bound;
  x.causes.causes.push({ cause: "defects:edit", total_ms: 100, jobs: [A], spans: [] });
  const doc = buildLearning(x);
  assert.equal(doc.findings.find((f) => f.id === child.cause).figure.state, "partial");
  assert.equal(doc.findings.at(-1).classification, "classified_waste");
});

test("task exposure is observation; actual waste and unknown labels remain separate", () => {
  const doc = buildLearning(input());
  const other = doc.findings.find((f) => f.id === "waiting:other_task");
  const defects = doc.findings.find((f) => f.id === "defects:all");
  assert.equal(other.kind, "host_observation");
  assert.equal(other.classification, "observation");
  assert.equal(other.figure.bound, "unknown", "inherit the mixed rollup bound, never invent a lower bound");
  assert.equal(other.population.N, 2);
  assert.equal(other.population.of, "jobs_in_cause_rollup", "N includes open and excluded jobs, not only finished jobs");
  assert.equal(defects.kind, "evaluator_judgment");
  assert.equal(defects.classification, "classified_waste");
  assert.ok(other.limits.includes("not_proven_avoidable"));
  const x = input();
  x.causes.causes.push({ cause: "unknown:all", total_ms: 20, jobs: [A], spans: [] });
  assert.equal(buildLearning(x).findings.at(-1).classification, "unclassified");
});

test("measured zero, lower and unknown bounds survive without implying absent observations are zero", () => {
  for (const [state, bound, expected] of [["measured", undefined, undefined], ["partial", "lower", "lower"], ["partial", null, "unknown"]]) {
    const x = input();
    Object.assign(x.causes, { state, bound, reasons: state === "partial" ? ["log_truncated"] : [] });
    x.causes.causes[0].total_ms = 0;
    const f = buildLearning(x).findings[0];
    assert.equal(f.figure.value, 0);
    assert.equal(f.figure.bound, expected);
    assert.deepEqual(validateLearning(buildLearning(x)), { ok: true, codes: [] });
  }
});

test("only explicit public cause mapping links findings; examples are never original trigger jobs", () => {
  const x = input();
  x.data.improvements = { rows: [{ evidence: [{ job: A }], title: "PRIVATE_TITLE", issue: "ourostack/factory#53" }] };
  x.data.kaizen_issues.push({ url: "https://github.com/ourostack/factory/issues/99", title: "human_wait" });
  const doc = buildLearning(x);
  const row = doc.improvements.rows[0];
  assert.equal(row.association, "mapped_measure_only");
  assert.equal(row.original_evidence, "not_published");
  assert.deepEqual(row.finding_ids, ["waiting:next_prompt"]);
  assert.deepEqual(doc.findings[1].related_improvements, ["ourostack/factory#53"]);
  assert.equal(doc.findings[0].related_improvements.length, 0);
  assert.doesNotMatch(JSON.stringify(doc), /PRIVATE_/);
  delete x.data.kaizen_issues[0].cause;
  assert.equal(buildLearning(x).improvements.rows[0].association, "not_published", "no association by guessed measure/title");
});

test("too few jobs is a completed inconclusive check with missing baseline, independent of merge/closure", () => {
  const r = buildLearning(input()).improvements.rows[0];
  assert.equal(r.section, "results_available");
  assert.equal(r.result, "inconclusive");
  assert.equal(r.status, "checked");
  assert.equal(r.issue_state, "closed");
  assert.equal(r.implementation.merged, "merged");
  assert.deepEqual(r.before, { jobs: 0, groups: 0, median: { state: "unavailable", reasons: ["no_measured_members"] } });
  assert.equal(r.after.median.value, 0);
  assert.equal(r.after.jobs, 20);
  assert.equal(r.after.groups, 9);
  assert.equal(r.change.state, "unavailable");
  assert.equal(r.interval, null);
  assert.ok(r.limits.includes("baseline_missing"));
});

test("confirmed/opposite/no-clear-change and partial checks preserve actual current estimates and bounds", () => {
  for (const [verdict, result] of [["confirmed", "better"], ["not_confirmed", "worse"], ["no_clear_change", "no_detected_change"]]) {
    const x = input();
    x.checks = checks({ verdict, before: 6, partial: true });
    const r = buildLearning(x).improvements.rows[0];
    assert.equal(r.result, result);
    assert.equal(r.measurement_state, "partial");
    assert.equal(r.before.median.bound, "lower");
    assert.equal(r.change.bound, "unknown");
    assert.equal(r.interval.bound, "unknown");
    assert.ok(r.limits.includes("association_not_causation"));
  }
});

test("waiting for version, no check, refused and unavailable never become completed inconclusive results", () => {
  const x = input();
  x.checks = checks({ version: null });
  assert.equal(buildLearning(x).improvements.rows[0].section, "awaiting_result");
  for (const [status, reasons] of [["no_check", ["no_block"]], ["refused", ["missing_key"]], ["unavailable", ["canonical_source_unavailable"]]]) {
    const c = checks();
    c.checks["ourostack/factory#53"] = { ref: "ourostack/factory#53", url: "https://github.com/ourostack/factory/issues/53", issue_state: "closed", status, reasons };
    if (status === "unavailable") { c.availability = "unavailable"; c.reasons = reasons; }
    const r = buildLearning({ ...x, checks: c }).improvements.rows[0];
    assert.notEqual(r.section, "results_available");
    assert.equal(r.before, null);
    assert.equal(r.status, status);
  }
});

test("process questions expose actual stop judgment separately from host facts, not tool-inferred stage times", () => {
  const doc = buildLearning(input());
  const stops = doc.behaviors.find((b) => b.id === "human_stops");
  assert.deepEqual(stops.stops[0].observation, { end: "end_turn", asks: false, pending_agents: false });
  assert.deepEqual(stops.stops[0].judgment, { why: "stopped_short", source: "evaluator", confidence: "medium", reasons: [] });
  assert.equal(stops.stops[0].start_ms, 238212);
  const repair = doc.behaviors.find((b) => b.id === "review_repair");
  assert.equal(repair.observations[0].figure.value, 5);
  assert.equal(repair.observations[0].by_reason.agent_error.value, 2);
  assert.equal(repair.observations[0].by_reason.changed_ask.value, 1, "changed scope is not automatically corrective waste");
  assert.equal(repair.duration.state, "unavailable");
  const team = doc.behaviors.find((b) => b.id === "coordination");
  assert.equal(team.teams[0].roots, 1);
  assert.equal(team.teams[0].children, 1);
  assert.equal(team.duration.state, "unavailable");
  for (const b of doc.behaviors) {
    assert.ok(b.missing_observation.length);
    assert.ok(b.collection_path.length);
  }
  const absent = buildLearning({});
  assert.ok(absent.behaviors.every((b) => b.state === "unavailable"));
});

test("all available release/week history and unplaced tasks preserve populations and mixed-task/capture limits", () => {
  const x = input();
  x.data.trend = [{ version: "3.2.0-alpha.107", jobs: u(), accepted: m(0), sent_back: m(0), first_pass_yield: u(), attention: u(), flow_efficiency: u() },
    { version: "mixed", jobs: m(4), accepted: m(1), sent_back: m(0), first_pass_yield: p(0.5, "upper"), attention: roll(1200, 1, 1), flow_efficiency: u() }];
  x.history.by_week = buildByWeek({
    stackup: { jobs: [{ job: A, status: m("done"), lead_time_ms: m(50), working_ms: m(30), idle_ms: m(20) },
      { job: B, status: m("done"), lead_time_ms: m(10) }] },
    tasks: { jobs: [] }, finishDates: new Map([[A, { ...m("2026-09-22"), basis: "desk_transition" }]]),
  });
  const e = buildLearning(x).evolution;
  assert.equal(e.versions.length, 2);
  assert.equal(e.versions[0].accepted.value, 0);
  assert.equal(e.versions[0].jobs.state, "unavailable");
  assert.equal(e.weeks.rows[0].population.N, 1);
  assert.deepEqual(e.weeks.unplaced.jobs, [B]);
  assert.equal(e.weeks.unplaced.n, 1);
  for (const code of ["task_mix_not_controlled", "capture_changes_not_controlled", "association_not_causation", "shared_workers_not_independent"]) assert.ok(e.limits.includes(code));
  assert.equal(e.weeks.rows[0].production_ms.state, "unavailable", "recorded window is not relabeled production");
});

test("browser and CommonJS produce identical validated learning without build-only dependencies", () => {
  const sandbox = { FactoryFormat: F, URLSearchParams };
  runInNewContext(readFileSync(new URL("../../../site/src/learning.js", import.meta.url), "utf8"), sandbox);
  const browser = sandbox.FactoryLearning.buildLearning(input());
  assert.deepEqual(JSON.parse(JSON.stringify(browser)), buildLearning(input()));
  assert.equal(sandbox.FactoryLearning.validateLearning(browser).ok, true);
});

test("closed validator and numbers gate refuse unsafe routes, unknown fields, nonfinite values and false bounds", () => {
  for (const mutate of [
    (d) => { d.overview.href = "javascript:alert(1)"; },
    (d) => { d.findings[0].examples[0].href = "#/task/x?return=https%3A%2F%2Fevil.invalid"; },
    (d) => { d.findings[0].examples[0].task = "../../private"; },
    (d) => { d.findings[0].figure.value = Infinity; },
    (d) => { d.findings[0].figure.bound = "exact"; },
    (d) => { d.findings[0].figure.reasons = ["PRIVATE_PROMPT"]; },
    (d) => { d.scope.accepted_outcomes.value = -1; },
    (d) => { d.scope.attention.n = 2; },
    (d) => { d.improvements.rows[0].after.groups = 21; },
    (d) => { d.improvements.rows[0].result = "better"; },
    (d) => { d.sources.reports = "/Users/private"; },
    (d) => { d.private_title = "PRIVATE_TITLE"; },
    (d) => { d.improvements.reasons = ["canonical_source_unavailable"]; },
    (d) => { d.overview.limits = []; },
    (d) => { d.findings[0].limits = []; },
    (d) => { d.evolution.limits = []; },
    (d) => { d.findings[0].population.n = 0; },
  ]) {
    const doc = buildLearning(input());
    mutate(doc);
    assert.deepEqual(validateLearning(doc), { ok: false, codes: ["learning_projection_invalid"] });
    assert.ok(checkNumbers({ learning: doc }).some((x) => x.code === "learning_projection_invalid"));
  }
  assert.ok(checkNumbers({ nested: { learning: buildLearning(input()) } }).length > 0, "no generic subtree exemption");
  assert.ok(checkNumbers({ unrelated: 42 }).some((x) => x.code === "bare_number"));
});

test("schema refuses fractional historical outcome counts and fabricated hours in an empty week", () => {
  const x = input();
  x.data.trend = [{ version: "mixed", jobs: m(4), accepted: m(1), sent_back: m(0), first_pass_yield: u(), attention: roll(1200, 1, 1), flow_efficiency: u() }];
  const doc = buildLearning(x);
  doc.evolution.versions[0].accepted.value = 1.5;
  assert.equal(validateLearning(doc).ok, false);
  const clean = buildLearning(input());
  clean.evolution.weeks = {
    state: "available", basis: "by_finish_week", week_basis: "iso_week_utc_monday_start",
    rows: [{ week: "2026-W39", starts_on: "2026-09-21", population: { n: 0, N: 0, of: "finished_tasks_in_week" },
      jobs: [], partial_tasks: 0, date_counts: { measured: 0, before: 0, after: 0, unknown: 0 }, unsplit: { n: 0, reasons: [] },
      lead_ms: m(50), working_ms: u(), idle_ms: u(), production_ms: { state: "unavailable", reasons: ["not_recorded_yet"] },
      by_class_ms: {}, by_waste_ms: {}, idle_by_waited_on_ms: {}, agents_working_unlabeled_ms: u(), not_labeled_ms: u(),
      flow_efficiency: { median: u(), n: 0, N: 0 } }],
    tasks: [], unplaced: { n: 0, jobs: [], reasons: [] },
  };
  assert.equal(validateLearning(clean).ok, false);
});

test("malformed present sources fail closed rather than masquerading as no data", () => {
  for (const x of [
    { data: [] }, { data: { schema: "bad", jobs: [] } }, { causes: { causes: "bad" } },
    { history: { by_week: { weeks: "bad" } } }, { checks: { schema: "bad", checks: {} } },
  ]) assert.throws(() => buildLearning(x), /learning_.*invalid/);
  for (const mutate of [
    (x) => { x.causes.causes[0].cause = "javascript:private"; },
    (x) => { x.causes.causes[0].spans[0].end_ms = -1; },
    (x) => { x.causes.N = 0; },
    (x) => { x.checks.checks["ourostack/factory#53"].card.measure = "PRIVATE_FIELD"; },
  ]) { const x = input(); mutate(x); assert.throws(() => buildLearning(x), /learning_.*invalid/); }
});

test("scoped handoffs identify public JSON selectors, task/map destinations and inspection-only authority", () => {
  const f = buildLearning(input()).findings[1];
  assert.equal(f.handoff.file, "rollups/learning.json");
  assert.equal(f.handoff.selector, '$.findings[?(@.id=="waiting:next_prompt")]');
  assert.equal(f.handoff.href, "#/causes/waiting:next_prompt");
  assert.equal(f.handoff.authority_limit, "inspect_only_no_new_authority");
  assert.equal(f.examples[0].map_path, `map/${A}.json`);
  assert.equal(f.examples[0].source_path, "$.causes[1].spans[0]");
  assert.equal(F.parseRoute(f.examples[0].href).context.cause, "waiting:next_prompt");
});

const root = resolve("site/dist/task2-validation", `learning-${process.pid}`);
test("publication twins one validated learning object, ignores stale reports twin and refuses malformed before writes", () => {
  const reports = join(root, "publish-reports"), dist = join(root, "publish-dist");
  mkdirSync(join(reports, "rollups"), { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(reports, "rollups/learning.json"), '{"stale":true}');
  const learning = buildLearning(input());
  writeFileSync(join(dist, "data.json"), JSON.stringify({ learning }));
  publishData({ reports, dist });
  assert.deepEqual(JSON.parse(readFileSync(join(dist, "rollups/learning.json"))), learning);
  assert.equal(readFileSync(join(dist, "learning.js"), "utf8"), readFileSync(new URL("../../../site/src/learning.js", import.meta.url), "utf8"));
  writeFileSync(join(dist, "data.json"), JSON.stringify({ learning: { ...learning, private_title: "PRIVATE" } }));
  const before = readFileSync(join(dist, "rollups/learning.json"), "utf8");
  assert.throws(() => publishData({ reports, dist }), /learning_projection_invalid/);
  assert.equal(readFileSync(join(dist, "rollups/learning.json"), "utf8"), before);
});

test("actual builder integrates after history assembly and retains legacy overview", () => {
  const reports = join(root, "build-reports"), store = join(root, "build-store"), dist = join(root, "build-dist");
  mkdirSync(join(reports, "rollups"), { recursive: true });
  mkdirSync(store, { recursive: true });
  execFileSync("git", ["init", "--quiet", store]);
  execFileSync("git", ["init", "--quiet", reports]);
  writeFileSync(join(reports, "rollups/coverage.json"), "{}");
  execFileSync(process.execPath, ["site/scripts/build-data.mjs", "--reports", reports, "--main", store, "--out", join(dist, "data.json")],
    { cwd: new URL("../../../", import.meta.url), env: { ...process.env, FACTORY_SITE_OFFLINE: "1" }, stdio: "pipe" });
  const d = JSON.parse(readFileSync(join(dist, "data.json")));
  assert.equal(d.learning.schema, "factory-learning/1");
  assert.equal(d.overview.schema, "factory-overview/1");
  assert.deepEqual(checkNumbers(d), []);
  publishData({ reports, dist });
  assert.deepEqual(JSON.parse(readFileSync(join(dist, "rollups/learning.json"))), d.learning);
});

test("deployed generation example keeps #53 inconclusive and negative task offsets, without private associations", () => {
  const fixture = resolve("site/dist/task1-validation");
  if (!existsSync(join(fixture, "wrapped-real-dist/data.json"))) {
    // The portable test uses the same public #53 counts; the task-owned
    // deployment fixture is exercised in full whenever it is supplied.
    const r = buildLearning(input()).improvements.rows[0];
    assert.equal(r.before.jobs, 0);
    assert.equal(r.after.jobs, 20);
    assert.equal(r.result, "inconclusive");
    return;
  }
  const d = JSON.parse(readFileSync(join(fixture, "wrapped-real-dist/data.json")));
  assert.equal(d.reports_commit, sha);
  const c = JSON.parse(readFileSync(join(fixture, "reports/rollups/causes.json")));
  const by_week = JSON.parse(readFileSync(join(fixture, "wrapped-real-dist/rollups/by_week.json")));
  const raw = JSON.parse(readFileSync(join(fixture, `reports/jobs/${A}.json`)));
  const doc = buildLearning({ data: d, causes: c, history: { by_week, evidence: [{ job: A, timeline: raw.timeline }] }, checks: d.improvement_checks });
  assert.deepEqual(validateLearning(doc), { ok: true, codes: [] });
  assert.deepEqual(checkNumbers({ learning: doc }), []);
  const r = doc.improvements.rows.find((r) => r.ref === "ourostack/factory#53");
  assert.equal(r.before.jobs, 0);
  assert.equal(r.after.jobs, 20);
  assert.equal(r.after.groups, 9);
  assert.equal(r.result, "inconclusive");
  assert.equal(doc.scope.accepted_outcomes.value, 1);
  assert.equal(doc.scope.outcome_records.value, 81);
  assert.ok(doc.findings.flatMap((f) => f.examples).some((e) => e.start_ms < 0), "task offsets may predate card creation");
  assert.equal(doc.evolution.versions.length, d.trend.length);
  assert.equal(doc.evolution.weeks.rows.length, by_week.weeks.length);
});
