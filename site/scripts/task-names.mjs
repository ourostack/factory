// Task names from public pull request titles.
//
// Public work is named publicly: a task's name is the title of its
// earliest-opened public pull request, by the time GitHub records it was
// opened (created_at, read from the pulls API and never published), plus
// how many more public pull requests it has ("and 3 more"). Only a pull request whose repository GitHub reports as
// public names a task. A task with no public pull request has no name, and
// the page calls it "Private task" with a short key. If no title could be
// read (GitHub unreachable), the task has no name either; the page then
// says the name was not fetched rather than calling the task private.

import { measured } from "./state.mjs";

const MAX_TITLE = 160;

// A title as plain text: no control characters, single spaces, cut to a
// readable length. An empty result is no title.
export function cleanTitle(t) {
  if (typeof t !== "string") return null;
  const s = t.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > MAX_TITLE ? `${s.slice(0, MAX_TITLE - 1).trimEnd()}…` : s;
}

const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/;

// When GitHub says a pull request was opened (its created_at), as epoch ms,
// or null when the value is missing or not a time. Used only to order; never
// published.
export function openedMs(info) {
  const t = info && typeof info.created_at === "string" ? Date.parse(info.created_at) : NaN;
  return Number.isFinite(t) ? t : null;
}

// Bounded concurrency, so a task with dozens of pull requests reads them a
// few at a time.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// jobs: [{ id, pull_requests: [{ ref, url }] }].
// getPull(repo, number) -> { title, private, created_at } or null when it
// cannot be read.
//
// Every pull request of the task is read. The name is the title of the
// earliest-opened one (by created_at) whose repository GitHub reports as
// public. If any pull request could not be read, an earlier one may exist,
// so the name is marked name_basis "partial" rather than silently standing
// for the whole task; if none could be read, the task has no name.
//
// Returns Map job id -> { name?, more_prs?, name_basis?, order } where
// order is the task's pull request URLs earliest-opened first (unreadable
// ones after, in their original order), for the page's list. No time is
// returned.
export async function taskNames(jobs, getPull, { concurrency = 8 } = {}) {
  const out = new Map();
  for (const j of jobs) {
    const list = (j.pull_requests || []).filter((p) => PR_URL.test(p.url || ""));
    if (!list.length) {
      out.set(j.id, { order: (j.pull_requests || []).map((p) => p.url) });
      continue;
    }
    const infos = await mapLimit(list, concurrency, (p) => {
      const m = PR_URL.exec(p.url);
      return getPull(m[1], Number(m[2]));
    });
    const rows = list.map((p, i) => ({ p, i, info: infos[i], at: openedMs(infos[i]) }));
    const unread = rows.filter((r) => !r.info || r.at === null).length;
    const timed = rows.filter((r) => r.info && r.at !== null).sort((a, b) => a.at - b.at || a.i - b.i);
    const order = [...timed, ...rows.filter((r) => !r.info || r.at === null)].map((r) => r.p.url);
    let name = null;
    for (const r of timed) {
      if (r.info.private !== false) continue;
      name = cleanTitle(r.info.title);
      if (name) break;
    }
    const res = { order };
    if (name) {
      res.name = name;
      res.more_prs = measured(list.length - 1);
      if (unread) res.name_basis = "partial";
    }
    out.set(j.id, res);
  }
  return out;
}
