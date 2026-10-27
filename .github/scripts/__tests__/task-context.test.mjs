import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { publishData } from "../../../site/scripts/publish-files.mjs";
import { checkNumbers } from "../../../site/scripts/check-numbers.mjs";
import { JOB, SESSION, projection, record } from "./fixtures/task-context.mjs";
const require = createRequire(import.meta.url);
const adapter = await import("../../../site/scripts/task-context.mjs").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const module = (() => { try { return require("../../../site/src/task-context.js"); } catch (error) {
  if (error.code === "MODULE_NOT_FOUND") return {};
  throw error;
} })();
const facts = [{ session: { id: SESSION, duration_ms: 6000 }, jobs: [{ job: JOB, session_offset_ms: 10000 }] }];
const validators = {
  validateContextBytes: () => ({ ok: true }),
  checkContextAgainstFacts: (_record, actual) => { assert.equal(actual, facts); return { ok: true }; },
};
test("the projection rechecks current public evidence and places only recorded anchors, without accounting", () => {
  assert.equal(typeof adapter.projectTaskContext, "function");
  const input = record(), before = JSON.stringify(facts);
  const doc = adapter.projectTaskContext({ job: JOB, bytes: JSON.stringify(input), facts, ...validators });
  assert.deepEqual(doc, projection());
  assert.equal(JSON.stringify(facts), before);
  assert.deepEqual(doc.record, input);
  assert.equal(module.validateTaskContext(doc).ok, true);
  assert.deepEqual(module.contextSummary(doc), { availability: "published", heading: input.heading, reason: null });
});
test("stale, malformed, absent or foreign context cannot leak its old wording", () => {
  assert.equal(typeof adapter.projectTaskContext, "function");
  for (const over of [
    { bytes: null },
    { validateContextBytes: () => ({ ok: false }) },
    { checkContextAgainstFacts: () => ({ ok: false, errors: [{ code: "source_changed", path: "PRIVATE" }] }) },
    { bytes: JSON.stringify(record("c".repeat(32))) },
  ]) {
    const doc = adapter.projectTaskContext({ job: JOB, bytes: JSON.stringify(record()), facts, ...validators, ...over });
    assert.equal(doc.availability, "unavailable");
    assert.equal(doc.record, null);
    assert.deepEqual(doc.placements, []);
    assert.ok(!JSON.stringify(doc).includes("PRIVATE"));
    assert.ok(!JSON.stringify(doc).includes("software"));
  }
});
test("withheld and unavailable are explicit, and an unknown clock never gets a guessed placement", () => {
  for (const availability of ["withheld", "unavailable"]) {
    const value = record(); value.state = availability; value.heading = null; value.events = [];
    value.coverage = { state: "unavailable", reasons: [availability === "withheld" ? "withheld" : "not_recorded"], omitted_events: 0 };
    const doc = adapter.projectTaskContext({ job: JOB, bytes: JSON.stringify(value), facts, ...validators });
    assert.equal(doc.availability, availability);
    assert.equal(module.validateTaskContext(doc).ok, true);
  }
  const unplaced = structuredClone(facts); unplaced[0].jobs[0].session_offset_ms = null;
  const value = record(); value.coverage = { state: "partial", reasons: ["unplaced"], omitted_events: 0 };
  const doc = adapter.projectTaskContext({ job: JOB, bytes: JSON.stringify(value), facts: unplaced, ...validators, checkContextAgainstFacts: () => ({ ok: true }) });
  assert.ok(doc.placements.every((entry) => entry.spans.every((span) => span.start_ms === null && span.end_ms === null)));
});
test("the browser refuses malformed/unsafe story envelopes rather than rendering their prose", () => {
  assert.equal(typeof module.validateTaskContext, "function");
  for (const edit of [
    (doc) => { doc.record.events[0].explanation = "Private path /Users/hidden"; },
    (doc) => { doc.record.privacy = null; },
    (doc) => { doc.record.job = "d".repeat(32); },
    (doc) => { doc.placements[0].spans[0].session = "foreign"; },
    (doc) => { doc.record.events[0].unreviewed = "PRIVATE"; },
    (doc) => { doc.availability = "unavailable"; },
  ]) {
    const doc = projection(); edit(doc);
    assert.equal(module.validateTaskContext(doc).ok, false);
  }
});

function recommendationProjection() {
  const doc = projection();
  doc.record.schema = "desk.factory.context/2";
  doc.record.recommendations = [{
    id: "fedcba9876543210",
    observations: [doc.record.events[0].id],
    problem: "The behavior was not checked through the actual connection.",
    change: "Verify the requested behavior through the actual connection.",
    hypothesis: "A direct check may catch a mismatch before handover.",
    check: "Compare the observed behavior with the requested result.",
    confidence: "medium",
  }];
  return doc;
}

test("the checked context projection preserves reviewed recommendations without changing placements", () => {
  const doc = recommendationProjection();
  assert.equal(module.validateTaskContext(doc).ok, true);
  const projected = adapter.projectTaskContext({ job: JOB, bytes: JSON.stringify(doc.record), facts, ...validators });
  assert.deepEqual(projected.record.recommendations, doc.record.recommendations);
  assert.deepEqual(projected.placements, projection().placements);
  assert.deepEqual(module.contextSummary(projected), module.contextSummary(projection()));
});

test("the browser keeps recommendation references, prose, authority and coverage closed", () => {
  assert.equal(module.validateTaskContext(recommendationProjection()).ok, true);
  for (const edit of [
    (doc) => { delete doc.record.recommendations; },
    (doc) => { doc.record.recommendations[0].observations = []; },
    (doc) => { doc.record.recommendations[0].observations = ["ffffffffffffffff"]; },
    (doc) => { doc.record.recommendations[0].observations.push(doc.record.events[0].id); },
    (doc) => { doc.record.recommendations.push(structuredClone(doc.record.recommendations[0])); },
    (doc) => { doc.record.recommendations[0].change = null; },
    (doc) => { doc.record.recommendations[0].change = "See /Users/private"; },
    (doc) => { doc.record.recommendations[0].hypothesis = "x".repeat(161); },
    (doc) => { doc.record.recommendations[0].shipped = true; },
    (doc) => { doc.record.recommendations[0].confidence = "certain"; },
    (doc) => { doc.record.schema = "desk.factory.context/3"; },
  ]) {
    const doc = recommendationProjection();
    edit(doc);
    assert.equal(module.validateTaskContext(doc).ok, false);
  }
  const legacy = projection();
  legacy.record.recommendations = [];
  assert.equal(module.validateTaskContext(legacy).ok, false);
});

test("withheld and unavailable records cannot retain recommendation prose or bypass review", () => {
  assert.equal(module.validateTaskContext(recommendationProjection()).ok, true);
  for (const state of ["withheld", "unavailable"]) {
    const doc = recommendationProjection();
    doc.availability = doc.record.state = state;
    doc.record.heading = null;
    doc.record.events = [];
    doc.placements = [];
    doc.record.coverage = { state: "unavailable", reasons: [state === "withheld" ? "withheld" : "not_recorded"], omitted_events: 0 };
    assert.equal(module.validateTaskContext(doc).ok, false);
    doc.record.recommendations = [];
    assert.equal(module.validateTaskContext(doc).ok, true);
    doc.record.privacy.verdict = "not_required";
    doc.record.privacy.reviewer = null;
    assert.equal(module.validateTaskContext(doc).ok, true);
    doc.record.recommendations = recommendationProjection().record.recommendations;
    assert.equal(module.validateTaskContext(doc).ok, false);
  }
});

test("the browser accepts the bounded recommendation lists and rejects either overflow", () => {
  const doc = recommendationProjection();
  const event = doc.record.events[0], placement = doc.placements[0];
  doc.record.events = Array.from({ length: 9 }, (_, i) => ({ ...structuredClone(event), id: i.toString(16).padStart(16, "0") }));
  doc.placements = doc.record.events.map((event) => ({ event: event.id, spans: structuredClone(placement.spans) }));
  doc.record.recommendations = Array.from({ length: 8 }, (_, i) => ({
    ...structuredClone(doc.record.recommendations[0]),
    id: (i + 16).toString(16).padStart(16, "0"),
    observations: doc.record.events.slice(0, 8).map((event) => event.id),
  }));
  assert.equal(module.validateTaskContext(doc).ok, true);
  doc.record.recommendations.push({ ...structuredClone(doc.record.recommendations[0]), id: "eeeeeeeeeeeeeeee" });
  assert.equal(module.validateTaskContext(doc).ok, false);
  doc.record.recommendations.pop();
  doc.record.recommendations[0].observations.push(doc.record.events[8].id);
  assert.equal(module.validateTaskContext(doc).ok, false);
});

test("publication registers checked context and strips obsolete wording from full report copies", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-context-publish-"));
  const reports = join(root, "reports"), dist = join(root, "dist");
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
  const doc = { ...projection(), availability: "unavailable", reason: "source_changed", record: null, placements: [] };
  write(join(dist, "context", `${JOB}.json`), doc);
  write(join(dist, "data.json"), { jobs: [{ id: JOB, context: module.contextSummary(doc) }] });
  write(join(reports, "jobs", `${JOB}.json`), { job: JOB, formulas: { unchanged: 123 }, context: { record: record() } });
  const result = publishData({ reports, dist });
  assert.ok(result.files.some((file) => file.path === `context/${JOB}.json`));
  const copy = JSON.parse(readFileSync(join(dist, "jobs", `${JOB}.json`), "utf8"));
  assert.deepEqual(copy.formulas, { unchanged: 123 });
  assert.deepEqual(copy.context, { state: "unavailable", reason: "source_changed", record: null });
  assert.ok(!JSON.stringify(copy).includes("software"));
  const bad = projection(); bad.record.privacy = null;
  write(join(dist, "context", `${JOB}.json`), bad);
  assert.throws(() => publishData({ reports, dist }), /task_context_projection_invalid/);
});

test("unpublished context preserves the exact bytes of a legacy report without context", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-context-legacy-publish-"));
  const reports = join(root, "reports"), dist = join(root, "dist");
  const doc = { ...projection(), availability: "unavailable", reason: "not_published", record: null, placements: [] };
  mkdirSync(join(dist, "context"), { recursive: true });
  mkdirSync(join(reports, "jobs"), { recursive: true });
  writeFileSync(join(dist, "context", `${JOB}.json`), JSON.stringify(doc));
  writeFileSync(join(dist, "data.json"), JSON.stringify({ jobs: [{ id: JOB, context: module.contextSummary(doc) }] }));
  const bytes = `${JSON.stringify({ job: JOB, formulas: { unchanged: 123 } }, null, 2)}\n`;
  writeFileSync(join(reports, "jobs", `${JOB}.json`), bytes);
  publishData({ reports, dist });
  assert.equal(readFileSync(join(dist, "jobs", `${JOB}.json`), "utf8"), bytes);
});

test("only the closed per-task context summary is exempted from numerical traversal", () => {
  assert.deepEqual(checkNumbers({ jobs: [{ context: module.contextSummary(projection()) }] }), []);
  assert.ok(checkNumbers({ jobs: [{ context: { availability: "published", heading: "Safe", reason: null, unguarded: 3 } }] })
    .some((issue) => issue.code === "task_context_summary_invalid"));
  assert.ok(checkNumbers({ other: { context: { unguarded: 3 } } }).some((issue) => issue.code === "bare_number"));
});

test("the actual Desk contract and ordinary site build reject source changes without changing report totals", {
  skip: !process.env.DESK_DIR && !process.env.FACTORY_REQUIRE_DESK,
}, async () => {
  assert.ok(process.env.DESK_DIR, "DESK_DIR is required for canonical task-context integration");
  const desk = resolve(process.env.DESK_DIR);
  const canonical = await import(pathToFileURL(join(desk, "plugins/desk/mcp/src/factory/context-schema.js")));
  const { stableStringify } = await import(pathToFileURL(join(desk, "plugins/desk/mcp/src/factory/pipeline/normalize.js")));
  const { build } = await import(pathToFileURL(join(desk, "plugins/desk/mcp/src/factory/pipeline/build.js")));
  const { contextFacts, contextRecord, reviewContext } = await import(pathToFileURL(join(desk, "tests/desk/mcp/__tests__/factory/_context_fixture.js")));
  const root = mkdtempSync(join(tmpdir(), "factory-context-canonical-"));
  const main = join(root, "main"), reports = join(root, "reports");
  const facts = contextFacts(), value = contextRecord(facts), job = value.job;
  mkdirSync(join(main, "facts"), { recursive: true });
  mkdirSync(join(main, "context"), { recursive: true });
  const factsPath = join(main, "facts", `claude-code-${facts.session.id}.json`);
  writeFileSync(factsPath, `${stableStringify(facts)}\n`);
  writeFileSync(join(main, "context", `${job}.json`), `${stableStringify(value)}\n`);
  execFileSync("git", ["init", "-qb", "main", main]);
  execFileSync("git", ["-C", main, "add", "."]);
  execFileSync("git", ["-C", main, "-c", "user.name=Factory Context Test",
    "-c", "user.email=16390116+arimendelow@users.noreply.github.com", "-c", "commit.gpgsign=false", "commit", "-qm", "Public context fixture"]);
  assert.equal(canonical.validateContextBytes(readFileSync(join(main, "context", `${job}.json`))).ok, true);
  build({ storeDir: main, outDir: reports });
  const runBuild = (dist) => {
    const result = spawnSync("node", [new URL("../../../site/scripts/build-data.mjs", import.meta.url).pathname,
      "--main", main, "--reports", reports, "--desk", desk, "--out", join(dist, "data.json")], {
      env: { ...process.env, FACTORY_SITE_OFFLINE: "1", GITHUB_TOKEN: "", GH_TOKEN: "" }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    publishData({ reports, dist });
    return JSON.parse(readFileSync(join(dist, "data.json"), "utf8")).jobs.find((entry) => entry.id === job);
  };
  const beforeDir = join(root, "before"), before = runBuild(beforeDir);
  assert.equal(before.context.availability, "published");
  assert.equal(before.context.heading, value.heading);
  const fragment = JSON.parse(readFileSync(join(beforeDir, "context", `${job}.json`), "utf8"));
  assert.equal(module.validateTaskContext(fragment, job).ok, true);
  assert.equal(fragment.record.privacy.payload_sha256, canonical.contextPayloadHash(fragment.record));
  const recommended = reviewContext({
    ...value, schema: "desk.factory.context/2",
    recommendations: [{ ...recommendationProjection().record.recommendations[0], observations: [value.events[0].id] }],
  });
  writeFileSync(join(main, "context", `${job}.json`), `${stableStringify(recommended)}\n`);
  assert.equal(canonical.validateContextBytes(readFileSync(join(main, "context", `${job}.json`))).ok, true);
  const recommendationDir = join(root, "recommendations"), withRecommendation = runBuild(recommendationDir);
  const recommendationFragment = JSON.parse(readFileSync(join(recommendationDir, "context", `${job}.json`), "utf8"));
  assert.equal(module.validateTaskContext(recommendationFragment, job).ok, true);
  assert.deepEqual(recommendationFragment.record.recommendations, recommended.recommendations);
  assert.equal(recommendationFragment.record.privacy.payload_sha256, canonical.contextPayloadHash(recommended));
  assert.deepEqual(withRecommendation.lead_time_ms, before.lead_time_ms);
  assert.deepEqual(withRecommendation.active_time_ms, before.active_time_ms);
  facts.intervals[0].end_ms += 1;
  writeFileSync(factsPath, `${stableStringify(facts)}\n`);
  const afterDir = join(root, "after"), after = runBuild(afterDir);
  assert.deepEqual(after.context, { availability: "unavailable", heading: null, reason: "source_changed" });
  assert.deepEqual(after.lead_time_ms, before.lead_time_ms);
  assert.deepEqual(after.active_time_ms, before.active_time_ms);
  assert.equal(JSON.parse(readFileSync(join(afterDir, "jobs", `${job}.json`), "utf8")).context.record, null);
});
