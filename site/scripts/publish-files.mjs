#!/usr/bin/env node
// Publishes the store's data files beside the page, and the index agents read.
//
//   node site/scripts/publish-files.mjs --reports <reports checkout> --dist <site/dist> --template <llms template> [--pulls <build-data --pulls-out file>]
//
// Copies the reports branch's jobs/**/*.json and rollups/*.json into the
// site (whatever exists: a file the pipeline does not write yet is simply
// not there), writes llms.txt from its template, and prints one size line
// (file count, total MB, largest file) for the step summary. Only plain
// .json files with safe names are copied; links and anything else are not.

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { slimMap } = require("../src/walk.js");
const { reasonTable } = require("../src/format.js");
import { prClock } from "./pr-clock.mjs";

// A file at or under this size is small enough for an agent to read whole.
export const READ_WHOLE_BYTES = 256 * 1024;
const SAFE = /^[0-9A-Za-z_.-]{1,128}\.json$/;
const SAFE_DIR = /^[0-9A-Za-z_-]{1,64}$/;

// The JSON files under `dir`, as paths relative to it, `depth` levels deep at most.
function jsonFiles(dir, depth) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory() && depth > 0 && SAFE_DIR.test(name)) out.push(...jsonFiles(full, depth - 1).map((p) => `${name}/${p}`));
    else if (st.isFile() && SAFE.test(name)) out.push(name);
  }
  return out;
}

// The store's own fields on each task's row of rollups/tasks.json, so an
// agent finds a task's name and place in finish order in that one file
// instead of joining it against data.json: `name` (the title of its
// earliest-opened public pull request, or null for a private task: the
// page's own privacy rule), `finish_order`, `finish_group` and
// `finish_basis`, copied from data.json jobs[]. Desk's own fields are kept
// as they are; nothing is derived, so no bound is added where Desk gives
// none. A row with no job in data.json gets nulls.
export function enrichTasks(tasksDoc, dataDoc) {
  if (!tasksDoc || typeof tasksDoc !== "object" || !Array.isArray(tasksDoc.jobs)) return tasksDoc;
  const jobs = new Map((dataDoc && Array.isArray(dataDoc.jobs) ? dataDoc.jobs : []).filter((j) => j && typeof j.id === "string").map((j) => [j.id, j]));
  const stated = (n) => (n && typeof n === "object" && typeof n.state === "string" ? n : null);
  return {
    ...tasksDoc,
    store_fields: ["name", "finish_order", "finish_group", "finish_basis"],
    jobs: tasksDoc.jobs.map((r) => {
      const j = r && jobs.get(r.job);
      return {
        ...r,
        name: j && typeof j.name === "string" && j.name ? j.name : null,
        finish_order: (j && stated(j.finish_order)) || null,
        finish_group: (j && stated(j.finish_group)) || null,
        finish_basis: j && typeof j.finish_basis === "string" ? j.finish_basis : null,
      };
    }),
  };
}

// How many partial figures in a file carry a `bound` key (a direction, or
// null for none known). Returns { partials, bounded }.
export function boundCoverage(doc) {
  let partials = 0;
  let bounded = 0;
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    if (x.state === "partial") {
      partials += 1;
      if (Object.prototype.hasOwnProperty.call(x, "bound")) bounded += 1;
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(doc);
  return { partials, bounded };
}

// Every reason code the site has words for, as data (format.js's table).
export function reasonsDoc() {
  return { schema: "factory.site.reasons/1", reasons: reasonTable() };
}

// The pull requests the site build read from GitHub (build-data.mjs
// --pulls-out, factory.site.pulls/1: { pulls: { "repo#n": { created_at,
// merged_at, state } | null }, capped: ["repo#n"] }), as { gh, capped } for
// pr-clock.mjs; null when the file is missing or unreadable, which places
// no pull request through GitHub (reason github_not_read). The file is the
// build's own and is never published.
export function readPulls(path) {
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (!doc || doc.schema !== "factory.site.pulls/1" || !doc.pulls || typeof doc.pulls !== "object") return null;
    return { gh: new Map(Object.entries(doc.pulls)), capped: new Set(Array.isArray(doc.capped) ? doc.capped : []) };
  } catch {
    return null;
  }
}

// Copies the data files and returns every published JSON file with its size.
// `pulls` is readPulls' result (or null): each task's map file places its
// pull requests through it.
export function publishData({ reports, dist, pulls = null }) {
  const copied = [];
  for (const [sub, depth] of [["jobs", 1], ["rollups", 0]]) {
    for (const rel of jsonFiles(join(reports, sub), depth)) {
      const to = join(dist, sub, rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(reports, sub, rel), to);
      copied.push(`${sub}/${rel}`);
    }
  }
  // Each task's row gains the store's name and finish order (data.json is
  // built into dist before this step runs).
  const tasksPath = join(dist, "rollups", "tasks.json");
  const dataPath = join(dist, "data.json");
  if (existsSync(tasksPath) && existsSync(dataPath)) {
    try {
      const enriched = enrichTasks(JSON.parse(readFileSync(tasksPath, "utf8")), JSON.parse(readFileSync(dataPath, "utf8")));
      writeFileSync(tasksPath, JSON.stringify(enriched), "utf8");
    } catch {
      // An unreadable file is published as it is; the page says what it cannot read.
    }
  }
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "reasons.json"), JSON.stringify(reasonsDoc()), "utf8");
  // Each task's map file: the landing view loads this, not the task's full
  // report, whose intervals can run to megabytes. It carries the store's
  // finish date (data.json jobs[]) and pull request clock.
  let finishDates = new Map();
  try {
    const data = JSON.parse(readFileSync(dataPath, "utf8"));
    finishDates = new Map((Array.isArray(data.jobs) ? data.jobs : []).filter((j) => j && typeof j.id === "string" && j.finish_date && typeof j.finish_date === "object").map((j) => [j.id, j.finish_date]));
  } catch {
    // No data.json: no finish date reaches the map files.
  }
  const maps = [];
  for (const rel of jsonFiles(join(reports, "jobs"), 0)) {
    let report;
    try {
      report = JSON.parse(readFileSync(join(reports, "jobs", rel), "utf8"));
    } catch {
      continue;
    }
    // Only a task report (one with a timeline) has a map.
    if (!report || typeof report !== "object" || !report.timeline || typeof report.timeline !== "object") continue;
    const to = join(dist, "map", rel);
    mkdirSync(dirname(to), { recursive: true });
    const job = String((report.job && report.job.id) || report.timeline.job || "");
    const store = { pr_clock: prClock(report.timeline.prs, pulls ? pulls.gh : null, { capped: pulls ? pulls.capped : undefined }), finish_date: finishDates.get(job) || null };
    writeFileSync(to, JSON.stringify(slimMap(report, store)), "utf8");
    maps.push(`map/${rel}`);
  }
  const all = [...jsonFiles(dist, 0), ...jsonFiles(join(dist, "rollups"), 0).map((p) => `rollups/${p}`), ...jsonFiles(join(dist, "map"), 0).map((p) => `map/${p}`), ...jsonFiles(join(dist, "jobs"), 1).map((p) => `jobs/${p}`)];
  return { copied, maps, files: [...new Set(all)].map((path) => ({ path, bytes: statSync(join(dist, path)).size })) };
}

const MB = 1024 * 1024;
const mb = (b) => `${(b / MB).toFixed(2)} MB`;
const kb = (b) => (b >= MB ? mb(b) : `${Math.max(1, Math.round(b / 1024))} KB`);

export function sizeLine(files, label = "Published data files") {
  if (!files.length) return `${label}: none`;
  const total = files.reduce((a, f) => a + f.bytes, 0);
  const largest = files.reduce((a, f) => (f.bytes > a.bytes ? f : a));
  return `${label}: ${files.length} files, ${mb(total)} total, largest ${largest.path} (${mb(largest.bytes)})`;
}

// What each file is for, in the walk's order. A file is listed only when
// it was published in this build.
const GROUPS = [
  { title: "Start here: the whole site in one file", match: (p) => p === "data.json", what: () => "every number on the page, each with its state (measured, partial or no data), reasons and, when partial, its bound; jobs[] holds each task's name and finish order; kaizen_issues (the problems in hand, each with the `cause` key it works on when one is known) and alarm_issues (who owns each alarm) are step 4, Act" },
  { title: "Reading the reasons", match: (p) => p === "reasons.json", what: () => "every reason code a figure can carry (censored, log_truncated, card_dates_shorter_than_work, …) with the plain words the page shows for it" },
  { title: "Step 1, follow a task: each task's answer", match: (p) => p === "rollups/tasks.json", what: () => "one row per task, keyed by `job`: its lead time, working time, idle time and its split by what it waited on (`waiting_by_waited_on_ms`), top causes and longest wait, as stated numbers in milliseconds (keys and codes, not the page's sentences; reasons.json gives the words), plus the store's `name` (null for a private task), `finish_order`, `finish_group` and `finish_basis`" },
  { title: "Step 1, follow a task: one task's map", match: (p) => /^map\/[^/]+\.json$/.test(p), what: (p) => `the work bursts, waits, card status changes, operator prompts (each with its why), the waits before them, and pull requests with their opened and merged times on the task clock, of task ${p.slice(4, 12)}: what its value stream map draws; every time is an offset on the task clock (factory.site.map/2)` },
  { title: "Step 1, follow a task: one task's timeline", match: (p) => /^jobs\/[^/]+\.json$/.test(p), what: (p) => `the timeline and measures of task ${p.slice(5, 13)}` },
  { title: "Step 1, follow a task: one session in detail", match: (p) => /^jobs\/[^/]+\/[^/]+\.json$/.test(p), what: (p) => `one session of task ${p.slice(5, 13)}` },
  { title: "Step 2, compare tasks", match: (p) => p === "rollups/stackup.json", what: () => "one row per task: its lead time split into working time by the evaluator's labels and waiting (idle time) by what it waited on; what each bar of the stack-up draws" },
  { title: "Step 3, rank causes", match: (p) => p === "rollups/causes.json", what: () => "each cause's time in job-hours (a moment two tasks share counts for each), largest first with its running share, and the tasks and stretches behind it; what the Pareto chart and each #/causes/<key> page draw" },
  { title: "Other rollups", match: (p) => /^rollups\/[^/]+\.json$/.test(p), what: (p) => `the pipeline's ${p.slice(8, -5)} rollup` },
  { title: "The site's own health", match: (p) => p === "health.json", what: () => "whether the site data is current" },
];

// Which files state the direction of their partial figures, from the
// files themselves: `coverage` maps a path to boundCoverage's count.
export function directionText(coverage) {
  const c = coverage || {};
  const lines = ["`data.json` gives `bound` on every partial figure."];
  const full = [];
  const some = [];
  for (const path of ["rollups/tasks.json", "rollups/stackup.json", "rollups/causes.json"]) {
    const x = c[path];
    if (!x || !x.partials) continue;
    if (x.bounded >= x.partials) full.push(`\`${path}\` (${x.partials})`);
    else some.push(`\`${path}\` on ${x.bounded} of its ${x.partials}`);
  }
  if (full.length) lines.push(`So ${full.length === 1 ? "does" : "do"} ${listWords(full)}.`);
  if (some.length) {
    lines.push(`The rollups give it on only some: ${listWords(some)}. Where the key is absent, the file does not say which way the figure is off, so do not assume one; the store does not add a direction Desk did not state. For a task's figures, read the direction from \`data.json\` \`jobs[]\`, or work it out: idle time is lead time minus working time, so a working time that is a lower bound makes idle time an upper bound, and a lead time that is a lower bound makes it a lower bound.`);
  }
  return lines.join(" ");
}

function listWords(items) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function llmsText(template, files, coverage) {
  const lines = [];
  const left = new Set(files.map((f) => f.path));
  for (const g of GROUPS) {
    const mine = files.filter((f) => left.has(f.path) && g.match(f.path));
    if (!mine.length) continue;
    lines.push(`## ${g.title}`, "");
    for (const f of mine) {
      left.delete(f.path);
      const whole = f.bytes <= READ_WHOLE_BYTES ? "small enough to read whole" : "large: read only the parts you need";
      lines.push(`- ${f.path} (${kb(f.bytes)}, ${whole}): ${g.what(f.path)}`);
    }
    lines.push("");
  }
  return template.replace("{{READ_WHOLE}}", kb(READ_WHOLE_BYTES)).replace("{{DIRECTION}}", directionText(coverage)).replace("{{FILES}}", lines.join("\n").trimEnd());
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reports = arg("reports");
  const dist = arg("dist");
  const template = arg("template");
  if (!reports || !dist || !template) {
    console.error("usage: publish-files.mjs --reports <dir> --dist <dir> --template <llms template>");
    process.exit(2);
  }
  const pullsPath = arg("pulls");
  const { files } = publishData({ reports, dist, pulls: pullsPath ? readPulls(pullsPath) : null });
  const coverage = {};
  for (const path of ["rollups/tasks.json", "rollups/stackup.json", "rollups/causes.json"]) {
    try {
      coverage[path] = boundCoverage(JSON.parse(readFileSync(join(dist, path), "utf8")));
    } catch {
      // Not published, or unreadable: nothing to say about its directions.
    }
  }
  writeFileSync(join(dist, "llms.txt"), llmsText(readFileSync(template, "utf8"), files, coverage), "utf8");
  console.log(sizeLine(files));
  console.log(sizeLine(files.filter((f) => f.path.startsWith("map/")), "Task map files (new)"));
  console.log(sizeLine(files.filter((f) => /^jobs\/[^/]+\/[^/]+\.json$/.test(f.path)), "Session swimlane files"));
}
