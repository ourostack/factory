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
    signoff_unverified: "the acceptance was not witnessed by a human prompt",
    no_delivered_jobs: "no job with a sign-off record has been delivered yet",
    no_refusals: "no delivery has been sent back",
    no_labels: "no job is labeled for waste yet",
    not_all_labeled: "not every finished job is labeled for waste",
    active_time_unavailable: "a job's active time could not be measured",
    catch_point_not_recorded: "some defect time has no recorded catch point",
    no_finished_jobs: "no job has finished",
    none_unsigned: "no delivery is waiting for sign-off",
    waits_incomplete: "some unsigned deliveries have no recorded wait",
    refusal_unverified: "some refusals were not witnessed, so the disagreement is at least this",
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
    // An unknown direction is said in the visible marker too, so a reader
    // does not have to hover to learn the figure could be off either way.
    return {
      state: "partial",
      text: direction + body,
      // An unverified host is said as such, visibly, not only in the reason.
      marker: `${Array.isArray(number.reasons) && number.reasons.includes("unverified_host") ? "unverified" : "partial"}${unknownDirection ? `, ${UNKNOWN_DIRECTION}` : ""}`,
      reason: unknownDirection ? `${reason}; which way the true figure lies is not known` : reason,
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
      if (!(opts && opts.flag === false)) {
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
      why.className = "num-reason";
      why.textContent = `(${d.reason})`;
      wrap.appendChild(why);
    }
    if (d.basis) {
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
  // request, issue or workflow run. Anything else is shown as text.
  const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(pull|issues|actions\/runs)\/\d+$/;
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

  return { recordsWords, coverageWords, describe, toText, render, reasonText, hasReasonText, pageVerdict, safeGithubUrl, safeAnchor, caption, CAPTION_SECTIONS: Object.keys(CAPTIONS), STALE_AFTER_HOURS, REQUIRED_EVIDENCE, KINDS: Object.keys(KINDS) };
});
