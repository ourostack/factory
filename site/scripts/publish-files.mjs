#!/usr/bin/env node
// Publishes the store's data files beside the page, and the index agents read.
//
//   node site/scripts/publish-files.mjs --reports <reports checkout> --dist <site/dist> --template <llms template>
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

const { slimMap } = createRequire(import.meta.url)("../src/walk.js");

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

// Copies the data files and returns every published JSON file with its size.
export function publishData({ reports, dist }) {
  const copied = [];
  for (const [sub, depth] of [["jobs", 1], ["rollups", 0]]) {
    for (const rel of jsonFiles(join(reports, sub), depth)) {
      const to = join(dist, sub, rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(reports, sub, rel), to);
      copied.push(`${sub}/${rel}`);
    }
  }
  // Each task's map file: the landing view loads this, not the task's full
  // report, whose intervals can run to megabytes.
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
    writeFileSync(to, JSON.stringify(slimMap(report)), "utf8");
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
  { title: "Start here: the whole site in one file", match: (p) => p === "data.json", what: () => "every number on the page, each with its state (measured, partial or no data) and reasons; kaizen_issues is step 4" },
  { title: "Step 1, follow a task: each task's answer", match: (p) => p === "rollups/tasks.json", what: () => "each task's lead time, working time, top causes and longest wait, in the page's words" },
  { title: "Step 1, follow a task: one task's map", match: (p) => /^map\/[^/]+\.json$/.test(p), what: (p) => `the work bursts, waits, card status changes and pull request numbers of task ${p.slice(4, 12)}: what its value stream map draws` },
  { title: "Step 1, follow a task: one task's timeline", match: (p) => /^jobs\/[^/]+\.json$/.test(p), what: (p) => `the timeline and measures of task ${p.slice(5, 13)}` },
  { title: "Step 1, follow a task: one session in detail", match: (p) => /^jobs\/[^/]+\/[^/]+\.json$/.test(p), what: (p) => `one session of task ${p.slice(5, 13)}` },
  { title: "Step 2, compare tasks", match: (p) => p === "rollups/stackup.json", what: () => "one row per task: where its time went, by class and waste" },
  { title: "Step 3, rank causes", match: (p) => p === "rollups/causes.json", what: () => "hours by cause, with the tasks and stretches behind each" },
  { title: "Other rollups", match: (p) => /^rollups\/[^/]+\.json$/.test(p), what: (p) => `the pipeline's ${p.slice(8, -5)} rollup` },
  { title: "The site's own health", match: (p) => p === "health.json", what: () => "whether the site data is current" },
];

export function llmsText(template, files) {
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
  return template.replace("{{READ_WHOLE}}", kb(READ_WHOLE_BYTES)).replace("{{FILES}}", lines.join("\n").trimEnd());
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
  const { files } = publishData({ reports, dist });
  writeFileSync(join(dist, "llms.txt"), llmsText(readFileSync(template, "utf8"), files), "utf8");
  console.log(sizeLine(files));
  console.log(sizeLine(files.filter((f) => f.path.startsWith("map/")), "Task map files (new)"));
  console.log(sizeLine(files.filter((f) => /^jobs\/[^/]+\/[^/]+\.json$/.test(f.path)), "Session swimlane files"));
}
