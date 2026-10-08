// Finish order: the order in which tasks finished.
//
// A task with a finish date (finish-date.mjs) is ordered by it, earliest
// first. Ties, and every task with no date, use the labels rule below.
// Finished tasks with no date follow the dated ones, and open tasks (those
// whose finish date says `open_job`) come last. The basis names what
// the task has: "labels" for a task with labels (the page counts those as
// the labeled, finished tasks), "date" for a dated task with no labels yet,
// "facts" for the rest.
//
// Labels are written when a task reaches done, so the commit that first
// added any file under labels/<job>/ to `main` marks when the task finished.
// Tasks with no labels (open tasks, and done tasks not labeled yet) follow,
// in the order their first facts file landed. Tasks first labeled in the
// same commit are ordered by lead time, the longest last (so it reads as the
// latest to finish), then by their first facts file, then by key; open tasks
// whose first facts landed together are ordered by key. The order is the
// same on every build. A task with neither labels nor facts has no position.

import { execFileSync } from "node:child_process";
import { measured, unavailable } from "./state.mjs";

// For each path under `prefix` on `dir`'s current branch, the commit that
// first added it, oldest first (parents before children): its position, and
// the UTC day it was committed on. A repository without that history gives
// empty maps.
function scanAdded(dir, prefix) {
  const positions = new Map();
  const days = new Map();
  let log = "";
  try {
    log = execFileSync("git", ["-C", dir, "log", "--topo-order", "--reverse", "--diff-filter=A", "--name-only", "--format=C|%H|%ct", "--", prefix], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return { positions, days };
  }
  let commit = -1;
  let day = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("C|")) {
      commit += 1;
      const secs = Number(line.split("|")[2]);
      day = Number.isFinite(secs) ? new Date(secs * 1000).toISOString().slice(0, 10) : null;
    } else if (line.trim() && commit >= 0 && !positions.has(line.trim())) {
      positions.set(line.trim(), commit);
      if (day) days.set(line.trim(), day);
    }
  }
  return { positions, days };
}

// Path -> the position of the commit that first added it.
export function firstAdded(dir, prefix) {
  return scanAdded(dir, prefix).positions;
}

// Path -> the UTC day of the commit that first added it ("YYYY-MM-DD").
export function firstAddedDays(dir, prefix) {
  return scanAdded(dir, prefix).days;
}

// Job id -> the UTC day its labels first landed: the day of the earliest
// commit that added any file under labels/<job>/. Arguments are the maps
// firstAdded and firstAddedDays give for "labels/".
export function labelDays(labelAdded, dayOf) {
  const best = new Map();
  for (const [path, pos] of labelAdded) {
    const m = /^labels\/([0-9A-Za-z_-]{1,64})\/[^/]+\.json$/.exec(path);
    const day = dayOf.get(path);
    if (!m || !day) continue;
    const cur = best.get(m[1]);
    if (!cur || pos < cur.pos) best.set(m[1], { pos, day });
  }
  return new Map([...best].map(([id, v]) => [id, v.day]));
}

// The earliest commit position among a set of paths, or null.
function earliest(positions) {
  const xs = positions.filter((x) => Number.isInteger(x));
  return xs.length ? Math.min(...xs) : null;
}

// jobs: [{ id, sessions: [{ session_id }] }]
// labelAdded: path ("labels/<job>/<file>") -> commit position
// factsAdded: path ("facts/<file>") -> commit position
// factsFileOf: session id -> facts file name
// finishDates: job id -> its finish_date (a stated number whose value is a
// UTC day); one that is unavailable or missing gives the task no date.
// Returns Map job id -> { finish_order, finish_basis, finish_group? } where
// finish_order is a stated number, finish_basis is "labels", "date", "facts"
// or "none", and finish_group (labeled tasks only) is the position of the
// commit that first labeled the task: tasks labeled together share it.
export function finishOrder(jobs, { labelAdded = new Map(), factsAdded = new Map(), factsFileOf = new Map(), finishDates = new Map() } = {}) {
  const labelOf = new Map();
  for (const [path, pos] of labelAdded) {
    const m = /^labels\/([0-9A-Za-z_-]{1,64})\/[^/]+\.json$/.exec(path);
    if (!m) continue;
    const cur = labelOf.get(m[1]);
    if (cur === undefined || pos < cur) labelOf.set(m[1], pos);
  }
  const rows = jobs.map((j) => {
    const facts = earliest((j.sessions || []).map((s) => factsFileOf.get(s.session_id)).filter(Boolean).map((f) => factsAdded.get(`facts/${f}`)));
    const label = labelOf.has(j.id) ? labelOf.get(j.id) : null;
    const lt = j.lead_time_ms;
    const lead = lt && lt.state !== "unavailable" && typeof lt.value === "number" ? lt.value : -1;
    const fd = finishDates.get(j.id);
    const date = fd && fd.state !== "unavailable" && typeof fd.value === "string" ? fd.value : null;
    const isOpen = !!(fd && Array.isArray(fd.reasons) && fd.reasons.includes("open_job"));
    return { id: j.id, label, facts, lead, date, isOpen };
  });
  const cmp = (a, b) => (a ?? Infinity) - (b ?? Infinity);
  // Tasks whose first labels landed in the same commit share a finish group;
  // within it the longest task (by lead time) finishes last, so a bulk
  // labeling commit puts its most substantial task in the latest position.
  const labeled = rows.filter((r) => r.label !== null).sort((a, b) => a.label - b.label || a.lead - b.lead || cmp(a.facts, b.facts) || a.id.localeCompare(b.id));
  const groups = [...new Set(labeled.map((r) => r.label))];
  const open = rows.filter((r) => r.label === null && r.facts !== null).sort((a, b) => a.facts - b.facts || a.id.localeCompare(b.id));
  // Dated tasks first, by date, with the labels rule breaking ties; the rest
  // follow in the order they always had.
  const byDate = [...labeled, ...open].filter((r) => r.date !== null).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || cmp(a.label, b.label) || a.lead - b.lead || cmp(a.facts, b.facts) || a.id.localeCompare(b.id));
  const out = new Map();
  // Then finished tasks with no day (labeled first), then open tasks last.
  const undated = (r) => r.date === null;
  const finished = (r) => !r.isOpen;
  [...byDate, ...labeled.filter((r) => undated(r) && finished(r)), ...open.filter((r) => undated(r) && finished(r)), ...labeled.filter((r) => undated(r) && !finished(r)), ...open.filter((r) => undated(r) && !finished(r))].forEach((r, i) =>
    out.set(r.id, { finish_order: measured(i + 1), finish_basis: r.label !== null ? "labels" : r.date !== null ? "date" : "facts", ...(r.label !== null ? { finish_group: measured(groups.indexOf(r.label) + 1) } : {}) }),
  );
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, { finish_order: unavailable(["no_facts"]), finish_basis: "none" });
  return out;
}
