// The Loom: the primary session reader. Each session is a strip of cloth woven
// from its published, validated record. Nothing here infers purpose, causes,
// recommendations or check results; it reads what the build published.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./session-data.js"), require("./learning.js"));
  } else {
    root.FactoryLoom = factory(root.FactorySessionData, root.FactoryLearning);
    if (typeof document !== "undefined" && document.getElementById("loom")) root.FactoryLoom.boot(root);
  }
})(typeof self !== "undefined" ? self : this, function (SessionData, Learning) {
  "use strict";
  const SVG = "http://www.w3.org/2000/svg";
  const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const JOB = /^[0-9a-f]{32}$/, REC = /^[0-9a-f]{16}$/;
  const HOUR = 3600000, MINUTE = 60000;
  const PAGE = 24, SCAN = 12;
  const LANES = [
    { key: "commands", cls: "cmd", label: "Running commands" },
    { key: "reading", cls: "read", label: "Reading and searching" },
    { key: "writing", cls: "write", label: "Writing changes" },
    { key: "helpers", cls: "help", label: "Helpers at work" },
    { key: "notes", cls: "house", label: "Keeping notes" },
    { key: "other", cls: "other", label: "Other tools" },
    { key: "stops", cls: "stop", label: "Main-agent stops" },
  ];
  const CAPTURED = { key: "captured", cls: "captured", label: "Any captured interval" };
  const HOSTS = { "claude-code": "Claude Code", "copilot-cli": "Copilot CLI", "codex-cli": "Codex CLI" };
  const STATES = {
    accepted: "accepted", refused: "a hand-over was turned down", delivered_unsigned: "handed over, not yet signed off",
    reopened: "reopened", not_delivered: "not handed over yet",
  };
  const CAUGHT = { in_task: "caught during the work", at_review: "caught at review", after_delivery: "caught after hand-over" };
  const CAUGHT_SHORT = { in_task: "during", at_review: "review", after_delivery: "after" };
  const KINDS = { work: "Work", waiting: "Waiting for a prerequisite", result: "Result" };
  const UNWRITTEN = {
    not_published: "No reviewed story has been published for this task yet.",
    source_changed: "A review exists, but the session record changed after it was reviewed, so the story is held back until it is reviewed again.",
    invalid_context: "A review was found but it failed its checks, so none of it is shown.",
    canonical_source_unavailable: "The reviewed-story source couldn’t be read when this was built.",
    review_pending: "A review is pending, so the story is held back for now.",
  };
  const REASONS = {
    no_intervals: "no intervals were recorded", host_records_partly: "the host records this only partly",
    interval_outside_session_clock: "some intervals fell outside the session clock", log_truncated: "the log was cut short",
    source_unreadable: "the source couldn’t be read", field_absent: "the field is absent", withheld_public: "withheld from the public record",
    desk_public: "withheld from the public record", session_open: "the session was still open", not_recorded: "not recorded",
    returns_truncated: "the history was cut short", returns_unreadable: "some entries couldn’t be read",
  };
  const MEASURES = {
    lead_time: "lead time", queue_before_start: "time before work started", active_time: "active time", flow_efficiency: "flow efficiency",
    human_wait: "main-agent stops awaiting a prompt", permission_wait: "permission stops", api_retry_wait: "API retry stops",
    tool_failures: "tool failures", tool_retries: "tool retries", api_retries: "API retries", compactions: "memory refreshes",
    retouches: "returns for another pass", muda_time: "labelled loss time", search_waste: "search loss",
  };
  const RESULTS = {
    better: "Helped", worse: "Got worse", no_detected_change: "No clear change", inconclusive: "Inconclusive",
    awaiting_result: "Not checked yet", refused: "Check refused", unavailable: "Check unavailable",
  };
  const MERGED = { merged: "Shipped (merged)", not_merged: "Change not merged", unknown: "Change state unknown" };
  const EXCLUDED = {
    open_job: "still open", plugin_not_reported: "plugin version not reported", mixed_versions: "mixed versions", partial: "partly recorded",
    censored: "cut off by the window", not_labeled: "not labelled", cancelled: "cancelled", no_sessions: "no sessions",
  };
  const LIMITS = {
    baseline_missing: "No baseline sample before the change, so there is nothing to compare against.",
    later_sample_missing: "No sample after the change yet.",
    too_few_independent_groups: "Too few independent groups to estimate an effect.",
    association_not_causation: "An association is not proof that the change caused it.",
    task_mix_not_controlled: "The mix of tasks wasn’t controlled.",
    capture_changes_not_controlled: "Changes in what was captured weren’t controlled.",
    shared_workers_not_independent: "Shared workers make the before and after samples less independent.",
    related_measure_not_original_evidence: "This is a related measure, not the original evidence that raised the problem.",
    no_effect_estimate: "No effect estimate is established.",
  };
  const COUNT_MEASURES = new Set(["tool_failures", "tool_retries", "api_retries", "compactions", "retouches"]);
  const kindOf = (measure) => measure === "flow_efficiency" ? "share" : COUNT_MEASURES.has(measure) ? "count" : "time";
  function amount(v, kind, signed) {
    const sign = signed && v < 0 ? "−" : signed && v > 0 ? "+" : "";
    const a = Math.abs(v);
    if (v === 0) return "0";
    const text = kind === "share" ? `${Math.round(a * 1000) / 10}${signed ? " percentage points" : "%"}`
      : kind === "count" ? count(Math.round(a * 100) / 100) : span(a);
    return sign + text;
  }
  // A comparison figure keeps its state and bound; it is never shown more exactly than recorded.
  function figureText(f, kind, signed) {
    if (!f || f.state === "unavailable") return `not recorded${f && f.reasons.length ? ` (${reasonText(f.reasons)})` : ""}`;
    const text = amount(f.value, kind, signed);
    if (f.state === "measured") return text;
    return f.bound === "lower" ? `at least ${text}` : f.bound === "upper" ? `at most ${text}` : `${text}, partly recorded`;
  }

  // ---------- small, strict DOM helpers: text only enters as text nodes ----------
  function kit(doc) {
    const add = (node, kids) => {
      for (const k of kids.flat(Infinity)) {
        if (k === null || k === undefined || k === false) continue;
        node.append(typeof k === "string" || typeof k === "number" ? doc.createTextNode(String(k)) : k);
      }
      return node;
    };
    const set = (node, attrs) => {
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : String(v));
      }
      return node;
    };
    return {
      el: (tag, attrs, ...kids) => add(set(doc.createElement(tag), attrs), kids),
      svg: (tag, attrs, ...kids) => add(set(doc.createElementNS(SVG, tag), attrs), kids),
      put: (node, ...kids) => { node.replaceChildren(); return add(node, kids); },
    };
  }

  // ---------- plain formatting ----------
  const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  function span(ms) {
    if (ms < 1000) return "under a second";
    if (ms < MINUTE) return plural(Math.round(ms / 1000), "second");
    if (ms < HOUR) return plural(Math.round(ms / MINUTE), "minute");
    if (ms < 48 * HOUR) {
      const h = Math.floor(ms / HOUR), m = Math.round((ms - h * HOUR) / MINUTE);
      return m === 60 ? plural(h + 1, "hour") : m ? `${plural(h, "hour")} ${plural(m, "minute")}` : plural(h, "hour");
    }
    const hours = Math.round(ms / HOUR), d = Math.floor(hours / 24), r = hours - d * 24;
    return r ? `${plural(d, "day")} ${plural(r, "hour")}` : plural(d, "day");
  }
  function short(ms) {
    if (ms < MINUTE) return `${Math.round(ms / 1000)} s`;
    if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
    const h = Math.floor(ms / HOUR), m = Math.round((ms - h * HOUR) / MINUTE);
    return m === 60 ? `${h + 1} h` : m ? `${h} h ${m} min` : `${h} h`;
  }
  function elapsed(ms) {
    if (ms % HOUR === 0) return `${ms / HOUR} h`;
    if (ms < HOUR) return ms < MINUTE ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / MINUTE)} min`;
    const h = Math.floor(ms / HOUR), rest = ms - h * HOUR;
    return rest < MINUTE ? `${h} h ${Math.round(rest / 1000)} s` : `${h} h ${Math.round(rest / MINUTE)} min`;
  }
  const reasonText = (codes) => (codes || []).map((c) => REASONS[c] || c.replace(/_/g, " ")).join("; ");
  // A stated figure, honestly: a partial figure keeps its bound, an absent one is never zero.
  function stated(env, fmt) {
    if (!env || env.state === "unavailable") return "not recorded";
    const text = fmt(env.value);
    if (env.state === "measured") return text;
    return env.bound === "lower" ? `at least ${text}` : env.bound === "upper" ? `at most ${text}` : `about ${text}, partly recorded`;
  }
  const count = (n) => n.toLocaleString("en-US");
  // The one cell text both the readout and the table use.
  function cell(env, width) {
    if (!env || env.state === "unavailable") return "not recorded";
    if (env.value === 0 && env.state === "measured") return "none";
    const share = width > 0 ? (env.value / width) * 100 : null;
    const pct = share === null ? "–" : share > 0 && share < 0.5 ? "under 1%" : `${Math.round(share)}%`;
    return stated(env, (v) => `${short(v)} · ${pct}`);
  }
  const shortId = (id) => id.slice(0, 8);
  const host = (h) => HOSTS[h] || h;

  // ---------- routes ----------
  function parseQuery(q) {
    const out = {};
    for (const part of (q || "").split("&")) {
      if (!part) continue;
      const at = part.indexOf("=");
      const k = at < 0 ? part : part.slice(0, at), v = at < 0 ? "" : part.slice(at + 1);
      if (!(k in out)) out[k] = v;
    }
    return out;
  }
  function parseRoute(hash) {
    const h = typeof hash === "string" ? hash : "";
    if (h === "" || h === "#" || h === "#/" || h === "#/sessions") return { view: "shelf" };
    if (h === "#main") return { view: "skip" };
    let m = /^#\/session\/([^?/]+)$/.exec(h);
    if (m && SESSION.test(m[1])) return { view: "session", id: m[1] };
    m = /^#\/sessions\?(.*)$/.exec(h);
    if (m) {
      const q = parseQuery(m[1]);
      return JOB.test(q.task || "") ? { view: "task", job: q.task } : { view: "badtask" };
    }
    m = /^#\/mend(?:\?(.*))?$/.exec(h);
    if (m) {
      const q = parseQuery(m[1]);
      return { view: "mend", session: SESSION.test(q.session || "") ? q.session : null, focus: REC.test(q.focus || "") ? q.focus : null };
    }
    if (h === "#/about") return { view: "about" };
    return null;
  }
  // Every other fragment belongs to the detailed evidence reader, unchanged.
  function legacyTarget(hash, search) {
    return parseRoute(hash) ? null : `evidence.html${search || ""}${hash || ""}`;
  }

  // ---------- reading the validated detail ----------
  const published = (ctx) => ctx && ctx.availability === "published" && ctx.record;
  const cites = (event, id) => event.evidence.some((ref) => ref.session === id);
  // A session-local evidence point: the exact ref for this session, never the task clock.
  function pinPoint(event, id, duration) {
    const ref = event.evidence.find((r) => r.session === id);
    if (!ref || duration === null) return null;
    const at = ref.anchor === "start" ? 0 : ref.anchor === "end" ? duration :
      ["interval_end", "share_end"].includes(ref.anchor) ? ref.range[1] : ref.range[0];
    return at >= 0 && at <= duration ? at : null;
  }
  function citedSessions(record, eventIds) {
    const out = new Set();
    for (const e of record.events) if (eventIds.includes(e.id)) for (const r of e.evidence) out.add(r.session);
    return out;
  }
  function proposalsOf(ctx) {
    if (!published(ctx) || !Array.isArray(ctx.record.recommendations)) return [];
    return ctx.record.recommendations.map((rec) => ({
      rec, job: ctx.job, record: ctx.record, sessions: citedSessions(ctx.record, rec.observations),
      observed: ctx.record.events.filter((e) => rec.observations.includes(e.id)),
    }));
  }
  const durationOf = (d) => d.numbers.duration_ms.state === "unavailable" ? null : d.numbers.duration_ms.value;
  function uncaptured(d) {
    const rows = d.bins.rows;
    if (!rows.length || rows.some((r) => r.captured.state !== "measured")) return null;
    return rows.reduce((n, r) => n + (r.end_ms - r.start_ms - r.captured.value), 0);
  }

  // ---------- the reader ----------
  function mountLoom(options) {
    const { root, readDetail } = options;
    const doc = options.document || (typeof document !== "undefined" ? document : null);
    const win = options.window || (typeof window !== "undefined" ? window : null);
    const { el, svg, put } = kit(doc);
    const reduced = () => !!(win && win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const state = { namesSource: { kind: "loading" }, catalog: null, catalogError: null, rows: new Map(), names: new Map(), learning: { kind: "loading" },
      details: new Map(), loaded: new Map(), shown: PAGE, seq: 0 };

    // chrome
    const main = el("main", { id: "main", tabindex: "-1", class: "loom-main" });
    const nav = [["#/", "Sessions"], ["#/mend", "What to mend"], ["#/about", "How to read this"]].map(([href, text]) => el("a", { href }, text));
    const asof = el("p", { class: "asof" });
    const theme = el("button", { type: "button", class: "theme" });
    const skip = el("a", { class: "skip", href: "#main", onclick: (e) => { e.preventDefault(); main.focus(); } }, "Skip to the reader");
    const mark = svg("svg", { viewBox: "0 0 40 40", "aria-hidden": "true", focusable: "false" },
      svg("path", { d: "M6 10h28M6 17h28M6 24h28M6 31h28", class: "warp" }), svg("path", { d: "M10 6v28M17 6v28M24 6v28M31 6v28", class: "weft" }));
    root.replaceChildren(skip,
      el("header", { class: "mast" },
        el("a", { class: "mark", href: "#/" }, mark, el("span", {}, "Factory"), el("span", { class: "mark-sub" }, "the loom")),
        el("nav", { "aria-label": "Sections" }, nav, el("a", { href: "evidence.html", class: "nav-out" }, "Detailed evidence")),
        asof, theme),
      main,
      el("footer", { class: "foot" }, el("p", {},
        "Threads, numbers and loops come from the published session records. Explanations appear only when a reviewed, privacy-checked story was published. ",
        el("a", { href: "evidence.html" }, "The detailed evidence reader"), " keeps every earlier view.")));
    function setTheme(t) {
      doc.documentElement.setAttribute("data-theme", t);
      theme.textContent = t === "night" ? "Daylight" : "Lamplight";
      theme.setAttribute("aria-label", t === "night" ? "Switch to the light theme" : "Switch to the dark theme");
      try { win.localStorage.setItem("loom-theme", t); } catch { /* no storage: the choice lasts this visit */ }
    }
    let saved = null;
    try { saved = win.localStorage.getItem("loom-theme"); } catch { saved = null; }
    setTheme(saved === "day" || saved === "night" ? saved : win && win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day");
    theme.addEventListener("click", () => setTheme(doc.documentElement.getAttribute("data-theme") === "night" ? "day" : "night"));
    main.replaceChildren(el("p", { class: "status-line", role: "status" }, "Loading the session catalog…"));

    const settle = (value) => Promise.resolve(typeof value === "function" ? value() : value).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
    const message = (e) => (e && typeof e.message === "string" ? e.message : String(e));
    const ready = Promise.all([settle(options.catalog), settle(options.learning), settle(options.tasks)]).then(([c, l, t]) => {
      if (!c.ok) state.catalogError = { kind: "error", text: message(c.e) };
      else if (!SessionData || !SessionData.validateSessionCatalog(c.v).ok) state.catalogError = { kind: "invalid" };
      else {
        state.catalog = c.v;
        for (const row of c.v.sessions) state.rows.set(row.id, row);
        const s = c.v.sources;
        asof.replaceChildren(el("span", { title: "The source revisions this build read. Not proof of a release." },
          "Built from facts ", el("code", {}, s.facts === "unavailable" ? "unavailable" : s.facts.slice(0, 7))));
      }
      if (!l.ok) state.learning = { kind: "error", text: message(l.e) };
      else if (l.v === null || l.v === undefined) state.learning = { kind: "none" };
      else if (!Learning || !Learning.validateLearning(l.v).ok) state.learning = { kind: "invalid" };
      else state.learning = { kind: "ok", doc: l.v };
      // A missing names file, a failed read and a malformed file are three different states.
      if (!t.ok) state.namesSource = { kind: "error", text: message(t.e) };
      else if (t.v === null || t.v === undefined) state.namesSource = { kind: "none" };
      else if (typeof t.v !== "object" || !Array.isArray(t.v.jobs)) state.namesSource = { kind: "invalid" };
      else {
        state.namesSource = { kind: "ok" };
        for (const r of t.v.jobs) {
          if (r && JOB.test(r.job) && typeof r.name === "string" && r.name.trim() && r.name.length <= 300) state.names.set(r.job, r.name.trim());
        }
      }
    }).then(() => go(win ? win.location.hash : "#/"));
    if (win && win.addEventListener) win.addEventListener("hashchange", () => go(win.location.hash));

    function detail(id) {
      if (!state.details.has(id)) {
        state.details.set(id, Promise.resolve().then(() => readDetail(id)).then((d) => {
          if (!SessionData.validateSessionDetail(d).ok || d.session.id !== id) return { ok: false, kind: "invalid" };
          state.loaded.set(id, d);
          return { ok: true, d };
        }, (e) => {
          state.details.delete(id);
          return { ok: false, kind: "error", text: message(e) };
        }));
      }
      return state.details.get(id);
    }
    // Open sessions first, then the longest; unknown lengths last.
    const order = (rows) => [...rows].sort((a, b) => (a.ended - b.ended) ||
      ((b.duration_ms.state === "unavailable" ? -1 : b.duration_ms.value) - (a.duration_ms.state === "unavailable" ? -1 : a.duration_ms.value)) ||
      a.id.localeCompare(b.id));
    const taskName = (job) => state.names.get(job) || null;
    const taskLabel = (job) => {
      const source = state.namesSource.kind;
      if (source === "ok") return taskName(job) || `Unnamed task ${job.slice(0, 8)}`;
      return `Task ${job.slice(0, 8)}${source === "none" ? "" : " (name not loaded)"}`;
    };
    function namesNotice() {
      const source = state.namesSource;
      if (source.kind === "none") return el("p", { class: "disclosure names-notice", role: "note" }, "Task names aren’t published in this build, so tasks show their short ids.");
      if (source.kind !== "error" && source.kind !== "invalid") return null;
      return el("div", { class: "problem names-notice", role: "alert" },
        el("p", {}, `Task names couldn’t be loaded (${source.kind === "invalid" ? "the names file is malformed" : source.text}), so tasks show their short ids. Sessions and their records are unaffected. `,
          el("button", { type: "button", class: "ghost", onclick: () => win.location.reload() }, "Try again")));
    }
    // Task bindings are a stated collection: only a complete, empty one means "bound to no task".
    function bindingNote(b) {
      if (b.state === "unavailable") return `Task associations weren’t recorded (${reasonText(b.reasons)}), so whether it worked on a task is unknown.`;
      if (b.state === "partial") return `Task associations are incomplete (${reasonText(b.reasons)}); ${b.items.length ? "only the readable ones are shown" : "none of them could be read"}.`;
      return null;
    }
    const unbound = (d) => d.bindings.state === "measured" && !d.bindings.items.length;
    // Outcome state and returns are the recording session's snapshot of the task; status is this build's summary.
    const revText = (o) => o.snapshot.rev === null ? "revision not recorded" : `revision ${count(o.snapshot.rev)}`;
    const stateText = (o) => `${STATES[o.state.value] || o.state.value}${o.state.state === "partial" ? " (partly recorded)" : ""}`;
    const statusText = (o) => o.status.state === "unavailable" ? "This build’s task summary doesn’t record its status."
      : `This build’s task summary lists its status as ${o.status.value.replace(/_/g, " ")}${o.status.state === "partial" ? " (partly recorded)" : ""}.`;
    // Among loaded snapshots, the highest recorded revision wins; without one, none is called the latest.
    function latestSnapshot(details, job) {
      const all = details.flatMap((d) => d.outcomes.filter((o) => o.job === job && o.state.state !== "unavailable"));
      const known = all.filter((o) => o.snapshot.rev !== null);
      if (known.length) return { o: known.reduce((a, b) => b.snapshot.rev > a.snapshot.rev ? b : a), known: true };
      return all.length ? { o: all[0], known: false } : null;
    }

    async function go(hash) {
      const route = parseRoute(hash);
      if (route && route.view === "skip") { main.focus(); return; }
      if (!route) { win.location.replace(legacyTarget(hash, win.location.search)); return; }
      const token = ++state.seq;
      let page, focus = null;
      if (["task", "session"].includes(route.view) && !state.catalogError) {
        put(main, el("p", { class: "status-line", role: "status" }, route.view === "session" ? "Loading this session’s record…" : "Loading this task’s session records…"));
      }
      if (state.catalogError && route.view !== "about") page = catalogProblem();
      else if (route.view === "shelf") page = shelf(state.catalog.sessions, null);
      else if (route.view === "badtask") page = problem("That isn’t a task id.", "Task links use the task’s 32-character public id.", "#/", "All sessions");
      else if (route.view === "task") page = await taskShelf(route.job);
      else if (route.view === "session") page = await sessionPage(route.id);
      else if (route.view === "mend") [page, focus] = await mend(route);
      else page = about();
      if (token !== state.seq) return;
      const notice = route.view === "about" || state.catalogError ? null : namesNotice();
      put(main, notice, page);
      const current = route.view === "mend" ? "#/mend" : route.view === "about" ? "#/about" : "#/";
      for (const a of nav) {
        if (a.getAttribute("href") === current) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
      if (win && typeof win.scrollTo === "function" && !focus) win.scrollTo(0, 0);
      const target = focus || first(page, "H1");
      if (target) {
        target.setAttribute("tabindex", "-1");
        if (focus && typeof focus.scrollIntoView === "function") focus.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
        target.focus({ preventScroll: !focus });
      }
    }
    function first(node, tag) {
      if (node.tagName === tag) return node;
      for (const k of node.children || []) { const f = first(k, tag); if (f) return f; }
      return null;
    }
    function problem(title, text, href, back) {
      return el("div", { class: "page" }, el("h1", { class: "display" }, title),
        el("div", { class: "problem", role: "alert" }, el("p", {}, text)), href ? el("p", {}, el("a", { href, class: "back" }, back)) : null);
    }
    function catalogProblem() {
      const err = state.catalogError;
      return problem("The loom couldn’t be strung.", err.kind === "invalid"
        ? "The session catalog didn’t pass its checks, so nothing is shown from it."
        : `Couldn’t load the session catalog: ${err.text}`, "evidence.html", "Open the detailed evidence reader instead");
    }

    // ---------- shared pieces ----------
    const LAYER = {
      recorded: ["Recorded", "Measured from the published session record."],
      reviewed: ["Reviewed story", "A reviewed, privacy-checked explanation. Never generated from counts."],
      idea: ["Proposal", "A reviewed suggestion. Not a finding and not proof of a cause."],
      checked: ["Checked", "The result of a canonical check after a change."],
      task: ["Task-wide", "Belongs to the whole task, not only this session."],
    };
    const tag = (k) => el("span", { class: `layer-tag l-${k}`, title: LAYER[k][1] }, LAYER[k][0]);
    const head = (id, title, ...text) => el("div", { class: "sec-head" }, el("h2", { id }, title), el("p", {}, ...text));
    function legend() {
      return el("ul", { class: "legend", "aria-label": "Key" },
        LANES.map((l) => el("li", {}, el("span", { class: `chip t-${l.cls}` }), l.label)),
        el("li", {}, el("span", { class: "chip hatch" }), "No captured interval"));
    }
    const glyph = (name) => {
      const paths = {
        loop: ["M4 22 C10 22 10 8 16 8 C22 8 22 20 16 20 C10 20 12 10 28 10"],
        wave: ["M3 14 q4 -8 8 0 t8 0 t8 0", "M3 22 q4 -8 8 0 t8 0 t8 0"],
        snag: ["M3 16 H12 L15 9 L18 23 L21 16 H29"],
        pause: ["M11 8 V24", "M21 8 V24"],
        knot: ["M6 16 C6 6 26 6 26 16 C26 26 6 26 6 16", "M16 4 V28"],
      }[name];
      return svg("svg", { viewBox: "0 0 32 32", class: "glyph", "aria-hidden": "true", focusable: "false" },
        paths.map((d) => svg("path", { d, fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" })));
    };
    function sentence(row) {
      const dur = row.duration_ms, act = row.activity_ms;
      return `${stated(dur, span)} captured${row.ended ? "" : " so far"} · recorded activity ${stated(act, span)}`;
    }
    // A catalog bolt: length from duration, thread density from the activity share. It never claims where in time.
    function bolt(row, longest) {
      const dur = row.duration_ms.state === "unavailable" ? null : row.duration_ms.value;
      const share = dur && row.activity_ms.state !== "unavailable" ? Math.min(1, row.activity_ms.value / dur) : null;
      const width = dur && longest ? 22 + 78 * Math.sqrt(dur / longest) : 22;
      const label = share === null ? "Recorded activity share not available." :
        `Recorded activity covers about ${Math.round(share * 100)}% of its captured time${row.activity_ms.state === "partial" ? " (partly recorded)" : ""}. Where in the session isn’t shown here.`;
      return el("span", { class: "bolt-strip", style: `--w:${width.toFixed(1)}%` },
        svg("svg", { viewBox: "0 0 100 8", preserveAspectRatio: "none", class: "swatch", role: "img", "aria-label": label },
          svg("rect", { width: "100", height: "8", fill: "url(#loom-hatch)" }),
          share === null ? null : svg("rect", { width: "100", height: "8", fill: "url(#loom-weft)", class: "bolt-fill", "fill-opacity": (0.15 + 0.85 * share).toFixed(2) })));
    }
    // A woven swatch from a loaded detail: one hairline row per lane, no dominant-lane colouring.
    function swatch(d) {
      // Units are resolution periods of elapsed time; a short final period stays short.
      const rows = d.bins.rows, res = rows.length ? d.bins.resolution_ms.value : 1;
      const n = rows.length ? durationOf(d) / res : 1;
      const box = svg("svg", { viewBox: `0 0 ${n} ${LANES.length}`, preserveAspectRatio: "none", class: "swatch", role: "img",
        "aria-label": `Woven from ${rows.length} period${rows.length === 1 ? "" : "s"} of its record; one thread per kind of activity.` },
      svg("rect", { width: String(n), height: String(LANES.length), fill: "url(#loom-hatch)" }));
      rows.forEach((r) => LANES.forEach((l, i) => {
        const v = r[l.key], w = r.end_ms - r.start_ms;
        if (v.state === "unavailable" || !v.value || !w) return;
        // Full periods overlap by a hair to avoid seams; a shorter period is drawn at its own width.
        box.append(svg("rect", { x: String(r.start_ms / res), y: String(i + 0.12), width: String(w / res + (w === res ? 0.02 : 0)), height: "0.76", class: `t-${l.cls}`,
          "fill-opacity": (0.25 + 0.75 * Math.min(1, v.value / w)).toFixed(2) }));
      }));
      return el("span", { class: "bolt-strip woven", style: "--w:100%" }, box);
    }
    function associations(row) {
      if (!row.jobs.length) return el("span", { class: "assoc none" }, "No task association listed");
      return row.jobs.map((job, i) => [i ? el("span", { class: "sep" }, " · ") : null,
        el("span", { class: "assoc" }, taskLabel(job))]);
    }
    function shelfItem(row, i, longest, woven) {
      return el("li", { class: `bolt${row.ended ? "" : " is-open"}`, style: `--i:${Math.min(i, 24)}` },
        el("a", { href: `#/session/${row.id}`, class: "bolt-link" },
          el("span", { class: "bolt-name" }, el("code", {}, shortId(row.id)), " ", host(row.host),
            row.ended ? null : el("span", { class: "pill open" }, "still open"),
            row.jobs.length > 1 ? el("span", { class: "shared" }, `${row.jobs.length} tasks`) : null),
          el("span", { class: "bolt-tasks" }, el("span", { class: "visually-hidden" }, "Task associations: "), associations(row)),
          woven || bolt(row, longest),
          el("span", { class: "bolt-caption" }, sentence(row))));
    }
    function longestOf(rows) {
      return Math.max(0, ...rows.map((r) => r.duration_ms.state === "unavailable" ? 0 : r.duration_ms.value));
    }
    function taskIndex(rows) {
      const counts = new Map();
      for (const r of rows) for (const j of r.jobs) counts.set(j, (counts.get(j) || 0) + 1);
      if (!counts.size) return null;
      const list = [...counts].sort((a, b) => b[1] - a[1] || (taskName(a[0]) ? -1 : 0) - (taskName(b[0]) ? -1 : 0) || a[0].localeCompare(b[0]));
      const item = ([job, n]) => el("li", {}, el("a", { href: `#/sessions?task=${job}` }, taskLabel(job)), el("span", { class: "muted" }, ` · ${plural(n, "session")}`));
      return el("section", { class: "task-index", "aria-labelledby": "ti-h" },
        head("ti-h", "Tasks on the loom", "Names come from each task’s public pull request. A name is an association, not proof of what a whole session was for."),
        el("ul", { class: "task-list" }, list.slice(0, 8).map(item)),
        list.length > 8 ? el("details", { class: "how" }, el("summary", {}, `All ${count(list.length)} tasks`), el("ul", { class: "task-list" }, list.slice(8).map(item))) : null);
    }
    function shelf(rows) {
      const sorted = order(rows), longest = longestOf(sorted);
      const unlisted = sorted.filter((r) => !r.jobs.length).length;
      const list = el("ol", { class: "shelf", "aria-label": "Sessions: open ones first, then the longest" });
      const more = el("button", { type: "button", class: "ghost" });
      const fill = () => {
        list.replaceChildren(...sorted.slice(0, state.shown).map((r, i) => shelfItem(r, i, longest)));
        const left = sorted.length - state.shown;
        if (left > 0) { more.removeAttribute("hidden"); more.textContent = `Show ${Math.min(PAGE, left)} more of ${count(left)}`; }
        else more.setAttribute("hidden", "");
      };
      more.addEventListener("click", () => { state.shown += PAGE; fill(); });
      fill();
      // Sessions first: a short hero, the key the strips need, then the shelf itself.
      // Orientation and the task directory follow the first strips instead of preceding them.
      return el("div", { class: "page page-shelf" },
        el("p", { class: "eyebrow" }, `The loom · ${plural(sorted.length, "session")} in this build`, " ", tag("recorded")),
        el("h1", { class: "display compact" }, "Every session, ", el("em", {}, "woven from what the record saw.")),
        el("p", { class: "lede" }, "Each strip is one agent session. Its length follows how long the session ran; the density of its thread follows how much of that time has recorded activity."),
        el("section", { class: "shelf-sec", "aria-labelledby": "sh-h" },
          el("div", { class: "shelf-bar" }, el("h2", { id: "sh-h" }, "The shelf"),
            el("ul", { class: "legend compact", "aria-label": "Key" },
              el("li", {}, el("span", { class: "chip weft" }), "Recorded activity"),
              el("li", {}, el("span", { class: "chip hatch" }), "No captured interval"))),
          list, more),
        el("aside", { class: "aside-note" },
          el("p", {}, "Bare, cross-hatched canvas means no captured interval. That doesn’t show nothing happened, and it is never counted as a loss. Open a session to see its weave hour by hour, what was reviewed about it, and what could change."),
          el("p", {}, unlisted ? `${plural(unlisted, "session")} list${unlisted === 1 ? "s" : ""} no task association; they stay on the shelf. An empty list can also mean associations weren’t recorded; each session’s page says which.` : "Every session here carries at least one task association.")),
        taskIndex(sorted));
    }
    async function taskShelf(job) {
      const rows = order(state.catalog.sessions.filter((r) => r.jobs.includes(job)));
      const name = taskName(job);
      if (!rows.length) return problem(name || "No sessions for that task.", "No session in this build’s catalog is bound to that task.", "#/", "All sessions");
      const picked = rows.slice(0, SCAN);
      const results = await Promise.all(picked.map((r) => detail(r.id)));
      const woven = new Map();
      results.forEach((res, i) => { if (res.ok) woven.set(picked[i].id, res.d); });
      const failed = results.filter((r) => !r.ok).length;
      const any = [...woven.values()][0];
      const ctx = any && any.contexts.find((c) => c.job === job);
      const latest = latestSnapshot([...woven.values()], job);
      const by = (o) => el("a", { href: `#/session/${o.snapshot.session}` }, `session ${shortId(o.snapshot.session)}`);
      const longest = longestOf(rows);
      return el("div", { class: "page page-task" },
        el("a", { href: "#/", class: "back" }, "← All sessions"),
        el("p", { class: "eyebrow" }, "Task association · ", el("code", {}, job.slice(0, 8)), " ", tag("recorded")),
        el("h1", { class: "display" }, taskLabel(job)),
        published(ctx) && ctx.record.heading !== name ? el("p", { class: "lede" }, "Reviewed heading: ", el("strong", {}, ctx.record.heading), " ", tag("reviewed")) : null,
        el("p", { class: "lede" }, `${plural(rows.length, "session")} carry this task. Some may have run side by side, so their lengths don’t add up to the task’s length. A session bound to several tasks shows whole-session figures, not only this task’s share.`),
        latest ? el("p", { class: "lede small" }, latest.known
          ? [`Latest snapshot among the ${woven.size} of ${rows.length} session records loaded here: ${revText(latest.o)}, recorded by `, by(latest.o),
            ` — the task was ${stateText(latest.o)}. Sessions not loaded may hold a newer one. `]
          : [`No loaded snapshot records its revision. Shown from `, by(latest.o), `, not necessarily the latest: the task was ${stateText(latest.o)}. `],
        statusText(latest.o), " ", tag("task")) : null,
        el("p", { class: "disclosure", role: "note" }, `Woven from ${woven.size} of ${rows.length} session records on this task (open sessions first, then the longest)`,
          failed ? `; ${plural(failed, "record")} couldn’t be read` : "", rows.length > SCAN ? ". Open any other session for its weave." : "."),
        legend(),
        el("ol", { class: "shelf" }, rows.map((r, i) => shelfItem(r, i, longest, woven.has(r.id) ? swatch(woven.get(r.id)) : null))));
    }

    // ---------- one session ----------
    async function sessionPage(id) {
      const row = state.rows.get(id);
      if (!row) return problem("This session isn’t in this build’s session catalog.", "It may be newer or older than this build, or not published.", `evidence.html#/session/${id}`, "Look for it in the detailed evidence reader");
      const res = await detail(id);
      if (!res.ok) {
        return problem("This session couldn’t be shown.", res.kind === "invalid" ? "Its record didn’t pass its checks, so nothing is shown from it."
          : `Couldn’t load this session: ${res.text}`, `evidence.html#/session/${id}`, "Open it in the detailed evidence reader");
      }
      const d = res.d, dur = durationOf(d), open = !d.session.ended;
      const reviewed = d.contexts.filter((c) => published(c) && c.record.events.some((e) => cites(e, id)));
      const episodes = [];
      for (const c of reviewed) for (const e of c.record.events) if (cites(e, id)) episodes.push({ event: e, job: c.job,
        at: c.record.coverage.reasons.includes("unplaced") ? null : pinPoint(e, id, dur) });
      episodes.sort((a, b) => (a.at === null) - (b.at === null) || (a.at || 0) - (b.at || 0));
      const proposals = d.contexts.flatMap(proposalsOf).map((p) => ({ ...p, scope: p.sessions.has(id) ? "session" : "task" }));
      const loom = weave(d, episodes);
      const h1 = reviewed.length
        ? el("h1", { class: "display" }, reviewed[0].record.heading)
        : el("h1", { class: "display" }, dur === null ? "A session of unrecorded length. " : `${span(dur)} on the loom${open ? " so far" : ""}. `,
          el("em", {}, "What it was for hasn’t been reviewed yet."));
      const otherTasks = d.bindings.items.map((b) => b.job);
      return el("div", { class: "page page-session" },
        el("nav", { class: "crumbs", "aria-label": "Back" }, el("a", { href: "#/", class: "back" }, "← All sessions"),
          otherTasks.map((job) => el("a", { href: `#/sessions?task=${job}`, class: "back" }, `Sessions on ${taskLabel(job)}`))),
        el("p", { class: "eyebrow" }, "Session ", el("code", { title: id }, shortId(id)), ` · ${host(d.session.host)} · `,
          d.session.models.length ? d.session.models.join(", ") : "model not recorded", ` · ${open ? "still open when this was built" : "ended"}`),
        h1,
        reviewed.length ? el("p", { class: "h1-note" }, tag("reviewed"), " ", tag("task"),
          ` The reviewed heading of the task this session worked on${reviewed.length > 1 ? `; it also has reviewed steps on ${plural(reviewed.length - 1, "other task")}` : ""}.`) : null,
        ledger(d),
        inShort(d, id, reviewed, proposals),
        tasksWorked(d),
        story(d, id, episodes, loom),
        el("section", { class: "weave-sec", "aria-labelledby": "wv-h" },
          head("wv-h", "What it did, hour by hour", "Each thread is one kind of recorded activity; a thicker thread means more of that period was covered. Threads overlap, so a column is not split between them. Hover, tap, or focus the weave and use the arrow keys. ", tag("recorded")),
          loom.node, loom.readout, loom.table),
        returns(d),
        edges(d, proposals),
        sourcesOf(d, id));
    }
    function ledger(d) {
      const n = d.numbers, dur = durationOf(d), gap = uncaptured(d);
      return el("p", { class: "lede ledger" },
        `In the ${stated(n.duration_ms, span)} captured${d.session.ended ? "" : " so far"}, the record holds `,
        el("mark", { class: "u-work" }, `activity covering ${stated(n.activity_ms, span)}`), " (turns, tools and helper calls together) and ",
        el("mark", { class: "u-stop" }, `main-agent stops covering ${stated(n.stop_ms, span)}`),
        " (each from a stop to the next recorded prompt). These can overlap, so they aren’t slices of one whole. ",
        gap === null ? "How much time has no captured interval can’t be stated exactly from this record. "
          : gap > 0 ? [el("mark", { class: "u-none" }, `${span(gap)} has no captured interval`),
            dur ? ` (${Math.round((gap / dur) * 100)}%)` : "", ". That doesn’t show the agent was inactive: helpers keep their own records, and some work isn’t captured. "]
            : "Every period has some captured interval. ",
        tag("recorded"));
    }
    function cellBox(k, title, body, layer) {
      return el("div", { class: `sb-cell sb-${k}` }, el("p", { class: "sb-k" }, title), body, el("p", { class: "sb-tag" }, layer));
    }
    function pills() {
      return el("span", { class: "status" }, el("span", { class: "pill ch-proposed", "data-pill": "change" }, "Proposed"),
        el("span", { class: "pill ck-not-checked", "data-pill": "check" }, "Not checked"));
    }
    const mendHref = (sid, rec) => `#/mend?session=${sid}&focus=${rec}`;
    function inShort(d, id, reviewed, proposals) {
      const results = [];
      for (const c of reviewed) for (const e of c.record.events) if (e.kind === "result" && cites(e, id)) results.push(e);
      const mine = proposals.filter((p) => p.scope === "session"), wide = proposals.filter((p) => p.scope === "task");
      const v1 = d.contexts.some((c) => published(c) && c.record.schema === "desk.factory.context/1");
      const outcome = d.outcomes.find((o) => o.state.state !== "unavailable");
      const goal = reviewed.length
        ? cellBox("goal", "What it was for", reviewed.map((c) => el("p", { class: "sb-v" }, c.record.heading)), [tag("reviewed"), " ", tag("task")])
        : cellBox("goal", "What it was for", [el("p", { class: "sb-v sb-empty" }, "Not reviewed yet."),
          d.bindings.items.length ? el("p", { class: "muted" }, "Task associations, not proof of intent: ", d.bindings.items.map((b, i) => [i ? "; " : "", taskLabel(b.job)])) : null,
          bindingNote(d.bindings) ? el("p", { class: "muted" }, bindingNote(d.bindings)) : unbound(d) ? el("p", { class: "muted" }, "It is bound to no task in its complete record.") : null], tag("reviewed"));
      const result = results.length
        ? cellBox("result", "What came of it", results.map((e) => el("p", { class: "sb-v" }, e.explanation)), tag("reviewed"))
        : cellBox("result", "What came of it", [el("p", { class: "sb-v sb-empty" }, "This session’s own result isn’t reviewed yet."),
          outcome ? el("p", { class: "muted" }, `For the whole task, as this session recorded it (${revText(outcome)}): ${stateText(outcome)}.`) : null],
        outcome ? tag("task") : tag("recorded"));
      let next;
      const pick = mine[0] || wide[0];
      if (pick) {
        next = cellBox("next", "What to change next", [
          el("p", { class: "sb-scope" }, pick.scope === "session" ? "A proposal from this session’s reviewed evidence" : "A task-wide proposal; its evidence is in other sessions"),
          el("p", { class: "sb-v" }, pick.rec.change), pills(),
          el("p", {}, el("a", { href: mendHref(d.session.id, pick.rec.id) }, "Open the proposal →")),
          proposals.length > 1 ? el("p", { class: "muted" }, `${plural(proposals.length - 1, "more proposal")} on the mending page.`) : null], tag("idea"));
      } else {
        next = cellBox("next", "What to change next", [
          el("p", { class: "sb-v sb-empty" }, v1 ? "Its review predates recommendations." : "No reviewed recommendation yet."),
          el("p", { class: "muted" }, v1 ? "Whether ideas exist is unknown, not zero."
            : "A reviewed story and an evidence-linked recommendation still need to be published before this question has an answer.")], tag("idea"));
      }
      return el("section", { class: "summary-band", "aria-label": "In short" }, el("div", { class: "sb-grid" }, goal, result, next));
    }
    function tasksWorked(d) {
      if (unbound(d)) return null;
      const note = bindingNote(d.bindings);
      return el("section", { class: "bindings", "aria-labelledby": "bd-h" },
        head("bd-h", "Tasks it worked on", "The session’s figures above are for the whole session. A task’s share is shown only where it was recorded. ", tag("recorded")),
        note ? el("p", { class: "problem", role: "note" }, note) : null,
        el("ul", { class: "binding-list" }, d.bindings.items.map((b) => {
          const seg = b.segments;
          const total = seg.items.reduce((n, s) => n + s.end_ms - s.start_ms, 0);
          const share = seg.state === "unavailable" ? `Its share of the session wasn’t recorded (${reasonText(seg.reasons)}); the whole-session figures are not this task’s share.`
            : `Recorded share: ${seg.items.length} ${seg.items.length === 1 ? "stretch" : "stretches"} covering ${seg.state === "partial" ? "at least " : ""}${span(total)}.`;
          return el("li", {}, el("a", { href: `#/sessions?task=${b.job}` }, taskLabel(b.job)), el("span", { class: "muted" }, ` · ${share}`));
        })));
    }

    function unwritten(title, text) {
      return el("div", { class: "unwritten" },
        el("div", { class: "unwritten-page", "aria-hidden": "true" }, el("span"), el("span"), el("span"), el("span")),
        el("div", {}, el("p", { class: "unwritten-t" }, title), text ? el("p", {}, text) : null,
          el("p", { class: "muted" }, "Until a reviewed, privacy-checked story and an evidence-linked recommendation are published, this page can only show what was recorded. The weave below is real; the story is not written yet.")));
    }
    function story(d, id, episodes, loom) {
      const sec = el("section", { class: "story", "aria-labelledby": "st-h" },
        head("st-h", "Why it did it", "Reviewed steps are pinned where their evidence sits. A pin is not a duration, and the gap between pins is not time spent. ", tag("reviewed")));
      if (unbound(d)) {
        sec.append(unwritten("This session isn’t bound to any task, so there’s no reviewed story to attach to it.", null));
        return sec;
      }
      if (!d.bindings.items.length) {
        sec.append(unwritten("No reviewed story can be attached while its task associations are unknown.", bindingNote(d.bindings)));
        return sec;
      }
      if (episodes.length) {
        const buttons = [];
        const list = el("ol", { class: "chapter-list" }, episodes.map((ep, i) => {
          const e = ep.event;
          const button = el("button", { type: "button", class: "chapter-btn", "aria-pressed": "false" },
            el("span", { class: "ch-n" }, String(i + 1).padStart(2, "0")),
            el("span", { class: `kind kind-${e.kind}` }, KINDS[e.kind]),
            el("span", { class: "ch-when" }, ep.at === null ? "not placed in time" : `evidence near ${elapsed(ep.at)}`),
            el("span", { class: "ch-title" }, e.explanation));
          buttons.push(button);
          button.addEventListener("click", () => {
            for (const b of buttons) b.setAttribute("aria-pressed", b === button ? "true" : "false");
            loom.focusPin(e.id, ep.at);
          });
          return el("li", { class: `chapter k-${e.kind}` }, button,
            e.kind === "waiting" ? el("dl", { class: "waiting" },
              el("dt", {}, "Why it waited"), el("dd", {}, e.reason), el("dt", {}, "What it needed"), el("dd", {}, e.prerequisite),
              e.resumption ? [el("dt", {}, "Then"), el("dd", {}, e.resumption)] : null) : null,
            el("p", { class: "ch-meta" }, `${e.confidence} confidence · ${taskLabel(ep.job)}`));
        }));
        sec.append(list);
      }
      for (const ctx of d.contexts) {
        const label = taskLabel(ctx.job);
        if (published(ctx)) {
          const mine = ctx.record.events.filter((e) => cites(e, id)).length, others = ctx.record.events.length - mine;
          if (others) {
            sec.append(el("p", { class: "story-note" }, mine ? `${plural(others, "more reviewed step")} on ${label} ` : `${label} has a reviewed story, but its ${plural(others, "reviewed step")} `,
              `belong${others === 1 ? "s" : ""} to other sessions of this task. `, el("a", { href: `#/sessions?task=${ctx.job}` }, "See its sessions →")));
          }
          if (ctx.record.coverage.state !== "measured") {
            sec.append(el("p", { class: "story-note" }, `The review covers part of ${label}${ctx.record.coverage.omitted_events ? `; ${plural(ctx.record.coverage.omitted_events, "step")} omitted` : ""}.`));
          }
        } else {
          const text = ctx.availability === "withheld" && !ctx.reason ? "A review exists but is withheld from the public page." : UNWRITTEN[ctx.reason] || UNWRITTEN.not_published;
          sec.append(unwritten(`The story for ${label} isn’t written here.`, text));
        }
      }
      return sec;
    }

    // ---------- the weave ----------
    function weave(d, episodes) {
      const rows = d.bins.rows, n = rows.length;
      if (!n) {
        const none = el("p", { class: "story-note" }, "This session’s length wasn’t recorded, so there is no time grid to weave.");
        return { node: none, readout: null, table: null, focusPin() {} };
      }
      const res = d.bins.resolution_ms.value, dur = durationOf(d);
      // Horizontal position is elapsed time: k pixels per millisecond. A short final
      // period keeps its true width; only its pointer target gets a small margin.
      const MIN_FRAME = 560, LABEL_GAP = 64;
      // A short session is stretched to a readable frame; every position still uses this one scale.
      const u = Math.max(14, Math.min(44, Math.floor(760 / Math.max(1, dur / res))));
      const k = Math.max(u / res, MIN_FRAME / dur), X = (ms) => ms * k;
      const rowH = 20, gap = 6, top = 8, y0 = top + 16, PAD = 16, MIN_HIT = 12;
      const base = y0 + LANES.length * (rowH + gap), H = base + 46, W = X(dur), SW = W + PAD;
      const box = svg("svg", { viewBox: `0 0 ${SW} ${H}`, width: String(SW), height: String(H), class: "weave", "aria-hidden": "true", focusable: "false" });
      const laneY = (i) => y0 + i * (rowH + gap);
      box.append(svg("rect", { x: "0", y: String(top), width: String(W), height: "8", fill: "url(#loom-hatch)", rx: "2" }));
      LANES.forEach((l, i) => box.append(svg("rect", { x: "0", y: String(laneY(i)), width: String(W), height: String(rowH), fill: "url(#loom-hatch)", rx: "2" })));
      let current = 0;
      rows.forEach((r, c) => {
        const w = r.end_ms - r.start_ms, x = X(r.start_ms), cw = X(w);
        const tx = cw > 4 ? x + 1 : x, tw = cw > 4 ? cw - 2 : cw, short = cw < MIN_HIT;
        const col = svg("g", { class: "col", style: `--d:${c}` });
        const cap = r.captured;
        if (cap.state !== "unavailable" && cap.value > 0) {
          col.append(svg("rect", { x: String(tx), y: String(top), width: String(tw), height: "8", rx: "1.5", class: "t-captured", "fill-opacity": (0.2 + 0.8 * cap.value / w).toFixed(2) }));
        }
        LANES.forEach((l, i) => {
          const v = r[l.key];
          if (v.state === "unavailable") {
            col.append(svg("rect", { x: String(x + cw / 2 - Math.min(2, cw / 2)), y: String(laneY(i) + rowH / 2 - 2), width: String(Math.min(4, cw)), height: "4", class: "unknown" }));
            return;
          }
          if (!v.value) return;
          const h = Math.max(2, rowH * Math.sqrt(v.value / w));
          col.append(svg("rect", { x: String(tx), y: (laneY(i) + (rowH - h) / 2).toFixed(1), width: String(tw), height: h.toFixed(1), rx: "1.5",
            class: `thread t-${l.cls}${v.state === "partial" ? " partial" : ""}` }));
        });
        if (short) col.append(svg("line", { x1: String(x), y1: String(top - 2), x2: String(x), y2: String(base + 2), class: "short-mark" }));
        const hit = svg("rect", { x: String(x), y: "0", width: String(short ? MIN_HIT : cw), height: String(H), class: short ? "hit short" : "hit", ...(short ? { "data-short": "true" } : {}) });
        hit.addEventListener("pointerenter", () => pick(c));
        hit.addEventListener("click", () => pick(c));
        col.append(hit);
        box.append(col);
      });
      // elapsed-hour axis: ticks at column edges, labels far enough apart to read
      const axis = svg("g", { class: "axis" });
      axis.append(svg("line", { x1: "0", y1: String(base + 22), x2: String(W), y2: String(base + 22) }));
      // Period edges get ticks; labels sit on round elapsed times far enough apart to read.
      for (const r of rows) {
        const at = X(r.start_ms);
        axis.append(svg("line", { x1: String(at), y1: String(base + 19), x2: String(at), y2: String(base + 27), class: "tick" }));
      }
      const step = [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 48 * HOUR]
        .find((ms) => X(ms) >= LABEL_GAP) || 96 * HOUR;
      for (let t = 0; t < dur; t += step) {
        const at = X(t);
        if (t && W - at < LABEL_GAP) break;
        axis.append(svg("text", { x: String(at), y: String(base + 40), "text-anchor": t ? "middle" : "start" }, t ? elapsed(t) : "0"));
      }
      axis.append(svg("line", { x1: String(W), y1: String(base + 19), x2: String(W), y2: String(base + 27), class: "tick" }),
        svg("text", { x: String(W), y: String(base + 40), "text-anchor": "end" }, elapsed(dur)));
      box.append(axis);
      const pins = svg("g", { class: "pins" });
      const pinCol = (at) => Math.min(n - 1, Math.floor(at / res));
      for (const ep of episodes) {
        if (ep.at === null) continue;
        const x = X(ep.at);
        pins.append(svg("g", { class: `pin-ep kind-${ep.event.kind}`, "data-pin": ep.event.id },
          svg("line", { x1: String(x), y1: String(y0 - 4), x2: String(x), y2: String(base + 4) }),
          svg("path", { d: `M${x} ${base + 4} l5 5 l-5 5 l-5 -5 z` })));
      }
      const cursor = svg("rect", { x: "0", y: String(top - 4), width: String(Math.max(2, X(rows[0].end_ms))), height: String(base - top + 8), rx: "3", class: "cursor" });
      box.append(pins, cursor);
      if (!reduced()) box.append(svg("g", { class: "shuttle" }, svg("ellipse", { cx: "0", cy: String(top + 4), rx: "14", ry: "4" })));
      const labels = el("div", { class: "row-labels", "aria-hidden": "true", style: `--top:${top}px;--y0:${y0}px;--rh:${rowH}px;--gap:${gap}px` },
        el("span", { class: "rl-cap" }, "any captured interval"),
        LANES.map((l) => el("span", { class: `rl t-${l.cls}-dot` }, l.label)),
        el("span", { class: "rl-axis" }, "hours since it opened"));
      const readout = el("div", { class: "readout", id: "loom-readout", "data-loom": "readout", "aria-live": "polite" });
      const scroller = el("div", { class: "weave-scroll", tabindex: "0", role: "group", "data-loom": "weave", "aria-describedby": "loom-readout",
        "aria-label": `The weave: ${plural(n, "column")} of ${elapsed(res)} each. Left and right arrows move between columns; Home and End jump to the ends.` }, box);
      scroller.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        const to = step ? current + step : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
        if (to === null) return;
        e.preventDefault();
        pick(to);
      });
      const pinned = (c) => episodes.filter((ep) => ep.at !== null && pinCol(ep.at) === c);
      const when = (r) => `${elapsed(r.start_ms)}–${elapsed(r.end_ms)}`;
      function pick(c) {
        current = Math.max(0, Math.min(n - 1, c));
        const r = rows[current], w = r.end_ms - r.start_ms;
        cursor.setAttribute("x", String(X(r.start_ms)));
        cursor.setAttribute("width", String(Math.max(2, X(w))));
        cursor.setAttribute("class", "cursor on");
        const notes = [];
        if (r.captured.state === "measured" && r.captured.value === 0) notes.push("No captured interval here. That doesn’t show nothing happened: helpers keep their own records, and some work isn’t captured.");
        if (r.stops.state !== "unavailable" && r.stops.value > 0) notes.push("A main-agent stop covers part of this period; other activity may overlap it.");
        put(readout,
          el("p", { class: "ro-when" }, "Since it opened, ", el("span", { "data-loom": "when" }, when(r)), w < res ? " (the last, shorter period)" : ""),
          el("ul", { class: "ro-lanes" }, [CAPTURED, ...LANES].map((l) => el("li", { class: `ro-${l.cls}` },
            el("span", { class: "ro-k" }, l.label), " ", el("span", { "data-lane": l.key }, cell(r[l.key], w))))),
          notes.map((t) => el("p", { class: "ro-note" }, t)),
          pinned(current).map((ep) => el("p", { class: "ro-pin" }, "Reviewed step pinned here: ", ep.event.explanation)));
        if (typeof scroller.scrollTo === "function" && typeof scroller.clientWidth === "number") {
          const x = X(r.start_ms);
          if (x < scroller.scrollLeft + 40 || x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollTo({ left: x - scroller.clientWidth / 2, behavior: reduced() ? "auto" : "smooth" });
        }
      }
      const table = el("details", { class: "table-alt" }, el("summary", {}, "Read the weave as a table"),
        el("div", { class: "wtable-scroll", tabindex: "0", role: "region", "aria-label": "The weave as a table" },
          el("table", { class: "wtable" },
            el("caption", {}, `Recorded time in each ${elapsed(res)} period, and its share of that period. Lanes overlap; the last period is read against its own width.`),
            el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Since it opened"), [CAPTURED, ...LANES].map((l) => el("th", { scope: "col" }, l.label)))),
            el("tbody", {}, rows.map((r) => el("tr", {}, el("th", { scope: "row" }, when(r)),
              [CAPTURED, ...LANES].map((l) => el("td", { "data-lane": l.key }, cell(r[l.key], r.end_ms - r.start_ms)))))))));
      pick(0);
      return {
        node: el("div", { class: "weave-frame" }, labels, scroller), readout, table,
        focusPin(eventId, at) {
          for (const p of pins.children) p.setAttribute("class", p.getAttribute("class").replace(/ on$/, "") + (p.getAttribute("data-pin") === eventId ? " on" : ""));
          if (at !== null) pick(pinCol(at));
        },
      };
    }

    // ---------- task returns, rough edges, sources ----------
    function returns(d) {
      if (!d.outcomes.length) return null;
      return el("section", { class: "knots", "aria-labelledby": "kn-h" },
        head("kn-h", "Where the task went back for another pass",
          "This is each task’s history as this session recorded it: a snapshot, not the current or complete task history. Returns carry no session time, so they aren’t drawn on the weave or counted as this session’s rework. ", tag("task")),
        d.outcomes.map((o) => {
          const r = o.returns, counted = r.items.filter((x) => x.counts), uncounted = r.items.length - counted.length;
          const W = 60 * r.items.length + (r.state === "measured" ? 30 : 110) + 20;
          const thread = svg("svg", { viewBox: `0 0 ${W} 74`, class: "knot-thread", "aria-hidden": "true", focusable: "false" });
          let x = 10;
          thread.append(svg("path", { d: `M0 40 H${x}`, class: "knot-path k-lead" }));
          r.items.forEach((item, i) => {
            thread.append(svg("path", { d: `M${x} 40 C${x + 30} 40 ${x + 40} 6 ${x + 25} 6 C${x + 10} 6 ${x + 20} 40 ${x + 60} 40`,
              class: `knot-path k-${item.counts ? item.caught : "uncounted"}`, style: `animation-delay:${(0.3 + i * 0.25).toFixed(2)}s` }),
            svg("text", { x: String(x + 25), y: "64", class: "knot-label", "text-anchor": "middle" }, item.counts ? CAUGHT_SHORT[item.caught] : "not counted"));
            x += 60;
          });
          thread.append(r.state === "measured" ? svg("path", { d: `M${x} 40 H${x + 30}`, class: "knot-path k-lead" })
            : svg("path", { d: `M${x} 40 C${x + 30} 30 ${x + 50} 50 ${x + 80} 38 M${x + 84} 37 l12 -4 M${x + 86} 42 l14 2`, class: "knot-path k-frayed" }));
          const groups = new Map();
          for (const item of counted) groups.set(item.caught, (groups.get(item.caught) || 0) + 1);
          const status = ` ${statusText(o)}`;
          return el("article", { class: "knot-task" },
            el("h3", {}, el("a", { href: `#/sessions?task=${o.job}` }, taskLabel(o.job))),
            el("p", { class: "muted" }, o.state.state === "unavailable" ? `In this session’s snapshot (${revText(o)}), its hand-over state wasn’t recorded (${reasonText(o.state.reasons)}).`
              : `As this session recorded it (${revText(o)}), the task was ${stateText(o)}.`, status),
            r.state === "unavailable" ? el("p", {}, `Its return history wasn’t recorded (${reasonText(r.reasons)}). That is unknown, not zero.`) : [
              r.items.length ? el("div", { class: "knot-row" }, thread) : null,
              el("ul", { class: "knot-list" },
                [...groups].map(([caught, n]) => el("li", { class: `knot k-${caught}` }, el("span", { class: "knot-n" }, String(n)),
                  el("span", {}, `${n === 1 ? "return" : "returns"} ${CAUGHT[caught]}`))),
                uncounted ? el("li", { class: "knot k-uncounted" }, el("span", { class: "knot-n" }, String(uncounted)),
                  el("span", {}, `recorded ${uncounted === 1 ? "return" : "returns"} not counted as rework`)) : null,
                !r.items.length && r.state === "measured" ? el("li", { class: "knot k-none" }, el("span", {}, "No returns in its complete recorded history.")) : null),
              r.state === "partial" ? el("p", { class: "story-note" }, `The history is incomplete (${reasonText(r.reasons)}), so these are only its readable entries.`) : null]);
        }));
    }
    function edges(d, proposals) {
      const n = d.numbers;
      const calls = n.tool_calls, fails = n.tool_failures;
      const items = [
        { g: "snag", t: calls.state === "measured" && fails.state === "measured" && calls.value > 0
          ? `${count(fails.value)} of ${count(calls.value)} tool calls failed (${Math.round((fails.value / calls.value) * 100)}%)`
          : `Tool failures: ${stated(fails, count)} of ${stated(calls, count)} calls`,
        d: "A failure might be a test meant to fail, a real bug, or harmless probing. The count alone doesn’t say which." },
        { g: "loop", t: `Calls tried again: ${stated(n.tool_retries, count)}`, d: "A retry follows a failed or interrupted call." },
        { g: "wave", t: `Memory refreshed: ${stated(n.compactions, (v) => plural(v, "time"))}`, d: "Each refresh compacts the conversation so the agent can carry on; what it dropped isn’t recorded here." },
        { g: "pause", t: `Main-agent stops covered ${stated(n.stop_ms, span)}`, d: "Each runs from a main-agent stop to the next recorded prompt. The record usually doesn’t say why it stopped, and a prompt isn’t proof that a person replied." },
        d.workers.state === "unavailable" ? null : { g: "knot", t: `${plural(d.workers.items.length, "agent")} recorded${d.workers.state === "partial" ? " (partly)" : ""}`,
          d: "The main agent and its helpers. Recorded parent links aren’t treated as a reliable tree." },
      ].filter(Boolean);
      return el("section", { class: "edges", "aria-labelledby": "ed-h" },
        head("ed-h", "Rough edges", "Small things worth a look. None of them is a loss on its own, and none explains itself. ", tag("recorded")),
        el("ul", { class: "edge-list" }, items.map((i) => el("li", {}, glyph(i.g), el("div", {}, el("p", { class: "edge-t" }, i.t), el("p", {}, i.d))))),
        proposals.length ? el("p", { class: "ch-link" }, el("a", { href: mendHref(d.session.id, proposals[0].rec.id) }, "See the reviewed proposals →")) : null);
    }
    function sourcesOf(d, id) {
      const s = d.sources, rev = (v) => v === "unavailable" ? "unavailable" : v.slice(0, 7);
      return el("section", { class: "how-we-know", "aria-labelledby": "hk-h" },
        head("hk-h", "How we know", "Everything above is read from the session’s published record and the reviewed context of the tasks it is bound to."),
        el("ul", { class: "source-list" },
          el("li", {}, el("a", { href: `sessions/${id}.json` }, "This session’s published record"), " · ", el("code", {}, id)),
          el("li", {}, el("a", { href: `evidence.html#/session/${id}` }, "This session in the detailed evidence reader")),
          d.bindings.items.map((b) => el("li", {}, el("a", { href: `evidence.html#/task/${b.job}/session/${id}` }, `Its share of ${taskLabel(b.job)}, in detail`)))),
        el("p", { class: "muted" }, "Built from desk ", el("code", {}, rev(s.desk)), ", facts ", el("code", {}, rev(s.facts)), " and reports ", el("code", {}, rev(s.reports)),
          ". These are the revisions this build read, not proof of a release."));
    }

    // ---------- what to mend ----------
    const tried = new Set();
    function proposalCard(p, focusId) {
      const r = p.rec;
      const seen = [...p.sessions];
      return el("li", { class: `note${r.id === focusId ? " is-focus" : ""}`, id: `idea-${r.id}`, tabindex: "-1" },
        el("header", {}, glyph("loop"), el("h3", {}, r.change), pills()),
        el("p", { class: "note-scope" }, tag("idea"), " ", `${r.confidence} confidence · reviewed for `, el("a", { href: `#/sessions?task=${p.job}` }, taskLabel(p.job))),
        el("ol", { class: "pdca" },
          el("li", { class: "step s-notice" }, el("span", { class: "step-k" }, "Noticed"), el("p", {}, r.problem),
            el("ul", { class: "observed" }, p.observed.map((e) => el("li", {}, e.explanation))), tag("reviewed")),
          el("li", { class: "step s-try" }, el("span", { class: "step-k" }, "Try"), el("p", {}, r.change),
            el("p", { class: "guess" }, "Why it might help, as a guess: ", r.hypothesis), tag("idea")),
          el("li", { class: "step s-check" }, el("span", { class: "step-k" }, "Check"), el("p", {}, el("strong", {}, "Not checked. "), "What would show it: ", r.check)),
          el("li", { class: "step s-learn" }, el("span", { class: "step-k" }, "Then"), el("p", {}, "Decided after a check. Nothing is decided yet."))),
        el("p", { class: "note-sessions" }, "Seen in: ", seen.map((sid, i) => [i ? ", " : "",
          state.rows.has(sid) ? el("a", { href: `#/session/${sid}` }, `session ${shortId(sid)}`) : el("code", {}, shortId(sid))])));
    }
    function byId(node, id) {
      if (node.getAttribute && node.getAttribute("id") === id) return node;
      for (const k of Array.from(node.children || [])) { const f = k.getAttribute ? byId(k, id) : null; if (f) return f; }
      return null;
    }
    function linkedProblem(linked, retry) {
      if (!linked) return null;
      if (!linked.known) return el("p", { class: "problem", role: "note" }, `The linked session ${shortId(linked.id)} isn’t in this build’s session catalog, so its proposals can’t be read here.`);
      if (linked.res.ok) return null;
      return el("div", { class: "problem", role: "alert" },
        el("p", {}, linked.res.kind === "invalid" ? `The linked session’s record didn’t pass its checks, so no proposal is read from it.`
          : `Couldn’t load the linked session’s record: ${linked.res.text}`),
        el("p", {}, el("button", { type: "button", class: "ghost", onclick: retry }, "Try again"), " ",
          el("a", { href: `#/session/${linked.id}` }, `Open session ${shortId(linked.id)}`)));
    }
    function proposalsSection(focusId, linked) {
      const sec = el("section", { class: "mend-proposals", "aria-labelledby": "mp-h" });
      let status = null;
      const fill = () => {
        const bound = order(state.catalog.sessions.filter((r) => r.jobs.length));
        const searched = bound.filter((r) => state.loaded.has(r.id)).length;
        const found = new Map();
        for (const d of state.loaded.values()) for (const p of d.contexts.flatMap(proposalsOf)) found.set(`${p.job}:${p.rec.id}`, p);
        const left = bound.filter((r) => !state.loaded.has(r.id) && !tried.has(r.id));
        const button = left.length ? el("button", { type: "button", class: "ghost" }, `Look through the next ${plural(Math.min(SCAN, left.length), "session record")}`) : null;
        status = el("p", { class: "disclosure", role: "status", tabindex: "-1" },
          `Searched ${searched} of ${bound.length} bound session records in this build`, tried.size ? ` (${plural(tried.size, "record")} couldn’t be read)` : "",
          `; ${plural(found.size, "reviewed proposal")} found. Proposals live in reviewed task stories, so they are read session by session, never all at once.`);
        if (button) {
          button.addEventListener("click", async () => {
            button.setAttribute("disabled", "");
            const next = left.slice(0, SCAN);
            const results = await Promise.all(next.map((r) => detail(r.id)));
            results.forEach((res, i) => { if (!res.ok) tried.add(next[i].id); });
            fill();
            status.focus();
          });
        }
        const failed = linked && linked.known && !linked.res.ok;
        const retry = async (e) => {
          if (e && e.currentTarget) e.currentTarget.setAttribute("disabled", "");
          state.details.delete(linked.id);
          linked.res = await detail(linked.id);
          fill();
          const card = focusId ? byId(sec, `idea-${focusId}`) : null;
          (card || status).setAttribute("tabindex", "-1");
          (card || status).focus();
        };
        put(sec,
          head("mp-h", "Reviewed proposals", "Each comes from a reviewed task story and cites the steps it noticed. Shipping a change and the change helping are different marks, so each card carries both. ", tag("idea")),
          linkedProblem(linked, retry),
          status,
          found.size ? el("ol", { class: "notes" }, [...found.values()].map((p) => proposalCard(p, focusId)))
            : failed ? null
              : el("p", { class: "story-note" }, "No reviewed proposal in the session records searched so far. That is not the same as having nothing to change."),
          button);
      };
      fill();
      return sec;
    }
    function checkCard(r) {
      const card = r.card;
      const measure = card ? MEASURES[card.measure] || card.measure.replace(/_/g, " ") : null;
      const pr = r.implementation.url ? /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(r.implementation.url) : null;
      const limits = r.limits.map((k) => LIMITS[k] || `${k.replace(/_/g, " ")}.`);
      const kind = card ? kindOf(card.measure) : "time";
      const side = (label, x) => el("li", {}, `${label} median: ${figureText(x.median, kind, false)} (${plural(x.jobs, "task")} in ${plural(x.groups, "group")})`);
      const comparison = r.status !== "checked" ? null : el("ul", { class: "comparison", "aria-label": "The measured comparison" },
        side("Before", r.before), side("After", r.after),
        el("li", {}, `Change, after minus before: ${figureText(r.change, kind, true)}`),
        el("li", {}, r.interval ? `95% interval: ${amount(r.interval.low, kind, true)} to ${amount(r.interval.high, kind, true)}${r.interval.state === "partial" ? ` (partly recorded: ${reasonText(r.interval.reasons)}; the true bounds may lie elsewhere)` : ""}`
          : "95% interval: not established"),
        el("li", {}, `Measurement: ${r.measurement_state}${r.measurement_state === "partial" ? ", so side medians are lower bounds and the change has an unknown direction of error" : ""}. Canonical method: 95% bootstrap interval, 10,000 resamples, at least 6 independent groups per side.`));
      return el("li", { class: "note check-note" },
        el("header", {}, glyph("knot"), el("h3", {}, measure ? `Change aimed at ${measure}` : `Change ${r.ref}`),
          el("span", { class: "status" }, el("span", { class: `pill ch-${r.implementation.merged}`, "data-pill": "change" }, MERGED[r.implementation.merged]),
            el("span", { class: `pill ck-${r.result}`, "data-pill": "check" }, RESULTS[r.result] || r.result))),
        el("ol", { class: "pdca" },
          el("li", { class: "step s-notice" }, el("span", { class: "step-k" }, "Noticed"),
            el("p", {}, "Raised as ", el("a", { href: r.url }, r.ref), r.issue_state === "closed" ? " (closed)" : " (open)", "."), tag("recorded")),
          el("li", { class: "step s-try" }, el("span", { class: "step-k" }, "Try"),
            el("p", {}, pr ? ["The change: ", el("a", { href: r.implementation.url }, `${pr[1]} pull request ${pr[2]}`)] : "No change is linked.",
              card && card.version ? ` Released in ${card.plugin} ${card.version}.` : card ? " Not released in a recorded version yet." : ""), tag("recorded")),
          el("li", { class: "step s-check" }, el("span", { class: "step-k" }, "Check"),
            el("p", {}, card ? `Watching ${measure}, hoping it goes ${card.direction}. ` : "", el("strong", {}, `${RESULTS[r.result] || r.result}.`)),
            comparison,
            r.status === "checked" ? el("p", { class: "muted" }, `${plural(r.sample_jobs, "task")} considered: ${count(r.before.jobs)} before the change and ${count(r.after.jobs)} after.`,
              r.excluded.length ? [" Left out: ", r.excluded.map((x, i) => [i ? "; " : "", `${count(x.jobs)} ${EXCLUDED[x.reason] || x.reason.replace(/_/g, " ")}`]), "."] : "") : null,
            r.reasons.length ? el("p", { class: "muted" }, `Why it isn’t checked: ${reasonText(r.reasons)}.`) : null,
            el("ul", { class: "limits", "aria-label": "Limitations of this check" }, limits.map((t) => el("li", { class: "guess" }, t))), tag("checked")),
          el("li", { class: "step s-learn" }, el("span", { class: "step-k" }, "Then"), el("p", {}, "The next step isn’t recorded."))));
    }
    function checksSection() {
      const L = state.learning;
      const sec = el("section", { class: "mend-checks", "aria-labelledby": "mc-h" },
        head("mc-h", "Changes and their checks", "Canonical changes and what a later check found. “Inconclusive” is an honest result, and a shipped change isn’t a proven improvement. ", tag("checked")));
      if (L.kind === "none") sec.append(el("p", { class: "problem", role: "note" }, "Changes and their checks aren’t available in this build."));
      else if (L.kind === "invalid") sec.append(el("p", { class: "problem", role: "alert" }, "The learning record didn’t pass its checks, so none of it is shown."));
      else if (L.kind === "error") sec.append(el("p", { class: "problem", role: "alert" }, `Couldn’t load changes and their checks: ${L.text}`));
      else {
        const imp = L.doc.improvements;
        sec.append(el("p", { class: "disclosure" }, `${plural(imp.rows.length, "canonical change")} in this build`,
          imp.availability === "available" ? "." : ` (${imp.availability}: ${reasonText(imp.reasons)}).`));
        if (imp.rows.length) sec.append(el("ol", { class: "notes" }, imp.rows.map(checkCard)));
      }
      return sec;
    }
    async function mend(route) {
      // The explicitly linked session is read first; its outcome is shown, never folded into an empty scan.
      const linked = route.session ? { id: route.session, known: state.rows.has(route.session), res: null } : null;
      if (linked && linked.known) linked.res = await detail(linked.id);
      const page = el("div", { class: "page page-mend" },
        el("p", { class: "eyebrow" }, "Noticed → Try → Check → Then"),
        el("h1", { class: "display" }, "What to mend ", el("em", {}, "next.")),
        el("p", { class: "lede" }, "Each card runs the same loop: what was noticed, one change to try, what would show whether it helped, and what was decided. Nothing here claims time saved or a proven cause."),
        proposalsSection(route.focus, linked), checksSection());
      return [page, route.focus ? byId(page, `idea-${route.focus}`) : null];
    }

    // ---------- how to read ----------
    function about() {
      const term = (t, d) => [el("dt", {}, t), el("dd", {}, d)];
      return el("div", { class: "page page-about" },
        el("p", { class: "eyebrow" }, "A plain glossary"),
        el("h1", { class: "display" }, "How to read ", el("em", {}, "the loom.")),
        el("dl", { class: "about" },
          term("A session", "One continuous run of an agent, from opening to closing, or to its last record if it was still open."),
          term("Threads", "Each row is one kind of recorded activity, plus a row for main-agent stops. A thicker thread means more of that period was covered. Rows overlap, so they don’t add up to the whole period."),
          term("Bare canvas", "No captured interval. That doesn’t show nothing happened: helpers keep their own records, and some work isn’t captured. It is never counted as zero, inactivity or a loss."),
          term("Main-agent stops and recorded prompts", "A stop runs from when the main agent stopped to the next recorded prompt. The record usually doesn’t say why, and a prompt isn’t proof that a person replied. Other activity may overlap a stop."),
          term("Loops", "Times a task went back for another pass, marked by when they were caught: during the work, at review, or after hand-over. They belong to the whole task, as a snapshot each session recorded; an older session can show an older state. Returns not counted as rework and unreadable history stay visible and are never counted as mistakes."),
          term("Pins", "A reviewed story step is pinned where its evidence is. A pin is not a duration, and the gap between pins is not time spent."),
          term("Four kinds of statement", "Recorded: measured from the session record. Reviewed story: a checked, privacy-reviewed explanation. Proposal: a reviewed suggestion, never generated from counts. Checked: what a later canonical check found."),
          term("Task associations", "A session can be bound to one or more tasks. A task’s name tells you what the task was, not what the whole session was for."),
          term("Older views", ["Every earlier view of the factory lives on in ", el("a", { href: "evidence.html" }, "the detailed evidence reader"), "."])),
        el("p", { class: "lede small" }, tag("recorded"), " ", tag("reviewed"), " ", tag("idea"), " ", tag("checked"), " ", tag("task")),
        legend());
    }
    return { ready, go };
  }

  function boot(scope) {
    const win = scope;
    const target = legacyTarget(win.location.hash, win.location.search);
    if (target) { win.location.replace(target); return; }
    // A dependency that failed to load leaves the page's static failure state in place.
    if (win.document.documentElement.getAttribute("data-loom-asset") === "failed") return;
    const json = (path) => win.fetch(path, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${path} answered ${r.status}`);
      return r.json();
    });
    const optional = (path) => win.fetch(path, { cache: "no-cache" }).then((r) => r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error(`${path} answered ${r.status}`)));
    let rows = null;
    const catalog = json("sessions/index.json").then((c) => { rows = c; return c; });
    mountLoom({
      root: win.document.getElementById("loom"), document: win.document, window: win, catalog,
      readDetail: (id) => {
        const row = rows && Array.isArray(rows.sessions) ? rows.sessions.find((r) => r.id === id) : null;
        return json(row ? row.detail : `sessions/${id}.json`);
      },
      learning: optional("rollups/learning.json"), tasks: optional("rollups/tasks.json"),
    });
  }
  return { mountLoom, legacyTarget, parseRoute, boot };
});
