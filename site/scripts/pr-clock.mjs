// The PR clock: each pull request's opened and merged times on the task
// clock, and the list states of a task's operator prompts and pull requests.
//
// Desk times a pull request on the task clock (`timeline.prs[].at_ms`, the
// earliest timed mention in a session) but publishes no wall-clock anchor.
// GitHub publishes each pull request's `created_at` and `merged_at`. For a
// pull request the task's own session opened, `created_at - at_ms` is the
// instant the task card was created, to within seconds (the tool result
// against GitHub's clock). The median of that over the task's created and
// timed pull requests is the task's clock anchor, and it maps every GitHub
// time of the task's pull requests onto the task clock.
//
// Until Desk flags which pull requests a session created (`created`, facts
// /4), every timed pull request is a candidate, and one more than 2 minutes
// from the median (a pull request the session only looked at) is dropped.
// An anchor whose kept candidates span more than 2 minutes is partial, with
// no direction. A task with no candidate has no anchor, and its pull
// requests are placed only where the session itself timed one it created.
//
// The anchor's epoch value never leaves this module's callers' memory: the
// map file holds offsets on the task clock only. Design: v1.1 addendum §3.

import { createRequire } from "node:module";

export const ANCHOR_SPREAD_MS = 2 * 60 * 1000;
// How many pull requests one build reads from GitHub, across every use (the
// featured sessions, task names, the PR clock). 341 pull requests were on
// the task timelines on 2026-10-08. Each read is one request against the
// workflow token's limit of 1,000 requests per hour per repository; a pull
// request beyond the cap is not placed (`github_lookup_capped`).
export const MAX_PR_LOOKUPS = 600;

export const prKey = (p) => `${p.repo}#${p.number}`;

function timeOf(s) {
  const t = typeof s === "string" ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
}

const finite = (x) => typeof x === "number" && Number.isFinite(x);

function median(sorted) {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// Why GitHub gave no data for one pull request: the build read none at all,
// the cap stopped it, or the read failed (offline, private, rate-limited).
function githubReason(p, gh, capped) {
  if (!gh) return "github_not_read";
  if (capped && capped.has(prKey(p))) return "github_lookup_capped";
  return "github_unreadable";
}

const infoOf = (p, gh, capped) => (gh && !(capped && capped.has(prKey(p))) ? gh.get(prKey(p)) || null : null);

// One entry per pull request, in Desk's order, keeping the earliest timed
// mention and any `created: true`.
function unique(prs) {
  const out = new Map();
  for (const p of Array.isArray(prs) ? prs : []) {
    if (!p || typeof p.repo !== "string" || !Number.isInteger(p.number)) continue;
    const k = prKey(p);
    const cur = out.get(k);
    const created = typeof p.created === "boolean" ? p.created : null;
    if (!cur) {
      out.set(k, { repo: p.repo, number: p.number, at_ms: finite(p.at_ms) ? p.at_ms : null, created });
      continue;
    }
    if (finite(p.at_ms) && (cur.at_ms === null || p.at_ms < cur.at_ms)) cur.at_ms = p.at_ms;
    if (created === true || (cur.created === null && created === false)) cur.created = created;
  }
  return [...out.values()];
}

// The task's clock anchor: { state, reasons, bound?, basis, n, dropped?,
// spread_ms?, value_ms? }. `value_ms` is an epoch value for the build's own
// use; prClock strips it. `gh` is Map "repo#number" -> pulls API body (or
// null when unreadable), or null when the build read no GitHub data.
export function prAnchor(prs, gh, { capped } = {}) {
  const list = unique(prs);
  const flagged = list.some((p) => p.created !== null);
  const createdOnes = list.filter((p) => p.created === true);
  const basis = createdOnes.length || (flagged && list.every((p) => p.created !== null)) ? "created" : "timed";
  const pool = (basis === "created" ? createdOnes : list.filter((p) => p.created !== false)).filter((p) => p.at_ms !== null);
  if (!pool.length) return { state: "unavailable", reasons: [basis === "created" ? "no_created_timed_pr" : "no_timed_pr"], basis, n: 0 };
  const anchors = [];
  const missing = new Set();
  for (const p of pool) {
    const t = timeOf(infoOf(p, gh, capped)?.created_at);
    if (t === null) missing.add(githubReason(p, gh, capped));
    else anchors.push(t - p.at_ms);
  }
  if (!anchors.length) return { state: "unavailable", reasons: [...missing].sort(), basis, n: 0 };
  anchors.sort((a, b) => a - b);
  let kept = anchors;
  if (basis === "timed") {
    const mid = median(anchors);
    const near = anchors.filter((a) => Math.abs(a - mid) <= ANCHOR_SPREAD_MS);
    if (near.length) kept = near;
  }
  const spread = kept[kept.length - 1] - kept[0];
  const out = { basis, n: kept.length, dropped: anchors.length - kept.length, spread_ms: spread, value_ms: Math.round(median(kept)) };
  return spread <= ANCHOR_SPREAD_MS ? { state: "measured", reasons: [], ...out } : { state: "partial", bound: null, reasons: ["anchor_spread"], ...out };
}

// GitHub's state for a pull request: merged, open or closed; null when unread.
function stateOf(info) {
  if (!info) return null;
  if (timeOf(info.merged_at) !== null || info.merged === true) return "merged";
  return info.state === "open" ? "open" : "closed";
}

// Each pull request placed on the task clock:
//   { repo, number, created, opened_at_ms, opened_basis, merged_at_ms,
//     merged_basis, state, reasons }
// opened_basis: "desk" (the session timed the pull request it created),
// "pr_anchor" (GitHub's created_at through the anchor) or "not_placed";
// merged_basis: "pr_anchor", "not_merged" or "not_placed". Nothing is
// invented: a time with no source is null, with its reasons.
export function placePrs(prs, gh, anchor, { capped } = {}) {
  const usable = anchor && anchor.state !== "unavailable" && finite(anchor.value_ms);
  const noAnchor = anchor && anchor.state === "unavailable" ? anchor.reasons : ["no_timed_pr"];
  return unique(prs).map((p) => {
    const info = infoOf(p, gh, capped);
    const reasons = new Set();
    const ghMissing = info ? null : githubReason(p, gh, capped);
    let opened = null;
    let openedBasis = "not_placed";
    if (p.created === true && p.at_ms !== null) {
      opened = p.at_ms;
      openedBasis = "desk";
    } else {
      const t = timeOf(info?.created_at);
      if (t !== null && usable) {
        opened = Math.round(t - anchor.value_ms);
        openedBasis = "pr_anchor";
      } else if (ghMissing) reasons.add(ghMissing);
      else noAnchor.forEach((r) => reasons.add(r));
    }
    const state = stateOf(info);
    let merged = null;
    let mergedBasis = "not_placed";
    if (state === "open" || state === "closed") mergedBasis = "not_merged";
    else if (state === "merged") {
      const t = timeOf(info.merged_at);
      if (t !== null && usable) {
        merged = Math.round(t - anchor.value_ms);
        mergedBasis = "pr_anchor";
      } else (t === null ? ["merged_time_not_recorded"] : noAnchor).forEach((r) => reasons.add(r));
    } else reasons.add(ghMissing);
    return { repo: p.repo, number: p.number, created: p.created, opened_at_ms: opened, opened_basis: openedBasis, merged_at_ms: merged, merged_basis: mergedBasis, state, reasons: [...reasons].sort() };
  });
}

// The anchor as the map file states it (no epoch value) and every pull
// request placed through it.
export function prClock(prs, gh, opts = {}) {
  const a = prAnchor(prs, gh, opts);
  const { value_ms, ...anchor } = a;
  return { anchor, prs: placePrs(prs, gh, a, opts) };
}

// The build's GitHub reads for publish-files.mjs (factory.site.pulls/1):
// for each pull request key in `keys`, only its created_at, merged_at and
// state (null when unreadable), and the keys the lookup cap stopped. No
// title, author or other field is kept. The file stays in the build.
export function pullsDoc(bodies, capped, keys) {
  const pulls = {};
  const stopped = [];
  for (const k of [...new Set(keys)].sort()) {
    if (capped && capped.has(k)) {
      stopped.push(k);
      continue;
    }
    const b = bodies.get(k);
    pulls[k] = b && typeof b.created_at === "string" ? { created_at: b.created_at, merged_at: typeof b.merged_at === "string" ? b.merged_at : null, state: b.state === "open" ? "open" : "closed" } : null;
  }
  return { schema: "factory.site.pulls/1", max_lookups: MAX_PR_LOOKUPS, pulls, capped: stopped };
}

// The list states of a task's operator prompts and pull requests live in
// walk.js (the map file is built there), and are re-exported for the tests.
export const listStates = createRequire(import.meta.url)("../src/walk.js").clockListStates;
