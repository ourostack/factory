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
// (jobs/<job>/<session>.json). Every time the page shows is an offset on
// the task clock: operator prompts, pull request times, boxes and waits
// alike. Only the build reads GitHub's dates, to place pull request times
// on that clock (the PR clock, below); the map file holds offsets only.
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
    const [waste, what, why] = String(key).split(":");
    // A sub-cause of waiting for the next prompt, by why the agent stopped.
    if (waste === "waiting" && what === "next_prompt" && why) return `Waiting · next prompt · ${whyName(why).toLowerCase()}`;
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
    // A lower bound of zero says nothing a reader can use (format.js says
    // the same).
    if (x.state === "partial" && x.bound !== "upper" && x.value === 0) return "none recorded";
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
  // One gap's or burst's next-prompt idle time by why the agent stopped
  // (Desk D5 `idle_by_why_ms`, stated numbers or bare milliseconds), or
  // null when Desk does not state it. Returns { why: ms } with time only.
  function whyBy(x) {
    const src = x && x.idle_by_why_ms;
    if (!src || typeof src !== "object" || Array.isArray(src)) return null;
    const by = {};
    for (const [k, n] of Object.entries(src)) {
      const v = typeof n === "number" ? (Number.isFinite(n) ? n : null) : val(n);
      if (v === null || v <= 0) continue;
      const key = WHY_KEYS.includes(k) ? k : "not_known";
      by[key] = (by[key] || 0) + v;
    }
    return by;
  }
  // Adds `from` into `into` (a why split), keeping null when neither states one.
  function addWhy(into, from) {
    if (!from) return into;
    const out = into || {};
    for (const [k, ms] of Object.entries(from)) out[k] = (out[k] || 0) + ms;
    return out;
  }
  // The why that holds the most time, or null.
  function topWhy(by) {
    if (!by) return null;
    const ks = Object.keys(by).filter((k) => by[k] > 0).sort((a, b) => by[b] - by[a] || WHY_KEYS.indexOf(a) - WHY_KEYS.indexOf(b));
    return ks[0] || null;
  }

  // Every why with time in a split, in WHY_KEYS order.
  function whysOf(by) {
    return by ? WHY_KEYS.filter((k) => by[k] > 0) : [];
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
      // Why the agent stopped before its waiting for the next prompt (§4).
      const next = by.find((x) => x.key === "next_prompt");
      add(...whyLedeParts(nextPromptWhy(row), next ? next.ms : 0, tok));
      const gap = row.longest_gap && row.longest_gap.state !== "unavailable" ? row.longest_gap.value : null;
      if (waiting > 0 && gap && typeof gap.duration_ms === "number" && gap.duration_ms > 0) {
        const same = top && top.key === gap.waited_on;
        // Desk names the why of a longest wait for the next prompt (D5).
        const after = gap.waited_on === "next_prompt" && WHY_AFTER[gap.why] ? `, ${WHY_AFTER[gap.why]}` : "";
        add(" The longest single wait was ", tok("longest", durationWords(gap.duration_ms)), same ? `, also ${ALSO[gap.waited_on] || "with its cause not recorded"}${after}.` : `, when ${waitedOnWords(gap.waited_on, "long")}${after}.`);
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
      // Why the agent stopped, where Desk splits a gap's next-prompt time.
      let whyOf = null;
      for (const g of gaps) whyOf = addWhy(whyOf, whyBy(g));
      return {
        type: "wait",
        why_by: whyOf,
        why: topWhy(whyOf),
        whys: whysOf(whyOf),
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
    let innerWhy = null;
    for (const x of [...folded, ...bs]) innerWhy = addWhy(innerWhy, whyBy(x));
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
      inner_why_by: innerWhy,
      inner_why: topWhy(innerWhy),
      inner_whys: whysOf(innerWhy),
      folded_count: folded.length,
      burst_range: [bs[0].n, bs[bs.length - 1].n],
      // Counts and labeled times as stated numbers: a part with no source
      // stays "no data", never 0.
      agents: maxStated(bs.map((b) => b.agents)),
      tool_calls: sum("tool_calls"),
      tool_failures: sum("tool_failures"),
      operator_turns: sum("operator_turns"),
      prs: sum("prs"),
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
    // Desk's waits (map/2 `waits`), and for each item the ones that overlap
    // it: the wait drawer's stops, and the reasons of a why not known (the
    // time no recorded wait holds is "stop not recorded").
    const waitsAll = (Array.isArray(map && map.waits) ? map.waits : []).filter((w) => w && typeof w === "object" && isMs(w.start_ms) && isMs(w.end_ms));
    for (const it of items) {
      it.stops = waitsAll.filter((w) => w.start_ms < it.end_ms && w.end_ms > it.start_ms).sort((a, b) => a.start_ms - b.start_ms);
      const nk = (it.type === "wait" ? it.why : it.inner_why) === "not_known";
      if (nk) {
        const rs = [...new Set(it.stops.filter((w) => w.why === "not_known").flatMap((w) => (Array.isArray(w.reasons) ? w.reasons : [])))];
        it.why_reasons = rs.length ? rs : ["stop_not_recorded"];
      } else it.why_reasons = [];
    }
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
  function dataBox(box, sessionCount, prsHere) {
    const ws = box.working_state ? stated(box.working_state) : { state: "measured" };
    // Each row carries its figure's reasons, which the page shows on hover
    // and to screen readers, for a figure that is not measured.
    const why = (n) => {
      const x = n ? stated(n) : { state: "measured" };
      return x.state === "measured" ? [] : Array.isArray(x.reasons) ? [...x.reasons] : [];
    };
    const row = (key, label, n, none) => ({ key, label, text: statedText(n, null, none), reasons: why(n) });
    const prs = prsHere || box.prs;
    return [
      { key: "working", label: "Working time", text: ws.state === "measured" ? durationShort(box.working_ms) : ws.state === "partial" ? (box.working_ms > 0 ? `at least ${durationShort(box.working_ms)}` : "none recorded") : `${durationShort(box.working_ms)} (span)`, reasons: why(box.working_state) },
      row("agents", "Agents", box.agents),
      row("tool_calls", "Tool calls", box.tool_calls),
      row("tool_failures", "Failed tool calls", box.tool_failures),
      row("operator_turns", "Operator turns", box.operator_turns, "not recorded"),
      // The clock's count (boxPrCount) when there is one, so the box and the
      // ladder's pull request lane agree; else Desk's burst count.
      row("prs", "Pull requests first appeared", prs, "not recorded"),
      { key: "session", label: "Session", text: sessionWords(box.session_numbers, sessionCount), reasons: [] },
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
  // A wait for the next prompt says why the agent stopped where Desk
  // splits it (addendum §4): "waiting for the next prompt: agent stopped
  // short"; otherwise what it waited on, as before.
  function waitTitle(w) {
    // A wait whose time holds several whys is named by its largest, "mostly".
    const mixed = Array.isArray(w.whys) && w.whys.length > 1;
    const what = w.waited_on === "next_prompt" && w.why ? (mixed ? whyTriangle(w.why, w.why_reasons).replace(/^waiting for the next prompt: /, "waiting for the next prompt: mostly ") : whyTriangle(w.why, w.why_reasons)) : w.waited_on === "mixed" && w.count > 1 ? "several causes" : waitedOnWords(w.waited_on, "short");
    return w.count === 1 ? what : `${w.count} waits: ${what}`;
  }

  // The fold, in one sentence for the map's caption.
  function foldWords(model) {
    // The same words in every view, naming the view's own threshold (A1 M4).
    if (!model.fold_ms) return "At this width the map folds no wait: every work burst has its own box and every wait its own triangle.";
    if (model.fold_ms === Infinity) return "At this width the map folds every wait into one box, so it stays legible; its data box says how many bursts it holds. A wider screen may show more boxes.";
    return `At this width the map folds waits shorter than ${durationWords(model.fold_ms)} into the box beside them, so it stays legible; each box says how many bursts it holds, and the ladder shows the folded waits beside its working time. A wider or narrower screen may fold a different threshold.`;
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
    // The next-prompt part is split by why the agent stopped where Desk
    // publishes a split that adds up to it (addendum §4): each class its
    // own segment, and the time whose why is not known an outline. Without
    // one, it stays one segment and the bar says why is not known yet.
    const why = nextPromptWhy(taskRow);
    const waitSegs = [];
    for (const x of idle.by) {
      const one = { key: `wait_${x.key}`, cause: x.key, label: waitCauseLabel(x.key), ms: x.ms, state: idle.state };
      if (x.key !== "next_prompt" || why.state !== "ok" || !why.parts.length || Math.abs(why.parts.reduce((a, p) => a + p.ms, 0) - x.ms) > SECOND) {
        waitSegs.push(one);
        continue;
      }
      for (const p of why.parts) {
        const seg = { key: `wait_next_prompt_${p.why}`, cause: "next_prompt", why: p.why, label: `Next prompt · ${whyName(p.why)}`, ms: p.ms, state: p.n.state, bound: p.n.state === "partial" ? p.n.bound : undefined, reasons: p.why === "not_known" ? why.not_known.reasons.map((r) => r.reason) : [] };
        // A class is at most its time plus the time whose why is not known.
        if (p.why !== "not_known" && why.not_known.ms > 0) {
          seg.bound = "lower";
          seg.ceiling_ms = p.ms + why.not_known.ms;
        }
        waitSegs.push(seg);
      }
    }
    const nextSeg = idle.by.find((x) => x.key === "next_prompt");
    const WHY_NOTES = {
      absent: "Why the agent stopped before the waiting for the next prompt is not known yet: Desk does not publish it for this task, so that part is not split.",
      mismatch: "Desk's split of the waiting for the next prompt by why the agent stopped does not add up to it, so that part is not split.",
      unavailable: "Why the agent stopped is not measured for this task's waiting for the next prompt, so that part is not split.",
      ok: "Desk's split of the waiting for the next prompt by why the agent stopped does not match this bar's figure, so that part is not split.",
    };
    if (nextSeg && !waitSegs.some((x) => x.why)) notes.push(WHY_NOTES[why.state] || WHY_NOTES.unavailable);
    const share = (x) => ({ ...x, share: x.ms / lead });
    const groups = [
      { key: "working", label: "Working", ms: working, segments: workSegs.map(share) },
      { key: "waiting", label: "Waiting", ms: idle.value, segments: waitSegs.sort((a, b) => WAIT_KEYS.indexOf(a.cause) - WAIT_KEYS.indexOf(b.cause)).map(share) },
    ];
    // Each group's figure says "at least" or "at most" as the lede does.
    const wb = boundOf(workN);
    groups[0].qualifier = wb === "lower" ? "at least " : wb === "upper" ? "at most " : "";
    groups[1].qualifier = idle.bound === "upper" ? "at most " : idle.bound === "lower" ? "at least " : idle.bound === "unknown" ? "about " : "";
    return { state: "ok", total_ms: lead, groups, segments: [...groups[0].segments, ...groups[1].segments], partial, notes, lead_state: leadN.state, why_state: why.state };
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
    // A why lights every wait that holds some of it, not only those it tops.
    if (key === "wait_cause" && o.why && WHY_KEYS.includes(o.why)) return `.vsm-wait.has-why-${o.why}, .lad-high.has-why-${o.why}`;
    if (key === "why") return WHY_KEYS.includes(o.why) ? `.vsm-wait.has-why-${o.why}, .lad-high.has-why-${o.why}` : ".vsm-wait.has-next_prompt, .lad-high.has-next_prompt";
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
    // Two groups: finished tasks (done or cancelled, labeled for waste or
    // not), the latest first; then tasks still open, the latest to start
    // first, those with no facts last. A finished task not labeled yet
    // carries `unlabeled`, for its badge.
    const finished = (j) => (j.status === "done" || j.status === "cancelled") && pos(j) > 0;
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
          unlabeled: finished(j) && j.finish_basis !== "labels",
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

  // Where a wait sits among the map's boxes, in words.
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
  // the intervals behind a stretch (kind, tool kind, outcome, lane). A wait
  // and a waiting stretch carry their start and end on the task clock like
  // any other item; only the short waits folded inside a box, which are
  // spread through it, are given their length alone.
  function drawer(thing, ctx) {
    const c = ctx || {};
    if (thing.kind === "prompt" || thing.kind === "pr") return clockDrawer(thing, c);
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
      rows.push(["On the task clock", clockWords(s.start_ms, s.end_ms, c.origin_ms)]);
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
          ...(it.inner_by && it.inner_by.next_prompt > 0 ? whyRows(it.inner_why_by, it.stops, it.why_reasons, c.lead_ms) : []),
        ],
        evidence: [],
      };
    }
    const rows = [
      ["Which", `${range(it.gap_range, "Gap", "Gaps")}${c.model ? `, ${waitPlace(c.model, it)}` : ""}`],
      ["What it is", it.count === 1 ? "A wait: no agent of this task was working" : `${it.count} waits in a row, with no work between them`],
      ["On the task clock", clockWords(it.start_ms, it.end_ms, c.origin_ms)],
      ["Waited on", it.waited_on === "mixed" ? it.causes.map((k) => (it.by && it.by[k] > 0 ? `${waitedOnWords(k, "short")}, ${durationWords(it.by[k])}` : waitedOnWords(k, "short"))).join("; ") : waitedOnWords(it.waited_on, "long")],
      ["Length", `${durationWords(ms)} (${share(ms)})`],
    ];
    if (it.count > 1) rows.push(["Longest of them", durationWords(it.longest_ms)]);
    if (it.by && it.by.next_prompt > 0) rows.push(...whyRows(it.why_by, it.stops, it.why_reasons, c.lead_ms));
    // The drawer's swatch is the cause's own (the largest, for a mixed wait).
    return { title: `Wait: ${waitTitle(it)}`, segment: "waiting", cause: it.causes[0] || "unknown", why: it.waited_on === "next_prompt" ? it.why : null, rows, evidence: [] };
  }

  // The wait drawer's rows on why the agent stopped (addendum §4): the
  // item's next-prompt time by why, then each Desk wait it holds with its
  // why, who decided it and with what confidence, and the mechanical stop
  // facts. Never any text from the session. `whyOf` is the item's split
  // (null when Desk does not publish one), `stops` Desk's waits that
  // overlap it.
  function whyRows(whyOf, stops, reasons, leadMs) {
    const rows = [];
    if (!whyOf) {
      rows.push(["Why the agent stopped", NOT_KNOWN_WHY]);
      return rows;
    }
    const parts = WHY_KEYS.filter((k) => whyOf[k] > 0).map((k) => `${k === "not_known" ? `why not known (${(reasons || []).map(whyReasonWords).join("; ") || "its reason not recorded"})` : whyName(k).toLowerCase()}, ${durationWords(whyOf[k])}`);
    rows.push(["Why the agent stopped", parts.length ? parts.join("; ") : "no waiting for the next prompt here"]);
    const ss = Array.isArray(stops) ? stops : [];
    ss.forEach((w, k) => {
      const tag = ss.length > 1 ? `Stop ${k + 1} of ${ss.length}: ` : "Stop: ";
      const why = w.why && w.why !== "not_known" && WHY_WORDS[w.why] ? WHY_WORDS[w.why] : `not known (${(Array.isArray(w.reasons) && w.reasons.length ? w.reasons : ["stop_not_recorded"]).map(whyReasonWords).join("; ")})`;
      // One stop whose class is the whole split says it once, in the row
      // above, with the class's meaning (A1 M10).
      const classes = WHY_KEYS.filter((x) => whyOf[x] > 0);
      const same = ss.length === 1 && classes.length === 1 && classes[0] === (w.why && WHY_WORDS[w.why] ? w.why : "not_known");
      if (!same) rows.push([`${tag}why`, why]);
      else if (classes[0] !== "not_known") rows[0] = [rows[0][0], `${rows[0][1]} (${why})`];
      rows.push([`${tag}decided by`, whySourceWords(w.why_source)]);
      rows.push([`${tag}confidence`, w.why_source === "none" ? "none: not classified" : confidenceText(w.confidence)]);
      rows.push([`${tag}how the turn ended`, stopWords(w) || "not recorded: these facts carry no stop"]);
      if (isMs(w.next_prompt_ms)) rows.push([`${tag}counted as waiting`, `${durationWords(w.next_prompt_ms)}${isMs(leadMs) && leadMs > 0 ? ` (${pctWords(w.next_prompt_ms / leadMs)} of the lead time)` : ""}`]);
    });
    return rows;
  }

  // ------------------------------------------- the human-agent clock (views)

  // Operator prompts and pull request times on the task clock (design v1.1
  // addendum §3): where each sits on the map and its ladder, the Handoffs
  // table, the swimlane's Operator and Pull requests lanes, and their
  // drawers. A prompt is a time and two size classes, never its text. A
  // pull request time is drawn only where the map file places it; one with
  // no placed time is listed at task level with its reason, never drawn.

  // A size class of a character count (Desk's sizeClass), in words.
  const SIZE_WORDS = {
    none: "none",
    xs: "very short (1 to 20 characters)",
    s: "short (21 to 200 characters)",
    m: "medium (201 to 1,000 characters)",
    l: "long (1,001 to 5,000 characters)",
    xl: "very long (over 5,000 characters)",
  };
  function sizeWords(c) {
    return SIZE_WORDS[c] || "not recorded";
  }

  // The operator's own time on one task, for its page: the Store's
  // attention estimate (Desk's per-task estimate of the operator's reading
  // and answering time, data.json `jobs[].attention_ms`, the figure the
  // Store page averages over delivered tasks) and the prompts it rests on
  // (`jobs[].human_turns`, with the map's per-prompt size classes and the
  // size of the output the operator read before each). Time the task spent
  // waiting for the next prompt is never called attention. `words` turns a
  // reason code into words; `core` does the same without the direction a
  // reason claims, for a figure whose direction is not known. Returns
  // { state: "ok" | "none", attention, text }.
  const SIZE_SHORT = { xs: "very short", s: "short", m: "medium", l: "long", xl: "very long" };
  const SIZE_ORDER = ["xs", "s", "m", "l", "xl"];
  function sizeList(classes) {
    const n = new Map();
    for (const c of classes) if (SIZE_SHORT[c]) n.set(c, (n.get(c) || 0) + 1);
    const parts = [...n].sort((a, b) => b[1] - a[1] || SIZE_ORDER.indexOf(a[0]) - SIZE_ORDER.indexOf(b[0])).map(([c, k]) => `${k} ${SIZE_SHORT[c]}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
  }
  function operatorTime(job, turns, turnsState, words, core) {
    const say = typeof words === "function" ? words : (c) => String(c).replace(/_/g, " ");
    const plain = typeof core === "function" ? core : say;
    const list = (Array.isArray(turns) ? turns : []).filter((t) => t && typeof t === "object");
    const why = (x, fn) => (x.reasons.length ? x.reasons.map(fn).join("; ") : say("not_recorded"));
    const dir = (x) => (x.state !== "partial" ? "" : x.bound === "lower" ? "at least " : x.bound === "upper" ? "at most " : "about ");
    const count = stated(job && job.human_turns);
    let promptText;
    if (count.state === "unavailable") promptText = null;
    else if (count.value === 0 && count.state === "partial" && count.bound !== "upper") promptText = `No prompt from the operator is recorded for this task (${why(count, say)}).`;
    else {
      const n = count.value;
      const sizes = list.length === n ? sizeList(list.map((t) => t.prompt_class)) : "";
      const read = list.length === n ? list.filter((t) => SIZE_SHORT[t.output_class]) : [];
      const outSizes = sizeList(read.map((t) => t.output_class));
      promptText = `The operator sent ${dir(count)}${n} prompt${n === 1 ? "" : "s"}${sizes ? ` (${sizes})` : ""}${read.length ? ` and read the agent's output before ${read.length} of them (${outSizes})` : ""}.`;
    }
    const att = stated(job && job.attention_ms);
    if (att.state === "unavailable") {
      const tail = promptText ? ` ${promptText}` : "; the prompts the operator sent are not recorded either.";
      return { state: "none", attention: null, text: `The store has no estimate of the operator's attention on this task, because ${why(att, plain)}${promptText ? "." : ""}${tail}` };
    }
    if (att.value === 0 && att.state === "partial" && att.bound !== "upper") {
      const head0 = promptText ? `${promptText} ` : "";
      return { state: "ok", attention: "none recorded", text: `${head0}The store's estimate of the operator's attention on this task, their reading and answering time, has no recorded prompt to rest on, so it reads none recorded; it is the same estimate the Store page averages over delivered tasks.` };
    }
    const value = `${dir(att)}${durationWords(att.value)}`;
    const known = att.state === "partial" && (att.bound === "lower" || att.bound === "upper");
    const note = att.state === "partial" ? ` (partial: ${known ? why(att, say) : `${why(att, plain)}; which way the true figure lies is not known`})` : "";
    const head = promptText ? `${promptText} ` : "";
    return { state: "ok", attention: value, text: `${head}The store's estimate of the operator's attention on this task, their reading and answering time, is ${value}${note}; it is the same estimate the Store page averages over delivered tasks.` };
  }

  // Why the agent stopped before a prompt (addendum §4's classes).
  const WHY_WORDS = {
    decision: "it needed a decision only the operator can make",
    approval: "it needed the operator's permission for its next action",
    acceptance: "it reported finished work for the operator's acceptance",
    question: "it needed information only the operator has",
    stopped_short: "it stopped short: its authorization covered the next step and nothing blocked it",
    error_limit: "its turn ended on an error or a limit",
    interrupted: "the operator interrupted it",
    unknown: "the evaluator looked and could not tell",
  };
  const STOP_END_WORDS = {
    end_turn: "it ended its turn normally",
    max_tokens: "it hit its output limit",
    rate_limit: "it hit a rate or usage limit",
    api_error: "the model request failed",
    refusal: "the model refused",
    interrupted: "the operator interrupted it",
    ask_question: "it asked a question through its question tool",
    ask_plan: "it asked for approval of a plan",
    not_recorded: "how it ended was not recorded",
  };
  const BASIS_WORDS = { first: "the session's first prompt", after_stop: "after the agent had stopped", mid_turn: "while the agent was still working" };

  // ------------------------------------------- why the agent stopped (§4)

  // Desk splits the task's waiting for the next prompt by why the agent
  // stopped (reports D5: `next_prompt_by_why_ms`, `not_known_by_reason_ms`,
  // `idle_by_why_ms` on gaps and bursts, `waits[].why`, and the sub-causes
  // `waiting:next_prompt:<why>` in rollups/causes.json). The keys, in the
  // order the page stacks them: the classes an agent-side kaizen can act on
  // first, then the human gates, then the time whose why is not known. The
  // page groups the gates; the data keeps them apart.
  const WHY_KEYS = ["stopped_short", "question", "error_limit", "interrupted", "decision", "approval", "acceptance", "not_known"];
  const WHY_CLASSES = WHY_KEYS.filter((k) => k !== "not_known");
  const WHY_GATES = ["decision", "approval", "acceptance"];
  const isWhy = (k) => WHY_KEYS.includes(k);
  function whyGroup(k) {
    if (WHY_GATES.includes(k)) return "gate";
    return k === "not_known" || !isWhy(k) ? "not_known" : "actionable";
  }
  // A class's name on a legend, a bar or a cause page.
  const WHY_NAMES = {
    stopped_short: "Stopped short",
    question: "Asked a question",
    error_limit: "Error or limit",
    interrupted: "Interrupted by the operator",
    decision: "Human gate: decision",
    approval: "Human gate: approval",
    acceptance: "Human gate: acceptance",
    not_known: "Why not known",
  };
  function whyName(k) {
    return WHY_NAMES[k] || WHY_NAMES.not_known;
  }
  // The triangle's words: "waiting for the next prompt: agent stopped short".
  const WHY_AGENT = {
    stopped_short: "agent stopped short",
    question: "agent asked a question",
    error_limit: "agent hit an error or a limit",
    interrupted: "operator interrupted the agent",
    decision: "agent asked for a decision",
    approval: "agent asked for approval",
    acceptance: "agent asked for acceptance",
  };
  // The lede's words: "after it stopped short of what it could have done".
  const WHY_AFTER = {
    stopped_short: "after it stopped short of what it could have done",
    question: "after it asked for information only the operator has",
    error_limit: "after its turn ended on an error or a limit",
    interrupted: "after the operator interrupted it",
    decision: "after it asked for a decision only the operator can make",
    approval: "after it asked permission for its next action",
    acceptance: "after it reported finished work for acceptance",
  };
  // Why a why is not known, in a few words (Desk's NOT_KNOWN_REASONS), for
  // labels; format.js REASON_TEXT holds the full sentence for each.
  const WHY_REASON_KEYS = ["not_labeled", "could_not_tell", "stop_not_recorded", "outside_own_share", "not_in_published_facts"];
  const WHY_REASON_WORDS = {
    not_labeled: "not labeled yet",
    could_not_tell: "the evaluator could not tell",
    stop_not_recorded: "the stop was not recorded",
    outside_own_share: "outside this task's own part of the session",
    not_in_published_facts: "older facts record no stop",
    stop_partly_classified: "why is not known for part of this waiting",
  };
  function whyReasonWords(r) {
    return WHY_REASON_WORDS[r] || String(r).replace(/_/g, " ");
  }
  function whyTriangle(why, reasons) {
    if (why && why !== "not_known" && WHY_AGENT[why]) return `waiting for the next prompt: ${WHY_AGENT[why]}`;
    const rs = Array.isArray(reasons) && reasons.length ? reasons.map(whyReasonWords).join("; ") : "its reason not recorded";
    return `waiting for the next prompt: why not known (${rs})`;
  }
  // Who decided a wait's why (Desk's why_source), and its confidence; a
  // low-confidence label keeps its class and is marked not sound, as the
  // waste table does.
  const WHY_SOURCE_WORDS = { rule: "a rule, from how the turn ended", evaluator: "the evaluator's label", none: "no one: it is not classified" };
  function whySourceWords(src) {
    return WHY_SOURCE_WORDS[src] || "not recorded";
  }
  function confidenceText(c) {
    if (typeof c !== "string" || !c) return "not stated";
    return c === "low" ? "low (not sound)" : c;
  }

  // A class figure with its bound (addendum §4, Bounds): "at least X (up
  // to Y)" while some time has no known why (Y is X plus that time), else
  // X alone. `fmt` turns milliseconds into words.
  function boundedWords(ms, ceilingMs, fmt) {
    const f = typeof fmt === "function" ? fmt : durationWords;
    return typeof ceilingMs === "number" && ceilingMs - ms > SECOND ? `at least ${f(ms)} (up to ${f(ceilingMs)})` : f(ms);
  }

  // "at least ", "at most ", "about " or "" for a stated figure.
  function qualOf(n) {
    if (!n || n.state !== "partial") return "";
    return n.bound === "upper" ? "at most " : n.bound === null ? "about " : "at least ";
  }

  // A task row's waiting for the next prompt, split by why (Desk D5):
  //   { state: "absent", total }        Desk does not publish the split
  //   { state: "unavailable", reasons } the waiting is not measured
  //   { state: "mismatch", total, sum } the parts do not add up to it
  //   { state: "ok", total, parts, top, not_known, classified_ms, template }
  // `parts` are the keys with time, in WHY_KEYS order, each { why, ms, n }
  // with `n` its stated figure; `top` the classes by time, largest first;
  // `not_known` { ms, n, reasons: [{ reason, ms }] }. `template` picks the
  // lede: "all" classified, "partly", or none classified because
  // "not_labeled", "not_recorded" or otherwise "not_known"; "none" when
  // there is no such waiting.
  function nextPromptWhy(row) {
    const total = row && row.waiting_by_waited_on_ms ? stated(row.waiting_by_waited_on_ms.next_prompt) : { state: "unavailable", reasons: ["not_recorded"] };
    const src = row && row.next_prompt_by_why_ms;
    if (!src || typeof src !== "object" || Array.isArray(src)) return { state: "absent", total };
    if (total.state === "unavailable") return { state: "unavailable", total, reasons: total.reasons };
    const figs = WHY_KEYS.map((why) => ({ why, n: stated(src[why]) }));
    const missing = figs.filter((x) => x.n.state === "unavailable");
    if (missing.length) return { state: "unavailable", total, reasons: [...new Set(missing.flatMap((x) => x.n.reasons))] };
    const sum = figs.reduce((a, x) => a + x.n.value, 0);
    if (Math.abs(sum - total.value) > SECOND) return { state: "mismatch", total, sum };
    const parts = figs.filter((x) => x.n.value > 0).map((x) => ({ why: x.why, ms: x.n.value, n: x.n }));
    const top = parts.filter((x) => x.why !== "not_known").sort((a, b) => b.ms - a.ms || WHY_KEYS.indexOf(a.why) - WHY_KEYS.indexOf(b.why));
    const nk = figs.find((x) => x.why === "not_known").n;
    const byReason = row.not_known_by_reason_ms && typeof row.not_known_by_reason_ms === "object" ? row.not_known_by_reason_ms : {};
    const reasons = Object.entries(byReason)
      .map(([reason, x]) => ({ reason, ms: val(x) }))
      .filter((x) => x.ms !== null && x.ms > 0)
      .sort((a, b) => b.ms - a.ms || WHY_REASON_KEYS.indexOf(a.reason) - WHY_REASON_KEYS.indexOf(b.reason));
    const classified = top.reduce((a, x) => a + x.ms, 0);
    let template = "partly";
    if (total.value <= 0 || sum <= 0) template = "none";
    else if (nk.value <= 0) template = "all";
    else if (classified <= 0) {
      const rs = reasons.map((x) => x.reason);
      if (rs.length && rs.every((r) => r === "not_labeled")) template = "not_labeled";
      else if (rs.length && rs.every((r) => r === "stop_not_recorded" || r === "not_in_published_facts")) template = "not_recorded";
      else template = "not_known";
    }
    return { state: "ok", total, parts, top, not_known: { ms: nk.value, n: nk, reasons }, classified_ms: classified, template };
  }

  // The not-known reasons in words: one reason alone, or each with its time.
  function notKnownWords(nk) {
    const rs = (nk && nk.reasons) || [];
    if (!rs.length) return "its reason not recorded";
    if (rs.length === 1) return whyReasonWords(rs[0].reason);
    return rs.map((x) => `${whyReasonWords(x.reason)}, ${durationWords(x.ms)}`).join("; ");
  }

  // The lede's sentence on why the agent stopped (addendum §4), one
  // template per state, as parts (strings and number tokens). `nextMs` is
  // the task's waiting for the next prompt as the lede counts it (for the
  // "not known yet" sentence when Desk publishes no split).
  function whyLedeParts(split, nextMs, tok) {
    const t = tok || ((key, text, extra) => ({ key, text, ...(extra || {}) }));
    const s = split || { state: "absent" };
    if (s.state === "absent") {
      if (!(nextMs > 0)) return [];
      return [` Why the agent stopped before the ${durationWords(nextMs)} it waited for the operator's next prompt is not known yet: Desk does not publish it for this task, so that waiting is not split.`];
    }
    if (s.state === "mismatch") return [` Why the agent stopped is published for this task, but its parts do not add up to its ${durationWords(s.total.value)} of waiting for the next prompt, so no split is shown.`];
    if (s.state !== "ok" || s.template === "none") return [];
    const q = qualOf(s.total);
    const totalW = `${q}${durationWords(s.total.value)}`;
    if (s.template === "not_labeled") return [` Why the agent stopped before its ${totalW} of waiting for the operator's next prompt is not known yet: the evaluator has not labeled those stops.`];
    if (s.template === "not_recorded") return [` Why the agent stopped before its ${totalW} of waiting for the operator's next prompt is not known: ${notKnownWords(s.not_known)}.`];
    if (s.template === "not_known") return [` Why the agent stopped before its ${totalW} of waiting for the operator's next prompt is not known (why: ${notKnownWords(s.not_known)}).`];
    const out = [` Of the ${totalW} it waited for the operator's next prompt, `];
    const shown = s.top.slice(0, 3);
    const rest = s.top.slice(3);
    // While some of it has no known why, each class is at least its figure
    // and at most its figure plus the time not known (addendum §4, Bounds).
    const nkMs = s.not_known.ms > 0 ? s.not_known.ms : 0;
    const fig = (ms, n) => (nkMs > 0 ? boundedWords(ms, ms + nkMs, durationWords) : `${qualOf(n)}${durationWords(ms)}`);
    shown.forEach((x, i) => {
      const qq = nkMs > 0 ? "at least " : qualOf(x.n);
      if (i > 0) out.push(i === shown.length - 1 && !rest.length && s.template === "all" ? ", and " : ", ");
      out.push(t("why", fig(x.ms, x.n), { why: x.why, q: qq }), ` ${i === 0 ? "came " : ""}${WHY_AFTER[x.why]}`);
    });
    if (rest.length) {
      const ms = rest.reduce((a, x) => a + x.ms, 0);
      out.push(`${s.template === "all" ? ", and " : ", "}${fig(ms, rest[0].n)} after ${rest.length} other kind${rest.length === 1 ? "" : "s"} of stop`);
    }
    if (s.template === "partly") out.push(", and ", t("why", `${qualOf(s.not_known.n)}${durationWords(s.not_known.ms)}`, { why: "not_known" }), ` is not known (why: ${notKnownWords(s.not_known)})`);
    out.push(".");
    return out;
  }

  const isMs = (x) => typeof x === "number" && Number.isFinite(x);

  // A time on the task clock in words: "3 hours after the task's start".
  function clockAt(ms, origin) {
    const x = ms - (isMs(origin) ? origin : 0);
    if (x === 0) return "at the task's start";
    return x < 0 ? `${durationWords(-x)} before the task's start` : `${durationWords(x)} after the task's start`;
  }

  // Where a time on the task clock sits on the map: the item that holds it
  // and how far through it (0 to 1). Items tile the lead window, so a time
  // that ends one item starts the next: a prompt that ends a wait sits at
  // the start of the box after it. A time outside the lead window sits at
  // the nearest end and says which (`outside`). Null when there is no time.
  function placeOnMap(model, ms) {
    const items = (model && model.items) || [];
    if (!isMs(ms) || !items.length) return null;
    const first = items[0];
    const last = items[items.length - 1];
    if (ms < first.start_ms) return { item: 0, frac: 0, outside: "before" };
    if (ms > last.end_ms) return { item: items.length - 1, frac: 1, outside: "after" };
    let i = items.findIndex((it) => ms >= it.start_ms && ms < it.end_ms);
    if (i < 0) i = items.length - 1;
    const it = items[i];
    const span = it.end_ms - it.start_ms;
    return { item: i, frac: span > 0 ? Math.min(1, Math.max(0, (ms - it.start_ms) / span)) : 0, outside: null };
  }

  // Every mark the clock views draw, from the map file (factory.site.map/2)
  // and the map's model:
  //   prompts: [{ n, total, idx, turn, ms, item, frac, outside, wait, why }]
  //     in clock order (n is 1-based; idx is the turn's index in the file);
  //     `wait` is Desk's wait the prompt ends (same session, end_ms ==
  //     at_ms), or null; `why` is the turn's, else the wait's, else
  //     "not_known".
  //   prs: [{ kind: "opened"|"merged", pr, k, ms, item, frac, outside, state, bound }]
  //     one per placed time, in clock order; `state` and `bound` are the
  //     time's own (a partial time is drawn as partial).
  //   unplaced: [{ pr, k, what: "opened"|"merged", reasons }]: times the
  //     map file does not place, listed at task level and never drawn.
  //   by_item: { item: [index into prompts] }, the map's top row.
  function clockMarks(map, model) {
    const mp = map || {};
    const turns = Array.isArray(mp.human_turns) ? mp.human_turns : [];
    const waits = Array.isArray(mp.waits) ? mp.waits.filter((w) => w && typeof w === "object") : [];
    const prs = Array.isArray(mp.prs) ? mp.prs : [];
    const sessionEnd = new Map((Array.isArray(mp.sessions) ? mp.sessions : []).filter((x) => x && isMs(x.end_ms)).map((x) => [x.id, x.end_ms]));
    const waitOf = (t) => waits.find((w) => w.session === t.session && w.end_ms === t.at_ms) || null;
    // How far outside the lead window a time lies (0 inside it).
    const items = (model && model.items) || [];
    const stepOf = (at, ms) => {
      if (at.outside || !items[at.item]) return { step: null, step_frac: null };
      const sp = stepPlace(items[at.item], ms);
      return sp ? { step: sp.step, step_frac: sp.frac } : { step: null, step_frac: null };
    };
    const outsideMs = (ms, at) => (!at || !at.outside || !items.length ? 0 : at.outside === "before" ? items[0].start_ms - ms : ms - items[items.length - 1].end_ms);
    const prompts = turns
      .map((turn, idx) => ({ turn, idx }))
      .filter((x) => x.turn && isMs(x.turn.at_ms))
      .sort((a, b) => a.turn.at_ms - b.turn.at_ms || a.idx - b.idx)
      .map(({ turn, idx }, i, all) => {
        const at = placeOnMap(model, turn.at_ms) || { item: 0, frac: 0, outside: null };
        const wait = waitOf(turn);
        const why = typeof turn.why === "string" ? turn.why : wait && typeof wait.why === "string" ? wait.why : "not_known";
        return { n: i + 1, total: all.length, idx, turn, ms: turn.at_ms, item: at.item, frac: at.frac, ...stepOf(at, turn.at_ms), outside: at.outside, outside_ms: outsideMs(turn.at_ms, at), wait, why };
      });
    // How long the task was idle before each prompt, as the map counts it.
    const listOf = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : []);
    const gapsL = listOf(mp.gaps);
    const burstsL = listOf(mp.bursts);
    const firstStart = items.length ? items[0].start_ms : null;
    const near = (a, b) => isMs(a) && Math.abs(a - b) <= 1000;
    for (const p of prompts) {
      const g = gapsL.find((x) => x && near(x.end_ms, p.ms) && isMs(x.start_ms));
      const b = g ? null : burstsL.find((x) => x && near(x.end_ms, p.ms) && isMs(x.start_ms));
      const bIdle = b ? (isMs(b.idle_ms) ? b.idle_ms : (() => { const w = stated(b.working_ms); return w.state === "unavailable" ? 0 : Math.max(0, b.end_ms - b.start_ms - w.value); })()) : 0;
      if (g) p.idle = { kind: "gap", ms: g.end_ms - g.start_ms };
      else if (b && bIdle > 0) p.idle = { kind: "burst", ms: bIdle };
      else if (isMs(firstStart) && p.ms <= firstStart) p.idle = { kind: "start", ms: 0 };
      else p.idle = { kind: "none", ms: 0 };
    }
    // How long the agent then worked: to its next stop in the same session
    // (the next after-stop prompt's time minus its wait), or it was still
    // working at the next prompt, or no later prompt came.
    prompts.forEach((p, i) => {
      const next = prompts.slice(i + 1).find((q) => q.turn.session === p.turn.session);
      if (!next) {
        const end = sessionEnd.get(p.turn.session);
        p.worked = { kind: "last", ms: isMs(end) && end >= p.ms ? end - p.ms : null };
      } else if (next.turn.basis === "after_stop" && isMs(next.turn.window_ms)) p.worked = { kind: "until_stop", ms: Math.max(0, next.ms - next.turn.window_ms - p.ms) };
      else if (next.turn.basis === "mid_turn") p.worked = { kind: "until_prompt", ms: next.ms - p.ms };
      else p.worked = { kind: "not_recorded", ms: null };
    });
    const by_item = {};
    prompts.forEach((p, i) => {
      if (p.outside) return;
      if (!by_item[p.item]) by_item[p.item] = [];
      by_item[p.item].push(i);
    });
    const marks = [];
    const unplaced = [];
    prs.forEach((pr, k) => {
      if (!pr || typeof pr !== "object") return;
      for (const [kind, ms, st] of [["opened", pr.opened_at_ms, pr.opened_state], ["merged", pr.merged_at_ms, pr.merged_state]]) {
        const s = st && typeof st === "object" ? st : { state: isMs(ms) ? "measured" : "unavailable", reasons: [] };
        if (isMs(ms)) {
          const at = placeOnMap(model, ms) || { item: 0, frac: 0, outside: null };
          marks.push({ kind, pr, k, ms, item: at.item, frac: at.frac, ...stepOf(at, ms), outside: at.outside, outside_ms: outsideMs(ms, at), state: s.state === "partial" ? "partial" : "measured", bound: s.state === "partial" ? (s.bound === "upper" || s.bound === "lower" ? s.bound : null) : null });
        } else if (kind === "opened" || pr.state === "merged") unplaced.push({ pr, k, what: kind, reasons: Array.isArray(s.reasons) ? s.reasons : [] });
      }
    });
    marks.sort((a, b) => a.ms - b.ms || a.k - b.k || (a.kind === "opened" ? -1 : 1));
    // An open task's map ends at its last recorded work.
    const lw = mp.lead_window || {};
    const open = (Array.isArray(lw.reasons) && lw.reasons.includes("censored")) || (mp.finish_date && Array.isArray(mp.finish_date.reasons) && mp.finish_date.reasons.includes("open_job"));
    return { prompts, prs: marks, unplaced, by_item, open: !!open };
  }

  // A time outside the task's lead window, in words, or null inside it.
  // `open`: the task has not finished, so its map ends at the last
  // recorded work, not at an end of its lead time.
  const afterEnd = (open) => (open ? "after the last recorded work" : "after the task's lead time ended");
  function outsideWords(ms, model, open) {
    const items = (model && model.items) || [];
    if (!isMs(ms) || !items.length) return null;
    const a = items[0].start_ms;
    const b = items[items.length - 1].end_ms;
    if (ms < a) return `${durationWords(a - ms)} before the task started`;
    if (ms > b) return `${durationWords(ms - b)} ${afterEnd(open)}`;
    return null;
  }

  // Where a time sits on its item's ladder steps: a box draws its working
  // time, then its folded waits; a wait draws one step. A time inside a
  // folded gap is on the folded step, at its share of the box's idle time
  // before it; any other time in a box is on the working step, at its share
  // of the box's working time before it; a time in a wait is at its share
  // of the wait's idle time before it. Returns { step, frac }.
  function stepPlace(it, ms) {
    const clamp = (x) => Math.min(1, Math.max(0, x));
    if (!it || !isMs(ms)) return null;
    if (it.type === "wait") {
      let before = 0;
      for (const g of it.gaps) {
        if (ms >= g.end_ms) before += g.end_ms - g.start_ms;
        else if (ms > g.start_ms) before += ms - g.start_ms;
      }
      return { step: "wait", frac: it.duration_ms > 0 ? clamp(before / it.duration_ms) : 0 };
    }
    const folded = it.folded || [];
    const inGap = folded.find((g) => ms >= g.start_ms && ms < g.end_ms);
    if (inGap && it.inner_wait_ms > 0) {
      let before = 0;
      for (const g of folded) {
        if (g === inGap) {
          before += ms - g.start_ms;
          break;
        }
        if (g.end_ms <= ms) before += g.end_ms - g.start_ms;
      }
      return { step: "fold", frac: clamp(before / it.inner_wait_ms) };
    }
    let before = 0;
    for (const b of it.bursts || []) {
      const w = stated(b.working_ms);
      const work = w.state === "unavailable" ? b.end_ms - b.start_ms : w.value;
      if (ms >= b.end_ms) before += work;
      else if (ms > b.start_ms && b.end_ms > b.start_ms) before += (work * (ms - b.start_ms)) / (b.end_ms - b.start_ms);
    }
    return { step: "work", frac: it.working_ms > 0 ? clamp(before / it.working_ms) : 0 };
  }

  const prName = (pr) => `${pr.repo}#${pr.number}`;
  // A pull request's first mark in words. Until Desk flags the pull
  // requests a session created (`created`), the mark is the time GitHub
  // says the pull request was opened, for a pull request that first
  // appeared in this task's sessions: opened there or only mentioned.
  function prEventWords(x) {
    if (x.kind === "merged") return "merged";
    return x.pr && x.pr.created === true ? "opened by this task" : "first appeared in this task's sessions (drawn at GitHub's opening time)";
  }
  const prKindShort = (x) => (x.kind === "merged" ? "merged" : x.pr && x.pr.created === true ? "opened" : "first appeared");
  const qualifier = (x) => (x.state === "partial" ? (x.bound === "upper" ? "at most " : x.bound === "lower" ? "at least " : "about ") : "");

  // From the first to the last time of a span, in words.
  function spanWords(a, b, origin) {
    const o = isMs(origin) ? origin : 0;
    const w = (x) => (x - o === 0 ? "0s" : durationWords(Math.abs(x - o)));
    if (w(a) === w(b)) return clockAt(a, o);
    return `from ${w(a)} to ${w(b)} after the task's start`;
  }

  // The merge rule, one statement for the legend, the drawers and the
  // tests: marks are grouped only where their drawn shapes would overlap.
  // `marks` carry `pos` (pixels along the lane); `w` is one mark's drawn
  // width; `badge(count)` is a merged mark's width (it shows a count).
  // A merged group covers its marks' span and is drawn at its middle, and
  // groups that would then overlap merge again, until none does. Returns
  // [{ from, to, pos, marks }] in position order.
  function groupMarks(marks, w, badge) {
    const bw = typeof badge === "function" ? badge : (n) => (n > 1 ? 16 + 7 * String(n).length : w);
    let groups = [...marks].sort((a, b) => a.pos - b.pos).map((m) => ({ from: m.pos, to: m.pos, marks: [m] }));
    const extent = (g) => {
      const mid = (g.from + g.to) / 2;
      const half = Math.max(g.marks.length > 1 ? bw(g.marks.length) : w, g.to - g.from + w) / 2;
      return [mid - half, mid + half];
    };
    for (let changed = true; changed; ) {
      changed = false;
      const out = [];
      for (const g of groups) {
        const prev = out[out.length - 1];
        if (prev && extent(prev)[1] > extent(g)[0]) {
          prev.to = Math.max(prev.to, g.to);
          prev.marks.push(...g.marks);
          changed = true;
        } else out.push({ ...g, marks: [...g.marks] });
      }
      groups = out;
    }
    return groups.map((g) => ({ ...g, pos: (g.from + g.to) / 2 }));
  }

  const TICK_PX = 3;
  const GLYPH_PX = 12;

  // What a group of prompts counts, in a few words and in full.
  function promptGroupWords(marks, origin) {
    if (marks.length === 1) {
      const why = marks[0].ref && marks[0].ref.why && marks[0].ref.why !== "not_known" && WHY_NAMES[marks[0].ref.why] ? `; why the agent had stopped: ${whyName(marks[0].ref.why).toLowerCase()}` : "";
      return { short: `prompt ${marks[0].n}`, label: `Operator prompt ${marks[0].n}, ${clockAt(marks[0].ms, origin)}${why}` };
    }
    const ns = marks.map((x) => x.n);
    const run = ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
    const which = ns.length === 2 ? `prompts ${ns[0]} and ${ns[1]}` : run ? `prompts ${ns[0]} to ${ns[ns.length - 1]}` : `prompts ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
    return { short: `${marks.length} prompts`, label: `${marks.length} prompts (${which}), ${spanWords(marks[0].ms, marks[marks.length - 1].ms, origin)}` };
  }
  // What a group of pull request times counts.
  function prGroupWords(marks, origin) {
    if (marks.length === 1) {
      const x = marks[0];
      return { short: `${prName(x.pr)} ${prKindShort(x)}`, label: `Pull request ${prName(x.pr)} ${prEventWords(x)}, ${qualifier(x)}${clockAt(x.ms, origin)}` };
    }
    const kinds = {};
    for (const x of marks) kinds[prKindShort(x)] = (kinds[prKindShort(x)] || 0) + 1;
    const keys = Object.keys(kinds);
    const short = keys.length === 1 ? `${marks.length} PRs ${keys[0]}` : `${marks.length} PR events: ${keys.map((k) => `${kinds[k]} ${k}`).join(", ")}`;
    // Up to six are named; a longer list is in the drawer.
    const list = marks.length <= 6 ? ` (${marks.map((x) => `${prName(x.pr)} ${prKindShort(x)}`).join(", ")})` : "";
    return { short, label: `${short}${list}, ${spanWords(marks[0].ms, marks[marks.length - 1].ms, origin)}` };
  }

  // One ladder mark in a list, with its time: "Prompt 3, 3 hours after the
  // task's start", "o/r#7 merged, at most 3.5 hours after the task's start".
  // The minute tells apart marks that round to the same words.
  function markLine(x, origin) {
    const o = isMs(origin) ? origin : 0;
    const min = ` (minute ${Math.round((x.ms - o) / MINUTE).toLocaleString("en-US")})`;
    if (x.kind === "prompt") return `Prompt ${x.n}, ${clockAt(x.ms, origin)}${min}`;
    return `${prName(x.pr)} ${prKindShort(x)}, ${qualifier(x)}${clockAt(x.ms, origin)}${min}`;
  }

  // The ladder's two lanes, a prompt lane and a pull request lane: each
  // mark inside its item's ladder, `sizes[item]` pixels long, grouped by
  // groupMarks (prompt ticks TICK_PX wide, pull request glyphs GLYPH_PX).
  // Prompts and pull request times are never counted together, and items
  // never merge. A time outside the lead window is never drawn at the
  // map's edge: it goes to `before` or `after`, a marked margin with how
  // far outside it lies. Returns { prompts: [group], prs: [group], before,
  // after }, each group { lane, item, from, to, pos, count, marks, short,
  // label }.
  function ladderLanes(clock, sizes, opts) {
    const o = opts || {};
    const c = clock || { prompts: [], prs: [] };
    const geo = (i) => (Array.isArray(sizes) ? sizes[i] : null);
    // A mark's position: inside its step's drawn range when the layout
    // gives the steps ({ work: [a, b], fold: [a, b] } or { wait: [a, b] }),
    // else along the item's whole length (a number).
    const place = (x) => {
      const g = geo(x.item);
      if (isMs(g)) return { step: x.step || "item", pos: x.frac * g };
      if (!g || typeof g !== "object") return { step: x.step || "item", pos: 0 };
      const step = g[x.step] ? x.step : g.work ? "work" : Object.keys(g)[0];
      const r = g[step] || [0, 0];
      const f = g[x.step] ? (isMs(x.step_frac) ? x.step_frac : 0) : x.frac;
      return { step, pos: r[0] + f * (r[1] - r[0]) };
    };
    const promptMarks = c.prompts.map((p) => ({ kind: "prompt", n: p.n, ms: p.ms, item: p.item, frac: p.frac, step: p.step, step_frac: p.step_frac, outside: p.outside, outside_ms: p.outside_ms || 0, ref: p }));
    const prMarks = c.prs.map((x) => ({ kind: x.kind, pr: x.pr, ms: x.ms, item: x.item, frac: x.frac, step: x.step, step_frac: x.step_frac, outside: x.outside, outside_ms: x.outside_ms || 0, state: x.state, bound: x.bound, ref: x }));
    const open = !!c.open;
    const lane = (marks, lname, w, words) => {
      const inside = marks.filter((x) => !x.outside);
      for (const x of inside) Object.assign(x, place(x));
      const out = [];
      // Marks group within one step of one item: a group never spans steps.
      const keys = [...new Set(inside.map((x) => `${x.item}|${x.step}`))].sort((a, b) => {
        const [ia] = a.split("|");
        const [ib] = b.split("|");
        return Number(ia) - Number(ib) || (inside.find((x) => `${x.item}|${x.step}` === a).pos - inside.find((x) => `${x.item}|${x.step}` === b).pos);
      });
      for (const key of keys) {
        const here = inside.filter((x) => `${x.item}|${x.step}` === key);
        for (const g of groupMarks(here, w, o.badge)) {
          const ms = [...g.marks].sort((a, b) => a.ms - b.ms);
          out.push({ lane: lname, item: here[0].item, step: here[0].step, from: g.from, to: g.to, pos: g.pos, count: ms.length, marks: ms, when: spanWords(ms[0].ms, ms[ms.length - 1].ms, o.origin), ...words(ms, o.origin) });
        }
      }
      return out;
    };
    const margin = (side) => {
      const ps = promptMarks.filter((x) => x.outside === side);
      const rs = prMarks.filter((x) => x.outside === side);
      const all = [...ps, ...rs];
      if (!all.length) return { prompts: ps, prs: rs, count: 0, marks: [], short: null, label: null, title: null, when: null };
      const far = all.map((x) => x.outside_ms).sort((a, b) => a - b);
      const parts = [ps.length ? `${ps.length} prompt${ps.length === 1 ? "" : "s"}` : null, rs.length ? `${rs.length} PR event${rs.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
      const one = far[0] === far[far.length - 1] || durationWords(far[0]) === durationWords(far[far.length - 1]);
      const word = side === "before" ? "before" : "after";
      const how = one ? `${durationWords(far[0])} ${word}` : `from ${durationWords(far[0])} to ${durationWords(far[far.length - 1])} ${word}`;
      const end = side === "before" ? "before the task started" : afterEnd(open);
      const title = side === "before" ? "Before the task started" : open ? "After the last recorded work" : "After the task's lead time ended";
      const when = one ? `${durationWords(far[0])} ${end}` : `from ${durationWords(far[0])} to ${durationWords(far[far.length - 1])} ${end}`;
      // Each kind on its own, for a margin's badges: prompts and pull
      // request times are never counted together.
      const kindOf = (list, noun) => {
        if (!list.length) return null;
        const f = list.map((y) => y.outside_ms).sort((a, b) => a - b);
        const same = f[0] === f[f.length - 1] || durationWords(f[0]) === durationWords(f[f.length - 1]);
        return { lane: noun === "prompt" ? "prompt" : "pr", count: list.length, marks: [...list].sort((a, b) => a.ms - b.ms), short: `${list.length} ${noun}${list.length === 1 ? "" : "s"}`, when: same ? `${durationWords(f[0])} ${end}` : `from ${durationWords(f[0])} to ${durationWords(f[f.length - 1])} ${end}` };
      };
      return { prompts: ps, prs: rs, count: all.length, marks: [...all].sort((a, b) => a.ms - b.ms), short: parts, title, when, label: `${title}: ${parts}, ${how}`, kinds: [kindOf(ps, "prompt"), kindOf(rs, "PR event")].filter(Boolean) };
    };
    return { prompts: lane(promptMarks, "prompt", TICK_PX, promptGroupWords), prs: lane(prMarks, "pr", GLYPH_PX, prGroupWords), before: margin("before"), after: margin("after") };
  }

  // The why a group of prompts is drawn with: theirs when every prompt
  // shares one, else not known.
  function groupWhy(prompts) {
    const ws = [...new Set((prompts || []).map((p) => p.why))];
    return ws.length === 1 && ws[0] ? ws[0] : "not_known";
  }

  // The one phrase for a why Desk does not publish yet, in the legend, the
  // Handoffs table, the drawer and the labels.
  const NOT_KNOWN_WHY = "not known yet: Desk does not publish why the agent stopped";
  // The legend's sentence about the prompt marks' color.
  function whyLegend(clock) {
    const ps = (clock && clock.prompts) || [];
    const known = ps.some((p) => p.why && p.why !== "not_known");
    if (!known && !ps.some((p) => p.wait && typeof p.wait.why === "string")) return `Why the agent stopped is ${NOT_KNOWN_WHY}, so every prompt is drawn in one color.`;
    if (!known) return "Why the agent stopped is not known for any prompt here, so every prompt is drawn in one color; each prompt's evidence says why it is not known.";
    return "Where a mark holds one prompt, it takes the color of why the agent had stopped before it, as in the key below; a dark gray one's why is not known, and a count badge holds several prompts. Each prompt's evidence and the Handoffs table name its why in words.";
  }
  // The classes the prompts of a clock carry, in WHY_KEYS order, for the
  // map's key.
  function whyKeysIn(clock) {
    const seen = new Set(((clock && clock.prompts) || []).map((p) => (p.why && isWhy(p.why) ? p.why : "not_known")));
    return WHY_KEYS.filter((k) => seen.has(k));
  }

  // The pull requests that first appeared in one map item: the same marks
  // the ladder's pull request lane draws there, as a stated number. It is a
  // lower bound when the task's pull request list is only partly recorded
  // or some pull request has no placed time.
  function boxPrCount(clock, item, prsState) {
    const c = clock || { prs: [], unplaced: [] };
    const n = c.prs.filter((x) => x.kind === "opened" && x.item === item && !x.outside).length;
    const reasons = new Set();
    if (prsState && prsState.state && prsState.state !== "measured") for (const r of prsState.reasons || []) reasons.add(r);
    if ((c.unplaced || []).some((u) => u.what === "opened")) reasons.add("pr_time_not_placed");
    return reasons.size ? { state: "partial", value: n, bound: "lower", reasons: [...reasons].sort() } : { state: "measured", value: n, reasons: [] };
  }

  // The wait before a prompt, in words, from Desk's window_ms.
  // How long the session's main agent had stopped before a prompt (its
  // stop-to-prompt window). Other agents of the task may have been working.
  function stoppedWords(turn) {
    if (!turn || turn.basis === "first") return "first prompt of the session";
    if (!isMs(turn.window_ms)) return "not recorded";
    if (turn.basis === "mid_turn") return `not stopped: it was still working, ${durationWords(turn.window_ms)} after the previous prompt`;
    return durationWords(turn.window_ms);
  }

  // How long the task was idle before a prompt (no agent of the task
  // working), as the map counts it: the gap that ends at the prompt; else,
  // when the burst before ends there, its idle time, which the map does not
  // place inside the burst; else none.
  function idleWords(p) {
    const x = p.idle || { kind: "none" };
    if (x.kind === "gap") return durationWords(x.ms);
    if (x.kind === "burst") return `at most ${durationWords(x.ms)} (idle inside the burst before it; when is not recorded)`;
    if (x.kind === "start") return "none: the task starts here";
    return "none: an agent of this task was working";
  }

  // The one sentence that tells the two waits apart.
  const HANDOFF_EXPLAIN = "Task idle before this prompt is the map's waiting: no agent of this task was working. Main agent stopped before this prompt is how long the session's main agent had stopped before the operator prompted it; other agents of this task may have been working in that time, so the map can count it as working.";

  // How long the agent worked after a prompt, in words.
  function workedWords(p) {
    const w = p.worked || { kind: "not_recorded" };
    if (w.kind === "until_stop") return `${durationWords(w.ms)}, then it stopped`;
    if (w.kind === "until_prompt") return `still working at the next prompt, ${durationWords(w.ms)} later`;
    if (w.kind === "last") return isMs(w.ms) ? `no later prompt in this session; it ended ${durationWords(w.ms)} later` : "no later prompt in this session";
    return "not recorded";
  }

  // The idle part of the wait before a prompt that counts as waiting.
  function countedWords(mark, leadMs) {
    const w = mark.wait;
    if (!w || !isMs(w.next_prompt_ms)) return "not recorded: Desk does not publish the wait before this prompt yet";
    const share = isMs(leadMs) && leadMs > 0 ? ` (${pctWords(w.next_prompt_ms / leadMs)} of the lead time)` : "";
    return `${durationWords(w.next_prompt_ms)}${share}`;
  }

  // Why the agent stopped before a prompt, with its source and confidence.
  function whyStopWords(mark, reasonText) {
    const words = typeof reasonText === "function" ? reasonText : (r) => String(r).replace(/_/g, " ");
    const t = mark.turn || {};
    if (t.basis === "first") return "no stop before it: the session's first prompt";
    if (t.basis === "mid_turn") return "no stop: the agent was still working";
    if (mark.why && mark.why !== "not_known" && WHY_WORDS[mark.why]) {
      const w = mark.wait || {};
      const src = w.why_source === "rule" ? "by rule, from how the turn ended" : w.why_source === "evaluator" ? "the evaluator's label" : null;
      const conf = typeof w.confidence === "string" ? `${confidenceText(w.confidence)} confidence` : null;
      const extra = [src, conf].filter(Boolean).join(", ");
      return `${WHY_WORDS[mark.why]}${extra ? ` (${extra})` : ""}`;
    }
    if (!mark.wait) return NOT_KNOWN_WHY;
    const rs = Array.isArray(mark.wait.reasons) ? mark.wait.reasons : [];
    return rs.length ? `not known (${rs.map((r) => (WHY_REASON_WORDS[r] ? whyReasonWords(r) : words(r))).join("; ")})` : "not known";
  }

  // How the agent's turn ended before a prompt (Desk's stop facts), or null.
  function stopWords(wait) {
    const st = wait && wait.stop && typeof wait.stop === "object" ? wait.stop : null;
    if (!st) return null;
    const parts = [STOP_END_WORDS[st.end] || STOP_END_WORDS.not_recorded];
    if (st.asks === true) parts.push("its last message ended with a question mark");
    else if (st.asks === false) parts.push("its last message did not end with a question mark");
    if (st.pending_agents === true) parts.push("some of its own background agents were still running");
    else if (st.pending_agents === false) parts.push("none of its own background agents was running");
    return parts.join("; ");
  }

  // The Handoffs table: one row per prompt, in clock order, the text
  // equivalent of the prompt markers. Columns that would read "not
  // recorded" in every row (the counted wait and why the agent stopped,
  // until Desk publishes its waits) are left out, and `note` says so once.
  // Returns { rows, show_counted, show_why, note }.
  function handoffTable(clock, origin, reasonText, leadMs) {
    const ps = (clock && clock.prompts) || [];
    const rows = ps.map((p) => ({
      n: p.n,
      session: String(p.turn.session || "").slice(0, 8),
      clock: clockAt(p.ms, origin),
      idle: idleWords(p),
      stopped: stoppedWords(p.turn),
      worked: workedWords(p),
      why: p.turn.basis !== "after_stop" ? "—" : whyStopWords(p, reasonText),
      prompt: sizeWords(p.turn.prompt_class),
      output: sizeWords(p.turn.output_class),
    }));
    const show_why = ps.some((p) => p.wait || (p.why && p.why !== "not_known"));
    const note = rows.length && !show_why ? "Desk does not publish why the agent stopped yet, so that column is left out until it does." : null;
    return { rows, show_why, note, explain: HANDOFF_EXPLAIN };
  }
  // The rows alone, for callers that draw every column.
  function handoffRows(clock, origin, reasonText, leadMs) {
    return handoffTable(clock, origin, reasonText, leadMs).rows;
  }

  // A list state (human_turns_state, prs_state) in words, or null when the
  // list is whole: a list that was not recorded never reads as empty.
  function clockListWords(st, noun, reasonText) {
    const words = typeof reasonText === "function" ? reasonText : (r) => String(r).replace(/_/g, " ");
    const s = st && typeof st === "object" ? st : { state: "unavailable", reasons: ["not_recorded"] };
    if (s.state === "measured") return null;
    const rs = (Array.isArray(s.reasons) && s.reasons.length ? s.reasons : ["not_recorded"]).map((r) => (r === "host_does_not_record" ? "the host does not record them" : words(r)));
    if (s.state === "partial") return `${noun} only partly recorded, so there may be more than these (${rs.join("; ")})`;
    return `${noun} not recorded (${rs.join("; ")})`;
  }

  // A time's words with how far outside the lead window it lies, if it does.
  // "Before the task started" is said once: the clock words already say
  // "before the task's start".
  function withOutside(text, ms, model, open) {
    const o = outsideWords(ms, model, open);
    return o && !/before the task started$/.test(o) ? `${text} (${o})` : text;
  }

  // A pull request time in words, with its direction when it is partial.
  function prTimeWords(ms, st, origin, reasonText) {
    const words = typeof reasonText === "function" ? reasonText : (r) => String(r).replace(/_/g, " ");
    const s = st && typeof st === "object" ? st : { state: isMs(ms) ? "measured" : "unavailable", reasons: [] };
    if (!isMs(ms)) {
      const rs = (Array.isArray(s.reasons) ? s.reasons : []).filter((r) => r !== "not_merged");
      return `not placed on the task clock${rs.length ? `: ${rs.map(words).join("; ")}` : ""}`;
    }
    const at = clockAt(ms, origin);
    if (s.state !== "partial") return at;
    if (s.bound === "upper") return `at most ${at}: it happened then or earlier`;
    if (s.bound === "lower") return `at least ${at}: it happened then or later`;
    return `about ${at}; which way it may be off is not known`;
  }

  // Where a mark sits on the map, in words.
  function markPlace(mark, model) {
    if (!model || !model.items || !model.items[mark.item]) return "";
    if (mark.outside === "before") return ", before the task's lead time began (drawn in the margin before the map)";
    if (mark.outside === "after") return ", after the task's lead time ended (drawn in the margin after the map)";
    const it = model.items[mark.item];
    if (it.type === "box") return `, ${mark.frac === 0 ? "at the start of" : "inside"} work box ${it.box_no}${model.box_count ? ` of ${model.box_count}` : ""}`;
    return `, inside the wait ${waitPlace(model, it)}`;
  }

  const ANCHOR_WORDS = (st) => `placed through the task's clock anchor${st && st.state === "measured" ? " (to within seconds)" : ""}`;
  function prBasisWords(basis, st, which) {
    if (basis === "desk") return "the session that opened it, which timed it";
    if (basis === "pr_anchor") return `GitHub's ${which} time, ${ANCHOR_WORDS(st)}`;
    if (basis === "not_merged") return null;
    return null;
  }
  // The map legend's line for the pull request marks, from the map's pull
  // requests: it names what Desk says of them (opened by the task, or only
  // mentioned) and admits not knowing only for records that do not say.
  function prLegendWords(prs) {
    const list = Array.isArray(prs) ? prs.filter((p) => p && typeof p === "object") : [];
    const opened = list.some((p) => p.created === true);
    const mentioned = list.some((p) => p.created === false);
    const unknown = list.some((p) => p.created !== true && p.created !== false);
    const tail = ", on the ladder's second lane at its opening time; a diamond is one merged.";
    if (!list.length) return `A pull request this task opened or mentioned${tail}`;
    if (!unknown && opened && !mentioned) return `A pull request this task opened${tail}`;
    if (!unknown && mentioned && !opened) return `A pull request this task's sessions mentioned${tail}`;
    if (!unknown) return `A pull request this task opened or only mentioned (its drawer says which)${tail}`;
    return `A pull request that first appeared in this task's sessions (opened there or mentioned; Desk does not say which for some older records, and the drawer says so)${tail}`;
  }
  // The caption over a task's pull request table: how many have a time on
  // the task clock, and a sentence about the unplaced ones only when there
  // are any (A1 M2).
  function prCaption(o) {
    const placed = o.placed;
    const total = o.total;
    const rest = total - placed;
    const head = `${placed} of ${total} pull request${total === 1 ? "" : "s"} ${total === 1 ? "has" : "have"} an opening time on the task clock.`;
    const anchor = o.anchorMeasured ? " GitHub's times are placed through the task's clock anchor, to within seconds." : "";
    const unplaced = rest > 0 ? ` The ${rest} with no placed time ${rest === 1 ? "is" : "are"} listed as "opened, time not recorded", with why, and ${rest === 1 ? "is" : "are"} not drawn.` : "";
    return `${head}${anchor}${unplaced}`;
  }
  // The lede's first words once the finish sentence leads it ("This task
  // finished on 6 Oct (UTC)." or "This task is still open."): "It took"
  // instead of "This task took", and an open task is not said to be open
  // twice (A1 M3).
  function afterFinish(text) {
    const t = String(text);
    if (t.startsWith("This task is still open. ")) return t.slice("This task is still open. ".length);
    return t.replace(/^This task took/, "It took");
  }
  // A prompt's UTC day for its drawer (A1 M5): "6 Oct (UTC)", or why the
  // day is not known.
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function promptDayWords(day, opts) {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "not known: the task's clock is not tied to the calendar (no pull request anchors it)";
    const d = new Date(`${day}T00:00:00Z`);
    const year = opts && Number.isInteger(opts.year) ? opts.year : new Date().getUTCFullYear();
    return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}${d.getUTCFullYear() === year ? "" : ` ${d.getUTCFullYear()}`} (UTC)`;
  }
  function prStateWords(pr) {
    const who = pr.created === true ? "A pull request this task opened" : pr.created === false ? "A pull request this task's sessions mentioned but did not open" : "A pull request that first appeared in this task's sessions (opened or mentioned; this older record does not say which)";
    const what = pr.state === "merged" ? "it merged" : pr.state === "open" ? "it is open" : pr.state === "closed" ? "it was closed without merging" : "its state could not be read from GitHub";
    return `${who}; ${what}`;
  }

  // The drawer's rows for a prompt (`thing.mark` from clockMarks) or a pull
  // request (`thing.pr`, `thing.k` from the map file's prs).
  function clockDrawer(thing, c) {
    const words = typeof c.reasonText === "function" ? c.reasonText : (r) => String(r).replace(/_/g, " ");
    if (thing.kind === "prompt") {
      const p = thing.mark;
      const t = p.turn || {};
      const rows = [
        ["What it is", `A prompt from the operator, ${BASIS_WORDS[t.basis] || "its relation to the agent's stop not recorded"}`],
        ["On the task clock", `${clockAt(p.ms, c.origin_ms)}${markPlace(p, c.model)}`],
        ["Day (UTC)", promptDayWords(t.day)],
        ["Session", `session ${String(t.session || "not recorded").slice(0, 8)}`],
        ["Task idle before this prompt", idleWords(p)],
        ["Main agent stopped before this prompt", stoppedWords(t)],
        ["Agent then worked", workedWords(p)],
      ];
      // Left out until Desk publishes the wait before the prompt.
      if (t.basis === "after_stop" && p.wait && isMs(p.wait.next_prompt_ms)) rows.push(["Counted as waiting", countedWords(p, c.lead_ms)]);
      rows.push(["Why the agent stopped", whyStopWords(p, words)]);
      const sw = t.basis === "after_stop" ? stopWords(p.wait) : null;
      if (sw) rows.push(["How the agent's turn ended", sw]);
      rows.push(["Prompt size", sizeWords(t.prompt_class)], ["Output the operator read", sizeWords(t.output_class)]);
      return { title: `Operator prompt ${p.n} of ${p.total}`, mark: "prompt", why: p.why, rows, evidence: [] };
    }
    const pr = thing.pr;
    const rows = [
      ["What it is", prStateWords(pr)],
      ["Opened", withOutside(prTimeWords(pr.opened_at_ms, pr.opened_state, c.origin_ms, words), pr.opened_at_ms, c.model, c.open)],
    ];
    const ob = prBasisWords(pr.opened_basis, pr.opened_state, "opening");
    if (ob) rows.push(["Opened, from", ob]);
    rows.push(["Merged", pr.state === "open" ? "not merged" : pr.state === "closed" ? "closed without merging" : withOutside(prTimeWords(pr.merged_at_ms, pr.merged_state, c.origin_ms, words), pr.merged_at_ms, c.model, c.open)]);
    const mb = prBasisWords(pr.merged_basis, pr.merged_state, "merge");
    if (mb) rows.push(["Merged, from", mb]);
    if (isMs(pr.opened_at_ms) && isMs(pr.merged_at_ms)) {
      const partial = [pr.opened_state, pr.merged_state].some((s) => s && s.state === "partial");
      rows.push(["Opening to merge", `${partial ? "about " : ""}${durationWords(pr.merged_at_ms - pr.opened_at_ms)}`]);
    }
    if (isMs(pr.uncertainty_ms)) rows.push(["How far off", `up to ${durationWords(pr.uncertainty_ms)}, as far as the task's pull requests show`]);
    const partialReasons = [...new Set([pr.opened_state, pr.merged_state].filter((s) => s && s.state === "partial").flatMap((s) => s.reasons || []))];
    if (partialReasons.length) rows.push(["Why partial", partialReasons.map(words).join("; ")]);
    return { title: `Pull request ${prName(pr)}`, mark: isMs(pr.merged_at_ms) ? "merged" : isMs(pr.opened_at_ms) ? "opened" : "pr", rows, evidence: [] };
  }

  // A minute on the task clock, for a prompt for an agent.
  const minuteAt = (ms, origin) => Math.round((ms - (isMs(origin) ? origin : 0)) / MINUTE);

  // promptItem for a prompt or a pull request.
  function clockPromptItem(thing, c) {
    if (thing.kind === "prompt") {
      const p = thing.mark;
      const t = p.turn || {};
      const after = t.basis === "after_stop" && isMs(t.window_ms) ? `, ${durationWords(t.window_ms)} after the main agent stopped` : t.basis === "mid_turn" && isMs(t.window_ms) ? `, ${durationWords(t.window_ms)} after the previous prompt` : "";
      return {
        what: `operator prompt ${p.n} of ${p.total} (${BASIS_WORDS[t.basis] || "relation to the agent's stop not recorded"})`,
        where: `It came at minute ${minuteAt(p.ms, c.origin_ms)} after the task's start${after}; the page never shows a prompt's text`,
        locator: `human_turns[${p.idx}]`,
        select: `prompt=${p.n}`,
      };
    }
    const pr = thing.pr;
    const q = (st) => (st && st.state === "partial" ? (st.bound === "upper" ? "at most " : st.bound === "lower" ? "at least " : "about ") : "");
    const verb = pr.created === true ? "opened" : "first appeared";
    const times = [];
    if (isMs(pr.opened_at_ms)) times.push([verb, q(pr.opened_state), minuteAt(pr.opened_at_ms, c.origin_ms)]);
    if (isMs(pr.merged_at_ms)) times.push(["merged", q(pr.merged_state), minuteAt(pr.merged_at_ms, c.origin_ms)]);
    // A time before the task's start reads as minutes before it, never a
    // negative minute.
    const at = ([v, qq, m]) => (m < 0 ? `${v} ${qq}${Math.abs(m).toLocaleString("en-US")} minutes before the task's start` : `${v} at ${qq}minute ${m.toLocaleString("en-US")} after the task's start`);
    let where = "Its times are not placed on the task clock";
    if (times.length && times.every((t) => t[2] >= 0)) where = `It was ${times.map(([v, qq, m]) => `${v} at ${qq}minute ${m.toLocaleString("en-US")}`).join(" and ")} after the task's start`.replace("It was first appeared", "It first appeared");
    else if (times.length) where = `It ${times.map(at).join(", and ")}`;
    return {
      what: `pull request ${prName(pr)}`,
      where,
      locator: `prs[${thing.k}]`,
      select: `pr=${thing.k + 1}`,
    };
  }

  // The swimlane's Operator lane for one session: a tick per prompt, and a
  // band from the agent's stop to the prompt where the agent had stopped.
  function operatorLane(clock, session) {
    return ((clock && clock.prompts) || [])
      .filter((p) => p.turn.session === session)
      .map((p) => ({ n: p.n, ms: p.ms, band: p.turn.basis === "after_stop" && isMs(p.turn.window_ms) ? [p.ms - p.turn.window_ms, p.ms] : null, mark: p }));
  }

  // The swimlane's Pull requests lane: every placed time inside the
  // session's span [t0, t1], and how many fall outside it.
  function prLane(clock, t0, t1) {
    const all = (clock && clock.prs) || [];
    const marks = all.filter((x) => x.ms >= t0 && x.ms <= t1);
    return { marks, outside: all.length - marks.length };
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
    if (thing.kind === "prompt" || thing.kind === "pr") return clockPromptItem(thing, c);
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
    // Where Desk splits its next-prompt time, the prompt names why the agent stopped.
    const whyMix = it.why_by && whysOf(it.why_by).length ? `; why the agent stopped: ${whysOf(it.why_by).sort((a, b) => it.why_by[b] - it.why_by[a] || WHY_KEYS.indexOf(a) - WHY_KEYS.indexOf(b)).map((k) => `${whyName(k).toLowerCase()}, ${durationWords(it.why_by[k])}`).join("; ")}` : "";
    return {
      what: `the wait ${c.model ? waitPlace(c.model, it) : ""} (gap${it.gap_range[0] === it.gap_range[1] ? "" : "s"} ${r(it.gap_range).replace("-", "–")}${total ? ` of ${total.gaps}` : ""}; waited on: ${it.waited_on === "mixed" ? "several causes" : waitedOnWords(it.waited_on, "short")}${whyMix})`.replace("wait  (", "wait ("),
      where: `It lasted ${durationWords(it.duration_ms)}, ${it.end_ms - it.start_ms < 2 * MINUTE ? `starting at minute ${Math.round((it.start_ms - (typeof c.origin_ms === "number" ? c.origin_ms : 0)) / MINUTE)} after the task's start` : minuteSpan(it.start_ms, it.end_ms, c.origin_ms)}`,
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

  // ------------------------------------------------ the PR clock (build time)

  // Each pull request's opened and merged times on the task clock, through
  // the task's clock anchor. Desk times a pull request on the task clock
  // (`timeline.prs[].at_ms`, the earliest timed mention in a session) and
  // publishes no wall-clock anchor; GitHub publishes `created_at` and
  // `merged_at`. For a pull request the task's session opened,
  // `created_at - at_ms` is the instant the task card was created, to within
  // seconds. One such value is a sample. Design: v1.1 addendum §2 and §3.
  //
  // A mention never comes before the pull request exists, so every sample
  // is at most the true anchor (give or take seconds of clock skew). That
  // gives each partial anchor built from mentions a direction: the anchor is
  // a lower bound, a time placed through it an upper bound ("at most"), and
  // a finish day derived from it a lower bound.
  //
  // The anchor is `measured` only when (a) Desk flags the pull requests
  // behind it as created by the session (`created`, facts /4), or (b) at
  // least 2 samples agree within ANCHOR_SPREAD_MS, they are a strict
  // majority of the readable samples, and no sample lies more than
  // ANCHOR_SPREAD_MS above them (a sample above the kept ones shows that the
  // true anchor is later still). Otherwise it is `partial`, with
  // `anchor_unconfirmed` or `anchor_spread`. A time is placed through a
  // partial anchor only when its error is known and at most
  // ANCHOR_PLACE_LIMIT_MS, and it then carries the anchor's reasons and
  // direction; one unconfirmed sample places nothing until Desk flags it.
  //
  // These run in the Pages build (pr-clock.mjs re-exports them); they live
  // here so the map file has one implementation.
  const ANCHOR_SPREAD_MS = 2 * MINUTE;
  // The map's work bursts split at 15 idle minutes, so a time that may be off
  // by more could sit beside the wrong box or wait.
  const ANCHOR_PLACE_LIMIT_MS = 15 * MINUTE;

  const prKey = (p) => `${p.repo}#${p.number}`;
  const finiteMs = (x) => typeof x === "number" && Number.isFinite(x);
  function timeOf(s) {
    const t = typeof s === "string" ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : null;
  }
  function medianOf(sorted) {
    const n = sorted.length;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  // Why GitHub gave no data for one pull request: the build read none at
  // all, the cap stopped it, or the read failed (offline, private, limited).
  function githubReason(p, gh, capped) {
    if (!gh) return "github_not_read";
    if (capped && capped.has(prKey(p))) return "github_lookup_capped";
    return "github_unreadable";
  }
  const infoOf = (p, gh, capped) => (gh && !(capped && capped.has(prKey(p))) ? gh.get(prKey(p)) || null : null);

  // A GitHub owner/name and a pull request number, as GitHub allows them: no
  // path segment, nothing that could reach another API path.
  const PR_REPO_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
  function validPr(repo, number) {
    return typeof repo === "string" && PR_REPO_SHAPE.test(repo) && Number.isSafeInteger(number) && number > 0;
  }

  // One entry per pull request, in Desk's order, keeping the earliest timed
  // mention; `created` is true if any entry says so, else false if any
  // says so, else null.
  function uniquePrs(prs) {
    const out = new Map();
    for (const p of Array.isArray(prs) ? prs : []) {
      if (!p || !validPr(p.repo, p.number)) continue;
      const k = prKey(p);
      const cur = out.get(k);
      const created = typeof p.created === "boolean" ? p.created : null;
      if (!cur) {
        out.set(k, { repo: p.repo, number: p.number, at_ms: finiteMs(p.at_ms) ? p.at_ms : null, created });
        continue;
      }
      if (finiteMs(p.at_ms) && (cur.at_ms === null || p.at_ms < cur.at_ms)) cur.at_ms = p.at_ms;
      if (created === true || (cur.created === null && created === false)) cur.created = created;
    }
    return [...out.values()];
  }

  // The task's clock anchor: { state, reasons, bound?, basis ("created" |
  // "timed"), n (samples kept), candidates (readable samples), dropped,
  // spread_ms (over every readable sample), kept_spread_ms, uncertainty_ms
  // (how far a placed time may be off, as far as the samples show),
  // value_ms }. `value_ms` is an epoch value for the build's own use; the
  // map file never holds it (prClock strips it). `gh` is Map "repo#number"
  // -> pulls API body (null when unreadable), or null when the build read
  // no GitHub data; `capped` is the set of keys the lookup cap stopped.
  function prAnchor(prs, gh, opts) {
    const capped = opts && opts.capped;
    const list = uniquePrs(prs);
    const flagged = list.some((p) => p.created !== null);
    const createdOnes = list.filter((p) => p.created === true);
    const basis = createdOnes.length || (flagged && list.every((p) => p.created !== null)) ? "created" : "timed";
    const pool = (basis === "created" ? createdOnes : list.filter((p) => p.created !== false)).filter((p) => p.at_ms !== null);
    if (!pool.length) return { state: "unavailable", reasons: [basis === "created" ? "no_created_timed_pr" : "no_timed_pr"], basis, n: 0 };
    const samples = [];
    const missing = new Set();
    for (const p of pool) {
      const t = timeOf(infoOf(p, gh, capped)?.created_at);
      if (t === null) missing.add(githubReason(p, gh, capped));
      else samples.push(t - p.at_ms);
    }
    if (!samples.length) return { state: "unavailable", reasons: [...missing].sort(), basis, n: 0 };
    samples.sort((a, b) => a - b);
    let kept = samples;
    if (basis === "timed") {
      const mid = medianOf(samples);
      const near = samples.filter((a) => Math.abs(a - mid) <= ANCHOR_SPREAD_MS);
      if (near.length) kept = near;
    }
    const keptSpread = kept[kept.length - 1] - kept[0];
    const top = samples[samples.length - 1];
    const out = {
      basis,
      n: kept.length,
      candidates: samples.length,
      dropped: samples.length - kept.length,
      spread_ms: top - samples[0],
      kept_spread_ms: keptSpread,
      // One unconfirmed sample cannot measure its own error: null, unknown.
      uncertainty_ms: basis === "timed" ? (samples.length < 2 ? null : top - kept[0]) : keptSpread,
      value_ms: Math.round(medianOf(kept)),
    };
    const reasons = [];
    if (keptSpread > ANCHOR_SPREAD_MS) reasons.push("anchor_spread");
    else if (basis === "timed") {
      const majority = kept.length >= 2 && kept.length * 2 > samples.length;
      const above = top > kept[kept.length - 1] + ANCHOR_SPREAD_MS;
      if (!majority || above) reasons.push("anchor_unconfirmed");
    }
    if (!reasons.length) return { state: "measured", reasons: [], ...out };
    return { state: "partial", bound: basis === "timed" ? "lower" : null, reasons, ...out };
  }

  // GitHub's state for a pull request: merged, open or closed; null unread.
  function prStateOf(info) {
    if (!info) return null;
    if (timeOf(info.merged_at) !== null || info.merged === true) return "merged";
    return info.state === "open" ? "open" : "closed";
  }

  // Each pull request placed on the task clock:
  //   { repo, number, created, opened_at_ms, opened_basis, opened_state,
  //     merged_at_ms, merged_basis, merged_state, state, reasons,
  //     uncertainty_ms? }
  // opened_basis: "desk" (the session timed the pull request it created),
  // "pr_anchor" (GitHub's created_at through the anchor) or "not_placed";
  // merged_basis: "pr_anchor", "not_merged" or "not_placed". Each time's
  // `_state` says whether it is measured, partial (with the direction the
  // true time lies) or unavailable (with why); `reasons` gathers them.
  // Nothing is invented: a time with no source is null.
  function placePrs(prs, gh, anchor, opts) {
    const capped = opts && opts.capped;
    const a = anchor || { state: "unavailable", reasons: ["no_timed_pr"] };
    const partialAnchor = a.state === "partial";
    // A partial anchor places nothing when its error is unknown (one
    // unconfirmed sample, which may be days off) or above the limit.
    const unknownError = partialAnchor && !finiteMs(a.uncertainty_ms);
    const tooWide = partialAnchor && (unknownError || a.uncertainty_ms > ANCHOR_PLACE_LIMIT_MS);
    const usable = a.state !== "unavailable" && finiteMs(a.value_ms) && !tooWide;
    // Why nothing was placed through the anchor, said about a pull request
    // GitHub did read: the anchor's own GitHub trouble is the anchor's.
    const noAnchor = tooWide
      ? [unknownError ? "anchor_unconfirmed" : "anchor_spread_too_wide"]
      : (a.state === "unavailable" ? a.reasons : ["no_timed_pr"]).map((r) => (r === "github_unreadable" || r === "github_lookup_capped" ? `anchor_${r}` : r));
    // A time placed through a partial anchor: its reasons, and its direction
    // (an anchor that is a lower bound places times that are upper bounds).
    const viaAnchor = () => (partialAnchor ? { state: "partial", bound: a.bound === "lower" ? "upper" : null, reasons: [...a.reasons] } : { state: "measured", reasons: [] });
    const none = (reasons) => ({ state: "unavailable", reasons: [...reasons] });
    return uniquePrs(prs).map((p) => {
      const info = infoOf(p, gh, capped);
      const ghMissing = info ? null : githubReason(p, gh, capped);
      let opened = null;
      let openedBasis = "not_placed";
      let openedState;
      const createdAt = timeOf(info && info.created_at);
      if (p.created === true && p.at_ms !== null) {
        opened = p.at_ms;
        openedBasis = "desk";
        openedState = { state: "measured", reasons: [] };
      } else if (createdAt !== null && usable) {
        opened = Math.round(createdAt - a.value_ms);
        openedBasis = "pr_anchor";
        openedState = viaAnchor();
      } else openedState = none(ghMissing ? [ghMissing] : noAnchor);
      const state = prStateOf(info);
      let merged = null;
      let mergedBasis = "not_placed";
      let mergedState;
      if (state === "open" || state === "closed") {
        mergedBasis = "not_merged";
        mergedState = none(["not_merged"]);
      } else if (state === "merged") {
        const t = timeOf(info.merged_at);
        if (t !== null && usable) {
          merged = Math.round(t - a.value_ms);
          mergedBasis = "pr_anchor";
          mergedState = viaAnchor();
          // The opening from the session and the merge through the anchor
          // use different clocks a few seconds apart; a merge never lands
          // before its opening, and the true merge is at least then. The
          // clamp adds its reason to the anchor's; it never replaces them.
          // If the merge placed through the anchor is itself an upper bound
          // ("at most", from an anchor that is a lower bound), the session's
          // opening says the opposite, so the direction is not known and is
          // published as unknown (clock_skew_conflict), never as "at least".
          if (opened !== null && merged < opened) {
            merged = opened;
            const conflict = mergedState.state === "partial" && mergedState.bound === "upper";
            mergedState = { state: "partial", bound: conflict ? null : "lower", reasons: [...new Set([...mergedState.reasons, conflict ? "clock_skew_conflict" : "clock_skew"])].sort() };
          }
        } else mergedState = none(t === null ? ["merged_time_not_recorded"] : noAnchor);
      } else mergedState = none([ghMissing]);
      const reasons = new Set([...openedState.reasons, ...mergedState.reasons].filter((r) => r !== "not_merged"));
      const out = { repo: p.repo, number: p.number, created: p.created, opened_at_ms: opened, opened_basis: openedBasis, opened_state: openedState, merged_at_ms: merged, merged_basis: mergedBasis, merged_state: mergedState, state, reasons: [...reasons].sort() };
      if (partialAnchor && (openedBasis === "pr_anchor" || mergedBasis === "pr_anchor")) out.uncertainty_ms = a.uncertainty_ms;
      return out;
    });
  }

  // The anchor as the map file states it (no epoch value) and every pull
  // request placed through it.
  function prClock(prs, gh, opts) {
    const a = prAnchor(prs, gh, opts);
    const { value_ms, ...anchor } = a;
    // The anchor's epoch value, for the build's own use only (each prompt's
    // UTC day); slimMap never writes it. Only a measured anchor gives days.
    const origin = a.state === "measured" && Number.isFinite(value_ms) ? { value_ms, uncertainty_ms: Number.isFinite(a.uncertainty_ms) ? a.uncertainty_ms : 0 } : null;
    return { anchor, prs: placePrs(prs, gh, a, opts), origin };
  }

  // The list states of a task's operator prompts and pull requests. Desk's
  // own envelopes (`human_turns_state`, `prs_state`, reports D4) win. Without
  // them the store states each list from its sessions' hosts, so a task with
  // no prompts recorded reads "not recorded", never "no prompts": Claude Code
  // records every prompt, Copilot only some, Codex none (Desk HOST_FLAGS), and
  // a Claude Code session with no prompt at all is one whose prompts were not
  // recorded (older facts). Every host records pull requests only partly.
  function clockListStates(timeline) {
    const t = timeline || {};
    const sessions = Array.isArray(t.sessions) ? t.sessions : [];
    const turns = Array.isArray(t.human_turns) ? t.human_turns : [];
    const desk = (e) => {
      if (!e || typeof e !== "object" || typeof e.state !== "string") return null;
      const out = { state: e.state, reasons: Array.isArray(e.reasons) ? e.reasons : [] };
      if (Object.prototype.hasOwnProperty.call(e, "bound")) out.bound = e.bound;
      if (typeof e.bound_reason === "string") out.bound_reason = e.bound_reason;
      return { ...out, basis: "desk" };
    };
    const fromHosts = (reasons, any) => {
      const r = [...reasons].sort();
      if (!any) return { state: "unavailable", reasons: r.length ? r : ["not_recorded"], basis: "store_from_hosts" };
      return r.length ? { state: "partial", bound: "lower", reasons: r, basis: "store_from_hosts" } : { state: "measured", reasons: [], basis: "store_from_hosts" };
    };
    const turnReasons = new Set();
    const withTurns = new Set(turns.map((x) => x && x.session));
    for (const s of sessions) {
      if (s.host === "claude-code") {
        if (!withTurns.has(s.id)) turnReasons.add("not_recorded");
      } else if (s.host === "copilot-cli") turnReasons.add("host_records_partly");
      else if (s.host === "codex-cli") turnReasons.add("host_does_not_record");
      else turnReasons.add("not_recorded");
    }
    const prReasons = new Set(["host_records_partly"]);
    if (sessions.some((s) => !["claude-code", "copilot-cli", "codex-cli"].includes(s.host))) prReasons.add("not_recorded");
    return {
      human_turns_state: desk(t.human_turns_state) || fromHosts(turnReasons, turns.length > 0),
      prs_state: desk(t.prs_state) || fromHosts(prReasons, true),
    };
  }

  // ------------------------------------------------- the map file (build time)

  // The map file for one task (map/<job>.json, factory.site.map/2), from its
  // full report jobs/<job>.json and the store's own fields. It keeps what the
  // landing view draws and drops the intervals (up to megabytes). Every time
  // is an offset on the task clock; no epoch value is written.
  //
  // `store` is { pr_clock, finish_date }: pr_clock is pr-clock.mjs prClock's
  // { anchor, prs } (each pull request's opened and merged times placed
  // through the task's clock anchor from GitHub), and finish_date the
  // store's resolved finish date. Without pr_clock (a build that read no
  // GitHub data), prClock runs with no GitHub data: a pull request is placed
  // only where the session timed one it created, and every other time is
  // null with the reason github_not_read: nothing is invented.
  //
  // Each operator prompt keeps Desk's fields and gains `why`, joined from
  // the wait it ends (Desk's timeline.waits[], by end_ms == at_ms in the
  // same session); null until Desk states one.
  function slimMap(report, store) {
    const t = (report && report.timeline) || {};
    const s = store || {};
    const arr = (x) => (Array.isArray(x) ? x : []);
    const items = (x) => (Array.isArray(x) ? x : x && typeof x === "object" && Array.isArray(x.items) ? x.items : []);
    const envelopeOf = (x, explicit) => {
      const e = explicit && typeof explicit === "object" ? explicit : x && typeof x === "object" && !Array.isArray(x) ? x : null;
      return e && typeof e.state === "string" ? { state: e.state, reasons: arr(e.reasons) } : { state: "measured", reasons: [] };
    };
    const waits = arr(t.waits).filter((w) => w && typeof w === "object");
    const waitEnding = new Map(waits.map((w) => [`${w.session}|${w.end_ms}`, w]));
    // Without the build's GitHub reads, the same placement with none:
    // only a pull request the session timed and created is placed.
    const clock = s.pr_clock && typeof s.pr_clock === "object" && Array.isArray(s.pr_clock.prs) ? s.pr_clock : prClock(t.prs, null);
    // A prompt's UTC day, where a measured anchor ties the task clock to the
    // calendar and the anchor's own uncertainty cannot move it across
    // midnight; else null (A1 M5). Only the day is written, never a time.
    const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
    const dayOf = (at) => {
      const o = clock.origin;
      if (!o || !isMs(at)) return null;
      const t = o.value_ms + at;
      const lo = utcDay(t - o.uncertainty_ms);
      return lo === utcDay(t + o.uncertainty_ms) ? lo : null;
    };
    return {
      schema: "factory.site.map/2",
      job: String((report && report.job && report.job.id) || t.job || ""),
      finish_date: s.finish_date && typeof s.finish_date === "object" ? s.finish_date : null,
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
        // Its next-prompt idle time by why the agent stopped (Desk D5), the
        // same way; absent until Desk publishes it.
        ...(b.idle_by_why_ms && typeof b.idle_by_why_ms === "object" ? { idle_by_why_ms: slimCauses(b.idle_by_why_ms) } : {}),
        sessions: arr(b.sessions),
        agents: b.agents,
        tool_calls: b.tool_calls,
        tool_failures: b.tool_failures,
        operator_turns: b.operator_turns,
        prs: b.prs,
        value_ms: b.value_ms,
        defect_ms: b.defect_ms,
        defect_stretches: b.defect_stretches,
      })),
      // A gap keeps Desk's per-gap split when Desk states one.
      gaps: items(t.gaps).map((g) => {
        const by = slimCauses(g.idle_by_waited_on_ms);
        const out = by && Object.keys(by).length ? { start_ms: g.start_ms, end_ms: g.end_ms, waited_on: g.waited_on, idle_by_waited_on_ms: by } : { start_ms: g.start_ms, end_ms: g.end_ms, waited_on: g.waited_on };
        if (g.idle_by_why_ms && typeof g.idle_by_why_ms === "object") out.idle_by_why_ms = slimCauses(g.idle_by_why_ms);
        return out;
      }),
      sessions: arr(t.sessions).map((x) => ({ id: x.id, host: x.host, offset_ms: x.offset_ms, end_ms: x.end_ms })),
      agents: arr(t.agents).map((a) => ({ session: a.session, n: a.n, parent: a.parent })),
      transitions: arr(t.transitions).map((x) => ({ offset_ms: x.offset_ms, to: x.to })),
      observations: arr(t.observations).map((x) => ({ offset_ms: x.offset_ms, status: x.status })),
      outcome: t.outcome && typeof t.outcome === "object" ? { state: t.outcome.state, deliveries: t.outcome.deliveries } : null,
      detail_files: arr(t.detail_files),
      ...clockListStates(t),
      human_turns: arr(t.human_turns)
        .filter((h) => h && typeof h === "object")
        .map((h) => {
          const w = waitEnding.get(`${h.session}|${h.at_ms}`);
          return { session: h.session, host: h.host, at_ms: h.at_ms, day: dayOf(h.at_ms), basis: h.basis, window_ms: h.window_ms, prompt_class: h.prompt_class, output_class: h.output_class, why: w && typeof w.why === "string" ? w.why : null };
        }),
      // Desk's waits (reports D4; `why` from D5), as Desk states them.
      waits: waits.map((w) => ({ session: w.session, start_ms: w.start_ms, end_ms: w.end_ms, next_prompt_ms: w.next_prompt_ms, stop: w.stop && typeof w.stop === "object" ? { end: w.stop.end, asks: w.stop.asks, pending_agents: w.stop.pending_agents } : null, why: w.why, why_source: w.why_source, confidence: w.confidence, reasons: w.reasons })),
      pr_anchor: clock.anchor,
      prs: clock.prs,
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
    boundedWords,
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
    clockListStates,
    clockAt,
    placeOnMap,
    clockMarks,
    ladderLanes,
    stepPlace,
    groupMarks,
    markLine,
    outsideWords,
    handoffTable,
    handoffRows,
    NOT_KNOWN_WHY,
    whyLegend,
    whyKeysIn,
    WHY_KEYS,
    WHY_CLASSES,
    WHY_GATES,
    WHY_REASON_KEYS,
    WHY_AFTER,
    WHY_WORDS,
    whyGroup,
    whyName,
    whyTriangle,
    whyReasonWords,
    whySourceWords,
    confidenceText,
    stopWords,
    qualOf,
    nextPromptWhy,
    whyLedeParts,
    whyRows,
    whyBy,
    groupWhy,
    boxPrCount,
    clockListWords,
    prTimeWords,
    operatorLane,
    prLane,
    sizeWords,
    operatorTime,
    prLegendWords,
    whyRows,
    promptDayWords,
    afterFinish,
    prCaption,
    prStateWords,
    ANCHOR_SPREAD_MS,
    ANCHOR_PLACE_LIMIT_MS,
    prKey,
    prAnchor,
    validPr,
    placePrs,
    prClock,
    slimMap,
  };
});
