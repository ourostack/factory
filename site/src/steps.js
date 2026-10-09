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
// Loaded as a plain script in the browser after format.js and walk.js
// (global `FactorySteps`) and required by the tests in Node.

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = node ? factory(require("./walk.js"), require("./format.js")) : factory(root.FactoryWalk, root.FactoryFormat);
  if (node) module.exports = api;
  else root.FactorySteps = api;
})(typeof self !== "undefined" ? self : this, function (W, F) {
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
  // finished tasks (done or cancelled, labeled for waste or not) in finish
  // order, which is finish-day order with the undated ones after the dated,
  // the latest on the right; then tasks still open, by when work began, the
  // latest on the right; then any task with no place at all (no session
  // published). Over time counts the same finished tasks.
  function walkOrder(jobs) {
    const list = arr(jobs).filter((j) => j && typeof j.id === "string");
    const pos = (j) => (j.finish_order && j.finish_order.state === "measured" && typeof j.finish_order.value === "number" ? j.finish_order.value : null);
    const finished = (j) => F.isFinished(j);
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
        unlabeled: group === "finished" && j.finish_basis !== "labels",
        status: typeof status === "string" ? status : null,
        open,
        shared: !!(task && task.labels_from_shared_session),
        href: `#/task/${j.id}`,
        // Its finish day in words (format.js finishDay), for the bar's date
        // label, its tooltip and the table.
        finish: F.finishDay(j.finish_date),
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

  // The parts of a working bar that carry no evaluator label.
  const UNLABELED = new Set(["agents_working_unlabeled", "not_labeled", "working_unsplit", "no_session", "unsplit"]);
  const labeledMs = (b) => arr(b && b.segments).filter((s) => !s.cause && !UNLABELED.has(s.key)).reduce((a, s) => a + (s.ms > 0 ? s.ms : 0), 0);

  // "Agent working time" mode shows only the tasks whose working time
  // carries the evaluator's labels, so the chart's scale fits them and a
  // defect of minutes is not flattened by hundreds of unlabeled hours. One
  // sentence accounts for every task left out: the open ones (with their
  // unlabeled hours and the largest), the done ones not labeled yet, and
  // the ones with no working time measured. `bars` are stackBars in
  // "working" mode. Returns { bars, left_out, text }.
  function workingView(bars) {
    const list = arr(bars);
    const kept = list.filter((b) => b.state === "ok" && labeledMs(b) > 0);
    const out = list.filter((b) => !kept.includes(b));
    if (!out.length) return { bars: kept, left_out: 0, text: "" };
    const measured = out.filter((b) => b.state === "ok");
    const open = measured.filter((b) => b.open);
    const done = measured.filter((b) => !b.open);
    const none = out.length - measured.length;
    const sum = (xs) => xs.reduce((a, b) => a + (b.total_ms || 0), 0);
    const parts = [];
    if (open.length) {
      const top = open.slice().sort((a, b) => b.total_ms - a.total_ms)[0];
      parts.push(`${open.length} still open ${open.length === 1 ? "holds" : "hold"} ${hoursWords(sum(open))} of working time not labeled yet${open.length > 1 ? `, the most in “${top.name}” (${hoursWords(top.total_ms)})` : ` (“${top.name}”)`}`);
    }
    if (done.length) parts.push(`${done.length} done but not labeled yet ${done.length === 1 ? "holds" : "hold"} ${hoursWords(sum(done))}`);
    if (none) parts.push(`${none} ${none === 1 ? "has" : "have"} no working time measured`);
    const head = `${plural(out.length, "task")} ${out.length === 1 ? "is" : "are"} left out because none of ${out.length === 1 ? "its" : "their"} working time is labeled yet`;
    return { bars: kept, left_out: out.length, text: `${head}: ${parts.join("; ")}. The table below lists every task.` };
  }

  // "Share of each task" mode: every bar of "all" mode drawn as shares of
  // its own lead time, 0 to 100%, with the same parts in the same order, so
  // the make-up of a 20-minute task compares with a 200-hour one. A bar
  // whose split is not known stays one hatched "split not known" part (all
  // of its lead time, never 100% of one class), and a bar with no lead time
  // stays "no data". Each bar's label is the share agents were working
  // (its flow efficiency), with the bound its task row states. `rows` are
  // the tasks.json rows.
  function shareBars(bars, rows) {
    const tasks = byJob(rows);
    return arr(bars).map((b) => {
      if (b.state === "no_data") return { ...b, share: true };
      if (b.state === "unsplit" || !(b.total_ms > 0)) return { ...b, share: true, state: b.state === "ok" ? "unsplit" : b.state, total_ms: 1, label: "split not known", segments: [{ key: "unsplit", label: "Split not known", ms: 1 }], groups: [] };
      const t = b.total_ms;
      const part = (x) => ({ ...x, ms: x.ms / t });
      const groups = arr(b.groups).map((g) => ({ ...g, share_of_lead: g.ms / t, segments: arr(g.segments).map(part) }));
      const work = groups.find((g) => g.key === "working");
      const bound = feBound(tasks.get(b.job));
      const q = { lower: "≥", upper: "≤", unknown: "~" }[bound] || "";
      return { ...b, share: true, total_ms: 1, lead_ms: t, segments: arr(b.segments).map(part), groups, label: work ? `${q}${shortPct(work.share_of_lead)} working` : "split not known" };
    });
  }
  // A share in a few characters, for labels and phone tables: "14%", "<1%".
  function shortPct(share) {
    const p = share * 100;
    if (p > 0 && p < 1) return "<1%";
    return `${Math.round(p)}%`;
  }

  // The finished task to label on the chart. In "all" mode it is the one
  // that waited longest, by idle waiting only (lead time minus working
  // time), in the lede's own words; labeled waste describes working time
  // and never counts toward it. In "working" mode it is the one with the
  // most labeled waste.
  const WASTE_SEGMENTS = new Set(["waiting", "defects", "extra_processing", "overproduction", "motion", "transportation", "inventory", "non_utilized_talent", "unknown"]);
  function mostWaste(bars, mode) {
    // Every share bar is full height: no single bar is labeled there.
    if (mode === "share") return null;
    const working = mode === "working";
    let best = null;
    arr(bars).forEach((b, index) => {
      if (b.group !== "finished" || b.state !== "ok") return;
      const ms = arr(b.segments).filter((s) => (working ? !s.cause && WASTE_SEGMENTS.has(s.key) : !!s.cause)).reduce((a, s) => a + (s.ms > 0 ? s.ms : 0), 0);
      if (ms > 0 && (!best || ms > best.ms)) best = { job: b.job, index, ms };
    });
    if (!best) return null;
    return { ...best, label: `${working ? "Most labeled waste" : "Waited longest"}: ${hoursShort(best.ms)}` };
  }

  // A bar group's time with its bound; a true zero is "none", never
  // "at least none".
  const groupWords = (g) => (g && g.ms > 0 ? `${g.qualifier || ""}${hoursWords(g.ms)}` : "none");

  // One row of Compare's phone table: the task, its lead time and its
  // waiting, the figures a reader on a small screen needs first, in the
  // bars' short form ("≥5.5h") so each row stays on one line.
  const SHORT_Q = { "at least ": "≥", "at most ": "≤", "about ": "~" };
  function compactRow(b) {
    const waiting = arr(b.groups).find((g) => g.key === "waiting");
    const wait = !waiting ? "not known" : waiting.ms > 0 ? `${SHORT_Q[waiting.qualifier] || ""}${hoursShort(waiting.ms)}` : "none";
    return { job: b.job, name: b.name, href: b.href, lead: b.state === "no_data" ? "no data" : b.label, waiting: wait };
  }
  // The disclosure that holds every figure on a phone.
  const fullTableSummary = (n) => `Every figure, as a table (${plural(n, "task")})`;

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
    other_task: "while the agent was working on another task",
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
    if (n.bound === null) return null;
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
    // Finished tasks are in finish-day order; one with no day sits after the
    // dated ones, and the lede says why.
    const undated = fin.filter((b) => !(b.finish && b.finish.day));
    const undatedText = undated.length
      ? ` ${undated.length === 1 ? "1 finished task has" : `${undated.length} finished tasks have`} no finish day (${[...new Set(undated.flatMap((b) => arr(b.finish && b.finish.reasons)))].map(words).join("; ") || "not recorded"}), so ${undated.length === 1 ? "it sits" : "they sit"} after the dated ones.`
      : "";
    const restText = `${undatedText}${rest ? ` ${rest === 1 ? "1 task still open follows" : `${rest} tasks still open follow`} on the right.` : ""}`;
    const split = fin.filter((b) => b.state === "ok" && b.groups.length === 2);
    if (!split.length) {
      return {
        state: "none_finished",
        text: `${fin.length ? `None of the ${plural(fin.length, "finished task")} splits into working and waiting yet` : "No task has finished yet"}, so there is no share to give across finished tasks.${restText}`,
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

  // ------------------------------------------------------ over time

  // Compare → Over time, from the store's rollups/by_week.json
  // (factory.site.by_week/1). Each task counts in the ISO week (UTC, Monday
  // first) of its finish day. The view answers two questions over months:
  // "is this cause shrinking?" and "is flow efficiency improving?". So every
  // figure names its base, a week whose days are bounds says it may hold
  // tasks that finished in other weeks, and no change between weeks is
  // claimed that bound days could explain.
  //
  // overTime(doc, opts) returns the weeks (every week from the first to the
  // last; an empty week is a slot, never a zero bar; fewer than 3 tasks is
  // thin), the base sentence, the day-certainty sentence, the trend
  // sentence, the flow-efficiency marks by week with each week's median, and
  // the finished tasks with no day. weekBars, causeTable and weekAxis turn it
  // into what the page draws. `opts`: { jobs (data.json jobs), taskRows
  // (rollups/tasks.json rows), nameOf(job), year }.
  const THIN_WEEK = 3;
  const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const isWeek = (w) => w && typeof w.week === "string" && typeof w.starts_on === "string" && Number.isInteger(w.n);
  const BOUND_SIGN = { lower: "≥", upper: "≤", unknown: "~" };
  const BOUND_WORD = { lower: "at least ", upper: "at most ", unknown: "about " };
  // One qualifier per figure (N4): "at least 5%", "about 5% (direction not
  // known)"; a figure already worded "under ..." takes no second one.
  function qualify(w, bound) {
    if (!bound) return w;
    if (!/^under /.test(w)) return `${BOUND_WORD[bound]}${w}${bound === "unknown" ? " (direction not known)" : ""}`;
    if (bound === "upper") return w;
    const cut = w.indexOf(" of ");
    const head = (cut < 0 ? w : w.slice(0, cut)).replace(/^under /, "");
    const unit = cut < 0 ? "" : w.slice(cut);
    return bound === "lower" ? `at least a sliver${unit} (under ${head} recorded)` : `less than ${head}${unit} recorded (direction not known)`;
  }
  const pctShort = (v) => W.pctWords(v).replace(/^under /, "<");
  const boundKey = (n) => (n && n.state === "partial" ? (n.bound === "lower" || n.bound === "upper" ? n.bound : n.bound === null && n.bound_reason === "bound_not_moved" ? null : "unknown") : null);

  // One figure as a cell: a short label with ≥, ≤ or ~ and the words.
  // `kind` is "hours" or "share". An empty week has no figure at all.
  function cellOf(n, empty, kind) {
    if (empty) return { empty: true, value: null, state: null, bound: null, short: "", words: "no task finished this week" };
    const v = val(n);
    const fmt = kind === "share" ? pctShort : hoursShort;
    const words = kind === "share" ? (x) => `${W.pctWords(x)} of the week's lead time` : hoursWords;
    if (v === null) return { empty: false, value: null, state: "unavailable", bound: null, short: "no data", words: `not measured: ${arr(n && n.reasons).map(F.reasonText).join("; ") || F.reasonText("not_recorded")}` };
    const bound = boundKey(n);
    if (!bound) return { empty: false, value: v, state: n.state === "partial" ? "partial" : "measured", bound: null, short: v === 0 ? "0" : fmt(v), words: v === 0 ? "none" : words(v) };
    if (v === 0 && bound === "lower") return { empty: false, value: 0, state: "partial", bound, short: "≥0", words: "none recorded, but some time may not be recorded" };
    return { empty: false, value: v, state: "partial", bound, short: `${BOUND_SIGN[bound]}${fmt(v)}`, words: qualify(words(v), bound) };
  }

  // The direction of a ratio from its parts' directions (null is exact):
  // a lower numerator or an upper denominator makes it at least; the
  // opposite at most; both pulling the same way leave no direction.
  function ratioBound(nb, db) {
    if (nb === "unknown" || db === "unknown") return "unknown";
    const up = nb === "upper" || db === "lower";
    const down = nb === "lower" || db === "upper";
    return up && down ? "unknown" : up ? "upper" : down ? "lower" : null;
  }
  function shareOf(n, lead) {
    const v = val(n);
    const l = val(lead);
    if (v === null || l === null || !(l > 0)) return { state: "unavailable", reasons: arr(n && n.reasons).length ? n.reasons : ["no_measured_members"] };
    // An exact zero is zero of any lead time; a zero that is at least
    // zero stays "at least" whatever the base.
    if (v === 0 && !boundKey(n) && !(n && n.state === "partial")) return { state: "measured", value: 0, reasons: [] };
    const b = v === 0 && boundKey(n) === "lower" ? "lower" : ratioBound(boundKey(n), boundKey(lead));
    const partial = b || (n && n.state === "partial") || (lead && lead.state === "partial");
    if (!partial) return { state: "measured", value: v / l, reasons: [] };
    return { state: "partial", value: v / l, reasons: [...new Set([...arr(n && n.reasons), ...arr(lead && lead.reasons)])], bound: b || null, ...(b ? {} : { bound_reason: "bound_not_moved" }) };
  }

  // How a week's tasks' days lean, in words (B1).
  function weekDays(w, tasksOfWeek) {
    const has = typeof w.n_day_measured === "number";
    const c = has
      ? { exact: w.n_day_measured, before: w.n_day_on_or_before || 0, after: w.n_day_on_or_after || 0, about: w.n_day_about || 0 }
      : tasksOfWeek.reduce((a, t) => {
          const k = F.finishDay(t.finish_date).kind;
          a[k === "on" ? "exact" : k === "on_or_before" ? "before" : k === "on_or_after" ? "after" : "about"] += 1;
          return a;
        }, { exact: 0, before: 0, after: 0, about: 0 });
    const earlier = c.before + c.about > 0;
    const later = c.after + c.about > 0;
    const parts = [];
    if (c.exact) parts.push(`${c.exact} exact`);
    if (c.before) parts.push(`${c.before} on or before`);
    if (c.after) parts.push(`${c.after} on or after`);
    if (c.about) parts.push(`${c.about} with no direction`);
    const n = c.exact + c.before + c.after + c.about;
    const all = (k) => n > 0 && c[k] === n;
    const lean = all("exact") ? "all exact days" : all("before") ? "all \"on or before\" days" : all("after") ? "all \"on or after\" days" : `days: ${parts.join(", ")}`;
    const may = earlier && later ? "may include tasks that finished earlier or later" : earlier ? "may include tasks that finished earlier" : later ? "may include tasks that finished later" : "";
    return { counts: c, earlier, later, bracket: earlier && later ? "both" : earlier ? "left" : later ? "right" : null, words: n ? `${lean}${may ? `: ${may}` : ""}` : "" };
  }

  function overTime(doc, opts) {
    const o = opts || {};
    const fdOpts = Number.isInteger(o.year) ? { year: o.year } : undefined;
    if (!doc || typeof doc !== "object" || doc.schema !== "factory.site.by_week/1" || !Array.isArray(doc.weeks)) return { state: "absent" };
    const jobById = new Map(arr(o.jobs).filter((j) => j && typeof j.id === "string").map((j) => [j.id, j]));
    const nameOf = (id) => (jobById.has(id) && typeof o.nameOf === "function" ? o.nameOf(jobById.get(id)) : `Task ${String(id).slice(0, 8)}`);
    const rows = byJob(o.taskRows);
    const tasks = arr(doc.tasks).filter((t) => t && typeof t.job === "string");
    const taskOf = new Map(tasks.map((t) => [t.job, t]));
    const weeks = doc.weeks.filter(isWeek).map((w) => {
      const label = F.finishDay({ state: "measured", value: w.starts_on, reasons: [] }, fdOpts).day || w.starts_on;
      const days = weekDays(w, arr(w.jobs).map((j) => taskOf.get(j)).filter(Boolean));
      return {
        week: w.week,
        short: `W${w.week.slice(-2)}`,
        starts_on: w.starts_on,
        label,
        n: w.n,
        n_partial: Number.isInteger(w.n_partial) ? w.n_partial : 0,
        empty: w.n === 0,
        thin: w.n > 0 && w.n < THIN_WEEK,
        count: w.n === 0 ? "no task finished" : `${plural(w.n, "task")}${w.n_partial > 0 ? `, ${w.n_partial} partial` : ""}`,
        days,
        jobs: arr(w.jobs),
        raw: w,
      };
    });
    const open = arr(o.jobs).filter((j) => j && F.finishDay(j.finish_date, fdOpts).kind === "open").length;

    // The tasks with no day, summed once (I7).
    const unplacedIds = arr(doc.unplaced && doc.unplaced.jobs);
    const leadOf = (id) => {
      const r = rows.get(id);
      return (r && r.lead_time_ms) || (taskOf.get(id) && taskOf.get(id).lead_time_ms) || null;
    };
    const sumLead = (ids) => {
      let ms = 0;
      let partial = false;
      for (const id of ids) {
        const n = leadOf(id);
        const v = val(n);
        if (v === null) partial = true;
        else {
          ms += v;
          if (n.state === "partial") partial = true;
        }
      }
      return { ms, partial };
    };
    const groups = new Map();
    for (const id of unplacedIds) {
      const words = F.finishDay(jobById.has(id) ? jobById.get(id).finish_date : { state: "unavailable", reasons: arr(doc.unplaced.reasons) }, fdOpts).words;
      groups.set(words, [...(groups.get(words) || []), { job: id, name: nameOf(id), href: `#/task/${id}` }]);
    }
    const placedIds = tasks.map((t) => t.job);
    const placedLead = sumLead(placedIds);
    const unplacedLead = sumLead(unplacedIds);
    const allLead = { ms: placedLead.ms + unplacedLead.ms, partial: placedLead.partial || unplacedLead.partial };
    const nFinished = placedIds.length + unplacedIds.length;
    const hrs = (x) => hoursWords(x.ms).replace(/ hours?$/, "");
    const unplaced = {
      n: unplacedIds.length,
      groups: [...groups.entries()].map(([words, items]) => ({ words, items })),
      words: unplacedIds.length ? `${plural(unplacedIds.length, "finished task")} ${unplacedIds.length === 1 ? "has" : "have"} no finish day yet, so ${unplacedIds.length === 1 ? "it is" : "they are"} on no chart here: ${hrs(unplacedLead)} of the ${hrs(allLead)} lead-time hours of all finished tasks${allLead.partial ? " (both at least, as some lead times are partial)" : ""}.` : "",
    };
    const base = {
      n: placedIds.length,
      N: nFinished,
      words: nFinished ? `These weeks hold ${placedIds.length} of the ${nFinished} finished tasks: ${hrs(placedLead)} of their ${hrs(allLead)} lead-time hours${allLead.partial ? " (both at least, as some lead times are partial)" : ""}. ${unplacedIds.length ? `The other ${unplacedIds.length} ${unplacedIds.length === 1 ? "is" : "are"} not dated yet.` : "Every finished task is dated."}` : "No task has finished yet.",
    };
    if (!weeks.length) return { state: "empty", weeks: [], base, summary: { words: base.words }, days: { words: "" }, trend: { words: "" }, fe: { weeks: [], omitted: [], n: 0 }, unplaced, open, doc };

    // How sure the days are, over every placed task (B1).
    const tot = weeks.reduce((a, w) => ({ exact: a.exact + w.days.counts.exact, before: a.before + w.days.counts.before, after: a.after + w.days.counts.after, about: a.about + w.days.counts.about }), { exact: 0, before: 0, after: 0, about: 0 });
    const nPlaced = tot.exact + tot.before + tot.after + tot.about;
    const restShort = [tot.before ? `${tot.before} "on or before"` : "", tot.after ? `${tot.after} "on or after"` : "", tot.about ? `${tot.about} with no direction` : ""].filter(Boolean);
    const coarse = tot.exact * 2 < nPlaced;
    const days = {
      exact: tot.exact,
      n: nPlaced,
      coarse,
      words: `Finish days of the ${plural(nPlaced, "dated task")}: ${listWords([`${tot.exact} exact`, ...restShort])}.${coarse ? " So a week may hold tasks that finished in an earlier or later week, and the weeks show roughly when the work was recorded as finished, not exactly when it finished. Until Desk records the day each task finished, read a change between weeks as possibly coming from that alone." : ""}`,
    };

    // The trend sentence (N2) claims a change only between two weeks that
    // no bounded finish day could reach: every task in them has an exact
    // day, no "on or before" day lies in them or any later week, no "on or
    // after" day in them or any earlier week, and no day lacks a direction.
    // Non-thin weeks are preferred as the two ends.
    const thinNote = (ws) => {
      const thin = ws.filter((w) => w.thin);
      if (!thin.length) return "";
      return thin.length === 2 ? ` Both weeks are thin (fewer than ${THIN_WEEK} tasks), so read this as a hint, not a trend.` : ` The week of ${thin[0].label} is thin (fewer than ${THIN_WEEK} tasks), so read this as a hint, not a trend.`;
    };
    const anyAbout = weeks.some((w) => w.days.counts.about > 0);
    const reachable = (i) => anyAbout || weeks.some((w, j) => (j >= i && w.days.counts.before > 0) || (j <= i && w.days.counts.after > 0));
    const sure = weeks.filter((w, i) => !w.empty && w.days.counts.exact === w.n && !reachable(i));
    const solid = sure.filter((w) => !w.thin);
    const ends = solid.length >= 2 ? [solid[0], solid[solid.length - 1]] : sure.length >= 2 ? [sure[0], sure[sure.length - 1]] : null;
    let trend;
    if (ends) {
      const [a, b] = ends;
      const fa = cellOf(shareOf(a.raw.working_ms, a.raw.lead_ms), false, "share");
      const fb = cellOf(shareOf(b.raw.working_ms, b.raw.lead_ms), false, "share");
      trend = {
        claimed: true,
        words: `In weeks whose tasks all have exact days and that no bounded finish day could reach, agents' working time went from ${fa.words} (week of ${a.label}, ${a.count}) to ${fb.words} (week of ${b.label}, ${b.count}).${thinNote([a, b])}`,
        short: `Agents' working time went from ${fa.short} to ${fb.short} of lead time between the weeks of ${a.label} and ${b.label}`,
      };
    } else trend = { claimed: false, words: "No change from week to week is claimed: there are not yet enough exact finish days to compare." };

    // One short sentence leads the section (N6); the base, the days and the
    // trend in full sit behind a disclosure.
    const ge = allLead.partial ? "≥" : "";
    const lead = `${placedIds.length} of ${nFinished} finished tasks are dated (${ge}${hrs(placedLead)}h of ${ge}${hrs(allLead)}h lead time).`;
    const summary = {
      words: trend.claimed
        ? `${lead} ${trend.short}; see how the weeks are dated.`
        : `${lead.slice(0, -1)}; ${tot.exact === 0 ? `all ${nPlaced} days are bounds, so` : tot.exact === nPlaced ? "every day is exact, but" : `only ${tot.exact} of ${nPlaced} days are exact, so`} no change between weeks is claimed${tot.exact === nPlaced ? " yet" : ""}.`,
    };

    // Flow efficiency by week: each task's value as the range the true value
    // lies in (I5), and the week's median (I4).
    const omitted = [];
    const feWeeks = weeks.map((w) => {
      const marks = [];
      for (const job of w.jobs) {
        const t = taskOf.get(job) || { job };
        const finish = F.finishDay(t.finish_date, fdOpts);
        const row = rows.get(job) || { job, flow_efficiency: t.flow_efficiency };
        const fe = row.flow_efficiency || t.flow_efficiency;
        const v = val(fe);
        const base = { job, name: nameOf(job), href: `#/task/${job}`, finish };
        if (v === null) {
          omitted.push({ ...base, week: w.week, words: `flow efficiency not measured: ${arr(fe && fe.reasons).map(F.reasonText).join("; ") || F.reasonText("not_recorded")}` });
          continue;
        }
        const b = boundKey(fe);
        const kind = !b ? "exact" : b === "lower" ? "at_least" : b === "upper" ? "at_most" : "unknown";
        const lo = kind === "at_most" || kind === "unknown" ? 0 : v;
        const hi = kind === "at_least" || kind === "unknown" ? 1 : v;
        marks.push({ ...base, value: Math.min(1, Math.max(0, v)), kind, lo, hi, words: qualify(W.pctWords(v), b) });
      }
      const f = w.raw.flow_efficiency || {};
      const m = f.median;
      const mv = val(m);
      const n = Number.isInteger(f.n) ? f.n : 0;
      const N = Number.isInteger(f.N) ? f.N : w.n;
      let median;
      if (w.empty) median = { value: null, words: "no task finished" };
      else if (mv === null) median = { value: null, words: `no median: ${arr(m && m.reasons).map(F.reasonText).join("; ") || "not recorded"}` };
      else {
        const b = boundKey(m);
        const note = b === "unknown" ? ", measured tasks only" : "";
        median = { value: mv, bound: b, short: `${b && !(b === "upper" && /^under /.test(W.pctWords(mv))) ? BOUND_SIGN[b] : ""}${pctShort(mv)}`, words: `median ${qualify(W.pctWords(mv), b)}, ${n} of ${plural(N, "task")}${note}` };
      }
      return { week: w.week, label: w.label, empty: w.empty, marks: marks.sort((a, b) => a.value - b.value), median };
    });
    const nMarks = feWeeks.reduce((a, w) => a + w.marks.length, 0);
    return { state: "ok", weeks, base, summary, days, trend, fe: { weeks: feWeeks, omitted, n: nMarks }, unplaced, open, doc };
  }

  // The By week stacked bars (B3): one bar per finish week in the stack-up's
  // colors and order. `mode` is "share" (each part as a share of the week's
  // lead time, so a week of 5 tasks and a week of 1 compare), "all" (hours of
  // all elapsed time) or "working" (hours of agent working time). The part of
  // the lead time with no split (a task whose log could not be read) is its
  // own hatched part.
  function weekBars(ot, mode) {
    const m = mode === "all" || mode === "working" ? mode : "share";
    const doc = ot.doc || {};
    const classes = arr(doc.classes).length ? doc.classes : ["value", "support"];
    const wastes = arr(doc.wastes).length ? doc.wastes : [...new Set(ot.weeks.flatMap((w) => Object.keys((w.raw && w.raw.by_waste_ms) || {})))];
    const waits = arr(doc.idle_waited_on).length ? doc.idle_waited_on : W.WAIT_KEYS;
    return ot.weeks.map((w) => {
      if (w.empty) return { ...w, segments: [], total: null, label: "" };
      const r = w.raw;
      const segs = [];
      const add = (key, label, n, cause) => {
        const v = val(n);
        if (v === null || v <= 0) return;
        segs.push({ key, label, cause: cause || null, ms: v, state: n.state, bound: boundKey(n), node: n });
      };
      const segLabel = (k) => (F.SEGMENTS.find((s) => s.key === k) || { label: k }).label;
      const order = F.SEGMENTS.map((s) => s.key);
      const work = [...classes.map((k) => [k, r.by_class_ms && r.by_class_ms[k]]), ...wastes.map((k) => [k, r.by_waste_ms && r.by_waste_ms[k]]), ["agents_working_unlabeled", r.agents_working_unlabeled_ms], ["not_labeled", r.not_labeled_ms]].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
      for (const [k, n] of work) add(k, segLabel(k), n);
      if (m !== "working") {
        for (const k of W.WAIT_KEYS.filter((x) => waits.includes(x))) add(`wait_${k}`, W.waitCauseLabel(k), r.idle_by_waited_on_ms && r.idle_by_waited_on_ms[k], k);
        const lead = val(r.lead_ms);
        const split = (val(r.working_ms) || 0) + (val(r.idle_ms) || 0);
        if (lead !== null && lead - split > 1000) segs.push({ key: "unsplit", label: "Split not known (a task's log could not be read)", cause: null, ms: lead - split, state: "partial", bound: "unknown", node: { state: "partial", value: lead - split, reasons: ["split_not_known"], bound: "unknown" } });
      }
      const totalN = m === "working" ? r.working_ms : r.lead_ms;
      const total = val(totalN);
      if (m === "share") {
        const lead = val(r.lead_ms);
        // N1: a share's direction is the share's own, from its part and
        // the week's lead time (shareOf), as in the cause table.
        for (const s of segs) {
          const sh = shareOf(s.node, r.lead_ms);
          s.share = lead > 0 ? s.ms / lead : 0;
          s.state = sh.state === "unavailable" ? "partial" : sh.state;
          s.bound = sh.state === "partial" ? sh.bound || null : null;
        }
      }
      const tc = cellOf(totalN, false, "hours");
      return { ...w, segments: segs, total, totalWords: m === "share" ? `${tc.words} of lead time, as 100%` : tc.words, totalShort: m === "share" ? "100%" : tc.short };
    });
  }

  // The cause × week table (I2, I6): one row per cause in Pareto order over
  // these weeks, one column per week (the oldest on the left), each cell its
  // hours or its share of the week's lead time and a bar on one stated
  // scale. Waiting causes are left out in working mode.
  function causeTable(ot, mode) {
    const m = mode === "all" || mode === "working" ? mode : "share";
    const doc = ot.doc || {};
    const keys = [];
    if (m !== "working") for (const k of arr(doc.idle_waited_on).length ? doc.idle_waited_on : W.WAIT_KEYS) keys.push({ key: `waiting:${k}`, pick: (r) => r.idle_by_waited_on_ms && r.idle_by_waited_on_ms[k] });
    const wastes = arr(doc.wastes).length ? doc.wastes : [...new Set(ot.weeks.flatMap((w) => Object.keys((w.raw && w.raw.by_waste_ms) || {})))].sort();
    for (const k of wastes) keys.push({ key: `${k}:all`, pick: (r) => r.by_waste_ms && r.by_waste_ms[k] });
    const kind = m === "share" ? "share" : "hours";
    const rowsOut = keys
      .map(({ key, pick }) => {
        const ns = ot.weeks.map((w) => (w.empty ? null : pick(w.raw)));
        const total = ns.reduce((a, n) => a + (val(n) || 0), 0);
        const cells = ot.weeks.map((w, i) => {
          const n = w.empty ? null : m === "share" ? shareOf(ns[i], w.raw.lead_ms) : ns[i];
          return { week: w.week, ...cellOf(n, w.empty, kind) };
        });
        return { key, label: W.causeWords(key), segment: W.causeSegment(key), wait: key.startsWith("waiting:") ? key.slice(8) : null, href: causeRoute(key), total_ms: total, totalWords: hoursWords(total), cells };
      })
      .filter((r) => r.total_ms > 0)
      .sort((a, b) => b.total_ms - a.total_ms || (a.key < b.key ? -1 : 1));
    const max = Math.max(0, ...rowsOut.flatMap((r) => r.cells.map((c) => c.value || 0)));
    let scale;
    if (kind === "share") {
      const top = [0.1, 0.2, 0.25, 0.5, 1].find((x) => x >= max - 1e-9) || 1;
      scale = { max: top, words: `bars run from 0 to ${W.pctWords(top)} of each week's lead time, the same linear scale in every cell` };
    } else {
      const s = timeScale(max);
      scale = { max: s.max_ms, words: `bars run from 0 to ${tickWords(s.max_ms, s)} ${s.unit} per week, the same linear scale in every cell` };
    }
    for (const r of rowsOut) for (const c of r.cells) c.frac = c.value === null || !(scale.max > 0) ? null : Math.min(1, c.value / scale.max);
    return { mode: m, kind, columns: ot.weeks, rows: rowsOut, scale };
  }

  // Column widths for a chart of `n` weeks in `avail` pixels: fit the frame
  // (never wider than `max`), and only when a column would be narrower than
  // `min` let the chart scroll, opening at the newest week. Labels go on
  // every `every`th week so no two overlap; value labels need `valuePx`.
  function weekAxis(n, avail, o) {
    const opt = o || {};
    const min = opt.min || 8;
    const max = opt.max || 120;
    const labelPx = opt.labelPx || 58;
    const valuePx = opt.valuePx || 40;
    const count = Math.max(1, n);
    const fit = Math.floor(avail / count);
    const colW = Math.max(min, Math.min(max, fit));
    const width = colW * count;
    const every = Math.max(1, Math.ceil(labelPx / colW));
    // Week labels (N5): every Nth week counted back from the newest, each
    // pulled inside the frame at the edges, and any label that would touch
    // the one after it dropped, so none is clipped and none overlaps.
    const labels = [];
    for (let i = count - 1; i >= 0; i -= every) {
      const mid = i * colW + colW / 2;
      let left = mid - labelPx / 2;
      let anchor = "middle";
      let x = mid;
      if (left < 0) {
        left = i * colW;
        anchor = "start";
        x = left;
      }
      if (left + labelPx > width) {
        left = width - labelPx;
        anchor = "end";
        x = width;
      }
      if (left < 0) left = 0;
      const right = Math.min(width, left + labelPx);
      if (labels.length && right > labels[0].left) continue;
      labels.unshift({ i, x, anchor, left, right });
    }
    return { colW, width, scroll: width > avail, every, showValues: colW >= valuePx, labels, brackets: colW >= 14 };
  }

  // Where a week's flow efficiency marks and its median label sit inside
  // one column (N7): the label at the right edge and the marks kept to its
  // left, or, when they cannot both fit, no label (its words are in the
  // weeks table and the median's tooltip). Offsets are from the column's
  // left edge; each mark is 10 px wide.
  function feLayout(colW, n, o) {
    const labelPx = (o && o.labelPx) || 34;
    const pad = 3;
    const half = 5;
    const place = (lo, hi) => {
      const span = hi - lo - 2 * half;
      if (span < 0) return null;
      const step = n > 1 ? Math.min(12, span / (n - 1)) : 0;
      if (n > 1 && step < 3) return null;
      const mid = (lo + hi) / 2;
      return Array.from({ length: n }, (_, k) => mid + (k - (n - 1) / 2) * step);
    };
    const labelLeft = colW - pad - labelPx;
    const withLabel = labelLeft > 0 ? place(0, labelLeft - 2) : null;
    if (withLabel) return { xs: withLabel, label: { x: colW - pad, anchor: "end", left: labelLeft, right: colW - pad } };
    const span = Math.max(0, colW - 2 * half);
    const step = n > 1 ? Math.min(12, span / (n - 1)) : 0;
    return { xs: Array.from({ length: n }, (_, k) => colW / 2 + (k - (n - 1) / 2) * step), label: null };
  }

  // Each task, in finish order (the "Each task" toggle): the stack-up's bars
  // for finished tasks with a day, earliest first; the rest are counted.
  function eachTaskBars(bars) {
    const dated = arr(bars).filter((b) => b && b.finish && b.finish.day && !b.open);
    return dated.slice().sort((a, b) => (a.finish.key < b.finish.key ? -1 : a.finish.key > b.finish.key ? 1 : 0) || (a.pos || 0) - (b.pos || 0));
  }

  // The picker's rows (walk.js pickerRows) with the finished group sorted by
  // finish day: "newest" (the default) or "oldest" first; finished tasks with
  // no day keep their order after the dated ones. The other group keeps its
  // own order (the latest to start first). Each row gains `finish`, its
  // finish day in words. `finishOf(id)` is format.js finishDay for that task.
  function sortPicker(rows, finishOf, dir) {
    const oldest = dir === "oldest";
    const list = arr(rows).map((r, i) => ({ ...r, finish: finishOf(r.id), i }));
    const groupRank = new Map();
    for (const r of list) if (!groupRank.has(r.group)) groupRank.set(r.group, groupRank.size);
    list.sort((a, b) => {
      const g = groupRank.get(a.group) - groupRank.get(b.group);
      if (g) return g;
      if (a.group !== "finished") return a.i - b.i;
      const ak = a.finish.key;
      const bk = b.finish.key;
      if (ak && bk && ak !== bk) return (ak < bk ? -1 : 1) * (oldest ? 1 : -1);
      if (ak && !bk) return -1;
      if (!ak && bk) return 1;
      return a.i - b.i;
    });
    return list.map(({ i, ...r }) => r);
  }

  // -------------------------------------------------- the Pareto of causes

  // One pattern with the route parser (format.js), so a link this builds
  // is always a page that parser opens.
  const CAUSE_KEY = F.CAUSE_ID;
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
      const b = { key: c.cause, label: W.causeWords(c.cause), waste, wait: waste === "waiting" ? what : null, segment: W.causeSegment(c.cause), ms: c.total_ms, jobs: arr(c.jobs).length, index: i, href: causeRoute(c.cause) };
      if (c.cause === NEXT_PROMPT) Object.assign(b, whyChildren(c, o.split !== false));
      return b;
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

  // The parent cause Desk splits by why the agent stopped (D5).
  const NEXT_PROMPT = "waiting:next_prompt";
  const SECOND = 1000;
  const whyOfKey = (k) => {
    const p = String(k).split(":");
    return p.length === 3 && `${p[0]}:${p[1]}` === NEXT_PROMPT && W.WHY_KEYS.includes(p[2]) ? p[2] : null;
  };

  // The Pareto bar of waiting for the next prompt, split by why the agent
  // stopped: `why_split` is "on" (its `children` stack it, in W.WHY_KEYS
  // order: the actionable classes from the base, then the human gates, then
  // the time whose why is not known), "off" (the toggle is off), "absent"
  // (Desk publishes no split) or "mismatch" (the children do not add up to
  // the bar, so it is not split rather than split wrongly).
  function whyChildren(row, on) {
    if (!Array.isArray(row.children)) return { why_split: "absent", children: [] };
    const kids = row.children
      .filter((c) => c && typeof c.cause === "string" && whyOfKey(c.cause) && typeof c.total_ms === "number" && Number.isFinite(c.total_ms) && c.total_ms > 0)
      .map((c) => ({ why: whyOfKey(c.cause), key: c.cause, label: W.whyName(whyOfKey(c.cause)), ms: c.total_ms, share_of_parent: row.total_ms > 0 ? c.total_ms / row.total_ms : 0, jobs: arr(c.jobs).length, reasons: arr(c.reasons), desk_bound: "bound" in c ? c.bound : undefined, href: causeRoute(c.cause) }))
      .sort((a, b) => W.WHY_KEYS.indexOf(a.why) - W.WHY_KEYS.indexOf(b.why));
    if (Math.abs(kids.reduce((a, c) => a + c.ms, 0) - row.total_ms) > SECOND) return { why_split: "mismatch", children: [] };
    // While some of the bar has no known why, each class is at least its
    // time and at most its time plus the time not known (addendum §4).
    const nk = (kids.find((c) => c.why === "not_known") || { ms: 0 }).ms;
    for (const c of kids) {
      // Desk states each class's bound (D5, `bound`); older files do not, so
      // it follows from the time not known.
      c.bound = c.why === "not_known" ? null : c.desk_bound !== undefined ? (c.desk_bound === "lower" ? "lower" : null) : nk > 0 ? "lower" : null;
      delete c.desk_bound;
      if (c.bound) {
        c.ceiling_ms = c.ms + nk;
        c.ceiling_share = row.total_ms > 0 ? c.ceiling_ms / row.total_ms : 0;
      }
    }
    return { why_split: on ? "on" : "off", children: kids, not_known_ms: nk };
  }

  // A class figure in words with its bound: "at least 5 hours (up to 17
  // hours)", or "≥5h (≤17h)" in the short form; exact when nothing is not
  // known. `c` has `ms` and, while bounded, `ceiling_ms`.
  function whyAmountWords(c, short) {
    if (!c) return "";
    if (c.bound === "lower" && !(typeof c.ceiling_ms === "number" && c.ceiling_ms - c.ms > SECOND)) return short ? `≥${hoursShort(c.ms)}` : `at least ${hoursWords(c.ms)}`;
    if (short) return typeof c.ceiling_ms === "number" && c.ceiling_ms - c.ms > SECOND ? `≥${hoursShort(c.ms)} (≤${hoursShort(c.ceiling_ms)})` : hoursShort(c.ms);
    return W.boundedWords(c.ms, c.ceiling_ms, hoursWords);
  }
  // Its share of the parent bar, the same way: "at least 13% (up to 43%)".
  function whyShareWords(c, short) {
    if (!c) return "";
    const f = short ? pctShort : W.pctWords;
    if (!(typeof c.ceiling_share === "number" && c.ceiling_ms - c.ms > SECOND)) return f(c.share_of_parent);
    // A floor under 1% already says so: "under 1% (up to 52%)", never "at least under 1%".
    const floor = f(c.share_of_parent);
    const lo = /^(under |<)/.test(floor) ? floor : `${short ? "≥" : "at least "}${floor}`;
    return `${lo} (${short ? "≤" : "up to "}${f(c.ceiling_share)})`;
  }

  // The "Split by why" toggle's state for a Pareto model: pressed when the
  // bar is split, not pressed when the reader turned it off, and disabled,
  // with its reason, when there is nothing to split.
  function whyToggleState(model) {
    const np = model && Array.isArray(model.bars) ? model.bars.find((b) => b.key === NEXT_PROMPT) : null;
    const off = (note) => ({ state: "disabled", pressed: false, disabled: true, note });
    if (!np) return off("No waiting for the next prompt is ranked, so there is nothing to split.");
    if (np.why_split === "absent") return off("Desk does not publish why the agent stopped yet, so there is nothing to split.");
    if (np.why_split === "mismatch") return off("Desk's split by why does not add up to the bar, so there is nothing to split.");
    return np.why_split === "on" ? { state: "on", pressed: true, disabled: false, note: "" } : { state: "off", pressed: false, disabled: false, note: "" };
  }

  // Rank causes' lede, with real numbers: how many tasks the ranking
  // counts, the largest cause and its share (and when one task holds most
  // of it), how few causes carry four fifths of the time (the vital few),
  // and the largest cause agents can fix once waiting is left out. `opts`
  // ({ doc, taskRows, stackRows, nameOf }) lets it read the top cause's
  // tasks.
  function causesLede(all, working, opts) {
    if (!all || all.state === "absent") return "The causes file is not published yet, so this page cannot rank causes. No bar is drawn rather than a zero.";
    if (!all.bars.length) return "No cause of waste is recorded yet in the tasks the ranking counts.";
    const o = opts || {};
    const top = all.bars[0];
    const parts = [];
    if (all.n !== null && all.N !== null) parts.push(`The ranking counts ${all.n} of the ${all.N} tasks; the note under the chart says why the rest are left out. Across those ${all.n}, the`);
    else parts.push("The");
    parts.push(` largest cause, ${top.label.charAt(0).toLowerCase()}${top.label.slice(1)}, cost ${hoursWords(top.ms)}: ${W.pctWords(top.share)} of the ${hoursWords(all.total_ms)} ranked`);
    let one = "";
    if (o.doc && top.href) {
      const d = causeDetail(o.doc, top.key, { taskRows: o.taskRows, stackRows: o.stackRows, nameOf: o.nameOf });
      const t = d.state === "ok" ? d.tasks[0] : null;
      if (t && t.ms !== null && d.jobs > 1 && t.ms > 0.5 * top.ms) one = `; ${hoursWords(t.ms).replace(/ hours?$/, "")} of its ${hoursWords(top.ms)} are in one task, “${t.name}”`;
    }
    parts.push(`${one}.`);
    const k = all.bars.findIndex((b) => b.cum >= 0.8) + 1;
    if (k > 1 && k < all.bars.length) parts.push(` ${k === 2 ? "Two causes" : k === 3 ? "Three causes" : `${k} causes`} of ${all.bars.length} carry ${W.pctWords(all.bars[k - 1].cum)} of the time: those are the vital few.`);
    else if (k === 1 && all.bars.length > 1) parts.push(` That one cause of ${all.bars.length} carries most of the time: it is the vital few on its own.`);
    if (working && working.bars && working.bars.length) {
      const w = working.bars[0];
      parts.push(` Leave waiting out, and the largest cause agents can fix in their own work is ${w.label.charAt(0).toLowerCase()}${w.label.slice(1)}, at ${hoursWords(w.ms)}.`);
    } else if (working) parts.push(" No labeled waste in agents' working time is recorded yet, so with waiting left out there is nothing to rank.");
    return parts.join("");
  }

  // The Pareto chart's caption in each mode, with the ranking's coverage.
  function paretoCaption(model) {
    const m = model || {};
    const cover = typeof m.n === "number" && typeof m.N === "number" ? ` It counts ${m.n} of ${m.N} tasks.` : "";
    return m.mode === "working"
      ? `Agent working time only: waiting is left out (${hoursWords(m.left_out || 0)} of it), which ranks the causes agents can fix in their own work. Select a bar to open its cause.${cover}`
      : `Every cause, waiting included, by the time it cost. Select a bar to open its cause: its tasks, its stretches, and a prompt to start an A3.${cover}`;
  }

  // Finished tasks (their card says done) that the evaluator has not
  // labeled yet: the ranking leaves them out and no check can count them.
  function unlabeledFinished(jobs, nameOf) {
    const name = typeof nameOf === "function" ? nameOf : (j) => `Task ${String(j.id).slice(0, 8)}`;
    return arr(jobs)
      .filter((j) => j && typeof j.id === "string" && j.status === "done" && j.finish_basis !== "labels")
      .map((j) => ({ job: j.id, name: name(j), href: `#/task/${j.id}` }));
  }
  // The sentence that leads into their links, on Rank causes or on Act.
  function unlabeledWords(n, where) {
    if (!(n > 0)) return "";
    const one = n === 1;
    const head = `${plural(n, "finished task")} ${one ? "is" : "are"} waiting for the evaluator's waste labels; until ${one ? "it is" : "they are"} labeled, `;
    return where === "act" ? `${head}${one ? "it cannot" : "they cannot"} count toward any check.` : `${head}the ranking leaves ${one ? "it" : "them"} out.`;
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
    const why = whyOfKey(key);
    if (why) return `Waiting is idle time, when no agent of the task was working. Here the agent had stopped and was waiting for the operator's next prompt, and ${why === "not_known" ? "why it stopped is not known: the evaluator has not labeled the stop, could not tell, or no stop was recorded" : W.WHY_WORDS[why]}.${W.whyGroup(why) === "gate" ? " This is a human gate: its length is mostly the operator's response time, which this split does not judge." : ""}`;
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
    const why = whyOfKey(key);
    if (why) {
      // Desk's own figure for the task, with its state: a class is a lower
      // bound while some of the task's time is not classified.
      const n = task && task.next_prompt_by_why_ms ? W.stated(task.next_prompt_by_why_ms[why]) : null;
      if (n && n.state !== "unavailable") {
        const bound = n.state === "partial" ? (n.bound === "upper" ? "upper" : n.bound === null ? "none" : "lower") : null;
        const out = { ms: n.value, bound, source: "why" };
        // A class is at most its time plus the task's own time not known.
        const nk = why !== "not_known" && bound === "lower" ? W.stated(task.next_prompt_by_why_ms.not_known) : null;
        if (nk && nk.state !== "unavailable" && nk.value > 0) out.ceiling_ms = n.value + nk.value;
        return out;
      }
    }
    const [waste, what] = key.split(":");
    if (waste === "waiting" && !why) {
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
    if (whyOfKey(key)) return whyCauseDetail(doc, key, c, nameOf, promptNameOf);
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

  // A sub-cause's page (#/causes/waiting:next_prompt:<why>): Desk lists it
  // under its parent's `children`, never beside it in the ranking.
  //   state "not_ranked"  no parent row (no counted task waited for a prompt)
  //   state "not_split"   Desk publishes no split of the parent yet
  //   state "none"        the split holds no time for this why
  //   state "ok"          with `child` { why, parent_ms, share_of_parent,
  //                       rank, of, reasons } beside causeDetail's fields
  function whyCauseDetail(doc, key, c, nameOf, promptNameOf) {
    const why = whyOfKey(key);
    const label = W.causeWords(key);
    const parent = doc.causes.find((x) => x && x.cause === NEXT_PROMPT);
    const base = { key, label, why, waste: "waiting", wait: "next_prompt", segment: "waiting", n: doc.n, N: doc.N, basis: doc.basis || null };
    if (!parent) return { ...base, state: "not_ranked", of: paretoModel(doc, "all", { maxBars: Infinity }).bars.length };
    if (!Array.isArray(parent.children)) return { ...base, state: "not_split", parent_ms: parent.total_ms };
    const split = whyChildren(parent, true);
    if (split.why_split === "mismatch") return { ...base, state: "not_split", parent_ms: parent.total_ms, mismatch: true };
    // Only the known classes are ranked; not known is the unclassified part.
    const kids = split.children.filter((x) => x.why !== "not_known").sort((a, b) => b.ms - a.ms || W.WHY_KEYS.indexOf(a.why) - W.WHY_KEYS.indexOf(b.why));
    const kid = split.children.find((x) => x.why === why);
    const nkKid = split.children.find((x) => x.why === "not_known");
    const nkMs = nkKid ? nkKid.ms : 0;
    const nkReasons = nkKid ? nkKid.reasons : [];
    const row = parent.children.find((x) => x && x.cause === key);
    if (!kid || !row) return { ...base, state: "none", parent_ms: parent.total_ms, not_known_ms: why === "not_known" ? 0 : nkMs, not_known_reasons: why === "not_known" ? [] : nkReasons };
    const rank = why === "not_known" ? null : kids.indexOf(kid) + 1;
    const ctx2 = { tasks: byJob(c.taskRows), stacks: byJob(c.stackRows), limit: typeof doc.references_per_cause === "number" ? doc.references_per_cause : null };
    const tasks = arr(row.jobs)
      .filter((j) => typeof j === "string")
      .map((job) => ({ job, name: nameOf(job), promptName: promptNameOf(job), href: `#/task/${job}`, ...(taskCauseMs(key, job, row, ctx2) || { ms: null, bound: null, source: null }) }))
      .sort((a, b) => (b.ms === null ? -1 : b.ms) - (a.ms === null ? -1 : a.ms) || (a.job < b.job ? -1 : 1));
    const spans = arr(row.spans)
      .filter((s) => s && typeof s.job === "string" && typeof s.start_ms === "number" && typeof s.end_ms === "number" && s.end_ms >= s.start_ms)
      .map((s, k) => ({ k, job: s.job, name: nameOf(s.job), start_ms: s.start_ms, end_ms: s.end_ms, ms: s.end_ms - s.start_ms }))
      .sort((a, b) => b.ms - a.ms || a.k - b.k);
    const total = typeof doc.total_ms === "number" && doc.total_ms > 0 ? doc.total_ms : paretoModel(doc, "all", { maxBars: Infinity }).total_ms;
    return {
      ...base,
      state: "ok",
      ms: kid.ms,
      jobs: tasks.length,
      ceiling_ms: kid.ceiling_ms,
      all: { rank, of: kids.length, share: total > 0 ? kid.ms / total : 0, among: "why" },
      working: null,
      total_ms: total,
      tasks,
      spans,
      spans_cut: typeof doc.references_per_cause === "number" && arr(row.spans).length >= doc.references_per_cause,
      child: { why, parent: NEXT_PROMPT, parent_ms: parent.total_ms, share_of_parent: kid.share_of_parent, ceiling_ms: kid.ceiling_ms, ceiling_share: kid.ceiling_share, bound: kid.bound, rank, of: kids.length, reasons: kid.reasons, not_known_ms: why === "not_known" ? 0 : nkMs },
    };
  }

  // "classified as …" words for each class, for a page with none of it.
  const WHY_AS = { stopped_short: "stopped short", question: "a question", error_limit: "an error or a limit", interrupted: "interrupted by the operator", decision: "a decision", approval: "an approval", acceptance: "an acceptance" };

  // A why page's lede after the class's meaning, as parts: strings, and
  // { link: "parent" } where the page links to waiting for the next prompt.
  // Every class figure carries its bound (I1); a class with no classified
  // wait is a zero only when every wait is classified (I2); only the known
  // classes are ranked (m3).
  function whyCauseLedeParts(d) {
    const P = { link: "parent" };
    if (d.state === "not_ranked") return [`No task the ranking counts waited for the next prompt, so no wait has this why. The ranking counts ${d.n} of ${d.N} tasks.`];
    if (d.state === "not_split") {
      if (d.mismatch) return [`Desk's split of the ${hoursWords(d.parent_ms)} of `, P, " by why does not add up to it, so this page lists no waits rather than wrong ones."];
      return [`Why the agent stopped is not known yet for the ${hoursWords(d.parent_ms)} of `, P, ": Desk does not publish it, so that waiting is not split and this page has no waits to list. No figure is shown rather than a zero."];
    }
    if (d.state === "none") {
      if (d.not_known_ms > 0) {
        const why = d.not_known_reasons && d.not_known_reasons.length ? ` (why: ${d.not_known_reasons.map(W.whyReasonWords).join("; ")})` : "";
        return [`No wait is classified as ${WHY_AS[d.why] || W.whyName(d.why).toLowerCase()} yet. Up to ${hoursWords(d.not_known_ms)} of the ${hoursWords(d.parent_ms)} of `, P, ` whose why is not known may hold some${why}.`];
      }
      return [`None of the ${hoursWords(d.parent_ms)} of `, P, ` in the tasks the ranking counts has this why: every one of them is classified.`];
    }
    const c = d.child;
    const amount = whyAmountWords({ ms: d.ms, ceiling_ms: c.ceiling_ms });
    const share = whyShareWords({ ms: d.ms, ceiling_ms: c.ceiling_ms, share_of_parent: c.share_of_parent, ceiling_share: c.ceiling_share });
    // While some time is not known, the rank and the task count are of
    // classified time only: the class may hold more, in more tasks.
    const partly = typeof c.ceiling_ms === "number";
    const place = c.rank ? `, the ${ordinal(c.rank)} of ${c.of} known reasons the agent stopped, ${partly ? "ranked by classified time" : "by time"}.` : ": the part of the waiting whose why is not classified.";
    const jobs = partly ? (d.jobs === 1 ? "One task has classified time with this why." : `${d.jobs} tasks have classified time with this why.`) : d.jobs === 1 ? "One task has it." : `${d.jobs} tasks have it.`;
    const nk = d.why === "not_known" && c.reasons.length ? ` Why it is not known: ${c.reasons.map(W.whyReasonWords).join("; ")}.` : "";
    const floor = d.why !== "not_known" && c.ceiling_ms ? ` While ${hoursWords(c.not_known_ms)} of the waiting has no known why, this class's time is a floor: some of that time may be this class too.` : "";
    return [`Across the ${d.n} tasks the ranking counts, it cost ${amount} (counted per task): ${share} of the ${hoursWords(c.parent_ms)} of `, P, `${place} ${jobs}${nk}${floor}`];
  }
  function whyCauseLede(d) {
    return whyCauseLedeParts(d).map((x) => (typeof x === "string" ? x : "waiting for the next prompt")).join("");
  }

  // Every wait of the finished tasks a why sub-cause counts, from their map
  // files (Desk's `waits`, map/2), longest first: each with its task, its
  // next-prompt time, how the turn ended, who decided its why and with what
  // confidence, and the map item that holds it. `maps` is { job: map }.
  // `held_ms` is their sum; any rest of the sub-cause is time no recorded
  // wait holds (stop not recorded).
  function whyWaitRows(d, maps, nameOf) {
    if (!d || d.state !== "ok") return { rows: [], held_ms: 0, rest_ms: 0, missing: [] };
    const name = typeof nameOf === "function" ? nameOf : (job) => `Task ${String(job).slice(0, 8)}`;
    const rows = [];
    const missing = [];
    for (const t of d.tasks) {
      const map = maps ? maps[t.job] : null;
      if (!map || !Array.isArray(map.waits)) {
        missing.push(t.job);
        continue;
      }
      map.waits.forEach((w, k) => {
        if (!w || typeof w !== "object" || w.why !== d.why || typeof w.next_prompt_ms !== "number" || !(w.next_prompt_ms > 0)) return;
        rows.push({
          job: t.job,
          name: name(t.job),
          k,
          session: String(w.session || "").slice(0, 8),
          start_ms: w.start_ms,
          end_ms: w.end_ms,
          ms: w.next_prompt_ms,
          stop: W.stopWords(w) || "not recorded: these facts carry no stop",
          source: W.whySourceWords(w.why_source),
          confidence: w.why_source === "none" ? "none: not classified" : W.confidenceText(w.confidence),
          reasons: arr(w.reasons),
          item: spanItem(map, { start_ms: w.start_ms, end_ms: w.end_ms }),
        });
      });
    }
    rows.sort((a, b) => b.ms - a.ms || (a.job < b.job ? -1 : a.job > b.job ? 1 : a.k - b.k));
    const held = rows.reduce((a, r) => a + r.ms, 0);
    return { rows, held_ms: held, rest_ms: Math.max(0, d.ms - held), missing };
  }

  // The A3 question each why raises (addendum §4: "why do agents stop short?").
  const WHY_A3 = {
    stopped_short: "why do agents stop short of what their authorization covers?",
    question: "could the agents' questions have been avoided?",
    error_limit: "why do agents' turns end on an error or a limit?",
    interrupted: "why does the operator interrupt agents mid-turn?",
    decision: "could fewer of these decisions reach the operator, or reach the operator sooner?",
    approval: "could standing authorization cover more of these approvals?",
    acceptance: "could finished work reach acceptance faster, or need less of it?",
    not_known: "why is the reason the agent stopped not known, and what would let us classify it?",
  };

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
  // and its entry in the data file, found by key (never by position, which
  // moves when the ranking changes).
  function a3Prompt(d, links) {
    const l = links || {};
    const index = l.indexUrl ? ` Index of every data file: ${l.indexUrl}` : "";
    const top = arr(d.tasks).filter((t) => t.ms !== null).slice(0, 3);
    const named = top.map((t) => `${t.promptName || `factory task ${String(t.job).slice(0, 8)}`}, ${typeof t.ceiling_ms === "number" ? W.boundedWords(t.ms, t.ceiling_ms, hoursWords) : `${t.bound === "lower" ? "at least " : ""}${hoursWords(t.ms)}`}`);
    const tasksText = named.length ? ` Its largest ${named.length === 1 ? "task is" : "tasks are"} ${named.join("; ")}${d.jobs > named.length ? `; of ${d.jobs} tasks in all` : ""}.` : "";
    const child = d.child || null;
    // A class's share of all the time ranked carries its bound too.
    const allShare = child && typeof child.ceiling_ms === "number" && d.total_ms > 0 && d.all && typeof d.all.share === "number" ? whyShareWords({ ms: d.ms, ceiling_ms: child.ceiling_ms, share_of_parent: d.all.share, ceiling_share: child.ceiling_ms / d.total_ms }) : d.all && typeof d.all.share === "number" ? W.pctWords(d.all.share) : null;
    const share = allShare ? `, ${allShare} of all the time ranked` : "";
    const rank = d.all && d.all.rank ? ` It ranks ${ordinal(d.all.rank)} of ${d.all.of} causes by time.` : "";
    const childShare = child ? whyShareWords({ ms: d.ms, ceiling_ms: child.ceiling_ms, share_of_parent: child.share_of_parent, ceiling_share: child.ceiling_share }) : "";
    const rankText = child ? ` It is ${childShare} of the ${hoursWords(child.parent_ms)} of waiting for the next prompt${child.rank ? `, the ${ordinal(child.rank)} of ${child.of} known reasons the agent stopped, ${child.ceiling_ms ? "ranked by classified time" : "by time"}` : ": the part whose why is not classified"}.${child.ceiling_ms ? ` While ${hoursWords(child.not_known_ms)} of that waiting has no known why, this class's time is a floor.` : ""}` : rank;
    const where = child ? `the entry with cause "${d.key}" in the children of the entry with cause "${child.parent}"` : `the entry with cause "${d.key}"`;
    const facts = `It cost ${child ? whyAmountWords({ ms: d.ms, ceiling_ms: child.ceiling_ms }) : hoursWords(d.ms)}, counted per task${share}.${rankText}${tasksText} Its page is ${l.route}, and its data is ${where} in ${l.dataUrl}.${child ? " Each wait's stop facts, who decided its why and with what confidence are in each task's map file, under waits." : ""}`;
    // An A3 already open for this cause: check or extend it, never start a duplicate.
    const open = arr(l.existing).filter((x) => x && x.url);
    if (open.length) {
      const at = open.map((x) => `${x.ref} (${x.url})${x.countermeasure ? `, with countermeasure ${x.countermeasure.ref}${x.countermeasure.merged ? ", merged, not yet checked" : ", not yet merged"}` : ""}`).join("; ");
      return `Factory cause "${d.label}" (${d.key}): an A3 already exists at ${at}; help me check or extend it. ${facts} Walk me through its biggest stretches first, then help me check whether the countermeasure worked, with labeled tasks from before and after it shipped, or extend the A3 if the cause is still open.${index}`;
    }
    if (child) return `Help me start an A3 on factory cause "${d.label}" (${d.key}): ${WHY_A3[child.why]} ${facts} Walk me through its longest waits first, then draft the A3 with me: the background, the current condition, the root cause, a countermeasure to try, and how we would check it worked with labeled tasks from before and after it shipped.${index}`;
    return `Help me start an A3 on factory cause "${d.label}" (${d.key}). ${facts} Walk me through its biggest stretches first, then draft the A3 with me: the background, the current condition, the root cause, a countermeasure to try, and how we would check it worked with labeled tasks from before and after it shipped.${index}`;
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

  // The cause a kaizen issue works on, from its URL, or null: what the
  // store build writes into data.json kaizen_issues[].cause, so agents read
  // the mapping without this file.
  function kaizenCauseOf(url, table) {
    const map = table || KAIZEN_CAUSES;
    const ref = refOf(url);
    return ref && Object.prototype.hasOwnProperty.call(map, ref) ? map[ref] : null;
  }

  // Each kaizen issue's problem as a plain sentence, for Act's rows. The
  // issues' own titles are internal codes ("desk skill friction,
  // human_wait"); a new issue without a row here reads from its title.
  const ISSUE_TITLES = {
    "ourostack/factory#39": "Desk's checkout guard failed long shell loops, so shell tool calls failed.",
    "ourostack/factory#50": "Desk's MCP tools caused friction in agents' work; no measure was chosen.",
    "ourostack/factory#51": "Calls to Desk's MCP tools failed too often.",
    "ourostack/factory#52": "Model requests were retried too often during Desk releases.",
    "ourostack/factory#53": "Agents stopped and waited too long for the operator's next prompt while using Desk's skills.",
    "ourostack/factory#54": "Agents retouched work they had already finished while using Desk's skills.",
  };
  // A title in the kaizen form "Kaizen: desk skill friction, human_wait"
  // reads as a sentence when no row names it.
  function issueTitle(ref, title) {
    if (ref && Object.prototype.hasOwnProperty.call(ISSUE_TITLES, ref)) return ISSUE_TITLES[ref];
    const t = typeof title === "string" ? title.replace(/^Kaizen:\s*/i, "").trim() : "";
    const m = /^([a-z0-9_-]+) ([a-z_]+) friction(?:, ([a-z_]+))?$/.exec(t);
    if (m) return `Friction in ${m[1] === "desk" ? "Desk" : m[1]}'s ${m[2].replace(/_/g, " ")}${m[3] ? `, measured by ${m[3].replace(/_/g, " ")}` : ""}.`;
    return t || null;
  }

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
        // The data file states each issue's cause (data.json
        // kaizen_issues[].cause, from this same table at build time); an
        // older build without it reads the table.
        const stated = typeof i.cause === "string" && isCauseKey(i.cause) ? i.cause : null;
        const key = stated || (ref && Object.prototype.hasOwnProperty.call(map, ref) ? map[ref] : null);
        const res = i.resolution && typeof i.resolution === "object" ? i.resolution : null;
        return {
          ref: ref || String(i.ref || "issue"),
          short: typeof i.ref === "string" ? i.ref : ref,
          url: i.url,
          title: issueTitle(ref, i.title),
          state: i.issue_state === "open" ? "open" : i.issue_state === "closed" ? "closed" : "unknown",
          countermeasure: res && typeof res.url === "string" ? { ref: refOf(res.url) || String(res.ref || "pull request"), url: res.url, merged: res.merged === true, kind: res.kind || null } : null,
          cause: key ? { key, label: W.causeWords(key), href: causeRoute(key), ranked: ranked.has(key) } : null,
          check: CHECK_WORDS,
        };
      })
      .sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || num(b.ref) - num(a.ref));
  }

  // Act's opening count: how many issues are open and closed, and that
  // none is checked yet (no countermeasure has labeled tasks on both sides).
  function actSummary(rows) {
    const list = arr(rows);
    if (!list.length) return "";
    const closed = list.filter((r) => r.state === "closed").length;
    const open = list.filter((r) => r.state === "open").length;
    const n = list.length;
    const head = closed === n ? (n === 1 ? "The one issue is closed" : n === 2 ? "Both issues are closed" : `All ${n} are closed`) : open === n ? (n === 1 ? "The one issue is open" : `All ${n} are open`) : `${open} of ${n} ${open === 1 ? "is" : "are"} open and ${closed} closed`;
    return `${plural(n, "problem")} taken on so far. ${head}; none is checked yet, because no countermeasure has labeled tasks on both sides of it.`;
  }

  // The kaizen issues already open for a cause: the A3 already taken on.
  // `rows` are actRows. Returns [{ ref, url, state, countermeasure }].
  function causeIssues(rows, key) {
    return arr(rows).filter((r) => r.cause && r.cause.key === key).map((r) => ({ ref: r.ref, url: r.url, state: r.state, countermeasure: r.countermeasure }));
  }
  // "Already taken on: factory#53, with countermeasure desk#65 (merged, not yet checked)".
  const shortRef = (ref) => String(ref).replace(/^ourostack\//, "");
  function takenOnWords(list) {
    const xs = arr(list);
    if (!xs.length) return "";
    return `Already taken on: ${xs.map((x) => `${shortRef(x.ref)}${x.countermeasure ? `, with countermeasure ${shortRef(x.countermeasure.ref)} (${x.countermeasure.merged ? "merged, not yet checked" : "not yet merged"})` : ", with no countermeasure yet"}`).join("; ")}.`;
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
    workingView,
    mostWaste,
    groupWords,
    compactRow,
    fullTableSummary,
    timeScale,
    tickWords,
    compareLede,
    feDots,
    CAUSE_KEY,
    isCauseKey,
    causeRoute,
    paretoModel,
    paretoNote,
    cumWords,
    causesLede,
    paretoCaption,
    unlabeledFinished,
    unlabeledWords,
    causeMeaning,
    causeDetail,
    whyWaitRows,
    whyChildren,
    WHY_A3,
    whyAmountWords,
    whyShareWords,
    whyToggleState,
    whyCauseLede,
    whyCauseLedeParts,
    spanItem,
    a3Prompt,
    KAIZEN_CAUSES,
    kaizenCauseOf,
    ISSUE_TITLES,
    issueTitle,
    CHECK_WORDS,
    refOf,
    actRows,
    actSummary,
    causeIssues,
    takenOnWords,
    shareBars,
    shortPct,
    alarmKeyWords,
    alarmRows,
    taskCauses,
    overTime,
    overTimeCell: cellOf,
    weekBars,
    causeTable,
    weekAxis,
    eachTaskBars,
    feLayout,
    ratioBound,
    shareOf,
    sortPicker,
  };
});
