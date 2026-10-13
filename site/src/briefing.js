// Store-built public briefing; the browser renders this exact projection.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = node ? factory(require("./format.js"), require("./preferences.js")) : factory(root.FactoryFormat, root.FactoryPreferences);
  if (node) module.exports = api;
  else root.FactoryBriefing = api;
})(typeof self !== "undefined" ? self : this, function (F, P) {
  "use strict";
  const arr = (x) => Array.isArray(x) ? x : [];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const text = (x) => typeof x === "string" && x.length > 0 && x.length <= 2400 && !/[\p{Cc}\p{Cf}]/u.test(x);
  const exact = (x, required, optional = []) => x && typeof x === "object" && !Array.isArray(x) && required.every((k) => Object.hasOwn(x, k)) && Object.keys(x).every((k) => [...required, ...optional].includes(k));
  const ID = /^[A-Za-z0-9:_-]{1,128}$/;
  const REASONS = ["monitoring_not_available", "triage_not_reviewed", "triage_not_current"];
  // Canonical public lifecycle and annotation state are different vocabularies.
  const TERMINAL_LIFECYCLES = new Set(["closed_confirmed", "closed_unverified"]);
  const emptyCoverage = { state: "unknown", generation: null, scan: null, reviewed: null, unreviewed: null, refused: null, deferred: null, more_unreviewed: null };
  function generationOf(data) {
    const source = /^[0-9a-f]{40}$/.test(data?.reports_commit) ? data.reports_commit : typeof data?.built_at === "string" && Number.isFinite(Date.parse(data.built_at)) ? data.built_at : "unknown";
    return `factory-site/3:${source}`;
  }
  function snapshot(doc, at) {
    return { schema: "factory-overview-summary/1", generation: doc.generation, at, attention: doc.attention.map((r) => r.id).slice(0, 64), agents: doc.agents.map((r) => r.id).slice(0, 64), investigation: doc.investigation.map((r) => r.id).slice(0, 64) };
  }
  function visitChanges(doc, previous) {
    const base = { state: "first_visit", added: 0, removed: 0, complete_history: false, previous_visit: null };
    if (!previous) return base;
    if (!P.validSummary(previous)) return { ...base, state: "not_comparable" };
    base.previous_visit = previous.at;
    if (!previous.generation.startsWith("factory-site/3:") || doc.generation === "factory-site/3:unknown" || previous.generation === "factory-site/3:unknown") return { ...base, state: "not_comparable" };
    if (previous.generation === doc.generation) return { ...base, state: "same_generation" };
    const before = new Set([...previous.attention, ...previous.agents, ...previous.investigation]);
    const after = new Set([...doc.attention, ...doc.agents, ...doc.investigation].map((r) => r.id));
    return { ...base, state: "comparable", added: [...after].filter((id) => !before.has(id)).length, removed: [...before].filter((id) => !after.has(id)).length };
  }
  function validateBriefing(doc, validateQueue = null) {
    const bad = () => ({ ok: false, codes: ["overview_projection_invalid"] });
    if (!exact(doc, ["schema", "generation", "attention", "agents", "investigation", "changes", "state", "reasons"]) ||
        doc.schema !== "factory-overview/1" || !/^factory-site\/3:[A-Za-z0-9:._-]{1,80}$/.test(doc.generation) ||
        !["attention", "unknown", "observed"].includes(doc.state) || !Array.isArray(doc.reasons) || doc.reasons.some((r) => !REASONS.includes(r))) return bad();
    const seen = new Set();
    for (const key of ["attention", "agents", "investigation"]) {
      if (!Array.isArray(doc[key]) || doc[key].length > 64) return bad();
      for (const row of doc[key]) {
        if (!exact(row, ["id", "family", "title", "impact", "ownership", "next_action", "href"], ["number", "triage"]) ||
            !ID.test(row.id) || seen.has(row.id) || !["production", "collection", "improvement_system"].includes(row.family) ||
            !["claimed", "not_published"].includes(row.ownership) || ![row.title, row.impact, row.next_action].every(text) ||
            !briefingHref(row.href) || (key === "agents" && row.ownership !== "claimed")) return bad();
        seen.add(row.id);
        if (Object.hasOwn(row, "number")) {
          const n = row.number;
          if (!exact(n, ["state", "reasons"], ["value", "bound", "bound_reason", "basis", "kind", "n", "N", "of", "out_of_scope", "excluded"]) ||
              !["measured", "partial", "unavailable"].includes(n.state) || !Array.isArray(n.reasons) || n.reasons.some((r) => !F.hasReasonText(r)) ||
              (n.state === "unavailable" ? "value" in n : typeof n.value !== "number" || !Number.isFinite(n.value) || n.value < 0) ||
              (n.state === "partial" && !["lower", "upper", "unknown"].includes(n.bound))) return bad();
        }
        if (row.ownership === "claimed" && !row.triage) return bad();
        if (key === "agents" && (row.triage?.state !== "reviewed" || row.triage?.conflict || row.triage?.availability === "stale_or_conflicting" || TERMINAL_LIFECYCLES.has(row.triage?.lifecycle))) return bad();
        if (Object.hasOwn(row, "triage")) {
          if (!row.triage || typeof row.triage !== "object") return bad();
          if (validateQueue && !validateQueue({ schema: "factory-improvements/1", state: "unknown", rows: [row.triage], coverage: emptyCoverage, runner: { state: "unknown", last_success_age: "unknown" }, reasons: [] }).ok) return bad();
          if (row.id !== `triage:${row.triage.id}` || row.ownership !== row.triage.ownership || row.triage.handoff?.authority_limit !== "inspect_only_no_new_authority") return bad();
        }
      }
    }
    const c = doc.changes;
    if (!exact(c, ["state", "added", "removed", "complete_history", "previous_visit"]) ||
        !["first_visit", "not_comparable", "same_generation", "comparable"].includes(c.state) || c.complete_history !== false ||
        ![c.added, c.removed].every((n) => Number.isSafeInteger(n) && n >= 0) ||
        (c.previous_visit !== null && (typeof c.previous_visit !== "string" || !Number.isFinite(Date.parse(c.previous_visit))))) return bad();
    return { ok: true, codes: [] };
  }
  // A local destination, optionally with validated selectors in their
  // canonical order (a filtered list such as "#/tasks?status=awaiting_signoff").
  function briefingHref(href) {
    if (typeof href !== "string") return false;
    const at = href.indexOf("?");
    if (at < 0) return F.localDestination(href);
    const path = href.slice(0, at);
    return F.localDestination(path) && F.routeWithContext(path, F.routeContext(href.slice(at + 1))) === href;
  }
  function buildBriefing({ data, improvements, previous = null, now, validateQueue = null }) {
    if (!data || data.schema !== "factory-site/3") throw new TypeError("overview_data_invalid");
    if (!improvements || improvements.schema !== "factory-improvements/1" || !Array.isArray(improvements.rows) ||
        (validateQueue && !validateQueue(improvements).ok)) throw new TypeError("overview_queue_invalid");
    const doc = { schema: "factory-overview/1", generation: generationOf(data), attention: [], agents: [], investigation: [], changes: null, state: "observed", reasons: [] };
    const row = (id, family, title, impact, next_action, href, extra = {}) => ({ id, family, title, impact, ownership: "not_published", next_action, href, ...extra });
    // The public alarm issue is an inspection destination, not a claim.
    const status = F.statusLine({ verdict: { status: "unknown", reason: "build monitoring is not part of this briefing" }, andon: data.andon_issues, andonVerification: data.andon_verification, capture: data.capture_coverage, loop: data.loop_health, fixNext: data.fix_next, alarmIssues: data.alarm_issues, alarmIssuesVerification: data.alarm_issues_verification });
    const alarmCounts = new Map();
    for (const alarm of status.alarms.slice(0, 32)) {
      const occurrence = (alarmCounts.get(alarm.key) || 0) + 1;
      alarmCounts.set(alarm.key, occurrence);
      const family = alarm.key.startsWith("capture") || alarm.key === "labels_mismatch" ? "collection" : alarm.key.startsWith("loop") ? "improvement_system" : "production";
      const next = family === "collection" ? "Inspect capture and classification evidence before trusting the affected figures." : family === "improvement_system" ? "Inspect the improvement-system alarm and its public issue before acting." : "Inspect the flagged release and its quality evidence.";
      doc.attention.push(row(`alarm:${alarm.key}${occurrence > 1 ? `:${occurrence}` : ""}`, family, alarm.text, family === "production" ? "Recorded work or quality needs inspection." : family === "collection" ? "Some work may be missing or misclassified." : "Improvement recommendations may not be current.", next, "#/improvements"));
    }
    if (status.missing.length) doc.reasons.push("monitoring_not_available");
    if (improvements.state === "not_reviewed") doc.reasons.push("triage_not_reviewed");
    else if (improvements.state !== "reviewed") doc.reasons.push("triage_not_current");
    for (const r of improvements.rows.slice(0, 32)) {
      const fresh = r.state === "reviewed" && !r.conflict && r.availability !== "stale_or_conflicting";
      const triage = row(`triage:${r.id}`, "improvement_system",
        fresh && r.route === "human_decision" ? "A recorded decision gate needs inspection" : fresh ? "A reviewed improvement has a proposed next step" : "An improvement review needs refreshing",
        r.availability === "private_detail_not_published" ? "Decision details are private or not published." : r.availability === "stale_or_conflicting" ? "This review cannot support execution." : "Verified public evidence is available; specific decision details may not be published.",
        r.next_action, "#/improvements", { ownership: r.ownership, triage: copy(r) });
      if (fresh && r.ownership === "claimed" && !TERMINAL_LIFECYCLES.has(r.lifecycle)) doc.agents.push(triage);
      else if (fresh && r.route === "human_decision") doc.attention.push(triage);
      else if (doc.investigation.length === 0) doc.investigation.push(triage);
    }
    if (!doc.investigation.length) {
      const item = arr(data.fix_next).find((r) => r && r.severity !== "alarm" && r.count?.state !== "unavailable" && Number.isFinite(r.count?.value) && r.count.value > 0 && text(r.title) && text(r.action));
      if (item) doc.investigation.push(row(`finding:${item.id}`, "production", item.title, "A recorded pattern is a reason to investigate, not a proven cause or savings estimate.", item.id === "awaiting_signoff" ? "Inspect the delivered tasks, then ask the operator to accept or return them." : item.action, item.id === "awaiting_signoff" ? "#/tasks?status=awaiting_signoff" : "#/causes", { number: copy(item.count) }));
      else doc.investigation.push(row("check:coverage", "collection", "Check the evidence before choosing an improvement", "The published evidence does not support a specific opportunity yet.", "Inspect recorded tasks, coverage and findings.", "#/tasks"));
    }
    doc.state = doc.attention.length ? "attention" : doc.reasons.length ? "unknown" : "observed";
    doc.changes = visitChanges(doc, previous);
    if (!validateBriefing(doc, validateQueue).ok) throw new TypeError("overview_projection_invalid");
    return doc;
  }
  // The Overview's answer to "What needs a closer look?", in one sentence:
  // it leads the page, and the monitoring caveat follows it.
  function conclusionWords(doc) {
    const att = Array.isArray(doc && doc.attention) ? doc.attention : [];
    const inv = Array.isArray(doc && doc.investigation) ? doc.investigation : [];
    if (att.length === 1) return `One item needs your attention first: ${att[0].title}.`;
    if (att.length > 1) return `${att.length} items need your attention first, led by: ${att[0].title}.`;
    if (inv.length) return `Nothing is flagged for your attention first; ${inv.length === 1 ? "1 recorded pattern is" : `${inv.length} recorded patterns are`} worth investigating${inv.length === 1 ? ":" : ", led by:"} ${inv[0].title}.`;
    return "Nothing in this briefing is flagged for attention or investigation.";
  }
  return { buildBriefing, validateBriefing, visitChanges, snapshot, generationOf, conclusionWords };
});
