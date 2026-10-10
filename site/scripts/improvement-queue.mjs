// Pure reduction of authentic, already-accepted main-branch transport batches.
// This is not an execution queue, a claim writer, or an authorization source.
import { validateTriageChangeValues, validateTriageValues } from "../../.github/scripts/triage-values.mjs"

const MAX_AGE_MS = 72 * 3600000
const clone = (v) => structuredClone(v)
const stable = (v) => {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
  return v
}
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))
const fresh = (at, now) => Number.isFinite(at) && Number.isFinite(now) && at <= now && now - at <= MAX_AGE_MS
const pointerEqual = (a, b) => a.kind === b.kind && a.ref === b.ref && a.revision === b.revision
const GATE_WORDS = {
  intent: "The desired outcome needs its owner's decision",
  scope: "The scope needs its owner's decision",
  approval: "The work needs explicit approval",
  voice: "The public wording needs its owner's decision",
  spend: "The spending needs its owner's decision",
  account: "The account change needs its owner's decision",
  irreversible: "The irreversible action needs its owner's decision",
}

export function presentTriageContext({ row, publicEvidence = [] }) {
  if (!validPublicRow(row)) throw new Error("triage_projection_invalid")
  const stale = row.state !== "reviewed" || row.conflict === true || ["stale", "never", "unknown"].includes(row.age)
  // Exact pointer AND basis revision AND positive public visibility. No URL
  // heuristic, title parsing, or caller-supplied decision field is authority.
  const seen = new Set()
  const context = stale ? [] : row.evidence.flatMap((pointer) => {
    const key = JSON.stringify(pointer)
    if (seen.has(key)) return []
    seen.add(key)
    if (!row.basis.evidence_revisions.some((p) => pointerEqual(p, pointer))) return []
    const matching = (Array.isArray(publicEvidence) ? publicEvidence : []).filter((p) => p && pointerEqual(p, pointer))
    if (matching.some((p) => p.visibility !== "public")) return []
    const matches = matching.filter((p) =>
      typeof p.label === "string" && p.label.trim() && p.label.length <= 1200 && !/[\p{Cc}\p{Cf}]/u.test(p.label))
    if (!matches.length || matches.some((p) => p.label !== matches[0].label)) return []
    return [{ ...pointer, label: matches[0].label }]
  })
  const availability = stale ? "stale_or_conflicting" : context.length ? "verified_public_context" : "private_detail_not_published"
  // No existing validated public structured source carries these fields.
  // Thus even verified issue/PR/job labels cannot invent specific details.
  const unavailable = () => ({ state: "unavailable", reason: "detail_not_published" })
  return {
    availability,
    gate_explanation: GATE_WORDS[row.gate] ?? (stale ? "This annotation is stale or conflicting; inspect it before acting" : "Inspection does not grant new authority"),
    context, decision: unavailable(), recommendation: unavailable(), safe_continuation: unavailable(),
    next_action: "Ask your linked agent to inspect the local annotation",
    handoff: {
      annotation_id: row.id, revision: row.revision, basis: clone(row.basis), route: row.route, gate: row.gate,
      availability, evidence: context.map(({ kind, ref, revision }) => ({ kind, ref, revision })),
      data_path: "rollups/improvements.json", authority_limit: "inspect_only_no_new_authority",
    },
  }
}

const unknownCoverage = () => ({
  state: "unknown", generation: null, scan: null, reviewed: null, unreviewed: null,
  refused: null, deferred: null, more_unreviewed: null,
})

const QUEUE_REASONS = ["triage_read_unavailable", "triage_invalid", "triage_coverage_unknown", "triage_conflict", "triage_publication_stale"]
const exactKeys = (v, keys) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k))
const ROW_KEYS = ["id", "revision", "state", "source", "lifecycle", "ownership", "route", "gate", "evidence",
  "basis", "related_ids", "duplicate_ids", "age", "producer_version", "rubric_version"]
const PRESENTATION_KEYS = ["availability", "gate_explanation", "context", "decision", "recommendation", "safe_continuation", "next_action", "handoff"]
const validCount = (v) => Number.isSafeInteger(v) && v >= 0
function validPublicRow(row) {
  if (row === null || typeof row !== "object" || !ROW_KEYS.every((k) => Object.hasOwn(row, k))) return false
  const raw = Object.fromEntries(ROW_KEYS.map((k) => [k, row[k]]))
  return validateTriageValues(JSON.stringify({
    schema: "desk.factory.triage/1", batch: "0".repeat(16), producer_version: "1.0.0", rubric_version: 1,
    coverage: { generation: "0".repeat(32), scan: "complete", reviewed: 0, unreviewed: 0, refused: 0, deferred: 0, more_unreviewed: false },
    runner: { state: "no_agent_cli", last_success_age: "unknown" }, rows: [raw],
  })).ok
}

// One queue validator for the maintained number gate and JSON twin publisher.
// The public transport validator remains the only row/basis/pointer walker;
// presentation is checked against the same pure transform that produces it.
export function validateImprovementQueue(doc) {
  const invalid = () => ({ ok: false, codes: ["triage_projection_invalid"] })
  if (!exactKeys(doc, ["schema", "rows", "coverage", "state", "reasons"]) ||
      doc.schema !== "factory-improvements/1" || !Array.isArray(doc.rows) ||
      !["not_reviewed", "reviewed", "unknown", "stale", "conflicting"].includes(doc.state) ||
      !Array.isArray(doc.reasons) || doc.reasons.some((r) => !QUEUE_REASONS.includes(r)) ||
      new Set(doc.reasons).size !== doc.reasons.length) return invalid()
  const coverageKeys = ["state", "generation", "scan", "reviewed", "unreviewed", "refused", "deferred", "more_unreviewed"]
  if (!exactKeys(doc.coverage, coverageKeys)) return invalid()
  if (doc.coverage.state === "unknown") {
    if (coverageKeys.slice(1).some((k) => doc.coverage[k] !== null)) return invalid()
  } else if (doc.coverage.state !== "known" || !/^[0-9a-f]{32}$/u.test(doc.coverage.generation) ||
      doc.coverage.scan !== "complete" || !["reviewed", "unreviewed", "refused", "deferred"].every((k) => validCount(doc.coverage[k])) ||
      typeof doc.coverage.more_unreviewed !== "boolean") return invalid()
  const ids = new Set()
  for (const row of doc.rows) {
    if (!exactKeys(row, [...ROW_KEYS, "conflict", ...PRESENTATION_KEYS]) || typeof row.conflict !== "boolean") return invalid()
    if (!validPublicRow(row) || ids.has(row.id) || !Array.isArray(row.context) || row.context.length > 16) return invalid()
    ids.add(row.id)
    if (row.context.some((p) => !exactKeys(p, ["kind", "ref", "revision", "label"]))) return invalid()
    const publicEvidence = row.context.map((p) => ({ ...p, visibility: "public" }))
    const expected = presentTriageContext({ row, publicEvidence })
    if (!PRESENTATION_KEYS.every((k) => same(row[k], expected[k]))) return invalid()
  }
  if (doc.state === "not_reviewed" && doc.rows.length !== 0) return invalid()
  if (doc.state === "reviewed" && (doc.coverage.state !== "known" || doc.rows.length === 0 ||
      doc.rows.some((r) => r.conflict || ["source_unknown", "stale"].includes(r.state)))) return invalid()
  if (doc.state === "conflicting" && !doc.rows.some((r) => r.conflict)) return invalid()
  return { ok: true, codes: [] }
}

export function deriveImprovementQueue(input = {}) {
  let { batches = [], publicEvidence = [], now } = input ?? { batches: null }
  const reasons = new Set(), accepted = [], identities = new Map()
  if (!Array.isArray(batches)) { reasons.add("triage_read_unavailable"); batches = [] }
  for (const input of batches) {
    if (!input || !validateTriageChangeValues({
      path: input.path, status: "added", bytes: input.bytes, trustedMaintainer: true,
    }).ok) { reasons.add("triage_invalid"); continue }
    const value = JSON.parse(input.bytes.toString())
    accepted.push({ value, at: input.committedAtMs })
    for (const r of value.rows) {
      const prior = identities.get(r.id)
      const current = { row: clone(r), at: input.committedAtMs, conflict: false }
      if (!prior || r.revision > prior.row.revision) identities.set(r.id, current)
      else if (r.revision === prior.row.revision) {
        // Equal conflict is deterministic and never silently last-writer wins.
        const conflict = prior.conflict || !same(prior.row, r)
        const chosen = JSON.stringify(stable(prior.row)) <= JSON.stringify(stable(r)) ? prior.row : clone(r)
        identities.set(r.id, { row: chosen, at: Math.min(prior.at ?? -Infinity, input.committedAtMs ?? -Infinity), conflict })
      }
    }
  }
  const freshBatches = accepted.filter((b) => fresh(b.at, now))
  let coverage = unknownCoverage()
  if (freshBatches.length) {
    const first = freshBatches[0].value.coverage
    if (first.scan === "complete" && freshBatches.every((b) => same(b.value.coverage, first)) &&
        ["reviewed", "unreviewed", "refused", "deferred", "more_unreviewed"].every((k) => first[k] !== null) &&
        reasons.size === 0) coverage = { state: "known", ...clone(first) }
  }
  if (accepted.length && coverage.state === "unknown") reasons.add("triage_coverage_unknown")
  const issueIds = new Map()
  for (const { row: r } of identities.values()) {
    if (r.state === "withdrawn") continue
    for (const p of r.evidence.filter((p) => p.kind === "issue")) {
      if (!issueIds.has(p.ref)) issueIds.set(p.ref, new Set())
      issueIds.get(p.ref).add(r.id)
    }
  }
  const rows = [...identities.values()].map(({ row: r, at, conflict }) => {
    conflict ||= r.evidence.some((p) => p.kind === "issue" && issueIds.get(p.ref)?.size > 1)
    if (conflict) reasons.add("triage_conflict")
    if (!fresh(at, now)) { reasons.add("triage_publication_stale"); if (r.state === "reviewed") r.state = "stale" }
    if (r.state === "reviewed" && r.age === "stale") r.state = "stale"
    if (r.state === "reviewed" && ["never", "unknown"].includes(r.age)) r.state = "source_unknown"
    if ((reasons.has("triage_invalid") || coverage.state === "unknown") && r.state === "reviewed") r.state = "source_unknown"
    const result = { ...r, conflict }
    return { ...result, ...presentTriageContext({ row: result, publicEvidence }) }
  }).sort((a, b) => a.id.localeCompare(b.id))
  const state = !rows.length && !accepted.length && !reasons.size ? "not_reviewed" :
    rows.some((r) => r.conflict) ? "conflicting" :
    coverage.state === "unknown" || rows.some((r) => r.state === "source_unknown") || reasons.has("triage_invalid") ||
      (rows.length === 0 && ["unreviewed", "refused", "deferred"].some((k) => coverage[k] > 0)) ? "unknown" :
    rows.some((r) => r.state === "stale") ? "stale" : rows.length ? "reviewed" : "not_reviewed"
  return { schema: "factory-improvements/1", rows, coverage, state, reasons: [...reasons].sort() }
}
