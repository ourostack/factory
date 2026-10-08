#!/usr/bin/env node
// The numbers regression check. It runs inside the site build and fails it.
//
// Every number in data.json must be a stated number: { state, value?,
// reasons }. A rollup must carry n, N and what it counts. Nothing may be NaN,
// null or a bare number standing for a value, and a sentence template may not
// hold a digit (numbers go through slots, so they cannot dodge the check).
// Only the top-level `config` block may hold plain numbers: those are
// published constants, not measurements.
//
// Usage: node check-numbers.mjs <data.json>   (exit 1 and name each violation)

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// The page's own words for each reason. A reason with no words would reach
// a reader as a code, so it fails the build here.
const { hasReasonText } = createRequire(import.meta.url)("../src/format.js");

const STATES = new Set(["measured", "partial", "unavailable"]);
const STATED_KEYS = new Set(["state", "value", "reasons", "bound", "basis", "kind", "n", "N", "of", "out_of_scope", "excluded", "run_url"]);
const ROLLUP_KEYS = ["n", "N", "of", "out_of_scope", "excluded"];
// Where a finish day came from (finish-date.mjs). A finish day is the only
// stated number whose `basis` is one of these.
const FINISH_BASES = new Set(["desk_transition", "desk_card_updated", "pr_anchor", "labels_landed"]);
const FINISH_DATE_PATH = /^jobs\[\d+\]\.finish_date$/;
// Reasons under which a rollup may carry a value with n of zero: every
// member is flagged, but the flag still leaves a value (a lower bound from a
// host that records partly, a capture share from unverified hosts). Each
// package adds its own reasons below, so the list grows in one place per
// package.
const VALUE_WITH_NO_WHOLE_MEMBER = new Set(["host_records_partly", "unverified_host", "host_not_counted", "host_does_not_say_desk"]);

// Paths in data.json that must be rollups (they sum, take a median or a
// share over a population). A rollup that lost its marker and its counts is
// caught here, by where it sits, not by what it still carries.
const ROLLUP_PATHS = [
  /^time_breakdown\[\d+\]\.(median|p75)$/,
  /^outcomes\.(unsigned|first_pass_yield)$/,
  /^outcomes\.rework\.(changed_ask|returns\[\d+\]\.total|defects\.[a-z_]+)$/,
  /^outcomes\.attention\.(headline|turns_per_accepted|per_delivered)$/,
  /^flow_efficiency\.(median|p75)$/,
  /^tool_calls_total$/,
  /^tool_kinds\[\d+\]\.(calls|failures|sessions|failure_rate)$/,
  /^models\[\d+\]\.(requests|input|output|cache_read|cache_write)$/,
  /^subagents\.(dispatches|sessions_with_subagents)$/,
  /^subagents\.buckets\.[^.]+$/,
  /^waste\.breakdown\[\d+\]\.(total_ms|share)$/,
  /^headlines\[\d+\]\.number$/,
  /^capture_coverage\.share$/,
  /^loop_health\.(open|in_progress|not_closed|oldest_open_age_days|closed_confirmed_month|closed_unverified_month|loop_alarms_open|steps_stale)$/,
  /^capture_coverage\.hosts\[\d+\]\.(on_disk|derived|held|frozen|pending|not_seen|not_in_a_desk|share|capturable_share)$/,
  /^takeaways\[\d+\]\.slots\.(median|rate|calls|failures|share|with|dispatches)$/,
  /^trend\[\d+\]\.(first_pass_yield|attention)$/,
];
// Paths that must hold a stated number of some kind (not an empty object, a
// string or anything else that would make the formatter throw).
const NUMBER_PATHS = [
  /^jobs\[\d+\]\.(lead_time_ms|active_time_ms|flow_efficiency|queue_before_start_ms|human_wait_ms|api_retry_ms|tool_failures|tool_retries|sessions_bound|public_prs|signoff|signoff_wait|first_pass|returns)$/,
  /^outcomes\.signoff\.[a-z_]+$/,
  /^waste\.breakdown\[\d+\]\.confidence\.(high|medium|low)_ms$/,
  /^outcomes\.(oldest_unsigned_wait|first_pass_counts\.[a-z_]+)$/,
  /^outcomes\.rework\.reason_check\.(compared|disagree)$/,
  /^jobs\[\d+\]\.details\[\d+\]\.number$/,
  /^jobs\[\d+\]\.(attention_ms|human_turns)$/,
  /^jobs\[\d+\]\.(finish_order|finish_group|more_prs|finish_date)$/,
  /^jobs\[\d+\]\.waste\.(sessions_labeled|sessions_on_timeline|foreign_sessions|rows\[\d+\]\.total_ms)$/,
  /^labeled_waste\.(jobs_with_labels|jobs_finished|rows\[\d+\]\.(total_ms|jobs))$/,
  /^trend\[\d+\]\.(jobs|accepted|sent_back|flow_efficiency)$/,
  /^sessions\[\d+\]\.(duration_ms|active_ms|subagent_count|tool_calls_total|tool_failures_total)$/,
  /^fix_next\[\d+\]\.count$/,
  /^fix_next\[\d+\]\.examples\[\d+\]\.figure$/,
  /^coverage\.(sessions_with_facts|jobs|jobs_open|capture)$/,
  /^capture_coverage\.machines\.(counted|empty|stale|invalid|over_limit|files)$/,
  /^capture_coverage\.hosts\[\d+\]\.(records|unverified_machines|not_counted_machines)$/,
  /^loop_health\.machines\.(reporting|without_loop|unreadable_loop|quiet|stale)$/,
  /^loop_health\.(headless|notices)\[\d+\]\.machines$/,
  /^loop_health\.verdict\.(quiet|stale)$/,
  /^scope\.(sessions_total|sessions_scoped|sessions_scoped_bound|sessions_other)$/,
  ...ROLLUP_PATHS,
];
// Headlines that are plain counts of files or jobs, not rollups.
const COUNT_HEADLINES = new Set(["substantial_sessions", "jobs_tracked", "kaizen"]);

// A string that stands for a value that is missing or bad.
// Any form: surrounding spaces, exponent, hex, signs, non-ASCII digits, empty.
const BAD_STRING = {
  test(s) {
    const t = s.trim();
    if (t === "") return true;
    if (/^[+-]?(nan|null|undefined|infinity)$/i.test(t)) return true;
    if (/^[+-]?[\p{Nd}.,_]+$/u.test(t)) return true;
    return Number.isFinite(Number(t));
  },
};
// A task name is a pull request title, which may be anything, digits included.
const FREE_KEYS = new Set(["id", "session_id", "ref", "name", "name_basis"]);

function isStated(node) {
  return node && typeof node === "object" && !Array.isArray(node) && ("state" in node || "reasons" in node);
}

// Sign-off: a first-pass yield whose every job still awaits a sign-off keeps its upper bound.
VALUE_WITH_NO_WHOLE_MEMBER.add("awaiting_signoff");

export function checkNumbers(data) {
  const out = [];
  const bad = (path, code) => out.push({ path, code });

  function stated(node, path, isTop) {
    if (typeof node.state !== "string") bad(path, "missing_state");
    else if (!STATES.has(node.state)) bad(path, "bad_state");
    if (!Array.isArray(node.reasons)) bad(path, "missing_reasons");
    else {
      if (node.state === "measured" && node.reasons.length > 0) bad(path, "measured_with_reasons");
      if ((node.state === "partial" || node.state === "unavailable") && node.reasons.length === 0) bad(path, "missing_reasons");
      if (node.reasons.some((r) => typeof r !== "string" || !r)) bad(path, "bad_reason");
      else if (node.reasons.some((r) => !hasReasonText(r))) bad(path, "reason_without_text");
    }
    if (node.state === "unavailable") {
      if ("value" in node) bad(path, "value_on_unavailable");
    } else if (node.state === "measured" || node.state === "partial") {
      if (!("value" in node)) bad(path, "missing_value");
    }
    if ("value" in node) {
      const v = node.value;
      if (v === null || v === undefined) bad(path, "null_value");
      else if (typeof v === "number" && !Number.isFinite(v)) bad(path, "non_finite");
      else if (typeof v === "string" && BAD_STRING.test(v)) bad(path, "bad_string_value");
      else if (typeof v !== "number" && typeof v !== "string") bad(path, "bad_value_type");
    }
    // Every partial number says which way the true figure lies: lower,
    // upper, or unknown (bounds.mjs holds the table; a new partial measure
    // without a row there stops the build).
    if ("bound" in node && !["lower", "upper", "unknown"].includes(node.bound)) bad(path, "bad_bound");
    else if (node.state === "partial" && !("bound" in node)) bad(path, "partial_without_direction");
    else if (node.state !== "partial" && "bound" in node) bad(path, "bound_on_whole_number");
    if (!FINISH_DATE_PATH.test(path) && "basis" in node && node.basis !== "declared" && node.basis !== "inferred") bad(path, "bad_basis");
    if (FINISH_DATE_PATH.test(path) && node.state !== "unavailable") {
      if (typeof node.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(node.value)) bad(path, "bad_finish_day");
      if (!FINISH_BASES.has(node.basis)) bad(path, "bad_basis");
    }
    if ("run_url" in node && !(typeof node.run_url === "string" && node.run_url.startsWith("https://github.com/"))) bad(path, "bad_url");
    for (const [k, v] of Object.entries(node)) {
      if (!STATED_KEYS.has(k)) {
        bad(`${path}.${k}`, "unknown_key");
        walk(v, `${path}.${k}`, false);
      }
    }
    const hasRollupKey = ROLLUP_KEYS.some((k) => k in node);
    if (node.kind === "rollup") {
      const { n, N, of, out_of_scope: oos } = node;
      if (!Number.isInteger(n) || !Number.isInteger(N) || !Number.isInteger(oos) || oos < 0 || typeof of !== "string" || !of) {
        bad(path, "rollup_missing_n");
      } else if (n > N) {
        bad(path, "rollup_n_exceeds_N");
      } else {
        // n of zero is no data, except a figure every member of which is
        // flagged by a named reason that still leaves a value
        // (VALUE_WITH_NO_WHOLE_MEMBER).
        const lowerBoundOnly =
          n === 0 && N > 0 && "value" in node && Array.isArray(node.reasons) && node.reasons.some((r) => VALUE_WITH_NO_WHOLE_MEMBER.has(r));
        const want = N > 0 && n === N ? "measured" : n === 0 && !lowerBoundOnly ? "unavailable" : "partial";
        if (node.state !== want) bad(path, "rollup_state_mismatch");
      }
      if ("excluded" in node) {
        const ex = node.excluded;
        if (!ex || typeof ex !== "object" || Object.values(ex).some((c) => !Number.isInteger(c) || c < 0)) bad(path, "bad_excluded");
      }
    } else if (hasRollupKey || "kind" in node) {
      bad(path, "rollup_missing_kind");
    }
    // A figure whose source is not recorded yet has no population, so it may
    // stand at a rollup path with no n of N.
    const notYet = node.state === "unavailable" && Array.isArray(node.reasons) && node.reasons.length === 1 && node.reasons[0] === "not_recorded_yet";
    if (!isTop && !notYet && node.kind !== "rollup" && ROLLUP_PATHS.some((re) => re.test(path))) {
      const m = path.match(/^headlines\[(\d+)\]\.number$/);
      const id = m ? data.headlines?.[Number(m[1])]?.id : null;
      if (!(m && COUNT_HEADLINES.has(id))) bad(path, "rollup_expected");
    }
  }

  function walk(node, path, top) {
    if (!isStated(node) && NUMBER_PATHS.some((re) => re.test(path))) {
      bad(path, ROLLUP_PATHS.some((re) => re.test(path)) ? "rollup_expected" : "number_expected");
    }
    if (node === null) return bad(path, "null_value");
    if (node === undefined) return bad(path, "undefined_value");
    if (typeof node === "number") return bad(path, Number.isFinite(node) ? "bare_number" : "non_finite");
    if (typeof node === "string") {
      const key = path.split(".").pop().replace(/\[\d+\]$/, "");
      if (BAD_STRING.test(node) && !FREE_KEYS.has(key)) bad(path, "bad_string_value");
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, `${path}[${i}]`, false));
      return;
    }
    if (isStated(node)) {
      stated(node, path, false);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (top && k === "config") continue;
      if (k === "template") {
        if (typeof v === "string" && /\d/.test(v)) bad(`${path}.${k}`, "digits_in_text");
        continue;
      }
      walk(v, path ? `${path}.${k}` : k, false);
    }
  }

  walk(data, "", true);
  // Human attention per accepted outcome has no value while no outcome was
  // accepted: it reads "no accepted outcomes yet", never zero or infinity.
  const accepted = data?.outcomes?.signoff?.accepted;
  const headline = data?.outcomes?.attention?.headline;
  if (accepted?.state === "measured" && accepted.value === 0 && headline && "value" in headline) {
    bad("outcomes.attention.headline", "value_without_accepted_outcome");
  }
  return out;
}

// The same rules for rollups/by_week.json (factory.site.by_week/1), which is
// store-built and sits beside Desk's files, so its partial figures give a
// direction as Desk does: `bound` "lower" or "upper", or null with a
// `bound_reason`. Every figure is a stated number, an empty week holds no
// sums, and the weeks run without a gap.
const BY_WEEK_ENVELOPE_KEYS = new Set(["state", "value", "reasons", "bound", "bound_reason", "class", "basis"]);
export function checkByWeek(doc) {
  const out = [];
  const bad = (path, code) => out.push({ path, code });
  if (!doc || typeof doc !== "object" || doc.schema !== "factory.site.by_week/1") {
    bad("", "wrong_schema");
    return out;
  }
  const envelope = (node, path) => {
    if (!STATES.has(node.state)) bad(path, "bad_state");
    if (!Array.isArray(node.reasons)) bad(path, "missing_reasons");
    else {
      if (node.state === "measured" && node.reasons.length > 0) bad(path, "measured_with_reasons");
      if (node.state !== "measured" && node.reasons.length === 0) bad(path, "missing_reasons");
      for (const r of node.reasons) {
        if (typeof r !== "string" || !r) bad(path, "bad_reason");
        else if (!hasReasonText(r)) bad(path, "reason_without_text");
      }
    }
    if (node.state === "unavailable") {
      if ("value" in node) bad(path, "value_on_unavailable");
    } else if (BY_WEEK_FINISH_PATH.test(path)) {
      // A finish day is a real-shaped day with a known basis, as in data.json.
      if (typeof node.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(node.value)) bad(path, "bad_finish_day");
      if (!FINISH_BASES.has(node.basis)) bad(path, "bad_basis");
    } else if (typeof node.value !== "number" || !Number.isFinite(node.value)) bad(path, "bad_value");
    if (node.state === "partial") {
      if (!("bound" in node)) bad(path, "partial_without_direction");
      else if (node.bound === null) {
        if (typeof node.bound_reason !== "string" || !hasReasonText(node.bound_reason)) bad(path, "null_bound_without_reason");
      } else if (node.bound !== "lower" && node.bound !== "upper") bad(path, "bad_bound");
    } else if ("bound" in node || "bound_reason" in node) bad(path, "bound_on_whole_number");
    for (const k of Object.keys(node)) if (!BY_WEEK_ENVELOPE_KEYS.has(k)) bad(`${path}.${k}`, "unknown_key");
  };
  const walk = (node, path) => {
    if (node === null || node === undefined) return bad(path, "null_value");
    if (typeof node === "number") return bad(path, Number.isFinite(node) ? "bare_number" : "non_finite");
    if (typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (typeof node.state === "string" || "reasons" in node) return envelope(node, path);
    for (const [k, v] of Object.entries(node)) {
      if (k === "median" && v && typeof v === "object") walk(v, `${path}.${k}`);
      else if (BY_WEEK_COUNT_KEYS.has(k)) {
        if (!Number.isInteger(v) || v < 0) bad(`${path}.${k}`, "bad_count");
      } else walk(v, path ? `${path}.${k}` : k);
    }
  };
  const SKIP = new Set(["schema", "basis", "week_basis", "classes", "wastes", "idle_waited_on", "unplaced"]);
  for (const [k, v] of Object.entries(doc)) if (!SKIP.has(k)) walk(v, k);
  // The tasks left out for want of a finish day: a count, their keys and the reasons.
  const un = doc.unplaced;
  if (!un || !Number.isInteger(un.n) || !Array.isArray(un.jobs) || un.jobs.length !== un.n || !Array.isArray(un.reasons)) bad("unplaced", "bad_unplaced");
  else for (const r of un.reasons) if (typeof r !== "string" || !hasReasonText(r)) bad("unplaced", "reason_without_text");
  const weeks = Array.isArray(doc.weeks) ? doc.weeks : [];
  let prev = null;
  weeks.forEach((w, i) => {
    if (!w || typeof w.starts_on !== "string") return bad(`weeks[${i}]`, "bad_week");
    if (prev !== null && Date.parse(`${w.starts_on}T00:00:00Z`) - prev !== 7 * 86400000) bad(`weeks[${i}]`, "weeks_not_contiguous");
    prev = Date.parse(`${w.starts_on}T00:00:00Z`);
    if (w.n === 0 && Object.keys(w).some((k) => !["week", "starts_on", "n", "n_partial", "n_day_measured", "n_day_on_or_before", "n_day_on_or_after", "n_day_about", "jobs"].includes(k))) bad(`weeks[${i}]`, "empty_week_with_figures");
  });
  return out;
}
const BY_WEEK_FINISH_PATH = /^tasks\[\d+\]\.finish_date$/;
const BY_WEEK_COUNT_KEYS = new Set(["n", "N", "n_partial", "n_day_measured", "n_day_on_or_before", "n_day_on_or_after", "n_day_about"]);

// The check also runs on the serialized file: JSON.stringify turns NaN and
// Infinity into null, so a null in the file is a number that went bad.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: check-numbers.mjs <data.json>");
    process.exit(2);
  }
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const violations = doc && doc.schema === "factory.site.by_week/1" ? checkByWeek(doc) : checkNumbers(doc);
  if (violations.length) {
    for (const v of violations.slice(0, 50)) console.error(`numbers-check: ${v.code} at ${v.path}`);
    console.error(`numbers-check: ${violations.length} violation(s) in ${file}`);
    process.exit(1);
  }
  console.log(`numbers-check: ok (${file})`);
}
