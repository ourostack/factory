// The site's own health, built with the data and published as health.json.
//
// The store's no-dates rule is about facts files: they hold no date or time.
// The one public clock the site may use is ordinary Git history (when a facts
// file landed on `main`), which the intake chart already uses. The health
// panel is stricter than that: it shows only a coarse class for the age of the
// newest intake (under a day, one to three days, three to seven, over seven),
// computed here, never a timestamp.
//
// Staleness of the site itself is decided in the browser, from `built_at`
// (see site/src/format.js), so a site that stopped rebuilding shows `stale`
// even though nothing ran to say so. The verdict written here is the verdict
// at build time.

import { measured, unavailable } from "./state.mjs";

export const STALE_AFTER_HOURS = 36;

// Slots for numbers that other packages will publish. Each renders "not
// recorded yet" until its record exists: capture coverage per host (count of
// session files on disk against those derived), open improvement items (count
// and oldest age), and deliveries nobody has signed.
export const EMPTY_SLOTS = Object.freeze({
  capture_coverage: Object.freeze(unavailable(["not_recorded_yet"])),
  open_improvement_items: Object.freeze(unavailable(["not_recorded_yet"])),
  unsigned_deliveries: Object.freeze(unavailable(["not_recorded_yet"])),
});

const HOUR = 3600 * 1000;

export function intakeClass(newestMs, nowMs) {
  if (!Number.isFinite(newestMs)) return null;
  const age = nowMs - newestMs;
  if (age < 24 * HOUR) return "under_1_day";
  if (age < 72 * HOUR) return "1_to_3_days";
  if (age < 7 * 24 * HOUR) return "3_to_7_days";
  return "over_7_days";
}

// The newest completed run of the `factory-build` workflow, from the GitHub
// REST API's run list. Reading public run metadata needs no extra permission
// on a public repository; on a private one the workflow would need
// `actions: read`.
const DECISIVE = new Set(["success", "failure", "timed_out", "startup_failure", "action_required"]);

export function lastBuildFromRuns(body) {
  // A skipped or cancelled run says nothing about whether the build is
  // green, so the newest run that actually passed or failed is the signal.
  const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
  const run = runs.find((r) => r && typeof r.conclusion === "string" && DECISIVE.has(r.conclusion));
  if (!run) return unavailable(["no_decisive_run_found"]);
  const n = measured(run.conclusion);
  return typeof run.html_url === "string" && run.html_url.startsWith("https://github.com/")
    ? { ...n, run_url: run.html_url }
    : n;
}

// Everything `alive` rests on. Alive requires every piece to be present; a
// missing piece gives `unknown`. Adding a slot later means adding a row here,
// and no row can be skipped by a caller: the verdict reads this list.
export const REQUIRED_EVIDENCE = [
  { name: "reports", label: "the reports branch", present: (i) => i.reportsReadable === true },
  {
    name: "factory_build",
    label: "the last factory-build run",
    present: (i) => i.lastBuild?.state === "measured" && i.lastBuild.value === "success",
  },
  { name: "newest_intake", label: "the age of the newest intake", present: (i) => typeof i.newestIntake === "string" && i.newestIntake !== "" },
  { name: "facts_by_host", label: "the facts count by host", present: (i) => Object.keys(i.factsByHost || {}).length > 0 },
];

export function buildHealth({ builtAt, factsByHost, newestIntake, lastBuild, reportsReadable }) {
  const hosts = Object.entries(factsByHost || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([host, files]) => ({ host, files: measured(files) }));

  // Precedence when more than one holds (each verdict must be true):
  //   broken   the reports are unreadable, or the last factory-build run that
  //            was read is red;
  //   stale    the data is old: no new session for over seven days (the
  //            browser adds "the site itself has not rebuilt in 36 hours");
  //   unknown  any piece of evidence in REQUIRED_EVIDENCE is missing;
  //   alive    every piece present: a green last build that was actually
  //            read, a known intake age, a facts count, readable reports.
  // `alive` is never the answer to missing evidence.
  let verdict;
  if (reportsReadable === false) {
    verdict = { status: "broken", reason: "the reports branch could not be read, so the job reports are missing" };
  } else if (lastBuild?.state === "measured" && lastBuild.value !== "success") {
    verdict = { status: "broken", reason: `the last factory-build run ended as ${lastBuild.value}` };
  } else if (newestIntake === "over_7_days") {
    verdict = { status: "stale", reason: "no new session has been published for over seven days" };
  } else {
    const input = { reportsReadable, lastBuild, newestIntake, factsByHost };
    const missing = REQUIRED_EVIDENCE.filter((e) => !e.present(input));
    verdict = missing.length
      ? { status: "unknown", reason: `${missing.map((e) => e.label).join(", ")} could not be checked, so health cannot be told` }
      : { status: "alive", reason: "the last factory-build run was green, the newest intake is recent and the site data built" };
  }

  return {
    schema: "factory-health/1",
    config: { stale_after_hours: STALE_AFTER_HOURS },
    built_at: builtAt,
    verdict,
    last_data_build: measured(builtAt),
    newest_intake: newestIntake ? measured(newestIntake) : unavailable(["no_intake_found"]),
    facts_by_host: hosts,
    factory_build: lastBuild ?? unavailable(["not_checked"]),
    slots: { ...EMPTY_SLOTS },
  };
}
