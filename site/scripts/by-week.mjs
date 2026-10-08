// rollups/by_week.json (factory.site.by_week/1): finished tasks' time, by the
// ISO week (UTC, Monday start) in which each task finished.
//
// Built by the store from Desk's rollups/stackup.json and rollups/tasks.json
// and the store's own finish dates. A task's hours count in the week it
// finished, the usual Lean convention for lead time (`basis:
// "by_finish_week"`). Every week from the first finished task's to the last
// is listed; a week with no finished task is `{ n: 0 }` and never a zero bar.
// A finished task with no finish date is listed under `unplaced`.
//
// Every sum is a stated number. A sum over members that are all measured is
// measured. A sum with a partial or missing member is partial, with the
// members' reasons, and its direction is the members' shared one (a missing
// member makes it "at least"): where they differ, `bound` is null and
// `bound_reason` says why, as in Desk's own files. A week's flow-efficiency
// median is taken over the tasks whose own value is measured, and says how
// many (n of N).

import { sumDirection } from "./bounds.mjs";
import { forRollupFile, isoWeek } from "./finish-date.mjs";
import { measured, partial, unavailable } from "./state.mjs";

export const BY_WEEK_SCHEMA = "factory.site.by_week/1";
const FLOW_OF = "finished tasks with a flow efficiency figure";
const DAY_MS = 86400000;
const FINISHED = new Set(["done", "cancelled"]);

const isNumber = (m) => m && typeof m === "object" && m.state !== "unavailable" && Number.isFinite(m.value);

// The sum of stated numbers, as one stated number.
export function sumFigures(members) {
  const have = members.filter(isNumber);
  if (!have.length) return unavailable(["no_measured_members"]);
  const value = have.reduce((a, m) => a + m.value, 0);
  const reasons = new Set(have.filter((m) => m.state === "partial").flatMap((m) => m.reasons || []));
  if (have.length < members.length) reasons.add("unmeasured_members");
  if (!reasons.size && !have.some((m) => m.state === "partial")) return measured(value);
  if (!reasons.size) reasons.add("partial");
  return { ...partial(value, [...reasons].sort()), ...sumDirection(members.map((m) => (isNumber(m) ? m : null))) };
}

function medianOf(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// A week's median flow efficiency. When every task's figure is measured, it
// is measured. When the partial ones all lean one way (each true value at most
// its figure, or each at least), the median of the figures is bounded the
// same way, since a median moves with its members: it is the median of the n
// tasks with a figure, out of the week's N. When they lean both ways, or one
// has no direction, only the measured figures are used and the median has no
// direction (`median_of_subset`); with none measured there is no median
// (`bound_reasons_conflict`). Desk's `bound_not_moved` is an exact figure.
function flowMedian(figures) {
  const N = figures.length;
  const usable = figures.filter((f) => f && (f.state === "measured" || f.state === "partial") && Number.isFinite(f.value));
  const exact = (f) => f.state === "measured" || (f.bound === null && f.bound_reason === "bound_not_moved");
  const dirs = new Set(usable.filter((f) => !exact(f)).map((f) => (f.bound === "lower" || f.bound === "upper" ? f.bound : "none")));
  if (!usable.length) return { median: unavailable(["no_measured_members"]), n: 0, N, of: FLOW_OF };
  if (dirs.has("none") || dirs.size > 1) {
    const ok = usable.filter(exact);
    if (!ok.length) return { median: unavailable(["bound_reasons_conflict"]), n: 0, N, of: FLOW_OF };
    return { median: { ...partial(medianOf(ok.map((f) => f.value)), ["unmeasured_members"]), bound: null, bound_reason: "median_of_subset" }, n: ok.length, N, of: FLOW_OF };
  }
  const value = medianOf(usable.map((f) => f.value));
  const n = usable.length;
  if (!dirs.size && n === N && usable.every((f) => f.state === "measured")) return { median: measured(value), n, N, of: FLOW_OF };
  const reasons = new Set(usable.filter((f) => f.state === "partial").flatMap((f) => f.reasons || []));
  if (n < N) reasons.add("unmeasured_members");
  if (!reasons.size) reasons.add("unmeasured_members");
  const median = dirs.size ? { ...partial(value, [...reasons].sort()), bound: [...dirs][0] } : { ...partial(value, [...reasons].sort()), bound: null, bound_reason: "median_of_subset" };
  return { median, n, N, of: FLOW_OF };
}

// How many of a week's tasks have an exact finish day, an "on or before" day,
// an "on or after" day, or one with no direction: a week whose days are "on
// or before" may hold tasks that finished in earlier weeks.
function dayCounts(dates) {
  const c = { n_day_measured: 0, n_day_on_or_before: 0, n_day_on_or_after: 0, n_day_about: 0 };
  for (const d of dates) {
    if (d.state === "measured") c.n_day_measured += 1;
    else if (d.bound === "upper") c.n_day_on_or_before += 1;
    else if (d.bound === "lower") c.n_day_on_or_after += 1;
    else c.n_day_about += 1;
  }
  return c;
}

function keysOf(rows, pick, listed) {
  const keys = new Set(Array.isArray(listed) ? listed : []);
  for (const r of rows) for (const k of Object.keys(pick(r) || {})) keys.add(k);
  return [...keys];
}

const sumBy = (rows, pick) => sumFigures(rows.map(pick));
const sumKeys = (rows, keys, pick) => Object.fromEntries(keys.map((k) => [k, sumBy(rows, (r) => pick(r)?.[k])]));

// Everything one task contributes to a week, as the list of its figures: a
// task is "partial" when any of them is not measured, or its day is not whole.
function figuresOf(row, keys) {
  const list = [row.lead_time_ms, row.working_ms, row.idle_ms, row.working?.agents_working_unlabeled_ms, row.working?.not_labeled_ms];
  for (const k of keys.classes) list.push(row.working?.class_ms?.[k]);
  for (const k of keys.wastes) list.push(row.working?.waste_ms?.[k]);
  for (const k of keys.idle) list.push(row.idle?.[k]);
  return list;
}

function weekStarts(first, last) {
  const out = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 7 * DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// stackup: Desk's rollups/stackup.json; tasks: Desk's rollups/tasks.json (for
// flow efficiency); finishDates: Map job id -> finish_date. Returns the
// document, or null when there is no stack-up or no finished task in it.
export function buildByWeek({ stackup, tasks, finishDates }) {
  const rows = (stackup && Array.isArray(stackup.jobs) ? stackup.jobs : []).filter((r) => r && typeof r.job === "string" && FINISHED.has(r.status?.value));
  if (!rows.length) return null;
  const flowOf = new Map((tasks && Array.isArray(tasks.jobs) ? tasks.jobs : []).filter((r) => r && typeof r.job === "string").map((r) => [r.job, r.flow_efficiency]));
  const keys = {
    classes: keysOf(rows, (r) => r.working?.class_ms, stackup.classes),
    wastes: keysOf(rows, (r) => r.working?.waste_ms, stackup.working_wastes),
    idle: keysOf(rows, (r) => r.idle, stackup.idle_waited_on),
  };
  const dateOf = (r) => finishDates.get(r.job);
  const placed = rows.filter((r) => dateOf(r) && dateOf(r).state !== "unavailable" && typeof dateOf(r).value === "string");
  const unplacedRows = rows.filter((r) => !placed.includes(r));
  const unplaced = {
    n: unplacedRows.length,
    jobs: unplacedRows.map((r) => r.job).sort(),
    reasons: [...new Set(unplacedRows.flatMap((r) => dateOf(r)?.reasons || ["no_finish_source"]))].sort(),
  };
  const doc = {
    schema: BY_WEEK_SCHEMA,
    basis: "by_finish_week",
    week_basis: "iso_week_utc_monday_start",
    classes: keys.classes,
    wastes: keys.wastes,
    idle_waited_on: keys.idle,
    weeks: [],
    tasks: [],
    unplaced,
  };
  if (placed.length) {
    const weekOf = new Map(placed.map((r) => [r.job, isoWeek(dateOf(r).value)]));
    const days = placed.map((r) => dateOf(r).value).sort();
    for (const starts_on of weekStarts(isoWeek(days[0]).starts_on, isoWeek(days[days.length - 1]).starts_on)) {
      const { week } = isoWeek(starts_on);
      const mine = placed.filter((r) => weekOf.get(r.job).starts_on === starts_on).sort((a, b) => a.job.localeCompare(b.job));
      if (!mine.length) {
        doc.weeks.push({ week, starts_on, n: 0, n_partial: 0, ...dayCounts([]), jobs: [] });
        continue;
      }
      const partialTask = (r) => dateOf(r).state !== "measured" || figuresOf(r, keys).some((f) => !f || f.state !== "measured");
      doc.weeks.push({
        week,
        starts_on,
        n: mine.length,
        n_partial: mine.filter(partialTask).length,
        ...dayCounts(mine.map(dateOf)),
        jobs: mine.map((r) => r.job),
        lead_ms: sumBy(mine, (r) => r.lead_time_ms),
        working_ms: sumBy(mine, (r) => r.working_ms),
        idle_ms: sumBy(mine, (r) => r.idle_ms),
        by_class_ms: sumKeys(mine, keys.classes, (r) => r.working?.class_ms),
        by_waste_ms: sumKeys(mine, keys.wastes, (r) => r.working?.waste_ms),
        idle_by_waited_on_ms: sumKeys(mine, keys.idle, (r) => r.idle),
        agents_working_unlabeled_ms: sumBy(mine, (r) => r.working?.agents_working_unlabeled_ms),
        not_labeled_ms: sumBy(mine, (r) => r.working?.not_labeled_ms),
        flow_efficiency: flowMedian(mine.map((r) => flowOf.get(r.job) || unavailable(["not_recorded"]))),
      });
    }
    doc.tasks = placed
      .map((r) => ({
        job: r.job,
        finish_date: forRollupFile(dateOf(r)),
        flow_efficiency: flowOf.get(r.job) || unavailable(["not_recorded"]),
        lead_time_ms: r.lead_time_ms || unavailable(["not_recorded"]),
        working_ms: r.working_ms || unavailable(["not_recorded"]),
      }))
      .sort((a, b) => (a.finish_date.value < b.finish_date.value ? -1 : a.finish_date.value > b.finish_date.value ? 1 : 0) || a.job.localeCompare(b.job));
  }
  return doc;
}
