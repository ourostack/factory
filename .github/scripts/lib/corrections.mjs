// A store correction overrides specific top-level fields of one published
// facts file against every future republish of that session. Its `jobs`
// field is the exception: it is a ceiling, not a value (see
// `applyCorrection`), so it can only take credit away and never outlives a
// later derivation that credits less.
//
// Why this exists: a facts file can be re-sent in full by its contributor's
// client at any time (a "republish"), and the store always accepts a
// schema-valid republish of a session it already has (see
// `pipeline/validate-pr.js` in Desk: the only growth rule it enforces is
// that `session.duration_ms` never decreases). A stale client can therefore
// keep reintroducing already-corrected data forever. A one-off edit to the
// committed facts file fixes the file until the next republish overwrites it
// again.
//
// A correction record under `corrections/<facts file name>.json` names the
// fields whose corrected value should win over whatever a republish sends
// (for `jobs`, the most credit it may keep), while every other field still
// updates normally from the incoming data. `applyCorrection` performs that
// overlay; `validateCorrectionRecord`
// is the schema gate a correction record must pass, called from
// `check-corrections.mjs` (a pull request that edits `corrections/`) and
// from `apply-corrections.mjs` (every read that applies corrections). A
// malformed record must never be silently skipped: both callers stop and
// report the problem instead of quietly leaving a session uncorrected or
// applying a broken correction.

const CORRECTION_SCHEMA = "factory.correction/1";

// The top-level keys a published facts file can carry (`published-schema.js`
// in Desk), minus `schema` itself: that string is fixed and never wrong, so
// it is never a correction target.
const CORRECTABLE_FIELDS = Object.freeze([
  "session",
  "plugins",
  "models",
  "agents",
  "intervals",
  "counts",
  "refs",
  "jobs",
  "unavailable",
]);

const RECORD_KEYS = Object.freeze(["schema", "file", "fields", "reason", "date", "pr"]);
const FACTS_FILE_NAME = /^(claude-code|codex-cli|copilot-cli)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/u;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_REASON_LENGTH = 500;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRealCalendarDate(value) {
  if (!DATE_SHAPE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function fail(errors, code, path) {
  errors.push({ code, path });
}

// ---------------------------------------------------------------------------
// A self-contained mirror of the value shapes Desk's published facts schema
// (`schema.js` + `published-schema.js` in Desk) requires for each
// correctable field, so a correction's `fields` values are checked for real
// shape, not just for which keys they use. Kept self-contained rather than
// importing Desk directly: `apply-corrections.mjs` runs against a bare
// checkout in CI (only `$RUNNER_TEMP/desk` exists there, nothing locally or
// under test), and this validator must work the same way everywhere it
// runs.
//
// Scope: types, exact key sets, enum membership, numeric ranges and ID
// patterns — the structural shape Desk's own validator enforces. Left out
// on purpose: the extra date-shape/time-shape and credential-like refusal
// Desk layers onto some free-text published fields (`published-schema.js`'s
// `publicPatternField`/`publicTokenField`). Those two are a privacy
// leak-prevention pass over freshly-published data, not a shape check, and
// a correction record is maintainer-authored and reviewed like any other
// maintenance change through `factory-validate`, not a raw republish. Widen
// this if that ever changes, by mirroring `credential.js` here too, for the
// same self-containment reason.
//
// Error codes below reuse Desk's own vocabulary (`type`, `missing`,
// `unknown_key`, `pattern`, `enum`, `range`, `integer`, `too_many`, `empty`,
// `duplicate`) so a problem here reads the same way a Desk validation
// problem does; only the record-envelope errors above use the
// `correction_*` prefix, since those are about the record itself, not the
// facts value it carries.
// ---------------------------------------------------------------------------

const MAX_OFFSET_MS = 3650 * 24 * 60 * 60 * 1000; // PUBLISHED_LIMITS.maxOffsetMs

const JOB_STATUSES = Object.freeze([
  "drafting", "processing", "validating", "collaborating", "paused", "blocked", "done", "cancelled",
]);
const JOB_BASIS_VALUES = Object.freeze(["desk_tool", "file_write", "desk_commit", "spawn_brief", "inherited"]);
const HOSTS = Object.freeze(["claude-code", "copilot-cli", "codex-cli"]);
const ENTRYPOINTS = Object.freeze(["cli", "desktop", "sdk", "launcher", "unknown"]);
const END_REASONS = Object.freeze([
  "clear", "resume", "logout", "prompt_input_exit", "complete", "user_exit", "error", "other",
]);
const TOOL_KINDS = Object.freeze([
  "read", "edit", "shell", "search", "web", "agent", "desk", "skill", "mcp", "plan", "other",
]);
const INTERVAL_KINDS = Object.freeze([
  "turn", "tool", "subagent", "human_wait", "permission_wait", "api_retry", "compaction",
]);
const OUTCOMES = Object.freeze(["ok", "error", "denied", "interrupted", "timeout"]);
// `/4`: how an agent's turn ended before a human wait (`ENUMS.stopEnd` in Desk), and where a job's finish day came from.
const STOP_ENDS = Object.freeze([
  "end_turn", "max_tokens", "rate_limit", "api_error", "refusal", "interrupted", "ask_question", "ask_plan", "not_recorded",
]);
const FINISHED_BASES = Object.freeze(["transition", "card_updated"]);
// The earliest finish day a published job may carry (`FINISHED_ON_MIN` in Desk).
const FINISHED_ON_MIN = "2025-01-01";
// Published facts (`desk.factory.published/1`, `/2` and `/3`). Desk's validator checks every version against this one
// vocabulary (the version-only parts are the `human_turns` list, a `/2`
// field that is not correctable, and the `/3` commit time and `outcomes`
// flag, which `checkCorrectionAgainstFacts` keeps off older files), so there
// is no smaller `/1` vocabulary to keep apart here. A field listed here was not
// recorded: its value in the file is not a measured zero. The lists are
// compared with Desk's own by a test that runs wherever Desk is reachable
// (always in CI), so a drift is a failing test, not a refused correction.
const PUBLISHED_UNAVAILABLE_FIELDS = Object.freeze([
  "tokens", "requests", "models", "turns", "tool_durations", "permission_waits",
  "human_waits", "api_retries", "commits", "ci_runs", "plugins", "ended_at",
  "compaction_waits", "agents", "prs", "reasoning_tokens", "entrypoint", "tool_outcomes", "job_segments",
  "job_offsets", "human_turns",
  // A session with more than 256 outcomes cut (Desk's `LIMITS.outcomes`) is flagged
  // `outcomes` / `capped` instead of silently truncated.
  "outcomes",
]);
const UNAVAILABLE_REASONS = Object.freeze([
  "host_does_not_record", "log_missing", "log_truncated", "session_open",
  "not_collected_in_slice_1", "source_unreadable", "capped", "desk_public",
  "field_absent", "host_records_partly", "withheld_public",
  // An interval Desk's publishing transform dropped because it ran outside the
  // published session clock (a subagent still working after the main log's
  // last line).
  "interval_outside_session_clock",
]);

const JOB_ID_PATTERN = /^[0-9a-f]{32}$/u;
const SESSION_ID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]{1,32})?$/u;
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const PR_REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

const SHAPE_LIMITS = Object.freeze({
  plugins: 64, models: 32, intervals: 100000, prs: 500, commits: 2000,
  agents: 10000, jobs: 1000, jobTransitions: 1000,
  // Every field with every reason once (Desk computes the same from its
  // enums), so no entry set can overflow when the vocabulary grows.
  unavailable: PUBLISHED_UNAVAILABLE_FIELDS.length * UNAVAILABLE_REASONS.length,
});
const UNAVAILABLE_LIMIT = SHAPE_LIMITS.unavailable;

const shapeLeaf = (check) => ({ check });

// `check-corrections.mjs` documents its whole output vocabulary as
// `correction_*` (its own header comment); a shape problem is reported the
// same way, with the Desk vocabulary word folded in as the suffix so it
// still reads as the same problem Desk's own validator would report (e.g.
// `correction_field_type`, `correction_field_enum`).
function shapeFail(errors, code, path) {
  fail(errors, `correction_field_${code}`, path);
}

function isSafeNonNegInt(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkKnownShapeKeys(value, path, allowedKeys, errors) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) shapeFail(errors, "unknown_key", path);
  }
}

function requireShapeField(value, path, field, errors) {
  if (!Object.hasOwn(value, field)) {
    shapeFail(errors, "missing", `${path}.${field}`);
    return false;
  }
  return true;
}

/** Mirrors `schema.js`'s `validateObject`: exact key set, every key required. */
function validateShapeObject(value, path, specOrFn, errors) {
  if (!isPlainObject(value)) {
    shapeFail(errors, "type", path);
    return;
  }
  const spec = typeof specOrFn === "function" ? specOrFn(value) : specOrFn;
  checkKnownShapeKeys(value, path, Object.keys(spec), errors);
  for (const [key, field] of Object.entries(spec)) {
    if (!requireShapeField(value, path, key, errors)) continue;
    field.check(value[key], `${path}.${key}`, errors);
  }
}

function objectShapeField(specOrFn) {
  return shapeLeaf((value, path, errors) => validateShapeObject(value, path, specOrFn, errors));
}

function nullableObjectShapeField(spec) {
  return shapeLeaf((value, path, errors) => {
    if (value === null) return;
    validateShapeObject(value, path, spec, errors);
  });
}

function arrayShapeField(itemField, max) {
  return shapeLeaf((value, path, errors) => {
    if (!Array.isArray(value)) {
      shapeFail(errors, "type", path);
      return;
    }
    if (value.length > max) {
      shapeFail(errors, "too_many", path);
      return;
    }
    value.forEach((item, index) => itemField.check(item, `${path}.${index}`, errors));
  });
}

function patternShapeField(pattern) {
  return shapeLeaf((value, path, errors) => {
    if (typeof value !== "string") {
      shapeFail(errors, "type", path);
      return;
    }
    if (!pattern.test(value)) shapeFail(errors, "pattern", path);
  });
}

function enumShapeField(allowed) {
  return shapeLeaf((value, path, errors) => {
    if (typeof value !== "string") {
      shapeFail(errors, "type", path);
      return;
    }
    if (!allowed.includes(value)) shapeFail(errors, "enum", path);
  });
}

function nullableEnumShapeField(allowed) {
  return shapeLeaf((value, path, errors) => {
    if (value === null) return;
    if (typeof value !== "string") {
      shapeFail(errors, "type", path);
      return;
    }
    if (!allowed.includes(value)) shapeFail(errors, "enum", path);
  });
}

function nonNegIntShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (!isSafeNonNegInt(value)) shapeFail(errors, "integer", path);
  });
}

function nullableNonNegIntShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (value === null) return;
    if (!isSafeNonNegInt(value)) shapeFail(errors, "integer", path);
  });
}

function positiveIntShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (!Number.isSafeInteger(value) || value <= 0) shapeFail(errors, "integer", path);
  });
}

function rangeIntShapeField(min, max) {
  return shapeLeaf((value, path, errors) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) shapeFail(errors, "range", path);
  });
}

function nullableRangeIntShapeField(min, max) {
  return shapeLeaf((value, path, errors) => {
    if (value === null) return;
    if (!Number.isSafeInteger(value) || value < min || value > max) shapeFail(errors, "range", path);
  });
}

function nullableBooleanShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (value === null) return;
    if (typeof value !== "boolean") shapeFail(errors, "type", path);
  });
}

// `jobs[].finished_on` (`/4`): a real UTC calendar day no earlier than `FINISHED_ON_MIN`, or `null`.
function finishedOnShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (value === null) return;
    if (typeof value !== "string" || !isRealCalendarDate(value)) {
      shapeFail(errors, typeof value === "string" ? "pattern" : "type", path);
      return;
    }
    if (value < FINISHED_ON_MIN) shapeFail(errors, "range", path);
  });
}

function booleanShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (typeof value !== "boolean") shapeFail(errors, "type", path);
  });
}

// A signed offset in milliseconds, or `null` (`offsetField` in Desk).
function offsetShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (value === null) return;
    if (!Number.isSafeInteger(value)) {
      shapeFail(errors, "integer", path);
      return;
    }
    if (Math.abs(value) > MAX_OFFSET_MS) shapeFail(errors, "range", path);
  });
}

// A non-negative duration in milliseconds (`durationField` in Desk).
function durationShapeField() {
  return shapeLeaf((value, path, errors) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      shapeFail(errors, "integer", path);
      return;
    }
    if (value > MAX_OFFSET_MS) shapeFail(errors, "range", path);
  });
}

// An open map keyed by a subset of `allowedKeys` (`mapOfField` in Desk).
function mapOfShapeField(allowedKeys, valueField) {
  return shapeLeaf((value, path, errors) => {
    if (!isPlainObject(value)) {
      shapeFail(errors, "type", path);
      return;
    }
    if (Object.keys(value).some((key) => !allowedKeys.includes(key))) shapeFail(errors, "unknown_key", path);
    for (const [key, entry] of Object.entries(value)) {
      if (allowedKeys.includes(key)) valueField.check(entry, `${path}.${key}`, errors);
    }
  });
}

// jobs[].basis: a non-empty, duplicate-free subset of `JOB_BASIS_VALUES`
// (mirrors `checkBasis` in Desk's `schema.js`).
function checkBasisShape(value, path, errors) {
  if (!Array.isArray(value)) {
    shapeFail(errors, "type", path);
    return;
  }
  if (value.length === 0) {
    shapeFail(errors, "empty", path);
    return;
  }
  if (value.some((entry) => typeof entry !== "string" || !JOB_BASIS_VALUES.includes(entry))) {
    shapeFail(errors, "enum", path);
    return;
  }
  const seen = new Set();
  for (const entry of value) {
    if (seen.has(entry)) {
      shapeFail(errors, "duplicate", path);
      return;
    }
    seen.add(entry);
  }
}

const TOKENS_SHAPE = Object.fromEntries(
  ["input", "output", "cache_read", "cache_write", "reasoning"].map((name) => [name, nullableNonNegIntShapeField()]),
);

const SESSION_SHAPE = {
  host: enumShapeField(HOSTS),
  id: patternShapeField(SESSION_ID_V4_PATTERN),
  host_version: patternShapeField(SEMVER_PATTERN),
  entrypoint: enumShapeField(ENTRYPOINTS),
  duration_ms: durationShapeField(),
  ended: booleanShapeField(),
  end_reason: nullableEnumShapeField(END_REASONS),
};

const PLUGIN_SHAPE = {
  name: patternShapeField(PLUGIN_NAME_PATTERN),
  version: patternShapeField(SEMVER_PATTERN),
};

const MODEL_SHAPE = {
  id: patternShapeField(MODEL_ID_PATTERN),
  requests: nullableNonNegIntShapeField(),
  tokens: objectShapeField(TOKENS_SHAPE),
};

const AGENT_SHAPE = {
  n: rangeIntShapeField(0, 9999),
  parent: nullableRangeIntShapeField(0, 9999),
  model: patternShapeField(MODEL_ID_PATTERN),
};

// A pull request may carry the worker that opened it (`agent`), when it was
// created (`at_ms`, milliseconds from the session start) and, from `/4`,
// whether the session itself opened it (`created`), all optional as in
// Desk's `prFields`. A commit may carry `at_ms` too (published facts
// `/3`; `/1` and `/2` commits have only `repo` and `sha`). Both forms stay
// accepted, so a correction can restore either.
function prShape(value) {
  return {
    repo: patternShapeField(PR_REPO_PATTERN),
    number: positiveIntShapeField(),
    ...(isPlainObject(value) && Object.hasOwn(value, "agent") ? { agent: rangeIntShapeField(0, 9999) } : {}),
    ...(isPlainObject(value) && Object.hasOwn(value, "at_ms") ? { at_ms: nonNegIntShapeField() } : {}),
    ...(isPlainObject(value) && Object.hasOwn(value, "created") ? { created: booleanShapeField() } : {}),
  };
}

function commitShape(value) {
  return {
    repo: patternShapeField(PR_REPO_PATTERN),
    sha: patternShapeField(COMMIT_SHA_PATTERN),
    ...(isPlainObject(value) && Object.hasOwn(value, "at_ms") ? { at_ms: nonNegIntShapeField() } : {}),
  };
}

function refsPrivateShape(value) {
  const fields = { prs: nonNegIntShapeField(), commits: nonNegIntShapeField() };
  if (Object.hasOwn(value, "plugins")) fields.plugins = nonNegIntShapeField();
  return fields;
}

const REFS_SHAPE = {
  prs: arrayShapeField(objectShapeField(prShape), SHAPE_LIMITS.prs),
  commits: arrayShapeField(objectShapeField(commitShape), SHAPE_LIMITS.commits),
  private: objectShapeField(refsPrivateShape),
};

const TRANSITION_SHAPE = {
  to: enumShapeField(JOB_STATUSES),
  offset_ms: offsetShapeField(),
};

const OBSERVED_SHAPE = {
  status: enumShapeField(JOB_STATUSES),
  offset_ms: offsetShapeField(),
};

// Mirrors `published-schema.js`'s `JOB` exactly: this is the field the
// review named explicitly, since it is the one this correction's own
// facts session actually carries.
const JOB_SHAPE = {
  job: patternShapeField(JOB_ID_PATTERN),
  basis: shapeLeaf(checkBasisShape),
  session_offset_ms: offsetShapeField(),
  transitions: arrayShapeField(objectShapeField(TRANSITION_SHAPE), SHAPE_LIMITS.jobTransitions),
  observed: nullableObjectShapeField(OBSERVED_SHAPE),
};

// `/4` adds a finish day and its basis, which Desk requires together. A jobs
// correction is a ceiling (see `applyCorrection`), so an entry's finish day is
// accepted but never written: the file's own value stays.
function jobShape(value) {
  const has = isPlainObject(value) && (Object.hasOwn(value, "finished_on") || Object.hasOwn(value, "finished_basis"));
  return has ? { ...JOB_SHAPE, finished_on: finishedOnShapeField(), finished_basis: nullableEnumShapeField(FINISHED_BASES) } : JOB_SHAPE;
}

const STOP_SHAPE = {
  end: enumShapeField(STOP_ENDS),
  asks: nullableBooleanShapeField(),
  pending_agents: nullableBooleanShapeField(),
};

const UNAVAILABLE_SHAPE = {
  field: enumShapeField(PUBLISHED_UNAVAILABLE_FIELDS),
  reason: enumShapeField(UNAVAILABLE_REASONS),
};

function intervalShapeFields(value) {
  const fields = {
    kind: enumShapeField(INTERVAL_KINDS),
    agent: rangeIntShapeField(0, 9999),
    start_ms: nonNegIntShapeField(),
    end_ms: nonNegIntShapeField(),
  };
  if (isPlainObject(value) && value.kind === "tool") {
    fields.tool = enumShapeField(TOOL_KINDS);
    fields.outcome = enumShapeField(OUTCOMES);
  }
  // `/4`: why the agent stopped, on a human wait only.
  if (isPlainObject(value) && value.kind === "human_wait" && Object.hasOwn(value, "stop")) fields.stop = objectShapeField(STOP_SHAPE);
  return fields;
}

const COUNTS_SHAPE = {
  tool_calls: mapOfShapeField(TOOL_KINDS, nonNegIntShapeField()),
  tool_failures: mapOfShapeField(TOOL_KINDS, nonNegIntShapeField()),
  tool_retries: nonNegIntShapeField(),
  api_retries: nonNegIntShapeField(),
  compactions: nonNegIntShapeField(),
};

// One shape field per `CORRECTABLE_FIELDS` entry, each mirroring that
// field's exact published shape.
const FIELD_VALUE_SHAPES = Object.freeze({
  session: objectShapeField(SESSION_SHAPE),
  plugins: arrayShapeField(objectShapeField(PLUGIN_SHAPE), SHAPE_LIMITS.plugins),
  models: arrayShapeField(objectShapeField(MODEL_SHAPE), SHAPE_LIMITS.models),
  agents: arrayShapeField(objectShapeField(AGENT_SHAPE), SHAPE_LIMITS.agents),
  intervals: arrayShapeField(objectShapeField(intervalShapeFields), SHAPE_LIMITS.intervals),
  counts: objectShapeField(COUNTS_SHAPE),
  refs: objectShapeField(REFS_SHAPE),
  jobs: arrayShapeField(objectShapeField(jobShape), SHAPE_LIMITS.jobs),
  unavailable: arrayShapeField(objectShapeField(UNAVAILABLE_SHAPE), SHAPE_LIMITS.unavailable),
});

/**
 * `validateCorrectionRecord(record, expectedFileName) -> { ok, errors }`.
 * `expectedFileName` is the correction record's own file name inside
 * `corrections/` (e.g. `claude-code-<session id>.json`), which the record's
 * `file` field must echo exactly: the two must never disagree about which
 * facts file a correction targets.
 */
export function validateCorrectionRecord(record, expectedFileName) {
  const errors = [];
  if (!isPlainObject(record)) {
    fail(errors, "correction_type", "");
    return { ok: false, errors };
  }

  const keys = Object.keys(record).sort();
  const unknown = keys.filter((key) => !RECORD_KEYS.includes(key));
  const missing = RECORD_KEYS.filter((key) => !Object.hasOwn(record, key));
  for (const key of unknown) fail(errors, "correction_unknown_key", key);
  for (const key of missing) fail(errors, "correction_missing_key", key);

  if (Object.hasOwn(record, "schema") && record.schema !== CORRECTION_SCHEMA) {
    fail(errors, "correction_schema_mismatch", "schema");
  }

  if (Object.hasOwn(record, "file")) {
    if (typeof record.file !== "string" || !FACTS_FILE_NAME.test(record.file)) {
      fail(errors, "correction_file_invalid", "file");
    } else if (typeof expectedFileName === "string" && record.file !== expectedFileName) {
      fail(errors, "correction_file_mismatch", "file");
    }
  }

  if (Object.hasOwn(record, "fields")) {
    if (!isPlainObject(record.fields) || Object.keys(record.fields).length === 0) {
      fail(errors, "correction_fields_invalid", "fields");
    } else {
      for (const field of Object.keys(record.fields)) {
        if (!CORRECTABLE_FIELDS.includes(field)) {
          fail(errors, "correction_field_unknown", `fields.${field}`);
          continue;
        }
        // Not just the key: the value itself must have the shape Desk's
        // published facts schema requires for this field.
        FIELD_VALUE_SHAPES[field].check(record.fields[field], `fields.${field}`, errors);
      }
    }
  }

  if (Object.hasOwn(record, "reason")) {
    if (typeof record.reason !== "string" || record.reason.trim().length === 0 || record.reason.length > MAX_REASON_LENGTH) {
      fail(errors, "correction_reason_invalid", "reason");
    }
  }

  if (Object.hasOwn(record, "date") && (typeof record.date !== "string" || !isRealCalendarDate(record.date))) {
    fail(errors, "correction_date_invalid", "date");
  }

  if (Object.hasOwn(record, "pr") && (!Number.isInteger(record.pr) || record.pr <= 0)) {
    fail(errors, "correction_pr_invalid", "pr");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The facts object a correction produces from `current` (already-parsed
 * JSON). Every field the record names except `jobs` is replaced by the
 * record's value; every other field is left exactly as `current` has it, so
 * a republish's legitimate updates (duration, counts, and so on) still land.
 *
 * `jobs` is a ceiling on credit, not a value to restore: the session keeps
 * only those of its current jobs whose ID the record lists, each exactly as
 * the current facts carry it, and never gains a job the current facts do not
 * hold. Every jobs correction so far was written to undo over-binding (a
 * stale client republishing housekeeping or card-touch credit), and a
 * republish of that kind is a superset of the record, so it is cut back to
 * the record. A later derivation under newer binding rules that credits
 * fewer jobs (or none) is already within the ceiling and shows as it is: a
 * pinned value used to put the record's jobs back on top of it, crediting
 * work the latest derivation no longer finds (session 1cd05863: 11 jobs
 * pinned over a re-derivation holding none). The cost of the ceiling is that
 * a correction can no longer add a job; credit comes from a derivation.
 * Does not validate `record`; callers validate first and never call this
 * with a record that failed validation.
 */
function schemaVersion(facts) {
  const m = typeof facts?.schema === "string" ? /^desk\.factory\.published\/([0-9]+)$/u.exec(facts.schema) : null;
  return m ? Number(m[1]) : null;
}

const hasKey = (value, key) => isPlainObject(value) && Object.hasOwn(value, key);

// A human wait has no identifier: two waits are the same one when they agree on all four.
const waitKey = (interval) => JSON.stringify([interval.kind, interval.agent, interval.start_ms, interval.end_ms]);
const prKey = (pr) => JSON.stringify([pr.repo, pr.number]);

const AMBIGUOUS = Symbol("ambiguous");

// A map from key to value where a key seen more than once maps to `AMBIGUOUS`: one value cannot stand for two entries.
function uniqueValues(pairs) {
  const map = new Map();
  for (const [key, value] of pairs) map.set(key, map.has(key) ? AMBIGUOUS : value);
  return map;
}

/**
 * The `/4` keys a replaced `refs` or `intervals` list would lose. A `/4` file
 * requires `created` on every PR and `stop` on every human wait, and a record
 * that names a PR or a wait without the key says nothing about it, so the
 * file's own value for the same PR (repo and number) or wait (kind, worker,
 * start and end) stays. `needed` is each entry's file value, or `undefined`
 * when the file has none to keep.
 */
function carriedV4Keys(current, record) {
  const fields = isPlainObject(record?.fields) ? record.fields : {};
  const carried = [];
  const currentPrs = uniqueValues((Array.isArray(current?.refs?.prs) ? current.refs.prs : []).filter((pr) => hasKey(pr, "created")).map((pr) => [prKey(pr), pr.created]));
  (Array.isArray(fields.refs?.prs) ? fields.refs.prs : []).forEach((pr, index) => {
    if (!isPlainObject(pr) || hasKey(pr, "created")) return;
    carried.push({ path: `fields.refs.prs.${index}.created`, list: "prs", index, key: "created", value: currentPrs.get(prKey(pr)) });
  });
  const currentWaits = uniqueValues((Array.isArray(current?.intervals) ? current.intervals : []).filter((interval) => interval?.kind === "human_wait" && hasKey(interval, "stop")).map((interval) => [waitKey(interval), interval.stop]));
  (Array.isArray(fields.intervals) ? fields.intervals : []).forEach((interval, index) => {
    if (!isPlainObject(interval) || interval.kind !== "human_wait" || hasKey(interval, "stop")) return;
    carried.push({ path: `fields.intervals.${index}.stop`, list: "intervals", index, key: "stop", value: currentWaits.get(waitKey(interval)) });
  });
  return carried;
}

/**
 * `checkCorrectionAgainstFacts(current, record) -> errors`: a correction that
 * already passed `validateCorrectionRecord`, checked against the facts file it
 * would change. It may not write what that file's own schema version does not
 * allow: a commit time (`refs.commits[].at_ms`) or an `outcomes` flag needs
 * `/3`; a pull request time (`refs.prs[].at_ms`) needs `/2`; a pull request's
 * `created`, a human wait's `stop` and a job's finish day need `/4`. (Desk's
 * rules call each of these `inconsistent` on an older file.) In a `/4` file it
 * also refuses a record that would drop a `/4` key without the file holding a
 * value to keep (`correction_v4_key_missing`), and a created pull request in a
 * file that is, or becomes, a public desk's (`correction_inconsistent`). Empty
 * when it is fine.
 */
export function checkCorrectionAgainstFacts(current, record) {
  const errors = [];
  const version = schemaVersion(current);
  const needs = (minimum, path) => {
    if (version === null || version < minimum) fail(errors, "correction_version_mismatch", path);
  };
  const fields = isPlainObject(record?.fields) ? record.fields : {};
  const refs = isPlainObject(fields.refs) ? fields.refs : {};
  (Array.isArray(refs.commits) ? refs.commits : []).forEach((commit, i) => {
    if (isPlainObject(commit) && Object.hasOwn(commit, "at_ms")) needs(3, `fields.refs.commits.${i}.at_ms`);
  });
  (Array.isArray(refs.prs) ? refs.prs : []).forEach((pr, i) => {
    if (isPlainObject(pr) && Object.hasOwn(pr, "at_ms")) needs(2, `fields.refs.prs.${i}.at_ms`);
    if (hasKey(pr, "created")) needs(4, `fields.refs.prs.${i}.created`);
  });
  (Array.isArray(fields.intervals) ? fields.intervals : []).forEach((interval, i) => {
    if (hasKey(interval, "stop")) needs(4, `fields.intervals.${i}.stop`);
  });
  (Array.isArray(fields.jobs) ? fields.jobs : []).forEach((job, i) => {
    if (hasKey(job, "finished_on")) needs(4, `fields.jobs.${i}.finished_on`);
    if (hasKey(job, "finished_basis")) needs(4, `fields.jobs.${i}.finished_basis`);
  });
  (Array.isArray(fields.unavailable) ? fields.unavailable : []).forEach((entry, i) => {
    if (isPlainObject(entry) && entry.field === "outcomes") needs(3, `fields.unavailable.${i}.field`);
  });
  if (version !== null && version >= 4) {
    for (const item of carriedV4Keys(current, record)) {
      if (item.value === undefined) fail(errors, "correction_v4_key_missing", item.path);
      else if (item.value === AMBIGUOUS) fail(errors, "correction_v4_key_ambiguous", item.path);
    }
    // A public desk publishes every PR as `created: false` (the GitHub creation time of a PR the session opened would date the session).
    const unavailable = Array.isArray(fields.unavailable) ? fields.unavailable : current.unavailable;
    const isPublic = (Array.isArray(unavailable) ? unavailable : []).some((entry) => isPlainObject(entry) && entry.field === "job_offsets" && entry.reason === "desk_public");
    if (isPublic) {
      // The result, not only the named PRs: a PR the record does not name keeps the file's own flag.
      const carriedValue = new Map(carriedV4Keys(current, record).filter((item) => item.list === "prs").map((item) => [item.index, item.value]));
      const named = Array.isArray(refs.prs);
      (named ? refs.prs : Array.isArray(current.refs?.prs) ? current.refs.prs : []).forEach((pr, i) => {
        if (!isPlainObject(pr)) return;
        const created = hasKey(pr, "created") ? pr.created : named ? carriedValue.get(i) : undefined;
        if (created === true) fail(errors, "correction_inconsistent", `${named ? "fields.refs" : "refs"}.prs.${i}.created`);
      });
    }
  }
  return errors;
}

export function applyCorrection(current, record) {
  const corrected = { ...current, ...record.fields };
  // A `/4` key the record does not name stays as the file has it. (`checkCorrectionAgainstFacts` has already refused a record that leaves one the file cannot supply.)
  if (schemaVersion(current) >= 4) {
    const carried = carriedV4Keys(current, record).filter((item) => item.value !== undefined && item.value !== AMBIGUOUS);
    // New arrays: the record's own lists are never changed.
    if (carried.some((item) => item.list === "prs")) corrected.refs = { ...corrected.refs, prs: [...corrected.refs.prs] };
    if (carried.some((item) => item.list === "intervals")) corrected.intervals = [...corrected.intervals];
    for (const { list, index, key, value } of carried) {
      const container = list === "prs" ? corrected.refs.prs : corrected.intervals;
      container[index] = { ...container[index], [key]: value };
    }
  }
  if (Object.hasOwn(record.fields, "jobs")) {
    const allowed = new Set(record.fields.jobs.map((entry) => entry.job));
    corrected.jobs = (Array.isArray(current.jobs) ? current.jobs : []).filter((entry) => typeof entry?.job === "string" && allowed.has(entry.job));
  }
  return corrected;
}

/** True when `applyCorrection` would change `current` at all. */
export function correctionChanges(current, record) {
  const corrected = applyCorrection(current, record);
  return Object.keys(record.fields).some((key) => JSON.stringify(current[key]) !== JSON.stringify(corrected[key]));
}

// The mirrored vocabulary, exported only so a test can compare it with Desk's.
const MIRRORED_VOCABULARY = Object.freeze({
  host: HOSTS,
  entrypoint: ENTRYPOINTS,
  endReason: END_REASONS,
  toolKind: TOOL_KINDS,
  intervalKind: INTERVAL_KINDS,
  outcome: OUTCOMES,
  jobStatus: JOB_STATUSES,
  stopEnd: STOP_ENDS,
  finishedBasis: FINISHED_BASES,
  jobBasis: JOB_BASIS_VALUES,
  publishedUnavailableField: PUBLISHED_UNAVAILABLE_FIELDS,
  unavailableReason: UNAVAILABLE_REASONS,
});

// Values the store accepts before Desk main does. A change to a frozen
// contract lands in the store first (the version-skew rule), so for a while
// the store's list holds a value Desk's does not. The comparison with Desk
// allows exactly these and nothing else; a value Desk lacks and that is not
// listed here is a drift. Remove an entry once Desk main has the value.
const STORE_AHEAD_OF_DESK = Object.freeze({});

export { MIRRORED_VOCABULARY, STORE_AHEAD_OF_DESK, CORRECTABLE_FIELDS, CORRECTION_SCHEMA, FACTS_FILE_NAME, PUBLISHED_UNAVAILABLE_FIELDS, UNAVAILABLE_LIMIT, UNAVAILABLE_REASONS };
