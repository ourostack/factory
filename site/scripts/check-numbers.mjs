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
import { pathToFileURL } from "node:url";

const STATES = new Set(["measured", "partial", "unavailable"]);
const STATED_KEYS = new Set(["state", "value", "reasons", "bound", "basis", "kind", "n", "N", "of", "out_of_scope", "excluded", "run_url"]);
const ROLLUP_KEYS = ["n", "N", "of", "out_of_scope", "excluded"];

// Paths in data.json that must be rollups (they sum, take a median or a
// share over a population). A rollup that lost its marker and its counts is
// caught here, by where it sits, not by what it still carries.
const ROLLUP_PATHS = [
  /^time_breakdown\[\d+\]\.(median|p75)$/,
  /^flow_efficiency\.(median|p75)$/,
  /^tool_calls_total$/,
  /^tool_kinds\[\d+\]\.(calls|failures|sessions|failure_rate)$/,
  /^models\[\d+\]\.(requests|input|output|cache_read|cache_write)$/,
  /^subagents\.(dispatches|sessions_with_subagents)$/,
  /^subagents\.buckets\.[^.]+$/,
  /^waste\.breakdown\[\d+\]\.(total_ms|share)$/,
  /^headlines\[\d+\]\.number$/,
  /^takeaways\[\d+\]\.slots\.(median|rate|calls|failures|share|with|dispatches)$/,
];
// Headlines that are plain counts of files or jobs, not rollups.
const COUNT_HEADLINES = new Set(["substantial_sessions", "jobs_tracked", "kaizen"]);

// A string that stands for a value that is missing or bad.
const BAD_STRING = /^(nan|null|undefined|-?infinity|-?\d+(\.\d+)?)?$/i;
const FREE_KEYS = new Set(["id", "session_id", "ref"]);

function isStated(node) {
  return node && typeof node === "object" && !Array.isArray(node) && ("state" in node || "reasons" in node);
}

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
    if ("bound" in node && node.bound !== "lower" && node.bound !== "upper") bad(path, "bad_bound");
    if ("basis" in node && node.basis !== "declared" && node.basis !== "inferred") bad(path, "bad_basis");
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
        const want = n === 0 ? "unavailable" : n < N ? "partial" : "measured";
        if (node.state !== want) bad(path, "rollup_state_mismatch");
      }
      if ("excluded" in node) {
        const ex = node.excluded;
        if (!ex || typeof ex !== "object" || Object.values(ex).some((c) => !Number.isInteger(c) || c < 0)) bad(path, "bad_excluded");
      }
    } else if (hasRollupKey || "kind" in node) {
      bad(path, "rollup_missing_kind");
    }
    if (!isTop && node.kind !== "rollup" && ROLLUP_PATHS.some((re) => re.test(path))) {
      const m = path.match(/^headlines\[(\d+)\]\.number$/);
      const id = m ? data.headlines?.[Number(m[1])]?.id : null;
      if (!(m && COUNT_HEADLINES.has(id))) bad(path, "rollup_expected");
    }
  }

  function walk(node, path, top) {
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
  return out;
}

// The check also runs on the serialized file: JSON.stringify turns NaN and
// Infinity into null, so a null in the file is a number that went bad.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: check-numbers.mjs <data.json>");
    process.exit(2);
  }
  const violations = checkNumbers(JSON.parse(readFileSync(file, "utf8")));
  if (violations.length) {
    for (const v of violations.slice(0, 50)) console.error(`numbers-check: ${v.code} at ${v.path}`);
    console.error(`numbers-check: ${violations.length} violation(s) in ${file}`);
    process.exit(1);
  }
  console.log(`numbers-check: ok (${file})`);
}
