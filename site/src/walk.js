// Step 1 of the walk, "Follow a task", as plain data: the lede's sentences,
// the value stream map's boxes and triangles, the timeline ladder, the task
// picker, the session swimlane's lanes and marks, the evidence drawer and the
// prompt an agent can be handed. The page (app.js) only draws what these
// functions return, so every rule here is tested in Node.
//
// Every number reaches these functions as a stated number { state, value?,
// reasons } from Desk's rollups/tasks.json and rollups/stackup.json, or as
// plain milliseconds from a task's map file (map/<job>.json, derived by the
// Pages build from jobs/<job>.json) and its swimlane files
// (jobs/<job>/<session>.json). No date is ever read or written: every time
// is an offset on the task clock.
//
// Loaded as a plain script in the browser (global `FactoryWalk`) and
// required by the tests in Node.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FactoryWalk = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  // ------------------------------------------------------------ durations

  // A duration in words, for sentences: "under a second", "40 seconds",
  // "12 minutes", "4.3 hours", "54 hours" (hours up to three days), "4.5 days".
  function durationWords(ms) {
    const x = Math.max(0, Number(ms) || 0);
    // A true zero is "none"; only a positive time under a second is "under a second".
    if (x === 0) return "none";
    if (x < SECOND) return "under a second";
    if (x < MINUTE) {
      const s = Math.round(x / SECOND);
      return `${s} second${s === 1 ? "" : "s"}`;
    }
    if (x < HOUR) {
      const m = Math.round(x / MINUTE);
      return m === 60 ? "1 hour" : `${m} minute${m === 1 ? "" : "s"}`;
    }
    if (x < 72 * HOUR) {
      const h = x / HOUR;
      const t = h >= 10 ? String(Math.round(h)) : (Math.round(h * 10) / 10).toString();
      return `${t} hour${t === "1" ? "" : "s"}`;
    }
    const d = Math.round((x / DAY) * 10) / 10;
    return `${d} days`;
  }

  // A duration in a few characters, for labels on marks: "<1s", "40s",
  // "12m", "4.3h", "54h" (hours up to three days, as in durationWords), "4.5d".
  function durationShort(ms) {
    const x = Math.max(0, Number(ms) || 0);
    if (x === 0) return "0s";
    if (x < SECOND) return "<1s";
    if (x < MINUTE) return `${Math.round(x / SECOND)}s`;
    if (x < HOUR) return `${Math.round(x / MINUTE)}m`;
    if (x < 72 * HOUR) {
      const h = x / HOUR;
      return `${h >= 10 ? Math.round(h) : (Math.round(h * 10) / 10).toString()}h`;
    }
    return `${(Math.round((x / DAY) * 10) / 10).toString()}d`;
  }

  function pctWords(share) {
    const p = share * 100;
    if (p > 0 && p < 1) return "under 1%";
    return `${Math.round(p)}%`;
  }

  // -------------------------------------------------------------- words

  // What a wait waited on. The keys are Desk's `waited_on` values for gaps
  // (walk.js GAP_WAITED_ON) and for labeled waiting stretches (stretches.js
  // WAITED_ON). Waiting is a property of the system, so each says what the
  // system was doing, never who was slow.
  const WAITED_ON = {
    next_prompt: { short: "next prompt (the agent had stopped)", long: "the agent had stopped and was waiting for the operator's next prompt" },
    api_retry: { short: "API retry", long: "the agent was waiting on retries of a failed model request" },
    tool_failure: { short: "after a failed tool call", long: "the agent was waiting after a tool call failed" },
    long_tool_call: { short: "long tool call", long: "a tool call of five minutes or more was running" },
    queue_before_start: { short: "queued before the first session", long: "the task was waiting for its first session to start" },
    no_session: { short: "no session running", long: "no session of this task was running" },
    // A session of this task was running, but its agent was working on
    // another task (Desk's "other_task"; the other task is never named).
    other_task: { short: "agent on another task", long: "the agent was working on another task" },
    unknown: { short: "cause not recorded", long: "no agent was working on this task, and the cause was not recorded" },
    mixed: { short: "several causes", long: "several waits with different causes, folded together" },
  };
  function waitedOnWords(key, which) {
    const w = WAITED_ON[key] || WAITED_ON.unknown;
    return which === "long" ? w.long : w.short;
  }

  // An evidence interval's kind, in words (Desk's interval kinds).
  const KIND_WORDS = { turn: "agent turn", tool: "tool call", subagent: "subagent", human_wait: "waiting for the operator", api_retry: "API retry" };

  // A stretch the evaluator labeled waiting is an "evaluator-labeled pause":
  // on this page "waiting" means idle time only (lead time - working time),
  // and the evaluator's labels describe working time, so a pause it labeled
  // sits inside working time and has its own name.
  const LABELED_PAUSE = "Evaluator-labeled pause (inside working time)";
  function waitLabel(key) {
    const w = waitedOnWords(key || "unknown", "short");
    return `labeled pause: ${w.replace(/ \(the agent had stopped\)$/, "")}`;
  }
  // The name of a stretch's label in the swimlane and its drawer.
  function stretchWasteWords(waste) {
    return waste === "waiting" ? LABELED_PAUSE : WASTE_WORDS[waste] || "Could not classify";
  }

  const CLASS_WORDS = { value: "Value-adding", support: "Necessary", muda: "Waste", unlabeled: "Not labeled" };
  const WASTE_WORDS = {
    waiting: "Waiting",
    defects: "Defects",
    extra_processing: "Extra processing",
    overproduction: "Overproduction",
    motion: "Motion",
    transportation: "Transportation",
    inventory: "Inventory",
    non_utilized_talent: "Non-utilized talent",
    unknown: "Could not classify",
  };

  // A cause key from Desk's causes rollup (`waiting:<waited_on>`,
  // `defects:<tool kind>`, `<waste>:all`) in the page's words.
  function causeWords(key) {
    const [waste, what] = String(key).split(":");
    if (waste === "waiting") {
      return `Waiting · ${waitedOnWords(what, "short")}`;
    }
    if (waste === "defects" && what && what !== "all") return `Defects · failed ${what} calls`;
    return WASTE_WORDS[waste] || "Could not classify";
  }

  // The segment key a cause draws in (format.js SEGMENTS).
  function causeSegment(key) {
    const waste = String(key).split(":")[0];
    return Object.prototype.hasOwnProperty.call(WASTE_WORDS, waste) ? waste : "unknown";
  }

  // ------------------------------------------------------ stated numbers

  // A burst field may be a bare number (older Desk) or a stated number
  // { state, value?, reasons } (Desk after review: a figure with no source
  // reads unavailable, never 0). Both read as a stated number here.
  function stated(x) {
    if (typeof x === "number" && Number.isFinite(x)) return { state: "measured", value: x, reasons: [] };
    if (x && typeof x === "object" && (x.state === "measured" || x.state === "partial" || x.state === "unavailable")) {
      const v = typeof x.value === "number" && Number.isFinite(x.value) ? x.value : null;
      if (x.state !== "unavailable" && v === null) return { state: "unavailable", reasons: Array.isArray(x.reasons) ? x.reasons : ["not_recorded"] };
      if (x.state === "unavailable") return { state: "unavailable", reasons: Array.isArray(x.reasons) ? x.reasons : [] };
      const out = { state: x.state, value: v, reasons: Array.isArray(x.reasons) ? x.reasons : [] };
      if (x.state === "partial" && (x.bound === "lower" || x.bound === "upper" || x.bound === null)) out.bound = x.bound;
      if (x.state === "partial" && x.bound === null && typeof x.bound_reason === "string") out.bound_reason = x.bound_reason;
      return out;
    }
    return { state: "unavailable", reasons: ["not_recorded"] };
  }

  // The sum of stated numbers: measured only when every part is; a value
  // with some parts missing is a lower bound (partial); no value at all is
  // unavailable, with every reason kept.
  function sumStated(xs) {
    const parts = xs.map(stated);
    const reasons = [...new Set(parts.flatMap((x) => x.reasons))];
    const known = parts.filter((x) => x.state !== "unavailable");
    if (!parts.length) return { state: "measured", value: 0, reasons: [] };
    if (!known.length) return { state: "unavailable", reasons };
    const value = known.reduce((a, x) => a + x.value, 0);
    if (known.length === parts.length && known.every((x) => x.state === "measured")) return { state: "measured", value, reasons: [] };
    // Missing or lower-bound parts make the sum a lower bound; a part Desk
    // says could be off the other way, or in no known direction, leaves the
    // sum with no direction (bound: null), never a guessed one.
    const open = known.some((x) => x.state === "partial" && (x.bound === null || x.bound === "upper"));
    return { state: "partial", value, bound: open ? null : "lower", reasons };
  }

  // The largest of stated numbers, under the same rule.
  function maxStated(xs) {
    const s = sumStated(xs);
    if (s.state === "unavailable") return s;
    return { ...s, value: xs.map(stated).filter((x) => x.state !== "unavailable").reduce((a, x) => Math.max(a, x.value), 0) };
  }

  // "at least " or "at most " for a partial figure, following its bound; a
  // partial figure with no bound stated is a lower bound (a sum with parts
  // missing).
  const boundWords = (x) => (x.state !== "partial" ? "" : x.bound === "upper" ? "at most " : "at least ");

  // A stated count or duration in a few words: "12", "at least 12", "not
  // recorded" (or `none` for an unavailable figure, when given).
  function statedText(n, kind, none) {
    const x = stated(n);
    if (x.state === "unavailable") return none || "no data";
    const t = kind === "duration" ? durationShort(x.value) : x.value.toLocaleString("en-US");
    return `${boundWords(x)}${t}`;
  }
  function statedWords(n) {
    const x = stated(n);
    if (x.state === "unavailable") return null;
    return `${boundWords(x)}${durationWords(x.value)}`;
  }

  // Reasons that only say the task's window is open or starts at its first
  // session: within that window the figure is exact.
  const WINDOW_REASONS = new Set(["censored", "card_dates_shorter_than_work", "open_job", "labels_from_shared_session"]);

  // Which way a partial figure may be off: "lower" (the true value is at
  // least this), "upper" (at most this), "window" (exact within the task's
  // counted window), or null for a measured figure.
  // Desk's "no direction" for a partial figure (bound: null), with its
  // reason: "direction not known, because …". The lede says it only when
  // the figure could truly be off either way (its reasons pull both ways);
  // a figure no reason moves (bound_not_moved, such as working time inside
  // a card's window) reads as the plain figure, as it always has. The
  // figure's own reason text carries every bound_reason.
  function noDirectionWords(n, words) {
    return `direction not known, because ${words(n.bound_reason)}`;
  }
  const saysNoDirection = (n) => !!(n && n.bound === null && n.bound_reason && n.bound_reason !== "bound_not_moved");

  function boundOf(n) {
    if (!n || n.state !== "partial") return null;
    if (n.bound === "lower" || n.bound === "upper") return n.bound;
    // Desk states bound: null when it does not know which way a figure is
    // off; that is said as no direction, never guessed from its reasons.
    if (n.bound === null) return null;
    const rs = Array.isArray(n.reasons) ? n.reasons : [];
    return rs.length && rs.every((r) => WINDOW_REASONS.has(r)) ? "window" : "lower";
  }

  // --------------------------------------------------------------- the lede

  const val = (n) => (n && n.state !== "unavailable" && typeof n.value === "number" && Number.isFinite(n.value) ? n.value : null);
  const has = (n, code) => !!(n && Array.isArray(n.reasons) && n.reasons.includes(code));

  // ------------------------------------------------- waiting (idle time)

  // "Waiting" has one meaning everywhere on the page: idle time, the lead
  // time minus the working time, split by what it waited on. The evaluator's
  // labels (value-adding, necessary, each waste) describe working time only.
  // The causes, in the order the bar stacks them.
  const WAIT_KEYS = ["next_prompt", "other_task", "api_retry", "tool_failure", "long_tool_call", "queue_before_start", "no_session", "unknown"];

  // One gap's idle time by what it waited on. Desk after the "other task"
  // change states a per-gap split (`idle_by_waited_on_ms`, bare numbers or
  // stated numbers); it is used as given, scaled to fit the gap if it
  // overshoots, with any rest as "cause not recorded". Without it the whole
  // gap is its dominant cause (`waited_on`). Returns { key: ms }.
  function gapIdleBy(g) {
    const len = Math.max(0, (g && g.end_ms) - (g && g.start_ms)) || 0;
    const by = {};
    const src = g && g.idle_by_waited_on_ms;
    if (src && typeof src === "object" && !Array.isArray(src)) {
      for (const [k, x] of Object.entries(src)) {
        const v = typeof x === "number" ? (Number.isFinite(x) ? x : null) : x && x.state !== "unavailable" && typeof x.value === "number" && Number.isFinite(x.value) ? x.value : null;
        if (v === null || v <= 0) continue;
        const key = WAIT_KEYS.includes(k) ? k : "unknown";
        by[key] = (by[key] || 0) + v;
      }
      const named = Object.values(by).reduce((a, x) => a + x, 0);
      if (named > 0) {
        if (named > len) for (const k of Object.keys(by)) by[k] = (by[k] * len) / named;
        else if (len - named > 0) by.unknown = (by.unknown || 0) + (len - named);
        return by;
      }
    }
    if (len > 0) by[WAIT_KEYS.includes(g && g.waited_on) ? g.waited_on : "unknown"] = len;
    return by;
  }
  // The causes of a gap, largest first.
  const gapCauses = (g) => Object.entries(gapIdleBy(g)).sort((a, b) => b[1] - a[1] || WAIT_KEYS.indexOf(a[0]) - WAIT_KEYS.indexOf(b[0])).map(([k]) => k);

  // Which way the waiting figure may be off, from its lead and working
  // times: waiting = lead - working, so a working time that is a lower bound
  // makes the waiting an upper bound, and a lead time that is one makes it a
  // lower bound. Both at once leave no bound ("unknown").
  function idleBound(leadN, workN) {
    const flip = { lower: "upper", upper: "lower" };
    const lb = boundOf(leadN) === "window" ? null : boundOf(leadN);
    const wb = boundOf(workN) === "window" ? null : boundOf(workN);
    if (!lb && !wb) return null;
    if (!lb) return flip[wb];
    if (!wb) return lb;
    return lb === flip[wb] ? lb : "unknown";
  }

  // The idle time inside one burst (its span less its working time), by
  // what it waited on. Desk states it per burst as `idle_by_waited_on_ms`
  // (bare numbers or stated numbers); any rest, or all of it when Desk does
  // not state it, is "cause not recorded". Returns { key: ms }.
  function burstIdleBy(b) {
    const w = stated(b && b.working_ms);
    if (w.state === "unavailable") return {};
    const idle = Math.max(0, b.end_ms - b.start_ms - w.value);
    const by = {};
    const src = b && b.idle_by_waited_on_ms;
    if (src && typeof src === "object" && !Array.isArray(src)) {
      for (const [k, x] of Object.entries(src)) {
        const v = typeof x === "number" ? (Number.isFinite(x) ? x : null) : val(x);
        if (v === null || v <= 0) continue;
        const key = WAIT_KEYS.includes(k) ? k : "unknown";
        by[key] = (by[key] || 0) + v;
      }
    }
    const named = Object.values(by).reduce((a, x) => a + x, 0);
    // Never more idle time than the span leaves: a stated split that
    // overshoots is scaled to fit, so the box still sums to its span.
    if (named > idle && named > 0) for (const k of Object.keys(by)) by[k] = (by[k] * idle) / named;
    else if (idle - named > 0) by.unknown = (by.unknown || 0) + (idle - named);
    return by;
  }

  function slimCauses(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
    const out = {};
    for (const [k, n] of Object.entries(x)) {
      const v = typeof n === "number" ? (Number.isFinite(n) ? n : null) : val(n);
      if (v !== null && v > 0) out[k] = v;
    }
    return out;
  }

  // One task's waiting, split by cause. From Desk's task row when it states
  // `idle_ms` (Desk after the fix round of #229, with
  // `waiting_by_waited_on_ms` split over idle time); otherwise derived from
  // the task's map file: each gap by what it waited on, and the idle moments
  // inside bursts (a burst's span less its working time) as "cause not
  // recorded". Bursts and gaps tile the lead window, so the split sums to
  // lead - working. Returns { state, value, bound, reasons, by: [{ key, ms }],
  // source } with `by` largest first.
  function idleSplit(row, map) {
    const leadN = row && row.lead_time_ms;
    const workN = row && row.working_ms;
    const bound = idleBound(leadN, workN);
    const reasons = [...new Set([...((leadN && leadN.reasons) || []), ...((workN && workN.reasons) || [])])];
    const out = (value, by, source, st) => {
      const list = Object.entries(by)
        .map(([key, ms]) => ({ key, ms }))
        .filter((x) => x.ms > 0)
        .sort((a, b) => b.ms - a.ms || WAIT_KEYS.indexOf(a.key) - WAIT_KEYS.indexOf(b.key));
      const state = st || (bound || (leadN && leadN.state === "partial") || (workN && workN.state === "partial") ? "partial" : "measured");
      return { state, value, bound: state === "partial" ? bound : null, reasons: state === "measured" ? [] : reasons, by: list, source };
    };
    if (row && row.idle_ms) {
      const n = stated(row.idle_ms);
      if (n.state === "unavailable") return { state: "unavailable", reasons: n.reasons, by: [], source: "rollup" };
      const by = {};
      for (const [k, x] of Object.entries(row.waiting_by_waited_on_ms || {})) {
        const v = val(x);
        if (v !== null) by[k] = (by[k] || 0) + v;
      }
      const named = Object.values(by).reduce((a, x) => a + x, 0);
      if (n.value - named > SECOND) by.unknown = (by.unknown || 0) + (n.value - named);
      const r = out(n.value, by, "rollup", n.state);
      if (n.state === "partial") {
        r.bound = n.bound === null ? null : n.bound || bound || "lower";
        if (n.bound === null && n.bound_reason) r.bound_reason = n.bound_reason;
        r.reasons = n.reasons;
      }
      return r;
    }
    const lead = val(leadN);
    const work = val(workN);
    if (lead === null || work === null) return { state: "unavailable", reasons: lead === null ? (leadN && leadN.reasons) || [] : (workN && workN.reasons) || [], by: [], source: "none" };
    const listOf = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : []);
    const bursts = listOf(map && map.bursts);
    const gaps = listOf(map && map.gaps);
    if (!map || (!bursts.length && !gaps.length)) return out(Math.max(0, lead - work), { unknown: Math.max(0, lead - work) }, "rollup_total");
    const by = {};
    for (const g of gaps) for (const [k, ms] of Object.entries(gapIdleBy(g))) by[k] = (by[k] || 0) + ms;
    for (const b of bursts) for (const [k, ms] of Object.entries(burstIdleBy(b))) by[k] = (by[k] || 0) + ms;
    const total = Object.values(by).reduce((a, x) => a + x, 0);
    const r = out(total, by, "map");
    r.gap_split = gaps.some((g) => g && g.idle_by_waited_on_ms && typeof g.idle_by_waited_on_ms === "object");
    r.burst_causes = bursts.some((b) => b && b.idle_by_waited_on_ms && typeof b.idle_by_waited_on_ms === "object");
    return r;
  }

  // The lede for one task (design section 4): one paragraph, built from the
  // task's row in rollups/tasks.json, with one template per number state.
  // Returns { state, parts }: `parts` is a list of strings and number tokens
  // { key, text }; the page turns each token into a button that highlights
  // its part of the map. `reasonText` turns a reason code into words.
  // `opts.idle` is the task's waiting split (idleSplit), so the lede, the
  // map and the bar state one waiting figure.
  //   state "absent"  the walk's data is not published at all
  //   state "no_row"  it is published, but this task has no row in it
  //   state "ok"      the paragraph
  function lede(row, reasonText, opts) {
    const o = opts || {};
    const words = typeof reasonText === "function" ? reasonText : (c) => String(c).replace(/_/g, " ");
    const reasons = (n) => (n && Array.isArray(n.reasons) && n.reasons.length ? n.reasons.map(words).join("; ") : "it was not recorded");
    if (o.published === false) {
      return { state: "absent", parts: ["The walk's data for this task is not published yet, so this view cannot say where its time went. No figure is shown rather than a zero."] };
    }
    if (!row) {
      return { state: "no_row", parts: ["This task has no row in the walk's data, so this view cannot say where its time went. No figure is shown rather than a zero."] };
    }
    const parts = [];
    const add = (...xs) => parts.push(...xs);
    const tok = (key, text, extra) => ({ key, text, ...(extra || {}) });

    const lead = val(row.lead_time_ms);
    const leadW = lead === null ? null : durationWords(lead);
    const open = has(row.lead_time_ms, "censored");
    const fromFirst = has(row.lead_time_ms, "card_dates_shorter_than_work");

    // 1. Lead time.
    if (lead === null) {
      add(`This task's lead time is not measured, because ${reasons(row.lead_time_ms)}. So this view cannot say how much of its time was waiting.`);
    } else if (row.lead_time_ms.state === "measured") {
      add("This task took ", tok("lead", leadW), " from the creation of its card (its record on the desk) to its end.");
    } else if (open) {
      add("This task is still open. So far it has taken at least ", tok("lead", leadW, { q: "at least " }), fromFirst ? ", counted from its first session because its card (its record on the desk) was created after work began." : ".");
    } else if (fromFirst) {
      add("This task took at least ", tok("lead", leadW, { q: "at least " }), ", counted from its first session because its card (its record on the desk) was created after work began.");
    } else {
      add("This task took ", tok("lead", leadW), `, a partial figure: ${reasons(row.lead_time_ms)}.`);
    }

    // 2. Working time, with its own state, and how much of it the evaluator
    // judged value-adding.
    const working = val(row.working_ms);
    const value = val(row.value_in_working_ms);
    const wb = boundOf(row.working_ms);
    if (working === null) {
      add(` How long agents were working is not measured, because ${reasons(row.working_ms)}.`);
    } else {
      const q = wb === "lower" ? "at least " : wb === "upper" ? "at most " : open && row.working_ms.bound !== null ? "at least " : "";
      add(` Agents were working for ${q}`, tok("working", durationWords(working), { q }), lead === null ? "" : " of it");
      // Only the reasons that make it a bound are given here; a shared
      // session's labels are said once, below.
      if (saysNoDirection(row.working_ms)) add(` (${noDirectionWords(row.working_ms, words)})`);
      if (wb === "lower" || wb === "upper") {
        const why = (row.working_ms.reasons || []).filter((r) => !WINDOW_REASONS.has(r));
        add(` (${wb === "lower" ? "a lower bound" : "an upper bound"}: ${why.length ? why.map(words).join("; ") : reasons(row.working_ms)})`);
      }
      if (value === null) {
        const why = reasons(row.value_in_working_ms);
        // "not labeled yet (not labeled)" says nothing twice.
        add(/not labeled/i.test(why) ? "; that work is not labeled yet, so how much of it added value is not known." : `; that work is not labeled yet (${why}), so how much of it added value is not known.`);
      } else if (value === 0) {
        add("; the evaluator (an independent agent that labels the work) judged ", tok("value", "none"), " of that work value-adding: all of it was necessary steps, rework, or work not labeled.");
        if (row.labels_from_shared_session) add(" Those labels come from a session this task shared with other tasks, so that split is partial.");
      } else {
        const vb = boundOf(row.value_in_working_ms);
        const vq = vb === "lower" ? "at least " : vb === "upper" ? "at most " : "";
        add(`; the evaluator (an independent agent that labels the work) judged ${vq}`, tok("value", durationWords(value), { q: vq }), " of that work value-adding, and the rest necessary steps, rework, or work not labeled.");
        if (row.labels_from_shared_session) add(" Those labels come from a session this task shared with other tasks, so that split is partial.");
      }
      // More than half the working time carries no label: say so, so a
      // small value-adding figure is not read as the whole story.
      const unl = typeof o.unlabeled_ms === "number" && Number.isFinite(o.unlabeled_ms) ? o.unlabeled_ms : null;
      if (value !== null && unl !== null && working > 0 && unl > 0.5 * working) add(` More than half of that working time, ${durationWords(unl)} (${pctWords(unl / working)} of the working time), carries no label from the evaluator, so what it was is not known yet.`);
    }

    // 3. Waiting: idle time, in system terms. One sentence when one cause
    // covers (nearly) all of it; otherwise the total, then its largest part.
    const idle = o.idle || idleSplit(row, null);
    if (lead !== null && lead > 0 && working !== null && idle.state !== "unavailable") {
      const waiting = idle.value;
      const q = idle.bound === "upper" ? "at most " : idle.bound === "lower" ? "at least " : idle.bound === "unknown" ? "about " : "";
      const tail = idle.bound === "unknown" ? " (both the lead time and the working time are partial, so this is not bounded)" : saysNoDirection(idle) ? ` (${noDirectionWords(idle, words)})` : "";
      const by = idle.by.filter((x) => x.ms > 0);
      const top = by[0];
      const most = waiting / lead >= 0.5;
      if (waiting <= 0) add(" None of it was waiting: agents were working from start to end.");
      else if (top && top.ms >= 0.95 * waiting) {
        const why = waitedOnWords(top.key, "long");
        // "All of it" only when it is all of it; 95-99% reads "nearly all".
        const all = waiting - top.ms <= SECOND;
        const share = `nearly all of it (${Math.min(99, Math.floor((top.ms / waiting) * 100))}% of the waiting)`;
        if (most && all) add(` Most of the ${leadW} was waiting, not work: for ${q}`, tok("waiting", durationWords(waiting), { q }), ` ${why}${tail}.`);
        else if (most) add(` Most of the ${leadW} was waiting, not work: ${q}`, tok("waiting", durationWords(waiting), { q }), `${tail}, ${share} while ${why}.`);
        else add(` Of the ${leadW}, ${q}`, tok("waiting", durationWords(waiting), { q }), ` was waiting${tail}, ${all ? "all of it" : share} while ${why}.`);
      } else {
        if (most) add(` Most of the ${leadW} was waiting, not work: ${q}`, tok("waiting", durationWords(waiting), { q }), ` in all${tail}.`);
        else add(` Of the ${leadW}, ${q}`, tok("waiting", durationWords(waiting), { q }), ` was waiting${tail}.`);
        if (top) {
          add(" The largest part, ", tok("wait_cause", durationWords(top.ms), { cause: top.key }), `, was while ${waitedOnWords(top.key, "long")}.`);
          const unknown = by.find((x) => x.key === "unknown");
          if (unknown && top.key !== "unknown") add(` What ${durationWords(unknown.ms)} of it waited on was not recorded.`);
        }
      }
      const gap = row.longest_gap && row.longest_gap.state !== "unavailable" ? row.longest_gap.value : null;
      if (waiting > 0 && gap && typeof gap.duration_ms === "number" && gap.duration_ms > 0) {
        const same = top && top.key === gap.waited_on;
        add(" The longest single wait was ", tok("longest", durationWords(gap.duration_ms)), same ? `, also ${ALSO[gap.waited_on] || "with its cause not recorded"}.` : `, when ${waitedOnWords(gap.waited_on, "long")}.`);
      }
    }

    // 4. Flow efficiency, defined in place.
    const fe = val(row.flow_efficiency);
    if (fe === null) {
      add(` In Lean, working time divided by lead time is called flow efficiency; it is not measured for this task, because ${reasons(row.flow_efficiency)}.`);
    } else {
      const feText = feWords(row);
      add(" In Lean, working time divided by lead time is called ", { key: "fe_term", text: "flow efficiency", term: true }, "; here it is ", tok("fe", feText), ".");
      // Said only where it helps: below one half.
      if (fe < 0.5) add(" A low number is normal: most of any process's lead time is waiting, not work. That is why Lean starts here.");
    }
    return { state: "ok", parts };
  }

  // A task's flow efficiency in words, with its bound: the lede and the
  // picker both use this, so they never disagree. Desk's own bound comes
  // first; otherwise it follows from the lead time's and working time's.
  function feWords(row) {
    const n = row && row.flow_efficiency;
    const fe = val(n);
    if (fe === null) return null;
    const t = pctWords(fe);
    if (n.state !== "partial") return t;
    if (n.bound === "upper") return `at most ${t}`;
    if (n.bound === "lower") return `at least ${t}`;
    // Desk's bound: null is no direction; only an absent key (older data)
    // falls back to the site's own rule below.
    if (n.bound === null) return `${t} (partial, direction not known)`;
    const wb = boundOf(row.working_ms);
    if (has(row.lead_time_ms, "censored")) return `${t} so far`;
    if (has(row.lead_time_ms, "card_dates_shorter_than_work") && wb !== "lower") return `at most ${t}`;
    if (wb === "lower" && row.lead_time_ms && row.lead_time_ms.state === "measured") return `at least ${t}`;
    return `${t} (partial)`;
  }

  // The bar's partial note: why its parts are partial, without each reason's
  // own "so this is a lower bound" (which is not true of every group), then
  // each group's bound as the group heads state it.
  function barPartialNote(reasonTexts, groups) {
    const why = [...new Set((reasonTexts || []).map((t) => String(t).replace(/,? so (this|the figure|the count) is (a|an) (lower|upper) bound$/, "")))].filter(Boolean);
    const dir = { "at least ": "a lower bound", "at most ": "an upper bound", "about ": "not bounded" };
    const bounds = (groups || []).filter((g) => dir[g.qualifier]).map((g) => `${g.label.toLowerCase()} time is ${dir[g.qualifier]}`);
    const first = `Partial: ${why.join("; ") || "some parts are partial"}.`;
    return bounds.length ? `${first} So ${bounds.join(", and ")}.` : first;
  }

  // The longest wait "also" shares the largest cause.
  const ALSO = {
    next_prompt: "for the next prompt",
    api_retry: "on API retries",
    tool_failure: "after a failed tool call",
    long_tool_call: "during a long tool call",
    queue_before_start: "before the first session",
    no_session: "with no session running",
    other_task: "while the agent was on another task",
    unknown: "with its cause not recorded",
  };

  // The lede as one string (for tests, titles and screen readers).
  function ledeText(model) {
    return model.parts.map((p) => (typeof p === "string" ? p : p.text)).join("");
  }

  // --------------------------------------------------- the value stream map

  // The thresholds the map may fold short waits under, smallest first.
  const FOLD_STEPS = [0, MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 16 * HOUR, DAY, 2 * DAY, 4 * DAY, 8 * DAY, Infinity];

  // Builds the map's items for one fold threshold. Bursts and gaps tile the
  // task's lead window. A gap shorter than `fold` that sits beside a burst is
  // folded into that burst's box (into the box before it, or, before the
  // first burst, the box after it); bursts with only folded gaps between
  // them share one box. Every other gap is a wait (an inventory triangle);
  // gaps with no burst between them share one wait.
  function buildItems(burstsIn, gapsIn, fold) {
    // Each burst and gap keeps its 1-based number in clock order, so an item
    // can be named the same way at any fold ("bursts 4-6", "gap 3").
    const bursts = [...burstsIn].sort((a, b) => a.start_ms - b.start_ms).map((b, i) => ({ ...b, n: i + 1 }));
    const gaps = [...gapsIn].sort((a, b) => a.start_ms - b.start_ms).map((g, i) => ({ ...g, n: i + 1 }));
    const seq = [...bursts.map((b) => ({ kind: "burst", b })), ...gaps.map((g) => ({ kind: "gap", g }))].sort((x, y) => {
      const a = x.kind === "burst" ? x.b.start_ms : x.g.start_ms;
      const b = y.kind === "burst" ? y.b.start_ms : y.g.start_ms;
      return a - b || (x.kind === "gap" ? -1 : 1);
    });
    const hasBurst = bursts.length > 0;
    const items = [];
    let pending = []; // short gaps waiting for the next box
    const last = () => items[items.length - 1];
    const burstAfter = (i) => seq.slice(i + 1).some((x) => x.kind === "burst");
    const toWait = (gs) => {
      if (!gs.length) return;
      if (last() && last().type === "wait") last().gaps.push(...gs);
      else items.push({ type: "wait", gaps: [...gs] });
    };
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i];
      if (s.kind === "burst") {
        // With no fold, every burst is its own box; with a fold, bursts with
        // nothing but folded time between them share one.
        if (fold > 0 && !pending.length && last() && last().type === "box") last().bursts.push(s.b);
        else if (fold > 0 && pending.length && last() && last().type === "box") {
          last().folded.push(...pending);
          last().bursts.push(s.b);
        } else items.push({ type: "box", bursts: [s.b], folded: pending });
        pending = [];
        continue;
      }
      const g = s.g;
      const short = hasBurst && g.end_ms - g.start_ms < fold;
      if (short && last() && last().type === "box") last().folded.push(g);
      else if (short && burstAfter(i)) pending.push(g);
      else {
        toWait([...pending, g]);
        pending = [];
      }
    }
    toWait(pending);
    return items.map(finishItem);
  }

  function finishItem(it) {
    if (it.type === "wait") {
      const gaps = [...it.gaps].sort((a, b) => a.start_ms - b.start_ms);
      const duration = gaps.reduce((a, g) => a + (g.end_ms - g.start_ms), 0);
      // What the wait's time waited on: each gap's own split when Desk
      // states one, else its dominant cause.
      const by = {};
      for (const g of gaps) for (const [k, ms] of Object.entries(gapIdleBy(g))) by[k] = (by[k] || 0) + ms;
      const causes = Object.keys(by).sort((a, b) => by[b] - by[a] || WAIT_KEYS.indexOf(a) - WAIT_KEYS.indexOf(b));
      if (!causes.length) causes.push(gaps[0].waited_on || "unknown");
      const longest = gaps.reduce((a, g) => (!a || g.end_ms - g.start_ms > a.end_ms - a.start_ms ? g : a), null);
      return {
        type: "wait",
        gaps,
        count: gaps.length,
        start_ms: gaps[0].start_ms,
        end_ms: gaps[gaps.length - 1].end_ms,
        duration_ms: duration,
        waited_on: causes.length === 1 ? causes[0] : "mixed",
        causes,
        by,
        gap_range: [gaps[0].n, gaps[gaps.length - 1].n],
        longest_ms: longest ? longest.end_ms - longest.start_ms : 0,
      };
    }
    const bs = [...it.bursts].sort((a, b) => a.start_ms - b.start_ms);
    const folded = [...it.folded].sort((a, b) => a.start_ms - b.start_ms);
    const sum = (k) => sumStated(bs.map((b) => b[k]));
    const span = bs.reduce((a, b) => a + (b.end_ms - b.start_ms), 0);
    const foldedMs = folded.reduce((a, g) => a + (g.end_ms - g.start_ms), 0);
    // Working time draws the ladder, so it is a plain number; a burst whose
    // working time is not stated counts its span, and the box says so.
    const workingStated = sum("working_ms");
    const working = bs.reduce((a, b) => {
      const w = stated(b.working_ms);
      return a + (w.state === "unavailable" ? b.end_ms - b.start_ms : w.value);
    }, 0);
    // What the idle time inside the box waited on: its folded gaps, and the
    // idle moments inside its bursts as Desk states them per burst.
    const innerBy = {};
    for (const g of folded) for (const [k, ms] of Object.entries(gapIdleBy(g))) innerBy[k] = (innerBy[k] || 0) + ms;
    for (const b of bs) for (const [k, ms] of Object.entries(burstIdleBy(b))) innerBy[k] = (innerBy[k] || 0) + ms;
    for (const k of Object.keys(innerBy)) if (!(innerBy[k] > 0)) delete innerBy[k];
    const starts = [...bs.map((b) => b.start_ms), ...folded.map((g) => g.start_ms)];
    const ends = [...bs.map((b) => b.end_ms), ...folded.map((g) => g.end_ms)];
    return {
      type: "box",
      bursts: bs,
      folded,
      count: bs.length,
      start_ms: Math.min(...starts),
      end_ms: Math.max(...ends),
      working_ms: working,
      working_state: workingStated,
      // Idle time inside the box: folded gaps, and idle moments inside a
      // burst (a burst's span can exceed its working time).
      inner_wait_ms: foldedMs + (span - working),
      inner_causes: Object.keys(innerBy).sort((a, b) => innerBy[b] - innerBy[a] || WAIT_KEYS.indexOf(a) - WAIT_KEYS.indexOf(b)),
      inner_by: innerBy,
      folded_count: folded.length,
      burst_range: [bs[0].n, bs[bs.length - 1].n],
      // Counts and labeled times as stated numbers: a part with no source
      // stays "no data", never 0.
      agents: maxStated(bs.map((b) => b.agents)),
      tool_calls: sum("tool_calls"),
      tool_failures: sum("tool_failures"),
      operator_turns: sum("operator_turns"),
      value_ms: sum("value_ms"),
      defect_ms: sum("defect_ms"),
      defect_stretches: sum("defect_stretches"),
      sessions: [...new Set(bs.flatMap((b) => (Array.isArray(b.sessions) ? b.sessions : [])))],
    };
  }

  // The value stream map for one task: its boxes and waits, folding short
  // waits until at most `maxBoxes` boxes remain (design: "group consecutive
  // short bursts and gaps under a stated threshold"). The fold never loses
  // time: working + inner waits + waits equals the lead window, which the
  // tests check. Returns { fold_ms, items, totals }.
  //
  // `opts.jobStates` carries the job-level states the bursts' own counts
  // cannot know: { operator_turns, labels }, each a stated number or null.
  // An unavailable job-level figure makes every box's figure unavailable
  // (never a 0); a partial one makes a box's count a lower bound.
  function mapModel(map, opts) {
    const o = opts || {};
    const maxBoxes = Math.max(1, o.maxBoxes || 7);
    const listOf = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : []);
    const bursts = listOf(map && map.bursts);
    const gaps = listOf(map && map.gaps);
    let chosen = null;
    for (const fold of FOLD_STEPS) {
      const items = buildItems(bursts, gaps, fold);
      chosen = { fold_ms: fold, items };
      if (items.filter((x) => x.type === "box").length <= maxBoxes) break;
    }
    const items = chosen ? chosen.items : [];
    const boxes = items.filter((x) => x.type === "box");
    const waits = items.filter((x) => x.type === "wait");
    const working = boxes.reduce((a, b) => a + b.working_ms, 0);
    const inner = boxes.reduce((a, b) => a + b.inner_wait_ms, 0);
    const waiting = waits.reduce((a, w) => a + w.duration_ms, 0);
    // Number each box's sessions against the task's sessions, in clock order.
    const sessionOrder = (Array.isArray(map && map.sessions) ? [...map.sessions] : []).sort((a, b) => (a.offset_ms || 0) - (b.offset_ms || 0)).map((s) => s.id);
    for (const b of boxes) {
      b.session_numbers = b.sessions.map((id) => sessionOrder.indexOf(id) + 1).filter((n) => n > 0).sort((x, y) => x - y);
    }
    items.forEach((it, i) => (it.index = i));
    boxes.forEach((b, i) => (b.box_no = i + 1));
    waits.forEach((w, i) => (w.wait_no = i + 1));
    const js = o.jobStates || {};
    const cap = (x, env) => {
      if (!env || env.state === "measured") return x;
      if (env.state === "unavailable") return { state: "unavailable", reasons: env.reasons || [] };
      // The task-wide figure's direction carries over: Desk's own bound when
      // it states one (null is no direction), else lower (older data).
      const bound = Object.prototype.hasOwnProperty.call(env, "bound") ? env.bound : "lower";
      return x.state === "unavailable" ? x : { state: "partial", value: x.value, bound, reasons: [...new Set([...(x.reasons || []), ...(env.reasons || [])])] };
    };
    for (const b of boxes) {
      b.operator_turns = cap(b.operator_turns, js.operator_turns && stated(js.operator_turns));
      const lab = js.labels && stated(js.labels);
      if (lab && lab.state === "unavailable") for (const k of ["value_ms", "defect_ms", "defect_stretches"]) b[k] = { state: "unavailable", reasons: lab.reasons };
    }
    return {
      fold_ms: chosen ? chosen.fold_ms : 0,
      items,
      session_count: sessionOrder.length,
      box_count: boxes.length,
      totals: { working_ms: working, inner_wait_ms: inner, waiting_ms: waiting, lead_ms: working + inner + waiting, bursts: bursts.length, gaps: gaps.length },
    };
  }

  // "session 2 of 3", "sessions 1-2 of 3".
  function sessionWords(numbers, total) {
    if (!numbers || !numbers.length || !total) return "session not placed";
    if (numbers.length === 1) return `session ${numbers[0]} of ${total}`;
    const contiguous = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
    return contiguous ? `sessions ${numbers[0]}–${numbers[numbers.length - 1]} of ${total}` : `sessions ${numbers.join(", ")} of ${total}`;
  }

  // The rows of a box's data box, in the design's fixed order.
  function dataBox(box, sessionCount) {
    const ws = box.working_state ? stated(box.working_state) : { state: "measured" };
    return [
      { key: "working", label: "Working time", text: ws.state === "measured" ? durationShort(box.working_ms) : ws.state === "partial" ? `at least ${durationShort(box.working_ms)}` : `${durationShort(box.working_ms)} (span)` },
      { key: "agents", label: "Agents", text: statedText(box.agents) },
      { key: "tool_calls", label: "Tool calls", text: statedText(box.tool_calls) },
      { key: "tool_failures", label: "Failed tool calls", text: statedText(box.tool_failures) },
      { key: "operator_turns", label: "Operator turns", text: statedText(box.operator_turns, null, "not recorded") },
      { key: "session", label: "Session", text: sessionWords(box.session_numbers, sessionCount) },
    ];
  }

  // A box's rework loop label, or null when it has no defect stretches (or
  // none is known: an unlabeled box draws no loop rather than a zero).
  function reworkWords(box) {
    const n = stated(box.defect_stretches);
    if (n.state === "unavailable" || !n.value) return null;
    // "at least" is said once, on the count.
    const dm = stated(box.defect_ms);
    const d = dm.state === "unavailable" ? null : durationWords(dm.value);
    return `${n.state === "partial" ? "at least " : ""}${n.value} defect stretch${n.value === 1 ? "" : "es"}${d ? `, ${d}` : ""}`;
  }

  // A box's title: what it is, in plain words.
  function boxTitle(box) {
    return box.count === 1 ? "Work burst" : `${box.count} work bursts`;
  }

  // A wait's label: duration and what it waited on.
  function waitTitle(w) {
    return w.count === 1 ? waitedOnWords(w.waited_on, "short") : `${w.count} waits: ${w.waited_on === "mixed" ? "several causes" : waitedOnWords(w.waited_on, "short")}`;
  }

  // The fold, in one sentence for the map's caption.
  function foldWords(model) {
    if (!model.fold_ms) return "Every work burst has its own box and every wait its own triangle.";
    if (model.fold_ms === Infinity) return "All work is folded into one box, so the map stays legible; its data box says how many bursts it holds.";
    return `Waits shorter than ${durationWords(model.fold_ms)} are folded into the box beside them, so the map stays legible; each box says how many bursts it holds, and the ladder shows the folded waits beside its working time.`;
  }

  // The timeline ladder: one segment per item. A box is low (working) with
  // its folded waits as a small high step after it; a wait is high. The
  // segments sum to the lead window.
  function ladder(model) {
    const segs = [];
    for (const it of model.items) {
      if (it.type === "box") {
        segs.push({ level: "low", ms: it.working_ms, item: it.index, label: durationShort(it.working_ms) });
        if (it.inner_wait_ms > 0) segs.push({ level: "high", ms: it.inner_wait_ms, item: it.index, folded: true, causes: it.inner_causes, label: `+${durationShort(it.inner_wait_ms)}` });
      } else segs.push({ level: "high", ms: it.duration_ms, item: it.index, causes: it.causes, label: durationShort(it.duration_ms) });
    }
    return segs;
  }

  // Card status changes, each placed over the map item whose time it falls
  // in. Transitions carry their own time; the status observed last is added
  // at the end when no transition already says it.
  function statusMarks(map, model) {
    const items = model.items;
    const at = (ms) => {
      if (typeof ms !== "number" || !items.length) return items.length ? items.length - 1 : 0;
      const i = items.findIndex((it) => ms >= it.start_ms && ms <= it.end_ms);
      if (i >= 0) return i;
      return ms < items[0].start_ms ? 0 : items.length - 1;
    };
    const marks = (Array.isArray(map && map.transitions) ? map.transitions : [])
      .filter((t) => t && typeof t.to === "string")
      .sort((a, b) => (a.offset_ms || 0) - (b.offset_ms || 0))
      .map((t) => ({ status: t.to, item: at(t.offset_ms), observed: false }));
    const obs = (Array.isArray(map && map.observations) ? map.observations : []).filter((o) => o && typeof o.status === "string");
    const lastObs = obs[obs.length - 1];
    if (lastObs && (!marks.length || marks[marks.length - 1].status !== lastObs.status)) {
      marks.push({ status: lastObs.status, item: typeof lastObs.offset_ms === "number" ? at(lastObs.offset_ms) : items.length - 1, observed: true });
    }
    return marks;
  }

  // --------------------------------------------- where this task's time went

  // One task's stacked bar in two groups that sum to its lead time:
  //   Working, split by the evaluator's labels (format.js SEGMENTS, without
  //     waiting and no session running, which are idle time), with the rest
  //     of the working time "not labeled yet";
  //   Waiting, split by what it waited on (idleSplit), in WAIT_KEYS order.
  // `stackRow` is the task's rollups/stackup.json row, `taskRow` its
  // rollups/tasks.json row. Returns { state, total_ms, groups, segments,
  // partial, notes }; zero parts are left out of the drawing.
  function timeBar(stackRow, taskRow, idle, segments) {
    if (!stackRow && !taskRow) return { state: "absent", groups: [], segments: [] };
    const leadN = (taskRow && taskRow.lead_time_ms) || (stackRow && stackRow.lead_time_ms);
    const lead = val(leadN);
    if (lead === null) return { state: "unavailable", groups: [], segments: [], reasons: (leadN && leadN.reasons) || [] };
    const workN = (taskRow && taskRow.working_ms) || (stackRow && stackRow.working_ms);
    const working = val(workN);
    // Desk's stack-up rows with working and idle parts (after #229's second
    // fix round) carry their own idle split; it stands in when the task row
    // gives none.
    if ((!idle || idle.state === "unavailable") && stackRow && stackRow.idle_ms && working !== null) {
      idle = idleSplit({ lead_time_ms: leadN, working_ms: workN, idle_ms: stackRow.idle_ms, waiting_by_waited_on_ms: stackRow.idle || {} }, null);
    }
    // The lead time is known but not how it splits: the bar says so and
    // draws the lead time alone.
    if (working === null || !idle || idle.state === "unavailable") return { state: "lead_only", total_ms: lead, lead_state: leadN.state, groups: [], segments: [], reasons: [...new Set([...((workN && workN.reasons) || []), ...((idle && idle.reasons) || [])])] };
    let partial = leadN.state === "partial" || workN.state === "partial";
    const notes = [];
    // Labels sit under `working` in Desk's split rows, at the top before it.
    const labels = stackRow && stackRow.working && typeof stackRow.working === "object" ? stackRow.working : stackRow;
    const pick = (row, key) => {
      row = labels;
      if (!row) return null;
      if (key === "value" || key === "support") return row.class_ms && row.class_ms[key];
      if (key === "agents_working_unlabeled") return row.agents_working_unlabeled_ms;
      if (key === "not_labeled") return row.not_labeled_ms;
      return row.waste_ms && row.waste_ms[key];
    };
    // Desk after the fix round of #229 splits each row into working and idle
    // time (`idle_ms`); before it, labels may also cover idle time and "not
    // labeled yet" covers both, so not labeled yet is the working time left.
    const split = !!(stackRow && (stackRow.idle_ms || (stackRow.working && typeof stackRow.working === "object")));
    const work = [];
    let labeled = 0;
    for (const sg of segments) {
      if (sg.key === "waiting" || sg.key === "no_session" || (sg.key === "not_labeled" && !split)) continue;
      const n = pick(stackRow, sg.key);
      const v = val(n);
      if (n && n.state === "partial") partial = true;
      if (v === null || v <= 0) continue;
      labeled += v;
      work.push({ key: sg.key, label: sg.label, ms: v, state: n.state });
    }
    let workSegs = work;
    if (labeled > working + SECOND) {
      // The labels cover more than the working time, so some of them fall in
      // idle time: no split by label is drawn rather than one that is wrong.
      workSegs = [{ key: "working_unsplit", label: "Working, not split by label", ms: working, state: workN.state }];
      notes.push("This task's labels also cover idle time, so its working time is not split by label here.");
    } else if (working - labeled > SECOND) {
      workSegs = [...work, { key: "not_labeled", label: "Not labeled yet", ms: working - labeled, state: "measured" }];
    }
    if (idle.state === "partial") partial = true;
    const waitSegs = idle.by.map((x) => ({ key: `wait_${x.key}`, cause: x.key, label: waitCauseLabel(x.key), ms: x.ms, state: idle.state }));
    const share = (x) => ({ ...x, share: x.ms / lead });
    const groups = [
      { key: "working", label: "Working", ms: working, segments: workSegs.map(share) },
      { key: "waiting", label: "Waiting", ms: idle.value, segments: waitSegs.sort((a, b) => WAIT_KEYS.indexOf(a.cause) - WAIT_KEYS.indexOf(b.cause)).map(share) },
    ];
    // Each group's figure says "at least" or "at most" as the lede does.
    const wb = boundOf(workN);
    groups[0].qualifier = wb === "lower" ? "at least " : wb === "upper" ? "at most " : "";
    groups[1].qualifier = idle.bound === "upper" ? "at most " : idle.bound === "lower" ? "at least " : idle.bound === "unknown" ? "about " : "";
    return { state: "ok", total_ms: lead, groups, segments: [...groups[0].segments, ...groups[1].segments], partial, notes, lead_state: leadN.state };
  }

  // A waiting cause as a legend label: "Next prompt (the agent had stopped)".
  function waitCauseLabel(key) {
    const w = waitedOnWords(key, "short");
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  // The working time on a task's bar that carries no evaluator label
  // (agents working but not labeled, not labeled yet, or working time not
  // split by label), or null when the bar does not split.
  function unlabeledMs(bar) {
    if (!bar || bar.state !== "ok" || !bar.groups || !bar.groups[0]) return null;
    return bar.groups[0].segments.filter((x) => x.key === "agents_working_unlabeled" || x.key === "not_labeled" || x.key === "working_unsplit").reduce((a, x) => a + x.ms, 0);
  }

  // What a lede number lights up on the map, as a CSS selector over the
  // map's own classes. A cause lights only the waits (and the idle steps of
  // the ladder) that waited on it.
  function highlightSelector(key, opts) {
    const o = opts || {};
    // A working part of the task's bar lights the boxes whose bursts hold
    // it: value-adding the boxes with value-adding time, defects the boxes
    // with defect stretches, any other working part every box.
    if (key === "class") {
      if (o.seg === "value") return ".vsm-box.has-value, .sum-value";
      if (o.seg === "defects") return ".vsm-box.has-defects";
      return ".vsm-box, .lad-low, .sum-working";
    }
    if (key === "wait_cause") return WAIT_KEYS.includes(o.cause) ? `.vsm-wait.has-${o.cause}, .lad-high.has-${o.cause}` : ".vsm-wait, .lad-high, .sum-waiting";
    if (key === "longest") return Number.isInteger(o.item) ? `[data-item="${o.item}"]` : ".vsm-wait";
    return {
      lead: ".vsm-box, .vsm-wait, .lad, .sum-lead",
      working: ".vsm-box, .lad-low, .sum-working",
      value: ".sum-value",
      waiting: ".vsm-wait, .lad-high, .sum-waiting",
      fe: ".sum-fe",
    }[key] || null;
  }

  // ------------------------------------------------------------ the picker

  // The picker's rows: every task, the latest to finish first, with its
  // lead time and flow efficiency from rollups/tasks.json and a badge when a
  // figure is partial or unavailable. `nameOf(job)` gives its display name.
  // `query` filters by name or key, case-insensitively.
  function pickerRows(jobs, taskRows, nameOf, query) {
    const byJob = new Map((Array.isArray(taskRows) ? taskRows : []).map((r) => [r.job, r]));
    const pos = (j) => (j.finish_order && j.finish_order.state === "measured" ? j.finish_order.value : -1);
    // Two groups: finished tasks (their finish is known from the commit
    // that labeled them), the latest first; then tasks still open or not
    // labeled yet, the latest to start first, those with no facts last.
    const finished = (j) => j.finish_basis === "labels" && pos(j) > 0;
    const q = typeof query === "string" ? query.trim().toLowerCase() : "";
    return (Array.isArray(jobs) ? jobs : [])
      .map((j, i) => ({ j, i }))
      .sort((a, b) => Number(finished(b.j)) - Number(finished(a.j)) || pos(b.j) - pos(a.j) || a.i - b.i)
      .map(({ j }) => {
        const r = byJob.get(j.id) || null;
        const name = nameOf(j);
        const figs = r ? [r.lead_time_ms, r.flow_efficiency] : [];
        const feText = r ? feWords(r) : null;
        const partial = !!r && (figs.some((n) => n && n.state === "partial") || !!r.labels_from_shared_session);
        // "partial" is said once: not again as a badge when the flow
        // efficiency's own words already say it.
        const badge = !r ? "no data" : figs.some((n) => !n || n.state === "unavailable") ? "no data" : partial && !/\(partial/.test(feText || "") ? "partial" : null;
        return {
          id: j.id,
          name,
          short: String(j.id).slice(0, 8),
          status: r && r.status && r.status.state !== "unavailable" ? r.status.value : j.status,
          lead: r ? r.lead_time_ms : null,
          fe: r ? r.flow_efficiency : null,
          feText,
          badge,
          group: finished(j) ? "finished" : "open",
        };
      })
      .filter((x) => !q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
  }

  // -------------------------------------------------------- the swimlane

  // The lanes of one session: the main agent, then subagents nested under
  // their parents (from the map's `agents`, matched by session). Workers
  // that appear in intervals but not in `agents` hang under the main agent.
  function lanes(detail, agents) {
    const workers = new Set((detail && Array.isArray(detail.intervals) ? detail.intervals : []).map((i) => i.worker).filter((w) => Number.isInteger(w)));
    const mine = (Array.isArray(agents) ? agents : []).filter((a) => a && a.session === (detail && detail.session) && Number.isInteger(a.n));
    for (const a of mine) workers.add(a.n);
    workers.add(0);
    const parent = new Map(mine.map((a) => [a.n, Number.isInteger(a.parent) ? a.parent : 0]));
    const kids = new Map();
    for (const w of workers) {
      if (w === 0) continue;
      let p = parent.has(w) ? parent.get(w) : 0;
      if (!workers.has(p) || p === w) p = 0;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(w);
    }
    const out = [];
    const seen = new Set();
    const visit = (w, depth) => {
      if (seen.has(w)) return;
      seen.add(w);
      out.push({ worker: w, depth, label: w === 0 ? "Main agent" : `Subagent ${w}` });
      for (const k of (kids.get(w) || []).sort((a, b) => a - b)) visit(k, depth + 1);
    };
    visit(0, 0);
    for (const w of [...workers].sort((a, b) => a - b)) if (!seen.has(w)) visit(w, 1);
    return out;
  }

  // Runs of activity on one lane at a resolution of `msPerPx`: intervals
  // closer than one pixel merge, so a lane of thousands of calls draws as a
  // few rectangles.
  function activityRuns(intervals, worker, msPerPx) {
    const xs = intervals
      .filter((i) => i.worker === worker && i.kind !== "human_wait" && !i.evidence_only)
      .map((i) => [i.start_ms, Math.max(i.end_ms, i.start_ms)])
      .sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of xs) {
      const prev = out[out.length - 1];
      if (prev && s <= prev[1] + msPerPx) prev[1] = Math.max(prev[1], e);
      else out.push([s, e]);
    }
    return out;
  }

  // How many subagents were active in each pixel column, for the collapsed
  // subagent lane. Returns runs [{ x, w, n }] of columns with activity.
  function density(intervals, workers, t0, msPerPx, columns) {
    const set = new Set(workers);
    const cols = new Map();
    for (const i of intervals) {
      if (!set.has(i.worker) || i.kind === "human_wait" || i.evidence_only) continue;
      const a = Math.max(0, Math.floor((i.start_ms - t0) / msPerPx));
      const b = Math.min(columns - 1, Math.floor((Math.max(i.end_ms, i.start_ms) - t0) / msPerPx));
      for (let x = a; x <= b; x++) {
        if (!cols.has(x)) cols.set(x, new Set());
        cols.get(x).add(i.worker);
      }
    }
    // Neighboring columns with the same count merge into one run { x, w, n },
    // so a deep zoom draws a few rectangles, not one per pixel.
    const out = [];
    for (const [x, set2] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
      const prev = out[out.length - 1];
      if (prev && prev.x + prev.w === x && prev.n === set2.size) prev.w += 1;
      else out.push({ x, w: 1, n: set2.size });
    }
    return out;
  }

  const FAILED = new Set(["error", "timeout"]);
  function isFailure(i) {
    return i.kind === "tool" && FAILED.has(i.outcome);
  }

  // Failed tool calls on the given workers, binned to pixel columns. A bin
  // holds the count, so a column of many failures is one tick whose label
  // says how many; zoomed in far enough, each bin is one call.
  function failureTicks(intervals, workers, t0, msPerPx) {
    const set = new Set(workers);
    const bins = new Map();
    for (const i of intervals) {
      if (!set.has(i.worker) || !isFailure(i)) continue;
      const x = Math.floor((i.start_ms - t0) / msPerPx);
      const b = bins.get(x) || { x, n: 0, tools: new Set() };
      b.n += 1;
      if (i.tool) b.tools.add(i.tool);
      bins.set(x, b);
    }
    return [...bins.values()].sort((a, b) => a.x - b.x).map((b) => ({ x: b.x, n: b.n, tools: [...b.tools].sort() }));
  }

  // The workers a stretch's evidence names: the lanes its band spans.
  function stretchWorkers(stretch, intervals) {
    const ws = new Set();
    for (const k of Array.isArray(stretch.evidence) ? stretch.evidence : []) {
      const i = intervals[k];
      if (i && Number.isInteger(i.worker)) ws.add(i.worker);
    }
    return [...ws].sort((a, b) => a - b);
  }

  // The segment key a stretch draws in.
  function stretchSegment(s) {
    if (s.class === "value") return "value";
    if (s.class === "support") return "support";
    if (s.class === "unlabeled") return s.reason === "agents_working" ? "agents_working_unlabeled" : "not_labeled";
    if (s.class === "muda") return Object.prototype.hasOwnProperty.call(WASTE_WORDS, s.waste) ? s.waste : "unknown";
    return "unknown";
  }

  // The zoom steps: "fit" is 1; each step doubles, until a
  // pixel is a tenth of a second or the drawing reaches `maxWidth` pixels.
  function zoomSteps(spanMs, frameWidth, maxWidth) {
    const w = Math.max(1, frameWidth);
    const cap = typeof maxWidth === "number" && maxWidth > w ? maxWidth : 32768;
    const out = [1];
    const fit = spanMs / w;
    while (fit / out[out.length - 1] > 100 && w * out[out.length - 1] * 2 <= cap && out.length < 24) out.push(out[out.length - 1] * 2);
    return out;
  }

  // ----------------------------------------------------- the evidence drawer

  // A time on the task clock: offsets from the task's start (the card's
  // creation, or the first session when that came first). Never a date.
  function clockWords(startMs, endMs, origin) {
    const o = typeof origin === "number" ? origin : 0;
    const a = startMs - o;
    const b = endMs - o;
    const at = (x) => (x < 0 ? `${durationShort(-x)} before` : `${durationShort(x)} after`);
    if (a >= 0) return `from ${durationShort(a)} to ${durationShort(b)} after the task's start (${durationWords(b - a)})`;
    return `from ${at(a)} to ${at(b)} the task's start (${durationWords(b - a)})`;
  }

  // An offset on the task clock for an axis tick: "-6h", "0s", "12h".
  function clockTick(ms) {
    return ms < 0 ? `\u2212${durationShort(-ms)}` : durationShort(ms);
  }

  // Where a wait sits among the map's boxes, in words: waits carry no clock
  // time on the page (an idle band's start and end are never labeled).
  function waitPlace(model, item) {
    const before = model.items.slice(0, item.index).filter((x) => x.type === "box").pop();
    const after = model.items.slice(item.index + 1).find((x) => x.type === "box");
    if (before && after) return `between work boxes ${before.box_no} and ${after.box_no}`;
    if (after) return "before the first work box";
    if (before) return "after the last work box";
    return "with no work box beside it";
  }

  // A labeled figure in words: "not labeled yet" when no label covers it,
  // "none" for a true zero.
  function labeledWords(n, words, kind) {
    const x = stated(n);
    if (x.state === "unavailable") {
      const why = x.reasons.map(words).join("; ");
      return !why || /not labeled/i.test(why) ? "not labeled yet" : `not labeled yet (${why})`;
    }
    if (x.value === 0) return "none";
    return kind === "count" ? `${boundWords(x)}${x.value}` : statedWords(x);
  }

  function isWaitStretch(s) {
    return !!(s && s.class === "muda" && s.waste === "waiting");
  }

  // The drawer's content for one thing on the page. `thing` is
  //   { kind: "box", item }  { kind: "wait", item }  { kind: "ladder", seg, item }
  //   { kind: "stretch", stretch, index, total, intervals, lanes }
  // and `ctx` is { origin_ms, lead_ms, fold_ms, model, reasonText }. Returns
  // { title, rows, evidence }: rows are [label, text] pairs; evidence lists
  // the intervals behind a stretch (kind, tool kind, outcome, lane). Idle
  // time (a wait, the short waits inside a box, a waiting stretch) is given
  // its length and place, never its start and end on the clock.
  function drawer(thing, ctx) {
    const c = ctx || {};
    const words = typeof c.reasonText === "function" ? c.reasonText : (r) => String(r).replace(/_/g, " ");
    const share = (ms) => (typeof c.lead_ms === "number" && c.lead_ms > 0 ? `${pctWords(ms / c.lead_ms)} of the lead time` : "share of lead time not known (no lead time)");
    if (thing.kind === "stretch") {
      const s = thing.stretch;
      const seg = stretchSegment(s);
      const cls = isWaitStretch(s) ? `${LABELED_PAUSE}: the evaluator labeled this stretch waiting; on this page, waiting means idle time` : s.class === "muda" ? `Waste: ${WASTE_WORDS[s.waste] || "could not classify"}` : CLASS_WORDS[s.class] || "Not labeled";
      const rows = [];
      if (Number.isInteger(thing.index)) rows.push(["Which", `Stretch ${thing.index + 1}${Number.isInteger(thing.total) ? ` of ${thing.total}` : ""} in this session`]);
      rows.push(["What it is", cls], ["Confidence", typeof s.confidence === "string" ? s.confidence : "not recorded"], ["Evaluator version", typeof s.evaluator_version === "string" ? s.evaluator_version : "not recorded"]);
      if (s.waited_on) rows.push(["Waited on", waitedOnWords(s.waited_on, "long")]);
      if (s.reason) rows.push(["Note", s.reason]);
      if (isWaitStretch(s)) rows.push(["Length", durationWords(s.end_ms - s.start_ms)]);
      else rows.push(["On the task clock", clockWords(s.start_ms, s.end_ms, c.origin_ms)]);
      rows.push(["Share", share(s.end_ms - s.start_ms)]);
      const laneName = new Map((thing.lanes || []).map((l) => [l.worker, l.label]));
      const evidence = (Array.isArray(s.evidence) ? s.evidence : [])
        .map((k) => (thing.intervals || [])[k])
        .filter(Boolean)
        .map((i) => ({
          kind: KIND_WORDS[i.kind] || String(i.kind).replace(/_/g, " "),
          tool: i.tool || "",
          outcome: i.outcome || "",
          lane: laneName.get(i.worker) || (i.worker === 0 ? "Main agent" : `Subagent ${i.worker}`),
          duration: durationShort(i.end_ms - i.start_ms),
        }));
      // A labeled wait keeps the cross-hatch the swimlane and its legend give it.
      return { title: s.class === "muda" ? `${stretchWasteWords(s.waste)} stretch` : `${CLASS_WORDS[s.class] || "Unlabeled"} stretch`, segment: isWaitStretch(s) ? "labeled_wait" : seg, rows, evidence };
    }
    const it = thing.item;
    const nOf = c.model && c.model.box_count ? ` of ${c.model.box_count}` : "";
    const range = (r, one, many) => (r ? (r[0] === r[1] ? `${one} ${r[0]}` : `${many} ${r[0]}–${r[1]}`) : "");
    if (thing.kind === "box" || (thing.kind === "ladder" && it.type === "box" && !(thing.seg && thing.seg.folded))) {
      const fold = typeof c.fold_ms === "number" && c.fold_ms > 0 && c.fold_ms !== Infinity ? `the waits shorter than ${durationWords(c.fold_ms)} between them` : "the waits between them";
      const rows = [
        ["Which", `Work box ${it.box_no}${nOf}: ${range(it.burst_range, "burst", "bursts")}`],
        ["What it is", it.count === 1 ? "One work burst: a run of agent activity with no idle stretch of 15 minutes or more and no operator turn inside it" : `${it.count} work bursts, folded into one box with ${fold}`],
        ["On the task clock", clockWords(it.start_ms, it.end_ms, c.origin_ms)],
        ["Working time", `${durationWords(it.working_ms)} (${share(it.working_ms)})`],
        ["Value-adding, as labeled", labeledWords(it.value_ms, words)],
        ["Defects, as labeled", stated(it.defect_stretches).state === "unavailable" ? labeledWords(it.defect_stretches, words) : reworkWords(it) || "none"],
      ];
      if (it.inner_wait_ms > 0) rows.push(["Short waits inside", `${durationWords(it.inner_wait_ms)}${it.folded_count ? `, including ${it.folded_count} folded wait${it.folded_count === 1 ? "" : "s"}` : ""}`]);
      return { title: boxTitle(it), segment: "support", rows, evidence: [] };
    }
    const ms = thing.kind === "ladder" && thing.seg && thing.seg.folded ? it.inner_wait_ms : it.duration_ms;
    if (thing.kind === "ladder" && thing.seg && thing.seg.folded) {
      return {
        title: "Short waits inside a box",
        segment: "waiting",
        cause: (it.inner_causes && it.inner_causes[0]) || "unknown",
        rows: [
          ["Which", `Inside work box ${it.box_no}${nOf}`],
          ["What it is", "Idle time inside a work box: waits shorter than the map's fold threshold, and idle moments inside bursts"],
          ["Waited on", (it.inner_causes && it.inner_causes.length ? it.inner_causes : ["unknown"]).map((k) => (it.inner_by && it.inner_by[k] > 0 ? `${waitedOnWords(k, "short")}, ${durationWords(it.inner_by[k])}` : waitedOnWords(k, "short"))).join("; ")],
          ["Length", `${durationWords(ms)} (${share(ms)})`],
        ],
        evidence: [],
      };
    }
    const rows = [
      ["Which", `${range(it.gap_range, "Gap", "Gaps")}${c.model ? `, ${waitPlace(c.model, it)}` : ""}`],
      ["What it is", it.count === 1 ? "A wait: no agent of this task was working" : `${it.count} waits in a row, with no work between them`],
      ["Waited on", it.waited_on === "mixed" ? it.causes.map((k) => (it.by && it.by[k] > 0 ? `${waitedOnWords(k, "short")}, ${durationWords(it.by[k])}` : waitedOnWords(k, "short"))).join("; ") : waitedOnWords(it.waited_on, "long")],
      ["Length", `${durationWords(ms)} (${share(ms)})`],
    ];
    if (it.count > 1) rows.push(["Longest of them", durationWords(it.longest_ms)]);
    // The drawer's swatch is the cause's own (the largest, for a mixed wait).
    return { title: `Wait: ${waitTitle(it)}`, segment: "waiting", cause: it.causes[0] || "unknown", rows, evidence: [] };
  }

  // The task's name as a prompt says it: "factory task 825084c9 (private)",
  // or "factory task "Revocable sessions" (fc8b915a)". `n` is
  // format.js taskName's { title, kind, short }.
  function promptName(n) {
    if (!n || n.kind === "private" || !n.title) return `factory task ${n && n.short ? n.short : "(unknown)"} (private)`;
    if (n.kind === "unnamed") return `factory task ${n.short}`;
    return `factory task "${n.title}" (${n.short})`;
  }

  // Minutes on the task clock, for a prompt: "minute 6 to minute 10".
  function minuteSpan(startMs, endMs, origin) {
    const o = typeof origin === "number" ? origin : 0;
    const mins = (x) => Math.round((x - o) / MINUTE);
    // A span shorter than two minutes reads as its length and starting minute.
    if (endMs - startMs < 2 * MINUTE) return `for ${durationWords(endMs - startMs)}, starting at minute ${mins(startMs)} after the task's start`;
    return `from minute ${mins(startMs)} to minute ${mins(endMs)} after the task's start`;
  }

  // What a prompt says about the item it was copied from: `what` names it
  // the way the page does, `where` places it, `locator` finds it in the data
  // file, and `select` is the query that opens it again on the page.
  // `item` is { kind: "box"|"wait"|"inner"|"stretch", ... } as the drawer's.
  function promptItem(thing, ctx) {
    const c = ctx || {};
    const it = thing.item;
    const r = (x) => (x[0] === x[1] ? String(x[0]) : `${x[0]}-${x[1]}`);
    const idx = (name, x) => (x[0] === x[1] ? `${name}[${x[0] - 1}]` : `${name}[${x[0] - 1}] to ${name}[${x[1] - 1}]`);
    const total = c.model ? c.model.totals : null;
    if (thing.kind === "stretch") {
      const s = thing.stretch;
      const k = thing.index;
      const cls = s.class === "muda" ? `${stretchWasteWords(s.waste).toLowerCase()} stretch` : `${(CLASS_WORDS[s.class] || "unlabeled").toLowerCase()} stretch`;
      return {
        what: `${cls} ${k + 1}${Number.isInteger(thing.total) ? ` of ${thing.total}` : ""} in session ${String(thing.session || "").slice(0, 8)}${s.waited_on ? ` (waited on: ${waitedOnWords(s.waited_on, "short")})` : ""}`,
        where: isWaitStretch(s) ? `It lasted ${durationWords(s.end_ms - s.start_ms)}` : `It ran ${minuteSpan(s.start_ms, s.end_ms, c.origin_ms)}`,
        locator: `stretches[${k}]`,
        select: `stretch=${k + 1}`,
      };
    }
    if (thing.kind === "box" || (thing.kind === "ladder" && it.type === "box" && !(thing.seg && thing.seg.folded))) {
      return {
        what: `work box ${it.box_no}${c.model ? ` of ${c.model.box_count}` : ""} (burst${it.burst_range[0] === it.burst_range[1] ? "" : "s"} ${r(it.burst_range).replace("-", "–")}${total ? ` of ${total.bursts}` : ""})`,
        where: `It ran ${minuteSpan(it.start_ms, it.end_ms, c.origin_ms)}, with ${durationWords(it.working_ms)} of working time`,
        locator: idx("bursts", it.burst_range),
        select: `bursts=${r(it.burst_range)}`,
      };
    }
    if (thing.kind === "ladder" && thing.seg && thing.seg.folded) {
      return {
        what: `the short waits inside work box ${it.box_no}${c.model ? ` of ${c.model.box_count}` : ""}`,
        where: `They add up to ${durationWords(it.inner_wait_ms)}`,
        locator: idx("bursts", it.burst_range),
        select: `bursts=${r(it.burst_range)}`,
      };
    }
    return {
      what: `the wait ${c.model ? waitPlace(c.model, it) : ""} (gap${it.gap_range[0] === it.gap_range[1] ? "" : "s"} ${r(it.gap_range).replace("-", "–")}${total ? ` of ${total.gaps}` : ""}; waited on: ${it.waited_on === "mixed" ? "several causes" : waitedOnWords(it.waited_on, "short")})`.replace("wait  (", "wait ("),
      where: `It lasted ${durationWords(it.duration_ms)}`,
      locator: idx("gaps", it.gap_range),
      select: `gaps=${r(it.gap_range)}`,
    };
  }

  // The prompt "Copy as a prompt for your agent" puts on the clipboard: which
  // item, where it sits, a link that opens it again, and where it is in the
  // data file.
  function promptText(p) {
    const what = p.what || "this item";
    const link = p.select ? `${p.route}?${p.select}` : p.route;
    // Every prompt ends with the index of every data file, so an agent can
    // find the files it needs beyond this item's.
    return `Walk me through ${what} of ${p.taskName || `factory task ${p.name}`}. ${p.where ? `${p.where}. ` : ""}It is open at ${link}, and its data is ${p.locator ? `${p.locator} in ` : ""}${p.dataUrl}. Explain what happened and what we could change.${p.indexUrl ? ` Index of every data file: ${p.indexUrl}` : ""}`;
  }

  // ------------------------------------------------- the map file (build time)

  // The slim map file for one task (map/<job>.json), from its full report
  // jobs/<job>.json. It keeps what the landing view draws and drops the
  // intervals (up to megabytes) and every per-turn time: pull requests keep
  // their repository and number only, at task level, with no time and no
  // burst (a burst's pull request count would place it on the clock).
  function slimMap(report) {
    const t = (report && report.timeline) || {};
    const arr = (x) => (Array.isArray(x) ? x : []);
    const items = (x) => (Array.isArray(x) ? x : x && typeof x === "object" && Array.isArray(x.items) ? x.items : []);
    const envelopeOf = (x, explicit) => {
      const e = explicit && typeof explicit === "object" ? explicit : x && typeof x === "object" && !Array.isArray(x) ? x : null;
      return e && typeof e.state === "string" ? { state: e.state, reasons: arr(e.reasons) } : { state: "measured", reasons: [] };
    };
    return {
      schema: "factory.site.map/1",
      job: String((report && report.job && report.job.id) || t.job || ""),
      lead_window: t.lead_window || { state: "unavailable", reasons: ["not_recorded"] },
      // Desk may wrap bursts and gaps in an envelope { state, reasons, items }
      // and state the bursts' labels; both are kept so the page can say the
      // map is incomplete.
      bursts_state: envelopeOf(t.bursts, t.bursts_state),
      bursts_labels: t.bursts_labels && typeof t.bursts_labels === "object" ? { state: t.bursts_labels.state, reasons: arr(t.bursts_labels.reasons) } : null,
      bursts: items(t.bursts).map((b) => ({
        start_ms: b.start_ms,
        end_ms: b.end_ms,
        working_ms: b.working_ms,
        idle_ms: b.idle_ms,
        // Only the causes with time, as plain milliseconds: the page names
        // a box's inner causes from these, and the stated envelopes would
        // double the file for no figure the page shows.
        idle_by_waited_on_ms: slimCauses(b.idle_by_waited_on_ms),
        sessions: arr(b.sessions),
        agents: b.agents,
        tool_calls: b.tool_calls,
        tool_failures: b.tool_failures,
        operator_turns: b.operator_turns,
        value_ms: b.value_ms,
        defect_ms: b.defect_ms,
        defect_stretches: b.defect_stretches,
      })),
      // A gap keeps Desk's per-gap split when Desk states one.
      gaps: items(t.gaps).map((g) => {
        const by = slimCauses(g.idle_by_waited_on_ms);
        return by && Object.keys(by).length ? { start_ms: g.start_ms, end_ms: g.end_ms, waited_on: g.waited_on, idle_by_waited_on_ms: by } : { start_ms: g.start_ms, end_ms: g.end_ms, waited_on: g.waited_on };
      }),
      sessions: arr(t.sessions).map((s) => ({ id: s.id, host: s.host, offset_ms: s.offset_ms, end_ms: s.end_ms })),
      agents: arr(t.agents).map((a) => ({ session: a.session, n: a.n, parent: a.parent })),
      transitions: arr(t.transitions).map((x) => ({ offset_ms: x.offset_ms, to: x.to })),
      observations: arr(t.observations).map((x) => ({ offset_ms: x.offset_ms, status: x.status })),
      outcome: t.outcome && typeof t.outcome === "object" ? { state: t.outcome.state, deliveries: t.outcome.deliveries } : null,
      detail_files: arr(t.detail_files),
      prs: arr(t.prs).map((p) => ({ repo: p.repo, number: p.number })),
    };
  }

  return {
    durationWords,
    durationShort,
    pctWords,
    stated,
    boundOf,
    feWords,
    barPartialNote,
    burstIdleBy,
    WAIT_KEYS,
    gapIdleBy,
    gapCauses,
    unlabeledMs,
    LABELED_PAUSE,
    idleSplit,
    waitCauseLabel,
    highlightSelector,
    waitPlace,
    promptName,
    promptItem,
    sumStated,
    statedText,
    waitedOnWords,
    waitLabel,
    causeWords,
    causeSegment,
    WAITED_ON_KEYS: Object.keys(WAITED_ON),
    lede,
    ledeText,
    FOLD_STEPS,
    mapModel,
    sessionWords,
    dataBox,
    reworkWords,
    boxTitle,
    waitTitle,
    foldWords,
    ladder,
    statusMarks,
    timeBar,
    pickerRows,
    lanes,
    activityRuns,
    density,
    failureTicks,
    isFailure,
    stretchWorkers,
    stretchSegment,
    zoomSteps,
    clockWords,
    clockTick,
    drawer,
    promptText,
    slimMap,
  };
});
