// "What to fix next": the overview's short list of actions, built from the
// same figures the rest of the page shows. Each item says what is wrong, what
// to do about it, how many it touches (a stated number) and real examples: the
// tasks it was seen on, or the issue to take. Alarms come first, then what
// stops the headline from being measured, then waste, then open improvement
// cards. An item appears only when its evidence is on the page; nothing here
// is a guess.

import { measured } from "./state.mjs";

const TOP = 3;

// What to do about each kind of waste, in the agent's terms.
export const WASTE_ACTIONS = Object.freeze({
  waiting: "Batch the questions for the operator into one sitting and pre-authorize routine calls, so agents stop idling on an answer.",
  defects: "Catch the defect where it is made: add the failing check to CI or a pre-push hook, then fix the instruction that let it through.",
  overproduction: "Build only what was asked: trim options and extras nobody requested before delivery.",
  extra_processing: "Drop repeated reviews and re-verification that add no new evidence.",
  motion: "Give the agent the context up front (task card, paths, prior decisions) so it stops searching for it.",
  transportation: "Cut handoffs: keep one owner per change instead of passing work between agents.",
  inventory: "Finish or close open work before starting more.",
  non_utilized_talent: "Let agents make the calls they are authorized to make instead of routing them to the operator.",
  unknown: "Improve what the session facts record, so the evaluator can tell what this time was.",
});

const WASTE_TITLES = Object.freeze({
  waiting: "Waiting",
  defects: "Defects",
  overproduction: "Overproduction",
  extra_processing: "Extra processing",
  motion: "Motion",
  transportation: "Transportation",
  inventory: "Inventory",
  non_utilized_talent: "Non-utilized talent",
  unknown: "Time the evaluator could not classify",
});

const issueLink = (i) => ({ ref: i.ref, url: i.url, ...(i.title ? { title: i.title } : {}), age_days: i.age_days });
const has = (n) => n && n.state !== "unavailable" && typeof n.value === "number" && n.value > 0;
const example = (j, figure, kind) => ({ job: j.id, figure, kind });

// Jobs with the largest figure for one signal, largest first.
function topJobs(jobs, key) {
  return jobs.filter((j) => has(j[key])).sort((a, b) => b[key].value - a[key].value);
}

export function fixNext({ jobs = [], outcomes = null, kaizenIssues = [], andonIssues = [], capture = null, loop = null }) {
  const items = [];

  // 1. Alarms: a release that made quality worse, capture that dropped, a loop that stalled.
  const andonOpen = andonIssues.filter((i) => i.issue_state === "open");
  if (andonOpen.length) {
    items.push({
      id: "andon",
      severity: "alarm",
      title: "A Desk release made a quality measure clearly worse",
      action: "Fix or roll back the flagged release. The andon issue closes itself when the measure recovers.",
      count: measured(andonOpen.length),
      links: andonOpen.map(issueLink),
      examples: [],
    });
  }
  const captureAlarms = Array.isArray(capture?.alarms) ? capture.alarms : [];
  if (captureAlarms.length) {
    items.push({
      id: "capture_alarm",
      severity: "alarm",
      title: "Sessions are going uncaptured",
      action: "Check the hosts named in the health details: find why their sessions were not derived into facts, and fix the sweep.",
      count: measured(captureAlarms.length),
      links: [],
      examples: [],
    });
  }
  const loopAlarms = Array.isArray(loop?.alarms) ? loop.alarms : [];
  if (loopAlarms.length) {
    items.push({
      id: "loop_alarm",
      severity: "alarm",
      title: "The improvement loop raised an alarm about itself",
      action: "Read the loop's alarm in the health details and unblock that step first: the loop fixes everything else.",
      count: measured(loopAlarms.length),
      links: [],
      examples: [],
    });
  }

  // 2. What keeps the headline from being measured.
  const awaiting = jobs.filter((j) => j.outcome === "awaiting_signoff");
  if (awaiting.length) {
    items.push({
      id: "awaiting_signoff",
      severity: "act",
      title: "Deliveries are waiting for the operator's answer",
      action: "At the next sitting, give the operator a three-line sign-off packet for each (what was asked, what was delivered, accept or send back) and record each answer with task_signoff.",
      count: measured(awaiting.length),
      links: [],
      examples: awaiting.slice(0, TOP).map((j) => example(j, j.signoff_wait, "text")),
    });
  }
  const accepted = outcomes?.signoff?.accepted;
  const delivered = jobs.filter((j) => j.outcome === "delivered");
  if (!has(accepted) && delivered.length) {
    items.push({
      id: "no_accepted",
      severity: "act",
      title: "No accepted outcome is recorded, so the cost of one cannot be computed",
      action: "Record the operator's answer on delivered tasks with task_signoff. The agent records it on the operator's word; tasks delivered before sign-off existed stay out of scope.",
      count: measured(delivered.length),
      links: [],
      examples: delivered.slice(0, TOP).map((j) => example(j, j.lead_time_ms, "duration")),
    });
  }
  const headline = outcomes?.attention?.headline;
  if (headline && headline.state === "unavailable" && Array.isArray(headline.reasons) && headline.reasons.includes("no_turn_records")) {
    items.push({
      id: "no_turn_records",
      severity: "act",
      title: "No session records the operator's turns, so attention cannot be estimated",
      action: "Update Desk on contributing machines to a release that publishes human turns; until then attention per outcome stays no data.",
      links: [],
      examples: [],
    });
  }

  // 3. Waste: labeled categories with their tasks, or the labeling that is missing.
  const byWaste = new Map();
  for (const j of jobs) {
    for (const r of j.waste?.rows || []) {
      if (r.kind !== "waste" && r.kind !== "unknown") continue;
      if (!has(r.total_ms)) continue;
      const entry = byWaste.get(r.key) || { ms: 0, jobs: [] };
      entry.ms += r.total_ms.value;
      entry.jobs.push({ j, figure: r.total_ms });
      byWaste.set(r.key, entry);
    }
  }
  [...byWaste]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, TOP)
    .forEach(([key, e]) => {
      items.push({
        id: `waste_${key}`,
        severity: "improve",
        title: `${WASTE_TITLES[key] || key}: the largest labeled waste`,
        action: WASTE_ACTIONS[key] || "Look at the labeled stretches in these tasks and remove the cause.",
        count: measured(e.jobs.length),
        links: [],
        examples: e.jobs.sort((a, b) => b.figure.value - a.figure.value).slice(0, TOP).map((x) => example(x.j, x.figure, "duration")),
      });
    });
  const unlabeled = jobs.filter((j) => j.status === "done" && !(j.waste?.rows || []).length);
  if (unlabeled.length) {
    items.push({
      id: "unlabeled",
      severity: "improve",
      title: "Finished tasks have no waste labels",
      action: "Run the waste evaluator on these tasks. Desk runs it by itself when it can; if it did not, the loop's health details say why.",
      count: measured(unlabeled.length),
      links: [],
      examples: unlabeled.slice(0, TOP).map((j) => example(j, j.active_time_ms, "duration")),
    });
  }

  // 4. Open improvement cards, oldest first.
  const openCards = kaizenIssues.filter((i) => i.issue_state === "open");
  if (openCards.length) {
    const age = (i) => (i.age_days && i.age_days.state === "measured" ? i.age_days.value : -1);
    items.push({
      id: "kaizen_open",
      severity: "improve",
      title: "Improvement cards are open",
      action: "Take the oldest card: ship its countermeasure, then let the kaizen check confirm it against the data.",
      count: measured(openCards.length),
      links: [...openCards].sort((a, b) => age(b) - age(a)).map(issueLink),
      examples: [],
    });
  }

  // 5. Signals that point at waste before it is labeled: inferred, not classified.
  const signals = [
    ["human_wait_ms", "duration", "Signal: tasks stopped longest waiting on the operator", "Check whether these waits needed the operator at all; batch the ones that did."],
    ["tool_failures", "count", "Signal: tasks with the most failed tool calls", "Open these tasks' sessions, find the tool calls that fail most, and fix the tool or the instruction that misuses it."],
    ["api_retry_ms", "duration", "Signal: tasks that lost the most time to API retries", "Check rate limits and model fallback for these sessions."],
  ];
  for (const [key, kind, title, action] of signals) {
    const top = topJobs(jobs, key);
    if (!top.length) continue;
    items.push({
      id: `signal_${key}`,
      severity: "signal",
      title,
      action,
      count: measured(top.length),
      links: [],
      examples: top.slice(0, TOP).map((j) => example(j, j[key], kind)),
    });
  }
  return items;
}
