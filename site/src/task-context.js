// Presentation guard only. The build independently checks the canonical
// review hash and current public facts before creating this projection.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FactoryTaskContext = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const JOB = /^[0-9a-f]{32}$/, SHA = /^[0-9a-f]{64}$/, ID = /^[0-9a-f]{16}$/;
  const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const VERSION = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:-(?:alpha|beta|rc)\.[0-9]{1,4})?$/;
  const AVAILABILITY = ["published", "withheld", "unavailable"];
  const REASONS = [null, "not_published", "source_changed", "invalid_context", "canonical_source_unavailable", "review_pending"];
  const unsafe = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f<>`{}]|https?:\/\/|file:|www\.|[A-Z]:\\|~\/|(?:^|\s)\/[A-Za-z]|[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|gh[pousr]_|github_pat_|(?:^|[^A-Za-z0-9])sk-|Bearer\s|-----BEGIN|(?:password|secret|token)\s*[:=]|\b[0-9a-f]{24,}\b|(?:\+?\d[\d ().-]{8,}\d)/i;
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const keys = (value, expected) => object(value) && Object.keys(value).sort().join() === expected.split(",").sort().join();
  const text = (value, max, nullable = true) => value === null ? nullable : typeof value === "string" &&
    value.length > 0 && [...value].length <= max && value.trim() === value && !unsafe.test(value);
  const version = (value) => keys(value, "plugin_version,rubric") && VERSION.test(value.plugin_version) && value.rubric === "1";
  const offset = (value) => Number.isSafeInteger(value);
  function validateContextSummary(value) {
    return keys(value, "availability,heading,reason") && AVAILABILITY.includes(value.availability) && REASONS.includes(value.reason) &&
      text(value.heading, 120) && (value.availability === "published" || value.heading === null);
  }
  function contextSummary(doc) {
    return { availability: doc.availability, heading: doc.availability === "published" ? doc.record.heading : null, reason: doc.reason };
  }
  function validateTaskContext(doc, job) {
    const bad = () => ({ ok: false, codes: ["invalid_task_context"] });
    if (!keys(doc, "schema,job,availability,reason,record,placements") || doc.schema !== "factory-task-context/1" ||
        !JOB.test(doc.job) || (job !== undefined && doc.job !== job) || !AVAILABILITY.includes(doc.availability) ||
        !REASONS.includes(doc.reason) || !Array.isArray(doc.placements) || doc.placements.length > 64) return bad();
    const record = doc.record;
    if (record === null) return doc.availability !== "published" && doc.placements.length === 0 ? { ok: true, codes: [] } : bad();
    if (!keys(record, "schema,job,evaluator,state,heading,events,sources,coverage,privacy") || record.schema !== "desk.factory.context/1" ||
        record.job !== doc.job || record.state !== doc.availability || !version(record.evaluator) || !text(record.heading, 120) ||
        !Array.isArray(record.events) || record.events.length > 64 || !Array.isArray(record.sources) || record.sources.length > 512) return bad();
    const privacy = record.privacy;
    if (!keys(privacy, "verdict,payload_sha256,reviewer") || !SHA.test(privacy.payload_sha256) ||
        !(privacy.verdict === "approved" && version(privacy.reviewer) ||
          privacy.verdict === "not_required" && privacy.reviewer === null && record.state !== "published" &&
          record.heading === null && record.events.length === 0)) return bad();
    const coverage = record.coverage;
    if (!keys(coverage, "state,reasons,omitted_events") || !["measured", "partial", "unavailable"].includes(coverage.state) ||
        !Array.isArray(coverage.reasons) || coverage.reasons.some((reason) => !["not_recorded", "withheld", "omitted", "unplaced", "review_pending"].includes(reason)) ||
        !Number.isSafeInteger(coverage.omitted_events) || coverage.omitted_events < 0 ||
        (coverage.state === "measured" && (coverage.reasons.length || coverage.omitted_events)) ||
        (record.state !== "published" && (record.heading !== null || record.events.length || coverage.state !== "unavailable"))) return bad();
    const sources = new Map();
    for (const source of record.sources) {
      if (!keys(source, "session,sha256") || !SESSION.test(source.session) || !SHA.test(source.sha256) || sources.has(source.session)) return bad();
      sources.set(source.session, source.sha256);
    }
    const events = new Set();
    for (const event of record.events) {
      if (!keys(event, "id,kind,lean,explanation,reason,prerequisite,resumption,confidence,evidence") || !ID.test(event.id) || events.has(event.id) ||
          !["work", "waiting", "result"].includes(event.kind) || !["value", "support", "waiting", "unknown"].includes(event.lean) ||
          !text(event.explanation, 240, false) || !text(event.reason, 160) || !text(event.prerequisite, 160) || !text(event.resumption, 160) ||
          !["high", "medium", "low"].includes(event.confidence) || !Array.isArray(event.evidence) || event.evidence.length < 1 || event.evidence.length > 8 ||
          (event.kind === "waiting" ? event.lean !== "waiting" || event.reason === null || event.prerequisite === null :
            event.lean === "waiting" || event.reason !== null || event.prerequisite !== null || event.resumption !== null)) return bad();
      events.add(event.id);
      for (const ref of event.evidence) {
        if (!keys(ref, "session,source,anchor,range") || sources.get(ref.session) !== ref.source ||
            !["interval", "start", "end", "interval_start", "interval_end", "share_start", "share_end"].includes(ref.anchor) ||
            (["start", "end"].includes(ref.anchor) ? ref.range !== null : !Array.isArray(ref.range) || ref.range.length !== 2 ||
              !ref.range.every((at) => offset(at) && at >= 0) || ref.range[1] <= ref.range[0])) return bad();
      }
    }
    if ((record.state === "published" && (!events.size || !sources.size || coverage.state === "unavailable")) ||
        doc.placements.length !== events.size) return bad();
    const placed = new Set();
    for (const placement of doc.placements) {
      const event = record.events.find((entry) => entry.id === placement?.event);
      if (!keys(placement, "event,spans") || !event || placed.has(placement.event) || !Array.isArray(placement.spans) ||
          placement.spans.length !== event.evidence.length) return bad();
      placed.add(placement.event);
      for (const [index, span] of placement.spans.entries()) {
        if (!keys(span, "session,start_ms,end_ms") || span.session !== event.evidence[index].session ||
            !(span.start_ms === null && span.end_ms === null ||
              offset(span.start_ms) && offset(span.end_ms) && span.end_ms >= span.start_ms)) return bad();
      }
    }
    return { ok: true, codes: [] };
  }
  return { validateTaskContext, contextSummary, validateContextSummary };
});
