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

  const REASON_TEXT = {
    not_recorded: "the store has no record of this",
    not_recorded_yet: "not recorded yet",
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
  };

  function reasonText(code) {
    return Object.prototype.hasOwnProperty.call(REASON_TEXT, code) ? REASON_TEXT[code] : String(code).replace(/_/g, " ");
  }

  const KINDS = {
    duration(v) {
      const x = Math.max(0, v);
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
        ? `${number.n} of ${number.N} ${number.of}`
        : null;
    if (number.state === "unavailable") {
      return { state: "unavailable", text: "no data", marker: null, reason, nofn };
    }
    if (typeof number.value !== "number" && typeof number.value !== "string") {
      throw new TypeError("FactoryFormat: a " + number.state + " number needs a value");
    }
    if (typeof number.value === "number" && !Number.isFinite(number.value)) {
      throw new TypeError("FactoryFormat: non-finite value");
    }
    const body = KINDS[kind](number.value);
    if (number.state === "measured") return { state: "measured", text: body, marker: null, reason: "", nofn };
    const sign = number.bound === "lower" ? "≥ " : number.bound === "upper" ? "≤ " : "";
    return { state: "partial", text: sign + body, marker: "partial", reason, nofn };
  }

  // The same, as one line of text, for tooltips and labels.
  function toText(number, kind) {
    const d = describe(number, kind);
    let s = d.text;
    if (d.state === "partial") s += ` (partial: ${d.reason})`;
    if (d.state === "unavailable") s += ` (${d.reason})`;
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
      const flag = doc.createElement("span");
      flag.className = "num-flag";
      flag.textContent = d.marker;
      const sr = doc.createElement("span");
      sr.className = "sr-only";
      sr.textContent = `: ${d.reason}`;
      flag.appendChild(sr);
      wrap.appendChild(flag);
    } else if (d.state === "unavailable") {
      wrap.title = `No data: ${d.reason}`;
      const why = doc.createElement("span");
      why.className = "num-reason";
      why.textContent = `(${d.reason})`;
      wrap.appendChild(why);
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
  // update it, so the browser also judges the build stamp against the
  // published threshold: a stuck site looks stale by itself.
  function pageVerdict(health, nowMs) {
    if (!health || typeof health !== "object" || !health.verdict) {
      return { status: "broken", reason: "the health record could not be loaded", ageHours: null };
    }
    const built = Date.parse(health.built_at);
    if (!Number.isFinite(built)) {
      return { status: "broken", reason: "the build stamp could not be read", ageHours: null };
    }
    const ageHours = (nowMs - built) / 3600000;
    const limit = health.config && Number.isFinite(health.config.stale_after_hours) ? health.config.stale_after_hours : 36;
    if (health.verdict.status === "broken") return { ...health.verdict, ageHours };
    if (ageHours > limit) {
      const age = ageHours >= 48 ? `${Math.floor(ageHours / 24)} days` : `${Math.floor(ageHours)} hours`;
      return { status: "stale", reason: `the site was last built ${age} ago; it is meant to rebuild at least every ${limit} hours`, ageHours };
    }
    return { ...health.verdict, ageHours };
  }

  return { describe, toText, render, reasonText, pageVerdict, KINDS: Object.keys(KINDS) };
});
