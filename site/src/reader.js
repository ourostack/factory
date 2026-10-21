// Human views of the validated learning projection. No accounting or checks
// are recalculated here; legacy charts remain available for deeper analysis.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./format.js"), require("./learning.js"), require("./walk.js"), require("./task-context.js"));
  else root.FactoryReader = factory(root.FactoryFormat, root.FactoryLearning, root.FactoryWalk, root.FactoryTaskContext);
})(typeof self !== "undefined" ? self : this, function (F, L, W, C) {
  "use strict";
  const RESULT = { better: "Better on the chosen measure", worse: "Worse on the chosen measure", no_detected_change: "No detected change",
    inconclusive: "Inconclusive", awaiting_result: "Awaiting a result", refused: "Check refused", unavailable: "Check unavailable" };
  const SECTIONS = [["results_available", "Results available"], ["awaiting_result", "Awaiting a result"],
    ["investigating", "Investigating or changing the process"]];
  const COUNT_MEASURES = new Set(["tool_failures", "tool_retries", "api_retries", "compactions", "retouches"]);
  const MEASURE = { human_wait: "Wait for the next human prompt", lead_time: "Recorded task window", active_time: "Recorded working time",
    queue_before_start: "Recorded window before first work", flow_efficiency: "Working share of the recorded window",
    permission_wait: "Permission waits", api_retry_wait: "API retry waits", tool_failures: "Failed tool calls",
    tool_retries: "Tool retries", api_retries: "API retries", compactions: "Context compactions", retouches: "Retouches",
    muda_time: "Evaluator-classified waste", search_waste: "Evaluator-classified search waste" };
  const CLASS = { value: "Value-adding work", support: "Necessary support", defects: "Corrective work (defects)",
    unknown: "Unclassified by the evaluator", waiting: "Evaluator-labeled pauses inside work",
    overproduction: "Overproduction", non_utilized_talent: "Non-utilized talent", transportation: "Transportation",
    inventory: "Inventory", motion: "Motion", extra_processing: "Extra processing" };
  const WHY = { stopped_short: "stopped short", question: "asked a question", error_limit: "error or limit", interrupted: "interrupted",
    decision: "decision", approval: "approval", acceptance: "acceptance", not_known: "not known" };
  const m = (value) => ({ state: "measured", value, reasons: [] });
  const count = (value) => F.describe(m(value), "count").text;
  const words = (value, kind = "hours") => {
    const d = F.describe(value, kind);
    return `${d.text}${d.marker ? ` (${d.marker})` : ""}${d.state === "unavailable" && d.reason ? `: ${d.reason}` : ""}`;
  };
  const measureName = (key) => MEASURE[key] || `Evaluator-classified ${String(key).replace(/^muda_time\./, "").replace(/_/g, " ")}`;
  const kindOf = (key) => key === "flow_efficiency" ? "pct1" : COUNT_MEASURES.has(key) ? "count" : "hours";
  function materialWarning(status) {
    const alarms = Array.isArray(status?.alarms) ? status.alarms : [];
    if (!alarms.length) return null;
    const site = alarms.some((a) => a.key === "site");
    const collection = alarms.some((a) => a.key?.startsWith("capture") || a.key === "labels_mismatch");
    if (site) return { effect: "This site's data needs attention; its build is stale or failed.", action: "Inspect data freshness", href: "#/store" };
    if (collection) return { effect: "Task-time capture or classification needs investigation; some work may be missing or misclassified.", action: "Inspect capture evidence", href: "#/store" };
    const refresh = alarms.find((a) => a.key === "loop:annotation_refresh");
    if (refresh) return { effect: refresh.reason !== "resource_unrecoverable" ? "Automatic improvement-note refresh is incomplete; this is separate from task-time collection." :
      "Automatic improvement-note refresh is blocked by retained writer state that could not be safely recovered; task-time collection is separate.",
      action: refresh.reason !== "resource_unrecoverable" ? "Inspect annotation refresh" : "Inspect annotation-writer recovery", href: "#/store" };
    if (alarms.some((a) => a.key?.startsWith("loop:"))) return { effect: "The improvement system has an unresolved alarm; its published record does not identify a task-time collection failure.", action: "Inspect affected operations", href: "#/store" };
    return { effect: "A recorded quality problem needs investigation.", action: "Inspect the public evidence", href: "#/improvements" };
  }
  function improvementHref(ref) {
    const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})#([1-9]\d{0,9})$/.exec(ref);
    if (!match) throw new TypeError("unsupported improvement reference");
    return `#/improvements/${match[1]}/${match[2]}/${match[3]}`;
  }
  function taskIdentity(job, names) {
    const local = job && names && Object.hasOwn(names, job.id) ? names[job.id] : null;
    if (local) return { title: local.title, basis: "Authorized local requested outcome.", reference: null };
    if (C.validateContextSummary(job?.context) && job.context.availability === "published" && job.context.heading) {
      return { title: job.context.heading, basis: "Evidence-supported public task purpose; not a verbatim original request.", reference: null, contextual: true };
    }
    const reference = typeof job?.name === "string" && job.name ? job.name : null;
    return { title: reference ? `Public reference: ${reference}` : `Private task ${String(job?.id || "").slice(0, 8)}`, reference,
      basis: `Requested outcome not published. ${reference ? "Public-reference basis: earliest-readable public pull-request title, not the original request." :
        job?.pull_requests?.length ? "Public pull-request references are available; their titles are unavailable." : "No public outcome description or pull-request title is available."}` };
  }
  function signedFigure(figure, kind) {
    if (figure.state === "unavailable") return words(figure, kind);
    if (kind === "pct1") {
      return `${words({ ...figure, value: figure.value * 100 }, "count")} percentage points`;
    }
    if (kind === "hours" && figure.state === "measured" && Math.abs(figure.value) > 0 && Math.abs(figure.value) < 1000) {
      return `${figure.value < 0 ? "−" : ""}${words(m(Math.abs(figure.value)), "count")} milliseconds`;
    }
    if (figure.value >= 0) return words(figure, kind);
    if (kind === "count") return words(figure, kind);
    const bound = figure.bound === "lower" ? "upper" : figure.bound === "upper" ? "lower" : figure.bound;
    return `−${words({ ...figure, value: Math.abs(figure.value), ...(bound ? { bound } : {}) }, kind)}`;
  }
  function checkLimit(row) {
    if (row.status === "waiting_for_version") return "The countermeasure version is not recorded. Publish its version boundary before comparing later work.";
    if (row.status !== "checked") return row.status === "refused" ? "The canonical check refused this card. Inspect its published refusal before changing the process." :
      "No current check is available. Missing monitoring is not an all-clear.";
    if (row.before.jobs === 0) return "The baseline is missing: no before tasks qualified. No effect estimate is established.";
    if (row.after.jobs === 0) return "No later tasks qualified. The check cannot yet establish an effect.";
    if (row.result === "inconclusive") return "Too few independent groups support this check. It ran, but did not establish an effect.";
    return "This is a before/after association, not a causal effect. Task mix, capture and shared workers can change the comparison.";
  }
  function createReader({ document: doc, setLocalHref, taskLabel = () => "Recorded task (outcome not published)", issueTitle = (_ref, title) => title } = {}) {
    const el = (tag, cls, text) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const p = (text, cls) => el("p", cls, text);
    const local = (text, href, cls, opts) => {
      if (!F.localDestination(href.split("?")[0])) throw new TypeError("unsupported reader route");
      const a = el("a", cls, text);
      if (setLocalHref) setLocalHref(a, href, opts); else a.href = href;
      return a;
    };
    const publicLink = (text, href) => {
      const a = el("a", null, text);
      const safe = F.safeGithubUrl(href);
      if (!safe) return el("span", null, text);
      a.href = safe; a.target = "_blank"; a.rel = "noopener"; return a;
    };
    const section = (title, cls = "reader-section") => {
      const n = el("section", cls); n.append(el("h2", "block-title", title)); return n;
    };
    const details = (title, ...children) => {
      const d = el("details", "reader-details"); d.append(el("summary", null, title), ...children); return d;
    };
    const figure = (value, kind = "hours") => F.render(doc, value, kind, { flag: "short" });
    const fact = (parent, label, value) => {
      const div = el("div"), dd = el("dd");
      dd.append(value); div.append(el("dt", null, label), dd); parent.append(div);
    };
    const figures = (rows) => {
      const dl = el("dl", "reader-figures");
      for (const [label, value, kind] of rows) fact(dl, label, figure(value, kind));
      return dl;
    };
    const validate = (learning) => { if (!L.validateLearning(learning).ok) throw new TypeError("learning_projection_invalid"); };
    const jsonLink = (path = "rollups/learning.json", label = "Read the same evidence as JSON") => {
      const a = el("a", null, label); a.href = path; return a;
    };
    function context(host, doc, { job } = {}) {
      host.replaceChildren();
      const box = section("What happened", "task-context");
      host.append(box);
      if (!C.validateTaskContext(doc, job).ok || doc.availability !== "published") {
        const availability = C.validateTaskContext(doc, job).ok ? doc.availability : "unavailable";
        const message = availability === "withheld" ? "The task explanation is withheld for privacy or insufficient support." :
          doc?.reason === "source_changed" ? "The evidence changed; the earlier explanation is unavailable until reviewed again." :
          "A reviewed public explanation is not published for this task.";
        box.append(p(message, "reader-limit"));
        return;
      }
      const events = doc.record.events;
      const selected = new Set(events.length <= 6 ? events : [...events.slice(0, 2),
        ...events.filter((event) => event.kind === "waiting").slice(0, 2), ...events.slice(-2)]);
      const list = el("ol", "task-context-events");
      for (const event of events.filter((entry) => selected.has(entry))) {
        const item = el("li", `task-context-event context-${event.kind}`);
        item.append(el("h3", null, event.kind === "waiting" ? "Waiting for a prerequisite" : event.kind === "result" ? "Observed result" : "Work"),
          p(event.explanation));
        if (event.kind === "waiting") {
          item.append(p(`Why progress stopped: ${event.reason}`), p(`Needed before continuing: ${event.prerequisite}`),
            p(event.resumption ? `Resumption: ${event.resumption}` : "Resumption is not recorded."));
        }
        const links = el("p", "task-context-evidence");
        const sessions = [...new Set(event.evidence.map((ref) => ref.session))];
        for (const session of sessions) {
          if (links.children.length) links.append(" · ");
          links.append(local(`Session ${session.slice(0, 8)}`, F.safeRoute("task", job ?? doc.job, "session", session)));
        }
        const placement = doc.placements.find((entry) => entry.event === event.id);
        if (placement.spans.some((span) => span.start_ms === null)) links.append(" · Task-clock placement unavailable");
        item.append(links); list.append(item);
      }
      box.append(list);
      const omitted = events.length - selected.size;
      if (omitted) box.append(p(`Showing ${selected.size} of ${events.length} published steps; ${omitted} more are in the full public context record.`, "chart-caption"));
      if (doc.record.coverage.state === "partial") box.append(p(
        doc.record.coverage.omitted_events > 0 ? `The explanation is partial; ${doc.record.coverage.omitted_events} additional events were omitted by the observer.` :
          "The explanation is partial: some context or task-clock placement is not recorded.", "reader-limit"));
      box.append(p("An independent observer explains the evidence, with a separate privacy review. Prerequisite context is not a measured waiting duration or a claim of avoidable waste.", "chart-caption"),
        jsonLink(`context/${doc.job}.json`, "Full public context record and confidence"));
    }
    function journey(host, map, { job, row } = {}) {
      host.replaceChildren();
      const story = W.recordedJourney(map, job);
      const box = el("section", "journey-overview");
      host.append(box);
      const conflict = story.state === "ok" && [["lead_time_ms", story.total_ms], ["working_ms", story.working_ms]]
        .some(([key, value]) => row?.[key]?.state !== "unavailable" && Number.isFinite(row?.[key]?.value) && row[key].value !== value);
      const work = row?.working_ms;
      const uncertainWork = work && work.state !== "measured" &&
        !(work.state === "partial" && work.bound === null && work.bound_reason === "bound_not_moved");
      const directionUnknown = (figure) => figure?.state === "partial" &&
        (figure.bound === "unknown" || (figure.bound === null && figure.bound_reason !== "bound_not_moved"));
      const uncertainWindow = directionUnknown(row?.lead_time_ms) || directionUnknown(row?.flow_efficiency);
      const complete = story.state === "ok" && !conflict && !uncertainWork && !uncertainWindow;
      const summary = el("dl", "journey-totals task-time-figures");
      const duration = (label, value, key) => {
        const uncertain = !complete && value?.state === "partial" &&
          (value.bound === "unknown" || (value.bound === null && value.bound_reason !== "bound_not_moved"));
        const source = key === "elapsed" ? row?.lead_time_ms : work;
        const bound = complete && source?.state === "partial" ? source.bound : null;
        const rounded = bound === "lower" ? Math.floor(value / 1000) * 1000 : bound === "upper" ? Math.ceil(value / 1000) * 1000 : value;
        const text = complete ? `${bound === "lower" ? "at least " : bound === "upper" ? "at most " : ""}${W.durationDetail(rounded)}`
          : `${words(value)}${uncertain ? "; could be higher or lower" : ""}`;
        const node = el("span", null, text);
        node.dataset.figure = key;
        if (complete) node.dataset.ms = String(value);
        fact(summary, label, node);
      };
      if (complete || row) {
        duration("Time covered", complete ? story.total_ms : row.lead_time_ms, "elapsed");
        duration("Time spent working", complete ? story.working_ms : row.working_ms, "working");
        box.append(summary);
      }
      if (complete || row) summary.dataset.role = "conclusion";
      const conclusion = p(complete
        ? `${W.durationDetail(story.working_ms)} of work across ${W.durationDetail(story.total_ms)}.`
        : conflict ? "The timeline and task totals disagree." : "The timeline is unavailable.", "task-conclusion");
      conclusion.dataset.role = row ? "caveat" : "conclusion";
      if (!complete) box.append(conclusion);
      if (!complete) {
        box.append(p(conflict ? "The available task totals are shown above." :
          uncertainWork ? "Working time is incomplete." : uncertainWindow ? "The time window is incomplete." : story.reason, "chart-caption"));
        return;
      }
      const share = row?.flow_efficiency?.state && row.flow_efficiency.state !== "unavailable"
        ? row.flow_efficiency : m(story.working_ms / story.total_ms);
      box.append(p(`${F.describe(share, "pct1").text} of the time covered was spent working.`, "journey-share"));
      box.append(el("h2", "block-title", "Work and pauses"));
      const strip = el("div", "journey-scale");
      strip.setAttribute("aria-hidden", "true");
      const listOf = (value) => Array.isArray(value) ? value : value.items;
      const parts = [...listOf(map.bursts).map((item) => ({ ...item, work: true })),
        ...listOf(map.gaps).map((item) => ({ ...item, work: false }))].sort((a, b) => a.start_ms - b.start_ms);
      for (const item of parts) {
        const work = typeof item.working_ms === "number" ? item.working_ms : item.working_ms?.value;
        const kind = item.work ? work === item.end_ms - item.start_ms ? "period" : "mixed" : "pause";
        const span = el("span", `journey-${kind}`);
        span.style.width = `${(item.end_ms - item.start_ms) / story.total_ms * 100}%`;
        strip.append(span);
      }
      box.append(strip);
      const key = el("ul", "journey-key");
      for (const [kind, label] of [["period", "Working"], ["pause", "Pause"],
        ...(parts.some((item) => item.work && (typeof item.working_ms === "number" ? item.working_ms : item.working_ms.value) !== item.end_ms - item.start_ms) ? [["mixed", "Work and pauses combined"]] : [])]) {
        const li = el("li");
        const swatch = el("span", `journey-${kind}`);
        swatch.setAttribute("aria-hidden", "true");
        li.append(swatch, label); key.append(li);
      }
      box.append(key);
      const labels = { next_prompt: "Waiting for a reply", other_task: "Work on other tasks", api_retry: "Retrying a request",
        tool_failure: "After a failed tool call", long_tool_call: "Waiting for a tool", queue_before_start: "Before the first session",
        no_session: "No session recorded", unknown: "Unaccounted for" };
      const list = el("ol", "journey-periods");
      let workNumber = 0;
      for (const item of story.items) {
        const li = el("li", "journey-part");
        const heading = item.kind === "box"
          ? `Work ${++workNumber}: ${W.durationDetail(item.working_ms)} working`
          : `Pause: ${W.durationDetail(item.end_ms - item.start_ms)}`;
        li.append(el("h3", null, heading));
        const detail = el("dl", "journey-part-times");
        for (const name of W.WAIT_KEYS) {
          if (item.by[name] > 0) fact(detail, labels[name], W.durationDetail(item.by[name]));
        }
        if (detail.children.length) li.append(detail);
        for (const status of item.statuses) {
          li.append(p(status.status === "done" ? "Delivered" : status.status === "blocked" ? "Blocked" :
            W.cardStatusWords(status.status, status.observed), "journey-status"));
        }
        list.append(li);
      }
      box.append(story.items.length > 5 ? details("All work and pauses", list) : list);
      if (story.by.unknown > 0) box.append(p(`Unaccounted time: ${W.durationDetail(story.by.unknown)}.`, "journey-unknown"));
      const taskRoute = F.safeRoute("task", job ?? map.job);
      if (taskRoute) box.append(local("Compare with all recorded tasks", F.routeWithContext("#/compare", { return: taskRoute }), null, { plain: true }));
    }
    function evidenceNote(value) {
      const d = F.describe(value, "count");
      return [d.nofn, d.reason].filter(Boolean).join(". ");
    }
    function findingCard(f, learning, examples = true, returning = null) {
      const card = el("article", "reader-finding"); card.dataset.finding = f.id;
      const cls = f.classification === "classified_waste" ? "Evaluator-classified waste" :
        f.classification === "unclassified" ? "Unclassified work" : f.kind === "host_observation" ? "Host observation" : "Reported stop classification";
      const href = returning ? F.routeWithContext(f.href, { return: returning }) : f.href;
      card.append(p(cls, "reader-eyebrow"), el("h3", null, f.title), figure(f.figure),
        p(`${count(f.population.n)} fully readable, finished and labeled of ${count(f.population.N)} considered tasks; ${count(f.affected_tasks.length)} affected task references. Task exposure, not unique factory time.`, "chart-caption"),
        p(f.classification === "classified_waste" ? "This classification is a judgment; its confidence and original evidence are on the finding." :
          "This observation is not automatically avoidable waste. Work elsewhere is not lost factory capacity.", "reader-limit"),
        local("Inspect this finding and its periods", href));
      if (examples && f.examples.length) {
        const list = el("ul", "reader-evidence");
        for (const ex of f.examples.slice(0, 2)) {
          const li = el("li");
          const target = returning ? F.routeWithContext(`#/task/${ex.task}`, { cause: f.id, return: returning }) : ex.href;
          li.append(local(`${taskLabel(ex.task)} · inspect period and team`, target),
            p(`Representative task-clock stretch: ${offset(ex.start_ms)} to ${offset(ex.end_ms)}. The task map resolves its actual period; no period number is guessed.`, "chart-caption"));
          list.append(li);
        }
        card.append(list);
      }
      for (const ref of f.related_improvements) card.append(p("Related measure, not proven original trigger: "),
        local(`Inspect ${ref} and its current result`, F.routeWithContext(improvementHref(ref), { cause: f.id, return: f.href })));
      return card;
    }
    function offset(ms) {
      return `${ms < 0 ? "−" : ""}${words(m(Math.abs(ms)))} ${ms < 0 ? "before" : "after"} task origin`;
    }
    function resultCard(row, issues, full = false) {
      const card = el("article", "reader-improvement"); card.dataset.ref = row.ref;
      const issue = issues.find((i) => i?.url === row.url);
      const title = issueTitle(row.ref, issue?.title) || `${measureName(row.card?.measure || row.cause?.split(":")[1] || "unknown")} · ${row.ref}`;
      const heading = el(full ? "h2" : "h3", full ? "block-title" : null, title);
      const result = p(RESULT[row.result], "reader-result");
      result.dataset.result = row.result;
      card.append(heading, publicLink(row.ref, row.url), result, p(checkLimit(row), "reader-limit"));
      if (row.status === "checked") card.append(p(`Check completed: ${count(row.before.jobs)} tasks in ${count(row.before.groups)} independent groups before; ${count(row.after.jobs)} tasks in ${count(row.after.groups)} independent groups after.`));
      const merge = row.implementation.merged;
      const implementation = p(`Implementation: ${merge === "merged" ? "merged; merge is not evidence of effect" :
        merge === "not_merged" ? "not merged" : "merge status not published"}. Issue ${row.issue_state}; closure is independent of the measured result.`, "chart-caption");
      if (row.implementation.url) implementation.append(" ", publicLink("Inspect the actual countermeasure", row.implementation.url));
      card.append(implementation);
      if (!full) card.append(local("Problem → change → current check", improvementHref(row.ref), "reader-story-link"));
      if (full) {
        const problem = section("Observed problem and related work");
        problem.append(p("Original trigger evidence is not published. These are related observations of the mapped measure, not a reconstructed triggering population."));
        const related = row.finding_ids.map((id) => currentLearning.findings.find((f) => f.id === id)).filter(Boolean);
        if (!related.length) problem.append(p("No supported finding-to-card association is published. Inspect the public issue; no task association is inferred."));
        for (const f of related) problem.append(findingCard(f, currentLearning, true, improvementHref(row.ref)));
        card.append(problem);
        const change = section("Change and exposure boundary");
        if (row.card) change.append(p(`${measureName(row.card.measure)}; desired direction: ${row.card.direction === "down" ? "lower" : "higher"}. Plugin: ${row.card.plugin}. Countermeasure version boundary: ${row.card.version || "not recorded"}. Job class: ${row.card.job_class}.`));
        else change.append(p("A validated hypothesis and version boundary are unavailable. The canonical checker has not accepted this card."));
        change.append(p("Version exposure is not a date cohort. Mixed versions and unsupported work are excluded by the canonical check. Before and after samples are independent session groups, not independent tasks."));
        card.append(change, comparison(row));
        const decision = section("What happens next?");
        decision.append(p("The decision to retain, revise or abandon the change, its recorded owner, and what was standardized are not published here. A result is not a recommendation; a recommendation is not a claim or verified execution."),
          local("Return to all improvements", "#/improvements"), handoff(row.handoff, row.ref));
        card.append(decision);
      }
      return card;
    }
    function comparison(row) {
      const box = section("Current check: sample and measured change");
      box.append(p("Canonical Desk check: 95% bootstrap interval; 10,000 resamples, at least 6 independent groups per side. Shared sessions reduce independence. This page does not rerun the estimator."));
      if (row.status !== "checked") {
        box.append(p(checkLimit(row)));
        if (row.reasons.length) box.append(p(`Published check reasons: ${row.reasons.join(", ")}.`));
        return box;
      }
      const kind = kindOf(row.card.measure), dl = el("dl", "reader-figures");
      for (const [label, sample] of [["Before", row.before], ["After", row.after]]) {
        const span = el("span"); span.append(figure(sample.median, kind),
          p(`${count(sample.jobs)} tasks; ${count(sample.groups)} independent groups.`, "chart-caption"));
        fact(dl, `${label} median · ${measureName(row.card.measure)}`, span);
      }
      fact(dl, "Change · after minus before", signedFigure(row.change, kind));
      if (row.interval) {
        const endpoint = (value) => signedFigure({ state: row.interval.state, value, reasons: row.interval.reasons,
          ...(row.interval.bound ? { bound: row.interval.bound } : {}) }, kind);
        fact(dl, "95% bootstrap interval", `${endpoint(row.interval.low)} to ${endpoint(row.interval.high)}`);
      } else fact(dl, "95% bootstrap interval", "Unavailable; this check did not establish an interval.");
      box.append(dl, p(`Measurement state: ${row.measurement_state}${row.measurement_state === "partial" ? "; side medians retain lower bounds, differences and intervals have unknown capture direction" : ""}. ${count(row.sample_jobs)} source task records considered.`),
        p("Task mix and capture changes are not controlled. A before/after difference does not establish causation; a partial bound is not an exact effect.", "reader-limit"));
      if (row.excluded.length) {
        const list = el("ul");
        for (const e of row.excluded) list.append(el("li", null, `${count(e.jobs)} excluded: ${F.reasonCore(e.reason)} (${e.reason}).`));
        box.append(details("Excluded records and sampling limits", list));
      }
      box.append(details("Exact current source and provenance", p(`data.json ${row.source_path}`),
        p(`Reports: ${currentLearning.sources.reports}. Checks source: Desk ${currentLearning.sources.checks.desk}; facts ${currentLearning.sources.checks.facts}; reports ${currentLearning.sources.checks.reports}.`),
        p(currentLearning.sources.alignment === "same_reports" ? "Report generations agree. This does not prove task comparability." : "Report alignment is missing or different; do not treat these populations as interchangeable."),
        jsonLink()));
      return box;
    }
    function handoff(value, label) {
      const prompt = `Inspect ${label} using ${value.file} selector ${value.selector}. Follow the referenced public evidence, then resolve authorized local detail with your linked agent. Do not infer private associations, claim work or start implementation. Authority limit: ${value.authority_limit}.`;
      const pre = el("pre", "copy-prompt", prompt); pre.tabIndex = 0;
      return details("Scoped inspect-only handoff for a linked agent", pre);
    }
    function behavior(b) {
      const box = el("article", "reader-behavior");
      box.append(el("h3", null, b.question));
      if (b.observations.length) {
        const list = el("ul");
        const catches = { in_task: "Inside the task", at_review: "At review", after_delivery: "After delivery" };
        const reasons = { agent_error: "Agent error", changed_ask: "Changed request", new_information: "New information", external: "External change" };
        for (const o of b.observations) {
          const li = el("li"); li.append(`${catches[o.code]}: `, figure(o.figure, "count"), " recorded returns.");
          const dl = el("dl", "reader-figures");
          for (const [key, value] of Object.entries(o.by_reason)) fact(dl, reasons[key], figure(value, "count"));
          li.append(details("Why work returned", dl)); list.append(li);
        }
        box.append(list, p("Returns do not all mean defects: changed requests and new information remain separate. Ordered review/repair cycle timing is unavailable."));
      }
      const examples = el("div", "reader-examples");
      for (const s of b.stops) {
        const item = el("div", "reader-stop");
        const obs = s.observation;
        const flag = (v) => v === null ? "not recorded" : v ? "yes" : "no";
        item.append(local(`${taskLabel(s.task)} · inspect the stop and team`, s.href),
          p(`${offset(s.start_ms)} to ${offset(s.end_ms)}.`, "chart-caption"),
          p(`Host observation: ${obs === null ? "not recorded" : `turn end ${obs.end}; question ${flag(obs.asks)}; pending agents ${flag(obs.pending_agents)}`}.`),
          p(`Judgment: ${WHY[s.judgment.why]}; source ${s.judgment.source || "not recorded"}; confidence ${s.judgment.confidence || "not recorded"}.`));
        if (s.judgment.reasons.length) item.append(p(s.judgment.reasons.map(F.reasonText).join("; "), "chart-caption"));
        examples.append(item);
      }
      for (const t of b.teams) {
        const item = el("div");
        item.append(local(`${taskLabel(t.task)} · inspect the team and shared sessions`, t.href),
          p(`${count(t.roots)} root-agent entries; ${count(t.children)} child-agent entries. Topology is not exclusive task allocation or coordination cost.`));
        examples.append(item);
      }
      if (examples.children.length) box.append(details("Representative task and team evidence", examples));
      box.append(p(`${b.id === "coordination" ? "Coordination" : "Stage"} duration unavailable. Missing observation: ${b.missing_observation}`, "reader-limit"),
        p(`Collection/classification path: ${b.collection_path}.`, "chart-caption"));
      if (!b.observations.length && !examples.children.length) box.append(p("No supported example is published in this snapshot; absence is not evidence of no recurrence."));
      return box;
    }
    function history(learning) {
      const box = section("How the process is evolving");
      box.append(p("Read time, returns, acceptance and human attention together. Task mix, capture changes and shared workers are not controlled; this history cannot isolate a process improvement.", "reader-limit"));
      const weeks = learning.evolution.weeks;
      if (weeks.rows.length) {
        box.append(p(`${count(weeks.rows.length)} available finish weeks; the whole published history is below, not a fixed short lookback. Weekly production time is unavailable. These are recorded task windows, summed as task exposure.`));
        const table = tableOf(["Finish week (UTC)", "Included / considered", "Recorded working", "Recorded interruptions", "Working share · median"], weeks.rows.map((w) => {
          const median = el("span");
          median.append(figure(w.flow_efficiency.median, "pct1"),
            p(`${count(w.flow_efficiency.n)} of ${count(w.flow_efficiency.N)} tasks support this median.`, "chart-caption"));
          return [w.week, `${count(w.population.n)} / ${count(w.population.N)} fully readable; ${count(w.partial_tasks)} partial`,
            figure(w.working_ms), figure(w.idle_ms), median];
        }));
        const allWeeks = details("Inspect all finish weeks and their samples", table);
        allWeeks.dataset.historyWeeks = "";
        box.append(allWeeks);
        const taskDetails = el("div");
        for (const w of weeks.rows) {
          const s = el("section");
          s.append(el("h3", null, `${w.week} · contributing tasks`),
            p(`Finish-day precision: ${count(w.date_counts.measured)} exact, ${count(w.date_counts.before)} on/before, ${count(w.date_counts.after)} on/after, ${count(w.date_counts.unknown)} direction unknown. ${count(w.unsplit.n)} task windows lack a split.`));
          const ul = el("ul");
          for (const id of w.jobs) {
            const t = weeks.tasks.find((row) => row.job === id), li = el("li");
            li.append(local(taskLabel(id), `#/task/${id}`));
            if (t) li.append(` · ${F.finishLabel(t.finish_date)} · recorded elapsed `, figure(t.lead_time_ms));
            ul.append(li);
          }
          s.append(ul); taskDetails.append(s);
        }
        taskDetails.append(p(`${count(weeks.unplaced.n)} finished tasks cannot be placed in a week. No finish day is invented.`));
        for (const id of weeks.unplaced.jobs) taskDetails.append(local(`${taskLabel(id)} · finish week unavailable`, `#/task/${id}`));
        box.append(details("Contributing work, bounded finish dates and unplaced tasks", taskDetails));
      } else box.append(p("Finish-week history is unavailable. No comparable earlier observation is invented."));
      const versions = learning.evolution.versions;
      if (versions.length) {
        const rows = versions.map((v) => [v.version === "mixed" ? "Several releases" : v.version,
          figure(v.jobs, "count"), figure(v.accepted, "count"), figure(v.sent_back, "count"), figure(v.first_pass_yield, "pct1"),
          figure(v.attention), figure(v.flow_efficiency, "pct1")]);
        box.append(details(`All ${count(versions.length)} captured release groups · inspect tradeoffs`,
          p("Releases are exposure groups, not timestamps or comparable cohorts. Several releases means mixed exposure. Attention is per accepted outcome; missing acceptance is not zero attention."),
          tableOf(["Desk release", "Task records", "Accepted", "Sent back", "First-pass yield", "Attention / accepted", "Working share"], rows)));
      } else box.append(p("Release history is unavailable; the present snapshot is not a trend."));
      const changes = learning.improvements.rows.filter((r) => r.card?.version);
      if (changes.length) {
        const marks = el("ul");
        for (const r of changes) {
          const li = el("li"); li.append(local(`${r.card.plugin} ${r.card.version} · ${r.ref}: ${RESULT[r.result]}`, improvementHref(r.ref))); marks.append(li);
        }
        box.append(details("Process-change version boundaries and current checks", marks));
      }
      box.append(local("Inspect per-task production and recorded-window comparisons", "#/compare?mode=production"));
      return box;
    }
    function tableOf(headings, rows) {
      const wrap = el("div", "table-wrap reader-table"), table = el("table", "data-table");
      const head = el("thead"), tr = el("tr");
      for (const text of headings) { const th = el("th", null, text); th.setAttribute("scope", "col"); tr.append(th); }
      head.append(tr); table.append(head);
      const body = el("tbody");
      for (const values of rows) {
        const row = el("tr");
        values.forEach((value, i) => { const td = el(i === 0 ? "th" : "td"); if (!i) td.setAttribute("scope", "row"); td.append(value); row.append(td); });
        body.append(row);
      }
      table.append(body); wrap.append(table); return wrap;
    }
    let currentLearning;
    function overview(host, learning, issues = []) {
      validate(learning); currentLearning = learning; host.replaceChildren();
      const f = learning.findings.find((r) => r.id === learning.overview.finding);
      const conclusion = p(f ? `${f.title}: ${words(f.figure)} of recorded task exposure. This is an observation to investigate, not a proven saving.` :
        learning.overview.conclusion, "reader-conclusion");
      conclusion.id = "overview-conclusion"; conclusion.dataset.role = "conclusion";
      const limit = p(`These task windows overlap; work elsewhere is not proven waste. ${learning.scope.capture.state === "unavailable" ?
        "Capture coverage is unknown." : learning.scope.capture.state === "partial" || learning.scope.capture.value < 1 ? "Capture is incomplete." : "Capture covers the published population, not all possible work."}`, "reader-limit");
      limit.dataset.role = "caveat";
      host.append(conclusion, limit, local("Explore Time & waste →", "#/time", "reader-next"));
      const columns = el("div", "reader-columns");
      const finding = section("What the process evidence says");
      if (f) finding.append(findingCard(f, learning, false));
      else finding.append(p("No supported time finding is available. Inspect task evidence and collection coverage before diagnosing waste."));
      columns.append(finding);
      const result = section("What changed—and what we know");
      const r = learning.improvements.rows.find((row) => row.ref === learning.overview.improvement);
      if (r) result.append(resultCard(r, issues));
      else result.append(p("No current improvement check is published. Shipment alone does not establish a benefit."), local("Inspect Improvements", "#/improvements"));
      columns.append(result); host.append(columns, history(learning));
      const context = section("What these populations cover");
      context.append(figures([["Outcome records · all", learning.scope.outcome_records, "count"],
        ["Accepted outcomes · all", learning.scope.accepted_outcomes, "count"], ["Task reports", learning.scope.task_reports, "count"],
        ["Tasks with a recorded window", learning.scope.timed_tasks, "count"], ["Human attention per accepted outcome", learning.scope.attention, "hours"],
        ["Capture coverage", learning.scope.capture, "pct1"]]),
        p("Accepted outcomes are not the timed-task subset. Attention is an estimate, not the duration of human stops. A thin sample cannot support a factory-wide claim.", "reader-limit"),
        p(evidenceNote(learning.scope.attention), "chart-caption"),
        p("Monitoring or review may be incomplete. This is not an all-clear."), local("Inspect Data health", "#/store"));
      host.append(details("Population, human attention and capture limits", context), jsonLink());
    }
    function time(host, learning) {
      validate(learning); currentLearning = learning; host.replaceChildren();
      const conclusion = p(learning.overview.conclusion, "reader-conclusion"); conclusion.dataset.role = "conclusion";
      host.append(conclusion, p("Observation comes before diagnosis: recorded interruptions, work elsewhere and missing sessions are not automatically avoidable waste. Summed task windows are exposure, not factory capacity.", "reader-limit"));
      const breakdown = section("Observed breakdown");
      const weeks = learning.evolution.weeks.rows;
      const content = el("div");
      const draw = (w) => {
        content.replaceChildren();
        if (!w) { content.append(p("No finish-week breakdown is published. Production time is unavailable at this aggregate; it is not replaced by recorded elapsed.")); return; }
        content.append(p(`${w.week}: ${count(w.population.n)} fully readable, finished and labeled of ${count(w.population.N)} considered tasks. Production time unavailable in this weekly rollup; the distinct recorded-window clock follows.`),
          figures([["Recorded elapsed · task exposure", w.lead_ms, "hours"], ["Recorded working", w.working_ms, "hours"],
            ["Recorded interruptions", w.idle_ms, "hours"], ["Value-adding · evaluator", w.by_class_ms.value || { state: "unavailable", reasons: ["not_labeled"] }, "hours"],
            ["Necessary support · evaluator", w.by_class_ms.support || { state: "unavailable", reasons: ["not_labeled"] }, "hours"],
            ["Corrective work · evaluator", w.by_waste_ms.defects || { state: "unavailable", reasons: ["not_labeled"] }, "hours"],
            ["Work not yet labeled", w.not_labeled_ms, "hours"]]));
        const rows = [...Object.entries(w.by_waste_ms).map(([key, f]) => [CLASS[key], figure(f)]),
          ["Agents working, not labeled", figure(w.agents_working_unlabeled_ms)]];
        content.append(details("Other classified work and unclassified work", tableOf(["Classification", "Recorded time"], rows)),
          p("Acceptance waits sit outside production. Classified work stays inside working time; interruptions are a separate clock split.", "chart-caption"));
      };
      if (weeks.length > 1) {
        const label = el("label", "reader-control", "Finish week (UTC) ");
        const select = el("select"); select.setAttribute("aria-label", "Breakdown finish week");
        for (const w of weeks) { const o = el("option", null, w.week); o.value = w.week; select.append(o); }
        select.value = weeks[weeks.length - 1].week;
        select.addEventListener("change", () => draw(weeks.find((w) => w.week === select.value)));
        label.append(select); breakdown.append(label);
      }
      draw(weeks[weeks.length - 1]); breakdown.append(content); host.append(breakdown);
      const findings = section("Findings worth investigating");
      findings.append(p("These findings cover the full cause-rollup population, not just the week above. Parent findings and their stop-classification children overlap; do not sum them.", "chart-caption"));
      const grid = el("div", "reader-columns");
      for (const f of learning.findings.slice(0, 4)) grid.append(findingCard(f, learning));
      findings.append(grid);
      if (learning.findings.length > 4) {
        const rest = el("div", "reader-columns");
        for (const f of learning.findings.slice(4)) rest.append(findingCard(f, learning));
        findings.append(details("More supported findings and stop classifications", rest));
      }
      if (!learning.findings.length) findings.append(p("No supported finding is published. Missing observation or classification is not zero waste."));
      host.append(findings);
      const behaviors = section("Recurring production behavior");
      for (const b of learning.behaviors) behaviors.append(behavior(b));
      host.append(behaviors);
      const analysis = section("Compare a specific difference");
      analysis.append(p("Production is the default analysis clock. A missing production boundary stays unavailable; choose the separate recorded-window comparison explicitly."),
        local("Compare production time", "#/compare?mode=production"), p("Or inspect the different clock: "),
        local("Compare recorded task windows", "#/compare"), p("Filters, category emphasis and all historical charts are available in analysis. Finish-date cohorts are not activity windows."),
        local("Rank all recorded findings", "#/causes"));
      host.append(analysis, jsonLink());
    }
    function improvements(host, learning, issues = [], selected = null) {
      validate(learning); currentLearning = learning; host.replaceChildren();
      const coverage = learning.improvements;
      if (coverage.availability === "unavailable") {
        host.append(p("Improvement evidence is unavailable in this build. The public cards or canonical check source could not be read; an empty view does not mean there is no work.", "reader-limit"), jsonLink());
        return;
      }
      if (coverage.availability === "partial") {
        host.append(p("Only the first page of public cards was read; more may exist. These sections describe the observed subset, not the complete improvement population.", "reader-limit"));
      }
      if (selected) {
        const row = learning.improvements.rows.find((r) => r.ref === selected);
        if (!row) { host.append(p("This public improvement has no current check row in this generation. No substitute was selected."), local("Inspect all improvements", "#/improvements")); return; }
        host.append(resultCard(row, issues, true)); return;
      }
      for (const [key, title] of SECTIONS) {
        const s = section(title); s.dataset.section = key;
        const rows = learning.improvements.rows.filter((r) => r.section === key);
        if (rows.length) {
          const grid = el("div", "reader-columns");
          for (const row of rows) grid.append(resultCard(row, issues)); s.append(grid);
        } else s.append(p(coverage.availability === "partial" ? "No card in the observed subset has this state; other cards may exist." :
          key === "results_available" ? "No completed current check is published. This is not evidence of no effect." :
          key === "awaiting_result" ? "No published card is in this state." : "No additional accepted canonical check row is in this state."));
        host.append(s);
      }
      host.append(p("Results are on the chosen measure, not a combined factory score. Checks can be better, worse, no detected change or inconclusive. Private triage annotations and freshness remain in coverage details below.", "chart-caption"), jsonLink());
    }
    function connections(host, learning, cause) {
      validate(learning); currentLearning = learning; host.replaceChildren();
      const finding = learning.findings.find((f) => f.id === cause);
      if (!finding) return;
      host.append(el("h2", "block-title", "Related process change and current result"));
      for (const ref of finding.related_improvements) {
        const row = learning.improvements.rows.find((r) => r.ref === ref);
        if (row) host.append(local(`${ref} · ${RESULT[row.result]} · inspect problem, change and check`,
          F.routeWithContext(improvementHref(ref), { cause, return: finding.href })));
      }
      host.append(p(finding.related_improvements.length ? "The published mapping associates a measure, not original triggering tasks. Merge and issue closure do not prove effect." :
        "No supported public improvement mapping is published for this finding. A linked task is not automatically an original trigger."));
    }
    return { overview, time, improvements, connections, journey, context };
  }
  return { createReader, improvementHref, taskIdentity, checkLimit, materialWarning };
});
