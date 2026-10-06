#!/usr/bin/env node
// Builds site/dist/data.json for the factory Pages site.
//
// Reads two already-checked-out trees:
//   --reports <dir>  the `reports` branch (rollups/*.json, jobs/*.json) that
//                     factory-build already produced from the store's facts
//   --main    <dir>   `main` (facts/*.json, and its Git history for intake
//                     dates, since published facts carry no clock time)
// and writes one JSON file (--out) the static page fetches at runtime.
//
// It writes two files next to each other: data.json (every number with its
// state, see state.mjs) and health.json (the site's own health, see
// health.mjs). Before writing, it runs the numbers check (check-numbers.mjs);
// a violation fails the build and nothing is written.
//
// No npm dependencies: Node 22 built-ins only (fs, path, child_process,
// global fetch). Safe to run locally for a preview build or in CI.
// FACTORY_SITE_OFFLINE=1 skips every GitHub call (those numbers are then
// unavailable, with a reason), for tests and offline previews.

import {
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { compareJobs, jobSummary, scopeMember } from "./job-summary.mjs";
import { harnessSummary } from "./harness-summary.mjs";
import { SUBSTANTIAL_ACTIVE_MS, inScope, isBound } from "./active-time.mjs";
import {
  LOW_COVERAGE_BELOW,
  THIN_SAMPLE_MIN,
  declareRollup,
  fromTotalsLeaf,
  measured,
  partial,
  rollup,
  trust,
  unavailable,
} from "./state.mjs";
import { direct } from "./bounds.mjs";
import { SUBSTANTIAL, entrypointOf, featuredNumbers, modelRollups, subagentRollups, toolKindRollups } from "./session-numbers.mjs";
import { STALE_AFTER_HOURS, buildHealth, intakeClass, lastBuildFromRuns } from "./health.mjs";
import { checkNumbers } from "./check-numbers.mjs";
import { outcomesSummary } from "./outcomes.mjs";
import { CAPTURE_FILE, summarizeCapture } from "./capture-coverage.mjs";
import { summarizeLoop } from "./loop-health.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const reportsDir = arg("reports");
const mainDir = arg("main");
const outFile = arg("out");

if (!reportsDir || !mainDir || !outFile) {
  console.error(
    "usage: build-data.mjs --reports <reports-branch-checkout> --main <main-checkout> --out <data.json path>",
  );
  process.exit(1);
}

function readJSON(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function listJSON(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const OFFLINE = process.env.FACTORY_SITE_OFFLINE === "1";
const sum = (v) => v.reduce((a, b) => a + b, 0);
const medianOf = (v) => percentile([...v].sort((a, b) => a - b), 50);
const p75Of = (v) => percentile([...v].sort((a, b) => a - b), 75);

// A count the reports supply, or unavailable: a missing or non-numeric field
// is "not recorded", never zero.
function counted(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? measured(v) : unavailable(["not_recorded"]);
}

// Trust for a headline that is a plain count of files or jobs: its sample is
// the count itself.
function countTrust(number) {
  const n = number.state === "unavailable" ? 0 : number.value;
  return trustOf({ state: number.state, n, N: n });
}

// ---------------------------------------------------------------------------
// Capture coverage: every capture/<intake id>.json on main, with the time of
// its last commit (to leave out a record older than 45 days) and its bytes at
// the commit before (to see a machine's coverage drop). Only the summary is
// published: no date, no intake id, no per-machine figure. It is read first,
// because every headline's trust state reads it.
// ---------------------------------------------------------------------------

function readCaptureFiles(dir) {
  const captureDir = join(dir, "capture");
  if (!existsSync(captureDir)) return [];
  const names = readdirSync(captureDir).filter((n) => n.endsWith(".json")).sort();
  return names.map((name) => {
    if (!CAPTURE_FILE.test(name)) return { text: null, committedAtMs: null, previousText: null };
    let text = null;
    try {
      text = readFileSync(join(captureDir, name), "utf8");
    } catch {
      text = null;
    }
    let committedAtMs = null;
    let previousText = null;
    try {
      const log = execFileSync("git", ["-C", dir, "log", "--format=%H %ct", "-2", "--", `capture/${name}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")
        .filter(Boolean);
      const seconds = Number((log[0] || "").split(" ")[1]);
      committedAtMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
      const previous = (log[1] || "").split(" ")[0];
      if (/^[0-9a-f]{40}$/.test(previous)) {
        try {
          previousText = execFileSync("git", ["-C", dir, "show", `${previous}:capture/${name}`], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          });
        } catch {
          previousText = null;
        }
      }
    } catch {
      committedAtMs = null;
    }
    return { text, committedAtMs, previousText };
  });
}

const captureFiles = readCaptureFiles(mainDir);
const captureCoverage = summarizeCapture({ files: captureFiles, nowMs: Date.now() });
// The improvement loop's health rides in the same records (their `loop` slot).
const loopHealth = summarizeLoop({ files: captureFiles, nowMs: Date.now() });
// Every trust state rests on the capture share, passed in, never a global.
const trustOf = (headline) => trust(headline, { coverage: captureCoverage.share });

// ---------------------------------------------------------------------------
// Rollups (already computed by factory-build; we read them, never re-derive)
// ---------------------------------------------------------------------------

const coverageFile = readJSON(join(reportsDir, "rollups/coverage.json"), null);
const measuresFile = readJSON(join(reportsDir, "rollups/measures.json"), null);
const mudaFile = readJSON(join(reportsDir, "rollups/muda.json"), null);
// Written by a Desk whose reports carry state and reasons (published facts
// /2). An older reports branch has no totals.json and tool-kind rows without
// a state; the site then computes those numbers from the facts itself.
const totalsFile = readJSON(join(reportsDir, "rollups/totals.json"), null);
const toolKindsFile = readJSON(join(reportsDir, "rollups/tool-kinds.json"), null);
// Sign-off, first-pass yield and rework, from a Desk whose pipeline builds
// rollups/outcomes.json. Absent, every outcome figure reads "not recorded yet".
const outcomes = outcomesSummary(readJSON(join(reportsDir, "rollups/outcomes.json"), null), { coverage: captureCoverage.share });
// If the reports branch is missing its rollups, the site says so (health
// verdict `broken`) and every number the rollups would supply is unavailable.
const reportsReadable = coverageFile !== null && measuresFile !== null && mudaFile !== null;
const coverageRaw = coverageFile ?? {};
const mudaRaw = mudaFile ?? {};
const mudaOverall = mudaRaw.groupings?.overall?.all ?? null;

// ---------------------------------------------------------------------------
// Per-job summaries, straight from each job's own formulas envelope
// ---------------------------------------------------------------------------

const jobsDir = join(reportsDir, "jobs");
const jobFiles = listJSON(jobsDir);

const jobs = jobFiles.map((f) => jobSummary(readJSON(join(jobsDir, f), {}), f));

const jobStatusCounts = {};
for (const j of jobs) {
  jobStatusCounts[j.status] = (jobStatusCounts[j.status] || 0) + 1;
}
const jobStatus = Object.fromEntries(Object.entries(jobStatusCounts).map(([k, v]) => [k, measured(v)]));

// ---------------------------------------------------------------------------
// Flow efficiency and "where time goes", scoped to jobs whose whole life
// falls inside capture.
//
// A job's lead time is measured on the job's own clock, starting at 0 when
// its card was created. `queue_before_start_ms` is the offset of the first
// captured session bound to that job. When a card was created before the
// store had any way to capture the work already happening on it, that offset
// can be large: days of lead time with no session recorded for them, which
// is not real waiting and drags flow efficiency toward zero for a reason that
// has nothing to do with how the work went. A job whose first bound session
// starts at or before its recorded start (`queue_before_start_ms` measured
// as 0) has no such gap. The job must also have reached `done`: an open job's
// lead time so far is a running total, not a result.
//
// Every job is a member of each rollup below. A job outside this scope is an
// unmeasured member (reason `outside_capture_scope`), and a job inside it
// whose own value is partial or unavailable is excluded the same way. The
// rollup is then "median of n of N jobs", never a median over a quietly
// chosen subset.
// ---------------------------------------------------------------------------

const jobMember = scopeMember;

const timeRollups = (key) => {
  const members = jobs.map((j) => jobMember(j, key));
  return {
    median: rollup(members, { of: "finished jobs", measure: "median", reduce: medianOf }),
    p75: rollup(members, { of: "finished jobs", measure: "p75", reduce: p75Of }),
  };
};

const scopedTimeBreakdown = [
  { key: "active_time", label: "Active work", field: "active_time_ms" },
  { key: "human_wait", label: "Waiting on a human", field: "human_wait_ms" },
  { key: "api_retry_wait", label: "Waiting on API retries", field: "api_retry_ms" },
].map(({ key, label, field }) => {
  const r = timeRollups(field);
  return { key, label, ...r, trust: trustOf(r.median) };
});

const flowRollups = timeRollups("flow_efficiency");
const scopedFlowEfficiency = {
  ...flowRollups,
  trust: trustOf(flowRollups.median),
};

// ---------------------------------------------------------------------------
// Facts on main: session population, and the substantial subset this section
// studies.
//
// Published facts name no person, machine or time of day, so this is safe
// to aggregate. A published session withholds which plugins it ran by
// default, so this page never claims to identify Desk sessions. What the
// public facts always carry is active time and job binding, so this section
// studies the sessions that were active for at least 5 minutes (the union of
// turn, tool and subagent time, waits excluded) or are bound to a tracked
// job. Every other session is reported once, plainly, as population context,
// never folded into a finding about the work.
// ---------------------------------------------------------------------------

const factsDir = join(mainDir, "facts");
const factFiles = listJSON(factsDir);

const allEntrypoints = {};
const scopedEntrypoints = {};
const factsByHost = {};
let scopedSessionCount = 0;
let scopedBoundCount = 0;
const scopedFacts = []; // same substantial-session scope, for every fact-level number

for (const f of factFiles) {
  const d = readJSON(join(factsDir, f), {});
  const entrypoint = entrypointOf(d);
  allEntrypoints[entrypoint] = (allEntrypoints[entrypoint] || 0) + 1;
  const host = typeof d.session?.host === "string" && d.session.host ? d.session.host : "unknown";
  factsByHost[host] = (factsByHost[host] || 0) + 1;

  const bound = isBound(d);
  if (!inScope(d)) continue;

  scopedFacts.push(d);
  scopedSessionCount += 1;
  scopedEntrypoints[entrypoint] = (scopedEntrypoints[entrypoint] || 0) + 1;
  if (bound) scopedBoundCount += 1;
}

// Fact-level totals. The pipeline's own totals (rollups/totals.json) apply
// every facts flag and host constant in one place and count every published
// session, so the site reads them when they are there. Without them, the
// site sums the substantial sessions itself, over measured sessions only.
const PUBLISHED = "published sessions";
const pipelineTotals = totalsFile && totalsFile.all && typeof totalsFile.all === "object" ? totalsFile.all : null;
const pipelineKindRows =
  Array.isArray(toolKindsFile?.tool_kinds) &&
  toolKindsFile.tool_kinds.length > 0 &&
  toolKindsFile.tool_kinds.every((r) => r && typeof r.tool === "string" && typeof r.state === "string")
    ? toolKindsFile.tool_kinds
    : null;

// One pipeline tool-kind row as the site's rollups. `calls` and `failures`
// sum the same n of N sessions, so their ratio is taken over those.
function kindFromRow(row) {
  const counts = (key) => {
    const leaf = { N: row.N, n: row.n, reasons: row.reasons, state: row.state };
    if (key in row) leaf.value = row[key];
    return fromTotalsLeaf(leaf, PUBLISHED);
  };
  const calls = counts("calls");
  const failures = counts("failures");
  const sessions = fromTotalsLeaf({ N: row.N, n: row.N, reasons: [], state: "measured", value: row.sessions }, PUBLISHED);
  const rate =
    calls.state !== "unavailable" && failures.state === calls.state && calls.value > 0
      ? { ...calls, value: failures.value / calls.value }
      : { ...unavailable(calls.state === "unavailable" ? calls.reasons : ["no_calls"]), kind: "rollup", n: 0, N: calls.N, of: PUBLISHED, out_of_scope: 0 };
  return { tool: row.tool, calls, failures, sessions, failure_rate: direct(rate, "rate") };
}

const siteToolRollups = toolKindRollups(scopedFacts);
const toolRollups = pipelineKindRows
  ? {
      kinds: pipelineKindRows.map(kindFromRow).sort((a, b) => (b.calls.value ?? -1) - (a.calls.value ?? -1)),
      total_calls: pipelineTotals ? fromTotalsLeaf(pipelineTotals.tool_calls, PUBLISHED) : siteToolRollups.total_calls,
    }
  : siteToolRollups;
const toolKindsScope = pipelineKindRows ? "published" : "substantial";
const modelRolls = modelRollups(scopedFacts);
const subagentRolls = subagentRollups(scopedFacts);
const headlineTotals = pipelineTotals
  ? {
      dispatches: fromTotalsLeaf(pipelineTotals.subagent_dispatches, PUBLISHED),
      tool_calls: fromTotalsLeaf(pipelineTotals.tool_calls, PUBLISHED),
      model_requests: fromTotalsLeaf(pipelineTotals.model_requests, PUBLISHED),
      note: "every published session",
    }
  : {
      dispatches: subagentRolls.dispatches,
      tool_calls: siteToolRollups.total_calls,
      model_requests: modelRolls.total_requests,
      note: "substantial sessions",
    };

const otherSessionCount = factFiles.length - scopedSessionCount;
const otherEntrypoints = {};
for (const [k, v] of Object.entries(allEntrypoints)) {
  otherEntrypoints[k] = v - (scopedEntrypoints[k] || 0);
}
const asMeasured = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, measured(v)]));

// ---------------------------------------------------------------------------
// Featured long-horizon sessions: the proof that, given durable context and
// an engineering lifecycle, an agent can carry a real task to a merged,
// reviewed result over a long span. This draws from every published session
// (any entrypoint, any duration, bound or not) with a real public pull
// request reference. Each candidate is a single session's own record.
//
// Nothing here names a person: a pull request is shown as a link and its
// number, never with its repository owner, author or avatar.
// ---------------------------------------------------------------------------

const FEATURED_COUNT = 3;
const MAX_PR_LOOKUPS = 220;

const candidateSessions = [];
for (const f of factFiles) {
  const d = readJSON(join(factsDir, f), {});
  const prs = d.refs?.prs || [];
  if (d.session?.ended !== true || prs.length === 0) continue;
  candidateSessions.push({ d, prs, duration: Number.isFinite(d.session.duration_ms) ? d.session.duration_ms : -1 });
}

candidateSessions.sort((a, b) => b.duration - a.duration);
const featuredCandidates = candidateSessions.slice(0, FEATURED_COUNT);

const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
const ghHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "factory-site-build",
  ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
};
// The store repo itself, for the kaizen/andon issue lookups and the build
// status below. In CI this is always the checked-out repo (GITHUB_REPOSITORY);
// the literal is only a local-run fallback.
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || "ourostack/factory";

async function ghGet(url) {
  if (OFFLINE) return null;
  try {
    const res = await fetch(url, { headers: ghHeaders, signal: AbortSignal.timeout(20000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function checkMerged(repo, number) {
  const body = await ghGet(`https://api.github.com/repos/${repo}/pulls/${number}`);
  return body ? { merged: body.merged === true, url: body.html_url } : null;
}

// Bounded, mildly-concurrent PR merge-state verification.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

let prLookupsUsed = 0;
const featured = [];
for (const { d, prs } of featuredCandidates) {
  const prsToCheck = prs.slice(0, Math.max(0, MAX_PR_LOOKUPS - prLookupsUsed));
  prLookupsUsed += prsToCheck.length;
  const results = await mapLimit(prsToCheck, 8, (pr) => checkMerged(pr.repo, pr.number));
  const checked = results.filter((r) => r !== null);
  const merged = checked.filter((r) => r.merged).length;

  // One representative merged PR per repo (the highest-numbered = most
  // recent in that repo), as a link and a number only.
  const byRepoLatest = new Map();
  results.forEach((r, idx) => {
    if (!r || !r.merged || typeof r.url !== "string" || !r.url.startsWith("https://github.com/")) return;
    const pr = prsToCheck[idx];
    const cur = byRepoLatest.get(pr.repo);
    if (!cur || pr.number > cur.number) byRepoLatest.set(pr.repo, { number: pr.number, url: r.url });
  });

  const models = [];
  for (const m of [...(d.models || [])].sort((a, b) => (b.requests ?? -1) - (a.requests ?? -1))) {
    if (m && typeof m.id === "string") models.push(m.id);
  }

  featured.push({
    session_id: d.session.id,
    host: d.session.host,
    ...featuredNumbers(d),
    models: models.slice(0, 2),
    prs_total: measured(prs.length),
    prs_checked: measured(checked.length),
    prs_merged: checked.length > 0 ? (checked.length < prs.length ? direct(partial(merged, ["not_every_pull_request_checked"]), "prs_merged") : measured(merged)) : unavailable(["github_api_unavailable"]),
    sample_merged_prs: [...byRepoLatest.values()]
      .sort((a, b) => b.number - a.number)
      .map((p) => ({ ref: `#${p.number}`, url: p.url })),
    verification: checked.length === prs.length ? "verified" : checked.length > 0 ? "partial" : "unavailable",
  });
}

// ---------------------------------------------------------------------------
// Intake over time: published facts carry no clock time by design ("no
// when"), but the commit that first adds a facts file to `main` is a public,
// ordinary Git fact and is the only legitimate source for a "sessions over
// time" panel. It is bucketed by UTC day, no finer: an hourly series joined
// with the public pull requests would tie a contributor's account to the
// hours they work. The newest intake feeds the health panel as a coarse age
// class only.
// ---------------------------------------------------------------------------

let intakeOverTime = [];
let newestIntakeMs = null;
try {
  const log = execFileSync(
    "git",
    ["-C", mainDir, "log", "--diff-filter=A", "--name-only", "--pretty=format:C|%ct", "--", "facts/"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const dayCounts = new Map();
  let currentDay = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("C|")) {
      const ms = Number(line.slice(2)) * 1000;
      currentDay = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null;
      // The fixed-metadata bootstrap commit has no real time.
      if (currentDay && currentDay.startsWith("1970-01-01")) currentDay = null;
      if (currentDay && (newestIntakeMs === null || ms > newestIntakeMs)) newestIntakeMs = ms;
    } else if (line.trim().startsWith("facts/") && currentDay) {
      dayCounts.set(currentDay, (dayCounts.get(currentDay) || 0) + 1);
    }
  }
  intakeOverTime = [...dayCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count: measured(count) }));
} catch {
  intakeOverTime = [];
  newestIntakeMs = null;
}

// ---------------------------------------------------------------------------
// Kaizen / andon issues: best-effort reads of the public repo's issues. A
// failed fetch (rate limit, network, offline) is unavailable, never a zero:
// `fetchIssues` carries its own verification state back. An issue is shown
// as a link and its number; its title is shown only when it matches the
// auto-filed form, so a title a person typed never reaches the page, and no
// author, login or avatar is read at all.
// ---------------------------------------------------------------------------

const PR_URL_RE = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const AUTOFILED_TITLE_RE = /^(Kaizen|Andon): [A-Za-z0-9_ ,.:()/-]{1,120}$/;
const ISSUE_PAGE_SIZE = 50;

function firstPrLink(text) {
  if (!text) return null;
  const m = text.match(PR_URL_RE);
  if (!m) return null;
  return { repo: m[1], number: Number(m[2]) };
}

function extractCountermeasure(body) {
  if (!body) return null;
  const m = body.match(/countermeasure:\s*(https:\/\/github\.com\/\S+\/pull\/\d+)/i);
  if (!m) return null;
  return firstPrLink(m[1]);
}

async function fetchIssues(label) {
  const items = await ghGet(
    `https://api.github.com/repos/${GITHUB_REPO}/issues?state=all&labels=${encodeURIComponent(label)}&per_page=${ISSUE_PAGE_SIZE}`,
  );
  if (!Array.isArray(items)) return { verification: "unavailable", issues: [] };
  return {
    verification: "verified",
    // Only the first page is read: a full page may hide more.
    truncated: items.length >= ISSUE_PAGE_SIZE,
    issues: items
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: typeof i.title === "string" && AUTOFILED_TITLE_RE.test(i.title) ? i.title : null,
        state: i.state,
        url: i.html_url,
        body: i.body || "",
      })),
  };
}

async function fetchLastComment(number) {
  const items = await ghGet(`https://api.github.com/repos/${GITHUB_REPO}/issues/${number}/comments?per_page=50`);
  if (!Array.isArray(items)) return null;
  return items.length ? items[items.length - 1].body || "" : null;
}

async function enrichIssue(issue) {
  const { body, number, title, state, url } = issue;
  const base = { ref: `#${number}`, ...(title ? { title } : {}), issue_state: state, url };
  if (state !== "closed") return { ...base, resolution: { kind: "open" } };
  let link = extractCountermeasure(body);
  if (!link) link = firstPrLink(await fetchLastComment(number));
  if (!link) return { ...base, resolution: { kind: "closed" } };
  const merge = await checkMerged(link.repo, link.number);
  return {
    ...base,
    resolution: {
      kind: "countermeasure",
      ref: `#${link.number}`,
      url: merge?.url || `https://github.com/${link.repo}/pull/${link.number}`,
      merged: merge ? merge.merged : "unknown",
    },
  };
}

const [kaizenFetch, andonFetch] = await Promise.all([fetchIssues("kaizen"), fetchIssues("andon")]);
const kaizenIssues = await mapLimit(kaizenFetch.issues, 4, enrichIssue);
const andonIssues = await mapLimit(andonFetch.issues, 4, enrichIssue);

const kaizenRaised =
  kaizenFetch.verification === "unavailable"
    ? unavailable(["github_api_unavailable"])
    : kaizenFetch.truncated
      ? direct(partial(kaizenIssues.length, ["first_page_only"]), "issues_first_page")
      : measured(kaizenIssues.length);
const kaizenResolved =
  kaizenFetch.verification === "unavailable"
    ? unavailable(["github_api_unavailable"])
    : kaizenFetch.truncated
      ? direct(partial(kaizenIssues.filter((i) => i.issue_state === "closed").length, ["first_page_only"]), "issues_first_page")
      : measured(kaizenIssues.filter((i) => i.issue_state === "closed").length);

// ---------------------------------------------------------------------------
// Headlines: each is a stated number plus a trust state. Takeaways are
// sentence templates with slots, so no number is typed into prose.
// ---------------------------------------------------------------------------

const jobsTracked = counted(coverageRaw.jobs);
const jobsOpen = counted(coverageRaw.jobs_open);
const scoped = measured(scopedSessionCount);
const totalSessions = measured(factFiles.length);

const headlines = [
  { id: "substantial_sessions", label: "Substantial sessions", number: scoped, note: { template: "of {total} published", slots: { total: totalSessions } }, trust: countTrust(scoped) },
  { id: "jobs_tracked", label: "Jobs tracked", number: jobsTracked, note: { template: "{open} open", slots: { open: jobsOpen } }, trust: countTrust(jobsTracked) },
  { id: "subagent_dispatches", label: "Subagent dispatches", number: headlineTotals.dispatches, note: { template: headlineTotals.note, slots: {} }, trust: trustOf(headlineTotals.dispatches) },
  { id: "tool_calls", label: "Tool calls recorded", number: headlineTotals.tool_calls, note: { template: headlineTotals.note, slots: {} }, trust: trustOf(headlineTotals.tool_calls) },
  { id: "model_requests", label: "Model requests", number: headlineTotals.model_requests, note: { template: headlineTotals.note, slots: {} }, trust: trustOf(headlineTotals.model_requests) },
  { id: "kaizen", label: "Kaizen issues", number: kaizenRaised, note: { template: "{resolved} resolved", slots: { resolved: kaizenResolved } }, trust: countTrust(kaizenRaised) },
];

const takeaways = [];

takeaways.push({
  id: "attribution",
  template: "Of the {scoped} substantial sessions, {bound} are bound to a tracked job; the rest ran without a job attribution.",
  slots: { scoped, bound: measured(scopedBoundCount) },
  trust: countTrust(scoped),
});

takeaways.push({
  id: "flow_efficiency",
  template:
    "{scope} of the {total} tracked jobs both finished and had their whole life inside capture (no gap before the first recorded session); across the {n} of those with a fully measured flow efficiency, the median is {median}. Most jobs' cards predate capture, so their flow efficiency would be an artifact of that gap, not a real measure, and is left out here.",
  slots: { scope: measured(flowRollups.median.N), n: measured(flowRollups.median.n), total: jobsTracked, median: flowRollups.median },
  trust: scopedFlowEfficiency.trust,
});

{
  const eligible = toolRollups.kinds.filter(
    (t) => t.tool !== "other" && t.calls.state !== "unavailable" && t.calls.value >= 20 && t.failure_rate.state !== "unavailable",
  );
  const worst = [...eligible].sort((a, b) => b.failure_rate.value - a.failure_rate.value)[0];
  if (worst) {
    takeaways.push({
      id: "tool_failures",
      template: `${toolKindsScope === "published" ? "Across every published session" : "Among the {scoped} substantial sessions"}, "{tool}" calls fail most often of the tool kinds used at least {min_calls} times: {rate} of {calls} calls ({failures} failures).`,
      slots: { ...(toolKindsScope === "published" ? {} : { scoped }), tool: worst.tool, min_calls: measured(20), rate: worst.failure_rate, calls: worst.calls, failures: worst.failures },
      trust: trustOf(worst.calls),
    });
  }
}

if (modelRolls.models.length > 0 && modelRolls.total_requests.state !== "unavailable") {
  const top = modelRolls.models[0];
  const topMember = (d) => {
    const sess = modelRollups([d]);
    const row = sess.models.find((m) => m.id === top.id);
    const tot = sess.total_requests;
    if (tot.state !== "measured") return unavailable(tot.reasons);
    return { ...(row ? row.requests : measured(0)), aux: tot.value };
  };
  const share = rollup(scopedFacts.map(topMember), {
    of: SUBSTANTIAL,
    measure: "share",
    reduce: (v, ms) => {
      const all = sum(ms.map((m) => m.aux));
      return all > 0 ? sum(v) / all : NaN;
    },
  });
  takeaways.push({
    id: "model_concentration",
    template: "Among the {scoped} substantial sessions, {model} accounts for {share} of the {total} model requests they recorded.",
    slots: { scoped, model: top.id, share, total: modelRolls.total_requests },
    trust: trustOf(share),
  });
}

if (subagentRolls.sessions_with_subagents.state !== "unavailable") {
  const w = subagentRolls.sessions_with_subagents;
  takeaways.push({
    id: "subagents",
    template: "{with} of the {scoped} substantial sessions dispatch at least one subagent, {dispatches} dispatches in total across them; sessions whose subagent logs could not be read are left out.",
    slots: { with: w, scoped, dispatches: subagentRolls.dispatches },
    trust: trustOf(w),
  });
}

if (mudaOverall && mudaOverall.jobs_labeled === 0) {
  const jobsLabeled = measured(0);
  takeaways.push({
    id: "waste_not_labeled",
    template: "Labeling has just started: {labeled} of {jobs} jobs are fully labeled for waste yet, though session-level labels already exist. A job's waste breakdown appears here once every one of its sessions is evaluated.",
    slots: { labeled: jobsLabeled, jobs: counted(mudaOverall.jobs) },
    trust: trustOf({ state: "partial", n: 0, N: counted(mudaOverall.jobs).state === "measured" ? counted(mudaOverall.jobs).value : 0 }),
  });
}

// ---------------------------------------------------------------------------
// Waste: the pipeline's own rollup over labeled jobs, kept with its n of N.
// ---------------------------------------------------------------------------

const wasteJobsTotal = mudaOverall ? counted(mudaOverall.jobs) : unavailable(["not_recorded"]);
const wasteJobsLabeled = mudaOverall ? counted(mudaOverall.jobs_labeled) : unavailable(["not_recorded"]);
const wasteN = wasteJobsLabeled.state === "measured" ? wasteJobsLabeled.value : 0;
const wasteN_total = wasteJobsTotal.state === "measured" ? wasteJobsTotal.value : 0;
const wasteBreakdown = (mudaOverall?.wastes ?? [])
  .filter((w) => w && typeof w.waste === "string")
  .map((w) => ({
    waste: w.waste,
    total_ms: declareRollup({ value: w.total_ms, n: wasteN, N: wasteN_total, of: "jobs", measure: "sum" }),
    jobs: counted(w.jobs),
    share: declareRollup({ value: w.share, n: wasteN, N: wasteN_total, of: "jobs", measure: "share" }),
  }));

// ---------------------------------------------------------------------------
// Assemble and write
// ---------------------------------------------------------------------------

let reportsCommit = null;
try {
  reportsCommit = execFileSync("git", ["-C", reportsDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  reportsCommit = null;
}

const builtAt = new Date().toISOString();

const harnesses = harnessSummary(scopedFacts).map((h) => ({
  host: h.host,
  unproven: h.unproven,
  sessions: measured(h.sessions),
  // Counted only over sessions whose agent list is whole: n of N says how many.
  workers: declareRollup({ value: h.workers, n: h.agents_recorded, N: h.sessions, of: SUBSTANTIAL, measure: "sum" }),
  subagents: declareRollup({ value: h.subagents, n: h.agents_recorded, N: h.sessions, of: SUBSTANTIAL, measure: "sum" }),
  max_depth: declareRollup({ value: h.max_depth, n: h.agents_recorded, N: h.sessions, of: SUBSTANTIAL, measure: "max" }),
  versions: asMeasured(h.versions),
  models: asMeasured(h.models),
  agent_types: asMeasured(h.agent_types),
  requested_vs_resolved: h.requested_vs_resolved.map((p) => ({
    requested: p.requested,
    resolved: p.resolved ?? "unknown",
    workers: measured(p.workers),
  })),
}));

const data = {
  schema: "factory-site/3",
  built_at: builtAt,
  ...(reportsCommit ? { reports_commit: reportsCommit } : {}),
  config: {
    thin_sample_min: THIN_SAMPLE_MIN,
    substantial_active_ms: SUBSTANTIAL_ACTIVE_MS,
    stale_after_hours: STALE_AFTER_HOURS,
    low_coverage_below: LOW_COVERAGE_BELOW,
  },
  coverage: {
    sessions_with_facts: counted(coverageRaw.sessions_with_facts ?? factFiles.length),
    jobs: jobsTracked,
    jobs_open: jobsOpen,
    capture: captureCoverage.share,
  },
  capture_coverage: captureCoverage,
  loop_health: loopHealth,
  scope: {
    sessions_total: totalSessions,
    sessions_scoped: scoped,
    sessions_scoped_bound: measured(scopedBoundCount),
    sessions_other: measured(otherSessionCount),
    entrypoints_scoped: asMeasured(scopedEntrypoints),
    entrypoints_other: asMeasured(otherEntrypoints),
  },
  headlines,
  tool_kinds: toolRollups.kinds,
  // The population each captioned section counts; the page takes its
  // captions from these (format.js `caption`).
  scopes: {
    headlines: pipelineTotals ? "published" : "substantial",
    tool_kinds: toolKindsScope,
    models: "substantial",
    subagents: "substantial",
    harnesses: "substantial",
  },
  tool_calls_total: toolRollups.total_calls,
  time_breakdown: scopedTimeBreakdown,
  flow_efficiency: scopedFlowEfficiency,
  job_status_counts: jobStatus,
  jobs: jobs.sort(compareJobs),
  models: modelRolls.models,
  harnesses,
  subagents: {
    dispatches: subagentRolls.dispatches,
    sessions_with_subagents: subagentRolls.sessions_with_subagents,
    buckets: subagentRolls.buckets,
  },
  intake_over_time: intakeOverTime,
  waste: {
    wastes: Array.isArray(mudaRaw.wastes) ? mudaRaw.wastes : [],
    jobs_total: wasteJobsTotal,
    jobs_labeled: wasteJobsLabeled,
    label_files: counted(coverageRaw.labels?.files),
    breakdown: wasteBreakdown,
  },
  kaizen: { raised: kaizenRaised, resolved: kaizenResolved, verification: kaizenFetch.verification },
  kaizen_issues: kaizenIssues,
  andon_issues: andonIssues,
  andon_verification: andonFetch.verification,
  featured,
  takeaways,
  outcomes,
};

// The site's own health, built beside the data.
const buildRuns = await ghGet(
  `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/build.yml/runs?status=completed&branch=main&per_page=10`,
);
const lastBuild = buildRuns ? lastBuildFromRuns(buildRuns) : unavailable(["github_api_unavailable"]);
const health = buildHealth({
  builtAt,
  factsByHost,
  newestIntake: intakeClass(newestIntakeMs, Date.parse(builtAt)),
  lastBuild,
  reportsReadable,
  slots: { capture_coverage: captureCoverage.share, unsigned_deliveries: outcomes.unsigned, open_improvement_items: loopHealth.not_closed },
  details: {
    capture_coverage: captureCoverage.hosts.map((h) => ({ host: h.host, share: h.share })),
    unsigned_deliveries: [{ label: "longest", kind: "text", number: outcomes.oldest_unsigned_wait }],
    open_improvement_items: [{ label: "oldest open, in days", number: loopHealth.oldest_open_age_days }],
  },
});

// The numbers regression check. It runs before anything is written, so a
// number that lost its state fails the build and the old site stays up.
const violations = [...checkNumbers(data).map((v) => ({ ...v, file: "data.json" })), ...checkNumbers(health).map((v) => ({ ...v, file: "health.json" }))];
if (violations.length) {
  for (const v of violations.slice(0, 50)) console.error(`numbers-check: ${v.code} at ${v.file}:${v.path}`);
  console.error(`numbers-check: ${violations.length} violation(s); data not written`);
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(data), "utf8");
writeFileSync(join(dirname(outFile), "health.json"), JSON.stringify(health), "utf8");

console.log(
  `factory site data: ${jobs.length} jobs, ${factFiles.length} facts files (${scopedSessionCount} substantial), ${toolRollups.kinds.length} tool kinds, ${modelRolls.models.length} models, ${kaizenIssues.length} kaizen issues, ${andonIssues.length} andon issues, ${featured.length} featured sessions (${prLookupsUsed} PR lookups), verdict ${health.verdict.status} -> ${outFile}`,
);
