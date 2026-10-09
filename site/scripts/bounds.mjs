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
//   lower_if_censored a lower bound only when every reason is the job still being
//                     open, the task card's dates being shorter than the work
//                     its sessions recorded (Desk raises the lead time to that span),
//                     or no record giving the finish time (Desk runs the lead time
//                     to the end of the recorded work)
//   from_reasons      read from the reasons (below)
//   upper_if_awaiting an upper bound when every reason is a sign-off still
//                     awaited, else unknown
//   finish_date       a finish day (finish-date.mjs): an upper bound when its
//                     source is a later record (the card's last update, the
//                     labels' landing, the last recorded work), a lower bound
//                     when the clock anchor is unconfirmed (also when its
//                     timed pull requests disagree: every one of them is at or
//                     before the true start), no direction when pull requests
//                     the session opened disagree, the lead window may move
//                     its end, or the two pull in opposite ways
//   from_members      a sum over members (sumDirection below), read from the
//                     members' own directions, never from reasons
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
const LEAD_FLOORS = new Set(["censored", "card_dates_shorter_than_work", "finish_time_not_known"]);
const AWAITING = new Set(["awaiting_signoff"]);
// A finish day taken from a record written after the task finished is at or
// after the true day.
const FINISH_LATER_RECORD = new Set(["finish_from_card_update", "finish_from_labels_landing", "finish_from_last_work"]);
// The anchor rests on a pull request nothing confirms: it may predate the task, so the true finish is at or after the day shown. Desk's
// `finish_before_last_work`: the task's recorded work went on past the day, so it finished then or later (with a card update's "at most",
// the two pull both ways).
const FINISH_EARLIER_RECORD = new Set(["anchor_unconfirmed", "finish_before_last_work"]);
const FINISH_NO_DIRECTION = new Set(["lead_window_partial", "anchor_after_labels"]);
// Disagreeing pull requests have no direction of their own unless the anchor
// is also unconfirmed (a timed anchor, whose samples are all at or before
// the true start): then the day is at least the one shown.
const FINISH_SPREAD = "anchor_spread";

export { FINISH_LATER_RECORD, FINISH_EARLIER_RECORD };

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
  // Sign-off and rework. A first pass that awaits a sign-off may
  // still be sent back (upper); with returns lost too, it can go either way.
  // Returns counted with some lost are at least that many.
  first_pass_job: "upper_if_awaiting",
  first_pass_yield: "upper_if_awaiting",
  returns: FROM,
  attention_per_accepted: "lower",
  // A mean over the delivered tasks whose estimate is whole: the tasks left
  // out could cost more or less.
  attention_per_delivered: "unknown",
  // One job's attention estimate and the human turns it rests on: a
  // partial estimate misses turns, so it is at least this.
  attention_ms: "lower",
  human_turns: "lower",
  // One job's labeled time per waste, with some of its sessions not labeled.
  job_waste_ms: "lower",
  turns_per_accepted: "lower",
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
  // Capture coverage: a share whose host is unverified (Codex root sessions
  // not yet proven, or a listing that fell back), or that leaves out old or
  // invalid machine records, can be off either way.
  capture_share: "unknown",
  // Dates and trends by finish week. A day's direction comes from its
  // reasons; a week's sums from their members; a week's median has none.
  finish_date: "finish_date",
  week_sum: "from_members",
  week_median: "unknown",
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
  if (rule === "upper_if_awaiting") return reasons.length > 0 && reasons.every((r) => AWAITING.has(r)) ? "upper" : "unknown";
  if (rule === "finish_date") {
    if (reasons.some((r) => FINISH_NO_DIRECTION.has(r))) return "unknown";
    if (reasons.includes(FINISH_SPREAD) && !reasons.some((r) => FINISH_EARLIER_RECORD.has(r))) return "unknown";
    const up = reasons.some((r) => FINISH_LATER_RECORD.has(r));
    const down = reasons.some((r) => FINISH_EARLIER_RECORD.has(r));
    return up && down ? "unknown" : up ? "upper" : down ? "lower" : "unknown";
  }
  if (rule === "from_members") throw new Error(`the measure ${measure} takes its direction from its members: use sumDirection`);
  if (rule === "lower_if_censored") return reasons.length > 0 && reasons.every((r) => LEAD_FLOORS.has(r)) ? "lower" : "unknown";
  return rule;
}

// The direction of a ratio (part over whole, as flow efficiency is working
// over lead time) from its parts' own: a part that is at least, over a whole
// that is exact or at most, is at least; the reverse is at most; parts that
// pull the same way, or carry no direction, leave the ratio with none.
// Each argument is a stated number with its `bound` when partial.
export function ratioDirection(part, whole) {
  const dir = (n) => (!n || n.state === "measured" ? "exact" : n.state === "partial" && (n.bound === "lower" || n.bound === "upper") ? n.bound : "unknown");
  const a = dir(part);
  const b = dir(whole);
  if (a === "unknown" || b === "unknown") return "unknown";
  const up = a === "lower" || b === "upper";
  const down = a === "upper" || b === "lower";
  if (up && down) return "unknown";
  return up ? "lower" : down ? "upper" : "unknown";
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

// The direction of a sum over members (each a stated number): the members'
// shared direction, or `bound: null` with the reason there is none, the
// words Desk uses (`bound_reasons_conflict`, `bound_direction_undecided`).
// A member that is not there leaves the sum at least what it is (lower). A
// partial member whose file states no direction leaves the sum undecided.
export function sumDirection(members) {
  const dirs = new Set();
  const reasons = new Set();
  let exact = false;
  for (const m of members) {
    if (!m || m.state === "unavailable") dirs.add("lower");
    else if (m.state === "partial") {
      if (m.bound === "lower" || m.bound === "upper") dirs.add(m.bound);
      // Desk's bound_not_moved means the figure is exact: it adds nothing, like a measured member.
      else if (m.bound === null && m.bound_reason === "bound_not_moved") exact = true;
      else {
        dirs.add("none");
        reasons.add(m.bound === null && typeof m.bound_reason === "string" && m.bound_reason ? m.bound_reason : "bound_direction_undecided");
      }
    }
  }
  if (dirs.has("none")) return { bound: null, bound_reason: dirs.size === 1 && reasons.size === 1 ? [...reasons][0] : "bound_reasons_conflict" };
  if (dirs.size > 1) return { bound: null, bound_reason: "bound_reasons_conflict" };
  if (dirs.size === 1) return { bound: [...dirs][0] };
  return exact ? { bound: null, bound_reason: "bound_not_moved" } : {};
}
