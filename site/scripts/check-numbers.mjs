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

function isStated(node) {
  return node && typeof node === "object" && !Array.isArray(node) && ("state" in node || "reasons" in node);
}

export function checkNumbers(data) {
  const out = [];
  const bad = (path, code) => out.push({ path, code });

  function stated(node, path) {
    if (typeof node.state !== "string") return bad(path, "missing_state");
    if (!STATES.has(node.state)) return bad(path, "bad_state");
    if (!Array.isArray(node.reasons)) bad(path, "missing_reasons");
    else if (node.state !== "measured" && node.reasons.length === 0) bad(path, "missing_reasons");
    if (node.state === "unavailable") {
      if ("value" in node) bad(path, "value_on_unavailable");
    } else if (!("value" in node)) {
      bad(path, "missing_value");
    }
    if ("value" in node) {
      const v = node.value;
      if (v === null || v === undefined) bad(path, "null_value");
      else if (typeof v === "number" && !Number.isFinite(v)) bad(path, "non_finite");
      else if (typeof v !== "number" && typeof v !== "string") bad(path, "bad_value_type");
    }
    const hasRollupKey = "n" in node || "N" in node || "of" in node;
    if (hasRollupKey) {
      const { n, N, of } = node;
      if (!Number.isInteger(n) || !Number.isInteger(N) || typeof of !== "string" || !of) {
        bad(path, "rollup_missing_n");
      } else if (n > N) {
        bad(path, "rollup_n_exceeds_N");
      } else {
        const want = n === 0 ? "unavailable" : n < N ? "partial" : "measured";
        if (node.state !== want) bad(path, "rollup_state_mismatch");
      }
    }
  }

  function walk(node, path, top) {
    if (node === null) return bad(path, "null_value");
    if (node === undefined) return bad(path, "undefined_value");
    if (typeof node === "number") {
      return bad(path, Number.isFinite(node) ? "bare_number" : "non_finite");
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, `${path}[${i}]`, false));
      return;
    }
    if (isStated(node)) {
      stated(node, path);
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
