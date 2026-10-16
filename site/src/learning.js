// One public learning projection for both the browser and machine readers.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./format.js"));
  else root.FactoryLearning = factory(root.FactoryFormat);
})(typeof self !== "undefined" ? self : this, function (F) {
  "use strict";
  const SCHEMA = "factory-learning/1";
  const MAX_MS = 3660 * 86400000;
  const MAX_FINDINGS = 24;
  const MAX_EXAMPLES = 6;
  const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const exact = (x, required, optional = []) => object(x) && required.every((k) => Object.hasOwn(x, k)) &&
    Object.keys(x).every((k) => required.includes(k) || optional.includes(k));
  const arr = (x) => Array.isArray(x) ? x : [];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const count = (x) => Number.isSafeInteger(x) && x >= 0 && x <= 1000000000;
  const number = (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= MAX_MS;
  const id = (x) => typeof x === "string" && /^[a-f0-9]{32}$/.test(x);
  const revision = (x) => x === "unavailable" || typeof x === "string" && /^[a-f0-9]{40}$/.test(x);
  const release = (x) => typeof x === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]{1,32})?$/.test(x);
  const unique = (xs) => Array.isArray(xs) && new Set(xs).size === xs.length;
  const codeList = (xs, allowed) => unique(xs) && xs.every((x) => allowed.includes(x));
  const reasons = (xs) => unique(xs) && xs.every((x) => typeof x === "string" && F.hasReasonText(x));
  const unavailable = (reason = "not_recorded") => ({ state: "unavailable", reasons: [reason] });
  const measured = (value) => ({ state: "measured", value, reasons: [] });
  const fail = () => { throw new TypeError("learning_projection_invalid"); };
  const WAITS = ["next_prompt", "other_task", "api_retry", "tool_failure", "long_tool_call", "queue_before_start", "no_session", "unknown"];
  const WHYS = ["stopped_short", "question", "error_limit", "interrupted", "decision", "approval", "acceptance", "not_known"];
  const WASTES = ["defects", "overproduction", "waiting", "non_utilized_talent", "transportation", "inventory", "motion", "extra_processing", "unknown"];
  const TOOL_KINDS = ["read", "edit", "shell", "search", "web", "agent", "desk", "skill", "mcp", "plan", "other"];
  const RETURN_REASONS = ["agent_error", "changed_ask", "new_information", "external"];
  const CHECK_CODES = [
    "canonical_source_unavailable", "issues_unavailable", "first_page_only", "no_block", "multiple_blocks", "too_large", "syntax",
    "unknown_key", "duplicate_key", "missing_key", "unsupported_card_version", "unknown_measure", "invalid_job_class",
    "job_class_not_published", "invalid_evidence_jobs", "invalid_countermeasure", "invalid_plugin", "invalid_version", "invalid_hypothesis",
  ];
  const EXCLUSIONS = [
    "open_job", "plugin_not_reported", "mixed_versions", "partial", "censored", "not_labeled", "not_in_published_facts",
    "job_offsets_unavailable", "status_unavailable", "cancelled", "no_wait_intervals", "zero_lead_time", "mixed", "no_active_intervals",
    "card_dates_shorter_than_work", "wait_fields_unavailable", "worker_split", "worker_shared", "no_sessions", "finish_time_not_known",
    "host_does_not_record", "log_missing", "log_truncated", "session_open", "not_collected_in_slice_1", "source_unreadable", "capped",
    "desk_public", "field_absent", "host_records_partly", "withheld_public", "interval_outside_session_clock",
  ];
  const MEASURES = [
    "lead_time", "queue_before_start", "active_time", "flow_efficiency", "human_wait", "permission_wait", "api_retry_wait",
    "tool_failures", "tool_retries", "api_retries", "compactions", "retouches", "muda_time", "search_waste",
    ...WASTES.filter((w) => w !== "unknown").map((w) => `muda_time.${w}`),
  ];
  const LIMITS = [
    "task_exposure_not_factory_time", "not_proven_avoidable", "capture_is_partial", "capture_unknown",
    "classification_is_judgment", "classification_not_recorded", "related_measure_not_original_evidence",
    "representative_examples_not_complete", "task_mix_not_controlled", "capture_changes_not_controlled",
    "association_not_causation", "shared_workers_not_independent", "finish_dates_may_be_bounded",
    "baseline_missing", "later_sample_missing", "too_few_independent_groups", "stage_timing_unavailable",
    "coordination_timing_unavailable", "topology_not_task_allocation", "accepted_population_not_timed_subset",
    "thin_attention_sample", "source_generations_differ", "source_generation_unknown", "no_effect_estimate",
  ];
  const EVOLUTION_LIMITS = ["task_mix_not_controlled", "capture_changes_not_controlled", "association_not_causation",
    "shared_workers_not_independent", "finish_dates_may_be_bounded", "task_exposure_not_factory_time"];
  const FINDING_LIMITS = ["task_exposure_not_factory_time", "not_proven_avoidable", "representative_examples_not_complete"];
  const TITLES = {
    other_task: "Recorded work on other tasks", no_session: "No task session recorded",
    next_prompt: "Stops awaiting the next prompt", api_retry: "Recorded API retry waits",
    tool_failure: "Recorded tool failure waits", long_tool_call: "Recorded long tool calls",
    queue_before_start: "Recorded window before first work", unknown: "Waiting without a recorded explanation",
  };
  const QUESTIONS = {
    review_repair: ["Does work repeatedly return for review and repair?", "Ordered review and repair episodes with task-attributed durations.",
      "Desk outcome history and evaluator catch-point classification"],
    human_stops: ["Why did agents stop for a human?", "A complete classified sequence of human stops; the duration of review or decision work is not recorded.",
      "Host stop facts, Desk stop classification and task timelines"],
    coordination: ["What does root and subagent coordination cost?", "Task-attributed coordination episodes and their elapsed and worker-time costs.",
      "Host agent topology and Desk task-attributed activity capture"],
  };
  const ISSUE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\/issues\/([1-9]\d{0,9})$/;
  const PULL = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/[1-9]\d{0,9}$/;
  const refOf = (url) => { const m = typeof url === "string" && ISSUE.exec(url); return m ? `${m[1]}#${m[2]}` : null; };
  function causeKey(key) {
    if (typeof key !== "string") return false;
    const [kind, detail, why, ...rest] = key.split(":");
    if (rest.length) return false;
    if (kind === "waiting") return WAITS.includes(detail) && (why === undefined || detail === "next_prompt" && WHYS.includes(why));
    return WASTES.includes(kind) && kind !== "waiting" && (detail === "all" || kind === "defects" && TOOL_KINDS.includes(detail)) && why === undefined;
  }
  function hrefOK(href) {
    if (typeof href !== "string") return false;
    const [path, query, ...extra] = href.split("?");
    if (extra.length || !F.localDestination(path)) return false;
    return query === undefined || F.routeWithContext(path, F.routeContext(query)) === href;
  }
  function figureOK(f, signed = false) {
    if (!exact(f, ["state", "reasons"], ["value", "bound", "bound_reason", "basis", "kind", "n", "N", "of", "out_of_scope", "excluded"]) ||
        !["measured", "partial", "unavailable"].includes(f.state) || !reasons(f.reasons)) return false;
    if (f.state === "unavailable" ? "value" in f : !number(f.value) || !signed && f.value < 0) return false;
    if (f.state === "measured" ? f.reasons.length !== 0 : f.reasons.length === 0) return false;
    if (f.state === "partial" ? !["lower", "upper", "unknown"].includes(f.bound) : "bound" in f) return false;
    if ("bound_reason" in f && (f.state !== "partial" || !F.hasReasonText(f.bound_reason))) return false;
    if ("basis" in f && !["declared", "inferred"].includes(f.basis)) return false;
    if ("kind" in f || "n" in f || "N" in f || "of" in f || "out_of_scope" in f) {
      if (f.kind !== "rollup" || !count(f.n) || !count(f.N) || f.n > f.N || !count(f.out_of_scope) ||
          !["accepted outcomes", "verdicts on delivered jobs are final", "finished jobs", "finished tasks with a flow efficiency figure",
            "jobs with a recorded history", "finished jobs, fully labeled", "jobs", "machines' records, current and verified"].includes(f.of)) return false;
      if (f.state === "measured" && (f.n !== f.N || f.N === 0)) return false;
    }
    return !("excluded" in f) || object(f.excluded) && Object.entries(f.excluded).every(([k, v]) => F.hasReasonText(k) && count(v));
  }
  function figure(raw, fallback = "not_recorded") {
    if (raw === undefined || raw === null) return unavailable(fallback);
    const out = {};
    for (const key of ["state", "value", "reasons", "bound", "bound_reason", "basis", "kind", "n", "N", "of", "out_of_scope", "excluded"]) {
      if (Object.hasOwn(raw, key)) out[key] = clone(raw[key]);
    }
    if (out.state === "partial" && out.bound === null) out.bound = "unknown";
    if (!figureOK(out)) fail();
    return out;
  }
  function handoff(selector, href) {
    return { file: "rollups/learning.json", selector, href, authority_limit: "inspect_only_no_new_authority" };
  }
  const handoffOK = (h, selector, href) => exact(h, ["file", "selector", "href", "authority_limit"]) &&
    h.file === "rollups/learning.json" && h.selector === selector && h.href === href && hrefOK(href) && h.authority_limit === "inspect_only_no_new_authority";
  const findingSelector = (key) => `$.findings[?(@.id=="${key}")]`;
  const improvementSelector = (ref) => `$.improvements.rows[?(@.ref=="${ref}")]`;
  const taskHref = (task, cause) => F.routeWithContext(`#/task/${task}`, cause ? { cause, task, return: `#/causes/${cause}` } : {});
  const populationOK = (p, of) => exact(p, ["n", "N", "of"]) && count(p.n) && count(p.N) && p.n <= p.N && p.of === of;
  function classification(key) {
    return key.startsWith("waiting:next_prompt:") ? ["reported_stop_classification", "observation"] :
      key.startsWith("waiting:") ? ["host_observation", "observation"] :
        key.startsWith("unknown:") ? ["evaluator_judgment", "unclassified"] : ["evaluator_judgment", "classified_waste"];
  }
  function title(key) {
    const [kind, detail, why] = key.split(":");
    return why ? `Reported stop classification: ${why.replace(/_/g, " ")}` :
      kind === "waiting" ? TITLES[detail] : `Evaluator classification: ${kind.replace(/_/g, " ")} (${detail})`;
  }
  function buildFindings(causes) {
    if (!causes) return [];
    if (!object(causes) || causes.schema !== "desk.factory.rollups/1" || causes.basis !== "job_hours" ||
        !Array.isArray(causes.causes) || !count(causes.n) || !count(causes.N) || causes.n > causes.N ||
        !["measured", "partial", "unavailable"].includes(causes.state) || !reasons(causes.reasons)) fail();
    const rows = causes.causes.flatMap((r, i) => [{ r, path: `$.causes[${i}]` },
      ...arr(r.children).map((r, j) => ({ r, path: `$.causes[${i}].children[${j}]` }))]);
    return rows.slice(0, MAX_FINDINGS).map(({ r, path }) => {
      if (!causeKey(r.cause) || !Array.isArray(r.jobs) || !unique(r.jobs) || !r.jobs.every(id) || !Array.isArray(r.spans)) fail();
      const inherited = r.bound === undefined ? causes.bound : r.bound;
      const rs = r.reasons === undefined || r.reasons.length === 0 && causes.state !== "measured" ? causes.reasons : r.reasons;
      const state = r.state || (rs.length ? "partial" : causes.state);
      const f = figure({ state, ...(state !== "unavailable" ? { value: r.total_ms } : {}), reasons: rs,
        ...(state === "partial" ? { bound: inherited === "lower" || inherited === "upper" ? inherited : "unknown" } : {}) });
      const [kind, cls] = classification(r.cause);
      const href = `#/causes/${r.cause}`;
      return {
        id: r.cause, kind, classification: cls, title: title(r.cause), figure: f,
        population: { n: causes.n, N: causes.N, of: "jobs_in_cause_rollup" },
        affected_tasks: [...r.jobs], examples: r.spans.slice(0, MAX_EXAMPLES).map((s, i) => {
          if (!id(s.job) || !r.jobs.includes(s.job) || !number(s.start_ms) || !number(s.end_ms) || s.end_ms < s.start_ms) fail();
          return { task: s.job, start_ms: s.start_ms, end_ms: s.end_ms, href: taskHref(s.job, r.cause),
            map_path: `map/${s.job}.json`, source_path: `${path}.spans[${i}]` };
        }),
        source_file: "rollups/causes.json", source_path: path, href,
        related_improvements: [], limits: [...FINDING_LIMITS,
          ...(kind === "host_observation" ? [] : ["classification_is_judgment"])],
        handoff: handoff(findingSelector(r.cause), href),
      };
    });
  }
  function sampleSide(side, state) {
    return { jobs: side.jobs, groups: side.groups, median: side.median === null ? unavailable("no_measured_members") :
      state === "partial" ? { state, value: side.median, reasons: ["host_records_partly"], bound: "lower" } : measured(side.median) };
  }
  function checkSection(status) {
    return status === "checked" ? "results_available" : ["waiting_for_version", "no_check"].includes(status) ? "awaiting_result" : "investigating";
  }
  const resultOf = (verdict) => ({ confirmed: "better", not_confirmed: "worse", no_clear_change: "no_detected_change", too_few_jobs: "inconclusive" })[verdict];
  function buildChecks(checks, data, findings) {
    if (!checks) return { availability: "unavailable", reasons: ["canonical_source_unavailable"], rows: [] };
    if (!exact(checks, ["schema", "availability", "reasons", "method", "sources", "checks"]) ||
        checks.schema !== "factory-improvement-checks/1" || !object(checks.checks) ||
        !exact(checks.method, ["confidence", "bootstrap_resamples", "min_groups_per_side", "seed_policy"]) ||
        checks.method.confidence !== 0.95 || checks.method.bootstrap_resamples !== 10000 ||
        checks.method.min_groups_per_side !== 6 || checks.method.seed_policy !== "issue_number") fail();
    return { availability: checks.availability, reasons: clone(checks.reasons), rows: Object.entries(checks.checks).map(([ref, c]) => {
      if (refOf(c.url) !== ref || c.ref !== ref) fail();
      const issue = arr(data?.kaizen_issues).find((i) => i?.url === c.url);
      const cause = causeKey(issue?.cause) ? issue.cause : null;
      const res = issue?.resolution;
      const countermeasure = c.card?.countermeasure || (typeof res?.url === "string" && PULL.test(res.url) ? res.url : null);
      const merged = res?.url === countermeasure && typeof res?.merged === "boolean" ? res.merged ? "merged" : "not_merged" : "unknown";
      const r = c.result, comparison = r?.comparison;
      const checked = c.status === "checked";
      if (checked && (!r || !comparison)) fail();
      const bound = r?.state === "partial" ? "unknown" : null;
      return {
        ref, url: c.url, issue_state: c.issue_state, status: c.status, reasons: clone(c.reasons),
        section: checkSection(c.status), result: checked ? resultOf(r.verdict) : c.status === "refused" ? "refused" : c.status === "unavailable" ? "unavailable" : "awaiting_result",
        measurement_state: checked ? r.state : "unavailable", verdict: checked ? r.verdict : null,
        card: c.card ? clone(c.card) : null, sample_jobs: checked ? r.jobs : null, excluded: checked ? clone(r.excluded) : [],
        before: checked ? sampleSide(comparison.before, r.state) : null, after: checked ? sampleSide(comparison.after, r.state) : null,
        change: checked && comparison.change !== null ? { state: r.state, value: comparison.change, reasons: clone(r.reasons), ...(bound ? { bound } : {}) } : unavailable("no_measured_members"),
        interval: checked && comparison.interval !== null ? { state: r.state, low: comparison.interval[0], high: comparison.interval[1],
          reasons: clone(r.reasons), ...(bound ? { bound } : {}) } : null,
        implementation: { url: countermeasure, merged }, cause, association: cause ? "mapped_measure_only" : "not_published",
        original_evidence: "not_published", finding_ids: cause && findings.some((f) => f.id === cause) ? [cause] : [],
        limits: ["association_not_causation", "task_mix_not_controlled", "capture_changes_not_controlled", "shared_workers_not_independent",
          "related_measure_not_original_evidence", ...(r?.verdict === "too_few_jobs" ? ["too_few_independent_groups", "no_effect_estimate"] : []),
          ...(checked && comparison.before.jobs === 0 ? ["baseline_missing"] : []), ...(checked && comparison.after.jobs === 0 ? ["later_sample_missing"] : [])],
        href: "#/improvements", source_path: `$.improvement_checks.checks["${ref}"]`,
        handoff: handoff(improvementSelector(ref), "#/improvements"),
      };
    }) };
  }
  function buildBehaviors(data, evidence) {
    const observations = arr(data?.outcomes?.rework?.returns).filter((r) => ["in_task", "at_review", "after_delivery"].includes(r?.caught)).map((r, i) => ({
      code: r.caught, figure: figure(r.total), source_file: "data.json", source_path: `$.outcomes.rework.returns[${i}].total`,
      by_reason: Object.fromEntries(RETURN_REASONS.map((key) => [key, figure(r.by_reason?.[key])])),
    }));
    const stops = [], teams = [];
    for (const e of arr(evidence)) {
      if (!id(e?.job) || !object(e.timeline)) fail();
      const t = e.timeline;
      for (const [i, w] of arr(t.waits).entries()) {
        if (!number(w.start_ms) || !number(w.end_ms) || w.end_ms < w.start_ms) fail();
        stops.push({ task: e.job, start_ms: w.start_ms, end_ms: w.end_ms, observation: clone(w.stop),
          judgment: { why: w.why, source: w.why_source, confidence: w.confidence, reasons: clone(w.reasons) },
          href: taskHref(e.job, "waiting:next_prompt"), source_file: `jobs/${e.job}.json`, source_path: `$.timeline.waits[${i}]` });
      }
      if (arr(t.agents).length) {
        const agents = new Map();
        for (const a of t.agents) {
          if (typeof a.session !== "string" || !count(a.n) || !(a.parent === null || count(a.parent))) fail();
          agents.set(`${a.session}:${a.n}`, a);
        }
        teams.push({ task: e.job, roots: [...agents.values()].filter((a) => a.parent === null).length,
          children: [...agents.values()].filter((a) => a.parent !== null).length,
          href: taskHref(e.job), source_file: `jobs/${e.job}.json`, source_path: "$.timeline.agents" });
      }
    }
    stops.sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms) || a.task.localeCompare(b.task) || a.start_ms - b.start_ms);
    teams.sort((a, b) => b.children - a.children || a.task.localeCompare(b.task));
    return Object.entries(QUESTIONS).map(([key, [question, missing, collection]]) => {
      const obs = key === "review_repair" ? observations : [];
      const ss = key === "human_stops" ? stops.slice(0, MAX_EXAMPLES) : [];
      const ts = key === "coordination" ? teams.slice(0, MAX_EXAMPLES) : [];
      return { id: key, question, state: obs.some((o) => o.figure.state !== "unavailable") || ss.length || ts.length ? "partial" : "unavailable",
        observations: obs, stops: ss, teams: ts, duration: unavailable("not_recorded_yet"), missing_observation: missing, collection_path: collection,
        limits: ["stage_timing_unavailable", "representative_examples_not_complete", ...(key === "coordination" ? ["coordination_timing_unavailable", "topology_not_task_allocation"] : [])],
        href: key === "human_stops" ? "#/causes/waiting:next_prompt" : "#/tasks",
      };
    });
  }
  const figMap = (src, allowed) => Object.fromEntries(Object.entries(src || {}).map(([k, v]) => {
    if (!allowed.includes(k)) fail();
    return [k, figure(v)];
  }));
  function buildEvolution(data, history) {
    const h = history?.by_week;
    if (h != null && (!object(h) || h.schema !== "factory.site.by_week/1" || h.basis !== "by_finish_week" ||
        h.week_basis !== "iso_week_utc_monday_start" || !Array.isArray(h.weeks) || !Array.isArray(h.tasks))) fail();
    const versions = arr(data?.trend).map((r) => {
      const row = { version: r.version };
      for (const k of ["jobs", "accepted", "sent_back", "first_pass_yield", "attention", "flow_efficiency"]) row[k] = figure(r[k]);
      if (row.accepted.value === 0) row.attention = unavailable("no_accepted_outcomes");
      return row;
    });
    const weeks = {
      state: h ? "available" : "unavailable", basis: "by_finish_week", week_basis: "iso_week_utc_monday_start",
      rows: arr(h?.weeks).map((w) => ({
        week: w.week, starts_on: w.starts_on, population: { n: w.n - w.n_partial, N: w.n, of: "finished_tasks_in_week" },
        jobs: clone(w.jobs), partial_tasks: w.n_partial, date_counts: { measured: w.n_day_measured, before: w.n_day_on_or_before, after: w.n_day_on_or_after, unknown: w.n_day_about },
        unsplit: { n: w.n_unsplit || 0, reasons: clone(w.unsplit_reasons || []) },
        lead_ms: figure(w.lead_ms), working_ms: figure(w.working_ms), idle_ms: figure(w.idle_ms), production_ms: unavailable("not_recorded_yet"),
        by_class_ms: figMap(w.by_class_ms, ["value", "support"]), by_waste_ms: figMap(w.by_waste_ms, WASTES),
        idle_by_waited_on_ms: figMap(w.idle_by_waited_on_ms, WAITS),
        agents_working_unlabeled_ms: figure(w.agents_working_unlabeled_ms), not_labeled_ms: figure(w.not_labeled_ms),
        flow_efficiency: w.flow_efficiency ? { median: figure(w.flow_efficiency.median), n: w.flow_efficiency.n, N: w.flow_efficiency.N } : { median: unavailable(), n: 0, N: w.n },
      })),
      tasks: arr(h?.tasks).map((t) => ({ job: t.job, finish_date: clone(t.finish_date), flow_efficiency: figure(t.flow_efficiency),
        lead_time_ms: figure(t.lead_time_ms), working_ms: figure(t.working_ms) })),
      unplaced: h ? clone(h.unplaced) : { n: 0, jobs: [], reasons: ["no_finish_source"] },
    };
    return { versions, weeks, limits: [...EVOLUTION_LIMITS], href: "#/compare",
      handoff: handoff("$.evolution", "#/compare") };
  }
  function overviewLimits(scope, sources) {
    return ["task_exposure_not_factory_time", "not_proven_avoidable", "accepted_population_not_timed_subset",
      ...(scope.capture.state === "unavailable" ? ["capture_unknown"] : scope.capture.state === "partial" || scope.capture.value < 1 ? ["capture_is_partial"] : []),
      ...(scope.attention.n !== undefined && scope.attention.n < 5 ? ["thin_attention_sample"] : []),
      ...(sources.alignment === "different_reports" ? ["source_generations_differ"] : sources.alignment === "unknown" ? ["source_generation_unknown"] : [])];
  }
  function buildLearning({ data = null, causes = null, history = null, checks = null } = {}) {
    if (data !== null && (!object(data) || data.schema !== "factory-site/3" || !Array.isArray(data.jobs)) ||
        history !== null && (!exact(history, [], ["by_week", "evidence"]) || history.evidence !== undefined && !Array.isArray(history.evidence))) fail();
    const sources = { reports: data?.reports_commit || "unavailable",
      checks: checks?.sources ? clone(checks.sources) : { desk: "unavailable", facts: "unavailable", reports: "unavailable" } };
    sources.alignment = sources.reports === "unavailable" || sources.checks.reports === "unavailable" ? "unknown" :
      sources.reports === sources.checks.reports ? "same_reports" : "different_reports";
    const scope = {
      outcome_records: figure(data?.outcomes?.signoff?.jobs), accepted_outcomes: figure(data?.outcomes?.signoff?.accepted),
      task_reports: data ? measured(data.jobs.length) : unavailable(),
      timed_tasks: data ? measured(data.jobs.filter((j) => ["measured", "partial"].includes(j?.lead_time_ms?.state) &&
        number(j.lead_time_ms.value) && j.lead_time_ms.value >= 0).length) : unavailable(),
      attention: figure(data?.outcomes?.attention?.headline), attention_turns: figure(data?.outcomes?.attention?.turns_per_accepted),
      capture: figure(data?.capture_coverage?.share), first_pass_yield: figure(data?.outcomes?.first_pass_yield),
    };
    if (scope.accepted_outcomes.value === 0) {
      scope.attention = unavailable("no_accepted_outcomes");
      scope.attention_turns = unavailable("no_accepted_outcomes");
    }
    const findings = buildFindings(causes);
    const improvements = buildChecks(checks, data, findings);
    for (const f of findings) f.related_improvements = improvements.rows.filter((r) => r.finding_ids.includes(f.id)).map((r) => r.ref);
    const strongest = findings.find((f) => f.figure.state !== "unavailable" && f.figure.value > 0);
    const current = improvements.rows.find((r) => r.status === "checked") || improvements.rows[0];
    const limits = overviewLimits(scope, sources);
    const overview = strongest ? {
      code: "recorded_process_observation", conclusion: `${strongest.title}. This is a recorded process observation, not a proven saving.`,
      finding: strongest.id, href: strongest.href, improvement: current?.ref || null, limits,
    } : { code: "evidence_unavailable", conclusion: "The published evidence does not yet establish where the process loses time.",
      finding: null, href: "#/tasks", improvement: current?.ref || null, limits };
    const doc = { schema: SCHEMA, sources, scope, overview, findings, behaviors: buildBehaviors(data, history?.evidence),
      evolution: buildEvolution(data, history), improvements };
    if (!validateLearning(doc).ok) fail();
    return doc;
  }
  function sideOK(s) {
    return exact(s, ["jobs", "groups", "median"]) && count(s.jobs) && count(s.groups) && s.groups <= s.jobs && figureOK(s.median) &&
      (s.jobs === 0 ? s.groups === 0 && s.median.state === "unavailable" : s.groups > 0 && s.median.state !== "unavailable");
  }
  function cardOK(c) {
    return exact(c, ["signal", "job_class", "measure", "direction", "plugin", "version", "countermeasure"]) &&
      MEASURES.includes(c.signal) && MEASURES.includes(c.measure) && ["any", "other"].includes(c.job_class) &&
      ["up", "down"].includes(c.direction) && typeof c.plugin === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c.plugin) &&
      (c.version === null || release(c.version)) && (c.countermeasure === null || typeof c.countermeasure === "string" && PULL.test(c.countermeasure));
  }
  function rowOK(r) {
    if (!exact(r, ["ref", "url", "issue_state", "status", "reasons", "section", "result", "measurement_state", "verdict", "card",
      "sample_jobs", "excluded", "before", "after", "change", "interval", "implementation", "cause", "association", "original_evidence",
      "finding_ids", "limits", "href", "source_path", "handoff"]) ||
        refOf(r.url) !== r.ref || !["open", "closed"].includes(r.issue_state) ||
        !["checked", "waiting_for_version", "no_check", "refused", "unavailable"].includes(r.status) ||
        !codeList(r.reasons, CHECK_CODES) || r.section !== checkSection(r.status) || !figureOK(r.change, true) ||
        !codeList(r.limits, LIMITS) || r.href !== "#/improvements" ||
        !handoffOK(r.handoff, improvementSelector(r.ref), r.href) || r.source_path !== `$.improvement_checks.checks["${r.ref}"]` ||
        !exact(r.implementation, ["url", "merged"]) ||
        !(r.implementation.url === null || typeof r.implementation.url === "string" && PULL.test(r.implementation.url)) ||
        !["merged", "not_merged", "unknown"].includes(r.implementation.merged) ||
        r.implementation.url === null && r.implementation.merged !== "unknown" ||
        r.original_evidence !== "not_published" || !(r.cause === null || causeKey(r.cause)) ||
        r.association !== (r.cause ? "mapped_measure_only" : "not_published") || !unique(r.finding_ids) ||
        !r.finding_ids.every((f) => f === r.cause)) return false;
    if (r.status !== "checked") {
      return r.measurement_state === "unavailable" && r.verdict === null && r.sample_jobs === null && r.before === null && r.after === null &&
        r.interval === null && r.excluded.length === 0 && r.change.state === "unavailable" &&
        r.result === (r.status === "refused" ? "refused" : r.status === "unavailable" ? "unavailable" : "awaiting_result") &&
        (r.status === "waiting_for_version" ? cardOK(r.card) && r.card.version === null && r.reasons.length === 0 : r.card === null && r.reasons.length > 0);
    }
    if (!cardOK(r.card) || r.card.version === null || r.reasons.length || !["measured", "partial"].includes(r.measurement_state) ||
        r.result !== resultOf(r.verdict) || !r.result || !count(r.sample_jobs) || !sideOK(r.before) || !sideOK(r.after) ||
        !Array.isArray(r.excluded) || !unique(r.excluded.map((e) => e.reason)) ||
        !r.excluded.every((e) => exact(e, ["reason", "jobs"]) && EXCLUSIONS.includes(e.reason) && count(e.jobs) && e.jobs > 0) ||
        r.sample_jobs !== r.before.jobs + r.after.jobs + r.excluded.reduce((n, e) => n + e.jobs, 0)) return false;
    for (const side of [r.before, r.after]) if (side.median.state !== "unavailable" &&
      (side.median.state !== r.measurement_state || r.measurement_state === "partial" && side.median.bound !== "lower")) return false;
    const hasBoth = r.before.jobs > 0 && r.after.jobs > 0;
    if (hasBoth ? r.change.value !== r.after.median.value - r.before.median.value ||
        r.change.state !== r.measurement_state || r.measurement_state === "partial" && r.change.bound !== "unknown" : r.change.state !== "unavailable") return false;
    const enough = r.before.groups >= 6 && r.after.groups >= 6;
    if (!enough) return r.verdict === "too_few_jobs" && r.interval === null && r.limits.includes("too_few_independent_groups") &&
      (r.before.jobs > 0 || r.limits.includes("baseline_missing")) && (r.after.jobs > 0 || r.limits.includes("later_sample_missing"));
    const i = r.interval;
    if (!exact(i, ["state", "low", "high", "reasons"], ["bound"]) || !number(i.low) || !number(i.high) || i.low > i.high ||
        i.state !== r.measurement_state || !codeList(i.reasons, ["host_records_partly"]) ||
        (i.state === "partial" ? i.bound !== "unknown" || i.reasons.length !== 1 : "bound" in i || i.reasons.length !== 0)) return false;
    const direction = i.high < 0 ? "down" : i.low > 0 ? "up" : null;
    return r.verdict === (direction === null ? "no_clear_change" : direction === r.card.direction ? "confirmed" : "not_confirmed");
  }
  function dayOK(d) {
    if (!exact(d, ["state", "value", "basis", "reasons"], ["bound", "bound_reason"]) ||
        !["measured", "partial"].includes(d.state) || !reasons(d.reasons) ||
        !["desk_transition", "desk_card_updated", "pr_anchor", "labels_landed"].includes(d.basis) ||
        typeof d.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.value) || !Number.isFinite(Date.parse(`${d.value}T00:00:00Z`))) return false;
    return d.state === "measured" ? d.reasons.length === 0 && !("bound" in d) :
      d.reasons.length > 0 && (["lower", "upper"].includes(d.bound) || d.bound === null && F.hasReasonText(d.bound_reason));
  }
  function weeksOK(w) {
    if (!exact(w, ["state", "basis", "week_basis", "rows", "tasks", "unplaced"]) || !["available", "unavailable"].includes(w.state) ||
        w.basis !== "by_finish_week" || w.week_basis !== "iso_week_utc_monday_start" || !Array.isArray(w.rows) || !Array.isArray(w.tasks) ||
        !exact(w.unplaced, ["n", "jobs", "reasons"]) || !count(w.unplaced.n) || !unique(w.unplaced.jobs) ||
        w.unplaced.n !== w.unplaced.jobs.length || !w.unplaced.jobs.every(id) || !reasons(w.unplaced.reasons)) return false;
    if (w.state === "unavailable" && (w.rows.length || w.tasks.length || w.unplaced.n)) return false;
    const allJobs = [], points = new Map();
    for (const t of w.tasks) {
      if (!exact(t, ["job", "finish_date", "flow_efficiency", "lead_time_ms", "working_ms"]) || !id(t.job) || points.has(t.job) ||
          !dayOK(t.finish_date) || !["flow_efficiency", "lead_time_ms", "working_ms"].every((k) => figureOK(t[k]))) return false;
      points.set(t.job, t);
    }
    let previous = null;
    for (const r of w.rows) {
      if (!exact(r, ["week", "starts_on", "population", "jobs", "partial_tasks", "date_counts", "unsplit", "lead_ms", "working_ms", "idle_ms",
        "production_ms", "by_class_ms", "by_waste_ms", "idle_by_waited_on_ms", "agents_working_unlabeled_ms", "not_labeled_ms", "flow_efficiency"]) ||
          typeof r.week !== "string" || !/^\d{4}-W\d{2}$/.test(r.week) || typeof r.starts_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.starts_on) ||
          !populationOK(r.population, "finished_tasks_in_week") || !unique(r.jobs) || !r.jobs.every(id) || r.population.N !== r.jobs.length ||
          !count(r.partial_tasks) || r.partial_tasks !== r.population.N - r.population.n ||
          !exact(r.date_counts, ["measured", "before", "after", "unknown"]) || !Object.values(r.date_counts).every(count) ||
          Object.values(r.date_counts).reduce((a, b) => a + b, 0) !== r.jobs.length ||
          !exact(r.unsplit, ["n", "reasons"]) || !count(r.unsplit.n) || r.unsplit.n > r.jobs.length || !reasons(r.unsplit.reasons) ||
          !["lead_ms", "working_ms", "idle_ms", "production_ms", "agents_working_unlabeled_ms", "not_labeled_ms"].every((k) => figureOK(r[k])) ||
          r.production_ms.state !== "unavailable" || !exact(r.flow_efficiency, ["median", "n", "N"]) ||
          !count(r.flow_efficiency.n) || r.flow_efficiency.N !== r.jobs.length || r.flow_efficiency.n > r.flow_efficiency.N || !figureOK(r.flow_efficiency.median)) return false;
      for (const [key, allowed] of [["by_class_ms", ["value", "support"]], ["by_waste_ms", WASTES], ["idle_by_waited_on_ms", WAITS]]) {
        if (!object(r[key]) || !Object.entries(r[key]).every(([k, v]) => allowed.includes(k) && figureOK(v))) return false;
      }
      if (r.jobs.length === 0 && (["lead_ms", "working_ms", "idle_ms", "agents_working_unlabeled_ms", "not_labeled_ms"].some((k) => r[k].state !== "unavailable") ||
          ["by_class_ms", "by_waste_ms", "idle_by_waited_on_ms"].some((k) => Object.keys(r[k]).length) || r.flow_efficiency.median.state !== "unavailable")) return false;
      const at = Date.parse(`${r.starts_on}T00:00:00Z`);
      if (!Number.isFinite(at) || new Date(at).getUTCDay() !== 1 || previous !== null && at - previous !== 7 * 86400000) return false;
      previous = at;
      const days = { measured: 0, before: 0, after: 0, unknown: 0 };
      for (const job of r.jobs) {
        const d = points.get(job)?.finish_date;
        if (!d || w.unplaced.jobs.includes(job)) return false;
        days[d.state === "measured" ? "measured" : d.bound === "upper" ? "before" : d.bound === "lower" ? "after" : "unknown"]++;
      }
      if (Object.keys(days).some((k) => days[k] !== r.date_counts[k])) return false;
      allJobs.push(...r.jobs);
    }
    return unique(allJobs) && allJobs.length === points.size;
  }
  function validateLearning(doc) {
    const bad = () => ({ ok: false, codes: ["learning_projection_invalid"] });
    try {
      if (!exact(doc, ["schema", "sources", "scope", "overview", "findings", "behaviors", "evolution", "improvements"]) || doc.schema !== SCHEMA ||
          !exact(doc.sources, ["reports", "checks", "alignment"]) || !revision(doc.sources.reports) ||
          !exact(doc.sources.checks, ["desk", "facts", "reports"]) || !Object.values(doc.sources.checks).every(revision) ||
          doc.sources.alignment !== (doc.sources.reports === "unavailable" || doc.sources.checks.reports === "unavailable" ? "unknown" :
            doc.sources.reports === doc.sources.checks.reports ? "same_reports" : "different_reports")) return bad();
      const s = doc.scope;
      if (!exact(s, ["outcome_records", "accepted_outcomes", "task_reports", "timed_tasks", "attention", "attention_turns", "capture", "first_pass_yield"]) ||
          !Object.values(s).every((v) => figureOK(v)) || !["outcome_records", "accepted_outcomes", "task_reports", "timed_tasks"].every((k) => s[k].state === "unavailable" || count(s[k].value)) ||
          s.timed_tasks.value > s.task_reports.value ||
          s.accepted_outcomes.value > s.outcome_records.value ||
          ["attention", "attention_turns"].some((k) => s[k].state !== "unavailable" &&
            (s.accepted_outcomes.state === "unavailable" || s.accepted_outcomes.value === 0 || s[k].N !== s.accepted_outcomes.value || s[k].of !== "accepted outcomes"))) return bad();
      for (const k of ["capture", "first_pass_yield"]) if (s[k].state !== "unavailable" && s[k].value > 1) return bad();
      if (!Array.isArray(doc.findings) || doc.findings.length > MAX_FINDINGS || !unique(doc.findings.map((f) => f.id))) return bad();
      for (const f of doc.findings) {
        const [kind, cls] = classification(f.id);
        if (!exact(f, ["id", "kind", "classification", "title", "figure", "population", "affected_tasks", "examples", "source_file", "source_path", "href", "related_improvements", "limits", "handoff"]) ||
            !causeKey(f.id) || f.kind !== kind || f.classification !== cls || f.title !== title(f.id) || !figureOK(f.figure) ||
            !populationOK(f.population, "jobs_in_cause_rollup") || !unique(f.affected_tasks) || !f.affected_tasks.every(id) || f.affected_tasks.length > f.population.n ||
            !Array.isArray(f.examples) || f.examples.length > MAX_EXAMPLES || f.source_file !== "rollups/causes.json" ||
            !/^\$\.causes\[\d+\](?:\.children\[\d+\])?$/.test(f.source_path) ||
            f.href !== `#/causes/${f.id}` || !hrefOK(f.href) || !codeList(f.limits, LIMITS) || !FINDING_LIMITS.every((k) => f.limits.includes(k)) ||
            !handoffOK(f.handoff, findingSelector(f.id), f.href) || !unique(f.related_improvements)) return bad();
        for (const e of f.examples) if (!exact(e, ["task", "start_ms", "end_ms", "href", "map_path", "source_path"]) ||
          !f.affected_tasks.includes(e.task) || !number(e.start_ms) || !number(e.end_ms) || e.end_ms < e.start_ms ||
          e.href !== taskHref(e.task, f.id) || !hrefOK(e.href) || e.map_path !== `map/${e.task}.json` ||
          !e.source_path.startsWith(`${f.source_path}.spans[`) || !/\.spans\[\d+\]$/.test(e.source_path)) return bad();
      }
      if (!exact(doc.improvements, ["availability", "reasons", "rows"]) ||
          !["available", "partial", "unavailable"].includes(doc.improvements.availability) ||
          !codeList(doc.improvements.reasons, CHECK_CODES.slice(0, 3)) || !Array.isArray(doc.improvements.rows) ||
          !unique(doc.improvements.rows.map((r) => r.ref)) || !doc.improvements.rows.every(rowOK)) return bad();
      const unavailableChecks = doc.improvements.reasons.some((c) => ["canonical_source_unavailable", "issues_unavailable"].includes(c));
      if (doc.improvements.availability !== (unavailableChecks ? "unavailable" : doc.improvements.reasons.length ? "partial" : "available") ||
          doc.improvements.reasons.includes("canonical_source_unavailable") && doc.improvements.rows.some((r) => r.status !== "unavailable")) return bad();
      for (const f of doc.findings) if (JSON.stringify(f.related_improvements) !== JSON.stringify(doc.improvements.rows.filter((r) => r.finding_ids.includes(f.id)).map((r) => r.ref))) return bad();
      for (const r of doc.improvements.rows) if (r.finding_ids.some((key) => !doc.findings.some((f) => f.id === key))) return bad();
      const o = doc.overview;
      if (!exact(o, ["code", "conclusion", "finding", "href", "improvement", "limits"]) || !codeList(o.limits, LIMITS) ||
          JSON.stringify(o.limits) !== JSON.stringify(overviewLimits(s, doc.sources)) || !hrefOK(o.href) ||
          !(o.improvement === null || doc.improvements.rows.some((r) => r.ref === o.improvement))) return bad();
      const f = doc.findings.find((f) => f.id === o.finding);
      if (o.finding === null ? o.code !== "evidence_unavailable" || o.href !== "#/tasks" ||
          o.conclusion !== "The published evidence does not yet establish where the process loses time." :
        !f || f.figure.state === "unavailable" || f.figure.value <= 0 || o.code !== "recorded_process_observation" || o.href !== f.href ||
          o.conclusion !== `${f.title}. This is a recorded process observation, not a proven saving.`) return bad();
      if (!Array.isArray(doc.behaviors) || doc.behaviors.length !== 3 || !unique(doc.behaviors.map((b) => b.id))) return bad();
      for (const b of doc.behaviors) {
        const q = QUESTIONS[b.id];
        if (!q || !exact(b, ["id", "question", "state", "observations", "stops", "teams", "duration", "missing_observation", "collection_path", "limits", "href"]) ||
            b.question !== q[0] || b.missing_observation !== q[1] || b.collection_path !== q[2] ||
            !["partial", "unavailable"].includes(b.state) || !figureOK(b.duration) || b.duration.state !== "unavailable" ||
            !codeList(b.limits, LIMITS) || !hrefOK(b.href) || !Array.isArray(b.observations) || b.observations.length > 3 ||
            !Array.isArray(b.stops) || b.stops.length > MAX_EXAMPLES || !Array.isArray(b.teams) || b.teams.length > MAX_EXAMPLES) return bad();
        for (const obs of b.observations) if (!exact(obs, ["code", "figure", "by_reason", "source_file", "source_path"]) || b.id !== "review_repair" ||
          !["in_task", "at_review", "after_delivery"].includes(obs.code) || !figureOK(obs.figure) || obs.source_file !== "data.json" ||
          !/^\$\.outcomes\.rework\.returns\[\d+\]\.total$/.test(obs.source_path) || !exact(obs.by_reason, RETURN_REASONS) ||
          !Object.values(obs.by_reason).every((f) => figureOK(f) && (f.state === "unavailable" || count(f.value))) ||
          obs.figure.state !== "unavailable" && Object.values(obs.by_reason).every((f) => f.state !== "unavailable") &&
            Object.values(obs.by_reason).reduce((n, f) => n + f.value, 0) !== obs.figure.value) return bad();
        for (const stop of b.stops) {
          if (!exact(stop, ["task", "start_ms", "end_ms", "observation", "judgment", "href", "source_file", "source_path"]) || b.id !== "human_stops" ||
              !id(stop.task) || !number(stop.start_ms) || !number(stop.end_ms) || stop.end_ms < stop.start_ms ||
              stop.href !== taskHref(stop.task, "waiting:next_prompt") || stop.source_file !== `jobs/${stop.task}.json` || !/^\$\.timeline\.waits\[\d+\]$/.test(stop.source_path) ||
              !exact(stop.observation, ["end", "asks", "pending_agents"]) ||
              !["end_turn", "max_tokens", "rate_limit", "api_error", "refusal", "interrupted", "ask_question", "ask_plan", "not_recorded"].includes(stop.observation.end) ||
              ![true, false, null].includes(stop.observation.asks) || ![true, false, null].includes(stop.observation.pending_agents) ||
              !exact(stop.judgment, ["why", "source", "confidence", "reasons"]) || !WHYS.includes(stop.judgment.why) ||
              !["evaluator", "rule", "none"].includes(stop.judgment.source) || ![null, "high", "medium", "low"].includes(stop.judgment.confidence) ||
              !reasons(stop.judgment.reasons)) return bad();
        }
        for (const t of b.teams) if (!exact(t, ["task", "roots", "children", "href", "source_file", "source_path"]) || b.id !== "coordination" ||
          !id(t.task) || !count(t.roots) || !count(t.children) || t.href !== taskHref(t.task) ||
          t.source_file !== `jobs/${t.task}.json` || t.source_path !== "$.timeline.agents") return bad();
        if (b.state !== (b.observations.some((o) => o.figure.state !== "unavailable") || b.stops.length || b.teams.length ? "partial" : "unavailable")) return bad();
      }
      const e = doc.evolution;
      if (!exact(e, ["versions", "weeks", "limits", "href", "handoff"]) || !Array.isArray(e.versions) ||
          !unique(e.versions.map((v) => v.version)) || !codeList(e.limits, LIMITS) || !EVOLUTION_LIMITS.every((k) => e.limits.includes(k)) || e.href !== "#/compare" ||
          !handoffOK(e.handoff, "$.evolution", e.href) || !weeksOK(e.weeks)) return bad();
      for (const v of e.versions) if (!exact(v, ["version", "jobs", "accepted", "sent_back", "first_pass_yield", "attention", "flow_efficiency"]) ||
        !(v.version === "mixed" || release(v.version)) || !["jobs", "accepted", "sent_back", "first_pass_yield", "attention", "flow_efficiency"].every((k) => figureOK(v[k])) ||
        !["jobs", "accepted", "sent_back"].every((k) => v[k].state === "unavailable" || count(v[k].value)) ||
        ["first_pass_yield", "flow_efficiency"].some((k) => v[k].state !== "unavailable" && v[k].value > 1) ||
        v.attention.state !== "unavailable" && (v.accepted.value === 0 || v.attention.N !== v.accepted.value)) return bad();
      return { ok: true, codes: [] };
    } catch {
      return bad();
    }
  }
  return { buildLearning, validateLearning };
});
