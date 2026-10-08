// The PR clock in the Pages build: each pull request's opened and merged
// times on the task clock, and the GitHub reads behind them.
//
// The clock anchor and the placement (prAnchor, placePrs, prClock) live in
// site/src/walk.js, beside the map file that uses them, and are re-exported
// here so the build and S1's finish dates use the one anchor. This module
// adds the build's side: the pull reader (one read per pull request per
// build, a cache across builds, and the lookup cap) and the reads file that
// publish-files.mjs places. Design: v1.1 addendum §2 and §3.

import { createRequire } from "node:module";

const W = createRequire(import.meta.url)("../src/walk.js");
export const { ANCHOR_SPREAD_MS, ANCHOR_PLACE_LIMIT_MS, prKey, prAnchor, placePrs, prClock, validPr } = W;
export const listStates = W.clockListStates;

// How many requests for pull requests one build makes to GitHub, across
// every use (the PR clock and finish days, task names, featured sessions).
// 341 pull requests were on the task timelines on 2026-10-08. A pull
// request final in the cache costs no request; one beyond the cap reads as
// not read, with the reason github_lookup_capped. The workflow token allows
// 1,000 requests an hour per repository, and the cache keeps most builds
// far below the cap.
export const MAX_PR_LOOKUPS = 600;

// The cap one build uses: MAX_PR_LOOKUPS, unless the tests set
// FACTORY_SITE_MAX_PR_LOOKUPS to prove that the cap holds.
export function maxLookups(env = process.env) {
  const n = Number(env.FACTORY_SITE_MAX_PR_LOOKUPS);
  return env.FACTORY_SITE_MAX_PR_LOOKUPS && Number.isInteger(n) && n >= 0 ? n : MAX_PR_LOOKUPS;
}

// The fields of a pulls API body the build uses, and nothing else (no
// author, no body text).
function trim(b) {
  return {
    title: typeof b.title === "string" ? b.title : null,
    created_at: typeof b.created_at === "string" ? b.created_at : null,
    merged_at: typeof b.merged_at === "string" ? b.merged_at : null,
    state: b.state === "open" ? "open" : "closed",
    merged: b.merged === true || typeof b.merged_at === "string",
    html_url: typeof b.html_url === "string" ? b.html_url : null,
    base: { repo: { private: b.base?.repo?.private === false ? false : true } },
  };
}

// Only a merged pull request is final: its opened and merged times no
// longer change, so a cached body answers without a request. A closed one
// may be reopened or merged, so it is asked again with its ETag.
const isFinal = (b) => !!b && (b.merged === true || typeof b.merged_at === "string");

// One reader per build. read(repo, number) resolves to the trimmed body,
// or null when it could not be read this build (failed, capped or
// offline): a failed read is never answered from an older cached body, so
// it reads "GitHub could not be read", never a stale time.
//   fetch(url, headers) -> Response-like { ok, status, headers, json() }
//   cache: a factory.site.pulls-cache/1 document from an earlier build
//   max: how many requests this build may make
// `bodies` and `capped` are prAnchor's `gh` and `capped`; `counts` and
// summary() report the reads; cacheDoc() is the cache for the next build.
export function createPullReader({ fetch: fetchImpl, cache = null, max = MAX_PR_LOOKUPS, offline = false } = {}) {
  const entries = new Map(Object.entries(cache && cache.schema === "factory.site.pulls-cache/1" && cache.pulls && typeof cache.pulls === "object" ? cache.pulls : {}).filter(([, e]) => e && typeof e === "object" && e.body && typeof e.body === "object"));
  const pending = new Map();
  const bodies = new Map();
  const capped = new Set();
  const counts = { requests: 0, fetched: 0, not_modified: 0, final_from_cache: 0, failed: 0, capped: 0, invalid: 0 };
  async function load(key, repo, number) {
    const old = entries.get(key);
    if (old && isFinal(old.body)) {
      counts.final_from_cache += 1;
      return old.body;
    }
    if (offline || typeof fetchImpl !== "function") return null;
    if (counts.requests >= max) {
      capped.add(key);
      counts.capped += 1;
      return null;
    }
    counts.requests += 1;
    const headers = old && typeof old.etag === "string" ? { "If-None-Match": old.etag } : {};
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${number}`, headers);
      if (res.status === 304 && old) {
        counts.not_modified += 1;
        return old.body;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = trim(await res.json());
      const etag = res.headers && typeof res.headers.get === "function" ? res.headers.get("etag") : null;
      entries.set(key, { etag: etag || null, body });
      counts.fetched += 1;
      return body;
    } catch {
      counts.failed += 1;
      return null;
    }
  }
  function read(repo, number) {
    // A malformed owner/name or number never reaches a GitHub URL.
    if (!validPr(repo, number)) {
      counts.invalid += 1;
      return Promise.resolve(null);
    }
    const key = `${repo}#${number}`;
    if (!pending.has(key)) {
      pending.set(
        key,
        load(key, repo, number).then((b) => {
          bodies.set(key, b);
          return b;
        }),
      );
    }
    return pending.get(key);
  }
  const summary = () => `GitHub pull request reads: ${counts.requests} requests (${counts.fetched} fetched, ${counts.not_modified} not modified, ${counts.final_from_cache} final from the cache, ${counts.failed} failed, ${counts.capped} capped, ${counts.invalid} invalid)`;
  const cacheDoc = () => ({ schema: "factory.site.pulls-cache/1", pulls: Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) });
  return { read, bodies, capped, counts, summary, cacheDoc };
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
  return { schema: "factory.site.pulls/1", max_lookups: maxLookups(), pulls, capped: stopped };
}

