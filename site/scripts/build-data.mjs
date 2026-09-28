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
// No npm dependencies: Node 22 built-ins only (fs, path, child_process,
// global fetch). Safe to run locally for a preview build or in CI.

import {
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

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

// ---------------------------------------------------------------------------
// Rollups (already computed by factory-build; we read them, never re-derive)
// ---------------------------------------------------------------------------

const toolKindsRaw = readJSON(join(reportsDir, "rollups/tool-kinds.json"), {
  sessions: 0,
  tool_kinds: [],
});
const coverageRaw = readJSON(join(reportsDir, "rollups/coverage.json"), {});
const measuresRaw = readJSON(join(reportsDir, "rollups/measures.json"), {
  groupings: {},
});
const mudaRaw = readJSON(join(reportsDir, "rollups/muda.json"), {
  groupings: {},
  wastes: [],
});

const toolKinds = [...(toolKindsRaw.tool_kinds || [])]
  .map((t) => ({
    tool: t.tool,
    calls: t.calls,
    failures: t.failures,
    sessions: t.sessions,
    failure_rate: t.calls > 0 ? t.failures / t.calls : null,
  }))
  .sort((a, b) => b.calls - a.calls);

const overallMeasures =
  measuresRaw.groupings?.overall?.all?.measures || {};

function measure(key) {
  const m = overallMeasures[key];
  if (!m) return { jobs_counted: 0, median: null, p75: null };
  return { jobs_counted: m.jobs_counted, median: m.median, p75: m.p75 };
}

const timeBreakdown = [
  { key: "active_time", label: "Active work" },
  { key: "human_wait", label: "Waiting on a human" },
  { key: "queue_before_start", label: "Queued before start" },
  { key: "api_retry_wait", label: "Waiting on API retries" },
].map(({ key, label }) => ({ key, label, ...measure(key) }));

const flowEfficiency = measure("flow_efficiency");
const toolFailuresMeasure = measure("tool_failures");
const toolRetriesMeasure = measure("tool_retries");

const mudaOverall = mudaRaw.groupings?.overall?.all || {
  jobs: 0,
  jobs_labeled: 0,
  jobs_excluded: [],
  wastes: [],
};

// ---------------------------------------------------------------------------
// Per-job summaries, straight from each job's own formulas envelope
// ---------------------------------------------------------------------------

const jobsDir = join(reportsDir, "jobs");
const jobFiles = listJSON(jobsDir);

const jobs = jobFiles.map((f) => {
  const d = readJSON(join(jobsDir, f), {});
  const F = d.formulas || {};
  const val = (k) => (F[k] && "value" in F[k] ? F[k].value : null);
  return {
    id: d.job || f.replace(/\.json$/, ""),
    status: val("status") ?? "unavailable",
    status_class: F.status?.class ?? "unavailable",
    lead_time_ms: val("lead_time_ms"),
    lead_time_class: F.lead_time_ms?.class ?? "unavailable",
    active_time_ms: val("active_time_ms"),
    flow_efficiency: val("flow_efficiency"),
    tool_failures: F.rework_signals?.tool_failures?.value ?? null,
    tool_retries: F.rework_signals?.tool_retries?.value ?? null,
    sessions_bound: F.sessions?.value?.bound ?? null,
    sessions_shared: F.sessions?.value?.shared ?? null,
    hosts: F.sessions_by_host?.value ?? {},
    concurrent_agents_max: F.concurrent_agents?.value?.maximum ?? null,
    public_prs: F.references?.value?.public_prs ?? 0,
  };
});

const jobStatusCounts = {};
for (const j of jobs) {
  jobStatusCounts[j.status] = (jobStatusCounts[j.status] || 0) + 1;
}

// ---------------------------------------------------------------------------
// Facts on main: model/token totals and subagent fan-out. Published facts
// name no person, machine or time of day, so this is safe to aggregate.
// ---------------------------------------------------------------------------

const factsDir = join(mainDir, "facts");
const factFiles = listJSON(factsDir);

const modelTotals = new Map();
const hostCounts = {};
let subagentDispatches = 0;
const subagentBuckets = { "0": 0, "1-2": 0, "3-5": 0, "6+": 0 };

for (const f of factFiles) {
  const d = readJSON(join(factsDir, f), {});
  const host = d.session?.host || "unknown";
  hostCounts[host] = (hostCounts[host] || 0) + 1;

  for (const m of d.models || []) {
    const cur =
      modelTotals.get(m.id) ||
      { id: m.id, requests: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
    cur.requests += m.requests || 0;
    cur.input += m.tokens?.input || 0;
    cur.output += m.tokens?.output || 0;
    cur.cache_read += m.tokens?.cache_read || 0;
    cur.cache_write += m.tokens?.cache_write || 0;
    modelTotals.set(m.id, cur);
  }

  const agents = Array.isArray(d.agents) ? d.agents : [];
  const subCount = agents.filter(
    (a) => a.parent !== null && a.parent !== undefined,
  ).length;
  subagentDispatches += subCount;
  const bucket =
    subCount === 0 ? "0" : subCount <= 2 ? "1-2" : subCount <= 5 ? "3-5" : "6+";
  subagentBuckets[bucket] += 1;
}

const models = [...modelTotals.values()].sort((a, b) => b.requests - a.requests);
const totalModelRequests = models.reduce((s, m) => s + m.requests, 0);
const rootSessions = factFiles.length;
const sessionsWithSubagents = rootSessions - subagentBuckets["0"];

// ---------------------------------------------------------------------------
// Featured long-horizon sessions: the proof that, given durable context and
// an engineering lifecycle, an agent can carry a real task to a merged,
// reviewed result over a long span.
//
// This reads facts directly and deliberately bypasses the job-attribution
// layer (`jobs[]` / the `reports` branch's job hashes): the store currently
// holds a known batch of polluted job attributions (one session's work
// smeared across many job hashes), documented as a pending purge. Session
// records themselves are not affected by that bug, so picking the longest
// *sessions* with real public pull request references, then verifying each
// reference's merge state live against GitHub, is the honest way to prove
// this without repeating the pollution. This recomputes on every build, so
// it self-corrects as the store's data (and its attribution bugs) change.
// ---------------------------------------------------------------------------

const FEATURED_COUNT = 3;
const MAX_PR_LOOKUPS = 220;

const candidateSessions = [];
for (const f of factFiles) {
  const d = readJSON(join(factsDir, f), {});
  const prs = d.refs?.prs || [];
  if (d.session?.ended !== true || prs.length === 0) continue;
  const agents = Array.isArray(d.agents) ? d.agents : [];
  const humanWaitMs = (d.intervals || [])
    .filter((iv) => iv.kind === "human_wait")
    .reduce((s, iv) => s + Math.max(0, (iv.end_ms ?? 0) - (iv.start_ms ?? 0)), 0);
  const toolCallsTotal = Object.values(d.counts?.tool_calls || {}).reduce((a, b) => a + b, 0);
  const toolFailuresTotal = Object.values(d.counts?.tool_failures || {}).reduce((a, b) => a + b, 0);
  const prRepoCounts = new Map();
  for (const pr of prs) {
    prRepoCounts.set(pr.repo, (prRepoCounts.get(pr.repo) || 0) + 1);
  }
  candidateSessions.push({
    session_id: d.session.id,
    host: d.session.host,
    duration_ms: d.session.duration_ms,
    active_ms: Math.max(0, d.session.duration_ms - humanWaitMs),
    subagent_count: agents.filter((a) => a.parent !== null && a.parent !== undefined).length,
    tool_calls_total: toolCallsTotal,
    tool_failures_total: toolFailuresTotal,
    models: (d.models || []).map((m) => ({ id: m.id, requests: m.requests })).sort((a, b) => b.requests - a.requests),
    pr_repos: [...prRepoCounts.entries()].map(([repo, count]) => ({ repo, count })),
    prs,
  });
}

candidateSessions.sort((a, b) => b.duration_ms - a.duration_ms);
const featuredCandidates = candidateSessions.slice(0, FEATURED_COUNT);

const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
async function checkMerged(repo, number) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "factory-site-build",
        ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
      },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return { merged: body.merged === true, merged_at: body.merged_at, url: body.html_url };
  } catch {
    return null;
  }
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
for (const s of featuredCandidates) {
  const prsToCheck = s.prs.slice(0, Math.max(0, MAX_PR_LOOKUPS - prLookupsUsed));
  prLookupsUsed += prsToCheck.length;
  const results = await mapLimit(prsToCheck, 8, (pr) => checkMerged(pr.repo, pr.number));
  const checked = results.filter((r) => r !== null);
  const merged = checked.filter((r) => r.merged).length;

  // One representative merged PR per repo (the highest-numbered = most
  // recent in that repo), so the page can link to concrete, clickable proof
  // without needing to name a session.
  const byRepoLatest = new Map();
  results.forEach((r, idx) => {
    if (!r || !r.merged) return;
    const pr = prsToCheck[idx];
    const cur = byRepoLatest.get(pr.repo);
    if (!cur || pr.number > cur.number) {
      byRepoLatest.set(pr.repo, { repo: pr.repo, number: pr.number, url: r.url });
    }
  });

  featured.push({
    session_id: s.session_id,
    host: s.host,
    duration_ms: s.duration_ms,
    active_ms: s.active_ms,
    subagent_count: s.subagent_count,
    tool_calls_total: s.tool_calls_total,
    tool_failures_total: s.tool_failures_total,
    models: s.models,
    pr_repos: s.pr_repos,
    prs_total: s.prs.length,
    prs_checked: checked.length,
    prs_merged: merged,
    sample_merged_prs: [...byRepoLatest.values()],
    verification: checked.length === s.prs.length ? "verified" : checked.length > 0 ? "partial" : "unavailable",
  });
}

// ---------------------------------------------------------------------------
// Intake over time: published facts carry no clock time by design ("no
// when"), but the commit that first adds a facts file to `main` is a public,
// ordinary Git fact (same as any GitHub contribution, visible on any pull
// request) and is the only legitimate source for a "sessions over time"
// panel. Bucketed by hour: the store's whole history so far spans under two
// days, so daily buckets would flatten the one trend there is to see.
// ---------------------------------------------------------------------------

let intakeOverTime = [];
try {
  const log = execFileSync(
    "git",
    [
      "-C",
      mainDir,
      "log",
      "--diff-filter=A",
      "--name-only",
      "--pretty=format:C|%cI",
      "--",
      "facts/",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const hourCounts = new Map();
  let currentHour = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("C|")) {
      currentHour = line.slice(2, 15); // YYYY-MM-DDTHH
    } else if (line.trim().startsWith("facts/") && currentHour) {
      hourCounts.set(currentHour, (hourCounts.get(currentHour) || 0) + 1);
    }
  }
  intakeOverTime = [...hourCounts.entries()]
    .filter(([hour]) => !hour.startsWith("1970-01-01")) // the fixed-metadata bootstrap commit
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, count]) => ({ hour: `${hour}:00`, count }));
} catch {
  intakeOverTime = [];
}

// ---------------------------------------------------------------------------
// Kaizen / andon issues: best-effort, unauthenticated read of the public
// repo's issues. Never blocks the build if the network is unavailable.
// ---------------------------------------------------------------------------

async function fetchIssues(label) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/ourostack/factory/issues?state=all&labels=${encodeURIComponent(label)}&per_page=50`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "factory-site-build",
        },
      },
    );
    if (!res.ok) return [];
    const items = await res.json();
    return items
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        url: i.html_url,
        created_at: i.created_at,
      }));
  } catch {
    return [];
  }
}

const [kaizenIssues, andonIssues] = await Promise.all([
  fetchIssues("kaizen"),
  fetchIssues("andon"),
]);

// ---------------------------------------------------------------------------
// Takeaways: every number here is read from the data above, not typed in.
// Re-running this script against a later store rebuild changes the numbers
// and the sentences together.
// ---------------------------------------------------------------------------

function pct(n, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

const takeaways = [];

if (coverageRaw.sessions_with_facts > 0) {
  const share = coverageRaw.unattributed_sessions / coverageRaw.sessions_with_facts;
  takeaways.push({
    id: "attribution",
    text: `${coverageRaw.unattributed_sessions} of ${coverageRaw.sessions_with_facts} sessions with published facts (${pct(share)}) are not yet bound to any tracked job — they ran, but nothing links them to a task.`,
    n: coverageRaw.sessions_with_facts,
    small_sample: false,
  });
}

if (flowEfficiency.jobs_counted > 0) {
  const n = flowEfficiency.jobs_counted;
  takeaways.push({
    id: "flow_efficiency",
    text: `Across the ${n} jobs with enough evidence to measure it, flow efficiency (active time inside the lead-time window, divided by lead time) has a median of ${pct(flowEfficiency.median)} and a 75th percentile of ${pct(flowEfficiency.p75)} — most tracked lead time is currently wait, not work.`,
    n,
    small_sample: n < 15,
  });
}

{
  const eligible = toolKinds.filter((t) => t.calls >= 50);
  const worst = [...eligible].sort((a, b) => b.failure_rate - a.failure_rate)[0];
  if (worst) {
    takeaways.push({
      id: "tool_failures",
      text: `"${worst.tool}" calls fail most often among tool kinds used at least 50 times: ${pct(worst.failure_rate, 1)} of ${worst.calls.toLocaleString()} calls (${worst.failures.toLocaleString()} failures).`,
      n: worst.calls,
      small_sample: false,
    });
  }
}

if (models.length > 0 && totalModelRequests > 0) {
  const top = models[0];
  takeaways.push({
    id: "model_concentration",
    text: `${top.id} accounts for ${pct(top.requests / totalModelRequests)} of the ${totalModelRequests.toLocaleString()} model requests recorded across every published session.`,
    n: totalModelRequests,
    small_sample: false,
  });
}

if (rootSessions > 0) {
  const share = sessionsWithSubagents / rootSessions;
  takeaways.push({
    id: "subagents",
    text: `${pct(share)} of sessions dispatch at least one subagent; the store has recorded ${subagentDispatches.toLocaleString()} subagent dispatches across ${rootSessions.toLocaleString()} sessions.`,
    n: rootSessions,
    small_sample: false,
  });
}

if (mudaOverall.jobs_labeled === 0) {
  takeaways.push({
    id: "waste_not_labeled",
    text: `0 of ${mudaOverall.jobs ?? jobs.length} jobs are fully labeled for waste yet, so no waste-type breakdown is possible — every session of a job needs an evaluator label first. Check back as labeling catches up.`,
    n: mudaOverall.jobs ?? jobs.length,
    small_sample: true,
  });
}

// ---------------------------------------------------------------------------
// Assemble and write
// ---------------------------------------------------------------------------

let reportsCommit = null;
try {
  reportsCommit = execFileSync("git", ["-C", reportsDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  reportsCommit = null;
}

const data = {
  schema: "factory-site/1",
  built_at: new Date().toISOString(),
  reports_commit: reportsCommit,
  coverage: {
    sessions_with_facts: coverageRaw.sessions_with_facts ?? factFiles.length,
    bound_sessions: coverageRaw.bound_sessions ?? null,
    unattributed_sessions: coverageRaw.unattributed_sessions ?? null,
    session_time_ms: coverageRaw.session_time_ms ?? null,
    unattributed_session_time_ms: coverageRaw.unattributed_session_time_ms ?? null,
    jobs: coverageRaw.jobs ?? jobs.length,
    jobs_open: coverageRaw.jobs_open ?? null,
    host_counts: hostCounts,
  },
  tool_kinds: toolKinds,
  time_breakdown: timeBreakdown,
  flow_efficiency: flowEfficiency,
  rework: {
    tool_failures: toolFailuresMeasure,
    tool_retries: toolRetriesMeasure,
  },
  job_status_counts: jobStatusCounts,
  jobs: jobs.sort((a, b) => (b.lead_time_ms ?? -1) - (a.lead_time_ms ?? -1)),
  models,
  subagents: {
    root_sessions: rootSessions,
    subagent_dispatches: subagentDispatches,
    sessions_with_subagents: sessionsWithSubagents,
    buckets: subagentBuckets,
  },
  intake_over_time: intakeOverTime,
  waste: {
    wastes: mudaRaw.wastes || [],
    jobs_total: mudaOverall.jobs ?? jobs.length,
    jobs_labeled: mudaOverall.jobs_labeled ?? 0,
    jobs_excluded: mudaOverall.jobs_excluded ?? [],
    breakdown: mudaOverall.wastes ?? [],
  },
  kaizen_issues: kaizenIssues,
  andon_issues: andonIssues,
  featured,
  takeaways,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(data), "utf8");

console.log(
  `factory site data: ${jobs.length} jobs, ${factFiles.length} facts files, ${toolKinds.length} tool kinds, ${models.length} models, ${kaizenIssues.length} kaizen issues, ${andonIssues.length} andon issues, ${featured.length} featured sessions (${prLookupsUsed} PR lookups) -> ${outFile}`,
);
