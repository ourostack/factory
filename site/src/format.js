// The one place the site turns a number into something a reader sees.
//
// Every number reaches the page as { state, value?, reasons } (see
// site/scripts/state.mjs). No call site formats a number on its own: it hands
// the stated number and a kind to this module. There are three visibly
// different things, and none depends on color alone:
//   measured     the figure, plain.
//   partial      the figure with the word "partial" beside it, a bound sign
//                where the direction is known, and the reason in the title
//                (hover) and in text for screen readers.
//   unavailable  the words "no data" and the reason, in text. No digit is
//                ever printed for it, so a zero appears only when zero was
//                measured.
// A rollup also shows "n of N <what it counts>". Handing the formatter a bare
// number, a null, or an unknown kind throws: the wrong state cannot be drawn.
//
// Loaded as a plain script in the browser (global `FactoryFormat`) and
// required by the tests in Node.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FactoryFormat = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The page's own limit for a stale site. The health file cannot change it.
  const STALE_AFTER_HOURS = 36;
  const UNKNOWN_DIRECTION = "could be higher or lower";
  const CLOCK_SKEW_HOURS = 0.1;

  const REASON_TEXT = {
    not_recorded: "the store has no record of this",
    not_recorded_yet: "not recorded yet",
    // Sign-off, first-pass yield and rework (Desk's rollups/outcomes.json).
    signoff_not_published: "no published session carries a sign-off record yet",
    signoff_not_recorded: "the job was delivered before sign-off was recorded",
    history_not_recorded: "the job's history was not recorded from the start (an adopted card)",
    not_delivered: "the job has not been delivered",
    returns_not_fully_recorded: "some of the job's returns could not be read, so the count is a lower bound",
    awaiting_signoff: "the delivery still awaits the human's answer, so it counts as a pass so far",
    no_delivered_jobs: "no delivered job has a first-pass result yet",
    no_refusals: "no delivery has been sent back",
    no_labels: "no job is labeled for waste yet",
    confidence_not_recorded: "the evaluator's confidence in these labels was not recorded",
    not_all_labeled: "not every finished job is labeled for waste",
    active_time_unavailable: "a job's active time could not be measured",
    catch_point_not_recorded: "some defect time has no recorded catch point",
    no_finished_jobs: "no job has finished",
    none_unsigned: "no delivery is waiting for sign-off",
    waits_incomplete: "some unsigned deliveries have no recorded wait",
    no_accepted_outcomes: "no accepted outcomes yet",
    no_segments: "no session time could be placed on a job",
    host_does_not_record: "the host does not record this",
    not_collected_in_slice_1: "not collected yet",
    worker_split: "a session's work is split across jobs, so only part of it is counted here",
    worker_shared: "includes a worker shared with other jobs",
    censored: "the job is still open, so this is a lower bound",
    job_offsets_unavailable: "the job's start could not be placed",
    source_unreadable: "a session's log could not be read",
    interval_outside_session_clock: "some intervals ran outside the span of the session's main log, so they are left out",
    log_truncated: "a session's log was cut short",
    session_open: "the session had not ended",
    partial: "only partly measured",
    unmeasured_members: "some members were not measured and are left out",
    no_signoff_records: "no delivered job has a sign-off record yet",
    no_measured_members: "no member was measured",
    only_partly_recorded: "every figure that exists here is only partly recorded, so no median or total is shown",
    no_members: "there is nothing to count yet",
    outside_capture_scope: "the job is unfinished or its start predates capture",
    counter_not_recorded: "the host does not record this counter",
    no_intervals: "no time intervals were recorded",
    no_calls: "no calls were recorded",
    first_page_only: "only the first page of GitHub results was read",
    not_every_pull_request_checked: "not every pull request could be checked",
    github_api_unavailable: "GitHub could not be reached for this build",
    no_decisive_run_found: "no passed or failed run was found",
    no_intake_found: "no intake was found",
    not_checked: "not checked",
    no_applicable_members: "the measure applies to no job yet",
    queue_start_not_whole: "the job's first session start is itself only partly measured",
    // Published facts reasons (Desk's `unavailableReason`), the ones not above.
    log_missing: "a session's log was missing",
    capped: "the record hit a size limit and was cut",
    desk_public: "withheld because the desk's own repository may be public",
    field_absent: "the host's log did not include this",
    host_records_partly: "the host records only part of this, so the figure is a lower bound",
    withheld_public: "withheld from the public store",
    // Report-only reasons (Desk's per-job report and rollups), the ones not above.
    mixed: "more than one cause",
    no_sessions: "no session was recorded",
    open_job: "the job is still open",
    not_labeled: "the independent evaluator has not labeled this yet",
    cancelled: "the job was cancelled",
    status_unavailable: "the job's status could not be read",
    wait_fields_unavailable: "the waits could not be measured",
    zero_lead_time: "the lead time was zero, so no share can be taken",
    card_dates_shorter_than_work: "the task card's dates are shorter than the work its sessions recorded, so the elapsed time is at least the span of that work",
    no_wait_intervals: "no wait was recorded",
    no_active_intervals: "no active time was recorded",
    not_reported_to_store: "not reported to the store",
    not_in_published_facts: "not part of the published facts",
    facts_missing: "a session's facts are missing",
    no_facts: "no facts were published for this",
    facts_ambiguous: "a session's facts disagree with each other",
    // Human attention (Desk's rollups/outcomes.json `attention`).
    no_turn_records: "no session in the store records the human's turns",
    turns_not_recorded: "some sessions did not record all of the human's turns, so this is a lower bound",
    turns_capped: "a session's list of human turns was cut to a size limit, so this is a lower bound",
    turn_not_estimable: "some turns could not be estimated, so this is a lower bound",
    decision_not_estimable: "some permission decisions could not be estimated, so this is a lower bound",
    // Labels files (Desk's label reasons: what a label could not use, and why one is left unused).
    session_log_missing: "the session log was missing",
    session_mismatch: "the labels name a different session",
    job_unbound: "the session is not bound to the job",
    range: "a labeled stretch runs past the session",
    evidence_unmatched: "the labeled evidence no longer matches the facts",
    share_unknown: "the facts do not record which part of the session was the job's",
    outside_share: "the labels cover none of the job's own part of the session",
    inconsistent: "the labels contradict themselves (for example, they list stops or stretches of waste while marking those facts as missing, or a stop was judged by a newer version of the evaluator than the labels file), so they are left unused",
    // Why the agent stopped before a wait for the next prompt (Desk's timeline.waits[] and the next-prompt split by why).
    could_not_tell: "the evaluator read this wait's evidence and could not tell why the agent stopped",
    stop_not_recorded: "no recorded wait for the operator covers this time, so there is no record of why the agent stopped (some hosts do not record stops)",
    outside_own_share: "the facts do not say which part of the session was this task's, so the evaluator does not judge this wait for it",
    stop_partly_classified: "why the agent stopped is not known for some of this waiting, and some of that may belong here, so this is at least this much",
    // Capture coverage (the machines' content-free capture records).
    no_records: "no machine has published a capture record yet",
    record_stale: "some machines' capture records are older than 45 days and are left out",
    record_invalid: "some machines' capture records could not be read and are left out",
    records_over_limit: "more capture records than the site reads; the rest are left out",
    unverified_host: "the host's session count is not yet verified (for Codex, until one of its sessions has been derived)",
    host_not_counted: "a machine could not count this host's sessions, so it is left out of these figures",
    no_sessions_on_disk: "no session of this host is on disk",
    nothing_capturable: "every session on disk is held on purpose or outside a desk",
    host_does_not_say_desk: "this host's folders do not say which desk a session belongs to",
    // The improvement loop (the loop slot in each machine's capture record).
    no_loop_records: "no machine has sent its improvement loop's health yet",
    machine_sent_no_loop_record: "some machines did not send this figure and are left out",
    none_open: "no improvement item is open",
    // One job's labeled time (the page's per-task waste).
    some_sessions_not_labeled: "some of the job's sessions are not labeled yet, so this is at least this much",
    // The Lean walk's files (Desk's rollups/tasks.json, stackup.json and the per-session swimlane files).
    labels_from_shared_session: "this task's labels come from a session it shared with other tasks, so how its time splits is only partly known",
    over_budget_after_binning: "this session's activity is drawn at its coarsest: even with every short run merged, its swimlane file is larger than its size budget",
    agents_working: "agents were working during this stretch, so it is not counted as waiting; the evaluator had labeled it waiting",
    job_share_unknown: "for some of the job's sessions there is no record of which part was this job's, so their labels are left out and this is at least this much",
    session_work_unattributed: "a session of this task did work that no task's binding claims, so that time stays under cause not recorded and some of it may have been another task's",
    // Why Desk gives a partial figure no direction (its `bound_reason`,
    // beside `bound: null`), in Desk's own words; the page says
    // "direction not known, because …" where the direction is truly open.
    bound_reasons_conflict: "its reasons pull it both ways, so the true figure may be higher or lower",
    bound_not_moved: "its reasons do not change this figure, so it is exact for the task's window as stated",
    bound_not_one_quantity: "it is a ranking or a status, not one quantity, so it has no single direction",
    bound_direction_undecided: "one of its reasons has no decided direction yet, so the true figure may be higher or lower",
    // The PR clock (site/scripts/pr-clock.mjs): pull request times placed on the task clock through GitHub.
    anchor_spread: "the task's pull requests disagree by more than 2 minutes about when the task started, so times placed through them (pull request times and the finish day) may be off by up to that much, either way",
    no_timed_pr: "no session of this task timed a pull request, so GitHub's times cannot be placed on the task clock",
    no_created_timed_pr: "no session of this task timed a pull request it opened, so GitHub's times cannot be placed on the task clock",
    github_unreadable: "GitHub could not be read for this pull request (it may be private)",
    github_lookup_capped: "the build reads a limited number of pull requests from GitHub, and this one was beyond the limit",
    github_not_read: "this build did not read pull requests from GitHub",
    merged_time_not_recorded: "GitHub says the pull request merged but gives no merge time",
    anchor_unconfirmed: "nothing confirms when the task started on the wall clock: no pull request the session is known to have opened sets it, and no majority of its pull requests agrees; its pull request times would be at most these and its finish day at least this, and when one unconfirmed pull request is all there is, its times are not placed",
    anchor_spread_too_wide: "the task's pull requests disagree by more than 15 minutes about when the task started, so their times are not placed on the task clock",
    anchor_github_unreadable: "the pull requests that set the task's clock could not be read from GitHub",
    anchor_github_lookup_capped: "the pull requests that set the task's clock were beyond the build's limit of reads from GitHub",
    clock_skew: "the session's clock and GitHub's are a few seconds apart, so the merge is drawn at the opening; it happened then or later",
    not_merged: "the pull request has not merged",
    // A task's finish day (the store's finish-date ladder).
    finish_from_card_update: "the day comes from the task card's last update, so the task finished on or before it",
    finish_from_labels_landing: "the day comes from when the task's labels reached the store, so the task finished on or before it",
    reopened: "the task was reopened, so its latest finish counts",
    lead_window_partial: "the end of the task's lead time is itself only partly known",
    finish_from_last_work: "the day is that of the task's last recorded work, which is on or after the day its card was moved to done",
    anchor_after_labels: "the task's pull requests put its finish after the day its labels landed, so the two disagree; the labels' day is shown and may be too early",
    median_of_subset: "a median of only the tasks that were measured has no direction: the others could move it either way",
    no_finish_source: "no record gives the day this task finished",
    finish_before_last_work: "the task's recorded work went on past this day, so it may have finished later and this day may not be a bound",
    finish_time_not_known: "no published record places the time the task finished, so its lead time runs to the end of its recorded work and is at least that",
    job_offsets_withheld: "the desk withholds this task's timing",
    pr_time_not_placed: "some of the task's pull requests have no time on the task clock, so they cannot be counted in a box",
    clock_skew_conflict: "GitHub's merge time, placed through the task's clock anchor, falls before the opening the session recorded, and the anchor says it could be even earlier. The two disagree, so which way the true merge time lies is not known. It is drawn at the opening.",
  };

  // Every reason that can reach the page has words. The site build stops on
  // one that does not (check-numbers.mjs); the page itself still shows an
  // unknown code readably rather than failing.
  function hasReasonText(code) {
    return Object.prototype.hasOwnProperty.call(REASON_TEXT, code);
  }

  function reasonText(code) {
    return hasReasonText(code) ? REASON_TEXT[code] : String(code).replace(/_/g, " ");
  }

  const KINDS = {
    duration(v) {
      const x = Math.max(0, v);
      if (x === 0) return "0s";
      if (x < 1000) return "<1s";
      const sec = x / 1000;
      if (sec < 60) return `${Math.round(sec)}s`;
      const min = sec / 60;
      if (min < 60) return `${Math.round(min)}m`;
      const hr = min / 60;
      if (hr < 48) return `${hr.toFixed(1)}h`;
      return `${(hr / 24).toFixed(1)}d`;
    },
    hours: (v) => (v / 3600000).toFixed(1),
    count: (v) => v.toLocaleString("en-US"),
    compact(v) {
      if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
      if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
      return `${v}`;
    },
    pct: (v) => `${(v * 100).toFixed(0)}%`,
    pct1: (v) => `${(v * 100).toFixed(1)}%`,
    text: (v) => String(v),
    pass: (v) => (v === 1 ? "passed first time" : v === 0 ? "sent back" : String(v)),
  };

  function isStated(n) {
    return (
      n !== null &&
      typeof n === "object" &&
      (n.state === "measured" || n.state === "partial" || n.state === "unavailable") &&
      Array.isArray(n.reasons)
    );
  }

  // A reason's words without the direction they claim ("so this is a lower
  // bound", "so the task finished on or before it"): for a figure whose
  // combined direction is not known, or that has no value at all, where a
  // bound named by one reason would be false.
  const DIRECTION_CLAUSES = [/, so (?:the count|this|the figure) is an? (?:lower|upper) bound$/, /, so this is at least this much$/, /, so the task finished on or (?:before|after) it$/];
  function reasonCore(code) {
    let t = reasonText(code);
    for (const re of DIRECTION_CLAUSES) t = t.replace(re, "");
    return t;
  }
  const PULL_BOTH = "some of these reasons pull the figure up and others down, so which way the true figure lies is not known";

  // The Store's sign-off section in words (A1 I5): what its jobs are beside
  // the site's tasks, and, while first-pass yield has no value, why every
  // delivered job is out of its scope. `o` is data.json `outcomes`;
  // `tasks` the number of tasks the other pages show. Returns
  // { scope, yieldNote }, each a sentence or null.
  // The Store's sign-off words. The scope is stated once, in jobs, with
  // one base: what the jobs are, then how many were delivered, not
  // delivered or have no record, and how many of the site's tasks are
  // delivered (a task is the published part of a job, so the two units stay
  // apart). The captions under the figures then carry no out-of-scope
  // counts of their own (`withoutScope`). `deliveredTasks` is the delivered
  // tasks the attention figure rests on (A1 pass 2 M-n4).
  function signoffWords(o, tasks, deliveredTasks) {
    const so = (o && o.signoff) || {};
    const v = (n) => (n && n.state === "measured" && Number.isInteger(n.value) ? n.value : null);
    const jobs = v(so.jobs);
    const noRecord = v(so.no_record);
    const without = v(so.jobs_without_work_record);
    const notDelivered = v(so.not_delivered);
    const before = v(so.not_recorded);
    const unsigned = v(so.delivered_unsigned);
    // Delivered jobs: the jobs with a sign-off record less those not delivered.
    const delivered = jobs !== null && notDelivered !== null ? jobs - notDelivered : null;
    let scope = null;
    if (jobs !== null && noRecord !== null) {
      const total = jobs + noRecord;
      const what =
        without !== null && jobs - without + noRecord === tasks
          ? `These figures count ${total} jobs: the ${tasks} tasks the other pages show, and ${without} task card${without === 1 ? "" : "s"} that ${without === 1 ? "has" : "have"} a sign-off record but no published session, so no time to show.`
          : `These figures count ${total} jobs, each a task card with a sign-off record or a published session.`;
      const split = delivered !== null ? ` Of the ${total} jobs, ${delivered} ${delivered === 1 ? "was" : "were"} delivered, ${notDelivered} ${notDelivered === 1 ? "is" : "are"} not delivered yet and ${noRecord} ${noRecord === 1 ? "has" : "have"} no sign-off record.` : "";
      const t = Number.isInteger(deliveredTasks) && Number.isInteger(tasks) ? ` ${deliveredTasks} of the ${tasks} tasks ${deliveredTasks === 1 ? "is" : "are"} delivered; a task is the published part of a job.` : "";
      scope = `${what}${split}${t}`;
    }
    const y = (o && o.first_pass_yield) || {};
    const by = y.excluded && typeof y.excluded === "object" ? Object.entries(y.excluded).filter(([, n]) => Number.isInteger(n) && n > 0).map(([reason, jobs]) => ({ reason, jobs })) : [];
    const why = by.filter((e) => e.reason !== "not_delivered");
    let yieldNote = null;
    // Desk's counts are over every job, so they are said as such.
    const desk = () => {
      if (!why.length) return "";
      // No total is given: Desk's own count of jobs not delivered uses
      // another base than the sign-off counts above, so only the reasons
      // that apply to delivered jobs are listed, with Desk's counts.
      const each = why.map((e) => `${e.jobs} because ${reasonText(e.reason)}`);
      return ` Desk counts its reasons over all jobs, not only delivered ones: ${each.length > 1 ? `${each.slice(0, -1).join(", ")}, and ${each[each.length - 1]}` : each[0]}.`;
    };
    // A yield with a value rests on the delivered jobs with a verdict; the
    // note says how many, and why the others are left out (review I-2).
    if (y.state !== "unavailable" && Number.isInteger(y.N) && y.N > 0 && delivered !== null && delivered > y.N) {
      const rest = delivered - y.N;
      yieldNote = `${y.N} of the ${delivered} delivered jobs ${y.N === 1 ? "has" : "have"} a first-pass verdict; the other ${rest} ${rest === 1 ? "has" : "have"} none.${desk()}`;
    }
    if (y.state === "unavailable" && y.N === 0 && delivered > 0 && why.length) {
      const parts = [unsigned ? `the ${unsigned} awaiting an answer` : null, before ? `the ${before} delivered before sign-off was recorded` : null].filter(Boolean);
      yieldNote = `None of the ${delivered} delivered job${delivered === 1 ? "" : "s"} has a first-pass result${parts.length ? ` (${parts.join(" and ")})` : ""}.${desk()}`;
    }
    return { scope, yieldNote };
  }

  // First-pass yield's caption: without its out-of-scope count only when the
  // note beside it gives that count in its place (review I-2).
  function yieldCaption(n, words) {
    return words && words.yieldNote ? withoutScope(n) : n;
  }

  // A figure without its out-of-scope count, for a caption whose scope is
  // stated once beside it.
  function withoutScope(n) {
    return n && typeof n === "object" && Number.isInteger(n.out_of_scope) ? { ...n, out_of_scope: 0 } : n;
  }

  // The parts of one number, as plain data. `text` is what the figure reads;
  // `marker` is the visible word for a partial number; `reason` is the
  // reasons in words; `nofn` is "n of N <what>" for a rollup.
  function describe(number, kind) {
    if (!isStated(number)) {
      throw new TypeError("FactoryFormat: expected a stated number { state, value, reasons }, got " + JSON.stringify(number));
    }
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) {
      throw new TypeError("FactoryFormat: unknown kind " + kind);
    }
    // A figure with no value, or with no known direction, never names a
    // bound in its reasons.
    const directionless = number.state === "unavailable" || (number.state === "partial" && (number.bound === "unknown" || (number.bound === null && number.bound_reason !== "bound_not_moved")));
    const reason = number.reasons.map(directionless ? reasonCore : reasonText).join("; ");
    const nofn =
      Number.isInteger(number.n) && Number.isInteger(number.N) && typeof number.of === "string"
        ? `${number.n} of ${number.N} ${number.of}` +
          (Number.isInteger(number.out_of_scope) && number.out_of_scope > 0 ? ` \u00b7 ${number.out_of_scope} out of scope` : "")
        : null;
    const basis = number.basis === "declared" || number.basis === "inferred" ? number.basis : null;
    if (number.state === "unavailable") {
      return { state: "unavailable", text: "no data", marker: null, reason, nofn, basis: null };
    }
    if (typeof number.value !== "number" && typeof number.value !== "string") {
      throw new TypeError("FactoryFormat: a " + number.state + " number needs a value");
    }
    if (typeof number.value === "number" && !Number.isFinite(number.value)) {
      throw new TypeError("FactoryFormat: non-finite value");
    }
    if (number.state === "measured") return { state: "measured", text: KINDS[kind](number.value), marker: null, reason: "", nofn, basis };
    // A partial figure says which way the true figure lies, in words. A
    // partial duration under a second shows its exact milliseconds ("<1s"
    // would itself read as a bound). A lower bound of zero says nothing a
    // reader can use, so it reads "none recorded" beside its reason.
    const v = number.value;
    let body = kind === "duration" && typeof v === "number" && v < 1000 ? `${Math.round(Math.max(0, v))} ms` : KINDS[kind](v);
    let direction = number.bound === "lower" ? "at least " : number.bound === "upper" ? "at most " : "";
    if (number.bound === "lower" && v === 0) {
      body = "none recorded";
      direction = "";
    }
    const unknownDirection = number.bound === "unknown";
    // Desk's own "no direction" (bound: null) says why, when it says.
    // bound_not_moved is not an open direction: the figure is exact for its
    // window, so its words stand alone.
    const noDirection = number.bound === null && typeof number.bound_reason === "string" ? (number.bound_reason === "bound_not_moved" ? reasonText(number.bound_reason) : `direction not known, because ${reasonText(number.bound_reason)}`) : null;
    // An unknown direction is said in the visible marker too, so a reader
    // does not have to hover to learn the figure could be off either way.
    return {
      state: "partial",
      text: direction + body,
      // An unverified host is said as such, visibly, not only in the reason.
      marker: `${Array.isArray(number.reasons) && number.reasons.includes("unverified_host") ? "unverified" : "partial"}${unknownDirection ? `, ${UNKNOWN_DIRECTION}` : ""}`,
      reason: unknownDirection ? `${reason}; ${PULL_BOTH}` : noDirection ? `${reason}; ${noDirection}` : number.bound === null ? `${reason}; ${PULL_BOTH}` : reason,
      nofn,
      basis,
      unknownDirection,
    };
  }

  // The same, as one line of text, for tooltips and labels.
  function toText(number, kind) {
    const d = describe(number, kind);
    let s = d.text;
    if (d.state === "partial") s += ` (partial: ${d.reason})`;
    if (d.state === "unavailable") s += ` (${d.reason})`;
    if (d.basis) s += ` (${d.basis})`;
    if (d.nofn) s += ` [${d.nofn}]`;
    return s;
  }

  // Build the DOM for one number. Every string goes in through textContent.
  function render(doc, number, kind, opts) {
    const d = describe(number, kind);
    const showNofn = !(opts && opts.nofn === false);
    const wrap = doc.createElement("span");
    wrap.className = `num num-${d.state}`;
    const value = doc.createElement("span");
    value.className = "num-value";
    value.textContent = d.text;
    wrap.appendChild(value);
    if (d.state === "partial") {
      wrap.title = `Partial: ${d.reason}`;
      if (opts && opts.flag === "short") {
        // In a dense table or a list the cell says "partial" and the reason
        // sits in its title and in one note for the whole table.
        const flag = doc.createElement("span");
        flag.className = "num-flag";
        flag.textContent = d.marker.startsWith("unverified") ? "unverified" : "partial";
        flag.title = d.reason;
        const sr = doc.createElement("span");
        sr.className = "sr-only";
        sr.textContent = `: ${d.reason}`;
        flag.appendChild(sr);
        wrap.appendChild(flag);
      } else if (!(opts && opts.flag === false)) {
      const flag = doc.createElement("span");
      flag.className = "num-flag";
      // The whole marker, direction included, is visible text: a reader on a
      // touch screen or a keyboard has no hover, so the tooltip only repeats it.
      flag.textContent = d.marker;
      const sr = doc.createElement("span");
      sr.className = "sr-only";
      sr.textContent = `: ${d.reason}`;
      flag.appendChild(sr);
      wrap.appendChild(flag);
      } else if (d.unknownDirection) {
        // In a sentence the partial flag is left to the trust line beside
        // it, but an unknown direction is still said where the figure is.
        const note = doc.createElement("span");
        note.className = "num-flag";
        note.textContent = UNKNOWN_DIRECTION;
        wrap.appendChild(note);
      }
    } else if (d.state === "unavailable") {
      wrap.title = `No data: ${d.reason}`;
      const why = doc.createElement("span");
      // In a dense table the caller states the reason once below the table
      // (opts.reason === false); the cell keeps it for screen readers.
      why.className = opts && opts.reason === false ? "sr-only" : "num-reason";
      why.textContent = `(${d.reason})`;
      wrap.appendChild(why);
    }
    if (d.basis && !(opts && opts.basis === false)) {
      const b = doc.createElement("span");
      b.className = "num-basis";
      b.textContent = d.basis;
      b.title = d.basis === "declared" ? "Declared on a task card, not measured from a session" : "Computed from other measures";
      wrap.appendChild(b);
    }
    if (showNofn && d.nofn) {
      const n = doc.createElement("span");
      n.className = "num-nofn";
      n.textContent = d.nofn;
      wrap.appendChild(n);
    }
    return wrap;
  }

  // What the page says about the site's own health. The build writes a
  // verdict into health.json, but a site that stopped rebuilding cannot
  // update it, so the browser judges the build stamp itself, against a limit
  // that lives here, not in the file. The file is not trusted: anything
  // missing, malformed, future-dated or unrecognized reads `unknown` and can
  // never show `alive`. Precedence: broken, then stale, then unknown, then
  // alive.
  const STATUSES = ["alive", "stale", "broken", "unknown"];

  // Everything `alive` rests on, as the page reads it from the file. A missing
  // piece gives `unknown`. A new slot is a new row here.
  const REQUIRED_EVIDENCE = [
    { name: "last_data_build", label: "the build record", present: (h) => h.last_data_build.state === "measured" },
    { name: "factory_build", label: "the last factory-build run", present: (h) => h.factory_build.state === "measured" && h.factory_build.value === "success" },
    { name: "newest_intake", label: "the age of the newest intake", present: (h) => h.newest_intake.state === "measured" && typeof h.newest_intake.value === "string" },
    { name: "facts_by_host", label: "the facts count by host", present: (h) => h.facts_by_host.length > 0 },
  ];

  function wellFormed(h) {
    const obj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
    return (
      obj(h) &&
      obj(h.verdict) &&
      STATUSES.includes(h.verdict.status) &&
      typeof h.verdict.reason === "string" &&
      typeof h.built_at === "string" &&
      obj(h.last_data_build) &&
      obj(h.newest_intake) &&
      typeof h.newest_intake.state === "string" &&
      Array.isArray(h.facts_by_host) &&
      h.facts_by_host.every((x) => obj(x) && typeof x.host === "string" && isStated(x.files)) &&
      obj(h.factory_build) &&
      typeof h.factory_build.state === "string" &&
      obj(h.slots) &&
      Object.values(h.slots).every(isStated)
    );
  }

  function pageVerdict(health, nowMs) {
    if (!wellFormed(health)) {
      return { status: "unknown", reason: "the health record is missing, malformed or incomplete, so health cannot be told", ageHours: null };
    }
    const built = Date.parse(health.built_at);
    if (!Number.isFinite(built)) {
      return { status: "unknown", reason: "the build stamp could not be read", ageHours: null };
    }
    const ageHours = (nowMs - built) / 3600000;
    if (health.verdict.status === "broken") return { status: "broken", reason: health.verdict.reason, ageHours };
    if (ageHours < -CLOCK_SKEW_HOURS) {
      return { status: "unknown", reason: "the build stamp is in the future, so its age cannot be told", ageHours };
    }
    const file = health.verdict;
    if (file.status === "broken") return { status: "broken", reason: file.reason, ageHours };
    if (ageHours > STALE_AFTER_HOURS) {
      const age = ageHours >= 48 ? `${Math.floor(ageHours / 24)} days` : `${Math.floor(ageHours)} hours`;
      return { status: "stale", reason: `the site was last built ${age} ago; it is meant to rebuild at least every ${STALE_AFTER_HOURS} hours`, ageHours };
    }
    if (file.status === "stale") return { status: "stale", reason: file.reason, ageHours };
    const missing = REQUIRED_EVIDENCE.filter((e) => !e.present(health));
    if (file.status === "unknown" || missing.length) {
      return {
        status: "unknown",
        reason: file.status === "unknown" && !missing.length ? file.reason : `${missing.map((e) => e.label).join(", ")} could not be checked, so health cannot be told`,
        ageHours,
      };
    }
    return { status: "alive", reason: file.reason, ageHours };
  }

  // The only shapes the page will turn into a link from data: a GitHub pull
  // request, issue or workflow run, a session's facts file on main, or a job's
  // report on the reports branch. Anything else is shown as text.
  const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/((pull|issues|actions\/runs)\/\d+|blob\/main\/facts\/[A-Za-z0-9._-]+\.json|blob\/reports\/jobs\/[A-Za-z0-9_-]+\.md)$/;
  function safeGithubUrl(u) {
    return typeof u === "string" && GITHUB_URL.test(u) && !u.split("/").some((seg) => seg === "." || seg === "..") ? u : null;
  }

  // Each section's caption, by the population its numbers count. The build
  // writes which population each section reads (`data.scopes`), and the page
  // takes its caption from here, so a caption cannot name a population its
  // data does not count. A section or scope with no caption throws.
  const CAPTIONS = {
    headlines: {
      published:
        "The three totals at the top (subagent dispatches, tool calls, model requests) count every published session; each says how many of those sessions it rests on.",
      substantial:
        "The three totals at the top (subagent dispatches, tool calls, model requests) count the substantial sessions described next; each says how many of those sessions it rests on.",
    },
    tool_calls: {
      published:
        "Calls recorded per tool kind, across every published session that used it. A session whose tool record is cut short, unreadable, capped or still open is left out, and each figure says how many sessions it rests on (n of N).",
      substantial:
        "Calls recorded per tool kind, across the substantial sessions whose tool counts are whole; each figure says how many sessions it rests on (n of N).",
    },
    tool_failures: {
      published: "Share of calls that failed, for tool kinds used at least 20 times, across every published session that used them.",
      substantial: "Share of calls that failed, for tool kinds used at least 20 times, across the substantial sessions.",
    },
    models: {
      substantial:
        'Requests by model, summed over the substantial sessions that recorded their models. A session that recorded none is not counted as zero requests; it is left out and shown in the "n of N".',
    },
    subagents: {
      substantial:
        'Subagents dispatched per session, across the substantial sessions. A session whose subagent logs could not be read is left out of every bucket, including "0", and shown in the "n of N".',
    },
    harnesses: {
      substantial:
        "Which tool ran each session, across the substantial sessions. Workers, subagents and depth count only sessions whose agent list is whole (n of N). Subagents are workers with a parent; depth counts parent links.",
    },
  };

  function caption(section, scope) {
    const text = CAPTIONS[section] && CAPTIONS[section][scope];
    if (typeof text !== "string") throw new Error(`FactoryFormat: no caption for ${section} over ${scope} sessions`);
    return text;
  }

  // An in-page link built from data: only "#" and a plain id (letters,
  // digits, "-" and "_"), so data can never become a script or remote link.
  const ANCHOR = /^[A-Za-z0-9_-]{1,80}$/;
  function safeAnchor(id) {
    return typeof id === "string" && ANCHOR.test(id) ? `#${id}` : null;
  }

  // How many machines' records a host's figures rest on, and how many of them
  // could not verify the host's session count.
  function recordsWords(total, unverified, notCounted) {
    let words = `${total} record${total === 1 ? "" : "s"}`;
    if (notCounted) words += notCounted === total ? (total === 1 ? ", not counted" : ", none counted") : `, ${notCounted} not counted`;
    const counted = total - (notCounted || 0);
    if (!unverified) return words;
    // "all" counts only the machines that could count; say so when others could not.
    if (unverified === counted) return notCounted ? `${words}, the other ${counted} unverified` : `${words}, ${counted === 1 ? "unverified" : "all unverified"}`;
    return `${words}, ${unverified} unverified`;
  }

  // The coverage a trust line rests on, with its population named.
  function coverageWords(cov) {
    if (cov && (cov.state === "measured" || cov.state === "partial")) {
      return `coverage: ${describe(cov, "pct").text} of sessions still on disk${cov.state === "partial" ? " (partial)" : ""}`;
    }
    if (cov && cov.state === "unavailable" && Array.isArray(cov.reasons) && !(cov.reasons.length === 1 && cov.reasons[0] === "not_recorded_yet")) {
      return `coverage: no data (${describe(cov, "pct").reason})`;
    }
    return "coverage: not recorded yet";
  }

  // The machines whose capture record carries no loop slot: an older Desk, or a Desk whose loop has not measured for over three days. The record cannot tell them apart, so the words are true for both.
  const WITHOUT_LOOP_WORDS = " sent no loop health (an older Desk, or a loop that has not measured for over three days), ";

  // The private task names a desk may keep beside the page
  // (local-names.json): { version: 1, jobs: { "<job key>": { title, track,
  // task } } }. Anything else is the public view. Only own string fields are
  // read; the page inserts them as text.
  function parseLocalNames(file) {
    const obj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
    if (!obj(file) || file.version !== 1 || !obj(file.jobs)) return {};
    const out = Object.create(null);
    for (const [key, n] of Object.entries(file.jobs)) {
      if (!/^[0-9A-Za-z_-]{1,64}$/.test(key) || !obj(n) || typeof n.title !== "string" || !n.title.trim()) continue;
      out[key] = {
        title: n.title.trim().slice(0, 200),
        track: typeof n.track === "string" ? n.track.slice(0, 120) : "",
        task: typeof n.task === "string" ? n.task.slice(0, 120) : "",
      };
    }
    return out;
  }

  // Only the private view, served from this machine, can have the names file;
  // the public page never asks for it.
  function servesLocalNames(hostname) {
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  }

  // A job's label: its local name when there is one, else its short key.
  function jobLabel(names, id) {
    const n = names && Object.prototype.hasOwnProperty.call(names, id) ? names[id] : null;
    return n ? n.title : `Task ${String(id).slice(0, 10)}`;
  }

  // ------------------------------------------------------------- routes
  // The site is one page with hash routes, in the walk's order:
  //   #/                          the most recently finished task
  //   #/task/<job>                one task
  //   #/task/<job>/session/<id>   one session of that task
  //   #/session/<id>              one session whose task is not known
  //   #/compare  #/causes  #/act  the walk's other three steps
  //   #/compare?mode=working      a chart in agent working time mode
  //   #/why  #/about  #/store     reference pages
  // Old links keep working: #job-<id> and #session-<id> (the first site's
  // task and session pages) and its section anchors redirect.
  const ROUTE_ID = /^[0-9A-Za-z_-]{1,64}$/;
  // A cause key from Desk's causes rollup: "<waste>:<what>", or one of the
  // sub-causes of waiting for the next prompt by why the agent stopped,
  // "waiting:next_prompt:<why>" (Desk D5; the classes of addendum §4).
  const CAUSE_ID = /^(?:[a-z][a-z_]{0,40}:[a-z0-9][a-z0-9_.-]{0,60}|waiting:next_prompt:(?:stopped_short|question|error_limit|interrupted|decision|approval|acceptance|not_known))$/;
  const PAGES = ["compare", "causes", "act", "why", "about", "store"];
  // The first site's in-page sections, and where each one lives now.
  const OLD_ANCHORS = {
    answer: "#/store",
    "status-line": "#/store",
    fix: "#/causes",
    tasks: "#/compare",
    rest: "#/compare",
    "labeled-waste": "#/causes",
    guide: "#/about",
    more: "#/store",
    intake: "#/store",
    proof: "#/store",
    "work-design": "#/store",
    details: "#/store",
    "how-it-works": "#/about",
  };

  // What a hash asks for. `jobOfSession` (session id to job id) lets an old
  // session link land under its task. A redirect carries the new hash.
  // The item a deep link selects on a task or session view: "?bursts=4-6",
  // "?gaps=3", "?stretch=17", "?prompt=2" (operator prompts in clock
  // order), "?pr=1" (pull requests in the map file's order); 1-based.
  function parseSelect(q) {
    const m = /^(bursts|gaps|stretch|prompt|pr)=([1-9][0-9]{0,5})(?:-([1-9][0-9]{0,5}))?$/.exec(q);
    if (!m) return null;
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    return to >= from ? { kind: m[1], from, to } : null;
  }

  function parseRoute(hash, jobOfSession) {
    const full = typeof hash === "string" ? hash : "";
    const qi = full.startsWith("#/") ? full.indexOf("?") : -1;
    const h = qi >= 0 ? full.slice(0, qi) : full;
    const select = qi >= 0 ? parseSelect(full.slice(qi + 1)) : null;
    const lookup = typeof jobOfSession === "function" ? jobOfSession : () => null;
    if (h === "" || h === "#" || h === "#/") return { view: "task", job: null };
    if (h === "#main") return { view: "skip" };
    let m = /^#job-(.+)$/.exec(h);
    if (m) return ROUTE_ID.test(m[1]) ? { view: "redirect", to: `#/task/${m[1]}` } : { view: "missing" };
    m = /^#session-(.+)$/.exec(h);
    if (m) {
      if (!ROUTE_ID.test(m[1])) return { view: "missing" };
      const job = lookup(m[1]);
      return { view: "redirect", to: typeof job === "string" && ROUTE_ID.test(job) ? `#/task/${job}/session/${m[1]}` : `#/session/${m[1]}` };
    }
    m = /^#([A-Za-z][A-Za-z0-9_-]{0,40})$/.exec(h);
    if (m) return Object.prototype.hasOwnProperty.call(OLD_ANCHORS, m[1]) ? { view: "redirect", to: OLD_ANCHORS[m[1]] } : { view: "missing" };
    if (!h.startsWith("#/")) return { view: "missing" };
    const parts = h.slice(2).replace(/\/+$/, "").split("/");
    if (parts[0] === "task") {
      if (parts.length === 2 && ROUTE_ID.test(parts[1])) return { view: "task", job: parts[1], ...(select && select.kind !== "stretch" ? { select } : {}) };
      if (parts.length === 4 && parts[2] === "session" && ROUTE_ID.test(parts[1]) && ROUTE_ID.test(parts[3])) return { view: "session", job: parts[1], session: parts[3], ...(select && select.kind === "stretch" ? { select } : {}) };
      return { view: "missing" };
    }
    if (parts[0] === "session" && parts.length === 2 && ROUTE_ID.test(parts[1])) return { view: "session", job: null, session: parts[1] };
    // One cause of Rank causes: "#/causes/waiting:next_prompt" (a pasted
    // link may arrive with its colon encoded).
    if (parts[0] === "causes" && parts.length === 2) {
      let key = parts[1];
      try {
        key = decodeURIComponent(key);
      } catch (err) {
        return { view: "missing" };
      }
      return CAUSE_ID.test(key) ? { view: "cause", cause: key } : { view: "missing" };
    }
    if (parts.length === 1 && PAGES.includes(parts[0])) {
      const q = qi >= 0 ? full.slice(qi + 1) : "";
      // Compare tasks and Rank causes keep their chart mode in the URL; only
      // Compare tasks has the share mode.
      if (parts[0] === "compare") {
        // Compare keeps the stack-up's mode and Over time's view and mode:
        // "?mode=working&over=task&otmode=all". Unknown keys or values are
        // left out.
        const out = { view: "compare" };
        for (const kv of q.split("&")) {
          const [k, v] = kv.split("=");
          if (k === "mode" && (v === "working" || v === "share")) out.mode = v;
          else if (k === "over" && v === "task") out.over = v;
          else if (k === "otmode" && (v === "all" || v === "working")) out.otmode = v;
        }
        return out;
      }
      const mode = parts[0] === "causes" && q === "mode=working" ? "working" : null;
      if (mode) return { view: parts[0], mode };
      // A glossary entry on Why Lean?: "#/why?term=capture-coverage".
      const term = parts[0] === "why" ? /^term=([a-z][a-z0-9-]{0,40})$/.exec(q) : null;
      return term ? { view: "why", term: term[1] } : { view: parts[0] };
    }
    return { view: "missing" };
  }

  // Which view's own shell to show while the store's data is still loading:
  // the routed view's name, or null when the hash is not yet a view (a skip
  // link, an old anchor to redirect, a page that does not exist), in which
  // case the page shows only "Loading the store…".
  function loadingView(hash) {
    const r = parseRoute(hash, () => null);
    if (r.view === "skip" || r.view === "redirect") return null;
    return r.view === "missing" ? null : r.view;
  }

  // A link to one glossary entry on Why Lean? ("#/why?term=job-hours"), or
  // null for anything that is not a plain term.
  function glossaryRoute(term) {
    return typeof term === "string" && /^[a-z][a-z0-9-]{0,40}$/.test(term) ? `#/why?term=${term}` : null;
  }

  // Which of the four steps a view belongs to, for the tab that shows as current.
  function stepOf(view) {
    if (view === "task" || view === "session") return "task";
    if (view === "cause") return "causes";
    return ["compare", "causes", "act"].includes(view) ? view : null;
  }

  // A route link built from data: "#/" and plain path segments only, so data
  // can never become a script or a remote link.
  function safeRoute(...parts) {
    if (!parts.every((p) => typeof p === "string" && /^[0-9A-Za-z_-]{1,64}$/.test(p))) return null;
    return `#/${parts.join("/")}`;
  }

  // A task is finished when its status says done or cancelled and it has a
  // place in finish order, labeled for waste or not.
  const CLOSED_STATUS = new Set(["done", "cancelled"]);
  const finishPos = (j) => (j && j.finish_order && j.finish_order.state === "measured" ? j.finish_order.value : -1);
  function isFinished(j) {
    return !!j && CLOSED_STATUS.has(j.status) && finishPos(j) > 0;
  }
  const finishKey = (j) => (j && j.finish_date && (j.finish_date.state === "measured" || j.finish_date.state === "partial") && typeof j.finish_date.value === "string" ? j.finish_date.value : null);

  // The task #/ opens: the latest-finished task (by finish day, every done
  // or cancelled task) that has something to teach and waste labels
  // (below); without labels when none has them; when none teaches, the
  // latest-finished one whose lead time is at least an hour; the page says
  // which. Days are the only order the
  // store knows, so two tasks on the same day are a tie, and a tie goes to
  // the larger lead time. A lead time counts when it is measured or an "at
  // least" figure of an hour or more. Without one: the latest dated finished
  // task (the larger lead time on a tie), then the finished task with the
  // latest position, then any task with a position, then the first.
  const LANDING_MIN_LEAD_MS = 3600000;
  function leadValue(j) {
    const n = j && j.lead_time_ms;
    return n && n.state !== "unavailable" && typeof n.value === "number" && Number.isFinite(n.value) ? n.value : -1;
  }
  function leadAtLeast(j, ms) {
    const n = j && j.lead_time_ms;
    if (!n || leadValue(j) < ms) return false;
    return n.state === "measured" || (n.state === "partial" && n.bound === "lower");
  }
  // A task with something to teach: a lead time of at least an hour, at
  // least 5 minutes of known working time (measured, or partial with a
  // value), at least one work burst on its map and at least one recorded
  // operator prompt; first among them, one with evaluator waste labels, so
  // the value-adding and waste split and the lede's Lean lesson can show.
  const LANDING_MIN_WORK_MS = 300000;
  const LANDING_ALL = "a lead time of at least an hour, at least 5 minutes of known working time, a work burst on its map and a recorded operator prompt";
  const LANDING_LABELED = `This page opens on the latest-finished task with waste labels, ${LANDING_ALL}.`;
  const LANDING_UNLABELED = `No finished task has waste labels and all of ${LANDING_ALL}, so this page opens on the latest-finished task with all of these but the labels; it has no waste labels yet.`;
  const LANDING_FALLBACK_WHY = `No finished task has all of ${LANDING_ALL}, so this page opens on the latest-finished task whose lead time is at least an hour instead.`;
  const valueOf = (n) => (n && (n.state === "measured" || n.state === "partial") && typeof n.value === "number" && Number.isFinite(n.value) ? n.value : null);
  // What a task lacks for the landing, in the order the rule names them.
  const LANDING_MISSES = [
    ["lead", "a lead time under an hour or not known"],
    ["work", "under 5 minutes of known working time"],
    ["burst", "no work burst on its map"],
    ["prompt", "no recorded operator prompt"],
    ["labels", "no waste labels yet"],
  ];
  function landingMisses(j) {
    const out = [];
    if (!leadAtLeast(j, LANDING_MIN_LEAD_MS)) out.push("lead");
    const work = valueOf(j.active_time_ms);
    if (work === null || work < LANDING_MIN_WORK_MS) out.push("work");
    const bursts = valueOf(j.map_bursts);
    if (bursts === null || bursts < 1) out.push("burst");
    const prompts = valueOf(j.human_turns);
    if (prompts === null || prompts < 1) out.push("prompt");
    if (!hasLabels(j)) out.push("labels");
    return out;
  }
  function hasLabels(j) {
    const n = valueOf(j && j.waste && j.waste.sessions_labeled);
    return n !== null && n >= 1;
  }
  function teaches(j) {
    return landingMisses(j).every((k) => k === "labels");
  }
  // { job, level, teaches, why, note }: the task #/ opens; `level` says
  // which rule chose it ("labeled", "unlabeled" once the label condition is
  // dropped, or "fallback"); `why` says why a lesser rule was used (null for
  // "labeled"); `note` is what the page shows above the task: the rule used
  // and why the finished tasks after the chosen one in finish order were
  // skipped.
  function landingChoice(jobs) {
    const list = Array.isArray(jobs) ? jobs : [];
    const latest = (xs) =>
      xs.reduce((a, j) => {
        if (a === null) return j;
        const ka = finishKey(a);
        const kj = finishKey(j);
        if (ka !== kj) return kj > ka ? j : a;
        if (leadValue(j) !== leadValue(a)) return leadValue(j) > leadValue(a) ? j : a;
        return finishPos(j) > finishPos(a) ? j : a;
      }, null);
    const byPos = (xs) => xs.reduce((a, j) => (a === null || finishPos(j) > finishPos(a) ? j : a), null);
    const dated = list.filter((j) => isFinished(j) && finishKey(j) !== null);
    let job = latest(dated.filter((j) => teaches(j) && hasLabels(j)));
    let level = "labeled";
    if (!job) {
      job = latest(dated.filter(teaches));
      level = "unlabeled";
    }
    if (!job) {
      job = latest(dated.filter((j) => leadAtLeast(j, LANDING_MIN_LEAD_MS))) || latest(dated) || byPos(list.filter(isFinished)) || byPos(list.filter((j) => finishPos(j) > 0)) || list[0] || null;
      level = "fallback";
    }
    if (!job) return { job: null, level: null, teaches: false, why: null, note: null };
    const why = level === "labeled" ? null : level === "unlabeled" ? LANDING_UNLABELED : LANDING_FALLBACK_WHY;
    const head = level === "labeled" ? LANDING_LABELED : why;
    // The finished tasks the picker lists above the chosen one: a later day,
    // or the same day and a later place in finish order.
    const key = finishKey(job);
    const above = key === null ? [] : dated.filter((j) => j !== job && (finishKey(j) > key || (finishKey(j) === key && finishPos(j) > finishPos(job))));
    const counts = {};
    let tie = 0;
    for (const j of above) {
      const miss = landingMisses(j).filter((k) => level === "labeled" || k !== "labels");
      if (level === "fallback") {
        if (!leadAtLeast(j, LANDING_MIN_LEAD_MS)) counts.lead = (counts.lead || 0) + 1;
        else tie++;
        continue;
      }
      if (!miss.length) tie++;
      for (const k of miss) counts[k] = (counts[k] || 0) + 1;
    }
    const parts = LANDING_MISSES.filter(([k]) => counts[k]).map(([k, w]) => `${counts[k]} with ${w}`);
    if (tie) parts.push(`${tie} that finished the same day with a shorter lead time`);
    // Said in finish order, not the picker's, so it holds in either sort.
    const skipped = above.length ? ` The ${above.length} finished task${above.length === 1 ? " that comes" : "s that come"} after it in finish order ${above.length === 1 ? "is" : "are"} skipped (a task can miss several): ${parts.join(", ")}.` : "";
    return { job, level, teaches: level !== "fallback", why, note: `${head}${skipped}` };
  }
  function defaultTask(jobs) {
    return landingChoice(jobs).job;
  }

  // The Compare route for its choices, defaults left out: the stack-up's
  // mode ("all"), Over time's view ("week") and its mode ("share").
  function compareHash(c) {
    const o = c || {};
    const q = [];
    if (o.mode === "working" || o.mode === "share") q.push(`mode=${o.mode}`);
    if (o.over === "task") q.push("over=task");
    if (o.otmode === "all" || o.otmode === "working") q.push(`otmode=${o.otmode}`);
    return `#/compare${q.length ? `?${q.join("&")}` : ""}`;
  }

  // An English ordinal for a finish position: 1st, 2nd, 3rd, 11th, 22nd.
  function ordinal(n) {
    const s = String(n);
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return `${s}th`;
    return s + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  }

  // A task's place in finish order, as the task table and picker show it:
  // a position for every finished task (done or cancelled), labeled or not.
  function finishCell(j) {
    const placed = !!(j && j.finish_order && j.finish_order.state === "measured");
    if (!placed) return "no session";
    return isFinished(j) ? ordinal(j.finish_order.value) : "open";
  }

  // The task page's sentence about where a task sits in finish order: by
  // its finish day (UTC) among the dated finished tasks ("It finished on or
  // before 6 Oct (UTC), the 12th of 20 dated tasks."), with whether it is
  // labeled for waste yet. A finished task with no day says why and that it
  // is listed after the dated ones.
  function finishWords(j, jobs, opts) {
    const list = Array.isArray(jobs) ? jobs : [];
    if (!j || !j.finish_order || j.finish_order.state !== "measured") return "It has no place in finish order: no session of it is published.";
    if (!isFinished(j)) return "It is still open, so it is listed after the finished tasks, by its first session.";
    const unlabeled = j.finish_basis === "labels" ? "" : " It is not labeled for waste yet.";
    const dated = list.filter((x) => isFinished(x) && finishKey(x) !== null).sort((a, b) => finishPos(a) - finishPos(b));
    const f = finishDay(j.finish_date, opts);
    if (!f.day) return `It is finished, but no source gives its finish day (${f.reasons.map(reasonText).join("; ")}), so it is listed after the ${dated.length} dated task${dated.length === 1 ? "" : "s"}.${unlabeled}`;
    const rank = dated.findIndex((x) => x.id === j.id) + 1;
    const sameDay = dated.filter((x) => finishKey(x) === finishKey(j)).length;
    const where = rank > 0 ? `, the ${ordinal(rank)} of ${dated.length} dated task${dated.length === 1 ? "" : "s"}${sameDay > 1 ? ` in the store's order; ${sameDay} tasks share this day` : ""}` : "";
    const why = f.kind === "about" && f.reasons.length ? ` The day is no bound: ${f.reasons.map(reasonCore).join("; ")}.` : "";
    return `It finished ${finishLabel(f)}${where}.${why}${unlabeled}`;
  }

  // A finish day as a chart label says it: "on or before 29 Sep (UTC)", or
  // "about 29 Sep (UTC; direction not known)", the direction said once.
  function finishLabel(f) {
    if (!f || !f.day) return f && f.words ? f.words : "";
    return `${f.words.replace(/ \(direction not known\)$/, "")} (UTC${f.kind === "about" ? "; direction not known" : ""})`;
  }

  // A task's finish day in words, with its state and bound: "on 26 Sep"
  // (measured), "on or before 26 Sep" (an upper bound), "on or after 26 Sep"
  // (a lower bound), "about 26 Sep (direction not known)" (partial with no
  // direction: `unknown` in data.json, `null` in the rollup and map files),
  // or "not dated yet: <reason>" when no source gives a day. A day is never
  // guessed. The year is added when it is not `opts.year` (this UTC year by
  // default). Returns { kind, day, key, words, short, reasons }: `kind` is
  // "on", "on_or_before", "on_or_after", "about", "open" (a task still open)
  // or "none"; `key` is the "YYYY-MM-DD" value, for sorting; `short` is the
  // chart label ("26 Sep", "≤26 Sep", "≥26 Sep", "~26 Sep", "no date").
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayLabel(value, year) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const t = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value) return null;
    const d = new Date(t);
    const y = d.getUTCFullYear();
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${y === year ? "" : ` ${y}`}`;
  }
  function finishDay(fd, opts) {
    const year = opts && Number.isInteger(opts.year) ? opts.year : new Date().getUTCFullYear();
    const reasons = fd && Array.isArray(fd.reasons) ? fd.reasons.filter((r) => typeof r === "string" && r) : [];
    const day = fd && (fd.state === "measured" || fd.state === "partial") ? dayLabel(fd.value, year) : null;
    if (!day) {
      const why = reasons.length ? reasons : ["not_recorded"];
      return { kind: why.includes("open_job") ? "open" : "none", day: null, key: null, words: `not dated yet: ${why.map(reasonText).join("; ")}`, short: "no date", reasons: why };
    }
    const kind = fd.state === "measured" ? "on" : fd.bound === "upper" ? "on_or_before" : fd.bound === "lower" ? "on_or_after" : "about";
    const words = { on: `on ${day}`, on_or_before: `on or before ${day}`, on_or_after: `on or after ${day}`, about: `about ${day} (direction not known)` }[kind];
    const short = { on: day, on_or_before: `≤${day}`, on_or_after: `≥${day}`, about: `~${day}` }[kind];
    return { kind, day, key: fd.value, words, short, reasons };
  }

  // A task's public name: its local name on the operator's own machine, else
  // the title of its earliest-opened public pull request ("and N more";
  // partial when some of its pull requests could not be read), else
  // "Private task" with a short key. A task with public pull requests whose
  // titles could not be fetched says so instead of calling itself private.
  function taskName(names, job) {
    const id = String(job && job.id);
    const short = id.slice(0, 8);
    const local = names && Object.prototype.hasOwnProperty.call(names, id) ? names[id] : null;
    if (local) return { title: local.title, more: 0, kind: "local", short };
    const more = job && job.more_prs && job.more_prs.state === "measured" ? job.more_prs.value : 0;
    if (job && typeof job.name === "string" && job.name) return { title: job.name, more, kind: "public", short, partial: job.name_basis === "partial" };
    const prs = job && Array.isArray(job.pull_requests) ? job.pull_requests.length : 0;
    if (prs) return { title: `Task ${short}`, more: 0, kind: "unnamed", short };
    return { title: `Private task ${short}`, more: 0, kind: "private", short };
  }

  // The name as one line of text.
  function taskNameText(names, job) {
    const n = taskName(names, job);
    return n.more ? `${n.title} and ${n.more} more` : n.title;
  }

  // ------------------------------------------------------- the status line
  // Three states (design section 4, review I6). Abnormal names each alarm and
  // who is on it, or says no one is. Normal names what was checked. Not
  // monitored names what is not recorded and why. No data never reads as
  // normal: an empty alarm list with nothing monitoring it is "not monitored".
  function statusLine(input) {
    const x = input || {};
    const verdict = x.verdict || { status: "unknown", reason: "the health record could not be read" };
    const alarms = [];
    const checked = [];
    const missing = [];
    if (verdict.status === "broken" || verdict.status === "stale") {
      alarms.push({ key: "site", text: `the site data is ${verdict.status === "stale" ? "out of date" : "broken"}: ${verdict.reason}`, owner: null });
    } else if (verdict.status === "alive") {
      checked.push("the site's own build");
    } else {
      missing.push(`the site's own build (${verdict.reason})`);
    }
    const andon = Array.isArray(x.andon) ? x.andon : [];
    if (x.andonVerification === "unavailable") missing.push("andon issues (GitHub could not be reached for this build)");
    else {
      checked.push("andon issues");
      for (const a of andon.filter((i) => i && i.issue_state === "open")) alarms.push({ key: "andon", text: `andon: a tracked release made a quality measure worse (${a.ref})`, owner: { ref: a.ref, url: a.url } });
    }
    const cov = x.capture || {};
    for (const a of Array.isArray(cov.alarms) ? cov.alarms : []) alarms.push({ key: `capture:${a.host}`, family: "capture_alarm", text: `capture coverage on ${a.host}: ${a.code === "coverage_dropped" ? "a machine's capture share fell by 15 points or more" : "less than 80% of capturable sessions were captured"}`, owner: null });
    if (cov.share && cov.share.state !== "unavailable") checked.push("capture coverage");
    else missing.push(`capture coverage (${cov.share ? cov.share.reasons.map(reasonText).join("; ") : "not part of this build"})`);
    const loop = x.loop || {};
    for (const a of Array.isArray(loop.alarms) ? loop.alarms : []) alarms.push({ key: `loop:${a.code}`, family: "loop_alarm", text: `improvement loop: ${a.code === "improvement_age" ? "an improvement item has been open for a week or more" : a.code === "steps_stale" ? "a loop step has stopped succeeding" : "the loop raised an alarm about itself"}`, owner: null });
    if (loop.verdict && loop.verdict.status === "healthy") checked.push("the improvement loop");
    else if (!(Array.isArray(loop.alarms) && loop.alarms.length)) {
      const codes = loop.verdict && Array.isArray(loop.verdict.missing) ? [...new Set(loop.verdict.missing.flatMap((m) => m.codes || []))] : [];
      missing.push(`the improvement loop's health (${codes.length ? codes.map(reasonText).join("; ") : "not recorded"})`);
    }
    // Every fix-next alarm reaches this line too, so the status line and the
    // build's alarms never disagree. Alarms already told from their own source above are not
    // repeated; any other (a labels mismatch, or one whose source this line
    // did not see) is named here with no one on it.
    // Each alarm carries a stable key (its fix-next id), so a repeat is
    // found by key, never by matching words.
    const told = new Set(alarms.map((a) => a.family || a.key));
    for (const item of Array.isArray(x.fixNext) ? x.fixNext : []) {
      if (!item || item.severity !== "alarm" || told.has(item.id)) continue;
      const title = String(item.title || "an alarm was raised");
      alarms.push({ key: String(item.id || "alarm"), text: title.charAt(0).toLowerCase() + title.slice(1), owner: null });
    }
    // An open issue labeled factory-alarm whose title carries an alarm's key
    // (capture:<host>, loop:<code>) owns that alarm (desk#232).
    // When the build could not look (GitHub unreachable, or a build from
    // before owner issues were read), an alarm with no owner says so rather
    // than claiming no one is on it.
    const owners = Array.isArray(x.alarmIssues) ? x.alarmIssues : [];
    const ownersChecked = x.alarmIssuesVerification !== "unavailable" && Array.isArray(x.alarmIssues);
    const notChecked = x.alarmIssuesVerification === "unavailable" ? "owner not checked (GitHub could not be reached for this build)" : "owner not checked (this build did not look for owner issues)";
    for (const a of alarms) {
      if (a.owner) continue;
      const i = owners.find((o) => o && o.issue_state !== "closed" && Array.isArray(o.keys) && o.keys.includes(a.key));
      if (i) a.owner = { ref: i.ref, url: i.url };
      else a.ownerText = ownersChecked ? "no one is on this" : notChecked;
    }
    if (alarms.length) return { state: "abnormal", alarms, checked, missing };
    if (missing.length) return { state: "not_monitored", alarms, checked, missing };
    return { state: "normal", alarms, checked, missing };
  }

  // The alarm keys an issue title carries: "capture:claude-code — ..." gives
  // ["capture:claude-code"]. Only keys are read; the title itself never
  // reaches the page.
  function alarmKeys(title) {
    const out = new Set();
    for (const m of String(title || "").matchAll(/(?:^|[^A-Za-z0-9_:-])((?:capture|loop):[a-z0-9][a-z0-9_-]{0,60})/g)) out.add(m[1]);
    return [...out];
  }

  // ------------------------------------------------------------ bar scales
  // Every bar list is linear from zero on a stated scale. A share runs 0 to
  // 100%; a count or a duration runs 0 to a round number at or above the
  // largest value, and the chart's title states it. A log scale is never
  // drawn as bars, so asking for one throws.
  function niceMax(v) {
    if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v - 1e-9) return m * p;
    return 10 * p;
  }
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  // The scale uses the unit the values are written in: minutes up to an
  // hour, hours below 48 hours, days from 48 hours (KINDS.duration).
  function niceDurationMax(v) {
    if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) return HOUR;
    if (v <= HOUR) return Math.max(60000, niceMax(v / 60000) * 60000);
    if (v < 48 * HOUR) return Math.min(48 * HOUR, niceMax(v / HOUR) * HOUR);
    return niceMax(v / DAY) * DAY;
  }
  function durationScaleWords(max, largest) {
    if (largest >= 48 * HOUR) {
      const d = Math.round((max / DAY) * 100) / 100;
      return `${d} day${d === 1 ? "" : "s"}`;
    }
    if (max >= HOUR) return `${Math.round(max / HOUR).toLocaleString("en-US")} hours`;
    const m = Math.round(max / 60000);
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  function barScale(values, opts) {
    const o = opts || {};
    if (o.scale === "log") throw new Error("FactoryFormat: a log scale is never drawn as bars; use a dot plot");
    const kind = o.kind;
    const vals = (Array.isArray(values) ? values : []).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
    const largest = vals.length ? Math.max(...vals) : 0;
    let max;
    let label;
    if (kind === "pct" || kind === "pct1") {
      max = 1;
      label = "scale 0 to 100%";
    } else if (kind === "duration") {
      max = niceDurationMax(largest);
      label = `scale 0 to ${durationScaleWords(max, largest)}`;
    } else if (kind === "count" || kind === "compact") {
      max = Math.max(1, niceMax(largest));
      label = `scale 0 to ${KINDS.count(max)}`;
    } else throw new Error(`FactoryFormat: no bar scale for kind ${kind}`);
    const width = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(100, (v / max) * 100) : 0);
    return { max, label, width };
  }

  // One bar row's drawing, from its stated number and an optional second
  // figure (a 75th percentile) on a scale from barScale. A figure that was not
  // measured is never drawn as a bar: "none" means no track at all, so it can
  // never look like a measured zero, which draws an empty track.
  function barRow(number, secondary, scale) {
    const val = (n) => (n && n.state !== "unavailable" && typeof n.value === "number" && Number.isFinite(n.value) ? n.value : null);
    const v = val(number);
    if (v === null) return { draw: "none" };
    const s = val(secondary);
    return { draw: "bar", width: scale.width(v), secondaryWidth: s === null ? null : scale.width(s) };
  }

  // ------------------------------------------------------- the color system
  // One meaning, one color, everywhere (design section 5). Each segment's
  // CSS token, its fill (a hatch where the meaning is "not measured work")
  // and its fixed stacking position, bottom to top. Views read these names;
  // styles.css defines the colors for light and dark.
  const SEGMENTS = [
    { key: "value", label: "Value-adding", token: "--c-value", fill: "solid" },
    { key: "support", label: "Necessary", token: "--c-necessary", fill: "solid" },
    { key: "waiting", label: "Waiting", token: "--c-waste-waiting", fill: "solid" },
    { key: "defects", label: "Defects", token: "--c-waste-defects", fill: "solid" },
    { key: "extra_processing", label: "Extra processing", token: "--c-waste-extra-processing", fill: "solid" },
    { key: "overproduction", label: "Overproduction", token: "--c-waste-overproduction", fill: "solid" },
    { key: "motion", label: "Motion", token: "--c-waste-motion", fill: "solid" },
    { key: "transportation", label: "Transportation", token: "--c-waste-transportation", fill: "solid" },
    { key: "inventory", label: "Inventory", token: "--c-waste-inventory", fill: "solid" },
    { key: "non_utilized_talent", label: "Non-utilized talent", token: "--c-waste-talent", fill: "solid" },
    { key: "unknown", label: "Could not classify", token: "--c-waste-unknown", fill: "solid" },
    { key: "agents_working_unlabeled", label: "Agents working, not labeled", token: "--c-agents-working", fill: "hatch" },
    { key: "not_labeled", label: "Not labeled yet", token: "--c-not-labeled", fill: "outline" },
    { key: "no_session", label: "No session running", token: "--c-no-session", fill: "hatch" },
  ];

  // How a stacked part is drawn, the same in the stack-up and Over time:
  // its class (`seg-<key>`, or `seg-wait-<cause>` for a waiting part) and
  // its outline, or null for none. An "outline" part (Not labeled yet), a
  // working part with no split, and a task with no split at all are drawn
  // as an outline, never as a blank band (A1 pass 2 I-n1).
  function segmentLook(s) {
    const x = s || {};
    const cls = `sb-seg seg-${x.cause ? `wait-${x.cause}` : x.key}`;
    if (x.key === "unsplit") return { cls, stroke: "var(--baseline)" };
    const seg = SEGMENTS.find((y) => y.key === x.key);
    if ((seg && seg.fill === "outline") || x.key === "working_unsplit") return { cls, stroke: `var(${seg ? seg.token : "--c-not-labeled"})` };
    return { cls, stroke: null };
  }

  return { glossaryRoute, loadingView, parseRoute, parseSelect, alarmKeys, stepOf, safeRoute, defaultTask, landingChoice, segmentLook, withoutScope, yieldCaption, finishLabel, isFinished, LANDING_MIN_LEAD_MS, ordinal, taskName, taskNameText, statusLine, barScale,
    barRow, finishCell, finishWords, finishDay, compareHash, niceMax, SEGMENTS, CAUSE_ID, OLD_ANCHORS, parseLocalNames, servesLocalNames, jobLabel, WITHOUT_LOOP_WORDS, recordsWords, coverageWords, describe, toText, render, reasonText, reasonCore, signoffWords, hasReasonText, reasonTable: () => ({ ...REASON_TEXT }), pageVerdict, safeGithubUrl, safeAnchor, caption, CAPTION_SECTIONS: Object.keys(CAPTIONS), STALE_AFTER_HOURS, REQUIRED_EVIDENCE, KINDS: Object.keys(KINDS) };
});
