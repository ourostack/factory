// Which way a partial figure lies, for every measure the site shows.
//
// A partial number is a figure the site could not see whole. A reader needs
// to know which way the true figure lies: "at least" (lower), "at most"
// (upper), or, when the causes pull opposite ways or the measure has no
// direction (a ratio, a median), "direction unknown". Every measure that can
// be partial has a row here. A measure with no row throws, so a new partial
// measure stops the build until someone decides its direction; the numbers
// check (check-numbers.mjs) refuses any partial number without one.
//
// Rules:
//   lower             always a lower bound
//   upper             always an upper bound
//   unknown           no direction
//   lower_if_censored a lower bound only when the job is still open
//   from_reasons      read from the reasons (below)
//
// `from_reasons`: a shared worker's time and counts are counted for every
// job that shares it, so `worker_shared` pulls the figure up (upper). Every
// other reason says some of the work was not seen or not counted (a log cut
// short, a host that records only part, a session split across jobs whose
// share is left out), which pulls it down (lower). Both together: unknown.
//
// Decided from Desk's pipeline (`pipeline/formulas.js`, `number-states.js`):
// waits are a union of wait intervals over the sessions whose clock is known
// and never carry `worker_shared`, so a partial wait is a lower bound. The
// queue before the first session is the earliest known session start, so a
// session whose start was lost can only make it shorter: an upper bound.

const FROM = "from_reasons";

export const DIRECTIONS = Object.freeze({
  // Per-job report measures (jobs table and job page).
  lead_time_ms: "lower_if_censored",
  queue_before_start_ms: "upper",
  active_time_ms: FROM,
  busy_time_ms: FROM,
  flow_efficiency: "unknown",
  human_wait_ms: FROM,
  permission_wait_ms: FROM,
  api_retry_ms: FROM,
  compaction_ms: FROM,
  tool_failures: FROM,
  tool_retries: FROM,
  api_retries: FROM,
  session_retouches: FROM,
  public_prs: FROM,
  public_commits: FROM,
  private_prs: FROM,
  private_commits: FROM,
  tokens_total: FROM,
  tokens_input: FROM,
  tokens_output: FROM,
  tokens_reasoning: FROM,
  tokens_cache_read: FROM,
  tokens_cache_write: FROM,
  sessions_bound: "lower",
  // Rollups the site computes over measured members, and the pipeline's
  // totals (which add sessions the host records partly as a lower bound).
  sum: "lower",
  max: "lower",
  median: "unknown",
  p75: "unknown",
  share: "unknown",
  rate: "unknown",
  pipeline_total: "lower",
  // One session's own numbers, and counts read live from GitHub.
  session_active_ms: "lower",
  session_tool_calls: "lower",
  session_tool_failures: "lower",
  session_counter: "lower",
  prs_merged: "lower",
  issues_first_page: "lower",
});

function fromReasons(reasons) {
  const up = reasons.includes("worker_shared");
  const down = reasons.some((r) => r !== "worker_shared");
  if (up && down) return "unknown";
  return up ? "upper" : "lower";
}

export function directionOf(measure, reasons) {
  if (!Object.hasOwn(DIRECTIONS, measure)) throw new Error(`no bound direction for the measure ${measure}`);
  const rule = DIRECTIONS[measure];
  if (rule === FROM) return fromReasons(reasons);
  if (rule === "lower_if_censored") return reasons.length > 0 && reasons.every((r) => r === "censored") ? "lower" : "unknown";
  return rule;
}

// The number with its direction when partial, and without any bound
// otherwise. The measure must have a row even when the number is whole.
export function direct(number, measure) {
  const direction = directionOf(measure, Array.isArray(number?.reasons) ? number.reasons : []);
  if (!number || number.state !== "partial") {
    if (number && "bound" in number) {
      const { bound, ...rest } = number;
      return rest;
    }
    return number;
  }
  return { ...number, bound: direction };
}
