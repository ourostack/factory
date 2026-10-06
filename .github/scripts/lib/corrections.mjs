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
// Published facts (`desk.factory.published/2`). Desk's validator checks `/1`
// and `/2` files against this one vocabulary (the only `/2`-only part is the
// `human_turns` list, which is not a correctable field), so there is no
// smaller `/1` vocabulary to keep apart here. A field listed here was not
// recorded: its value in the file is not a measured zero. The lists are
// compared with Desk's own by a test that runs wherever Desk is reachable
// (always in CI), so a drift is a failing test, not a refused correction.
const PUBLISHED_UNAVAILABLE_FIELDS = Object.freeze([
  "tokens", "requests", "models", "turns", "tool_durations", "permission_waits",
  "human_waits", "api_retries", "commits", "ci_runs", "plugins", "ended_at",
  "compaction_waits", "agents", "prs", "reasoning_tokens", "entrypoint", "tool_outcomes", "job_segments",
  "job_offsets", "human_turns",
]);
const UNAVAILABLE_REASONS = Object.freeze([
  "host_does_not_record", "log_missing", "log_truncated", "session_open",
  "not_collected_in_slice_1", "source_unreadable", "capped", "desk_public",
  "field_absent", "host_records_partly", "withheld_public",
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

const PR_SHAPE = {
  repo: patternShapeField(PR_REPO_PATTERN),
  number: positiveIntShapeField(),
};

const COMMIT_SHAPE = {
  repo: patternShapeField(PR_REPO_PATTERN),
  sha: patternShapeField(COMMIT_SHA_PATTERN),
};

function refsPrivateShape(value) {
  const fields = { prs: nonNegIntShapeField(), commits: nonNegIntShapeField() };
  if (Object.hasOwn(value, "plugins")) fields.plugins = nonNegIntShapeField();
  return fields;
}

const REFS_SHAPE = {
  prs: arrayShapeField(objectShapeField(PR_SHAPE), SHAPE_LIMITS.prs),
  commits: arrayShapeField(objectShapeField(COMMIT_SHAPE), SHAPE_LIMITS.commits),
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
  jobs: arrayShapeField(objectShapeField(JOB_SHAPE), SHAPE_LIMITS.jobs),
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
export function applyCorrection(current, record) {
  const corrected = { ...current, ...record.fields };
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
  jobBasis: JOB_BASIS_VALUES,
  publishedUnavailableField: PUBLISHED_UNAVAILABLE_FIELDS,
  unavailableReason: UNAVAILABLE_REASONS,
});

export { MIRRORED_VOCABULARY, CORRECTABLE_FIELDS, CORRECTION_SCHEMA, FACTS_FILE_NAME, PUBLISHED_UNAVAILABLE_FIELDS, UNAVAILABLE_LIMIT, UNAVAILABLE_REASONS };
