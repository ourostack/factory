// The finish day of a task, with the source it rests on.
//
// Every task gets a `finish_date`, a stated number whose value is a UTC day
// ("YYYY-MM-DD") and whose `basis` says where it came from. The first rung of
// this ladder that gives a day wins:
//
//   1. desk_transition / desk_card_updated: Desk's own `finished_on` (job
//      report `timeline.finished_on`). The day of the session's last move
//      into done or cancelled is measured; the day of the card's last update
//      is an upper bound, because a card can be edited after it is done.
//   2. pr_anchor: the day of (the task's clock anchor + the end of its lead
//      window). The anchor is the median, over the task's timed pull
//      requests, of GitHub's created_at minus the pull request's time on the
//      task's clock; that is the instant the task's clock started. Measured
//      when the anchors span at most 2 minutes, else partial.
//   3. labels_landed: the UTC day of the commit that first added the task's
//      labels to main. Labels are written when a task is done, so the task
//      finished on or before that day: an upper bound.
//   4. Otherwise unavailable, with a reason. A pull-request day later than the
//      labels' day is refused for the labels' day, published with the conflict
//      (`anchor_after_labels`) and no direction.
//
// Desk's fields may be absent (an older Desk) or present; both work. The
// store never writes a time of day, only the day.

import { direct } from "./bounds.mjs";
import { measured, partial, unavailable } from "./state.mjs";

export const MIN_DAY = "2025-01-01";
// Anchors this far apart (or less) agree; a pull request further from the
// median than this is one the session only looked at, and is left out.
export const ANCHOR_SPREAD_MS = 120000;
const DAY_MS = 86400000;
const PR_REPO = /^(?!\.{1,2}\/)[A-Za-z0-9._-]+\/(?!\.{1,2}$)[A-Za-z0-9._-]+$/;
const FINISHED = new Set(["done", "cancelled"]);
const DESK_BASES = { transition: "desk_transition", card_updated: "desk_card_updated" };

// The UTC day of an epoch time in milliseconds.
export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// A real calendar day, no earlier than 2025-01-01 and not after `today`.
export function validDay(s, today) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t) || utcDay(t) !== s) return false;
  return s >= MIN_DAY && s <= today;
}

// The ISO week (UTC, Monday start) of a "YYYY-MM-DD" day: its label and the
// day it starts on.
export function isoWeek(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(t).getUTCDay() + 6) % 7; // Monday is 0
  const monday = t - weekday * DAY_MS;
  const thursday = monday + 3 * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const firstThursday = Date.parse(`${year}-01-04T00:00:00Z`);
  const firstMonday = firstThursday - ((new Date(firstThursday).getUTCDay() + 6) % 7) * DAY_MS;
  const n = Math.round((monday - firstMonday) / (7 * DAY_MS)) + 1;
  return { week: `${year}-W${String(n).padStart(2, "0")}`, starts_on: utcDay(monday) };
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// samples: [{ at_ms, created_ms, created? }], a task's timed pull requests
// with GitHub's created_at (epoch ms). Returns { ms, spread_ms, n, dropped }
// or null when no pull request can anchor the clock.
//
// When Desk says which pull requests the session itself created (`created`
// is true on at least one), only those anchor: a pull request the session
// merely looked at was made before the task's clock began. Before Desk says
// so, every timed pull request counts, and any whose anchor lies more than 2
// minutes from the median is dropped.
export function prAnchor(samples) {
  const usable = (Array.isArray(samples) ? samples : []).filter((s) => s && Number.isFinite(s.at_ms) && s.at_ms >= 0 && Number.isFinite(s.created_ms));
  const flagged = usable.some((s) => s.created === true);
  const pool = flagged ? usable.filter((s) => s.created === true) : usable.filter((s) => s.created !== false);
  if (!pool.length) return null;
  const anchors = pool.map((s) => s.created_ms - s.at_ms);
  const mid = median(anchors);
  const kept = anchors.filter((a) => Math.abs(a - mid) <= ANCHOR_SPREAD_MS);
  return { ms: median(kept), spread_ms: Math.max(...kept) - Math.min(...kept), n: kept.length, dropped: anchors.length - kept.length };
}

// prs: a job report's timeline.prs[]. getCreated(repo, number) -> GitHub's
// created_at as epoch ms, or null when it cannot be read. Each pull request
// is read once.
export async function anchorFromPulls(prs, getCreated) {
  const timed = (Array.isArray(prs) ? prs : []).filter((p) => p && PR_REPO.test(p.repo || "") && Number.isSafeInteger(p.number) && p.number > 0 && Number.isFinite(p.at_ms));
  const seen = new Set();
  const once = timed.filter((p) => !seen.has(`${p.repo}#${p.number}`) && seen.add(`${p.repo}#${p.number}`));
  const created = await Promise.all(once.map((p) => getCreated(p.repo, p.number)));
  return prAnchor(once.map((p, i) => ({ at_ms: p.at_ms, created_ms: created[i], created: typeof p.created === "boolean" ? p.created : null })));
}

// What the ladder reads from a job report (jobs/<job>.json): Desk's
// `timeline.finished_on` envelope, the lead window, and the timed pull
// requests. A report without them gives nulls and an empty list.
export function finishInputsOf(report) {
  const t = report && typeof report === "object" && report.timeline && typeof report.timeline === "object" ? report.timeline : {};
  const prs = (Array.isArray(t.prs) ? t.prs : [])
    .filter((p) => p && typeof p.repo === "string" && PR_REPO.test(p.repo) && Number.isSafeInteger(p.number) && p.number > 0 && Number.isFinite(p.at_ms) && p.at_ms >= 0)
    .map((p) => ({ repo: p.repo, number: p.number, at_ms: p.at_ms, ...(typeof p.created === "boolean" ? { created: p.created } : {}) }));
  return {
    desk: t.finished_on && typeof t.finished_on === "object" ? t.finished_on : null,
    leadWindow: t.lead_window && typeof t.lead_window === "object" ? t.lead_window : null,
    prs,
  };
}

const sorted = (reasons) => [...new Set(reasons)].sort();

function stated(value, reasons, basis) {
  const rs = sorted(reasons);
  return direct(rs.length ? { ...partial(value, rs), basis } : { ...measured(value), basis }, "finish_date");
}

// Rung 1. Desk's envelope, when it holds a usable day.
function fromDesk(desk, today) {
  if (!desk || (desk.state !== "measured" && desk.state !== "partial")) return null;
  const basis = DESK_BASES[desk.basis];
  if (!basis || !validDay(desk.value, today)) return null;
  const reasons = Array.isArray(desk.reasons) ? desk.reasons.filter((r) => typeof r === "string" && r) : [];
  if (desk.state === "partial" && reasons.length === 0) return null;
  const out = stated(desk.value, desk.state === "partial" ? reasons : [], basis);
  // Desk's own direction stands when it states one.
  if (out.state === "partial" && (desk.bound === "lower" || desk.bound === "upper")) out.bound = desk.bound;
  return out;
}

// Rung 2. The anchor plus the end of the lead window.
function fromAnchor(anchor, leadWindow, today) {
  if (!anchor || !Number.isFinite(anchor.ms) || !leadWindow || (leadWindow.state !== "measured" && leadWindow.state !== "partial")) return null;
  if (!Number.isFinite(leadWindow.end_ms) || leadWindow.end_ms < 0) return null;
  const day = utcDay(anchor.ms + leadWindow.end_ms);
  if (!validDay(day, today)) return null;
  const reasons = [];
  if (anchor.spread_ms > ANCHOR_SPREAD_MS) reasons.push("anchor_spread");
  // A window that is partial only because the card's dates are shorter than the
  // work moves its start; its end is the end of the last recorded work, which is
  // on or after the card's move to done. Any other reason may move the end.
  if (leadWindow.state === "partial") {
    const only = Array.isArray(leadWindow.reasons) && leadWindow.reasons.length > 0 && leadWindow.reasons.every((r) => r === "card_dates_shorter_than_work");
    reasons.push(only ? "finish_from_last_work" : "lead_window_partial");
  }
  return stated(day, reasons, "pr_anchor");
}

// The finish day of one task.
//   status: the card's status word ("done", "cancelled", ...)
//   desk: Desk's timeline.finished_on envelope, or null
//   leadWindow: the job report's timeline.lead_window, or null
//   anchor: prAnchor's result, or null
//   labelsDay: the UTC day the task's labels first landed on main, or null
//   today: the UTC day the build runs on
export function resolveFinishDate({ status, desk = null, leadWindow = null, anchor = null, labelsDay = null, today }) {
  if (status === "unavailable") return unavailable(["status_unavailable"]);
  if (!FINISHED.has(status)) return unavailable(["open_job"]);
  const labels = validDay(labelsDay, today) ? labelsDay : null;
  const fromDeskDay = fromDesk(desk, today);
  if (fromDeskDay) return fromDeskDay;
  // A desk that withholds job timing gets no finish day from any source.
  if (desk && desk.state === "unavailable" && Array.isArray(desk.reasons) && desk.reasons.includes("job_offsets_withheld")) return unavailable(["job_offsets_withheld"]);
  const anchored = fromAnchor(anchor, leadWindow, today);
  // Labels are written when a task is done, so an anchored day after the day
  // they landed cannot be published as it stands. The labels day is published
  // with the conflict: it is not "on or before" when the task was reopened.
  if (anchored && labels && anchored.value > labels) return stated(labels, ["anchor_after_labels"], "labels_landed");
  if (anchored) return anchored;
  if (labels) return stated(labels, ["finish_from_labels_landing"], "labels_landed");
  return unavailable(["no_finish_source"]);
}

// The direction in the rollup and map files is `null` with a `bound_reason`
// where there is none to state, as Desk writes it. data.json says "unknown".
export function forRollupFile(fd) {
  if (!fd || typeof fd !== "object" || fd.state !== "partial" || fd.bound !== "unknown") return fd;
  const why = ["anchor_spread", "lead_window_partial", "anchor_after_labels"].find((r) => (fd.reasons || []).includes(r));
  return { ...fd, bound: null, bound_reason: why || "bound_direction_undecided" };
}
