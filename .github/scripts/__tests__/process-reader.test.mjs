import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { buildImprovementChecks } from "../../../site/scripts/improvement-checks.mjs";
import { buildByWeek } from "../../../site/scripts/by-week.mjs";

const require = createRequire(import.meta.url);
const F = require("../../../site/src/format.js");
const L = require("../../../site/src/learning.js");
const S = require("../../../site/src/steps.js");
const readerPath = new URL("../../../site/src/reader.js", import.meta.url);
const R = existsSync(readerPath) ? require(readerPath.pathname) : {};
const A = "c87c243fe6149fafb9296c32cd11dca0";
const m = (value) => ({ state: "measured", value, reasons: [] });
const p = (value) => ({ state: "partial", value, bound: "lower", reasons: ["log_truncated"] });

// Only the DOM operations used to construct a tree; no renderer logic lives here.
class Node {
  constructor(tag = "") { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.style = {}; this._text = ""; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => typeof c === "string" ? c : c.textContent).join(""); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this._text = ""; this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, fn) { this.listeners[key] = fn; }
}
const document = { createElement: (tag) => new Node(tag), createTextNode: (text) => String(text) };
const nodes = (root) => [root, ...root.children.filter((n) => typeof n !== "string").flatMap(nodes)];
const by = (root, tag) => nodes(root).filter((n) => n.tagName === tag.toUpperCase());
const render = (method, doc, ...args) => {
  assert.equal(typeof R.createReader, "function", "the actual learning reader must exist");
  const host = new Node("div");
  R.createReader({ document })[method](host, doc, ...args);
  return host;
};

test("the existing task journey shows the whole clock and opens the same period evidence", () => {
  const map = {
    job: A,
    lead_window: { state: "measured", start_ms: 0, end_ms: 7200000 },
    bursts_state: m(null),
    bursts: [
      { start_ms: 0, end_ms: 60000, working_ms: m(1000), idle_by_waited_on_ms: { next_prompt: 59000 } },
      { start_ms: 7140000, end_ms: 7200000, working_ms: m(2000) },
    ],
    gaps: [{ start_ms: 60000, end_ms: 7140000, waited_on: "no_session" }],
    transitions: [{ offset_ms: 59000, to: "blocked" }],
    observations: [{ offset_ms: 7199000, status: "done" }],
  };
  const selected = [];
  const root = render("journey", map, { onSelect: (index, opener) => selected.push({ index, opener }) });
  assert.match(root.textContent, /Whole recorded window/);
  assert.match(root.textContent, /3s.*Recorded activity|Recorded activity.*3s/);
  assert.match(root.textContent, /1h 58m.*No task session|No task session.*1h 58m/);
  assert.match(root.textContent, /58s.*Uncategorized|Uncategorized.*58s/);
  assert.match(root.textContent, /not.*factory.*idle|not.*factory utilization/i);
  assert.match(root.textContent, /period.*short pauses|includes.*pauses/i);
  assert.match(root.textContent, /blocked/i);
  assert.match(root.textContent, /Delivered.*last observed/);
  const buttons = by(root, "button");
  assert.equal(buttons.length, 3);
  assert.match(buttons[1].textContent, /Pause 1.*1h 58m/);
  buttons[1].listeners.click();
  assert.deepEqual(selected, [{ index: 1, opener: buttons[1] }], "overview selection uses the existing map item, not a new evidence identity");
  const strip = nodes(root).find((n) => n.className === "journey-scale");
  assert.equal(strip.attributes["aria-hidden"], "true", "readable buttons, not sub-pixel bars, are the hit targets");
  assert.equal(strip.children.length, 3);
  const comparison = by(root, "a").find((n) => n.textContent.includes("all recorded tasks"));
  assert.ok(comparison, "the same task remains followable in the full comparison population");
  assert.equal(comparison.href, `#/compare?return=%23%2Ftask%2F${A}`);
  assert.ok(!comparison.href.includes("task="), "do not filter the other tasks out");
})

test("the task journey withholds a complete-looking overview when capture cannot partition the clock", () => {
  const root = render("journey", { lead_window: { state: "unavailable" } });
  assert.match(root.textContent, /not recorded|incomplete/i);
  assert.equal(by(root, "button").length, 0);
  assert.doesNotMatch(root.textContent, /0s|0 periods/);
})

test("the full-population journey link explicitly bypasses inherited task filters", () => {
  const host = new Node("div")
  const reader = R.createReader({ document, setLocalHref: (link, href, opts) => {
    link.href = opts?.plain ? href : F.contextualRoute(href, `#/task/${A}?cause=waiting%3Anext_prompt`)
  } })
  reader.journey(host, { job: A, lead_window: { state: "measured", start_ms: 0, end_ms: 1000 },
    bursts: [{ start_ms: 0, end_ms: 1000, working_ms: m(1000) }], gaps: [] })
  const link = by(host, "a").find((n) => n.textContent === "Compare with all recorded tasks")
  assert.equal(link.href, `#/compare?return=%23%2Ftask%2F${A}`)
})
function learning({ verdict = "too_few_jobs", status = "checked", partial = false } = {}) {
  const checks = buildImprovementChecks({
    issues: [{ number: 53, url: "https://github.com/ourostack/factory/issues/53", state: "closed", body: "PRIVATE BODY" }],
    records: [],
    parseCard: () => ({ ok: true, card: { signal: "human_wait", job_class: "any", hypothesis: { measure: "human_wait", direction: "down" },
      plugin: "desk", version: status === "waiting_for_version" ? null : "3.2.0-alpha.108",
      countermeasure: "https://github.com/ourostack/desk/pull/65", evidence_jobs: [] } }),
    checkCard: () => status !== "checked" ? { status } : { status, verdict, state: partial ? "partial" : "measured",
      reasons: partial ? ["host_records_partly"] : [], jobs: 24, excluded: [{ reason: "open_job", jobs: 4 }],
      comparison: { before: { jobs: 0, groups: 0, median: null }, after: { jobs: 20, groups: 9, median: 0 }, change: null, interval: null, direction: null } },
  });
  return L.buildLearning({
    data: { schema: "factory-site/3", jobs: [{ id: A, lead_time_ms: p(400000) }],
      kaizen_issues: [{ url: "https://github.com/ourostack/factory/issues/53", cause: "waiting:next_prompt",
        resolution: { url: "https://github.com/ourostack/desk/pull/65", merged: true } }] },
    causes: { schema: "desk.factory.rollups/1", basis: "job_hours", n: 1, N: 2, state: "partial", reasons: ["log_truncated"], bound: "lower",
      causes: [{ cause: "waiting:other_task", total_ms: 300000, jobs: [A], spans: [{ job: A, start_ms: 0, end_ms: 300000 }] },
        { cause: "waiting:next_prompt", total_ms: 33467, jobs: [A], spans: [{ job: A, start_ms: 238212, end_ms: 271679 }] }] },
    history: { evidence: [{ job: A, timeline: { agents: [{ n: 0, parent: null, session: "abc" }, { n: 1, parent: 0, session: "abc" }],
      waits: [{ start_ms: 238212, end_ms: 271679, stop: null, why: "stopped_short", why_source: "evaluator", confidence: "medium", reasons: [] }] } }] },
    checks,
  });
}

test("new exact routes preserve safe return context without accepting arbitrary URLs", () => {
  assert.equal(F.parseRoute("#/time").view, "time");
  assert.equal(F.loadingView("#/time"), "time");
  assert.deepEqual(F.parseRoute("#/improvements/ourostack/factory/53"), { view: "act", improvement: "ourostack/factory#53" });
  assert.equal(F.stepOf("compare"), "time");
  assert.equal(F.stepOf("cause"), "time");
  assert.equal(F.stepOf("session"), "tasks");
  assert.equal(F.localDestination("#/improvements/ourostack/factory/53"), true);
  for (const path of ["#/time/anything", "#/improvements/a/b/0", "#/improvements/a/b/53/extra", "#/improvements/../../53", "https://evil.test", "#/improvements/%2f/b/53"]) {
    assert.equal(F.localDestination(path), false, path);
  }
  const back = "#/improvements/ourostack/factory/53";
  const href = F.routeWithContext(`#/task/${A}`, { cause: "waiting:next_prompt", return: back });
  assert.equal(F.navigationContext(href).return, back);
  assert.equal(F.navigationContext(F.contextualRoute("#/time", href)).return, back);
  assert.equal(F.routeContext("return=https%3A%2F%2Fevil.test").return, undefined);
});

test("overview leads with the published finding, a material limit and an actual next destination", () => {
  const doc = learning(), root = render("overview", doc);
  const conclusion = nodes(root).find((n) => n.dataset.role === "conclusion");
  const caveat = nodes(root).find((n) => n.dataset.role === "caveat");
  const next = by(root, "a").find((n) => n.className === "reader-next");
  assert.match(conclusion.textContent, /Recorded work on other tasks/);
  assert.match(conclusion.textContent, /at least 5 minutes/);
  assert.match(caveat.textContent, /not.*waste|not.*saving/i);
  assert.equal(next.href, "#/time");
  assert.ok(root.children.indexOf(next) < root.children.findIndex((n) => n.tagName === "SECTION"), "next destination is before history/diagnostic inventories");
  assert.match(root.textContent, /inconclusive/i);
  assert.match(root.textContent, /monitoring.*not|not.*all.clear/i);
  assert.match(root.textContent, /task mix|comparable/i);
});

test("missing or malformed learning withholds only the learning view, never claims a healthy empty factory", () => {
  const root = render("overview", L.buildLearning({}));
  assert.match(root.textContent, /does not yet establish/);
  assert.doesNotMatch(root.textContent, /0 tasks|no problems|all clear/i);
  const invalid = learning(); invalid.overview.href = "https://evil.test";
  assert.throws(() => render("time", invalid), /learning.*invalid/i);
});

test("unavailable and truncated issue collections cannot read as complete empty improvement lists", () => {
  for (const [verification, truncated, expected] of [
    ["unavailable", false, /improvement evidence.*unavailable|could not.*read.*improvement/i],
    ["verified", true, /first page.*more.*may exist/i],
  ]) {
    const checks = buildImprovementChecks({ issues: { verification, truncated, issues: [] }, records: [],
      parseCard: () => ({ ok: false, errors: [{ code: "no_block" }] }), checkCard: () => null });
    const doc = L.buildLearning({ data: { schema: "factory-site/3", jobs: [] }, checks });
    const root = render("improvements", doc, []);
    assert.match(root.textContent, expected);
    assert.doesNotMatch(root.textContent, /No published card is in this state/);
  }
});

test("each historical median shows its own sample rather than the readable-task denominator", () => {
  const by_week = buildByWeek({ stackup: { jobs: [{ job: A, status: m("done"), lead_time_ms: m(100), working_ms: m(50), idle_ms: m(50) }] },
    tasks: { jobs: [] }, finishDates: new Map([[A, { ...m("2026-09-22"), basis: "desk_transition" }]]) });
  const doc = L.buildLearning({ data: { schema: "factory-site/3", jobs: [{ id: A, lead_time_ms: m(100) }] }, history: { by_week } });
  const week = doc.evolution.weeks.rows[0];
  week.population.n = 0;
  week.flow_efficiency = { median: m(0.5), n: 1, N: 1 };
  assert.equal(L.validateLearning(doc).ok, true);
  const root = render("overview", doc);
  assert.match(root.textContent, /1 of 1 tasks support this median/);
  assert.ok(by(root, "details").some((d) => d.children[0].textContent === "Inspect all finish weeks and their samples" && by(d, "table").length),
    "complete history is available on demand rather than an inventory on arrival");
});

test("material alarms expose consequence ownership and repair destination outside diagnostics", () => {
  assert.equal(typeof R.materialWarning, "function");
  assert.equal(R.materialWarning({ alarms: [] }), null);
  const warning = R.materialWarning({ alarms: [{ key: "loop:loop_alarms_open", owner: null }] });
  assert.match(warning.effect, /recommendations.*may.*current|recommendations.*stale/i);
  assert.match(warning.ownership, /public.*ownership.*incomplete/i);
  assert.ok(warning.ownership.length <= 36, "ownership remains compact beside the alarm consequence on narrow enlarged-text screens");
  const owned = R.materialWarning({ alarms: [{ key: "loop:loop_alarms_open", owner: { url: "https://github.com/ourostack/factory/issues/53" } }] });
  assert.match(owned.ownership, /public.*ownership.*recorded/i);
  assert.equal(warning.href, "#/improvements");
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8");
  assert.match(html, /id="material-warning"/);
  assert.ok(html.indexOf('id="material-warning"') < html.indexOf('<main'));
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8");
  assert.match(app, /el\("a", null, "Impact and repair"\)/);
});

test("a direction-unknown partial finding is never an exact number in the opening conclusion", () => {
  const doc = learning();
  doc.findings[0].figure.bound = "unknown";
  const root = render("overview", doc);
  const conclusion = nodes(root).find((n) => n.dataset.role === "conclusion");
  assert.match(conclusion.textContent, /partial.*could be higher or lower/i);
  assert.doesNotMatch(conclusion.textContent, /at least|at most/);
});

test("Time and waste puts observations and behavior evidence before optional analysis", () => {
  const root = render("time", learning());
  assert.match(root.textContent, /not automatically.*waste|not.*proven.*waste/i);
  assert.match(root.textContent, /production.*unavailable|production.*not available/i);
  assert.ok(by(root, "a").some((n) => n.href === "#/compare?mode=production"));
  assert.ok(by(root, "a").some((n) => n.href === "#/compare"));
  assert.equal(by(root, "input").filter((n) => n.type === "checkbox").length, 0);
  assert.ok(by(root, "a").some((n) => n.href.includes(`/task/${A}`)));
  assert.match(root.textContent, /coordination.*unavailable|coordination.*not recorded/i);
  assert.match(root.textContent, /Host observation: not recorded/);
  assert.match(root.textContent, /Judgment: stopped short.*evaluator.*medium/i);
  assert.doesNotMatch(root.textContent, /Host observation:.*end.turn/);
});

test("a completed inconclusive check is a result and merge and closure remain independent", () => {
  const root = render("improvements", learning(), []);
  const headings = by(root, "h2").map((n) => n.textContent);
  assert.deepEqual(headings, ["Results available", "Awaiting a result", "Investigating or changing the process"]);
  const result = nodes(root).find((n) => n.dataset.ref === "ourostack/factory#53");
  assert.match(result.textContent, /Inconclusive/);
  assert.match(result.textContent, /baseline.*missing|no baseline/i);
  assert.match(result.textContent, /20 tasks.*9 independent groups/);
  assert.match(result.textContent, /closed.*not.*effect|closure.*independent/i);
  assert.match(result.textContent, /merged.*not.*effect/i);
  assert.ok(by(result, "a").some((n) => n.href === "#/improvements/ourostack/factory/53"));
});

test("awaiting version has no completed-result claim; detail exposes the actual check, exclusions and links", () => {
  const doc = learning({ status: "waiting_for_version" });
  const root = render("improvements", doc, []);
  const awaiting = nodes(root).find((n) => n.dataset.section === "awaiting_result");
  assert.match(awaiting.textContent, /version.*not.*recorded|version.*not.*published/i);
  assert.doesNotMatch(awaiting.textContent, /check completed/i);
  const detail = render("improvements", learning({ partial: true }), [], "ourostack/factory#53");
  assert.match(detail.textContent, /original.*trigger.*not.*published/i);
  assert.match(detail.textContent, /3\.2\.0-alpha\.108/);
  assert.match(detail.textContent, /open.*4|4.*open/i);
  assert.match(detail.textContent, /partial/i);
  assert.match(detail.textContent, /95%|95 percent/);
  assert.match(detail.textContent, /retain.*revise.*not.*published|decision.*not.*published/i);
  assert.ok(by(detail, "a").some((n) => n.href.startsWith("#/causes/waiting:next_prompt")));
  assert.ok(by(detail, "a").some((n) => n.href.includes(`/task/${A}`) && F.navigationContext(n.href).return === "#/improvements/ourostack/factory/53"));
});

test("measured improvement directions retain signed changes and do not claim causal effects", () => {
  for (const [verdict, after, interval, direction, label] of [
    ["confirmed", 800, [-250, -150], "down", "Better on the chosen measure"],
    ["not_confirmed", 1200, [150, 250], "up", "Worse on the chosen measure"],
    ["no_clear_change", 1000, [-50, 50], null, "No detected change"],
  ]) {
    const checks = buildImprovementChecks({
      issues: [{ number: 53, url: "https://github.com/ourostack/factory/issues/53", state: "closed", body: "" }],
      records: [],
      parseCard: () => ({ ok: true, card: { signal: "human_wait", job_class: "any",
        hypothesis: { measure: "human_wait", direction: "down" }, plugin: "desk", version: "3.2.0-alpha.108",
        countermeasure: "https://github.com/ourostack/desk/pull/65", evidence_jobs: [] } }),
      checkCard: () => ({ status: "checked", verdict, state: "measured", reasons: [], jobs: 20, excluded: [],
        comparison: { before: { jobs: 10, groups: 6, median: 1000 }, after: { jobs: 10, groups: 6, median: after },
          change: after - 1000, interval, direction } }),
    });
    const projection = L.buildLearning({ data: { schema: "factory-site/3", jobs: [] }, checks });
    const root = render("improvements", projection, [], "ourostack/factory#53");
    assert.match(root.textContent, new RegExp(label));
    assert.match(root.textContent, /before\/after association, not a causal effect/);
    assert.match(root.textContent, /10 tasks; 6 independent groups/);
    if (direction === "down") assert.match(root.textContent, /−200 milliseconds/);
    assert.doesNotMatch(root.textContent, /effect proved|caused an improvement/i);
  }
});

test("task naming never turns public pull-request titles into requested outcomes", () => {
  assert.equal(typeof R.taskIdentity, "function");
  const job = { id: A, name: "A public PR title", more_prs: m(4), pull_requests: [{ url: "https://github.com/ourostack/desk/pull/65" }] };
  const identity = R.taskIdentity(job, {});
  assert.equal(identity.title, "Public reference: A public PR title");
  assert.match(identity.basis, /requested outcome.*not published/i);
  assert.equal(identity.reference, "A public PR title");
  assert.doesNotMatch(identity.title, /and 4 more/);
  assert.equal(R.taskIdentity(job, { [A]: { title: "Authorized local request" } }).title, "Authorized local request");
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8");
  assert.match(app, /"view-title task-title", tn\.reference \? "One task's production story" : tn\.title/);
  assert.match(app, /"task-public-reference", tn\.title/);
});

test("legacy issue summaries do not contradict a current completed check or confuse merge with effect", () => {
  const doc = learning();
  const rows = S.actRows([{ url: "https://github.com/ourostack/factory/issues/53", issue_state: "closed",
    resolution: { url: "https://github.com/ourostack/desk/pull/65", merged: true } }], null, undefined, doc.improvements.rows);
  assert.match(rows[0].check, /inconclusive/i);
  assert.doesNotMatch(S.actSummary(rows), /none.*checked|not enough labeled/i);
  assert.doesNotMatch(S.takenOnWords(S.causeIssues(rows, "waiting:next_prompt")), /not yet checked/);
  const reviewStatus = S.improvementStatus({ queue: { schema: "factory-improvements/1", state: "not_reviewed", rows: [] }, issues: 1, issuesVerified: true, placement: "details" });
  assert.doesNotMatch(reviewStatus, /Problems in hand|listed below/);
  assert.match(reviewStatus, /above/);
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /merged, not yet checked/, "every live cause and issue route must defer to the actual current check");
});

test("primary HTML exposes four direct destinations and loads the learning reader in dependency order", () => {
  const html = readFileSync(new URL("../../../site/src/index.html", import.meta.url), "utf8");
  const nav = html.slice(html.indexOf('<nav class="steps"'), html.indexOf("</nav>"));
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["#/", "#/time", "#/improvements", "#/tasks"]);
  assert.match(html, /data-step="store" href="#\/store">Data health/);
  assert.ok(html.indexOf('src="format.js"') < html.indexOf('src="learning.js"'));
  assert.ok(html.indexOf('src="learning.js"') < html.indexOf('src="reader.js"'));
  assert.ok(html.indexOf('src="reader.js"') < html.indexOf('src="app.js"'));
  assert.doesNotMatch(html, /Step [1-4] of 4|none has been checked|none.*checked yet/);
});
