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
    no_delivered_jobs: "no job with a sign-off record has been delivered yet",
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
    not_labeled: "not labeled for waste yet",
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
    anchor_spread: "the task's pull requests disagree by more than 2 minutes about when the task started, so their times on the task clock may be off by that much",
    no_timed_pr: "no session of this task timed a pull request, so GitHub's times cannot be placed on the task clock",
    no_created_timed_pr: "no session of this task timed a pull request it opened, so GitHub's times cannot be placed on the task clock",
    github_unreadable: "GitHub could not be read for this pull request (it may be private)",
    github_lookup_capped: "the build reads a limited number of pull requests from GitHub, and this one was beyond the limit",
    github_not_read: "this build did not read pull requests from GitHub",
    merged_time_not_recorded: "GitHub says the pull request merged but gives no merge time",
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
    const reason = number.reasons.map(reasonText).join("; ");
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
      reason: unknownDirection ? `${reason}; which way the true figure lies is not known` : noDirection ? `${reason}; ${noDirection}` : reason,
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
  // A cause key from Desk's causes rollup: "<waste>:<what>".
  const CAUSE_ID = /^[a-z][a-z_]{0,40}:[a-z0-9][a-z0-9_.-]{0,60}$/;
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
  // "?gaps=3", "?stretch=17" (1-based numbers in clock order).
  function parseSelect(q) {
    const m = /^(bursts|gaps|stretch)=([1-9][0-9]{0,5})(?:-([1-9][0-9]{0,5}))?$/.exec(q);
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
      const mode = (parts[0] === "compare" || parts[0] === "causes") && q === "mode=working" ? "working" : parts[0] === "compare" && q === "mode=share" ? "share" : null;
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

  // The task #/ opens: the finished task with the latest finish position
  // (finished means labeled for waste, so its finish is known), named or
  // private alike, the same task an agent reaches by following llms.txt to
  // the largest finish_order among labeled tasks. Without one: the done task
  // with the latest position, then any task with a position, then the first.
  function defaultTask(jobs) {
    const list = Array.isArray(jobs) ? jobs : [];
    const pos = (j) => (j && j.finish_order && j.finish_order.state === "measured" ? j.finish_order.value : -1);
    const best = (xs) => xs.reduce((a, j) => (a === null || pos(j) > pos(a) ? j : a), null);
    const placed = list.filter((j) => j && pos(j) > 0);
    return best(placed.filter((j) => j.finish_basis === "labels")) || best(placed.filter((j) => j.status === "done")) || best(placed) || list[0] || null;
  }

  // An English ordinal for a finish position: 1st, 2nd, 3rd, 11th, 22nd.
  function ordinal(n) {
    const s = String(n);
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return `${s}th`;
    return s + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  }

  // A task's place in finish order, as the task table and picker show it.
  // Only a labeled task has finished in the store's sense; the rest are
  // listed after it, so their cell says why instead of showing a position.
  function finishCell(j) {
    const placed = !!(j && j.finish_order && j.finish_order.state === "measured");
    if (!placed) return "no session";
    if (j.finish_basis === "labels") return ordinal(j.finish_order.value);
    return j.status === "done" ? "not labeled" : "open";
  }

  // The task page's sentence about finish order. Tasks first labeled in the
  // same commit finished together, as far as the store can tell; their
  // positions inside that batch are lead-time order, and the sentence says so
  // rather than claiming a finishing sequence.
  function finishWords(j, jobs) {
    const list = Array.isArray(jobs) ? jobs : [];
    const labeled = list.filter((x) => x && x.finish_basis === "labels");
    if (!j || !j.finish_order || j.finish_order.state !== "measured") return "It has no place in finish order: no session of it is published.";
    if (j.finish_basis !== "labels") {
      if (j.status === "done") return "It is done but not labeled for waste yet, so it is listed after the labeled tasks, by its first session.";
      return "It is still open, so it is listed after the finished tasks, by its first session.";
    }
    const pos = `${ordinal(j.finish_order.value)} of ${labeled.length}`;
    const g = j.finish_group && j.finish_group.state === "measured" ? j.finish_group.value : null;
    const batch = g === null ? [] : labeled.filter((x) => x.finish_group && x.finish_group.state === "measured" && x.finish_group.value === g);
    if (batch.length > 1) {
      const groups = new Set(labeled.map((x) => (x.finish_group && x.finish_group.state === "measured" ? x.finish_group.value : null)).filter((x) => x !== null));
      const latest = g === Math.max(...groups);
      const others = batch.length - 1;
      return `It was labeled together with ${others} other task${others === 1 ? "" : "s"}${latest ? ", the latest batch" : ""}; within a batch, tasks are ordered by lead time, so it is ${pos} labeled tasks.`;
    }
    return `It was the ${pos} labeled tasks to finish.`;
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

  return { glossaryRoute, loadingView, parseRoute, parseSelect, alarmKeys, stepOf, safeRoute, defaultTask, ordinal, taskName, taskNameText, statusLine, barScale,
    barRow, finishCell, finishWords, niceMax, SEGMENTS, CAUSE_ID, OLD_ANCHORS, parseLocalNames, servesLocalNames, jobLabel, WITHOUT_LOOP_WORDS, recordsWords, coverageWords, describe, toText, render, reasonText, hasReasonText, reasonTable: () => ({ ...REASON_TEXT }), pageVerdict, safeGithubUrl, safeAnchor, caption, CAPTION_SECTIONS: Object.keys(CAPTIONS), STALE_AFTER_HOURS, REQUIRED_EVIDENCE, KINDS: Object.keys(KINDS) };
});
