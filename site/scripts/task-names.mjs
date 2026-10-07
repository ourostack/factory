// Task names from public pull request titles.
//
// Public work is named publicly: a task's name is the title of its
// earliest-opened public pull request (the smallest time on the job's clock
// at which a session first referenced it; without any such time, the
// report's own order), plus how many more public pull requests it has
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

const KEY = (repo, number) => `${repo}#${number}`;

// When each pull request was first referenced, on the job's own clock:
// the report's timeline.prs[] (repo, number, at_ms) when it has them, else
// each session's facts refs.prs[].at_ms plus the session's offset on the job
// clock (the report's timeline.sessions[].offset_ms). Returns Map key -> ms.
export function prOpenedAt(report, prsOfSession) {
  const out = new Map();
  const put = (repo, number, at) => {
    if (typeof repo !== "string" || !Number.isSafeInteger(number) || !(typeof at === "number" && Number.isFinite(at))) return;
    const k = KEY(repo, number);
    if (!out.has(k) || at < out.get(k)) out.set(k, at);
  };
  const tl = report && report.timeline;
  if (tl && Array.isArray(tl.prs)) for (const p of tl.prs) if (p) put(p.repo, p.number, p.at_ms);
  if (out.size) return out;
  for (const sess of tl && Array.isArray(tl.sessions) ? tl.sessions : []) {
    if (!sess || typeof sess.id !== "string" || typeof sess.offset_ms !== "number") continue;
    for (const p of (prsOfSession && prsOfSession.get(sess.id)) || []) if (p) put(p.repo, p.number, typeof p.at_ms === "number" ? sess.offset_ms + p.at_ms : null);
  }
  return out;
}

// A task's pull requests, earliest-opened first. Those with no known time
// keep the report's order after the timed ones; with no time at all the
// report's order stands.
export function orderByOpened(pullRequests, openedAt) {
  const at = (p) => {
    const m = /^https:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)$/.exec(p.url || "");
    return m && openedAt && openedAt.has(KEY(m[1], Number(m[2]))) ? openedAt.get(KEY(m[1], Number(m[2]))) : Infinity;
  };
  return (pullRequests || []).map((p, i) => ({ p, i, t: at(p) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.p);
}

// jobs: [{ id, pull_requests: [{ ref, url }] }], earliest-opened first.
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
