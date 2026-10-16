// Read-only publication adapter, not a second comparison algorithm.
// Raw issue bodies and canonical job/session records never cross this boundary.

export const CHECK_METHOD = Object.freeze({
  confidence: 0.95, bootstrap_resamples: 10000, min_groups_per_side: 6, seed_policy: "issue_number",
})

const MEASURES = new Set([
  "lead_time", "queue_before_start", "active_time", "flow_efficiency", "human_wait", "permission_wait",
  "api_retry_wait", "tool_failures", "tool_retries", "api_retries", "compactions", "retouches",
  "muda_time", "search_waste",
  ...["defects", "overproduction", "waiting", "non_utilized_talent", "transportation", "inventory", "motion", "extra_processing"].map((w) => `muda_time.${w}`),
])
const EXCLUSIONS = new Set([
  "open_job", "plugin_not_reported", "mixed_versions", "partial", "censored", "not_labeled", "not_in_published_facts",
  "job_offsets_unavailable", "status_unavailable", "cancelled", "no_wait_intervals", "zero_lead_time",
  "mixed", "no_active_intervals", "card_dates_shorter_than_work", "wait_fields_unavailable",
  "worker_split", "worker_shared", "no_sessions", "finish_time_not_known",
  "host_does_not_record", "log_missing", "log_truncated", "session_open", "not_collected_in_slice_1",
  "source_unreadable", "capped", "desk_public", "field_absent", "host_records_partly", "withheld_public",
  "interval_outside_session_clock",
])
const PARSE_ERRORS = new Set([
  "no_block", "multiple_blocks", "too_large", "syntax", "unknown_key", "duplicate_key", "missing_key",
  "unsupported_card_version", "unknown_measure", "invalid_job_class", "job_class_not_published",
  "invalid_evidence_jobs", "invalid_countermeasure", "invalid_plugin", "invalid_version", "invalid_hypothesis",
])
const ISSUE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\/issues\/([1-9]\d{0,9})$/
const PULL = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/[1-9]\d{0,9}$/
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]{1,32})?$/
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k))
const count = (n) => Number.isSafeInteger(n) && n >= 0
const finite = (n) => typeof n === "number" && Number.isFinite(n)
const direction = (s) => s === "down" || s === "up"
const codes = (v, allowed) => Array.isArray(v) && v.every((c) => allowed.has(c)) && new Set(v).size === v.length
const failure = () => { throw new Error("improvement_checks_invalid") }

function reference(url) {
  const m = typeof url === "string" ? ISSUE.exec(url) : null
  return m ? { ref: `${m[1]}#${m[2]}`, number: Number(m[2]) } : null
}

function validCard(c) {
  return exact(c, ["signal", "job_class", "measure", "direction", "plugin", "version", "countermeasure"]) &&
    MEASURES.has(c.signal) && MEASURES.has(c.measure) && ["any", "other"].includes(c.job_class) &&
    direction(c.direction) && typeof c.plugin === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c.plugin) &&
    (c.version === null || (typeof c.version === "string" && VERSION.test(c.version))) &&
    (c.countermeasure === null || (typeof c.countermeasure === "string" && PULL.test(c.countermeasure)))
}

function bounds(r) {
  return r.state === "partial"
    ? { before: "lower", after: "lower", change: "unknown", interval: "unknown" }
    : { before: "exact", after: "exact", change: "exact", interval: "exact" }
}

function validSide(s) {
  return exact(s, ["jobs", "groups", "median"]) && count(s.jobs) && count(s.groups) &&
    s.groups <= s.jobs && (s.jobs === 0 ? s.groups === 0 && s.median === null : s.groups > 0 && finite(s.median) && s.median >= 0)
}

function validResult(r, card) {
  if (!exact(r, ["verdict", "state", "reasons", "bounds", "jobs", "excluded", "comparison"]) ||
      !["measured", "partial"].includes(r.state) ||
      !codes(r.reasons, new Set(["host_records_partly"])) ||
      (r.state === "partial" ? r.reasons.length !== 1 : r.reasons.length !== 0) ||
      !exact(r.bounds, ["before", "after", "change", "interval"]) ||
      Object.entries(bounds(r)).some(([k, v]) => r.bounds[k] !== v) || !count(r.jobs) ||
      !Array.isArray(r.excluded) || !r.excluded.every((e) => exact(e, ["reason", "jobs"]) && EXCLUSIONS.has(e.reason) && count(e.jobs) && e.jobs > 0) ||
      new Set(r.excluded.map((e) => e.reason)).size !== r.excluded.length) return false
  const c = r.comparison
  if (!exact(c, ["before", "after", "change", "interval", "direction"]) || !validSide(c.before) || !validSide(c.after) ||
      c.before.jobs + c.after.jobs + r.excluded.reduce((n, e) => n + e.jobs, 0) !== r.jobs) return false
  const hasBoth = c.before.median !== null && c.after.median !== null
  if (hasBoth ? !finite(c.change) || c.change !== c.after.median - c.before.median : c.change !== null) return false
  const enough = c.before.groups >= CHECK_METHOD.min_groups_per_side && c.after.groups >= CHECK_METHOD.min_groups_per_side
  if (!enough) return r.verdict === "too_few_jobs" && c.interval === null && c.direction === null
  if (!Array.isArray(c.interval) || c.interval.length !== 2 || !c.interval.every(finite) || c.interval[0] > c.interval[1]) return false
  const observed = c.interval[1] < 0 ? "down" : c.interval[0] > 0 ? "up" : null
  return c.direction === observed && r.verdict === (observed === null ? "no_clear_change" : observed === card.direction ? "confirmed" : "not_confirmed")
}

// This closed contract is the ONLY numeric exception for data.improvement_checks.
// Null is allowed only for the canonical comparison's missing medians/interval,
// unshipped version and absent public countermeasure. Unknown fields fail closed.
export function validateImprovementChecks(doc) {
  const invalid = () => ({ ok: false, codes: ["improvement_checks_invalid"] })
  if (!exact(doc, ["schema", "availability", "reasons", "method", "sources", "checks"]) ||
      doc.schema !== "factory-improvement-checks/1" || !["available", "partial", "unavailable"].includes(doc.availability) ||
      !codes(doc.reasons, new Set(["canonical_source_unavailable", "issues_unavailable", "first_page_only"])) ||
      !exact(doc.method, Object.keys(CHECK_METHOD)) || Object.entries(CHECK_METHOD).some(([k, v]) => doc.method[k] !== v) ||
      !exact(doc.sources, ["desk", "facts", "reports"]) ||
      !Object.values(doc.sources).every((v) => typeof v === "string" && (v === "unavailable" || /^[a-f0-9]{40}$/.test(v))) ||
      !object(doc.checks)) return invalid()
  const unavailable = doc.reasons.includes("canonical_source_unavailable") || doc.reasons.includes("issues_unavailable")
  if (doc.availability !== (unavailable ? "unavailable" : doc.reasons.length ? "partial" : "available")) return invalid()
  for (const [key, row] of Object.entries(doc.checks)) {
    const ref = reference(row?.url)
    if (!ref || ref.ref !== key || row.ref !== key || !["open", "closed"].includes(row.issue_state) || !Array.isArray(row.reasons)) return invalid()
    const base = ["ref", "url", "issue_state", "status", "reasons"]
    if (row.status === "checked" || row.status === "waiting_for_version") {
      if (!exact(row, [...base, "card", ...(row.status === "checked" ? ["result"] : [])]) ||
          !validCard(row.card) || row.reasons.length || doc.reasons.includes("canonical_source_unavailable") ||
          (row.status === "checked" ? row.card.version === null || !validResult(row.result, row.card) : row.card.version !== null)) return invalid()
    } else {
      if (!exact(row, base)) return invalid()
      if (row.status === "unavailable") {
        if (!doc.reasons.includes("canonical_source_unavailable") || row.reasons.length !== 1 || row.reasons[0] !== "canonical_source_unavailable") return invalid()
      } else if (row.status === "no_check") {
        if (row.reasons.length !== 1 || row.reasons[0] !== "no_block") return invalid()
      } else if (row.status !== "refused" || row.reasons.length === 0 || !codes(row.reasons, PARSE_ERRORS) || row.reasons.includes("no_block")) return invalid()
    }
  }
  return { ok: true, codes: [] }
}

/**
 * issues: a verified public issue array, or fetchIssues' {verification,
 * truncated?, issues}. records: one canonical storeRecords snapshot.
 * parseCard/checkCard: injected current Desk functions. No IO or mutations.
 * Missing optional dependencies mean unavailable; thrown runtime failures
 * propagate. Refused individual cards are normal results, not exceptions.
 */
export function buildImprovementChecks({ issues, records, parseCard, checkCard }) {
  const fetched = Array.isArray(issues) ? { verification: "verified", issues } : issues
  if (fetched != null && (!object(fetched) || !["verified", "unavailable"].includes(fetched.verification) || !Array.isArray(fetched.issues))) failure()
  const canonical = typeof parseCard === "function" && typeof checkCard === "function" && Array.isArray(records)
  const reasons = [
    ...(!canonical ? ["canonical_source_unavailable"] : []),
    ...(fetched?.verification !== "verified" ? ["issues_unavailable"] : []),
    ...(fetched?.truncated ? ["first_page_only"] : []),
  ]
  const doc = {
    schema: "factory-improvement-checks/1",
    availability: reasons.some((r) => r !== "first_page_only") ? "unavailable" : reasons.length ? "partial" : "available",
    reasons, method: { ...CHECK_METHOD }, sources: { desk: "unavailable", facts: "unavailable", reports: "unavailable" }, checks: {},
  }
  for (const issue of fetched?.issues ?? []) {
    const ref = reference(issue?.url ?? issue?.html_url)
    if (!ref || ref.number !== issue.number || !["open", "closed"].includes(issue.state) || Object.hasOwn(doc.checks, ref.ref)) failure()
    const row = { ref: ref.ref, url: issue.url ?? issue.html_url, issue_state: issue.state, status: "unavailable", reasons: ["canonical_source_unavailable"] }
    doc.checks[ref.ref] = row
    if (!canonical) continue
    const parsed = parseCard(issue.body)
    if (parsed?.ok === false) {
      const errors = parsed.errors
      if (!Array.isArray(errors) || !errors.length || errors.some((e) => !PARSE_ERRORS.has(e?.code))) failure()
      row.reasons = [...new Set(errors.map((e) => e.code))].sort()
      row.status = row.reasons.length === 1 && row.reasons[0] === "no_block" ? "no_check" : "refused"
      continue
    }
    if (parsed?.ok !== true || !object(parsed.card)) failure()
    const c = parsed.card
    row.card = {
      signal: c.signal, job_class: c.job_class, measure: c.hypothesis?.measure, direction: c.hypothesis?.direction,
      plugin: c.plugin, version: c.version, countermeasure: c.countermeasure,
    }
    if (!validCard(row.card)) failure()
    const checked = checkCard(c, records, { seed: ref.number })
    row.status = checked?.status
    row.reasons = []
    if (checked?.status === "checked") {
      const comparison = checked.comparison
      if (!object(comparison) || !object(comparison.before) || !object(comparison.after) || !Array.isArray(checked.excluded)) failure()
      const side = (s) => ({ jobs: s.jobs, groups: s.groups, median: s.median })
      row.result = {
        verdict: checked.verdict, state: checked.state, reasons: Array.isArray(checked.reasons) ? [...checked.reasons] : checked.reasons,
        bounds: bounds(checked), jobs: checked.jobs,
        excluded: checked.excluded.map((e) => ({ reason: e.reason, jobs: e.jobs })),
        comparison: {
          before: side(comparison.before), after: side(comparison.after), change: comparison.change,
          interval: Array.isArray(comparison.interval) ? [...comparison.interval] : comparison.interval, direction: comparison.direction,
        },
      }
    }
  }
  if (!validateImprovementChecks(doc).ok) failure()
  return doc
}
