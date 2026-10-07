// Steps 2, 3 and 4 of the walk as plain data: "Compare tasks" (the
// yamazumi-style stack-up and the flow efficiency dot plot), "Rank causes"
// (the Pareto chart and each cause's own page, with the prompt that starts
// an A3) and "Act" (the problems in hand and who owns each alarm). The page
// (app.js) only draws what these functions return, so every rule here is
// tested in Node.
//
// They reuse step 1's vocabulary and rules from walk.js: one task's bar is
// walk.js timeBar, so a task's bar on Compare tasks and on its own page are
// the same bar; a cause's name is walk.js causeWords, so a cause reads the
// same on a task's page and on Rank causes. Every number arrives as a stated
// number { state, value?, reasons } from Desk's rollups (tasks.json,
// stackup.json, causes.json) or data.json. No date is read or written.
//
// Loaded as a plain script in the browser after walk.js (global
// `FactorySteps`) and required by the tests in Node.

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./walk.js") : root.FactoryWalk);
  if (node) module.exports = api;
  else root.FactorySteps = api;
})(typeof self !== "undefined" ? self : this, function (W) {
  "use strict";

  const MINUTE = 60000;
  const HOUR = 60 * MINUTE;

  const arr = (x) => (Array.isArray(x) ? x : []);
  const val = (n) => (n && n.state !== "unavailable" && typeof n.value === "number" && Number.isFinite(n.value) ? n.value : null);
  const has = (n, code) => !!(n && Array.isArray(n.reasons) && n.reasons.includes(code));
  const byJob = (rows) => new Map(arr(rows).filter((r) => r && typeof r.job === "string").map((r) => [r.job, r]));
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

  // ------------------------------------------------------------ the order

  // Every chart on Compare tasks reads left to right in the walk's order:
  // finished tasks (labeled for waste, so their finish is known) in finish
  // order, the latest on the right; then tasks still open or not labeled
  // yet, by when work began, the latest on the right; then any task with no
  // place at all (no session published). No date is used: finish_order is a
  // position.
  function walkOrder(jobs) {
    const list = arr(jobs).filter((j) => j && typeof j.id === "string");
    const pos = (j) => (j.finish_order && j.finish_order.state === "measured" && typeof j.finish_order.value === "number" ? j.finish_order.value : null);
    const finished = (j) => j.finish_basis === "labels" && pos(j) > 0;
    const asc = (a, b) => pos(a) - pos(b);
    const placed = list.filter((j) => pos(j) !== null);
    return [
      ...placed.filter(finished).sort(asc).map((j) => ({ j, group: "finished", pos: pos(j) })),
      ...placed.filter((j) => !finished(j)).sort(asc).map((j) => ({ j, group: "open", pos: pos(j) })),
      ...list.filter((j) => pos(j) === null).map((j) => ({ j, group: "open", pos: null })),
    ];
  }

  // A task is in progress until its card says done or cancelled.
  const CLOSED = new Set(["done", "cancelled"]);
  function isOpen(status, leadN) {
    if (has(leadN, "censored") || has(leadN, "open_job")) return true;
    return typeof status === "string" ? !CLOSED.has(status) : false;
  }

  // ------------------------------------------------------- the stack-up

  // A duration in the charts' unit, hours, for sentences: "191 hours",
  // "5.5 hours", or minutes and seconds under an hour (walk.js words).
  function hoursWords(ms) {
    const x = Math.max(0, Number(ms) || 0);
    if (x < HOUR) return W.durationWords(x);
    const h = x / HOUR;
    const t = h >= 10 ? Math.round(h).toLocaleString("en-US") : String(Math.round(h * 10) / 10);
    return `${t} hour${t === "1" ? "" : "s"}`;
  }
  // The same for a bar's value label: "309h", "5.5h", "48m", "37s".
  function hoursShort(ms) {
    const x = Math.max(0, Number(ms) || 0);
    if (x < HOUR) return W.durationShort(x);
    const h = x / HOUR;
    return `${h >= 10 ? Math.round(h).toLocaleString("en-US") : String(Math.round(h * 10) / 10)}h`;
  }

  // How a total reads: "at least " for a lower bound, "at most " for an
  // upper one, "so far" (after the figure) for a task still open. A lead
  // time counted from the first session (the card was created after work
  // began) is a lower bound.
  function totalBound(n) {
    const b = W.boundOf(n);
    if (b === "window") return has(n, "card_dates_shorter_than_work") ? "lower" : null;
    return b;
  }
  function totalWords(n, open) {
    const v = val(n);
    if (v === null) return null;
    if (open) return `${hoursWords(v)} so far`;
    const b = totalBound(n);
    return `${b === "upper" ? "at most " : b === "lower" ? "at least " : ""}${hoursWords(v)}`;
  }
  // The same, in a bar's short value label: "≥54h", "309h".
  function totalShort(n, open) {
    const v = val(n);
    if (v === null) return "no data";
    if (v === 0) return "none";
    const b = open ? null : totalBound(n);
    return `${b === "upper" ? "≤" : b === "lower" ? "≥" : ""}${hoursShort(v)}`;
  }

  // One bar per task for the stack-up, in walkOrder. `mode` is "all" (the
  // whole lead time: working time by label, then waiting by cause) or
  // "working" (agent working time only). Each bar is walk.js timeBar's bar
  // for that task, so it matches the bar on the task's own page.
  //   state "ok"       segments drawn to scale
  //   state "unsplit"  the lead time is known but not how it splits
  //                    (all mode): one "split not known" segment, never zero
  //   state "no_data"  the figure the mode needs is not measured
  // `opts.segments` is format.js SEGMENTS (the fixed stacking order) and
  // `opts.nameOf(job)` the task's display name.
  function stackBars(jobs, stackRows, taskRows, opts) {
    const o = opts || {};
    const mode = o.mode === "working" ? "working" : "all";
    const nameOf = typeof o.nameOf === "function" ? o.nameOf : (j) => `Task ${String(j.id).slice(0, 8)}`;
    const stacks = byJob(stackRows);
    const tasks = byJob(taskRows);
    return walkOrder(jobs).map(({ j, group, pos }) => {
      const stack = stacks.get(j.id) || null;
      const task = tasks.get(j.id) || null;
      const leadN = (task && task.lead_time_ms) || (stack && stack.lead_time_ms) || null;
      const statusN = (task && task.status) || (stack && stack.status);
      const status = statusN && statusN.state !== "unavailable" ? statusN.value : j.status;
      const open = isOpen(status, leadN);
      const base = {
        job: j.id,
        name: nameOf(j),
        short: String(j.id).slice(0, 8),
        group,
        pos,
        status: typeof status === "string" ? status : null,
        open,
        shared: !!(task && task.labels_from_shared_session),
        href: `#/task/${j.id}`,
      };
      const noData = (reasons) => ({ ...base, state: "no_data", total_ms: null, label: "no data", segments: [], groups: [], reasons: [...new Set(arr(reasons))] });
      if (!stack && !task) return noData(["not_published"]);
      const bar = W.timeBar(stack, task, W.idleSplit(task, null), o.segments || []);
      if (bar.state === "absent" || bar.state === "unavailable") return noData(bar.reasons || (leadN && leadN.reasons));
      if (bar.state === "lead_only") {
        if (mode === "working") return noData(bar.reasons);
        return {
          ...base,
          state: "unsplit",
          total_ms: bar.total_ms,
          words: totalWords(leadN, open),
          label: totalShort(leadN, open),
          segments: [{ key: "unsplit", label: "Split not known", ms: bar.total_ms }],
          groups: [],
          reasons: bar.reasons || [],
        };
      }
      const partial = !!bar.partial || base.shared;
      const reasons = [...new Set([...arr(leadN && leadN.reasons), ...arr(task && task.working_ms && task.working_ms.reasons)])];
      if (mode === "working") {
        const g = bar.groups[0];
        const workN = (task && task.working_ms) || (stack && stack.working_ms);
        return { ...base, state: "ok", partial, total_ms: g.ms, words: totalWords(workN, open), label: totalShort(workN, open), segments: g.segments, groups: [g], reasons };
      }
      return { ...base, state: "ok", partial, total_ms: bar.total_ms, words: totalWords(leadN, open), label: totalShort(leadN, open), segments: bar.segments, groups: bar.groups, reasons };
    });
  }

  // A linear scale from zero for a chart of durations: hours, or minutes
  // when every value is under an hour. Returns { unit, per, max_ms, ticks }
  // with round tick steps (1, 2, 2.5 or 5 times a power of ten).
  function timeScale(maxMs, wanted) {
    const want = wanted || 5;
    const m = typeof maxMs === "number" && Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 0;
    const unit = m >= HOUR || m === 0 ? "hours" : "minutes";
    const per = unit === "hours" ? HOUR : MINUTE;
    const top = m / per;
    if (!(top > 0)) return { unit, per, max_ms: per, ticks: [0, per] };
    const raw = top / want;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].find((k) => k * mag >= raw - 1e-12) * mag;
    const n = Math.max(1, Math.ceil(top / step - 1e-9));
    const ticks = [];
    for (let i = 0; i <= n; i++) ticks.push(Math.round(i * step * per));
    return { unit, per, max_ms: ticks[ticks.length - 1], ticks };
  }
  // A tick's number in the scale's unit: "0", "50", "2.5", "0.25".
  function tickWords(ms, scale) {
    const x = ms / scale.per;
    return String(Math.round(x * 1000) / 1000);
  }

  // What a wait waited on, as the end of "the rest was waiting, mostly ...".
  const MOSTLY = {
    next_prompt: "for the next prompt (the agent had stopped)",
    api_retry: "on API retries",
    tool_failure: "after failed tool calls",
    long_tool_call: "during long tool calls",
    queue_before_start: "queued before the first session",
    no_session: "with no session of the task running",
    unknown: "with its cause not recorded",
  };

  // Which way one task's flow efficiency may be off: Desk's own bound
  // first; else a working time that is a lower bound makes it one, and a
  // lead time counted from the first session (a lower bound) makes it an
  // upper one.
  function feBound(row) {
    const n = row && row.flow_efficiency;
    if (!n || n.state !== "partial") return null;
    if (n.bound === "lower" || n.bound === "upper") return n.bound;
    const wb = W.boundOf(row.working_ms);
    const lb = totalBound(row.lead_time_ms);
    const low = wb === "lower" || lb === "upper";
    const up = wb === "upper" || lb === "lower";
    return low && up ? "unknown" : low ? "lower" : up ? "upper" : null;
  }
  // The bound of a share over several tasks, from each task's: one
  // direction when they agree, "about" when they do not.
  function groupBound(bounds) {
    const set = new Set(bounds.filter(Boolean));
    if (!set.size) return null;
    return set.size === 1 ? [...set][0] : "unknown";
  }
  const Q = { lower: "at least ", upper: "at most ", unknown: "about " };

  // Compare tasks' lede, with real numbers: across the finished tasks whose
  // time splits, the share of the elapsed time agents were working (flow
  // efficiency over the group), what the rest waited on, the task that
  // waited longest, and what is left out and why. `bars` are stackBars in
  // "all" mode; `rows` are the tasks.json rows (for the bounds);
  // `reasonText` turns a reason code into words. Returns { state, text,
  // facts }.
  function compareLede(bars, rows, reasonText) {
    const words = typeof reasonText === "function" ? reasonText : (c) => String(c).replace(/_/g, " ");
    const list = arr(bars);
    if (!list.length || list.every((b) => b.state === "no_data" && arr(b.reasons).includes("not_published"))) return { state: "absent", text: "The walk's data is not published yet, so no task can be compared. No bar is drawn rather than a zero.", facts: null };
    const fin = list.filter((b) => b.group === "finished");
    const rest = list.length - fin.length;
    const restText = rest ? ` The ${plural(rest, "task")} not finished in the store's sense (still open, or done but not labeled for waste yet) follow on the right.` : "";
    const split = fin.filter((b) => b.state === "ok" && b.groups.length === 2);
    if (!split.length) {
      return {
        state: "none_finished",
        text: `${fin.length ? `None of the ${plural(fin.length, "finished task")} splits into working and waiting yet` : "No task has finished in the store's sense yet (finished means labeled for waste)"}, so there is no share to give across finished tasks.${restText}`,
        facts: null,
      };
    }
    const tasks = byJob(rows);
    let lead = 0;
    let work = 0;
    const waitBy = {};
    const bounds = [];
    for (const b of split) {
      lead += b.total_ms;
      work += b.groups[0].ms;
      for (const s of b.groups[1].segments) waitBy[s.cause] = (waitBy[s.cause] || 0) + s.ms;
      bounds.push(feBound(tasks.get(b.job)));
    }
    const waiting = Math.max(0, lead - work);
    const share = lead > 0 ? work / lead : 0;
    const bound = groupBound(bounds);
    const top = Object.entries(waitBy).sort((a, b) => b[1] - a[1])[0];
    const parts = [];
    parts.push(`Across the ${plural(split.length, "finished task")} whose time splits into working and waiting, agents were working ${Q[bound] || ""}${W.pctWords(share)} of the elapsed time (${hoursWords(work).replace(/ hours?$/, "")} of ${hoursWords(lead)}).`);
    if (waiting > 0 && top) {
      const most = top[1] >= 0.5 * waiting;
      parts.push(` The rest, ${hoursWords(waiting)}, was waiting, ${most ? "mostly" : "the largest part"} ${MOSTLY[top[0]] || MOSTLY.unknown} (${hoursWords(top[1])}).`);
    } else parts.push(" None of it was waiting.");
    const longest = split.slice().sort((a, b) => b.groups[1].ms - a.groups[1].ms)[0];
    if (longest && longest.groups[1].ms > 0) parts.push(` The finished task that waited longest is “${longest.name}”: ${longest.groups[1].qualifier || ""}${hoursWords(longest.groups[1].ms)} of waiting in a lead time of ${longest.words}.`);
    const unsplit = fin.filter((b) => !split.includes(b));
    if (unsplit.length) {
      const why = [...new Set(unsplit.flatMap((b) => b.reasons || []))].map(words).join("; ") || "it was not recorded";
      parts.push(` ${unsplit.length === 1 ? "One more finished task does" : `${unsplit.length} more finished tasks do`} not split, because ${why}; ${unsplit.length === 1 ? "its bar shows" : "their bars show"} the lead time alone.`);
    }
    parts.push(restText);
    return { state: "ok", text: parts.join(""), facts: { tasks: split.length, lead_ms: lead, working_ms: work, waiting_ms: waiting, share, bound, top: top ? { key: top[0], ms: top[1] } : null, longest: longest ? longest.job : null } };
  }

  // The flow efficiency dot plot, in the same order as the stack-up: one
  // point per task whose flow efficiency is measured or partial; a partial
  // point is hollow and its words carry "at most" or "at least" (walk.js
  // feWords, so it reads as on the task's page). Unavailable points are
  // left out and counted with their reasons.
  function feDots(bars, rows) {
    const tasks = byJob(rows);
    const points = [];
    let omitted = 0;
    const why = new Map();
    for (const b of arr(bars)) {
      const r = tasks.get(b.job);
      const n = r && r.flow_efficiency;
      const v = val(n);
      if (v === null) {
        omitted += 1;
        for (const c of arr(n && n.reasons).length ? n.reasons : ["not_recorded"]) why.set(c, (why.get(c) || 0) + 1);
        continue;
      }
      points.push({ job: b.job, name: b.name, short: b.short, group: b.group, href: b.href, value: v, hollow: n.state === "partial", words: W.feWords(r) });
    }
    return { points, omitted, reasons: [...why.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })) };
  }

  // -------------------------------------------------- the Pareto of causes

  const CAUSE_KEY = /^[a-z][a-z_]{0,40}:[a-z0-9][a-z0-9_.-]{0,60}$/;
  const isCauseKey = (k) => typeof k === "string" && CAUSE_KEY.test(k);
  const causeRoute = (k) => (isCauseKey(k) ? `#/causes/${k}` : "#/causes");
  // A running total in words: it reads 100% only at the last bar.
  const cumWords = (share) => (share < 1 && Math.round(share * 100) >= 100 ? "99%" : W.pctWords(share));
  const isWaiting = (k) => String(k).startsWith("waiting:");

  // The bars of the Pareto chart from Desk's rollups/causes.json. `mode` is
  // "all" (every cause, waiting included) or "working" (agent working time:
  // waiting left out, so the causes agents can fix are ranked on their own).
  // Bars are in strictly descending order of time; beyond `maxBars` the
  // smallest causes fold into one "Other" bar, last. The cumulative share is
  // computed over the bars shown, so it ends at 100% in either mode.
  function paretoModel(doc, mode, opts) {
    const o = opts || {};
    const maxBars = Number.isInteger(o.maxBars) && o.maxBars > 1 ? o.maxBars : 10;
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.causes)) return { state: "absent", bars: [] };
    const indexed = doc.causes.map((c, i) => ({ c, i })).filter(({ c }) => c && isCauseKey(c.cause) && typeof c.total_ms === "number" && Number.isFinite(c.total_ms) && c.total_ms > 0);
    const shown = indexed.filter(({ c }) => (mode === "working" ? !isWaiting(c.cause) : true));
    shown.sort((a, b) => b.c.total_ms - a.c.total_ms || (a.c.cause < b.c.cause ? -1 : 1));
    const total = shown.reduce((a, x) => a + x.c.total_ms, 0);
    const bar = ({ c, i }) => {
      const [waste, what] = c.cause.split(":");
      return { key: c.cause, label: W.causeWords(c.cause), waste, wait: waste === "waiting" ? what : null, segment: W.causeSegment(c.cause), ms: c.total_ms, jobs: arr(c.jobs).length, index: i, href: causeRoute(c.cause) };
    };
    let bars = shown.map(bar);
    if (bars.length > maxBars) {
      const tail = bars.slice(maxBars - 1);
      bars = [...bars.slice(0, maxBars - 1), { key: "other", label: `Other (${tail.length} causes)`, waste: null, wait: null, segment: "other", ms: tail.reduce((a, x) => a + x.ms, 0), jobs: new Set(tail.flatMap((x) => arr(doc.causes[x.index].jobs))).size, members: tail.map((x) => x.key), href: null }];
    }
    let run = 0;
    for (const b of bars) {
      run += b.ms;
      b.share = total > 0 ? b.ms / total : 0;
      b.cum = total > 0 ? run / total : 0;
    }
    if (bars.length) bars[bars.length - 1].cum = 1;
    return {
      state: bars.length ? doc.state || "measured" : "empty",
      mode: mode === "working" ? "working" : "all",
      basis: doc.basis || null,
      n: typeof doc.n === "number" ? doc.n : null,
      N: typeof doc.N === "number" ? doc.N : null,
      reasons: arr(doc.reasons),
      total_ms: total,
      left_out: mode === "working" ? indexed.filter(({ c }) => isWaiting(c.cause)).reduce((a, x) => a + x.c.total_ms, 0) : 0,
      bars,
    };
  }

  // Rank causes' lede, with real numbers: the largest cause and its share,
  // how few causes carry four fifths of the time (the vital few), and the
  // largest cause agents can fix once waiting is left out.
  function causesLede(all, working) {
    if (!all || all.state === "absent") return "The causes file is not published yet, so this page cannot rank causes. No bar is drawn rather than a zero.";
    if (!all.bars.length) return "No cause of waste is recorded yet in the tasks the ranking counts.";
    const top = all.bars[0];
    const parts = [`The largest cause, ${top.label.charAt(0).toLowerCase()}${top.label.slice(1)}, cost ${hoursWords(top.ms)}: ${W.pctWords(top.share)} of the ${hoursWords(all.total_ms)} ranked.`];
    const k = all.bars.findIndex((b) => b.cum >= 0.8) + 1;
    if (k > 1 && k < all.bars.length) parts.push(` ${k === 2 ? "Two causes" : k === 3 ? "Three causes" : `${k} causes`} of ${all.bars.length} carry ${W.pctWords(all.bars[k - 1].cum)} of the time: those are the vital few.`);
    else if (k === 1 && all.bars.length > 1) parts.push(` That one cause of ${all.bars.length} carries most of the time: it is the vital few on its own.`);
    if (working && working.bars && working.bars.length) {
      const w = working.bars[0];
      parts.push(` Leave waiting out, and the largest cause agents can fix in their own work is ${w.label.charAt(0).toLowerCase()}${w.label.slice(1)}, at ${hoursWords(w.ms)}.`);
    } else if (working) parts.push(" No labeled waste in agents' working time is recorded yet, so with waiting left out there is nothing to rank.");
    return parts.join("");
  }

  // What a cause means, in one sentence, for its own page.
  const WASTE_MEANING = {
    defects: "Failures and their rework: a failed command, a broken build, a change undone.",
    extra_processing: "More work than the outcome needs: repeating a check that already passed, polishing past the requirement.",
    overproduction: "Work nobody asked for or used.",
    motion: "Searching and navigating: rereading the same file, hunting for a path or a command.",
    transportation: "Moving work without changing it: copying context between sessions, handing work from agent to agent.",
    inventory: "Work started and left: open branches, stale drafts, half-done tasks.",
    non_utilized_talent: "Capability left unused: doing by hand what a tool or skill does.",
    unknown: "Waste the evaluator could not classify.",
  };
  function causeMeaning(key) {
    const [waste, what] = String(key).split(":");
    if (waste === "waiting") return `Waiting is idle time, when no agent of the task was working. Here ${W.waitedOnWords(what, "long")}.`;
    const base = WASTE_MEANING[waste] || WASTE_MEANING.unknown;
    if (waste === "defects" && what && what !== "all") return `${base} Here, time the evaluator labeled as defects, around failed ${what} tool calls.`;
    return `${base} This is working time the evaluator labeled as this waste.`;
  }

  // Reasons Desk gives for leaving a task out of the ranking; its other
  // reasons say why a counted figure is partial.
  const LEFT_OUT = new Set(["not_labeled", "open_job", "source_unreadable", "job_offsets_unavailable", "cancelled", "no_facts"]);

  // The note on what the ranking counts.
  function paretoNote(model, reasonText) {
    const words = typeof reasonText === "function" ? reasonText : (c) => String(c).replace(/_/g, " ");
    if (!model || model.state === "absent") return "The causes file is not published yet, so no cause can be ranked. No bar is drawn rather than a zero.";
    const parts = [];
    if (model.basis === "job_hours") parts.push("Time is counted in job-hours: a moment two tasks share counts once for each task.");
    const out = model.reasons.filter((r) => LEFT_OUT.has(r));
    const part = model.reasons.filter((r) => !LEFT_OUT.has(r));
    const partWords = (r) => (r === "labels_from_shared_session" ? "some tasks' labels come from sessions they shared with other tasks" : words(r));
    if (model.n !== null && model.N !== null) {
      parts.push(` The ranking counts ${model.n} of ${model.N} tasks${out.length ? `; the others are left out, for these reasons: ${out.map(words).join("; ")}` : ""}.`);
    }
    if (part.length) parts.push(` Some counted figures are partial, for these reasons: ${part.map(partWords).join("; ")}.`);
    return parts.join("").trim();
  }

  // The hours one task spent on one cause. Desk's task row lists its top
  // causes with their time; past those, a waiting cause reads the task's
  // waiting split, and a labeled waste with no tool split reads the task's
  // stack-up row. A failed tool kind has no per-task total in either, so it
  // is the sum of the cause's listed stretches for the task, a lower bound
  // when the list was cut at its limit. Returns { ms, bound, source } or
  // null when nothing states it.
  function taskCauseMs(key, job, cause, ctx) {
    const c = ctx || {};
    const task = c.tasks ? c.tasks.get(job) : null;
    const stack = c.stacks ? c.stacks.get(job) : null;
    const top = task && task.top_causes && task.top_causes.state !== "unavailable" ? arr(task.top_causes.value) : [];
    const hit = top.find((x) => x && x.cause === key && typeof x.total_ms === "number");
    if (hit) return { ms: hit.total_ms, bound: null, source: "task" };
    const [waste, what] = key.split(":");
    if (waste === "waiting") {
      const v = val(task && task.waiting_by_waited_on_ms && task.waiting_by_waited_on_ms[what]);
      if (v !== null) return { ms: v, bound: null, source: "waiting" };
    } else if (what === "all") {
      const w = stack && stack.working && typeof stack.working === "object" ? stack.working : stack;
      const v = val(w && w.waste_ms && w.waste_ms[waste]);
      if (v !== null) return { ms: v, bound: null, source: "stackup" };
    }
    const spans = arr(cause && cause.spans).filter((s) => s && s.job === job && typeof s.start_ms === "number" && typeof s.end_ms === "number");
    if (!spans.length) return null;
    const cut = typeof c.limit === "number" && arr(cause.spans).length >= c.limit;
    return { ms: spans.reduce((a, s) => a + Math.max(0, s.end_ms - s.start_ms), 0), bound: cut ? "lower" : null, source: "spans" };
  }

  // One cause's page (#/causes/<key>): its rank in both modes, its tasks
  // (largest first) and the stretches Desk lists for it.
  //   state "absent"      the causes file is not published
  //   state "not_ranked"  the file has no row for this key (a task can name
  //                       a cause that no counted task has)
  //   state "ok"
  function causeDetail(doc, key, ctx) {
    const c = ctx || {};
    const nameOf = typeof c.nameOf === "function" ? c.nameOf : (job) => `Task ${String(job).slice(0, 8)}`;
    const promptNameOf = typeof c.promptNameOf === "function" ? c.promptNameOf : (job) => `factory task ${String(job).slice(0, 8)}`;
    const label = W.causeWords(key);
    if (!doc || !Array.isArray(doc.causes)) return { state: "absent", key, label };
    const index = doc.causes.findIndex((x) => x && x.cause === key);
    const all = paretoModel(doc, "all", { maxBars: Infinity });
    if (index < 0) return { state: "not_ranked", key, label, n: doc.n, N: doc.N, of: all.bars.length };
    const cause = doc.causes[index];
    const working = isWaiting(key) ? null : paretoModel(doc, "working", { maxBars: Infinity });
    const rankIn = (m) => (m ? { rank: m.bars.findIndex((b) => b.key === key) + 1, of: m.bars.length, share: (m.bars.find((b) => b.key === key) || {}).share } : null);
    const ctx2 = { tasks: byJob(c.taskRows), stacks: byJob(c.stackRows), limit: typeof doc.references_per_cause === "number" ? doc.references_per_cause : null };
    const tasks = arr(cause.jobs)
      .filter((j) => typeof j === "string")
      .map((job) => ({ job, name: nameOf(job), promptName: promptNameOf(job), href: `#/task/${job}`, ...(taskCauseMs(key, job, cause, ctx2) || { ms: null, bound: null, source: null }) }))
      .sort((a, b) => (b.ms === null ? -1 : b.ms) - (a.ms === null ? -1 : a.ms) || (a.job < b.job ? -1 : 1));
    const spans = arr(cause.spans)
      .filter((s) => s && typeof s.job === "string" && typeof s.start_ms === "number" && typeof s.end_ms === "number" && s.end_ms >= s.start_ms)
      .map((s, k) => ({ k, job: s.job, name: nameOf(s.job), start_ms: s.start_ms, end_ms: s.end_ms, ms: s.end_ms - s.start_ms }))
      .sort((a, b) => b.ms - a.ms || a.k - b.k);
    return {
      state: "ok",
      key,
      label,
      waste: key.split(":")[0],
      wait: isWaiting(key) ? key.split(":")[1] : null,
      segment: W.causeSegment(key),
      index,
      ms: cause.total_ms,
      jobs: tasks.length,
      all: rankIn(all),
      working: rankIn(working),
      total_ms: all.total_ms,
      n: doc.n,
      N: doc.N,
      basis: doc.basis || null,
      tasks,
      spans,
      spans_cut: typeof doc.references_per_cause === "number" && arr(cause.spans).length >= doc.references_per_cause,
    };
  }

  // Which item of a task's map holds a stretch: the wait (gap) it overlaps
  // most, or else the work burst it overlaps most (idle moments inside a
  // burst, or labeled working time). Returns { kind: "gaps"|"bursts", n }
  // with n 1-based in clock order, as the map's deep links count, or null.
  function spanItem(map, span) {
    const items = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : []);
    if (!map || !span) return null;
    const over = (it) => Math.min(it.end_ms, span.end_ms) - Math.max(it.start_ms, span.start_ms);
    const best = (list) => {
      let at = -1;
      let most = 0;
      list.forEach((it, i) => {
        if (!it || typeof it.start_ms !== "number" || typeof it.end_ms !== "number") return;
        const o = span.end_ms > span.start_ms ? over(it) : it.start_ms <= span.start_ms && span.start_ms < it.end_ms ? 1 : 0;
        if (o > most) {
          most = o;
          at = i;
        }
      });
      return at;
    };
    const g = best(items(map.gaps));
    if (g >= 0) return { kind: "gaps", n: g + 1 };
    const b = best(items(map.bursts));
    return b >= 0 ? { kind: "bursts", n: b + 1 } : null;
  }

  // The prompt "Start an A3 with your agent" copies: the cause by name and
  // key, its time and share, its largest tasks, a link that reopens its page
  // and where it sits in the data file.
  function a3Prompt(d, links) {
    const l = links || {};
    const top = arr(d.tasks).filter((t) => t.ms !== null).slice(0, 3);
    const named = top.map((t) => `${t.promptName || `factory task ${String(t.job).slice(0, 8)}`} (${t.bound === "lower" ? "at least " : ""}${hoursWords(t.ms)})`);
    const tasksText = named.length ? ` Its largest ${named.length === 1 ? "task is" : "tasks are"} ${named.join(", ")}${d.jobs > named.length ? `, of ${d.jobs} tasks in all` : ""}.` : "";
    const share = d.all && typeof d.all.share === "number" ? `, ${W.pctWords(d.all.share)} of all the time ranked` : "";
    const rank = d.all && d.all.rank ? ` It ranks ${ordinal(d.all.rank)} of ${d.all.of} causes by time.` : "";
    return `Help me start an A3 on factory cause "${d.label}" (${d.key}). It cost ${hoursWords(d.ms)}, counted per task${share}.${rank}${tasksText} Its page is ${l.route}, and its data is causes[${d.index}] in ${l.dataUrl}. Walk me through its biggest stretches first, then draft the A3 with me: the background, the current condition, the root cause, a countermeasure to try, and how we would check it worked with labeled tasks from before and after it shipped.`;
  }

  // ------------------------------------------------------------- act

  // The explicit table that links a kaizen issue to the Pareto cause it
  // works on. A row appears here only when the issue's own measure is the
  // cause's measure: the facts' human_wait is what "waiting for the next
  // prompt" measures, and the facts' API retries what "API retry" measures.
  // No issue is mapped by guessing from its title.
  const KAIZEN_CAUSES = {
    "ourostack/factory#53": "waiting:next_prompt",
    "ourostack/factory#52": "waiting:api_retry",
  };

  // "ourostack/factory#53" from an issue or pull request URL.
  function refOf(url) {
    const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues|pull)\/([1-9][0-9]{0,6})$/.exec(String(url || ""));
    return m ? `${m[1]}/${m[2]}#${m[3]}` : null;
  }

  // Until a countermeasure has labeled tasks on both sides of it, its check
  // cannot be made. Desk does not publish when a countermeasure shipped
  // relative to the labeled tasks, so today no issue can be checked.
  const CHECK_WORDS = "not enough labeled tasks yet";

  // One row per kaizen issue: its title, its countermeasure pull request,
  // its cause where KAIZEN_CAUSES names one, and its check state. Open
  // issues first, then the newest. `doc` is causes.json (to say whether the
  // mapped cause is ranked in this build).
  function actRows(issues, doc, table) {
    const map = table || KAIZEN_CAUSES;
    const ranked = new Set(doc && Array.isArray(doc.causes) ? doc.causes.map((c) => c && c.cause) : []);
    const num = (ref) => Number((/#([0-9]+)$/.exec(String(ref)) || [])[1] || 0);
    return arr(issues)
      .filter((i) => i && typeof i.url === "string")
      .map((i) => {
        const ref = refOf(i.url);
        const key = ref && Object.prototype.hasOwnProperty.call(map, ref) ? map[ref] : null;
        const res = i.resolution && typeof i.resolution === "object" ? i.resolution : null;
        return {
          ref: ref || String(i.ref || "issue"),
          short: typeof i.ref === "string" ? i.ref : ref,
          url: i.url,
          title: typeof i.title === "string" && i.title ? i.title.replace(/^Kaizen:\s*/i, "") : null,
          state: i.issue_state === "open" ? "open" : i.issue_state === "closed" ? "closed" : "unknown",
          countermeasure: res && typeof res.url === "string" ? { ref: refOf(res.url) || String(res.ref || "pull request"), url: res.url, merged: res.merged === true, kind: res.kind || null } : null,
          cause: key ? { key, label: W.causeWords(key), href: causeRoute(key), ranked: ranked.has(key) } : null,
          check: CHECK_WORDS,
        };
      })
      .sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || num(b.ref) - num(a.ref));
  }

  // An alarm key in words, as the status line names it.
  function alarmKeyWords(key) {
    const [kind, what] = String(key).split(":");
    if (kind === "capture") return `capture coverage on ${what}`;
    if (kind === "loop") return `the improvement loop (${String(what).replace(/_/g, " ")})`;
    return String(key);
  }

  // The open issues labeled factory-alarm, each with the status-line alarms
  // it owns (only keys are read from an issue's title, never its words).
  function alarmRows(issues) {
    return arr(issues)
      .filter((i) => i && i.issue_state === "open" && typeof i.url === "string")
      .map((i) => ({ ref: refOf(i.url) || String(i.ref || "issue"), url: i.url, owns: arr(i.keys).map(alarmKeyWords) }));
  }

  // --------------------------------------- step 1: a task's top causes

  // A task's top causes for its own page, in the same keys and names as
  // Rank causes and in two groups that never mix: waiting (idle time, from
  // the task's waiting split, so the list agrees with its bar) and working
  // time the evaluator labeled as waste (from the task row's top causes).
  function taskCauses(row, idle, max) {
    const k = max || 5;
    const waiting = arr(idle && idle.by)
      .filter((x) => x && x.ms > 0)
      .map((x) => ({ key: `waiting:${x.key}`, ms: x.ms, href: causeRoute(`waiting:${x.key}`) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, k);
    const tc = row && row.top_causes;
    const working = (tc && tc.state !== "unavailable" ? arr(tc.value) : [])
      .filter((c) => c && isCauseKey(c.cause) && !isWaiting(c.cause) && typeof c.total_ms === "number" && c.total_ms > 0)
      .map((c) => ({ key: c.cause, ms: c.total_ms, href: causeRoute(c.cause) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, k);
    return { waiting, working, working_state: tc ? tc.state : "unavailable", working_reasons: tc && tc.state === "unavailable" ? arr(tc.reasons) : [] };
  }

  return {
    walkOrder,
    isOpen,
    hoursWords,
    hoursShort,
    totalWords,
    feBound,
    stackBars,
    timeScale,
    tickWords,
    compareLede,
    feDots,
    isCauseKey,
    causeRoute,
    paretoModel,
    paretoNote,
    cumWords,
    causesLede,
    causeMeaning,
    causeDetail,
    spanItem,
    a3Prompt,
    KAIZEN_CAUSES,
    CHECK_WORDS,
    refOf,
    actRows,
    alarmKeyWords,
    alarmRows,
    taskCauses,
  };
});
