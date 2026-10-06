// The human outcome, from the reports' `rollups/outcomes.json` (Desk's
// pipeline/outcomes.js): whether a human accepted each delivery (sign-off),
// whether a delivery passed first time (first-pass yield), what was sent back
// and where it was caught (rework), and, once Desk ships it, the human
// attention one accepted outcome costs.
//
// Every figure is a stated number. A reports branch with no outcomes file,
// or a file without a key, reads "not recorded yet"; a store where no
// session published an outcomes entry reads "sign-off not published"; never
// a zero. Counts are per job and keyed; nothing here names who signed or
// when. Rollups keep Desk's own n of N; jobs whose card predates sign-off are
// out of scope of the sign-off figures, counted beside them.

import { direct } from "./bounds.mjs"
import { declareRollup, measured, partial, rollup, trust, unavailable } from "./state.mjs"

const NOT_YET = ["not_recorded_yet"]
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x)
const isCount = (x) => Number.isSafeInteger(x) && x >= 0
const count = (x, reasons = ["not_recorded"]) => (isCount(x) ? measured(x) : unavailable(reasons))
// A figure whose source the reports do not carry yet has no population to
// count, so it carries no n of N (never "0 of 0"); any other empty figure
// says what it would count.
const none = (reasons, of, N = 0, outOfScope = 0) =>
  reasons.length === 1 && reasons[0] === NOT_YET[0] ? unavailable(NOT_YET) : { ...unavailable(reasons), kind: "rollup", n: 0, N, of, out_of_scope: outOfScope }

export const WAIT_CLASSES = Object.freeze(["lt_1h", "lt_1d", "lt_7d", "ge_7d"])
const SIGNED_WORDS = { lt_1h: "signed within an hour", lt_1d: "signed after 1 hour to a day", lt_7d: "signed after 1 to 7 days", ge_7d: "signed after 7 days or more" }
const WAITING_WORDS = { lt_1h: "waiting under an hour so far", lt_1d: "waiting at least 1 hour", lt_7d: "waiting at least 1 day", ge_7d: "waiting at least 7 days" }

// The wait from delivery to sign-off, in words. A delivery nobody has signed
// is censored: it has waited at least its class's lower edge, never zero.
export function waitWords(wait) {
  if (!isObject(wait) || !WAIT_CLASSES.includes(wait.class)) return null
  return wait.censored === true ? WAITING_WORDS[wait.class] : SIGNED_WORDS[wait.class]
}

const SIGNOFF_KEYS = ["accepted", "accepted_unverified", "delivered_unsigned", "refused", "refused_unverified", "reopened", "not_recorded", "not_delivered", "no_record", "jobs"]
const REFUSALS = ["not_what_was_asked", "defect", "changed_ask", "incomplete", "other"]
const CATCH_POINTS = ["in_task", "at_review", "after_delivery"]
const RETURN_REASONS = ["agent_error", "changed_ask", "new_information", "external"]
// Excluded from yield by design: no sign-off record (the card predates it or
// its desk does not publish it), no recorded history (an adopted card), not
// delivered. Anything else excluded is lost data and stays in N.
const OUT_OF_SCOPE = new Set(["not_recorded", "history_not_recorded", "not_delivered"])
const JOBS_SIGNED = "delivered jobs with a sign-off record"
const DELIVERED = "verdicts on delivered jobs are final"
const HISTORY = "jobs with a recorded history"

// The accepted count is Desk's own (`accepted`), the same population Desk
// divides the attention headline by, so the two can never disagree.
function signoffPart(raw, published) {
  const signoff = Object.fromEntries(SIGNOFF_KEYS.map((k) => [k, published ? count(raw[k]) : unavailable(published === null ? NOT_YET : ["signoff_not_published"])]))
  const refusal = published && isObject(raw.refusal_reasons) ? raw.refusal_reasons : {}
  const refusalReasons = REFUSALS.filter((r) => isCount(refusal[r]) && refusal[r] > 0).map((reason) => ({ reason, jobs: measured(refusal[reason]) }))
  const waitsOf = (side) =>
    WAIT_CLASSES.map((c) => ({ class: c, jobs: published && isCount(raw.waits?.[side]?.[c]) ? measured(raw.waits[side][c]) : unavailable(published ? ["not_recorded"] : published === null ? NOT_YET : ["signoff_not_published"]) }))
  return { signoff, refusalReasons, waits: { signed: waitsOf("signed"), unsigned: waitsOf("unsigned") } }
}

// Unsigned deliveries, for the health panel: jobs whose current record says
// delivered and not signed, over the delivered jobs with a sign-off record.
// Jobs with no record and jobs not delivered yet are out of scope.
function unsignedOf(raw, published) {
  if (!published) return none(published === null ? NOT_YET : ["signoff_not_published"], JOBS_SIGNED)
  if (![raw.jobs, raw.not_recorded, raw.not_delivered, raw.no_record, raw.delivered_unsigned].every(isCount)) return none(["not_recorded"], JOBS_SIGNED)
  const N = Math.max(0, raw.jobs - raw.not_recorded - raw.not_delivered)
  return declareRollup({ value: raw.delivered_unsigned, n: N, N, of: JOBS_SIGNED, measure: "sum", outOfScope: raw.no_record + raw.not_recorded + raw.not_delivered })
}

function oldestUnsigned(raw, published) {
  if (!published) return unavailable(published === null ? NOT_YET : ["signoff_not_published"])
  const unsigned = raw.waits?.unsigned
  if (!isObject(unsigned)) return unavailable(["not_recorded"])
  // Every unsigned delivery must sit in a wait class, or the longest wait
  // could be one that is missing.
  if (!WAIT_CLASSES.every((c) => isCount(unsigned[c]))) return unavailable(["not_recorded"])
  const total = WAIT_CLASSES.reduce((s, c) => s + unsigned[c], 0)
  if (isCount(raw.delivered_unsigned) && total !== raw.delivered_unsigned) return unavailable(["waits_incomplete"])
  const longest = [...WAIT_CLASSES].reverse().find((c) => unsigned[c] > 0)
  if (longest) return measured(WAITING_WORDS[longest])
  return raw.delivered_unsigned === 0 ? unavailable(["none_unsigned"]) : unavailable(["not_recorded"])
}

// First-pass yield as the site states it: Desk's value (passed over jobs with
// a verdict), with n the jobs whose verdict is final (not awaiting or
// unwitnessed) and N the jobs with a verdict plus jobs whose returns were
// lost. A verdict that awaits sign-off counts as a pass so far, so the
// figure is an upper bound.
function yieldOf(y) {
  if (!isObject(y)) return none(NOT_YET, DELIVERED)
  const excluded = Array.isArray(y.excluded) ? y.excluded.filter((e) => isObject(e) && typeof e.reason === "string" && isCount(e.jobs)) : []
  const outOfScope = excluded.filter((e) => OUT_OF_SCOPE.has(e.reason)).reduce((s, e) => s + e.jobs, 0)
  const lost = excluded.filter((e) => !OUT_OF_SCOPE.has(e.reason))
  const lostJobs = lost.reduce((s, e) => s + e.jobs, 0)
  if (!isCount(y.N) || !isCount(y.awaiting_signoff) || !isCount(y.signoff_unverified)) return none(["not_recorded"], DELIVERED)
  const N = y.N + lostJobs
  const reasons = [...new Set([...(Array.isArray(y.reasons) ? y.reasons : []), ...lost.map((e) => e.reason)])].sort()
  if (y.state === "unavailable" || y.N === 0 || typeof y.value !== "number") {
    return none(reasons.length ? reasons : ["no_delivered_jobs"], DELIVERED, N, outOfScope)
  }
  const n = Math.max(0, y.N - y.awaiting_signoff - y.signoff_unverified)
  const base = { kind: "rollup", n, N, of: DELIVERED, out_of_scope: outOfScope }
  if (n === N && reasons.length === 0) return { ...measured(y.value), ...base }
  return direct({ ...partial(y.value, reasons.length ? reasons : ["unmeasured_members"]), ...base }, "first_pass_yield")
}

function deskRollup(value, r, of, measure, extraReasons = []) {
  if (!isObject(r) || !isCount(r.n) || !isCount(r.N)) return none(NOT_YET, of)
  const reasons = Array.isArray(r.reasons) ? r.reasons.filter((x) => typeof x === "string") : []
  if (r.state === "unavailable" || !isCount(value)) return none(reasons.length ? reasons : ["not_recorded"], of, r.N)
  return declareRollup({ value, n: r.n, N: r.N, of, measure, reasons: [...reasons, ...extraReasons] })
}

function reworkOf(r) {
  const returns = CATCH_POINTS.map((caught) => {
    const byReason = isObject(r?.returns?.[caught]) ? r.returns[caught] : null
    const total = byReason && RETURN_REASONS.every((k) => isCount(byReason[k])) ? RETURN_REASONS.reduce((s, k) => s + byReason[k], 0) : null
    return {
      caught,
      total: deskRollup(total, r, HISTORY, "sum"),
      by_reason: Object.fromEntries(RETURN_REASONS.map((k) => [k, byReason && isCount(byReason[k]) ? measured(byReason[k]) : unavailable(isObject(r) ? ["not_recorded"] : NOT_YET)])),
    }
  })
  const check = isObject(r?.reason_check) ? r.reason_check : null
  const checkReasons = check && Array.isArray(check.reasons) && check.reasons.length ? check.reasons : isObject(r) ? ["not_recorded"] : NOT_YET
  let reasonCheck
  if (!check || check.state === "unavailable" || !isCount(check.compared) || !isCount(check.disagree) || !isCount(check.compared_verified)) {
    reasonCheck = { compared: unavailable(checkReasons), disagree: unavailable(checkReasons), compared_verified: unavailable(checkReasons) }
  } else {
    // Unverified refusals are compared too; what the human said there is not
    // witnessed, so the disagreement is at least this.
    const disagree = check.compared_verified < check.compared ? direct(partial(check.disagree, ["refusal_unverified"]), "reason_disagree") : measured(check.disagree)
    reasonCheck = { compared: measured(check.compared), disagree, compared_verified: measured(check.compared_verified) }
  }
  const d = isObject(r?.defects) ? r.defects : null
  const ms = (key) => (d ? deskRollup(d[key], d, "finished jobs, fully labeled", "sum") : none(NOT_YET, "finished jobs, fully labeled"))
  return {
    returns,
    changed_ask: deskRollup(isCount(r?.changed_ask) ? r.changed_ask : null, r, HISTORY, "sum"),
    reason_check: reasonCheck,
    defects: {
      active_ms: ms("active_ms"),
      in_task_ms: ms("in_task_ms"),
      at_review_ms: ms("at_review_ms"),
      after_delivery_ms: ms("after_delivery_ms"),
      not_placed_ms: ms("not_placed_ms"),
    },
  }
}

// Human attention per accepted outcome (Package E). Read only when the
// reports carry it; a value beside zero accepted outcomes is refused.
function attentionOf(a, accepted, coverage) {
  const of = "accepted outcomes"
  const read = (h, measure) => {
    if (!isObject(h) || !Array.isArray(h.reasons)) return none(NOT_YET, of)
    const N = isCount(h.N) ? h.N : 0
    if (h.state === "unavailable" || typeof h.value !== "number") return none(h.reasons.length ? h.reasons : ["not_recorded"], of, N)
    if (accepted.state === "measured" && accepted.value === 0) return none(["no_accepted_outcomes"], of, N)
    return declareRollup({ value: h.value, n: isCount(h.n) ? h.n : 0, N, of, measure, reasons: h.reasons })
  }
  const headline = read(a?.headline, "attention_per_accepted")
  return { headline, turns_per_accepted: read(a?.turns_per_accepted, "turns_per_accepted"), trust: trust(headline, coverage ? { coverage } : {}) }
}

// `coverage`: the capture share the attention trust state rests on, when
// the build has one.
export function outcomesSummary(file, { coverage = null } = {}) {
  const f = isObject(file) ? file : null
  const raw = isObject(f?.signoff) ? f.signoff : {}
  // true: published; false: the reports say no session published one; null:
  // the reports do not carry sign-off at all yet.
  const published = f === null || !isObject(f.signoff) ? null : f.signoff.recorded === true
  const { signoff, refusalReasons, waits } = signoffPart(raw, published)
  return {
    signoff,
    refusal_reasons: refusalReasons,
    waits,
    unsigned: unsignedOf(raw, published),
    oldest_unsigned_wait: oldestUnsigned(raw, published),
    first_pass_yield: yieldOf(f?.first_pass_yield),
    // The counts the yield is computed from (passed over counted), so the
    // percentage can be rebuilt; `final` is the site's n, the verdicts that
    // no longer await a witnessed answer.
    first_pass_counts: {
      passed: count(f?.first_pass_yield?.passed, f ? ["not_recorded"] : NOT_YET),
      counted: count(f?.first_pass_yield?.N, f ? ["not_recorded"] : NOT_YET),
      final: isObject(f?.first_pass_yield) && [f.first_pass_yield.N, f.first_pass_yield.awaiting_signoff, f.first_pass_yield.signoff_unverified].every(isCount)
        ? measured(Math.max(0, f.first_pass_yield.N - f.first_pass_yield.awaiting_signoff - f.first_pass_yield.signoff_unverified))
        : unavailable(f ? ["not_recorded"] : NOT_YET),
      returned: count(f?.first_pass_yield?.returned, f ? ["not_recorded"] : NOT_YET),
      changed_ask_only: count(f?.first_pass_yield?.changed_ask_only, f ? ["not_recorded"] : NOT_YET),
    },
    rework: reworkOf(f?.rework ?? null),
    attention: attentionOf(f?.attention ?? null, signoff.accepted, coverage),
  }
}

// The trend: the same outcome figures per Desk release, from the groupings
// Desk already builds (`groupings.plugin_version` in outcomes.json and
// measures.json), oldest release first. A job that ran under several
// releases is in its own row, "mixed", last. Each figure keeps its state.
// The interim answer until an outcome is accepted: the operator's attention
// per delivered task, from the same per-task attention estimate Desk's
// headline sums. A mean over the delivered tasks whose estimate is whole;
// the rest are counted in its n of N.
const DELIVERED_OUTCOMES = new Set(["delivered", "awaiting_signoff", "accepted", "sent_back"])
export function attentionPerDelivered(jobs) {
  const members = (Array.isArray(jobs) ? jobs : []).filter((j) => DELIVERED_OUTCOMES.has(j.outcome)).map((j) => j.attention_ms)
  return rollup(members, { of: "delivered tasks", reduce: (v) => Math.round(v.reduce((a, b) => a + b, 0) / v.length), measure: "attention_per_delivered" })
}

export function releaseTrend(outcomesFile, measuresFile, compareVersions) {
  const o = isObject(outcomesFile?.groupings?.plugin_version) ? outcomesFile.groupings.plugin_version : {}
  const m = isObject(measuresFile?.groupings?.plugin_version) ? measuresFile.groupings.plugin_version : {}
  const isRelease = (v) => /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:-(?:alpha|beta|rc)\.[0-9]{1,4})?$/.test(v)
  const keys = [...new Set([...Object.keys(o), ...Object.keys(m)])]
  const versions = [...keys.filter(isRelease).sort(compareVersions), ...keys.filter((k) => k === "mixed")]
  return versions.map((version) => {
    const s = outcomesSummary(isObject(o[version]) ? o[version] : null)
    const mv = isObject(m[version]) ? m[version] : {}
    const fe = isObject(mv.measures?.flow_efficiency) ? mv.measures.flow_efficiency : null
    const excluded = Array.isArray(fe?.jobs_excluded) ? fe.jobs_excluded.map((e) => e?.reason).filter((r) => typeof r === "string") : []
    return {
      version,
      jobs: count(mv.jobs),
      accepted: s.signoff.accepted,
      sent_back: s.signoff.refused,
      first_pass_yield: s.first_pass_yield,
      attention: s.attention.headline,
      flow_efficiency: fe ? declareRollup({ value: fe.median, n: fe.n, N: fe.N, of: "finished jobs", measure: "median", reasons: [...new Set(excluded)] }) : unavailable(NOT_YET),
    }
  })
}
