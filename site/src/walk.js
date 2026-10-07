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
    next_prompt: { short: "waiting for the next prompt", long: "the agent had stopped and was waiting for the operator's next prompt" },
    api_retry: { short: "API retry", long: "the agent was waiting on retries of a failed model request" },
    tool_failure: { short: "after a failed tool call", long: "the agent was waiting after a tool call failed" },
    long_tool_call: { short: "long tool call", long: "a tool call of five minutes or more was running" },
    queue_before_start: { short: "queued before the first session", long: "the task was waiting for its first session to start" },
    no_session: { short: "no session running", long: "no session of this task was running" },
    unknown: { short: "cause not recorded", long: "nothing was running for this task, and what it waited on was not recorded" },
    mixed: { short: "several causes", long: "several waits with different causes, folded together" },
  };
  function waitedOnWords(key, which) {
    const w = WAITED_ON[key] || WAITED_ON.unknown;
    return which === "long" ? w.long : w.short;
  }

  // An evidence interval's kind, in words (Desk's interval kinds).
  const KIND_WORDS = { turn: "agent turn", tool: "tool call", subagent: "subagent", human_wait: "waiting for the operator", api_retry: "API retry" };

  // A waiting stretch's label on the swimlane.
  function waitLabel(key) {
    const w = waitedOnWords(key || "unknown", "short");
    return w.startsWith("waiting") ? w : `waiting: ${w}`;
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
      if (what === "next_prompt") return "Waiting for the next prompt (the agent had stopped)";
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
      return x.state === "unavailable" ? { state: "unavailable", reasons: Array.isArray(x.reasons) ? x.reasons : [] } : { state: x.state, value: v, reasons: Array.isArray(x.reasons) ? x.reasons : [] };
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
    return { state: "partial", value, bound: "lower", reasons };
  }

  // The largest of stated numbers, under the same rule.
  function maxStated(xs) {
    const s = sumStated(xs);
    if (s.state === "unavailable") return s;
    return { ...s, value: xs.map(stated).filter((x) => x.state !== "unavailable").reduce((a, x) => Math.max(a, x.value), 0) };
  }

  // A stated count or duration in a few words: "12", "at least 12", "no data".
  function statedText(n, kind) {
    const x = stated(n);
    if (x.state === "unavailable") return "no data";
    const t = kind === "duration" ? durationShort(x.value) : x.value.toLocaleString("en-US");
    return x.state === "partial" ? `at least ${t}` : t;
  }
  function statedWords(n) {
    const x = stated(n);
    if (x.state === "unavailable") return null;
    return `${x.state === "partial" ? "at least " : ""}${durationWords(x.value)}`;
  }

  // --------------------------------------------------------------- the lede

  const val = (n) => (n && n.state !== "unavailable" && typeof n.value === "number" && Number.isFinite(n.value) ? n.value : null);
  const has = (n, code) => !!(n && Array.isArray(n.reasons) && n.reasons.includes(code));

  // The lede for one task (design section 4): one paragraph, built from the
  // task's row in rollups/tasks.json, with one template per number state.
  // Returns { state, parts }: `parts` is a list of strings and number tokens
  // { key, text }; the page turns each token into a button that highlights
  // its part of the map. `reasonText` turns a reason code into words.
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
    const tok = (key, text) => ({ key, text });

    const lead = val(row.lead_time_ms);
    const leadW = lead === null ? null : durationWords(lead);
    const open = has(row.lead_time_ms, "censored");
    const fromFirst = has(row.lead_time_ms, "card_dates_shorter_than_work");

    // 1. Lead time.
    if (lead === null) {
      add(`This task's lead time is not measured, because ${reasons(row.lead_time_ms)}. So this view cannot say how much of its time was waiting.`);
    } else if (row.lead_time_ms.state === "measured") {
      add("This task took ", tok("lead", leadW), " from its card's creation to its end.");
    } else if (open) {
      add("This task is still open. So far it has taken at least ", tok("lead", leadW), fromFirst ? ", counted from its first session because the card was created after work began." : ".");
    } else if (fromFirst) {
      add("This task took at least ", tok("lead", leadW), ", counted from its first session because the card was created after work began.");
    } else {
      add("This task took ", tok("lead", leadW), `, a partial figure: ${reasons(row.lead_time_ms)}.`);
    }

    // 2. Working time, and how much of it the evaluator judged value-adding.
    const working = val(row.working_ms);
    const value = val(row.value_in_working_ms);
    if (working === null) {
      add(` How long agents were working is not measured, because ${reasons(row.working_ms)}.`);
    } else {
      add(` Agents were working for ${open ? "at least " : ""}`, tok("working", durationWords(working)), lead === null ? "" : " of it");
      if (value === null) {
        add(`; that work is not labeled yet (${reasons(row.value_in_working_ms)}), so how much of it added value is not known.`);
      } else {
        add("; the evaluator judged ", tok("value", durationWords(value)), " of that work value-adding, and the rest necessary steps, rework, or work not labeled.");
        if (row.labels_from_shared_session) add(" Those labels come from a session this task shared with other tasks, so that split is partial.");
      }
    }

    // 3. Waiting, in system terms: the largest labeled cause, then the
    // longest single wait and what it waited on.
    if (lead !== null && working !== null && lead > 0) {
      const waiting = Math.max(0, lead - working);
      const share = waiting / lead;
      const buckets = Object.entries(row.waiting_by_waited_on_ms || {})
        .map(([k, n]) => [k, val(n)])
        .filter(([, v]) => v !== null && v > 0)
        .sort((a, b) => b[1] - a[1]);
      if (share >= 0.5) add(` Most of the ${leadW} was waiting, not work: `, tok("waiting", durationWords(waiting)), " in all.");
      else add(" Of that time, ", tok("waiting", durationWords(waiting)), " was waiting.");
      if (buckets.length) {
        const [k, v] = buckets[0];
        const d = durationWords(v);
        const sentence = {
          next_prompt: ["For ", " of it, the agent had stopped and was waiting for the operator's next prompt."],
          api_retry: ["The agent waited on retries of failed model requests for ", "."],
          tool_failure: ["The agent waited after failed tool calls for ", "."],
          long_tool_call: ["Long tool calls (five minutes or more) ran for ", " while nothing else moved."],
          unknown: ["For ", " the evaluator labeled waiting with no recorded cause."],
        }[k] || ["For ", " the evaluator labeled waiting with no recorded cause."];
        add(` ${sentence[0]}`, tok("wait_cause", d), sentence[1]);
      }
      const gap = row.longest_gap && row.longest_gap.state !== "unavailable" ? row.longest_gap.value : null;
      if (gap && typeof gap.duration_ms === "number" && gap.duration_ms > 0) {
        const same = buckets.length && buckets[0][0] === gap.waited_on && gap.waited_on === "next_prompt";
        add(" The longest single wait was ", tok("longest", durationWords(gap.duration_ms)), same ? ", also for the next prompt." : `, when ${waitedOnWords(gap.waited_on, "long")}.`);
      }
    }

    // 4. Flow efficiency, defined in place.
    const fe = val(row.flow_efficiency);
    if (fe === null) {
      add(` In Lean, working time divided by lead time is called flow efficiency; it is not measured for this task, because ${reasons(row.flow_efficiency)}.`);
    } else {
      let feText = pctWords(fe);
      if (row.flow_efficiency.state === "partial") {
        if (open) feText = `${feText} so far`;
        else if (fromFirst) feText = `at most ${feText}`;
        else feText = `${feText} (partial)`;
      }
      add(" In Lean, working time divided by lead time is called ", { key: "fe_term", text: "flow efficiency", term: true }, "; here it is ", tok("fe", feText), ". A low number is normal: most of any process's lead time is waiting, not work. That is why Lean starts here.");
    }
    return { state: "ok", parts };
  }

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
  function buildItems(bursts, gaps, fold) {
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
      const causes = [...new Set(gaps.map((g) => g.waited_on || "unknown"))];
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
      folded_count: folded.length,
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
    return {
      fold_ms: chosen ? chosen.fold_ms : 0,
      items,
      session_count: sessionOrder.length,
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
      { key: "operator_turns", label: "Operator turns", text: statedText(box.operator_turns) },
      { key: "prs", label: "Pull requests", text: statedText(box.prs) },
      { key: "session", label: "Session", text: sessionWords(box.session_numbers, sessionCount) },
    ];
  }

  // A box's rework loop label, or null when it has no defect stretches (or
  // none is known: an unlabeled box draws no loop rather than a zero).
  function reworkWords(box) {
    const n = stated(box.defect_stretches);
    if (n.state === "unavailable" || !n.value) return null;
    const d = statedWords(box.defect_ms);
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
        if (it.inner_wait_ms > 0) segs.push({ level: "high", ms: it.inner_wait_ms, item: it.index, folded: true, label: `+${durationShort(it.inner_wait_ms)}` });
      } else segs.push({ level: "high", ms: it.duration_ms, item: it.index, label: durationShort(it.duration_ms) });
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

  // One task's stacked bar from its rollups/stackup.json row, in the shared
  // stacking order (format.js SEGMENTS). Returns { state, total_ms, segments,
  // partial }: segments that are zero are left out of the drawing but not of
  // the total; an unavailable lead time draws nothing.
  function timeBar(row, segments) {
    if (!row) return { state: "absent", segments: [] };
    const lead = val(row.lead_time_ms);
    if (lead === null) return { state: "unavailable", segments: [], reasons: (row.lead_time_ms && row.lead_time_ms.reasons) || [] };
    const pick = (key) => {
      if (key === "value" || key === "support") return row.class_ms && row.class_ms[key];
      if (key === "agents_working_unlabeled") return row.agents_working_unlabeled_ms;
      if (key === "not_labeled") return row.not_labeled_ms;
      if (key === "no_session") return row.no_session_ms;
      return row.waste_ms && row.waste_ms[key];
    };
    const out = [];
    let partial = row.lead_time_ms.state === "partial";
    for (const s of segments) {
      const n = pick(s.key);
      const v = val(n);
      if (n && n.state === "partial") partial = true;
      if (v === null || v <= 0) continue;
      out.push({ key: s.key, label: s.label, ms: v, share: v / lead, state: n.state });
    }
    // The queue before the first session is part of "no session running" in
    // Desk's stack-up; it is not drawn twice.
    return { state: "ok", total_ms: lead, segments: out, partial };
  }

  // ------------------------------------------------------------ the picker

  // The picker's rows: every task, the latest to finish first, with its
  // lead time and flow efficiency from rollups/tasks.json and a badge when a
  // figure is partial or unavailable. `nameOf(job)` gives its display name.
  // `query` filters by name or key, case-insensitively.
  function pickerRows(jobs, taskRows, nameOf, query) {
    const byJob = new Map((Array.isArray(taskRows) ? taskRows : []).map((r) => [r.job, r]));
    const pos = (j) => (j.finish_order && j.finish_order.state === "measured" ? j.finish_order.value : -1);
    const q = typeof query === "string" ? query.trim().toLowerCase() : "";
    return (Array.isArray(jobs) ? jobs : [])
      .map((j, i) => ({ j, i }))
      .sort((a, b) => pos(b.j) - pos(a.j) || a.i - b.i)
      .map(({ j }) => {
        const r = byJob.get(j.id) || null;
        const name = nameOf(j);
        const figs = r ? [r.lead_time_ms, r.flow_efficiency] : [];
        const badge = !r ? "no data" : figs.some((n) => !n || n.state === "unavailable") ? "no data" : figs.some((n) => n.state === "partial") || r.labels_from_shared_session ? "partial" : null;
        return {
          id: j.id,
          name,
          short: String(j.id).slice(0, 8),
          status: r && r.status && r.status.state !== "unavailable" ? r.status.value : j.status,
          lead: r ? r.lead_time_ms : null,
          fe: r ? r.flow_efficiency : null,
          badge,
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
  // subagent lane. Returns [{ x, n }] for columns with activity.
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
    return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([x, s]) => ({ x, n: s.size }));
  }

  let reasonList = (n) => stated(n).reasons.join("; ") || "not recorded";

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

  // The drawer's content for one thing on the page. `thing` is
  //   { kind: "box", item }  { kind: "wait", item }  { kind: "ladder", seg, item }
  //   { kind: "stretch", stretch, intervals, lanes }
  // and `ctx` is { origin_ms, lead_ms }. Returns { title, rows, evidence }:
  // rows are [label, text] pairs; evidence lists the intervals behind a
  // stretch (kind, tool kind, outcome, lane).
  function drawer(thing, ctx) {
    const c = ctx || {};
    const words = typeof c.reasonText === "function" ? c.reasonText : (r) => String(r).replace(/_/g, " ");
    reasonList = (n) => stated(n).reasons.map(words).join("; ") || "not recorded";
    const share = (ms) => (typeof c.lead_ms === "number" && c.lead_ms > 0 ? `${pctWords(ms / c.lead_ms)} of the lead time` : "share of lead time not known (no lead time)");
    if (thing.kind === "stretch") {
      const s = thing.stretch;
      const seg = stretchSegment(s);
      const cls = s.class === "muda" ? `Waste: ${WASTE_WORDS[s.waste] || "could not classify"}` : CLASS_WORDS[s.class] || "Not labeled";
      const rows = [
        ["What it is", cls],
        ["Confidence", typeof s.confidence === "string" ? s.confidence : "not recorded"],
        ["Evaluator version", typeof s.evaluator_version === "string" ? s.evaluator_version : "not recorded"],
      ];
      if (s.waited_on) rows.push(["Waited on", waitedOnWords(s.waited_on, "long")]);
      if (s.reason) rows.push(["Note", s.reason]);
      rows.push(["On the task clock", clockWords(s.start_ms, s.end_ms, c.origin_ms)]);
      rows.push(["Share", share(s.end_ms - s.start_ms)]);
      const laneName = new Map((thing.lanes || []).map((l) => [l.worker, l.label]));
      const evidence = (Array.isArray(s.evidence) ? s.evidence : [])
        .map((k) => thing.intervals[k])
        .filter(Boolean)
        .map((i) => ({
          kind: KIND_WORDS[i.kind] || String(i.kind).replace(/_/g, " "),
          tool: i.tool || "",
          outcome: i.outcome || "",
          lane: laneName.get(i.worker) || (i.worker === 0 ? "Main agent" : `Subagent ${i.worker}`),
          duration: durationShort(i.end_ms - i.start_ms),
        }));
      return { title: s.class === "muda" ? `${WASTE_WORDS[s.waste] || "Waste"} stretch` : `${CLASS_WORDS[s.class] || "Unlabeled"} stretch`, segment: seg, rows, evidence };
    }
    const it = thing.item;
    if (thing.kind === "box" || (thing.kind === "ladder" && it.type === "box" && !(thing.seg && thing.seg.folded))) {
      const rows = [
        ["What it is", it.count === 1 ? "One work burst: a run of agent activity with no idle stretch of 15 minutes or more and no operator turn inside it" : `${it.count} work bursts, folded into one box with the short waits between them`],
        ["On the task clock", clockWords(it.start_ms, it.end_ms, c.origin_ms)],
        ["Working time", `${durationWords(it.working_ms)} (${share(it.working_ms)})`],
        ["Value-adding, as labeled", statedWords(it.value_ms) || `not labeled (${reasonList(it.value_ms)})`],
        ["Defects, as labeled", stated(it.defect_stretches).state === "unavailable" ? `not labeled (${reasonList(it.defect_stretches)})` : reworkWords(it) || "none labeled"],
      ];
      if (it.inner_wait_ms > 0) rows.push(["Short waits inside", `${durationWords(it.inner_wait_ms)}${it.folded_count ? `, including ${it.folded_count} folded wait${it.folded_count === 1 ? "" : "s"}` : ""}`]);
      return { title: boxTitle(it), segment: "support", rows, evidence: [] };
    }
    const ms = thing.kind === "ladder" && thing.seg && thing.seg.folded ? it.inner_wait_ms : it.duration_ms;
    if (thing.kind === "ladder" && thing.seg && thing.seg.folded) {
      return {
        title: "Short waits inside a box",
        segment: "waiting",
        rows: [
          ["What it is", "Idle time inside a work box: waits shorter than the map's fold threshold, and idle moments inside bursts"],
          ["On the task clock", clockWords(it.start_ms, it.end_ms, c.origin_ms)],
          ["Duration", `${durationWords(ms)} (${share(ms)})`],
        ],
        evidence: [],
      };
    }
    const rows = [
      ["What it is", it.count === 1 ? "A wait: no agent of this task was working" : `${it.count} waits in a row, with no work between them`],
      ["Waited on", it.waited_on === "mixed" ? it.causes.map((k) => waitedOnWords(k, "short")).join("; ") : waitedOnWords(it.waited_on, "long")],
      ["On the task clock", clockWords(it.start_ms, it.end_ms, c.origin_ms)],
      ["Duration", `${durationWords(ms)} (${share(ms)})`],
    ];
    if (it.count > 1) rows.push(["Longest of them", durationWords(it.longest_ms)]);
    return { title: `Wait: ${waitTitle(it)}`, segment: "waiting", rows, evidence: [] };
  }

  // The prompt "Copy as a prompt for your agent" puts on the clipboard: what
  // to look at, a stable link to the page and one to the data file.
  function promptText(p) {
    const what = p.what || "this stretch";
    return `Walk me through ${what} of factory task ${p.name} (${p.route}, data: ${p.dataUrl}). Explain what happened and what we could change.`;
  }

  // ------------------------------------------------- the map file (build time)

  // The slim map file for one task (map/<job>.json), from its full report
  // jobs/<job>.json. It keeps what the landing view draws and drops the
  // intervals (up to megabytes) and every per-turn time: pull requests keep
  // their repository and number only, with no time.
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
      gaps: items(t.gaps).map((g) => ({ start_ms: g.start_ms, end_ms: g.end_ms, waited_on: g.waited_on })),
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
