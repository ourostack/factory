import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { projection, JOB, SESSION } from "./fixtures/task-context.mjs";

const require = createRequire(import.meta.url);
const builders = await import("../../../site/scripts/session-intelligence.mjs").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const validators = (() => {
  try { return require("../../../site/src/session-data.js"); }
  catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return {};
    throw error;
  }
})();
const HOUR = 3600000;
const OTHER_JOB = "c".repeat(32);
const sources = { desk: "a".repeat(40), facts: "b".repeat(40), reports: "unavailable" };
const measured = (value) => ({ state: "measured", value, reasons: [] });
const missing = (reason) => ({ state: "unavailable", reasons: [reason] });
const span = (kind, start_ms, end_ms, extra = {}) => ({ kind, agent: 0, start_ms, end_ms, ...extra });
function facts(over = {}) {
  return {
    schema: "desk.factory.published/2",
    session: { id: SESSION, host: "copilot-cli", ended: true, duration_ms: HOUR + 1000 },
    models: [{ id: "recorded-model", requests: 1 }],
    agents: [{ n: 0, parent: null, model: "recorded-model" }, { n: 1, parent: 0, model: "worker-model" }],
    intervals: [
      span("turn", 0, 1000), span("tool", 500, 1500, { tool: "shell" }),
      span("subagent", 1000, 2000, { agent: 1 }),
      span("human_wait", 1200, 2500), span("human_wait", 100, 800, { agent: 1 }),
      span("tool", HOUR - 500, HOUR + 1000, { tool: "read" }),
    ],
    counts: { tool_calls: { shell: 1, read: 1 }, tool_failures: {}, tool_retries: 0, compactions: 1 },
    jobs: [],
    outcomes: [],
    unavailable: [],
    ...over,
  };
}
function detail(input = facts(), options = {}) {
  assert.equal(typeof builders.buildSessionDetail, "function", "detail builder exists");
  return builders.buildSessionDetail({ facts: input, contexts: new Map(), jobs: [], sources, ...options });
}
function catalog(input = [facts()]) {
  assert.equal(typeof builders.buildSessionCatalog, "function", "catalog builder exists");
  return builders.buildSessionCatalog({ facts: input, sources });
}
function binding(job = JOB, start_ms = 0, end_ms = 1000) {
  return { job, agents: [0], segments: [{ start_ms, end_ms }], session_offset_ms: 10000 };
}

test("overlapping turns, calls and children count once; root stops remain a separate overlapping union", () => {
  const d = detail();
  assert.deepEqual(d.numbers.activity_ms, measured(3500));
  assert.deepEqual(d.numbers.stop_ms, measured(1300));
  assert.deepEqual(d.numbers.tool_calls, measured(2));
  assert.deepEqual(d.numbers.tool_failures, measured(0));
  assert.deepEqual(d.numbers.tool_retries, measured(0));
  assert.deepEqual(d.numbers.compactions, measured(1));
  assert.deepEqual(d.workers.items, facts().agents);
  assert.equal(validators.validateSessionDetail(d).ok, true);
});

test("hour bins use union coverage, preserve the final partial width, and do not invent business stages", () => {
  const d = detail();
  assert.deepEqual(d.bins.resolution_ms, measured(HOUR));
  assert.equal(d.bins.rows.length, 2);
  const [first, last] = d.bins.rows;
  assert.equal(first.start_ms, 0);
  assert.equal(first.end_ms, HOUR);
  assert.deepEqual(first.commands, measured(1000));
  assert.deepEqual(first.helpers, measured(1000));
  assert.deepEqual(first.stops, measured(1300));
  assert.deepEqual(first.captured, measured(3000));
  assert.equal(last.start_ms, HOUR);
  assert.equal(last.end_ms, HOUR + 1000);
  assert.deepEqual(last.reading, measured(1000));
  assert.deepEqual(last.captured, measured(1000));
  assert.deepEqual(last.writing, measured(0));
});

test("bins widen only to whole hours and never exceed 96 rows", () => {
  for (const [duration, resolution, count] of [[96 * HOUR, HOUR, 96], [96 * HOUR + 1, 2 * HOUR, 49], [201 * HOUR, 3 * HOUR, 67]]) {
    const f = facts(); f.session.duration_ms = duration;
    const d = detail(f);
    assert.deepEqual(d.bins.resolution_ms, measured(resolution));
    assert.equal(d.bins.rows.length, count);
    assert.equal(d.bins.rows.at(-1).end_ms, duration);
    assert.equal(validators.validateSessionDetail(d).ok, true);
  }
});

test("call categories use recorded kinds and keep unfamiliar calls in other", () => {
  const f = facts({ intervals: [
    span("tool", 0, 100, { tool: "shell" }), span("tool", 50, 150, { tool: "shell" }),
    span("tool", 0, 200, { tool: "read" }), span("tool", 0, 300, { tool: "edit" }),
    span("tool", 0, 400, { tool: "agent" }), span("tool", 0, 500, { tool: "skill" }),
    span("tool", 0, 600, { tool: "new-kind" }),
  ] });
  const row = detail(f).bins.rows[0];
  assert.deepEqual(Object.fromEntries(["commands", "reading", "writing", "helpers", "notes", "other", "captured"].map((key) => [key, row[key].value])),
    { commands: 150, reading: 200, writing: 300, helpers: 400, notes: 500, other: 600, captured: 600 });
});

test("absent or empty intervals are unavailable, never measured zero activity or stops", () => {
  for (const intervals of [undefined, null, []]) {
    const d = detail(facts({ intervals }));
    assert.deepEqual(d.numbers.activity_ms, missing("no_intervals"));
    assert.deepEqual(d.numbers.stop_ms, missing("no_intervals"));
    for (const row of d.bins.rows) for (const key of ["commands", "reading", "writing", "helpers", "notes", "other", "stops", "captured"]) {
      assert.deepEqual(row[key], missing("no_intervals"));
    }
  }
});

test("withholding and incomplete capture retain reasons instead of successful zero fallbacks", () => {
  const hidden = detail(facts({ unavailable: [{ field: "intervals", reason: "withheld_public" }, { field: "models", reason: "withheld_public" }] }));
  assert.deepEqual(hidden.session.models, []);
  assert.deepEqual(hidden.numbers.activity_ms, missing("withheld_public"));
  assert.deepEqual(hidden.bins.rows[0].commands, missing("withheld_public"));
  const partial = detail(facts({ unavailable: [{ field: "tool_durations", reason: "log_truncated" }] }));
  assert.deepEqual(partial.numbers.activity_ms, { state: "partial", value: 3500, reasons: ["log_truncated"], bound: "lower" });
  assert.equal(partial.bins.rows[0].captured.state, "partial");
  const absent = detail(facts({ intervals: [], unavailable: [{ field: "turns", reason: "source_unreadable" }] }));
  assert.ok(absent.numbers.activity_ms.reasons.includes("source_unreadable"));
  const counts = detail(facts({ unavailable: [{ field: "tool_calls", reason: "withheld_public" }, { field: "compactions", reason: "field_absent" }] }));
  assert.deepEqual(counts.numbers.tool_calls, missing("withheld_public"));
  assert.deepEqual(counts.numbers.compactions, missing("field_absent"));
});

test("host outcome limits remain partial and worker absence cannot identify root stops", () => {
  const f = facts(); f.session.host = "codex-cli";
  assert.deepEqual(detail(f).numbers.tool_failures, { state: "partial", value: 0, reasons: ["host_records_partly"], bound: "lower" });
  const d = detail(facts({ agents: undefined }));
  assert.deepEqual(d.workers, { state: "unavailable", reasons: ["not_recorded"], items: [] });
  assert.equal(d.numbers.stop_ms.state, "unavailable");
});

test("missing duration prevents a guessed bin grid and malformed available measurements fail explicitly", () => {
  const f = facts(); f.session.duration_ms = null;
  const d = detail(f);
  assert.deepEqual(d.numbers.duration_ms, missing("not_recorded"));
  assert.equal(d.bins.resolution_ms.state, "unavailable");
  assert.deepEqual(d.bins.rows, []);
  for (const mutate of [
    (f) => { f.session.id = "../private"; },
    (f) => { f.session.duration_ms = Infinity; },
    (f) => { f.intervals[0].start_ms = NaN; },
    (f) => { f.intervals[0].end_ms = f.session.duration_ms + 1; },
    (f) => { f.counts.tool_calls.shell = "2"; },
    (f) => { f.counts.tool_retries = -1; },
    (f) => { f.agents[1].parent = -1; },
    (f) => { f.jobs = [binding("../private")]; },
  ]) {
    const input = facts(); mutate(input);
    assert.throws(() => detail(input), /session_/);
  }
});

test("all published sessions remain discoverable without labels, bindings, or report timelines", () => {
  const small = facts({ intervals: [], models: [], agents: [] }); small.session.duration_ms = 5;
  const c = catalog([small]);
  assert.equal(c.schema, "factory-session-catalog/1");
  assert.equal(c.sessions.length, 1);
  assert.deepEqual(c.sessions[0], {
    id: SESSION, host: "copilot-cli", ended: true, models: [], jobs: [],
    duration_ms: measured(5), activity_ms: missing("no_intervals"), detail: `sessions/${SESSION}.json`,
  });
  assert.equal(validators.validateSessionCatalog(c).ok, true);
  assert.throws(() => catalog([small, small]), /session_/);
});

test("explicit task shares do not change whole-session totals or imply session-caused task outcomes", () => {
  const f = facts({ jobs: [binding(), binding(OTHER_JOB, 2000, 2500)], outcomes: [
    { job: JOB, state: "accepted", returns: [{ caught: "at_review", counts: true }] },
  ] });
  const d = detail(f, { jobs: [{ id: JOB, status: "done" }], contexts: new Map([[JOB, projection()]]) });
  assert.deepEqual(d.numbers.activity_ms, measured(3500));
  assert.deepEqual(d.bindings.items[0], { job: JOB, agents: { state: "measured", reasons: [], items: [0] },
    segments: { state: "measured", reasons: [], items: [{ start_ms: 0, end_ms: 1000 }] } });
  assert.deepEqual(d.contexts[0], projection());
  assert.equal(d.contexts[1].availability, "unavailable");
  assert.equal(d.contexts[1].reason, "not_published");
  assert.deepEqual(d.outcomes[0], { job: JOB, scope: "task", snapshot: { session: SESSION, rev: null },
    status: measured("done"), state: measured("accepted"),
    returns: { state: "measured", reasons: [], items: [{ caught: "at_review", counts: true }] } });
  assert.equal(d.outcomes[1].state.state, "unavailable");
  assert.equal(validators.validateSessionDetail(d).ok, true);
  const noShare = detail(facts({ jobs: [{ job: JOB }] }));
  assert.equal(noShare.bindings.items[0].segments.state, "unavailable");
});

test("only checked contexts for explicit bindings are included and unavailable reasons survive", () => {
  const withheld = { schema: "factory-task-context/1", job: JOB, availability: "withheld", reason: "review_pending", record: null, placements: [] };
  const d = detail(facts({ jobs: [binding()] }), { contexts: new Map([[JOB, withheld], [OTHER_JOB, projection(OTHER_JOB)]]) });
  assert.deepEqual(d.contexts, [withheld]);
  const bad = projection(); bad.record.events[0].explanation = "Private /Users/name";
  assert.throws(() => detail(facts({ jobs: [binding()] }), { contexts: new Map([[JOB, bad]]) }), /session_/);
});

test("closed detail validation rejects bare or nonfinite numbers, unknown fields and impossible bins", () => {
  for (const mutate of [
    (d) => { d.private = "no"; },
    (d) => { d.sources.extra = "no"; },
    (d) => { d.session.models.push(1); },
    (d) => { d.numbers.activity_ms = 0; },
    (d) => { d.numbers.activity_ms.value = NaN; },
    (d) => { d.numbers.activity_ms.extra = 3; },
    (d) => { d.bins.resolution_ms.value = 1; },
    (d) => { d.bins.rows[0].start_ms = -1; },
    (d) => { d.bins.rows[0].end_ms = Infinity; },
    (d) => { d.bins.rows[0].captured.value = HOUR + 1; },
    (d) => { d.bins.rows[1].start_ms += 1; },
    (d) => { d.bins.rows[1].end_ms += 1; },
    (d) => { d.bins.rows[0].phase = "value"; },
    (d) => { d.workers.items[0].n = 0.5; },
    (d) => { d.workers.items[0].parent = -1; },
    (d) => { d.workers.items[0].model = 10; },
    (d) => { d.contexts.push(projection()); },
  ]) {
    const d = detail(); mutate(d);
    assert.deepEqual(validators.validateSessionDetail(d), { ok: false, codes: ["invalid_session_detail"] });
  }
  const bound = facts({ jobs: [binding()] });
  for (const mutate of [
    (d) => { d.bindings.items[0].segments.items[0].end_ms = HOUR + 1001; },
    (d) => { d.bindings.items[0].agents.items[0] = NaN; },
    (d) => { d.outcomes[0].scope = "session"; },
    (d) => { d.outcomes[0].returns = { state: "measured", reasons: [], items: [{ caught: "invented" }] }; },
  ]) {
    const d = detail(bound); mutate(d);
    assert.equal(validators.validateSessionDetail(d).ok, false);
  }
});

test("closed catalog validation refuses unsafe IDs, extra fields and unstated measurements", () => {
  for (const mutate of [
    (c) => { c.sources.facts = "branch-name"; },
    (c) => { c.sessions[0].id = "short"; },
    (c) => { c.sessions[0].detail = "../private.json"; },
    (c) => { c.sessions[0].jobs = ["short"]; },
    (c) => { c.sessions[0].duration_ms = 0; },
    (c) => { c.sessions[0].duration_ms.value = Infinity; },
    (c) => { c.sessions[0].activity_ms = { state: "unavailable", reasons: ["not_recorded"], value: 0 }; },
    (c) => { c.sessions[0].extra = 0; },
  ]) {
    const c = catalog(); mutate(c);
    assert.deepEqual(validators.validateSessionCatalog(c), { ok: false, codes: ["invalid_session_catalog"] });
  }
});

test("browser and CommonJS validators agree without a Node dependency", () => {
  assert.equal(typeof validators.validateSessionDetail, "function");
  const browser = {};
  runInNewContext(readFileSync(new URL("../../../site/src/task-context.js", import.meta.url), "utf8"), browser);
  runInNewContext(readFileSync(new URL("../../../site/src/session-data.js", import.meta.url), "utf8"), browser);
  assert.equal(browser.FactorySessionData.validateSessionDetail(detail()).ok, true);
  assert.equal(browser.FactorySessionData.validateSessionCatalog(catalog()).ok, true);
});

test("recorded self-parent worker references are retained without guessing a repaired tree", () => {
  const f = facts(); f.agents[1].parent = 1;
  assert.deepEqual(detail(f).workers.items, f.agents);
});

test("model withholding also withholds worker model identifiers", () => {
  const d = detail(facts({ unavailable: [{ field: "models", reason: "withheld_public" }] }));
  assert.deepEqual(d.session.models, []);
  assert.ok(d.workers.items.every((worker) => worker.model === null));
});

test("a stop without a recorded worker cannot become a measured zero root-stop total", () => {
  const f = facts();
  delete f.intervals[3].agent;
  const d = detail(f);
  assert.deepEqual(d.numbers.stop_ms, missing("not_recorded"));
  assert.deepEqual(d.bins.rows[0].stops, missing("not_recorded"));
  assert.deepEqual(d.numbers.activity_ms, measured(3500));
});

test("malformed capture flags fail rather than disappearing from measurements", () => {
  for (const unavailable of [{}, [null], [{ field: "turns" }], [{ field: "turns", reason: 7 }]]) {
    assert.throws(() => detail(facts({ unavailable })), /session_/);
  }
});

test("task outcome snapshots retain their recording session and lifecycle revision", () => {
  const first = facts({ jobs: [binding()], outcomes: [
    { job: JOB, rev: 3, state: "not_delivered", returns: [{ caught: "at_review", counts: true }] },
  ] });
  const secondId = "22222222-2222-4222-8222-222222222222";
  const second = facts({ session: { ...first.session, id: secondId }, jobs: [binding()], outcomes: [
    { job: JOB, rev: 11, state: "accepted", returns: [
      { caught: "at_review", counts: true }, { caught: "after_delivery", counts: true },
    ] },
  ] });
  const options = { jobs: [{ id: JOB, status: "done" }] };
  const old = detail(first, options).outcomes[0], newer = detail(second, options).outcomes[0];
  assert.deepEqual(old.snapshot, { session: SESSION, rev: 3 });
  assert.deepEqual(newer.snapshot, { session: secondId, rev: 11 });
  assert.equal(old.state.value, "not_delivered");
  assert.equal(newer.state.value, "accepted");
  assert.equal(old.returns.items.length, 1);
  assert.equal(newer.returns.items.length, 2);
});

test("outcome snapshot validation keeps missing revisions unknown and rejects foreign or malformed identity", () => {
  const d = detail(facts({ jobs: [binding()], outcomes: [{ job: JOB, state: "accepted", returns: [] }] }));
  assert.deepEqual(d.outcomes[0].snapshot, { session: SESSION, rev: null });
  assert.equal(validators.validateSessionDetail(d).ok, true);
  for (const snapshot of [
    { session: "22222222-2222-4222-8222-222222222222", rev: 3 },
    { session: SESSION, rev: -1 }, { session: SESSION, rev: 1.5 },
    { session: SESSION, rev: "3" }, { session: SESSION, rev: 3, current: true },
  ]) {
    const changed = structuredClone(d);
    changed.outcomes[0].snapshot = snapshot;
    assert.equal(validators.validateSessionDetail(changed).ok, false, JSON.stringify(snapshot));
  }
});

test("outcome snapshots refuse malformed recorded revisions rather than silently dropping them", () => {
  for (const rev of [-1, 1.5, "3", Infinity]) {
    assert.throws(() => detail(facts({ jobs: [binding()], outcomes: [
      { job: JOB, rev, state: "accepted", returns: [] },
    ] })), /session_detail_invalid/);
  }
});

test("return stages retain the recorded counting decision without attributing them to this session", () => {
  const f = facts({ jobs: [binding()], outcomes: [{ job: JOB, state: "refused",
    returns: [{ caught: "after_delivery", counts: false }, { caught: "at_review", counts: true }] }] });
  const d = detail(f);
  assert.deepEqual(d.outcomes[0].returns.items, [
    { caught: "after_delivery", counts: false }, { caught: "at_review", counts: true },
  ]);
  assert.equal(d.outcomes[0].scope, "task");
  d.outcomes[0].returns.items[0].counts = 0;
  assert.equal(validators.validateSessionDetail(d).ok, false);
});

test("human-wait capture flags affect stop totals and bins without changing activity", () => {
  for (const wait of [[], [span("human_wait", 1000, 2000)]]) {
    const intervals = [span("turn", 0, 1500), ...wait];
    const before = detail(facts({ intervals }));
    for (const reason of ["field_absent", "source_unreadable", "log_truncated", "withheld_public",
      "host_records_partly", "interval_outside_session_clock"]) {
      const d = detail(facts({ intervals, unavailable: [{ field: "human_waits", reason }] }));
      const partly = ["host_records_partly", "interval_outside_session_clock"].includes(reason);
      const expected = partly
        ? { state: "partial", value: wait.length ? 1000 : 0, reasons: [reason], bound: "lower" }
        : missing(reason);
      assert.deepEqual(d.numbers.stop_ms, expected, reason);
      assert.deepEqual(d.bins.rows[0].stops, expected, reason);
      assert.deepEqual(d.bins.rows[1].stops, partly ? { ...expected, value: 0 } : expected, reason);
      assert.deepEqual(d.numbers.activity_ms, measured(1500));
      assert.deepEqual(d.bins.rows[0].commands, before.bins.rows[0].commands);
      assert.equal(validators.validateSessionDetail(d).ok, true);
    }
  }
});

test("truncated or unreadable task returns retain readable entries without claiming complete history", () => {
  for (const markers of [{ returns_truncated: true }, { returns_unreadable: 2 },
    { returns_truncated: true, returns_unreadable: 1 }]) {
    for (const returns of [[], [{ caught: "at_review", counts: true }], undefined]) {
      const d = detail(facts({ jobs: [binding()], outcomes: [{ job: JOB, state: "accepted", returns, ...markers }] }));
      assert.deepEqual(d.outcomes[0].returns, {
        state: returns === undefined ? "unavailable" : "partial",
        reasons: ["returns_not_fully_recorded"], items: returns ?? [],
      });
      assert.deepEqual(d.outcomes[0].state, measured("accepted"));
      assert.equal(validators.validateSessionDetail(d).ok, true);
    }
  }
});

test("available return completeness markers must match the published boolean and positive-count shapes", () => {
  for (const markers of [{ returns_truncated: false }, { returns_truncated: "true" },
    { returns_unreadable: 0 }, { returns_unreadable: -1 }, { returns_unreadable: 1.5 },
    { returns_unreadable: 10000 }, { returns_unreadable: Infinity }]) {
    assert.throws(() => detail(facts({ jobs: [binding()], outcomes: [
      { job: JOB, state: "accepted", returns: [], ...markers },
    ] })), /session_/);
  }
});

test("protected task shares retain desk_public without confusing task-clock failures with share failures", () => {
  for (const segments of [undefined, [{ start_ms: 0, end_ms: 1000 }]]) {
    const d = detail(facts({ jobs: [{ job: JOB, agents: [0], segments }],
      unavailable: [{ field: "job_offsets", reason: "desk_public" }] }));
    assert.deepEqual(d.bindings.items[0].segments, { state: "unavailable", reasons: ["desk_public"], items: [] });
    assert.deepEqual(d.numbers.activity_ms, measured(3500));
    assert.equal(validators.validateSessionDetail(d).ok, true);
  }
  for (const reason of ["source_unreadable", "field_absent", "interval_outside_session_clock"]) {
    const f = facts({ jobs: [binding()], unavailable: [{ field: "job_offsets", reason }] });
    assert.deepEqual(detail(f).bindings.items[0].segments,
      { state: "measured", reasons: [], items: [{ start_ms: 0, end_ms: 1000 }] });
    delete f.jobs[0].segments;
    assert.deepEqual(detail(f).bindings.items[0].segments, { state: "unavailable", reasons: ["not_recorded"], items: [] });
  }
});

// Run the real build in its own process with fixture I/O held entirely in
// memory. No temporary directories, cleanup, Git mutation or network calls.
async function memoryBuild(files) {
  const fs = (await import("node:fs")).default;
  const cp = (await import("node:child_process")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const { resolve, dirname } = await import("node:path");
  const root = resolve(".session-test-memory");
  const entries = new Map(Object.entries(files).map(([key, value]) => [resolve(root, key), JSON.stringify(value)]));
  const output = new Map();
  const inside = (path) => typeof path === "string" && path.startsWith(`${root}/`);
  const read = fs.readFileSync;
  const exists = fs.existsSync;
  const stat = fs.lstatSync;
  const ls = fs.readdirSync;
  const isDir = (path) => [...entries.keys()].some((key) => key.startsWith(`${path}/`));
  fs.readFileSync = (path, encoding) => {
    if (!inside(path)) return read(path, encoding);
    if (!entries.has(path)) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return encoding ? entries.get(path) : Buffer.from(entries.get(path));
  };
  fs.existsSync = (path) => inside(path) ? entries.has(path) || isDir(path) : exists(path);
  fs.lstatSync = (path, options) => inside(path) ? entries.has(path) || isDir(path) ? {
    isDirectory: () => isDir(path), isFile: () => entries.has(path), isSymbolicLink: () => false,
    nlink: 1, size: entries.get(path)?.length ?? 0,
  } : undefined : stat(path, options);
  fs.readdirSync = (path, options) => inside(path)
    ? [...new Set([...entries.keys()].filter((key) => dirname(key) === path).map((key) => key.slice(path.length + 1)))]
    : ls(path, options);
  fs.mkdirSync = (path) => { if (!inside(path)) throw new Error("test write outside memory"); };
  fs.writeFileSync = (path, value) => {
    if (!inside(path)) throw new Error("test write outside memory");
    output.set(path.slice(root.length + 1), JSON.parse(value));
  };
  cp.execFileSync = (command, args) => {
    if (command !== "git") throw new Error("test forbids subprocess side effects");
    return args.includes("rev-parse") ? "a".repeat(40) : "";
  };
  syncBuiltinESMExports();
  process.env.FACTORY_SITE_OFFLINE = "1";
  process.env.GITHUB_TOKEN = "";
  process.env.GH_TOKEN = "";
  process.argv = [process.execPath, resolve("site/scripts/build-data.mjs"), "--reports", `${root}/reports`,
    "--main", `${root}/main`, "--out", `${root}/dist/data.json`];
  try {
    await import(process.argv[1]);
    console.log("MEMORY_RESULT=" + JSON.stringify({ output: Object.fromEntries(output) }));
  } catch (error) {
    console.log("MEMORY_RESULT=" + JSON.stringify({ error: error.message, output: Object.fromEntries(output) }));
  }
}
function build(input) {
  const files = { "main/facts/one.json": input, "reports/rollups/coverage.json": { sessions_with_facts: 1, jobs: 0, jobs_open: 0 } };
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await (${memoryBuild})(${JSON.stringify(files)})`], {
    encoding: "utf8", cwd: new URL("../../../", import.meta.url),
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const line = result.stdout.split("\n").find((line) => line.startsWith("MEMORY_RESULT="));
  assert.ok(line, result.stderr + result.stdout);
  return JSON.parse(line.slice("MEMORY_RESULT=".length));
}
test("the ordinary build publishes every checked session without expanding legacy timeline data", () => {
  const result = build(facts());
  assert.equal(result.error, undefined);
  assert.ok(result.output["dist/sessions/index.json"], "catalog must be written");
  assert.ok(result.output[`dist/sessions/${SESSION}.json`], "detail must be written");
  assert.equal(validators.validateSessionCatalog(result.output["dist/sessions/index.json"]).ok, true);
  assert.equal(validators.validateSessionDetail(result.output[`dist/sessions/${SESSION}.json`]).ok, true);
  assert.deepEqual(result.output["dist/data.json"].sessions, []);
});
test("the ordinary build validates every detail before writing any new projection", () => {
  const f = facts(); f.agents[1].n = -1;
  const result = build(f);
  assert.match(result.error ?? "", /session_/);
  assert.deepEqual(Object.keys(result.output).filter((key) => key.startsWith("dist/sessions/")), []);
});
