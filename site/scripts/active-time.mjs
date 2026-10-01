// Active time and the site's session scope, pure.
//
// A session's active time is the union of its `turn`, `tool` and `subagent`
// intervals: overlaps count once, and waits (`human_wait` and any other kind)
// never count. Facts written before intervals existed have none, so they give
// 0. Offsets are milliseconds from the session start.

export const SUBSTANTIAL_ACTIVE_MS = 5 * 60 * 1000;

const ACTIVE_KINDS = new Set(["turn", "tool", "subagent"]);

export function activeMs(facts) {
  const intervals = Array.isArray(facts?.intervals) ? facts.intervals : [];
  const spans = [];
  for (const i of intervals) {
    if (!i || !ACTIVE_KINDS.has(i.kind)) continue;
    if (!Number.isFinite(i.start_ms) || !Number.isFinite(i.end_ms) || i.end_ms <= i.start_ms) continue;
    spans.push([i.start_ms, i.end_ms]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [s, e] of spans) {
    if (curEnd === null || s > curEnd) {
      if (curEnd !== null) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd !== null) total += curEnd - curStart;
  return total;
}

export function isBound(facts) {
  return Array.isArray(facts?.jobs) && facts.jobs.length > 0;
}

// A session is in scope when it is bound to a job, or was active for at
// least five minutes. Wall-clock length does not count: a session left open
// overnight is not substantial work.
export function inScope(facts) {
  return isBound(facts) || activeMs(facts) >= SUBSTANTIAL_ACTIVE_MS;
}
