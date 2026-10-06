// The waste breakdown's honesty rules. The waste table is Desk's rollup over
// finished jobs' labels (`rollups/muda.json`); this module decides how each
// row may be shown.
//
//   - `unknown` is a real label: the evaluator looked and could not tell. It
//     keeps its own row, with its own time. It is never added to another
//     waste, never dropped, and never shown as sound.
//   - A row may carry `confidence_ms: { high, medium, low }`, the time resting
//     on labels of each confidence the evaluator gave. All three must be
//     whole, non-negative numbers, none above the row's own total; anything
//     else (absent, null, one missing, a negative, a text) is "not recorded",
//     never a zero. A row with no recorded confidence is not shown as sound.
//   - A row is sound only when its confidence is recorded and no time rests
//     on a low-confidence label, and it is not the `unknown` row. Every other
//     row says why it is not, in `qualifiers`:
//       `unknown_label`          the row is the evaluator's "could not tell"
//       `low_confidence`         some time rests on low-confidence labels
//       `confidence_not_recorded` the rollup gave no usable confidence
//   - `evaluator_versions` (on the rollup) lists the evaluator plugin versions
//     that assigned the labels counted. Absent is "not recorded", not none.

import { measured, unavailable } from "./state.mjs";

export const UNKNOWN_WASTE = "unknown";
export const CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);
const NOT_RECORDED = ["confidence_not_recorded"];
// The evaluator's own version shape (Desk's label schema): major.minor.patch,
// optionally `-alpha.N`, `-beta.N` or `-rc.N`.
const VERSION = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:-(?:alpha|beta|rc)\.[0-9]{1,4})?$/u;

const isCount = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** `confidenceOf(row) -> { recorded, parts }`: each level's time, or none at all. */
export function confidenceOf(row) {
  const c = row?.confidence_ms;
  const total = row?.total_ms;
  const ok =
    c && typeof c === "object" && !Array.isArray(c) &&
    CONFIDENCE_LEVELS.every((level) => isCount(c[level]) && (!isCount(total) || c[level] <= total));
  if (!ok) return { recorded: false, parts: null };
  return { recorded: true, parts: { high: c.high, medium: c.medium, low: c.low } };
}

/** `qualifiersOf(waste, confidence) -> string[]`: why a row is not sound; empty when it is. */
export function qualifiersOf(waste, confidence) {
  const out = [];
  if (waste === UNKNOWN_WASTE) out.push("unknown_label");
  if (!confidence.recorded) out.push("confidence_not_recorded");
  else if (confidence.parts.low > 0) out.push("low_confidence");
  return out;
}

/** The row's confidence figures as stated numbers: a missing one is unavailable, never 0. */
export function confidenceFigures(confidence) {
  const part = (level) => (confidence.recorded ? measured(confidence.parts[level]) : unavailable(NOT_RECORDED));
  return { high_ms: part("high"), medium_ms: part("medium"), low_ms: part("low") };
}

/** `evaluatorVersions(raw) -> string[] | null`: the versions listed, or null when none were recorded. */
export function evaluatorVersions(raw) {
  if (!Array.isArray(raw)) return null;
  const versions = [...new Set(raw.filter((v) => typeof v === "string" && VERSION.test(v)))].sort();
  return versions.length ? versions : null;
}

/** The versions as a stated value for the page: a comma-separated list, or unavailable (never an empty list). */
export function evaluatorVersionsFigure(raw) {
  const versions = evaluatorVersions(raw);
  return versions ? measured(versions.join(", ")) : unavailable(["not_recorded"]);
}
