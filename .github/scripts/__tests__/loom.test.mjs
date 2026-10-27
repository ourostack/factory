import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { projection, JOB, SESSION, HASH } from "./fixtures/task-context.mjs";
import { buildImprovementChecks } from "../../../site/scripts/improvement-checks.mjs";

const require = createRequire(import.meta.url);
const builders = await import("../../../site/scripts/session-intelligence.mjs");
const { buildLearning } = require("../../../site/src/learning.js");
const loom = (() => {
  try { return require("../../../site/src/loom.js"); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND") return {}; throw error; }
})();
const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const HOUR = 3600000;
const OTHER = "4c0d2e6f-9b2e-4d3f-8a4b-2c3d4e5f6a71";
const LONE = "5d1e3f70-ac3f-4e40-9b5c-3d4e5f6a7b82";
const OTHER_JOB = "c".repeat(32);
const sources = { desk: "a".repeat(40), facts: "b".repeat(40), reports: "unavailable" };
const span = (kind, start_ms, end_ms, extra = {}) => ({ kind, agent: 0, start_ms, end_ms, ...extra });

function facts(over = {}, id = SESSION) {
  return {
    schema: "desk.factory.published/2",
    session: { id, host: "copilot-cli", ended: true, duration_ms: 3 * HOUR + 1000 },
    models: [{ id: "recorded-model", requests: 1 }],
    agents: [{ n: 0, parent: null, model: "recorded-model" }, { n: 1, parent: 0, model: "worker-model" }],
    intervals: [
      span("turn", 0, 1000), span("tool", 500, 1500, { tool: "shell" }),
      span("subagent", 1000, 2000, { agent: 1 }), span("human_wait", 1200, 2500),
      span("tool", 2 * HOUR, 2 * HOUR + 600000, { tool: "edit" }),
      span("tool", 3 * HOUR, 3 * HOUR + 1000, { tool: "read" }),
    ],
    counts: { tool_calls: { shell: 1, read: 1, edit: 1 }, tool_failures: { shell: 1 }, tool_retries: 0, compactions: 1 },
    jobs: [],
    outcomes: [],
    unavailable: [],
    ...over,
  };
}
const binding = (job = JOB) => ({ job, agents: [0], segments: [{ start_ms: 0, end_ms: 1000 }], session_offset_ms: 10000 });
function detail(f, options = {}) {
  return builders.buildSessionDetail({ facts: f, contexts: new Map(), jobs: [], sources, ...options });
}
function proposal(job = JOB) {
  const p = projection(job);
  p.record.schema = "desk.factory.context/2";
  p.record.recommendations = [{
    id: "4".repeat(16), observations: ["2".repeat(16)],
    problem: "Progress stopped until the required software was installed.",
    change: "Check the installed software version before starting the connection work.",
    hypothesis: "An early check could avoid a stalled attempt.",
    check: "Compare stalled attempts before and after the early check.", confidence: "medium",
  }];
  return p;
}
function elsewhere(p) {
  p.record.sources = [{ session: OTHER, sha256: HASH }];
  for (const event of p.record.events) for (const ref of event.evidence) ref.session = OTHER;
  for (const placement of p.placements) for (const s of placement.spans) s.session = OTHER;
  return p;
}
const bound = (context, over = {}) => detail(facts({ jobs: [binding()], outcomes: [{ job: JOB, state: "accepted",
  returns: [{ caught: "at_review", counts: true }, { caught: "after_delivery", counts: false }] }], ...over }),
{ jobs: [{ id: JOB, status: "done" }], contexts: new Map(context ? [[JOB, context]] : []) });

function catalogOf(list) { return builders.buildSessionCatalog({ facts: list, sources }); }
const allFacts = () => [facts({ jobs: [binding()] }), facts({ jobs: [binding()] }, OTHER), facts({}, LONE)];

// Learning with one real shipped change whose check was inconclusive with no baseline.
const LA = "c87c243fe6149fafb9296c32cd11dca0";
const sha = "41541eb0e1a1f04879cc14110ff321962c90fe18";
function learningDoc({ verdict = "too_few_jobs", partial = false, before = 0 } = {}) {
  const m = (value) => ({ state: "measured", value, reasons: [] });
  const p = (value) => ({ state: "partial", value, reasons: ["log_truncated"], bound: "lower" });
  const data = { schema: "factory-site/3", reports_commit: sha, jobs: [{ id: LA, status: "done", lead_time_ms: p(400000), signoff: m("not_recorded") }],
    outcomes: { signoff: { jobs: m(1), accepted: m(1) }, first_pass_yield: { state: "unavailable", reasons: ["not_recorded"] }, rework: { returns: [] } },
    capture_coverage: { share: { state: "partial", value: 0.8, reasons: ["log_truncated"], bound: "unknown" } }, trend: [],
    kaizen_issues: [{ url: "https://github.com/ourostack/factory/issues/53", cause: "waiting:next_prompt", issue_state: "closed",
      resolution: { kind: "countermeasure", url: "https://github.com/ourostack/desk/pull/65", merged: true } }] };
  const checks = buildImprovementChecks({
    issues: [{ number: 53, url: "https://github.com/ourostack/factory/issues/53", state: "closed", body: "PRIVATE_BODY" }], records: [],
    parseCard: () => ({ ok: true, card: { signal: "human_wait", job_class: "any", hypothesis: { measure: "human_wait", direction: "down" },
      plugin: "desk", version: "3.2.0-alpha.108", countermeasure: "https://github.com/ourostack/desk/pull/65", evidence_jobs: ["PRIVATE_TRIGGER"] } }),
    checkCard: () => ({ status: "checked", verdict, state: partial ? "partial" : "measured", reasons: partial ? ["host_records_partly"] : [], jobs: 54 + before,
      excluded: [{ reason: "open_job", jobs: 25 }, { reason: "plugin_not_reported", jobs: 9 }],
      comparison: before
        ? { before: { jobs: before, groups: 6, median: 2 * HOUR }, after: { jobs: 20, groups: 9, median: HOUR }, change: -HOUR,
          interval: [-HOUR - 420000, -3000000], direction: "down" }
        : { before: { jobs: 0, groups: 0, median: null }, after: { jobs: 20, groups: 9, median: 0 }, change: null, interval: null, direction: null } }),
  });
  checks.sources = { desk: "a".repeat(40), facts: "b".repeat(40), reports: sha };
  return buildLearning({ data, checks });
}

// A strict stub DOM: text only ever enters through text nodes.
class Text {
  constructor(data) { if (typeof data !== "string") throw new TypeError(`text node from ${typeof data}`); this.data = data; }
  get textContent() { return this.data; }
}
class Node {
  constructor(tag, ns = null) { this.tagName = tag.toUpperCase(); this.ns = ns; this.children = []; this.attributes = {}; this.listeners = {}; this.parent = null; }
  append(...kids) { for (const k of kids) { if (!(k instanceof Node || k instanceof Text)) throw new TypeError(`append(${typeof k})`); k.parent = this; this.children.push(k); } }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k, v) { if (typeof v !== "string") throw new TypeError(`attribute ${k} from ${typeof v}`); this.attributes[k] = v; }
  getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
  hasAttribute(k) { return Object.hasOwn(this.attributes, k); }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let n = this; n; n = n.parent) for (const fn of n.listeners[type] || []) fn(event);
    return event;
  }
  focus() { doc.activeElement = this; }
  scrollIntoView() {}
  scrollTo() {}
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
  set textContent(value) { this.children = []; if (value !== "") this.append(new Text(String(value))); }
}
const doc = {
  activeElement: null, documentElement: new Node("html"),
  createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag, ns), createTextNode: (text) => new Text(text),
};
const all = (n) => n instanceof Node ? [n, ...n.children.flatMap(all)] : [];
const tags = (n, tag) => all(n).filter((x) => x.tagName === tag.toUpperCase());
const attr = (n, key, value) => all(n).filter((x) => x.getAttribute(key) !== null && (value === undefined || x.getAttribute(key) === value));
const links = (n) => tags(n, "a").map((a) => a.getAttribute("href"));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function windowStub(hash = "#/") {
  const listeners = {};
  return {
    location: { hash, search: "", replaced: null, reloads: 0, replace(url) { this.replaced = url; }, reload() { this.reloads += 1; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    matchMedia: () => ({ matches: false }), listeners, document: doc,
  };
}
async function mount(over = {}) {
  assert.equal(typeof loom.mountLoom, "function", "mountLoom exists");
  const host = new Node("div");
  const calls = [];
  const details = new Map(over.details || []);
  const win = windowStub(over.hash);
  const reader = loom.mountLoom({
    root: host, document: doc, window: win,
    catalog: "catalog" in over ? over.catalog : catalogOf(allFacts()),
    readDetail: over.readDetail || ((id) => { calls.push(id); return details.has(id) ? Promise.resolve(details.get(id)) : Promise.reject(new Error("not found")); }),
    learning: "learning" in over ? over.learning : learningDoc(),
    tasks: "tasks" in over ? over.tasks : { jobs: [{ job: JOB, name: "Restore the device connection" }] },
  });
  await reader.ready; await flush();
  return { host, calls, win, reader, go: async (hash) => { await reader.go(hash); await flush(); } };
}
const BANNED = /waiting for you|human intervention|main-agent work|\bidle\b|\bwaste\b|hours saved|most activity|\bdemo\b/i;

test("the reader exists with its tested mount interface and legacy route mapper", () => {
  assert.equal(typeof loom.mountLoom, "function");
  assert.equal(typeof loom.legacyTarget, "function");
});

test("the shelf names task associations, includes unbound sessions and fetches no session detail", async () => {
  const { host, calls } = await mount();
  const text = host.textContent;
  assert.match(text, /Restore the device connection/);
  assert.match(text, /No task association/);
  for (const id of [SESSION, OTHER, LONE]) assert.ok(links(host).includes(`#/session/${id}`), id);
  assert.ok(text.includes(SESSION.slice(0, 8)));
  assert.ok(!text.includes(SESSION), "full UUIDs are links, not the shelf's words");
  assert.ok(links(host).includes(`#/sessions?task=${JOB}`));
  assert.equal(calls.length, 0);
  assert.equal(tags(host, "h1").length, 1);
  assert.doesNotMatch(text, BANNED);
});

test("task names and other strings are only ever text", async () => {
  const { host } = await mount({ tasks: { jobs: [{ job: JOB, name: "<img src=x onerror=alert(1)> & <b>bold</b>" }] } });
  assert.ok(host.textContent.includes("<img src=x onerror=alert(1)> & <b>bold</b>"));
  assert.equal(tags(host, "img").length + tags(host, "b").length, 0);
  assert.doesNotMatch(read("site/src/loom.js"), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("loading, network and invalid catalog states are visible and never empty", async () => {
  const pending = await (async () => {
    const host = new Node("div");
    loom.mountLoom({ root: host, document: doc, window: windowStub(), catalog: new Promise(() => {}), readDetail: () => new Promise(() => {}), learning: null, tasks: null });
    await flush();
    return host;
  })();
  assert.match(pending.textContent, /Loading/);
  const offline = await mount({ catalog: Promise.reject(new Error("network <down>")) });
  assert.match(offline.host.textContent, /couldn.t load the session catalog/i);
  assert.ok(offline.host.textContent.includes("network <down>"));
  assert.ok(attr(offline.host, "role", "alert").length > 0);
  const bad = catalogOf(allFacts()); bad.sessions[0].extra = 1;
  const invalid = await mount({ catalog: bad });
  assert.match(invalid.host.textContent, /didn.t pass its checks/i);
  assert.ok(!links(invalid.host).includes(`#/session/${bad.sessions[0].id}`));
});

test("a session detail is fetched once on demand, validated, and failures stay visible", async () => {
  const ok = bound(projection());
  const m = await mount({ details: [[SESSION, ok]] });
  await m.go(`#/session/${SESSION}`);
  await m.go("#/");
  await m.go(`#/session/${SESSION}`);
  assert.deepEqual(m.calls, [SESSION]);
  const broken = structuredClone(ok); broken.numbers.activity_ms = 5;
  const invalid = await mount({ details: [[SESSION, broken]] });
  await invalid.go(`#/session/${SESSION}`);
  assert.match(invalid.host.textContent, /didn.t pass its checks/i);
  assert.ok(links(invalid.host).includes(`evidence.html#/session/${SESSION}`));
  const offline = await mount({ readDetail: () => Promise.reject(new Error("timed out")) });
  await offline.go(`#/session/${SESSION}`);
  assert.match(offline.host.textContent, /couldn.t load this session/i);
  assert.ok(offline.host.textContent.includes("timed out"));
  const unknown = await mount();
  await unknown.go("#/session/6e2f4a81-bd40-4f51-ac6d-4e5f6a7b8c93");
  assert.match(unknown.host.textContent, /isn.t in this build.s session catalog/i);
});

test("a reviewed session leads with its reviewed heading, story pins and recorded weave", async () => {
  const m = await mount({ details: [[SESSION, bound(projection())]] });
  await m.go(`#/session/${SESSION}`);
  const h1 = tags(m.host, "h1")[0];
  assert.equal(h1.textContent, "Restore the device connection");
  assert.equal(doc.activeElement, h1);
  const text = m.host.textContent;
  assert.match(text, /Checked the connection\./);
  assert.match(text, /The connection worked after correcting the mapping\./);
  assert.match(text, /Waiting for a prerequisite/);
  assert.match(text, /The installed software did not support the connection\./);
  assert.match(text, /predates recommendations/i);
  assert.match(text, /unknown, not zero/i);
  assert.ok(attr(m.host, "data-pin").length >= 2);
  assert.match(text, /task-wide/i);
  assert.match(text, /caught at review/i);
  assert.match(text, /not counted as rework/i);
  assert.doesNotMatch(text, BANNED);
  assert.ok(links(m.host).includes(`sessions/${SESSION}.json`));
  assert.ok(links(m.host).includes(`evidence.html#/task/${JOB}/session/${SESSION}`));
  assert.ok(links(m.host).includes(`#/sessions?task=${JOB}`));
});

test("an unreviewed session keeps an honest unwritten story and never names a tool kind as its purpose", async () => {
  const d = detail(facts({}, LONE));
  const m = await mount({ details: [[LONE, d]] });
  await m.go(`#/session/${LONE}`);
  const h1 = tags(m.host, "h1")[0].textContent;
  assert.doesNotMatch(h1, /command|reading|writing|helper|notes|mostly/i);
  const text = m.host.textContent;
  assert.match(text, /hasn.t been reviewed/i);
  assert.match(text, /isn.t bound to any task/i);
  assert.match(text, /no captured interval/i);
  assert.match(text, /doesn.t show/i);
  assert.doesNotMatch(text, BANNED);
});

test("withheld and source-changed contexts explain themselves without leaking or inventing a story", async () => {
  for (const [context, words] of [
    [{ schema: "factory-task-context/1", job: JOB, availability: "withheld", reason: "review_pending", record: null, placements: [] }, /pending/i],
    [{ schema: "factory-task-context/1", job: JOB, availability: "unavailable", reason: "source_changed", record: null, placements: [] }, /changed after it was reviewed/i],
    [null, /no reviewed story has been published/i],
  ]) {
    const m = await mount({ details: [[SESSION, bound(context)]] });
    await m.go(`#/session/${SESSION}`);
    const text = m.host.textContent;
    assert.match(text, words);
    assert.doesNotMatch(text, /Checked the connection|software update/);
    assert.match(tags(m.host, "h1")[0].textContent, /hasn.t been reviewed/i);
  }
});

test("recommendations are proposals, scoped to this session only when their observations cite it", async () => {
  const here = await mount({ details: [[SESSION, bound(proposal())]] });
  await here.go(`#/session/${SESSION}`);
  let text = here.host.textContent;
  assert.match(text, /Check the installed software version before starting the connection work\./);
  assert.match(text, /from this session/i);
  assert.match(text, /Proposed/);
  assert.match(text, /Not checked/);
  assert.doesNotMatch(text, /Helped|Shipped/);
  assert.ok(links(here.host).includes(`#/mend?session=${SESSION}&focus=${"4".repeat(16)}`));

  const wide = await mount({ details: [[SESSION, bound(elsewhere(proposal()))]] });
  await wide.go(`#/session/${SESSION}`);
  text = wide.host.textContent;
  assert.match(text, /task-wide proposal/i);
  assert.doesNotMatch(text, /from this session/i);
  assert.match(text, /reviewed steps belong to other sessions/i);
  assert.equal(attr(wide.host, "data-pin").length, 0);
});

test("the mending view separates reviewed proposals from canonical changes and their checks", async () => {
  const m = await mount({ details: [[SESSION, bound(proposal())]], hash: `#/mend?session=${SESSION}&focus=${"4".repeat(16)}` });
  await m.go(`#/mend?session=${SESSION}&focus=${"4".repeat(16)}`);
  const text = m.host.textContent;
  for (const step of ["Noticed", "Try", "Check", "Then"]) assert.ok(text.includes(step), step);
  const card = all(m.host).find((n) => n.getAttribute("id") === `idea-${"4".repeat(16)}`);
  assert.ok(card, "focused proposal card");
  assert.equal(doc.activeElement, card);
  assert.ok(links(card).includes(`#/session/${SESSION}`), "seen-in backlink");
  assert.match(card.textContent, /Proposed/);
  assert.match(card.textContent, /Not checked/);
  assert.ok(links(m.host).includes("https://github.com/ourostack/factory/issues/53"));
  assert.ok(links(m.host).includes("https://github.com/ourostack/desk/pull/65"));
  const pills = attr(m.host, "data-pill");
  assert.ok(pills.some((p) => p.getAttribute("data-pill") === "change" && /Shipped/.test(p.textContent)));
  assert.ok(pills.some((p) => p.getAttribute("data-pill") === "check" && /Inconclusive/.test(p.textContent)));
  assert.match(text, /no baseline/i);
  assert.match(text, /open/i);
  assert.match(text, /searched 1 of/i);
  assert.ok(m.calls.length <= 1);
  assert.doesNotMatch(text, BANNED);
});

test("the mending scan is bounded and says what it searched", async () => {
  const many = Array.from({ length: 30 }, (_, i) => facts({ jobs: [binding()] }, `${(0x10000000 + i).toString(16)}-0000-4000-8000-000000000000`));
  const m = await mount({ catalog: catalogOf(many), readDetail: (id) => { m2.calls.push(id); return Promise.resolve(detail(many.find((f) => f.session.id === id))); } });
  const m2 = { calls: [] };
  await m.go("#/mend");
  assert.equal(m2.calls.length, 0);
  const button = tags(m.host, "button").find((b) => /look through/i.test(b.textContent));
  assert.ok(button);
  button.dispatch("click"); await flush(); await flush();
  assert.ok(m2.calls.length > 0 && m2.calls.length <= 12);
  assert.match(m.host.textContent, new RegExp(`searched ${m2.calls.length} of 30`, "i"));
});

test("unavailable or malformed learning stays visible rather than becoming no changes", async () => {
  const none = await mount({ learning: null });
  await none.go("#/mend");
  assert.match(none.host.textContent, /changes and their checks aren.t available/i);
  const bad = learningDoc(); bad.improvements.rows[0].status = "helped";
  const invalid = await mount({ learning: bad });
  await invalid.go("#/mend");
  assert.match(invalid.host.textContent, /didn.t pass its checks/i);
  assert.ok(!links(invalid.host).includes("https://github.com/ourostack/desk/pull/65"));
});

test("a task-filtered shelf weaves a bounded, disclosed set of swatches", async () => {
  const many = Array.from({ length: 15 }, (_, i) => facts({ jobs: [binding()] }, `${(0x20000000 + i).toString(16)}-0000-4000-8000-000000000000`));
  const calls = [];
  const m = await mount({ catalog: catalogOf([...many, facts({}, LONE)]), readDetail: (id) => { calls.push(id); return Promise.resolve(detail(many.find((f) => f.session.id === id), { contexts: new Map([[JOB, projection()]]) })); } });
  await m.go(`#/sessions?task=${JOB}`);
  assert.ok(calls.length > 0 && calls.length <= 12);
  assert.match(m.host.textContent, new RegExp(`woven from ${calls.length} of 15`, "i"));
  assert.ok(!links(m.host).includes(`#/session/${LONE}`));
  assert.match(tags(m.host, "h1")[0].textContent, /Restore the device connection/);
  await m.go("#/sessions?task=nope");
  assert.match(m.host.textContent, /isn.t a task id/i);
});

test("historical routes keep their fragment and query on the detailed evidence page", async () => {
  const L = loom.legacyTarget;
  for (const hash of ["", "#", "#/", "#main", `#/session/${SESSION}`, "#/mend", `#/mend?session=${SESSION}&focus=${"4".repeat(16)}`, "#/about", `#/sessions?task=${JOB}`]) {
    assert.equal(L(hash, ""), null, hash);
  }
  for (const hash of ["#/time", "#/improvements", "#/tasks", "#/why", "#/help", "#/store", "#/compare?mode=working", "#/causes/waiting:next_prompt",
    `#/task/${JOB}`, `#/task/${JOB}/session/${SESSION}?selection=stretch:1`, "#/session/b76a3a21", `#/session/${SESSION}?selection=stretch:2`,
    "#job-abc", "#session-abc", "#glossary", "#/?investigation=x", "#/improvements/ourostack/desk/53"]) {
    assert.equal(L(hash, ""), `evidence.html${hash}`, hash);
  }
  assert.equal(L("#/time", "?q=1"), "evidence.html?q=1#/time");
  const m = await mount();
  const before = m.host.textContent;
  await m.go("#/tasks");
  assert.equal(m.win.location.replaced, "evidence.html#/tasks");
  assert.equal(m.host.textContent, before);
});

test("the skip link focuses the reader without rerouting, and navigation marks the current page", async () => {
  const m = await mount();
  const skip = tags(m.host, "a")[0];
  assert.equal(skip.getAttribute("href"), "#main");
  const main = all(m.host).find((n) => n.getAttribute("id") === "main");
  const before = m.host.textContent;
  const event = skip.dispatch("click");
  assert.equal(event.defaultPrevented, true);
  assert.equal(doc.activeElement, main);
  await m.go("#main");
  assert.equal(m.host.textContent, before);
  assert.equal(m.win.location.replaced, null);
  const current = () => attr(m.host, "aria-current", "page").map((n) => n.getAttribute("href"));
  assert.deepEqual(current(), ["#/"]);
  await m.go("#/mend");
  assert.deepEqual(current(), ["#/mend"]);
  await m.go("#/about");
  assert.deepEqual(current(), ["#/about"]);
  assert.ok(links(m.host).some((h) => h.startsWith("evidence.html")));
});

test("the weave is one keyboard stop whose readout matches its table, column by column", async () => {
  const m = await mount({ details: [[SESSION, bound(projection())]] });
  await m.go(`#/session/${SESSION}`);
  const weave = attr(m.host, "data-loom", "weave")[0];
  assert.equal(weave.getAttribute("tabindex"), "0");
  const readout = attr(m.host, "data-loom", "readout")[0];
  assert.equal(readout.getAttribute("aria-live"), "polite");
  const table = tags(m.host, "table")[0];
  const rows = tags(tags(table, "tbody")[0], "tr");
  assert.equal(rows.length, 4);
  const key = (k) => weave.dispatch("keydown", { key: k });
  const check = (i) => {
    const cells = Object.fromEntries(attr(rows[i], "data-lane").map((c) => [c.getAttribute("data-lane"), c.textContent]));
    const said = Object.fromEntries(attr(readout, "data-lane").map((c) => [c.getAttribute("data-lane"), c.textContent]));
    assert.deepEqual(said, cells, `column ${i}`);
    assert.equal(tags(rows[i], "th")[0].textContent, attr(readout, "data-loom", "when")[0].textContent);
  };
  assert.equal(key("Home").defaultPrevented, true); check(0);
  key("ArrowRight"); check(1);
  key("ArrowRight"); check(2);
  key("End"); check(3);
  key("ArrowRight"); check(3);
  key("ArrowLeft"); check(2);
  const chapter = attr(m.host, "aria-pressed")[0];
  chapter.dispatch("click");
  assert.equal(chapter.getAttribute("aria-pressed"), "true");
  check(0);
  assert.match(m.host.textContent, /hours since it opened|since it opened/i);
});

test("the last bin is read against its own width and partial stops stay lower bounds", async () => {
  const d = bound(projection(), { unavailable: [{ field: "human_waits", reason: "host_records_partly" }] });
  const m = await mount({ details: [[SESSION, d]] });
  await m.go(`#/session/${SESSION}`);
  const rows = tags(tags(m.host, "tbody")[0], "tr");
  const last = attr(rows[3], "data-lane", "reading")[0].textContent;
  assert.match(last, /100%/);
  assert.match(attr(rows[0], "data-lane", "stops")[0].textContent, /at least/i);
  assert.match(m.host.textContent, /at least/i);
});

test("the static entry loads validators in order, ships no demo data and keeps the old reader whole", () => {
  const html = read("site/src/index.html");
  const order = ["task-context.js", "session-data.js", "format.js", "learning.js", "loom.js"].map((f) => html.indexOf(`src="${f}"`));
  assert.ok(order.every((i) => i > 0), "every script is loaded");
  assert.ok(order.indexOf(order[0]) === 0 && html.indexOf('src="task-context.js"') < html.indexOf('src="session-data.js"'));
  assert.ok(html.indexOf('src="format.js"') < html.indexOf('src="learning.js"') && html.indexOf('src="learning.js"') < html.indexOf('src="loom.js"'));
  assert.match(html, /href="loom\.css"/);
  for (const file of ["site/src/index.html", "site/src/loom.js", "site/src/loom.css"]) {
    const source = read(file);
    assert.doesNotMatch(source, /\bdemo\b|95f7a528|86df72b9|b76a3a21|prototype/i, file);
  }
  const base = execFileSync("git", ["show", "8da1801b763436db752700cea731ed958973ee08:site/src/index.html"], { cwd: new URL(".", root), encoding: "utf8" });
  assert.equal(read("site/src/evidence.html"), base);
  const pages = read(".github/workflows/pages.yml");
  assert.match(pages, /cp site\/src\/evidence\.html site\/src\/session-data\.js site\/src\/learning\.js site\/src\/loom\.js site\/src\/loom\.css site\/dist\//);
});

test("small text meets 4.5:1 contrast on every paper in both themes", () => {
  const css = read("site/src/loom.css");
  const theme = (name) => {
    const block = new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`).exec(css)[1];
    return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  };
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const name of ["day", "night"]) {
    const t = theme(name);
    const texts = Object.keys(t).filter((k) => k === "ink" || k === "muted" || k.endsWith("-text"));
    assert.ok(texts.length >= 8, name);
    for (const text of texts) for (const paper of ["paper", "paper-2", "card"]) {
      assert.ok(ratio(t[text], t[paper]) >= 4.5, `${name} ${text} on ${paper}: ${ratio(t[text], t[paper]).toFixed(2)}`);
    }
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width:/);
});

test("absent or incomplete task bindings are never read as an unbound session", async () => {
  for (const [f, words] of [
    [facts({ jobs: undefined }, LONE), /task associations weren.t recorded/i],
    [facts({ unavailable: [{ field: "jobs", reason: "withheld_public" }] }, LONE), /task associations weren.t recorded/i],
    [facts({ jobs: [], unavailable: [{ field: "jobs", reason: "log_truncated" }] }, LONE), /task associations are incomplete/i],
  ]) {
    const m = await mount({ details: [[LONE, detail(f)]] });
    await m.go(`#/session/${LONE}`);
    assert.match(m.host.textContent, words);
    assert.doesNotMatch(m.host.textContent, /isn.t bound to any task|No task association was recorded/i);
  }
  const partly = detail(facts({ jobs: [binding()], unavailable: [{ field: "jobs", reason: "log_truncated" }] }), { contexts: new Map([[JOB, projection()]]) });
  const m = await mount({ details: [[SESSION, partly]] });
  await m.go(`#/session/${SESSION}`);
  assert.match(m.host.textContent, /Restore the device connection/);
  assert.match(m.host.textContent, /task associations are incomplete/i);
  assert.match(m.host.textContent, /the log was cut short/);
});

test("the weave and task swatches give every period its actual elapsed width", async () => {
  const m = await mount({ details: [[SESSION, bound(projection())]] });
  await m.go(`#/session/${SESSION}`);
  const num = (n, k) => Number(n.getAttribute(k));
  const hits = all(m.host).filter((n) => n.getAttribute("class") === "hit" || n.getAttribute("class") === "hit short");
  assert.equal(hits.length, 4);
  const k = num(hits[0], "width") / HOUR;
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(num(hits[i], "x") - i * HOUR * k) < 1e-6, `column ${i} starts at its time`);
  const lastStart = 3 * HOUR * k;
  const threads = all(m.host).filter((n) => /\bthread\b/.test(n.getAttribute("class") || "") && num(n, "x") >= lastStart - 1e-6);
  assert.ok(threads.length > 0, "the final second keeps its thread");
  for (const t of threads) assert.ok(num(t, "width") <= 1000 * k + 1e-6, "no elapsed width is granted to the final second");
  assert.equal(hits[3].getAttribute("data-short"), "true");
  const end = all(m.host).find((n) => n.tagName === "TEXT" && n.textContent === "3 h 1 s");
  assert.ok(end && Math.abs(num(end, "x") - (3 * HOUR + 1000) * k) < 1e-6, "axis ends at the real duration");
  const pin = attr(m.host, "data-pin", "3".repeat(16))[0];
  assert.ok(Math.abs(num(tags(pin, "line")[0], "x1") - 5000 * k) < 1e-6, "pins sit at their evidence time");

  const many = [facts({ jobs: [binding()] })];
  const t = await mount({ catalog: catalogOf(many), details: [[SESSION, detail(many[0], { contexts: new Map([[JOB, projection()]]) })]] });
  await t.go(`#/sessions?task=${JOB}`);
  const reads = all(t.host).filter((n) => n.getAttribute("class") === "t-read");
  const last = reads.find((n) => num(n, "x") >= 3 - 1e-9);
  assert.ok(last && num(last, "width") <= 1000 / HOUR + 1e-9, "swatches keep the final second's width");
});

test("a linked session that can't be read is an error with retry, not an empty mending page", async () => {
  let fail = true;
  const good = bound(proposal());
  const m = await mount({ readDetail: () => fail ? Promise.reject(new Error("offline <x>")) : Promise.resolve(good) });
  await m.go(`#/mend?session=${SESSION}&focus=${"4".repeat(16)}`);
  let text = m.host.textContent;
  assert.match(text, /couldn.t load the linked session/i);
  assert.ok(text.includes("offline <x>"));
  assert.doesNotMatch(text, /No reviewed proposal/);
  const retry = tags(m.host, "button").find((b) => /try again/i.test(b.textContent));
  assert.ok(retry);
  fail = false;
  retry.dispatch("click"); await flush(); await flush();
  text = m.host.textContent;
  assert.doesNotMatch(text, /couldn.t load the linked session/i);
  assert.ok(all(m.host).some((n) => n.getAttribute("id") === `idea-${"4".repeat(16)}`));
  const broken = structuredClone(good); broken.numbers.activity_ms = 5;
  const invalid = await mount({ details: [[SESSION, broken]] });
  await invalid.go(`#/mend?session=${SESSION}`);
  assert.match(invalid.host.textContent, /linked session.s record didn.t pass its checks/i);
});

test("a check shows its comparison, uncertainty, measurement state and every limitation", async () => {
  const m = await mount({ learning: learningDoc({ verdict: "confirmed", partial: true, before: 10 }) });
  await m.go("#/mend");
  const card = all(m.host).find((n) => (n.getAttribute("class") || "").includes("check-note"));
  const text = card.textContent;
  assert.match(text, /Helped/);
  assert.match(text, /measurement: partial/i);
  assert.match(text, /Before median: at least 2 hours/);
  assert.match(text, /After median: at least 1 hour/);
  assert.match(text, /after minus before: −1 hour, partly recorded/i);
  assert.match(text, /95% interval: −1 hour 7 minutes to −50 minutes/i);
  assert.match(text, /10 tasks in 6 groups/);
  for (const words of [/capture/i, /shared workers/i, /association/i, /mix of tasks/i, /related measure/i]) assert.match(text, words);
  const none = await mount();
  await none.go("#/mend");
  const t = all(none.host).find((n) => (n.getAttribute("class") || "").includes("check-note")).textContent;
  assert.match(t, /Before median: not recorded/);
  assert.match(t, /interval: not established/i);
  assert.match(t, /no effect estimate/i);
});

test("the shelf puts a real session strip before orientation and the task directory", async () => {
  const { host } = await mount();
  const main = all(host).find((n) => n.getAttribute("id") === "main");
  const text = [];
  let firstSession = null, taskIndex = null, legend = null;
  const walk = (n) => {
    if (!(n instanceof Node)) { text.push(n.textContent); return; }
    if (firstSession === null && n.tagName === "A" && (n.getAttribute("href") || "").startsWith("#/session/")) firstSession = text.join("").length;
    if (taskIndex === null && n.tagName === "H2" && /Tasks on the loom/.test(n.textContent)) taskIndex = text.join("").length;
    if (legend === null && n.tagName === "UL" && n.getAttribute("aria-label") === "Key") legend = text.join("").length;
    n.children.forEach(walk);
  };
  walk(main);
  assert.ok(firstSession !== null && taskIndex !== null);
  assert.ok(firstSession < taskIndex, "a session strip comes before the task directory");
  assert.ok(firstSession < 320, `only a short orientation precedes the first session (${firstSession} characters)`);
  assert.ok(legend !== null && legend < firstSession, "the key sits with the shelf");
});

test("programmatic heading focus is a deliberate mark, not a stock box around the hero", () => {
  const css = read("site/src/loom.css");
  const rule = /\.display:focus-visible\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, "headings keep a visible focus indicator");
  assert.doesNotMatch(rule[1], /outline:\s*3px/);
  assert.match(rule[1], /outline:\s*none/);
  assert.match(rule[1], /text-decoration|box-shadow|border/);
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--focus\)/, "interactive controls keep their ring");
});

async function weaveOf(f) {
  const m = await mount({ details: [[f.session.id, detail(f)]] });
  await m.go(`#/session/${f.session.id}`);
  const num = (n, k) => Number(n.getAttribute(k));
  const hits = all(m.host).filter((n) => /^hit( short)?$/.test(n.getAttribute("class") || ""));
  const axis = all(m.host).find((n) => n.getAttribute("class") === "axis");
  const labels = tags(axis, "text").map((t) => ({ x: num(t, "x"), text: t.textContent })).filter((l) => l.text).sort((a, b) => a.x - b.x);
  const svgNode = all(m.host).find((n) => n.getAttribute("class") === "weave");
  return { m, num, hits, labels, svgNode };
}
const readable = (labels) => labels.every((l, i) => i === 0 || l.x - labels[i - 1].x >= 40);

test("a five-minute session is woven at a readable width with proportional, uncrowded time", async () => {
  const f = facts({ intervals: [span("turn", 0, 60000), span("tool", 0, 120000, { tool: "shell" }), span("tool", 240000, 300000, { tool: "read" })] }, LONE);
  f.session.duration_ms = 300000;
  const { num, hits, labels } = await weaveOf(f);
  assert.equal(hits.length, 1);
  assert.ok(num(hits[0], "width") >= 300, `the whole session is ${num(hits[0], "width")}px wide`);
  const k = num(hits[0], "width") / 300000;
  assert.ok(readable(labels), JSON.stringify(labels));
  assert.equal(labels.at(-1).text, "5 min");
  assert.ok(Math.abs(labels.at(-1).x - 300000 * k) < 1e-6);
  assert.ok(labels.length >= 3, "intermediate elapsed labels mark the minutes");
  for (const l of labels.slice(0, -1)) assert.ok(Math.abs(l.x - k * (/min/.test(l.text) ? Number(l.text.split(" ")[0]) * 60000 : 0)) < 1e-6, l.text);
});

test("a short multi-period session keeps one time scale and a tiny final period stays tiny", async () => {
  const f = facts({ intervals: [span("turn", 0, 1000), span("tool", 2 * HOUR, 2 * HOUR + 30000, { tool: "read" })] }, LONE);
  f.session.duration_ms = 2 * HOUR + 30000;
  const { num, hits, labels, svgNode } = await weaveOf(f);
  assert.equal(hits.length, 3);
  const k = num(hits[0], "width") / HOUR;
  assert.ok((2 * HOUR + 30000) * k >= 300, "the frame is readable");
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(num(hits[i], "x") - i * HOUR * k) < 1e-6);
  assert.equal(hits[2].getAttribute("data-short") === "true", 30000 * k < 12);
  const last = all(svgNode).filter((n) => /\bthread\b/.test(n.getAttribute("class") || "") && num(n, "x") >= 2 * HOUR * k - 1e-6);
  assert.ok(last.length && last.every((t) => num(t, "width") <= 30000 * k + 1e-6));
  assert.ok(readable(labels), JSON.stringify(labels));
  assert.equal(labels.at(-1).text, "2 h 30 s");
});

test("the static entry shows a loading state and a visible, retryable script-load failure", async () => {
  const html = read("site/src/index.html");
  const rootMarkup = /<div id="loom"[^>]*>([\s\S]*?)\n<\/div>/.exec(html)[1];
  assert.match(rootMarkup, /class="loom-boot-pending"[^>]*role="status"[^>]*>[^<]*Loading/);
  const failed = /<div class="loom-boot-failed" role="alert">([\s\S]*?)<\/div>/.exec(rootMarkup);
  assert.ok(failed, "a failure state ships in the static page");
  assert.match(failed[1], /couldn.t load/i);
  assert.match(failed[1], /<button type="button" onclick="location\.reload\(\)">Try again<\/button>/);
  assert.match(failed[1], /href="evidence\.html"/);
  assert.match(failed[1], /href="llms\.txt"/);
  assert.match(rootMarkup, /<noscript>[\s\S]*evidence\.html[\s\S]*<\/noscript>/);
  // Without any stylesheet, only one state is visible: the inline rules decide.
  assert.match(html, /<style>[\s\S]*\.loom-boot-failed \{ display: none; \}[\s\S]*\[data-loom-asset="failed"\] \.loom-boot-failed \{ display: block; \}[\s\S]*\[data-loom-asset="failed"\] \.loom-boot-pending \{ display: none; \}[\s\S]*<\/style>/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"([^>]*)><\/script>/g)];
  assert.equal(scripts.length, 5);
  for (const [, src, rest] of scripts) {
    const handler = /onerror="([^"]+)"/.exec(rest);
    assert.ok(handler, `${src} reports its own load failure`);
    const element = new Node("html");
    runInNewContext(handler[1], { document: { documentElement: element } });
    assert.equal(element.getAttribute("data-loom-asset"), "failed", src);
  }
});

test("boot replaces the static state normally, and leaves the failure state when an asset failed", () => {
  const page = (failed) => {
    const root = new Node("div");
    root.append(new Node("p"));
    const html = new Node("html");
    if (failed) html.setAttribute("data-loom-asset", "failed");
    const fetches = [];
    const win = { location: { hash: "#/", search: "", replace() {} }, addEventListener() {}, matchMedia: () => ({ matches: false }),
      fetch: (path) => { fetches.push(path); return new Promise(() => {}); },
      document: { ...doc, documentElement: html, getElementById: (id) => id === "loom" ? root : null } };
    return { root, win, fetches };
  };
  const ok = page(false);
  loom.boot(ok.win);
  assert.equal(ok.root.children[0].tagName, "A", "the reader replaced the static state");
  assert.match(ok.root.textContent, /Loading the session catalog/);
  assert.ok(ok.fetches.includes("sessions/index.json"));
  const bad = page(true);
  loom.boot(bad.win);
  assert.equal(bad.root.children.length, 1);
  assert.equal(bad.root.children[0].tagName, "P", "the static failure state stays");
  assert.deepEqual(bad.fetches, [], "no partial reader starts without its dependencies");
});

test("a failed or malformed task-name source is visible with a retry, distinct from a task that has no name", async () => {
  for (const [tasks, words] of [
    [Promise.reject(new Error("rollups/tasks.json answered 500")), /rollups\/tasks\.json answered 500/],
    [{ jobs: "nope" }, /malformed/i],
    [{ schema: "x" }, /malformed/i],
  ]) {
    const m = await mount({ tasks });
    const text = m.host.textContent;
    assert.match(text, /task names couldn.t be loaded/i);
    assert.match(text, words);
    assert.ok(attr(m.host, "role", "alert").some((n) => /task names/i.test(n.textContent)));
    assert.doesNotMatch(text, /Unnamed task/, "a failed source is not evidence that tasks are unnamed");
    assert.match(text, new RegExp(`Task ${JOB.slice(0, 8)} \\(name not loaded\\)`));
    const retry = tags(m.host, "button").find((b) => /try again/i.test(b.textContent));
    retry.dispatch("click");
    assert.equal(m.win.location.reloads, 1);
    assert.ok(links(m.host).includes(`#/session/${SESSION}`), "browsing stays available");
  }
  const unnamed = await mount({ tasks: { jobs: [{ job: JOB, name: null }] } });
  assert.match(unnamed.host.textContent, new RegExp(`Unnamed task ${JOB.slice(0, 8)}`));
  assert.doesNotMatch(unnamed.host.textContent, /task names couldn.t be loaded/i);
  const absent = await mount({ tasks: null });
  assert.doesNotMatch(absent.host.textContent, /task names couldn.t be loaded|Unnamed task/i);
  assert.match(absent.host.textContent, /task names aren.t published in this build/i);
  assert.doesNotMatch(read("site/src/loom.js"), /optional\("rollups\/tasks\.json"\)\.catch/, "boot no longer swallows name-source failures");
});

const SECOND = "6e2f4a81-bd40-4f51-ac6d-4e5f6a7b8c93";
const snapshotFacts = (id, rev, state, returns) => facts({ jobs: [binding()], outcomes: [{ job: JOB, rev, state, returns }] }, id);
const snapshotDetail = (f) => detail(f, { jobs: [{ id: JOB, status: "done" }], contexts: new Map([[JOB, projection()]]) });

test("a session's task outcome reads as that session's recorded snapshot, apart from this build's status", async () => {
  for (const [rev, words] of [[3, /revision 3/], [null, /revision not recorded/]]) {
    const f = snapshotFacts(SESSION, rev, "not_delivered", [{ caught: "at_review", counts: true }]);
    const m = await mount({ details: [[SESSION, snapshotDetail(f)]] });
    await m.go(`#/session/${SESSION}`);
    const text = m.host.textContent;
    assert.match(text, words);
    assert.match(text, /as this session recorded it/i);
    assert.match(text, /not the current or complete/i);
    assert.match(text, /this build.s task summary/i);
    assert.doesNotMatch(text, /When this was built, the task was|For the whole task, as recorded:/);
  }
});

test("the task shelf prefers the highest known revision among loaded snapshots and names its source", async () => {
  const older = snapshotFacts(SESSION, 3, "not_delivered", [{ caught: "at_review", counts: true }]);
  const newer = snapshotFacts(SECOND, 11, "accepted", [{ caught: "at_review", counts: true }, { caught: "after_delivery", counts: true }, { caught: "in_task", counts: true }]);
  const list = [older, newer];
  const m = await mount({ catalog: catalogOf(list), readDetail: (id) => Promise.resolve(snapshotDetail(list.find((f) => f.session.id === id))) });
  await m.go(`#/sessions?task=${JOB}`);
  let text = m.host.textContent;
  assert.match(text, /revision 11/);
  assert.match(text, /accepted/);
  assert.ok(text.includes(SECOND.slice(0, 8)), "the snapshot names its recording session");
  assert.match(text, /2 of 2 session records loaded/);
  assert.doesNotMatch(text, /not handed over yet/);
  assert.match(text, /this build.s task summary/i);

  const unknown = [snapshotFacts(SESSION, null, "accepted", []), snapshotFacts(SECOND, null, "refused", [])];
  const u = await mount({ catalog: catalogOf(unknown), readDetail: (id) => Promise.resolve(snapshotDetail(unknown.find((f) => f.session.id === id))) });
  await u.go(`#/sessions?task=${JOB}`);
  text = u.host.textContent;
  assert.match(text, /no loaded snapshot records its revision/i);
  assert.match(text, /not necessarily the latest/i);
});
