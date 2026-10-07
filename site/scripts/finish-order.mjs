// Finish order: the order in which tasks finished, without a date.
//
// Labels are written when a task reaches done, so the commit that first
// added any file under labels/<job>/ to `main` marks when the task finished.
// Only the position (1st, 2nd, ...) is published, never the commit's date.
// Tasks with no labels (open tasks, and done tasks not labeled yet) follow,
// in the order their first facts file landed. Tasks first labeled in the
// same commit are ordered by lead time, the longest last (so it reads as the
// latest to finish), then by their first facts file, then by key; open tasks
// whose first facts landed together are ordered by key. The order is the
// same on every build. A task with neither labels nor facts has no position.

import { execFileSync } from "node:child_process";
import { measured, unavailable } from "./state.mjs";

// For each path under `prefix` on `dir`'s current branch, the position of
// the commit that first added it, oldest first (parents before children). A
// repository without that history gives an empty map.
export function firstAdded(dir, prefix) {
  const out = new Map();
  let log = "";
  try {
    log = execFileSync("git", ["-C", dir, "log", "--topo-order", "--reverse", "--diff-filter=A", "--name-only", "--format=C|%H", "--", prefix], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return out;
  }
  let commit = -1;
  for (const line of log.split("\n")) {
    if (line.startsWith("C|")) commit += 1;
    else if (line.trim() && commit >= 0 && !out.has(line.trim())) out.set(line.trim(), commit);
  }
  return out;
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
// Returns Map job id -> { finish_order, finish_basis, finish_group? } where
// finish_order is a stated number, finish_basis is "labels", "facts" or
// "none", and finish_group (labeled tasks only) is the position of the
// commit that first labeled the task: tasks labeled together share it.
export function finishOrder(jobs, { labelAdded = new Map(), factsAdded = new Map(), factsFileOf = new Map() } = {}) {
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
    return { id: j.id, label, facts, lead };
  });
  const cmp = (a, b) => (a ?? Infinity) - (b ?? Infinity);
  // Tasks whose first labels landed in the same commit share a finish group;
  // within it the longest task (by lead time) finishes last, so a bulk
  // labeling commit puts its most substantial task in the latest position.
  const labeled = rows.filter((r) => r.label !== null).sort((a, b) => a.label - b.label || a.lead - b.lead || cmp(a.facts, b.facts) || a.id.localeCompare(b.id));
  const groups = [...new Set(labeled.map((r) => r.label))];
  const open = rows.filter((r) => r.label === null && r.facts !== null).sort((a, b) => a.facts - b.facts || a.id.localeCompare(b.id));
  const out = new Map();
  [...labeled, ...open].forEach((r, i) =>
    out.set(r.id, { finish_order: measured(i + 1), finish_basis: r.label !== null ? "labels" : "facts", ...(r.label !== null ? { finish_group: measured(groups.indexOf(r.label) + 1) } : {}) }),
  );
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, { finish_order: unavailable(["no_facts"]), finish_basis: "none" });
  return out;
}
