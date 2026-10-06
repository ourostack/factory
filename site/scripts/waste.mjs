// The waste breakdown's honesty rules. The waste table is Desk's rollup over
// finished jobs' labels (`rollups/muda.json`); this module decides how each
// row may be shown.
//
//   - `unknown` is a real label: the evaluator looked and could not tell. It
//     keeps its own row, with its own time. It is never added to another
//     waste, never dropped, and never shown as sound.
//   - A row may carry `confidence_ms: { high, medium, low }`, the time resting
//     on labels of each confidence the evaluator gave. All three must be
//     whole, non-negative numbers and together equal the row's own
//     `total_ms` exactly: a confidence that covers none or only part of the
//     row's time says nothing about the rest. Anything else (absent, null,
//     one missing, a negative, a text, a sum that is not the total) is "not
//     recorded", never a zero. A row with no recorded confidence is not
//     shown as sound.
//   - A row is sound only when its confidence is recorded and no time rests
//     on a low-confidence label, and it is not the `unknown` row. Every other
//     row says why it is not, in `qualifiers`:
//       `unknown_label`          the row is the evaluator's "could not tell"
//       `low_confidence`         some time rests on low-confidence labels
//       `confidence_not_recorded` the rollup gave no usable confidence
//   - A row's `evaluator_versions` lists the distinct evaluator plugin
//     versions of the labels that contributed to that row. Absent is "not
//     recorded", not none.
//   - `unknown` time is part of every row's share denominator, which is
//     the waste and unknown time together (value and support time are not
//     in it), but not of `muda_time_ms`: it is not known to be waste. The site adds nothing to a waste total.

import { measured, partial, unavailable } from "./state.mjs";
import { direct } from "./bounds.mjs";

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
    isCount(total) &&
    c && typeof c === "object" && !Array.isArray(c) &&
    CONFIDENCE_LEVELS.every((level) => isCount(c[level])) &&
    CONFIDENCE_LEVELS.reduce((sum, level) => sum + c[level], 0) === total;
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

const STAGES = ["alpha", "beta", "rc"];

// A version as a comparable tuple; a release sorts after its prereleases.
function versionTuple(v) {
  const [core, pre] = v.split("-");
  const [major, minor, patch] = core.split(".").map(Number);
  if (!pre) return [major, minor, patch, STAGES.length, 0];
  const [stage, n] = pre.split(".");
  return [major, minor, patch, STAGES.indexOf(stage), Number(n)];
}

export function compareVersions(a, b) {
  const x = versionTuple(a);
  const y = versionTuple(b);
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `evaluatorVersions(raw) -> string[] | null`: the versions listed, or null when none were recorded. */
export function evaluatorVersions(raw) {
  if (!Array.isArray(raw)) return null;
  const versions = [...new Set(raw.filter((v) => typeof v === "string" && VERSION.test(v)))].sort(compareVersions);
  return versions.length ? versions : null;
}

/** The versions as a stated value for the page: a comma-separated list, or unavailable (never an empty list). */
export function evaluatorVersionsFigure(raw) {
  const versions = evaluatorVersions(raw);
  return versions ? measured(versions.join(", ")) : unavailable(["not_recorded"]);
}

// One job's labeled time, from the evaluator's label files for its sessions
// (`labels/<job>/<session>.json`). Time is summed per class (value, support)
// and per waste (the eight, and `unknown` as its own row), largest first.
// Each row carries the time resting on each confidence level; a row with any
// stretch whose confidence was not recorded (a `/1` label) has no recorded
// confidence. With fewer label files than bound sessions, every row is at
// least its figure (`some_sessions_not_labeled`). No label file is no data.
const ROW_KINDS = { value: "value", support: "support" };
const LEVELS = new Set(CONFIDENCE_LEVELS);

export function jobWaste(docs, sessionsBound) {
  const usable = (Array.isArray(docs) ? docs : []).filter((d) => d && Array.isArray(d.stretches));
  if (!usable.length) return { sessions_labeled: measured(0), rows: [] };
  const rows = new Map();
  for (const d of usable) {
    for (const s of d.stretches) {
      if (!s || !Number.isFinite(s.start_ms) || !Number.isFinite(s.end_ms) || s.end_ms < s.start_ms) continue;
      const key = s.class === "muda" && typeof s.waste === "string" ? s.waste : s.class === "unknown" ? UNKNOWN_WASTE : ROW_KINDS[s.class];
      if (!key) continue;
      const row = rows.get(key) || { total: 0, levels: { high: 0, medium: 0, low: 0 }, recorded: true };
      const ms = Math.round(s.end_ms - s.start_ms);
      row.total += ms;
      if (LEVELS.has(s.confidence)) row.levels[s.confidence] += ms;
      else row.recorded = false;
      rows.set(key, row);
    }
  }
  const bound = sessionsBound && sessionsBound.state === "measured" ? sessionsBound.value : null;
  const whole = bound !== null && usable.length >= bound;
  const figure = (ms) => (whole ? measured(ms) : direct(partial(ms, ["some_sessions_not_labeled"]), "job_waste_ms"));
  const out = [...rows]
    .map(([key, r]) => ({
      key,
      kind: ROW_KINDS[key] || (key === UNKNOWN_WASTE ? "unknown" : "waste"),
      total_ms: figure(r.total),
      confidence: confidenceFigures(r.recorded ? { recorded: true, parts: r.levels } : { recorded: false }),
      qualifiers: ROW_KINDS[key] ? [] : qualifiersOf(key, r.recorded ? { recorded: true, parts: r.levels } : { recorded: false }),
    }))
    .sort((a, b) => b.total_ms.value - a.total_ms.value);
  return { sessions_labeled: measured(usable.length), rows: out };
}
