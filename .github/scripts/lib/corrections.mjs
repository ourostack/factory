// A store correction overrides specific top-level fields of one published
// facts file, permanently, against every future republish of that session.
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
// fields whose corrected value should always win over whatever a republish
// sends, while every other field still updates normally from the incoming
// data. `applyCorrection` performs that overlay; `validateCorrectionRecord`
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
const FACTS_FILE_NAME = /^(claude-code|copilot-cli)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/u;
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
        if (!CORRECTABLE_FIELDS.includes(field)) fail(errors, "correction_field_unknown", `fields.${field}`);
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
 * JSON): every field the correction record names is replaced by the
 * record's value; every other field is left exactly as `current` has it, so
 * a republish's legitimate updates (duration, counts, and so on) still land.
 * Does not validate `record`; callers validate first and never call this
 * with a record that failed validation.
 */
export function applyCorrection(current, record) {
  return { ...current, ...record.fields };
}

/** True when `applyCorrection` would change `current` at all. */
export function correctionChanges(current, record) {
  return Object.entries(record.fields).some(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value));
}

export { CORRECTABLE_FIELDS, CORRECTION_SCHEMA, FACTS_FILE_NAME };
