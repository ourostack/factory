// "What to fix next": the overview's short list of actions, built from the
// same figures the rest of the page shows. Each item says what is wrong, what
// to do about it, how many it touches (a stated number with its noun, singular
// and plural) and the
// tasks or issues to start with. An example carries a figure only when the
// figure supports the action. Alarms come first, then what stops the
// headline from being measured, then waste, then open improvement cards, then
// inferred signals. The page shows the first five and folds the rest.

import { measured } from "./state.mjs";
import { WASTE_NAMES } from "./waste.mjs";

const TOP = 3;
export const SHOWN = 5;

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

const issueLink = (i) => ({ ref: i.ref, url: i.url, ...(i.title ? { title: i.title } : {}), age_days: i.age_days });
const has = (n) => n && n.state !== "unavailable" && typeof n.value === "number" && n.value > 0;
const task = (j, figure, kind) => (figure ? { job: j.id, figure, kind } : { job: j.id });

function topJobs(jobs, key) {
  return jobs.filter((j) => has(j[key])).sort((a, b) => b[key].value - a[key].value);
}

export function fixNext({ jobs = [], outcomes = null, kaizenIssues = [], andonIssues = [], capture = null, loop = null }) {
  const items = [];
  const add = (item) => items.push({ links: [], examples: [], ...item });

  // 1. Alarms.
  const andonOpen = andonIssues.filter((i) => i.issue_state === "open");
  if (andonOpen.length) {
    add({ id: "andon", severity: "alarm", title: "A Desk release made a quality measure clearly worse", action: "Fix or roll back the flagged release. The andon issue closes itself when the measure recovers.", count: measured(andonOpen.length), noun: ["open issue", "open issues"], links: andonOpen.map(issueLink) });
  }
  const foreign = jobs.filter((j) => has(j.waste?.foreign_sessions));
  if (foreign.length) {
    add({ id: "labels_mismatch", severity: "alarm", title: "Waste labels name sessions that are not on their task's timeline", action: "Check whether the evaluator labeled the wrong task or the session is bound to the wrong task, fix the cause in Desk, and re-label. Until then these labels count for no task.", count: measured(foreign.length), noun: ["task", "tasks"], examples: foreign.slice(0, TOP).map((j) => task(j, j.waste.foreign_sessions, "count")) });
  }
  const captureAlarms = Array.isArray(capture?.alarms) ? capture.alarms : [];
  if (captureAlarms.length) {
    add({ id: "capture_alarm", severity: "alarm", title: "Sessions are going uncaptured", action: "Check the hosts named in the health details: find why their sessions were not derived into facts, and fix the sweep.", count: measured(captureAlarms.length), noun: ["alarm", "alarms"] });
  }
  const loopAlarms = Array.isArray(loop?.alarms) ? loop.alarms : [];
  if (loopAlarms.length) {
    add({ id: "loop_alarm", severity: "alarm", title: "The improvement loop raised an alarm about itself", action: "Read the loop's alarm in the health details and unblock that step first: the loop fixes everything else.", count: measured(loopAlarms.length), noun: ["alarm", "alarms"] });
  }

  // 2. What keeps the headline from being measured.
  const awaiting = jobs.filter((j) => j.outcome === "awaiting_signoff");
  if (awaiting.length) {
    add({ id: "awaiting_signoff", severity: "act", title: "Deliveries are waiting for an answer", action: "At the next sitting, give the operator a three-line sign-off packet for each (what was asked, what was delivered, accept or send back) and record each answer with task_signoff.", count: measured(awaiting.length), noun: ["task", "tasks"], examples: awaiting.slice(0, TOP).map((j) => task(j, j.signoff_wait, "text")) });
  }
  const accepted = outcomes?.signoff?.accepted;
  const headline = outcomes?.attention?.headline;
  const noAccepted = !has(accepted);
  const noTurns = headline && headline.state === "unavailable" && Array.isArray(headline.reasons) && headline.reasons.includes("no_turn_records");
  if (noAccepted || noTurns) {
    const delivered = jobs.filter((j) => j.outcome === "delivered");
    const steps = [];
    if (noAccepted) steps.push("record the operator's answer on each delivery with task_signoff");
    if (noTurns) steps.push("update Desk on contributing machines to a release that publishes the operator's turns");
    add({
      id: "headline_blocked",
      severity: "act",
      title: "The headline cannot be computed yet",
      action: `${steps.map((x, i) => (i ? x : x[0].toUpperCase() + x.slice(1))).join(", and ")}. Tasks delivered before sign-off existed stay out of scope.${noAccepted ? " The numbers above count only deliveries that have a sign-off record, so they can say no data while these tasks exist." : ""}`,
      ...(noAccepted && delivered.length ? { count: measured(delivered.length), noun: ["delivered task with no sign-off", "delivered tasks with no sign-off"] } : {}),
      examples: noAccepted ? delivered.slice(0, TOP).map((j) => task(j)) : [],
    });
  }

  // 3. Waste: labeled categories with their tasks, or the labeling that is missing.
  const byWaste = new Map();
  for (const j of jobs) {
    for (const r of j.waste?.rows || []) {
      if (r.kind !== "waste" && r.kind !== "unknown") continue;
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
      add({
        id: `waste_${key}`,
        severity: "improve",
        title: `${WASTE_NAMES[key] || "Unnamed waste"}: among the largest labeled waste`,
        action: WASTE_ACTIONS[key] || "Look at the labeled stretches in these tasks and remove the cause.",
        count: measured(e.jobs.length),
        noun: ["task", "tasks"],
        examples: e.jobs.sort((a, b) => b.figure.value - a.figure.value).slice(0, TOP).map((x) => task(x.j, x.figure, "duration")),
      });
    });
  const unlabeled = jobs.filter((j) => j.status === "done" && !(j.waste?.rows || []).length);
  if (unlabeled.length) {
    add({ id: "unlabeled", severity: "improve", title: "Finished tasks have no waste labels", action: "Run the waste evaluator on these tasks. Desk runs it by itself when it can; if it did not, the loop's health details say why.", count: measured(unlabeled.length), noun: ["task", "tasks"], examples: unlabeled.slice(0, TOP).map((j) => task(j)) });
  }

  // 4. Open improvement cards, oldest first.
  const openCards = kaizenIssues.filter((i) => i.issue_state === "open");
  if (openCards.length) {
    const age = (i) => (i.age_days && i.age_days.state === "measured" ? i.age_days.value : -1);
    add({ id: "kaizen_open", severity: "improve", title: "Improvement cards are open", action: "Take the oldest card: ship its countermeasure, then let the kaizen check confirm it against the data.", count: measured(openCards.length), noun: ["open card", "open cards"], links: [...openCards].sort((a, b) => age(b) - age(a)).map(issueLink) });
  }

  // 5. Signals that point at waste before it is labeled: inferred, not classified.
  const signals = [
    ["human_wait_ms", "duration", "Signal: tasks with the longest gaps between the operator's prompts", "Check whether these gaps needed the operator at all; batch the questions that did."],
    ["tool_failures", "count", "Signal: tasks with the most failed tool calls", "Open these tasks' sessions, find the tool calls that fail most, and fix the tool or the instruction that misuses it."],
    ["api_retry_ms", "duration", "Signal: tasks that lost the most time to API retries", "Check rate limits and model fallback for these sessions."],
  ];
  for (const [key, kind, title, action] of signals) {
    const top = topJobs(jobs, key);
    if (!top.length) continue;
    add({ id: `signal_${key}`, severity: "signal", title, action, count: measured(top.length), noun: ["task", "tasks"], examples: top.slice(0, TOP).map((j) => task(j, j[key], kind)) });
  }
  return items;
}
