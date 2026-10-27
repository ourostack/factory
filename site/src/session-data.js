// Closed presentation contracts. Context review remains the build's responsibility.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./task-context.js"));
  else root.FactorySessionData = factory(root.FactoryTaskContext);
})(typeof self !== "undefined" ? self : this, function (context) {
  "use strict";
  const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const JOB = /^[0-9a-f]{32}$/, REVISION = /^[0-9a-f]{40}$/;
  const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
  const REASON = /^[a-z][a-z0-9_]{0,63}$/;
  const HOUR = 3600000;
  const COVERED = ["commands", "reading", "writing", "helpers", "notes", "other", "stops", "captured"];
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const keys = (v, names) => object(v) && Object.keys(v).sort().join() === names.split(",").sort().join();
  const integer = (v) => Number.isSafeInteger(v) && v >= 0;
  const matches = (v, pattern) => typeof v === "string" && pattern.test(v);
  const unique = (values) => new Set(values).size === values.length;
  const list = (v, check) => Array.isArray(v) && v.every(check);
  const ids = (v, pattern) => list(v, (x) => matches(x, pattern)) && unique(v);
  function state(v) {
    return object(v) && ["measured", "partial", "unavailable"].includes(v.state) &&
      list(v.reasons, (r) => matches(r, REASON)) && unique(v.reasons) &&
      (v.state === "measured" ? v.reasons.length === 0 : v.reasons.length > 0);
  }
  function stated(v, check = integer) {
    if (!state(v)) return false;
    if (v.state === "unavailable") return keys(v, "state,reasons");
    if (!check(v.value)) return false;
    return v.state === "partial"
      ? keys(v, "state,value,reasons,bound") && ["lower", "upper", "unknown"].includes(v.bound)
      : keys(v, "state,value,reasons");
  }
  function collection(v, check) {
    return keys(v, "state,reasons,items") && state(v) && list(v.items, check) &&
      (v.state !== "unavailable" || v.items.length === 0);
  }
  const sources = (v) => keys(v, "desk,facts,reports") &&
    Object.values(v).every((x) => x === "unavailable" || matches(x, REVISION));
  const identity = (v) => matches(v.id, SESSION) && ["claude-code", "copilot-cli", "codex-cli"].includes(v.host) &&
    typeof v.ended === "boolean" && ids(v.models, MODEL);
  const range = (v, duration) => keys(v, "start_ms,end_ms") && integer(v.start_ms) && integer(v.end_ms) &&
    v.end_ms >= v.start_ms && (duration === undefined || v.end_ms <= duration);
  function workers(value) {
    if (!collection(value, (v) => keys(v, "n,parent,model") && integer(v.n) &&
      (v.parent === null || integer(v.parent)) && (v.model === null || matches(v.model, MODEL)))) return false;
    // Recorded parent references are not a proven tree. Some public records
    // contain self references; retain them, without traversing or repairing.
    return unique(value.items.map((v) => v.n));
  }
  function bins(value, duration) {
    if (!keys(value, "resolution_ms,rows") || !stated(value.resolution_ms) || !Array.isArray(value.rows) || value.rows.length > 96) return false;
    if (duration.state === "unavailable") return value.resolution_ms.state === "unavailable" && value.rows.length === 0;
    const width = Math.max(1, Math.ceil(duration.value / HOUR / 96)) * HOUR;
    if (value.resolution_ms.state !== "measured" || value.resolution_ms.value !== width ||
        value.rows.length !== Math.ceil(duration.value / width)) return false;
    return value.rows.every((row, i) => keys(row, `start_ms,end_ms,${COVERED.join(",")}`) &&
      range({ start_ms: row.start_ms, end_ms: row.end_ms }, duration.value) &&
      row.start_ms === i * width && row.end_ms === Math.min(duration.value, (i + 1) * width) &&
      COVERED.every((key) => stated(row[key], (n) => integer(n) && n <= row.end_ms - row.start_ms)));
  }
  function validCatalog(value) {
    return keys(value, "schema,sources,sessions") && value.schema === "factory-session-catalog/1" && sources(value.sources) &&
      list(value.sessions, (row) => keys(row, "id,host,ended,models,jobs,duration_ms,activity_ms,detail") &&
        identity(row) && ids(row.jobs, JOB) && stated(row.duration_ms) && stated(row.activity_ms) &&
        (row.duration_ms.state === "unavailable" || row.activity_ms.state === "unavailable" || row.activity_ms.value <= row.duration_ms.value) &&
        row.detail === `sessions/${row.id}.json`) && unique(value.sessions.map((row) => row.id));
  }
  function validDetail(value) {
    if (!keys(value, "schema,sources,session,numbers,workers,bindings,bins,contexts,outcomes") ||
        value.schema !== "factory-session-detail/1" || !sources(value.sources) ||
        !keys(value.session, "id,host,ended,models") || !identity(value.session) ||
        !keys(value.numbers, "duration_ms,activity_ms,stop_ms,tool_calls,tool_failures,tool_retries,compactions") ||
        !Object.values(value.numbers).every((v) => stated(v)) || !workers(value.workers)) return false;
    const duration = value.numbers.duration_ms.state === "unavailable" ? undefined : value.numbers.duration_ms.value;
    if (duration !== undefined && ["activity_ms", "stop_ms"].some((key) =>
      value.numbers[key].state !== "unavailable" && value.numbers[key].value > duration)) return false;
    if (!collection(value.bindings, (v) => keys(v, "job,agents,segments") && matches(v.job, JOB) &&
      collection(v.agents, integer) && unique(v.agents.items) && collection(v.segments, (s) => range(s, duration)))) return false;
    const jobs = value.bindings.items.map((v) => v.job);
    if (!unique(jobs) || !bins(value.bins, value.numbers.duration_ms)) return false;
    if (!list(value.contexts, (doc) => context && context.validateTaskContext(doc).ok && jobs.includes(doc.job)) ||
        !unique(value.contexts.map((v) => v.job)) || value.contexts.length !== jobs.length) return false;
    return list(value.outcomes, (v) => keys(v, "job,scope,status,state,returns") && jobs.includes(v.job) && v.scope === "task" &&
      stated(v.status, (s) => matches(s, REASON) && s !== "unavailable") &&
      stated(v.state, (s) => ["accepted", "refused", "delivered_unsigned", "reopened", "not_delivered"].includes(s)) &&
      collection(v.returns, (r) => keys(r, "caught,counts") && ["in_task", "at_review", "after_delivery"].includes(r.caught) &&
        typeof r.counts === "boolean")) &&
      unique(value.outcomes.map((v) => v.job)) && value.outcomes.length === jobs.length;
  }
  function validateSessionCatalog(value) {
    return validCatalog(value) ? { ok: true, codes: [] } : { ok: false, codes: ["invalid_session_catalog"] };
  }
  function validateSessionDetail(value) {
    return validDetail(value) ? { ok: true, codes: [] } : { ok: false, codes: ["invalid_session_detail"] };
  }
  return { validateSessionCatalog, validateSessionDetail };
});
