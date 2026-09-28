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

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function medianP75(values) {
  const clean = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  return { jobs_counted: clean.length, median: percentile(clean, 50), p75: percentile(clean, 75) };
}

// ---------------------------------------------------------------------------
// Rollups (already computed by factory-build; we read them, never re-derive)
// ---------------------------------------------------------------------------

const coverageRaw = readJSON(join(reportsDir, "rollups/coverage.json"), {});
const measuresRaw = readJSON(join(reportsDir, "rollups/measures.json"), {
  groupings: {},
});
const mudaRaw = readJSON(join(reportsDir, "rollups/muda.json"), {
  groupings: {},
  wastes: [],
});

const overallMeasures = measuresRaw.groupings?.overall?.all?.measures || {};

function measure(key) {
  const m = overallMeasures[key];
  if (!m) return { jobs_counted: 0, median: null, p75: null };
  return { jobs_counted: m.jobs_counted, median: m.median, p75: m.p75 };
}

// Rework signal counts (tool_failures, tool_retries) are per-job totals
// against whatever sessions a job has, not a lead-time ratio, so the
// pre-capture gap described below does not distort them; read straight
// from the rollup.
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
  const waits = F.waits || {};
  const waitVal = (k) => (waits[k] && "value" in waits[k] ? waits[k].value : null);
  return {
    id: d.job || f.replace(/\.json$/, ""),
    status: val("status") ?? "unavailable",
    status_class: F.status?.class ?? "unavailable",
    lead_time_ms: val("lead_time_ms"),
    lead_time_class: F.lead_time_ms?.class ?? "unavailable",
    active_time_ms: val("active_time_ms"),
    flow_efficiency: val("flow_efficiency"),
    queue_before_start_ms: val("queue_before_start_ms"),
    human_wait_ms: waitVal("human_wait_ms"),
    api_retry_ms: waitVal("api_retry_ms"),
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
// Flow efficiency and "where time goes", scoped to jobs whose whole life
// falls inside capture.
//
// A job's lead time is measured on the job's own clock, starting at 0 when
// its card was created. `queue_before_start_ms` is the offset of the first
// captured session bound to that job. When a card was created before the
// store had any way to capture the work already happening on it (or before
// the operator started that work), that offset can be large: days of lead
// time with no session recorded for them, which is not real waiting and
// drags flow efficiency toward zero for a reason that has nothing to do with
// how the work actually went. A job whose first bound session starts at or
// before its recorded start (`queue_before_start_ms === 0`) has no such gap.
//
// A second, separate censoring problem: an open job's lead time so far is
// not its real lead time, only a running total that will keep growing, and
// mixing that into a median with jobs that actually finished would be its
// own artifact. So this also requires the job to have reached `done`: a
// concluded life, entirely inside capture. This recomputes on every build,
// so it tracks the store as more jobs finish and as capture grows.
// ---------------------------------------------------------------------------

const fullyCapturedJobs = jobs.filter(
  (j) => j.queue_before_start_ms === 0 && j.status === "done",
);

const scopedTimeBreakdown = [
  { key: "active_time", label: "Active work", values: fullyCapturedJobs.map((j) => j.active_time_ms) },
  { key: "human_wait", label: "Waiting on a human", values: fullyCapturedJobs.map((j) => j.human_wait_ms) },
  { key: "api_retry_wait", label: "Waiting on API retries", values: fullyCapturedJobs.map((j) => j.api_retry_ms) },
].map(({ key, label, values }) => ({ key, label, ...medianP75(values) }));

const scopedFlowEfficiency = {
  ...medianP75(fullyCapturedJobs.map((j) => j.flow_efficiency)),
  eligible_jobs: fullyCapturedJobs.length,
  jobs_total: jobs.length,
};

// ---------------------------------------------------------------------------
// Facts on main: session population, and the subset that loaded Desk.
//
// Published facts name no person, machine or time of day, so this is safe
// to aggregate. Most sessions published from a contributing machine never
// loaded Desk at all (a desktop chat, a Copilot launcher session, a short
// exploratory run); the factory studies the work system Desk instruments,
// so every measure and takeaway below that describes "the work" is scoped
// to sessions whose published `plugins` list includes `desk`. The rest are
// reported once, plainly, as population context, never as a finding about
// the work.
// ---------------------------------------------------------------------------

const factsDir = join(mainDir, "facts");
const factFiles = listJSON(factsDir);

const allEntrypoints = {};
const deskEntrypoints = {};
let deskSessionCount = 0;
let deskBoundCount = 0;

const toolKindTotals = new Map(); // desk-scoped
const modelTotals = new Map(); // desk-scoped
let subagentDispatches = 0; // desk-scoped
let deskSessionsWithSubagents = 0;
const subagentBuckets = { "0": 0, "1-2": 0, "3-5": 0, "6+": 0 };

for (const f of factFiles) {
  const d = readJSON(join(factsDir, f), {});
  const entrypoint = d.session?.entrypoint || "unknown";
  allEntrypoints[entrypoint] = (allEntrypoints[entrypoint] || 0) + 1;

  const pluginNames = (d.plugins || []).map((p) => (typeof p === "string" ? p : p?.name));
  const loadedDesk = pluginNames.includes("desk");
  if (!loadedDesk) continue;

  deskSessionCount += 1;
  deskEntrypoints[entrypoint] = (deskEntrypoints[entrypoint] || 0) + 1;
  if (Array.isArray(d.jobs) && d.jobs.length > 0) deskBoundCount += 1;

  for (const [tool, calls] of Object.entries(d.counts?.tool_calls || {})) {
    const cur = toolKindTotals.get(tool) || { tool, calls: 0, failures: 0, sessions: 0 };
    cur.calls += calls;
    cur.sessions += 1;
    toolKindTotals.set(tool, cur);
  }
  for (const [tool, failures] of Object.entries(d.counts?.tool_failures || {})) {
    const cur = toolKindTotals.get(tool) || { tool, calls: 0, failures: 0, sessions: 0 };
    cur.failures += failures;
    toolKindTotals.set(tool, cur);
  }

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
  const subCount = agents.filter((a) => a.parent !== null && a.parent !== undefined).length;
  subagentDispatches += subCount;
  if (subCount > 0) deskSessionsWithSubagents += 1;
  const bucket = subCount === 0 ? "0" : subCount <= 2 ? "1-2" : subCount <= 5 ? "3-5" : "6+";
  subagentBuckets[bucket] += 1;
}

const toolKinds = [...toolKindTotals.values()]
  .map((t) => ({ ...t, failure_rate: t.calls > 0 ? t.failures / t.calls : null }))
  .sort((a, b) => b.calls - a.calls);

const models = [...modelTotals.values()].sort((a, b) => b.requests - a.requests);
const totalModelRequests = models.reduce((s, m) => s + m.requests, 0);

const otherSessionCount = factFiles.length - deskSessionCount;
const otherEntrypoints = {};
for (const [k, v] of Object.entries(allEntrypoints)) {
  otherEntrypoints[k] = v - (deskEntrypoints[k] || 0);
}

// ---------------------------------------------------------------------------
// Featured long-horizon sessions: the proof that, given durable context and
// an engineering lifecycle, an agent can carry a real task to a merged,
// reviewed result over a long span. This is a claim about agent capability
// in general, not about the Desk work system specifically, so it draws from
// every published session (any entrypoint, any plugin set) with a real
// public pull request reference, not only the Desk-scoped population above.
// This reads facts directly rather than through job attribution, so a job
// hash that several sessions share can never distort which sessions are
// picked; each candidate is a single session's own record. It recomputes on
// every build, so it stays accurate as the store's data changes.
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
const ghHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "factory-site-build",
  ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
};

async function checkMerged(repo, number) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, { headers: ghHeaders });
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
// Kaizen / andon issues: best-effort, unauthenticated-friendly reads of the
// public repo's issues. Never blocks the build if the network is
// unavailable. For a closed issue, the resolution names the countermeasure
// pull request when one is on the card (`countermeasure: <url>` in the
// auto-filed body) or, failing that, the first pull request linked in the
// closing comment - both live-checked for merge state, same as the featured
// sessions above.
// ---------------------------------------------------------------------------

const PR_URL_RE = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;

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
  try {
    const res = await fetch(
      `https://api.github.com/repos/ourostack/factory/issues?state=all&labels=${encodeURIComponent(label)}&per_page=50`,
      { headers: ghHeaders },
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
        body: i.body || "",
      }));
  } catch {
    return [];
  }
}

async function fetchLastComment(number) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/ourostack/factory/issues/${number}/comments?per_page=50`,
      { headers: ghHeaders },
    );
    if (!res.ok) return null;
    const items = await res.json();
    return items.length ? items[items.length - 1].body || "" : null;
  } catch {
    return null;
  }
}

async function enrichIssue(issue) {
  const { body, ...rest } = issue;
  if (issue.state !== "closed") return { ...rest, resolution: null };
  let link = extractCountermeasure(body);
  if (!link) {
    const lastComment = await fetchLastComment(issue.number);
    link = firstPrLink(lastComment);
  }
  if (!link) return { ...rest, resolution: { kind: "closed" } };
  const merge = await checkMerged(link.repo, link.number);
  return {
    ...rest,
    resolution: {
      kind: "countermeasure",
      repo: link.repo,
      number: link.number,
      url: merge?.url || `https://github.com/${link.repo}/pull/${link.number}`,
      merged: merge?.merged ?? null,
    },
  };
}

const [kaizenIssuesRaw, andonIssuesRaw] = await Promise.all([
  fetchIssues("kaizen"),
  fetchIssues("andon"),
]);
const kaizenIssues = await mapLimit(kaizenIssuesRaw, 4, enrichIssue);
const andonIssues = await mapLimit(andonIssuesRaw, 4, enrichIssue);
const kaizenRaised = kaizenIssues.length;
const kaizenResolved = kaizenIssues.filter((i) => i.state === "closed").length;

// ---------------------------------------------------------------------------
// Takeaways: every number here is read from the data above, not typed in.
// Re-running this script against a later store rebuild changes the numbers
// and the sentences together. Anything describing the work itself is scoped
// to sessions that loaded Desk, since that is the work system being studied;
// other sessions on contributing machines are reported once, as population
// context, never folded into a "finding" about the work.
// ---------------------------------------------------------------------------

function pct(n, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

const takeaways = [];

if (deskSessionCount > 0) {
  takeaways.push({
    id: "attribution",
    text: `Of the ${deskSessionCount} sessions that loaded Desk, ${deskBoundCount} are bound to a tracked job; the rest ran without a job attribution.`,
    n: deskSessionCount,
    small_sample: deskSessionCount < 15,
  });
}

if (scopedFlowEfficiency.jobs_counted > 0) {
  const n = scopedFlowEfficiency.jobs_counted;
  takeaways.push({
    id: "flow_efficiency",
    text: `Only ${n} of the ${jobs.length} tracked jobs both finished and had their whole life inside capture (no gap before the first recorded session); across just those ${n}, flow efficiency has a median of ${pct(scopedFlowEfficiency.median)}. Most jobs' cards predate capture, so their flow efficiency would be an artifact of that gap, not a real measure, and is left out here.`,
    n,
    small_sample: true,
  });
} else {
  takeaways.push({
    id: "flow_efficiency",
    text: `No job yet has both finished and had its whole life inside capture, so flow efficiency cannot be computed without the pre-capture gap distorting it. Check back as more jobs finish inside capture.`,
    n: 0,
    small_sample: true,
  });
}

{
  const eligible = toolKinds.filter((t) => t.calls >= 20);
  const worst = [...eligible].sort((a, b) => b.failure_rate - a.failure_rate)[0];
  if (worst) {
    takeaways.push({
      id: "tool_failures",
      text: `Among sessions that loaded Desk, "${worst.tool}" calls fail most often of the tool kinds used at least 20 times: ${pct(worst.failure_rate, 1)} of ${worst.calls.toLocaleString()} calls (${worst.failures.toLocaleString()} failures).`,
      n: worst.calls,
      small_sample: worst.calls < 100,
    });
  }
}

if (models.length > 0 && totalModelRequests > 0) {
  const top = models[0];
  takeaways.push({
    id: "model_concentration",
    text: `Among sessions that loaded Desk, ${top.id} accounts for ${pct(top.requests / totalModelRequests)} of the ${totalModelRequests.toLocaleString()} model requests recorded.`,
    n: totalModelRequests,
    small_sample: false,
  });
}

if (deskSessionCount > 0) {
  const share = deskSessionsWithSubagents / deskSessionCount;
  takeaways.push({
    id: "subagents",
    text: `${deskSessionsWithSubagents} of the ${deskSessionCount} sessions that loaded Desk (${pct(share)}) dispatch at least one subagent, ${subagentDispatches.toLocaleString()} dispatches in total.`,
    n: deskSessionCount,
    small_sample: deskSessionCount < 15,
  });
}

if (mudaOverall.jobs_labeled === 0) {
  takeaways.push({
    id: "waste_not_labeled",
    text: `Labeling has just started: 0 of ${mudaOverall.jobs ?? jobs.length} jobs are fully labeled for waste yet, though session-level labels already exist. A job's waste breakdown appears here once every one of its sessions is evaluated.`,
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
  schema: "factory-site/2",
  built_at: new Date().toISOString(),
  reports_commit: reportsCommit,
  coverage: {
    sessions_with_facts: coverageRaw.sessions_with_facts ?? factFiles.length,
    jobs: coverageRaw.jobs ?? jobs.length,
    jobs_open: coverageRaw.jobs_open ?? null,
  },
  scope: {
    sessions_total: factFiles.length,
    sessions_desk: deskSessionCount,
    sessions_desk_bound: deskBoundCount,
    sessions_other: otherSessionCount,
    entrypoints_desk: deskEntrypoints,
    entrypoints_other: otherEntrypoints,
  },
  tool_kinds: toolKinds,
  time_breakdown: scopedTimeBreakdown,
  flow_efficiency: scopedFlowEfficiency,
  rework: {
    tool_failures: toolFailuresMeasure,
    tool_retries: toolRetriesMeasure,
  },
  job_status_counts: jobStatusCounts,
  jobs: jobs.sort((a, b) => (b.lead_time_ms ?? -1) - (a.lead_time_ms ?? -1)),
  models,
  subagents: {
    root_sessions: deskSessionCount,
    subagent_dispatches: subagentDispatches,
    sessions_with_subagents: deskSessionsWithSubagents,
    buckets: subagentBuckets,
  },
  intake_over_time: intakeOverTime,
  waste: {
    wastes: mudaRaw.wastes || [],
    jobs_total: mudaOverall.jobs ?? jobs.length,
    jobs_labeled: mudaOverall.jobs_labeled ?? 0,
    jobs_excluded: mudaOverall.jobs_excluded ?? [],
    label_files: coverageRaw.labels?.files ?? 0,
    breakdown: mudaOverall.wastes ?? [],
  },
  kaizen: { raised: kaizenRaised, resolved: kaizenResolved },
  kaizen_issues: kaizenIssues,
  andon_issues: andonIssues,
  featured,
  takeaways,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(data), "utf8");

console.log(
  `factory site data: ${jobs.length} jobs, ${factFiles.length} facts files (${deskSessionCount} loaded Desk), ${toolKinds.length} tool kinds, ${models.length} models, ${kaizenIssues.length} kaizen issues, ${andonIssues.length} andon issues, ${featured.length} featured sessions (${prLookupsUsed} PR lookups) -> ${outFile}`,
);
