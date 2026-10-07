// Task names from public pull request titles.
//
// Public work is named publicly: a task's name is the title of its first
// public pull request, plus how many more public pull requests it has
// ("and 3 more"). Only a pull request whose repository GitHub reports as
// public names a task. A task with no public pull request has no name, and
// the page calls it "Private task" with a short key. If no title could be
// read (GitHub unreachable), the task has no name either; the page then
// says the name was not fetched rather than calling the task private.

import { measured } from "./state.mjs";

// How many of a task's pull requests are tried for a readable public title.
export const NAME_TRIES = 3;
const MAX_TITLE = 160;

// A title as plain text: no control characters, single spaces, cut to a
// readable length. An empty result is no title.
export function cleanTitle(t) {
  if (typeof t !== "string") return null;
  const s = t.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > MAX_TITLE ? `${s.slice(0, MAX_TITLE - 1).trimEnd()}…` : s;
}

// jobs: [{ id, pull_requests: [{ ref, url }] }] in the report's order.
// getPull(repo, number) -> { title, private } or null when it cannot be read.
// Returns Map job id -> { name?, more_prs? }.
export async function taskNames(jobs, getPull) {
  const out = new Map();
  for (const j of jobs) {
    const prs = (j.pull_requests || [])
      .map((p) => /^https:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/.exec(p.url || ""))
      .filter(Boolean)
      .map((m) => ({ repo: m[1], number: Number(m[2]) }));
    if (!prs.length) {
      out.set(j.id, {});
      continue;
    }
    let name = null;
    for (const pr of prs.slice(0, NAME_TRIES)) {
      const info = await getPull(pr.repo, pr.number);
      if (info && info.private === false) name = cleanTitle(info.title);
      if (name) break;
    }
    out.set(j.id, name ? { name, more_prs: measured(prs.length - 1) } : {});
  }
  return out;
}
