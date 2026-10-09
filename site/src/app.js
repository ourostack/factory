// Factory site renderer. Fetches ./data.json (built at CI time from the
// public store) and draws every chart with plain DOM/SVG - no chart library,
// no framework. All labels come from the store and are inserted with
// textContent, never innerHTML, since they are untrusted data.

(function () {
  "use strict";

  const DATA_URL = "./data.json";
  const tooltip = document.getElementById("tooltip");

  // ---------------------------------------------------------------- format
  // Every number goes through FactoryFormat (format.js). There is no other
  // number formatter on this page.

  const F = window.FactoryFormat;

  function num(number, kind, opts) {
    return F.render(document, number, kind, opts);
  }

  // A link built from data: only a GitHub pull request, issue or run URL
  // becomes a link; anything else is shown as plain text.
  function safeLink(text, url, className) {
    const safe = F.safeGithubUrl(url);
    if (!safe) return el("span", className, text);
    const a = document.createElement("a");
    if (className) a.className = className;
    a.href = safe;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = text;
    return a;
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function emptyState(container, text) {
    container.innerHTML = "";
    container.appendChild(el("p", "chart-empty", text));
  }

  // --------------------------------------------------------------- tooltip

  function showTooltipAt(x, y, title, rows) {
    tooltip.innerHTML = "";
    tooltip.appendChild(el("div", "tt-title", title));
    for (const row of rows) {
      const rowEl = el("div", "tt-row");
      rowEl.appendChild(document.createTextNode(`${row.label}: `));
      rowEl.appendChild(el("strong", null, row.value));
      tooltip.appendChild(rowEl);
    }
    tooltip.classList.add("visible");
    // Measure after content is set so clamping uses the real box.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = tooltip.offsetWidth || 200;
    const h = tooltip.offsetHeight || 60;
    const left = Math.min(Math.max(8, x + 14), vw - w - 8);
    const top = Math.min(Math.max(8, y + 14), vh - h - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.classList.remove("visible");
  }

  // ------------------------------------------------------------ bar chart
  // Reusable horizontal bar list: .bars / .bar-row / .bar-track / .bar-fill,
  // matching the dataviz mark spec (thin bar, rounded end, hover response).
  // rows: [{ label, number, secondary?, color?, tooltipRows? }] where number
  // and secondary are stated numbers. A row with no data draws no bar and says
  // "no data" with its reason; the bar length comes from the value only.

  // Harness breakdown. Every string is untrusted data, so it goes in through
  // textContent only (el helper), never innerHTML.
  const UNPROVEN_LABEL = "(unproven)";

  // A map of label to stated count, as "label (count), ...". An empty map
  // says "none recorded": nothing was recorded, which is not a zero.
  function countsNode(obj) {
    const entries = Object.entries(obj || {}).sort((a, b) => b[1].value - a[1].value);
    const span = el("span");
    if (!entries.length) {
      span.textContent = "none recorded";
      return span;
    }
    entries.forEach(([k, n], i) => {
      if (i) span.appendChild(document.createTextNode(", "));
      span.appendChild(document.createTextNode(`${k} (`));
      span.appendChild(num(n, "count"));
      span.appendChild(document.createTextNode(")"));
    });
    return span;
  }

  function renderHarnesses(container, harnesses) {
    container.innerHTML = "";
    if (!Array.isArray(harnesses) || !harnesses.length) {
      emptyState(container, "No harness data recorded yet.");
      return;
    }
    for (const h of harnesses) {
      const card = el("div", "harness");
      const head = el("h4", "harness-name", h.host);
      if (h.unproven) head.appendChild(el("span", "harness-unproven", ` ${UNPROVEN_LABEL}`));
      card.appendChild(head);
      const facts = el("dl", "harness-facts");
      const add = (k, v) => {
        facts.appendChild(el("dt", null, k));
        const dd = el("dd");
        dd.appendChild(typeof v === "string" ? document.createTextNode(v) : v);
        facts.appendChild(dd);
      };
      add("Sessions", num(h.sessions, "count"));
      add("Versions", countsNode(h.versions));
      add("Workers", num(h.workers, "count"));
      add("Subagents", num(h.subagents, "count"));
      add("Max depth", num(h.max_depth, "count"));
      add("Models", countsNode(h.models));
      if (h.agent_types && Object.keys(h.agent_types).length) {
        add("Agent types", countsNode(h.agent_types));
      }
      if (h.requested_vs_resolved && h.requested_vs_resolved.length) {
        const span = el("span");
        h.requested_vs_resolved.forEach((p, i) => {
          if (i) span.appendChild(document.createTextNode(", "));
          span.appendChild(document.createTextNode(`${p.requested} \u2192 ${p.resolved} (`));
          span.appendChild(num(p.workers, "count"));
          span.appendChild(document.createTextNode(")"));
        });
        add("Requested vs resolved", span);
      }
      card.appendChild(facts);
      container.appendChild(card);
    }
  }

  // Every bar list is linear from zero on a stated scale (F.barScale): a
  // share runs 0 to 100%, a count or a duration 0 to a round number shown in
  // the list's title. The track spans the full width and stays visible
  // behind the fill; every bar has its value written beside it.
  function renderBarList(container, rows, opts) {
    container.innerHTML = "";
    const raw = (n) => (n && n.state !== "unavailable" ? n.value : null);
    const values = rows.flatMap((r) => [raw(r.number), raw(r.secondary)].filter((v) => typeof v === "number"));
    const scale = F.barScale(values, { kind: opts.kind, scale: opts.scale });
    if (opts.title) {
      const h = el(opts.titleTag || "h3", "bars-title", opts.title);
      if (rows.length) h.appendChild(el("span", "bars-scale", ` · ${scale.label}${opts.unit ? ` ${opts.unit}` : ""}`));
      container.appendChild(h);
    }
    if (opts.caption) container.appendChild(el("p", "chart-caption", opts.caption));
    if (!rows.length) {
      container.appendChild(el("p", "chart-empty", opts.emptyText || "No data yet."));
      return;
    }
    const wrap = el("div", "bars");
    wrap.dataset.scaleMax = String(scale.max);
    const color = opts.color || "var(--series-1)";

    for (const row of rows) {
      // No tab stop: the row's text is all visible, so the tooltip only repeats it to a mouse.
      const draw = F.barRow(row.number, row.secondary, scale);
      const rowEl = el("div", draw.draw === "none" ? "bar-row bar-row-unavailable" : "bar-row");
      const head = el("div", "bar-head");
      const labelEl = el("span", "bar-label", row.label);
      if (row.flag) labelEl.appendChild(el("span", "bar-flag", ` (${row.flag})`));
      if (draw.draw === "none") {
        // Not measured: no track, so it can never read as zero. "no data" and its reason stand in the bar's place.
        head.append(labelEl);
        const nodata = el("p", "bar-nodata");
        nodata.appendChild(num(row.number, opts.kind, { nofn: opts.nofn, flag: opts.flag, basis: opts.basis }));
        rowEl.append(head, nodata);
      } else {
        const trackEl = el("div", "bar-track");
        if (draw.secondaryWidth !== null) {
          const secEl = el("div", "bar-fill secondary");
          secEl.style.width = `${draw.secondaryWidth}%`;
          trackEl.appendChild(secEl);
        }
        const fillEl = el("div", "bar-fill");
        fillEl.style.width = `${draw.width}%`;
        fillEl.style.background = row.color || color;
        trackEl.appendChild(fillEl);
        const valueEl = el("span", "bar-value");
        valueEl.appendChild(num(row.number, opts.kind, { nofn: opts.nofn, flag: opts.flag, basis: opts.basis }));
        if (opts.suffix) valueEl.appendChild(document.createTextNode(opts.suffix));
        head.append(labelEl, valueEl);
        rowEl.append(head, trackEl);
      }

      const showTT = (evt) => {
        const rect = rowEl.getBoundingClientRect();
        const x = evt && "clientX" in evt && evt.clientX ? evt.clientX : rect.right;
        const y = evt && "clientY" in evt && evt.clientY ? evt.clientY : rect.top + rect.height / 2;
        const ttRows = row.tooltipRows || [{ label: "Value", value: F.toText(row.number, opts.kind) }];
        showTooltipAt(x, y, row.label, ttRows);
      };
      rowEl.addEventListener("mousemove", showTT);
      rowEl.addEventListener("mouseenter", showTT);
      rowEl.addEventListener("mouseleave", hideTooltip);
      wrap.appendChild(rowEl);
    }
    container.appendChild(wrap);
  }

  // -------------------------------------------------------- intake chart
  // The one true time-series in this page: daily count of facts files
  // first landing on `main`, from ordinary public Git commit metadata. The
  // page shows no calendar date: days are counted from the first intake.

  function dayNumber(first, dayStr) {
    const a = Date.parse(`${first}T00:00:00Z`);
    const b = Date.parse(`${dayStr}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) + 1 : null;
  }

  function renderIntakeChart(container, rawItems) {
    container.innerHTML = "";
    if (!rawItems.length) {
      emptyState(container, "No intake history available yet.");
      return;
    }
    // Each day's count is a measured number; the running total is their sum.
    // The axis is honest about time: every day from the first intake to the
    // last has its place, and a day with no intake keeps the running total,
    // drawn lighter, so day 5 and day 9 are four days apart, not one.
    let running = 0;
    const byDay = new Map();
    for (const i of rawItems) {
      const n = dayNumber(rawItems[0].day, i.day);
      if (n !== null && n > 0) byDay.set(n, byDay.has(n) ? byDay.get(n) + i.count.value : i.count.value);
    }
    const lastDay = Math.max(1, ...byDay.keys());
    const items = [];
    for (let n = 1; n <= lastDay; n++) {
      const added = byDay.has(n) ? byDay.get(n) : 0;
      running += added;
      items.push({ day: `day ${n}`, count: running, added: { state: "measured", value: added, reasons: [] }, quiet: !byDay.has(n) });
    }
    const width = 600;
    const height = 190;
    const padL = 34;
    const padR = 8;
    const padT = 10;
    const padB = 28;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const maxCount = Math.max(...items.map((i) => i.count), 1);
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "svg-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Cumulative sessions published, one bar per day since the first intake, every day in order; days with no intake keep the total and are drawn lighter");

    [0, 0.5, 1].forEach((frac) => {
      const y = padT + innerH * (1 - frac);
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(padL));
      line.setAttribute("x2", String(width - padR));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("class", frac === 0 ? "axis-line" : "gridline");
      svg.appendChild(line);
      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", String(padL - 6));
      label.setAttribute("y", String(y + 3));
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "tick-label");
      label.textContent = F.toText({ state: "measured", value: Math.round(maxCount * frac), reasons: [] }, "count");
      svg.appendChild(label);
    });

    const step = innerW / items.length;
    const barW = Math.max(2, step - 4);
    // Days with no intake have no bar, so every bar is labeled when they fit: the gaps between day numbers then show.
    const tickEvery = Math.max(1, Math.ceil(items.length / 10));

    items.forEach((item, idx) => {
      const x = padL + idx * step + 2;
      const h = maxCount > 0 ? (item.count / maxCount) * innerH : 0;
      const y = padT + innerH - h;
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(barW));
      rect.setAttribute("height", String(Math.max(h, 0)));
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", "var(--series-1)");
      rect.setAttribute("class", item.quiet ? "mark mark-quiet" : "mark");
      rect.setAttribute("tabindex", "0");
      const showTT = (evt) => {
        const box = rect.getBoundingClientRect();
        const cx = evt && evt.clientX ? evt.clientX : box.left + box.width / 2;
        const cy = evt && evt.clientY ? evt.clientY : box.top;
        showTooltipAt(cx, cy, item.day, [
          { label: "Total published so far", value: F.toText({ state: "measured", value: item.count, reasons: [] }, "count") },
          { label: "Published this day", value: F.toText(item.added, "count") },
        ]);
      };
      rect.addEventListener("mousemove", showTT);
      rect.addEventListener("mouseenter", showTT);
      rect.addEventListener("mouseleave", hideTooltip);
      rect.addEventListener("focus", showTT);
      rect.addEventListener("blur", hideTooltip);
      svg.appendChild(rect);

      if (idx % tickEvery === 0) {
        const tick = document.createElementNS(svgNS, "text");
        tick.setAttribute("x", String(x + barW / 2));
        tick.setAttribute("y", String(height - 8));
        tick.setAttribute("text-anchor", "middle");
        tick.setAttribute("class", "tick-label");
        tick.textContent = item.day;
        svg.appendChild(tick);
      }
    });

    container.appendChild(svg);
  }

  // -------------------------------------------------------------- lookups

  const STATUS_COLOR = {
    done: "var(--status-good)",
    processing: "var(--status-warning)",
    validating: "var(--status-warning)",
    drafting: "var(--status-warning)",
    blocked: "var(--status-critical)",
    cancelled: "var(--text-muted)",
    unavailable: "var(--text-muted)",
  };

  // Plain names for every waste key, from the build (waste.mjs).
  let wasteNames = {};
  const wasteName = (key) => wasteNames[key] || "Unnamed waste";

  function statusColor(status) {
    return STATUS_COLOR[status] || "var(--text-muted)";
  }

  function measuredCount(v) {
    return { state: "measured", value: v, reasons: [] };
  }

  // ----------------------------------------------------- trust and slots

  const TRUST_LABEL = { ok: "ok", thin_sample: "thin sample", partial: "partial", low_coverage: "low coverage", coverage_unknown: "capture coverage not measured" };

  // The trust state of a headline, as text beside the figure: its status in
  // words, why, and what is known about capture coverage. Coverage is never
  // shown as a percentage until a coverage record exists.
  // One plain sentence on how far a figure can be trusted. The status words
  // are on hover (TRUST_LABEL), never a code on the page.
  const TRUST_LEAD = {
    ok: "Sound",
    thin_sample: "Thin sample",
    partial: "Partly measured",
    low_coverage: "Low capture coverage, so much of the work may be missing",
    coverage_unknown: "Can't yet tell how much work was missed",
  };
  function trustNode(t) {
    const wrap = el("span", `trust trust-${t.status}`);
    const reason = String(t.reason || "");
    wrap.textContent = `${TRUST_LEAD[t.status] || "Not sound"}: ${reason}.`;
    wrap.title = `${TRUST_LABEL[t.status] || t.status}; ${F.coverageWords(t.coverage)}`;
    return wrap;
  }

  // A sentence with {slots}. A slot holding a stated number goes through the
  // formatter; a string slot is text.
  // In a sentence a rollup shows its n of N once (on the first one) and no
  // partial flag: the trust line beside the sentence carries the state.
  function templated(template, slots, kinds, sentence) {
    const out = el("span");
    let shownNofn = false;
    const parts = template.split(/(\{[a-z_]+\})/);
    for (const part of parts) {
      const m = part.match(/^\{([a-z_]+)\}$/);
      if (!m) {
        if (part) out.appendChild(document.createTextNode(part));
        continue;
      }
      const v = slots[m[1]];
      if (typeof v === "string") out.appendChild(document.createTextNode(v));
      else if (sentence) {
        const isRollup = v && v.kind === "rollup";
        out.appendChild(num(v, (kinds && kinds[m[1]]) || "count", { flag: false, nofn: isRollup && !shownNofn }));
        if (isRollup) shownNofn = true;
      } else out.appendChild(num(v, (kinds && kinds[m[1]]) || "count"));
    }
    return out;
  }

  // ---------------------------------------------------------------- KPIs

  const KPI_KIND = { tool_calls: "compact", model_requests: "compact" };

  // The store's counts as a plain list: label, figure, what it counts and
  // how far it can be trusted. No tiles: nothing here is clickable.
  function renderKPIs(container, headlines) {
    container.innerHTML = "";
    const dl = el("dl", "facts-list");
    for (const h of headlines) {
      const dd = el("dd");
      dd.appendChild(num(h.number, KPI_KIND[h.id] || "count"));
      const note = el("span", "fact-note");
      note.appendChild(document.createTextNode(" \u00b7 "));
      note.appendChild(templated(h.note.template, h.note.slots));
      note.appendChild(document.createTextNode(". "));
      note.appendChild(trustNode(h.trust));
      dd.appendChild(note);
      dl.append(el("dt", null, h.label), dd);
    }
    container.appendChild(dl);
  }

  // ----------------------------------------------------------- takeaways

  const TAKEAWAY_KINDS = {
    median: "pct",
    rate: "pct1",
    share: "pct",
    calls: "count",
    failures: "count",
    total: "count",
  };

  function renderTakeaways(container, takeaways) {
    container.innerHTML = "";
    if (!takeaways.length) {
      emptyState(container, "Not enough evidence yet for a computed takeaway.");
      return;
    }
    const ol = el("ol", "plain-list");
    for (const t of takeaways) {
      const li = el("li");
      // The model-request total is a compact count; everything else is a count
      // or a share. The slot's own name picks the kind.
      li.appendChild(templated(t.template, t.slots, TAKEAWAY_KINDS, true));
      const tr = el("span", "takeaway-trust");
      tr.appendChild(trustNode(t.trust));
      li.appendChild(tr);
      ol.appendChild(li);
    }
    container.appendChild(ol);
  }

  // ------------------------------------------------------------ featured

  // The longest sessions, one plain list item each: how long, what it did,
  // and how many of its pull requests merged.
  function renderFeatured(container, featured) {
    container.innerHTML = "";
    if (!featured.length) {
      emptyState(
        container,
        "No session in the store yet references a public pull request long enough to feature here.",
      );
      return;
    }
    const ol = el("ol", "plain-list featured-list");
    for (const f of featured) {
      const li = el("li");
      const head = el("p", "featured-head");
      const strong = el("strong");
      strong.appendChild(num(f.duration_ms, "hours"));
      strong.appendChild(document.createTextNode(" hours in one session"));
      head.appendChild(strong);
      head.appendChild(el("span", "muted", ` \u00b7 ${f.host} \u00b7 session ${f.session_id.slice(0, 8)}`));
      li.appendChild(head);
      const stats = el("p", "featured-stats");
      [["active", f.active_ms, "duration"], ["subagents", f.subagent_count, "count"], ["tool calls", f.tool_calls_total, "count"], ["failed", f.tool_failures_total, "count"]].forEach(([label, number, kind], i) => {
        if (i) stats.appendChild(document.createTextNode(" \u00b7 "));
        stats.appendChild(num(number, kind));
        stats.appendChild(document.createTextNode(` ${label}`));
      });
      li.appendChild(stats);
      const mergeLine = el("p", "featured-merge");
      mergeLine.appendChild(num(f.prs_merged, "count", { nofn: false }));
      mergeLine.appendChild(document.createTextNode(" of "));
      mergeLine.appendChild(num(f.prs_total, "count"));
      mergeLine.appendChild(document.createTextNode(" referenced pull requests confirmed merged"));
      if (f.sample_merged_prs.length) {
        mergeLine.appendChild(document.createTextNode(", for example "));
        f.sample_merged_prs.forEach((pr, i) => {
          if (i) mergeLine.appendChild(document.createTextNode(", "));
          mergeLine.appendChild(safeLink(`pull request ${pr.ref}`, pr.url));
        });
      }
      mergeLine.appendChild(document.createTextNode("."));
      li.appendChild(mergeLine);
      if (f.verification === "partial") li.appendChild(el("p", "muted", "Not every reference could be checked live against GitHub for this build."));
      else if (f.verification === "unavailable") li.appendChild(el("p", "muted", "Merge status could not be verified for this build."));
      if (f.models.length) li.appendChild(el("p", "muted", `Models: ${f.models.join(", ")}`));
      ol.appendChild(li);
    }
    container.appendChild(ol);
  }

  // -------------------------------------------------------------- waste

  // One meaning, one color: each class and waste draws in its own token
  // (styles.css), the same on every chart (F.SEGMENTS).
  const SEGMENT_BY_KEY = new Map(F.SEGMENTS.map((x) => [x.key, x]));
  function segmentColor(key) {
    const seg = SEGMENT_BY_KEY.get(key);
    return seg ? `var(${seg.token})` : "var(--c-waste-unknown)";
  }

  // ------------------------------------------------------------ outcomes
  // Sign-off, first-pass yield, rework and attention, each a stated number
  // from the reports. An acceptance is the operator's word, as the agent recorded it.

  const REFUSAL_WORD = {
    not_what_was_asked: "not what was asked",
    defect: "a defect",
    changed_ask: "the ask changed",
    incomplete: "incomplete",
    other: "another reason",
  };
  const CATCH_WORD = { in_task: "inside the task", at_review: "at review", after_delivery: "after delivery" };
  const RETURN_WORD = { agent_error: "agent error", changed_ask: "changed ask", new_information: "new information", external: "external" };

  function figure(dl, label, number, kind) {
    row(dl, label, num(number, kind || "count"));
  }

  function renderOutcomes(container, o, taskCount) {
    container.innerHTML = "";
    if (!o || !o.signoff) {
      emptyState(container, "Sign-off is not part of this build's data.");
      return;
    }
    // The cost per accepted outcome is the page's headline, shown once, above;
    // this section holds what it rests on.
    // What the jobs counted here are, beside the site's tasks (A1 I5).
    const words = F.signoffWords(o, taskCount);
    if (words.scope) container.appendChild(el("p", "stat-note", words.scope));
    const grid = el("div", "outcome-tiles");
    container.appendChild(grid);

    const so = el("div", "outcome-block");
    so.appendChild(el("h4", null, "Sign-off"));
    const dl = el("dl", "health-facts");
    figure(dl, "Accepted (recorded by the agent on the operator's word)", o.signoff.accepted);
    const waiting = el("span");
    waiting.appendChild(num(o.unsigned, "count"));
    if (o.oldest_unsigned_wait.state !== "unavailable") {
      waiting.appendChild(document.createTextNode(" \u00b7 longest: "));
      waiting.appendChild(num(o.oldest_unsigned_wait, "text"));
    }
    row(dl, "Delivered, awaiting an answer", waiting);
    const refused = el("span");
    refused.appendChild(num(o.signoff.refused, "count"));
    if (o.refusal_reasons.length) {
      refused.appendChild(document.createTextNode(" \u00b7 "));
      o.refusal_reasons.forEach((r, i) => {
        if (i) refused.appendChild(document.createTextNode(", "));
        refused.appendChild(num(r.jobs, "count"));
        refused.appendChild(document.createTextNode(` ${REFUSAL_WORD[r.reason] || r.reason}`));
      });
    }
    row(dl, "Sent back", refused);
    figure(dl, "Delivered before sign-off was recorded", o.signoff.not_recorded);
    figure(dl, "Jobs with no sign-off record", o.signoff.no_record);
    figure(dl, "Operator turns per accepted outcome", o.attention.turns_per_accepted);
    so.appendChild(dl);
    grid.appendChild(so);

    const fp = el("div", "outcome-block");
    fp.appendChild(el("h4", null, "First-pass yield"));
    const fv = el("p", "big-figure");
    fv.appendChild(num(o.first_pass_yield, "pct"));
    fp.appendChild(fv);
    if (words.yieldNote) fp.appendChild(el("p", "stat-note", words.yieldNote));
    // The counts the percentage is computed from, so a reader can rebuild it.
    const c = o.first_pass_counts;
    if (c.passed.state === "measured" && c.counted.state === "measured" && c.final.state === "measured") {
      const how = el("p", "stat-note");
      how.textContent = `${c.passed.value} of ${c.counted.value} delivered jobs with a verdict passed first time so far; ${c.final.value} of those ${c.counted.value} verdicts are final.`;
      fp.appendChild(how);
    }
    const fdl = el("dl", "health-facts");
    figure(fdl, "Passed first time (so far)", o.first_pass_counts.passed);
    figure(fdl, "Sent back at least once", o.first_pass_counts.returned);
    figure(fdl, "Passed, with only changed-ask returns", o.first_pass_counts.changed_ask_only);
    fp.appendChild(fdl);
    grid.appendChild(fp);

    const rw = el("div", "outcome-block");
    rw.appendChild(el("h4", null, "What was sent back, and where it was caught"));
    const rdl = el("dl", "health-facts");
    for (const r of o.rework.returns) {
      const node = el("span");
      node.appendChild(num(r.total, "count"));
      if (r.total.state !== "unavailable") {
        const parts = Object.entries(r.by_reason).filter(([, n]) => n.state === "measured" && n.value > 0);
        if (parts.length) {
          node.appendChild(document.createTextNode(" \u00b7 "));
          parts.forEach(([k, n], i) => {
            if (i) node.appendChild(document.createTextNode(", "));
            node.appendChild(num(n, "count"));
            node.appendChild(document.createTextNode(` ${RETURN_WORD[k] || k}`));
          });
        }
      }
      row(rdl, `Caught ${CATCH_WORD[r.caught] || r.caught}`, node);
    }
    figure(rdl, "Returns because the ask changed (not counted against yield)", o.rework.changed_ask);
    const check = el("span");
    check.appendChild(num(o.rework.reason_check.disagree, "count"));
    if (o.rework.reason_check.compared.state !== "unavailable") {
      check.appendChild(document.createTextNode(" of "));
      check.appendChild(num(o.rework.reason_check.compared, "count"));
      check.appendChild(document.createTextNode(" refusals"));
    }
    row(rdl, "Agent's and human's reasons disagreed", check);
    figure(rdl, "Defect time caught inside the task", o.rework.defects.in_task_ms, "duration");
    figure(rdl, "Defect time with no catch point", o.rework.defects.not_placed_ms, "duration");
    rw.appendChild(rdl);
    container.appendChild(rw);
  }

  // --------------------------------------------------------------- jobs

  // --------------------------------------------------------- task names
  // Private desks publish only anonymous job keys. On the operator's own
  // machine a `local-names.json` beside the page may name them (format.js
  // parseLocalNames). The public page never asks for it (servesLocalNames). A
  // missing, slow or malformed file is the public view, silently: the fetch
  // gives up after a second.

  let localNames = {};
  // What to do about each kind of waste, from the build (fix-next.mjs).
  let wasteActions = {};

  async function loadLocalNames() {
    if (!F.servesLocalNames(location.hostname)) return;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 1000) : null;
    try {
      const res = await fetch("./local-names.json", { cache: "no-store", ...(ctrl ? { signal: ctrl.signal } : {}) });
      if (res.ok) localNames = F.parseLocalNames(await res.json());
    } catch (err) {
      localNames = {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const localName = (id) => (Object.prototype.hasOwnProperty.call(localNames, id) ? localNames[id] : null);

  // A link to one task's page, #/task/<key>.
  function jobLink(id, text) {
    const a = document.createElement("a");
    const safe = F.safeRoute("task", id);
    if (safe) a.href = safe;
    a.textContent = text;
    return a;
  }

  // A task's name as text: its public pull request title "and N more", or
  // "Private task" and a short key (format.js taskName).
  const jobLabel = (j) => F.taskNameText(localNames, j);

  // A figure in a dense table or a list: "partial" beside it, its reason in
  // the title and in the table's one note; no "declared" chip.
  function cellNum(number, kind) {
    return num(number, kind, { reason: false, nofn: false, flag: "short", basis: false });
  }

  // --------------------------------------------------------------- tasks

  const OUTCOME_WORD = {
    accepted: "Accepted",
    sent_back: "Sent back",
    awaiting_signoff: "Waiting for an answer",
    delivered: "Delivered, no sign-off",
    in_progress: "In progress",
    cancelled: "Cancelled",
    unknown: "Status not recorded",
  };
  const OUTCOME_COLOR = {
    accepted: "var(--status-good)",
    sent_back: "var(--status-critical)",
    awaiting_signoff: "var(--status-warning)",
    delivered: "var(--series-1)",
    in_progress: "var(--text-muted)",
    cancelled: "var(--text-muted)",
    unknown: "var(--text-muted)",
  };

  function outcomeNode(j) {
    const span = el("span", "outcome");
    const dot = el("span", "status-dot");
    dot.style.background = OUTCOME_COLOR[j.outcome] || "var(--text-muted)";
    span.appendChild(dot);
    let word = OUTCOME_WORD[j.outcome] || "Status not recorded";
    if (j.outcome === "in_progress" && j.status !== "unavailable") word += ` (${j.status})`;
    span.appendChild(document.createTextNode(word));
    return span;
  }

  // The task's largest labeled waste, or why there is none.
  function topWasteNode(j) {
    const rows = (j.waste && j.waste.rows) || [];
    const top = rows.find((r) => r.kind === "waste" || r.kind === "unknown");
    if (!top) return el("span", "muted", rows.length ? "none labeled" : "not labeled yet");
    const span = el("span", "top-waste");
    const seg = SEGMENT_BY_KEY.get(top.key);
    const sw = el("span", "swatch");
    sw.style.setProperty("--sw", segmentColor(top.key));
    span.appendChild(sw);
    span.appendChild(document.createTextNode(`${seg ? seg.label : wasteName(top.key)} `));
    span.appendChild(cellNum(top.total_ms, "duration"));
    return span;
  }

  // A dense table says "no data" or "partial" in each cell and gives the
  // reasons once, under the table, per column.
  function tableCell(tr, notes, label, number, kind, cls) {
    const td = el("td", cls);
    td.dataset.label = label;
    td.appendChild(cellNum(number, kind));
    if (number.state !== "measured") {
      const why = F.describe(number, kind).reason;
      const what = number.state === "partial" ? `${label} (partial)` : label;
      const key = `${what}\u0000${why}`;
      notes.set(key, { label: what, why, count: (notes.get(key) || { count: 0 }).count + 1 });
    }
    tr.appendChild(td);
  }

  function tableNotes(container, notes, noun) {
    if (!notes.size) return;
    const box = el("details", "table-notes");
    box.appendChild(el("summary", "table-notes-head", "Why some cells say no data or partial"));
    const ul = el("ul");
    for (const n of notes.values()) ul.appendChild(el("li", null, `${n.label}, ${n.count === 1 ? `one ${noun}` : `${n.count} ${noun}s`}: ${n.why}.`));
    box.appendChild(ul);
    container.appendChild(box);
  }

  function plainCell(tr, label, node, cls) {
    const td = el("td", cls);
    td.dataset.label = label;
    td.appendChild(node);
    tr.appendChild(td);
  }

  function tableHead(table, cols) {
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const [c, cls] of cols) {
      const th = el("th", cls, c);
      th.scope = "col";
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
  }

  // Tasks in finish order, the one that finished last first; tasks with no
  // position (no facts at all) last.
  function byFinishDesc(jobs) {
    const pos = (j) => (j.finish_order && j.finish_order.state === "measured" ? j.finish_order.value : -1);
    return [...jobs].sort((a, b) => pos(b) - pos(a));
  }

  function renderJobsTable(container, jobs) {
    container.innerHTML = "";
    if (!jobs.length) {
      emptyState(container, "No jobs tracked yet.");
      return;
    }
    const table = el("table", "data-table task-table");
    tableHead(table, [["Finish order", "num"], ["Finished (UTC)", ""], ["Task", ""], ["Status", ""], ["Elapsed", "num"], ["Working time", "num"], ["Operator turns", "num"], ["Sent back", "num"], ["Largest waste", ""], ["Public PRs", "num"]]);
    const tbody = document.createElement("tbody");
    const notes = new Map();
    for (const j of byFinishDesc(jobs)) {
      const tr = document.createElement("tr");
      const pos = F.finishCell(j);
      plainCell(tr, "Finish order", el("span", j.finish_basis === "labels" ? "finish-pos" : "finish-pos muted", pos), "num");
      const fday = F.finishDay(j.finish_date);
      plainCell(tr, "Finished (UTC)", el("span", fday.day ? "finish-day" : "finish-day muted", fday.kind === "open" ? "open" : fday.words));
      const name = el("span", "task-name");
      name.appendChild(jobLink(j.id, jobLabel(j)));
      plainCell(tr, "Task", name, "task-cell");
      plainCell(tr, "Status", outcomeNode(j));
      tableCell(tr, notes, "Elapsed", j.lead_time_ms, "duration", "num");
      tableCell(tr, notes, "Working time", j.active_time_ms, "duration", "num");
      tableCell(tr, notes, "Operator turns", j.human_turns, "count", "num");
      tableCell(tr, notes, "Sent back", j.returns, "count", "num");
      plainCell(tr, "Largest waste", topWasteNode(j));
      tableCell(tr, notes, "Public PRs", j.public_prs, "count", "num");
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
    tableNotes(container, notes, "task");
  }

  // ------------------------------------------------------------ the band
  // The answer and the factory's health in one band: one status line, the
  // headline, and one line of counts.

  function words(...parts) {
    const span = el("span");
    for (const p of parts) span.appendChild(typeof p === "string" ? document.createTextNode(p) : p);
    return span;
  }

  // The status line under the tabs: abnormal, normal or not monitored
  // (format.js statusLine). Normal is quiet; abnormal is loud and names each
  // alarm with who is on it, or says no one is; not monitored says what is
  // not recorded, so no data never reads as normal.
  const STATUS_WORD = { abnormal: "Abnormal", normal: "Normal", not_monitored: "Not monitored" };
  const STATUS_MARK = { abnormal: "\u25a0", normal: "\u25cf", not_monitored: "\u25cb" };

  function listWords(xs) {
    if (xs.length <= 1) return xs.join("");
    return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  }

  function renderStatusLine(container, data, health) {
    container.innerHTML = "";
    let verdict;
    try {
      verdict = F.pageVerdict(health, Date.now());
    } catch (err) {
      verdict = { status: "unknown", reason: "the health record could not be read, so health cannot be told" };
    }
    const s = F.statusLine({ verdict, andon: data.andon_issues, andonVerification: data.andon_verification, capture: data.capture_coverage, loop: data.loop_health, fixNext: data.fix_next, alarmIssues: data.alarm_issues, alarmIssuesVerification: data.alarm_issues_verification });
    container.className = `status-line status-${s.state}`;
    // One line: the state, what each alarm is about (each word linked to its
    // glossary entry) and whether anyone is on it; the full text sits behind
    // "Health details".
    const line = el("span", "status-summary");
    line.appendChild(el("strong", "status-word", `${STATUS_MARK[s.state]} ${STATUS_WORD[s.state]}`));
    line.appendChild(document.createTextNode(": "));
    if (s.state === "abnormal") {
      const topics = [];
      for (const a of s.alarms) {
        const t = statusTopic(a.key);
        if (!topics.some((x) => x.term === t.term && x.text === t.text)) topics.push(t);
      }
      topics.forEach((t, i) => {
        if (i) line.appendChild(document.createTextNode(i === topics.length - 1 ? " and " : ", "));
        if (t.term) {
          const a = el("a", "status-term", t.text);
          const safe = F.glossaryRoute(t.term);
          if (safe) a.href = safe;
          line.appendChild(a);
        } else line.appendChild(document.createTextNode(t.text));
      });
      const unowned = s.alarms.filter((a) => !a.owner).length;
      line.appendChild(document.createTextNode(` (${s.alarms.length === 1 ? "1 alarm" : `${s.alarms.length} alarms`}${unowned === s.alarms.length ? `, ${unowned === 1 ? "no one is on it" : "no one is on them"}` : unowned ? `, ${unowned} with no one on ${unowned === 1 ? "it" : "them"}` : ", each with an owner"}). `));
    } else if (s.state === "normal") {
      line.appendChild(document.createTextNode("no alarm. "));
    } else {
      line.appendChild(document.createTextNode("no alarm, but not everything is watched. "));
    }
    container.appendChild(line);
    const det = el("details", "status-details");
    det.appendChild(el("summary", null, "Health details"));
    const body = el("p", "status-full");
    if (s.state === "abnormal") {
      s.alarms.forEach((a, i) => {
        if (i) body.appendChild(document.createTextNode("; "));
        body.appendChild(document.createTextNode(`${a.text.charAt(0).toUpperCase()}${a.text.slice(1)}, `));
        if (a.owner) {
          body.appendChild(document.createTextNode("tracked in "));
          body.appendChild(safeLink(`issue ${a.owner.ref}`, a.owner.url));
        } else body.appendChild(el("span", a.ownerText === "no one is on this" ? "status-owner" : "status-owner status-owner-unchecked", a.ownerText || "no one is on this"));
      });
      body.appendChild(document.createTextNode(". "));
    } else if (s.state === "normal") {
      body.appendChild(document.createTextNode(`Checked ${listWords(s.checked)}. `));
    } else {
      body.appendChild(document.createTextNode(`Not recorded: ${listWords(s.missing)}.${s.checked.length ? ` Checked: ${listWords(s.checked)}.` : ""} `));
    }
    const more = document.createElement("a");
    const safe = F.safeRoute("store");
    if (safe) more.href = safe;
    more.textContent = "The store's own health, in full";
    body.appendChild(more);
    det.appendChild(body);
    container.appendChild(det);
  }

  // What an alarm is about, in the status line's one line, and the glossary
  // entry that defines it.
  function statusTopic(key) {
    const k = String(key || "");
    if (k.startsWith("capture:") || k === "capture_alarm") return { text: "capture coverage", term: "capture-coverage" };
    if (k.startsWith("loop:") || k === "loop_alarm") return { text: "the improvement loop", term: "improvement-loop" };
    if (k === "andon") return { text: "andon", term: "andon" };
    if (k === "site") return { text: "the site's data", term: null };
    return { text: "an alarm", term: null };
  }

  // A headline figure as plain text: its label, the figure, and its notes.
  function headlineTile(container, label, valueNode, notes) {
    const t = el("div", "answer-line");
    t.appendChild(el("p", "answer-label", label));
    const v = el("p", "big-figure");
    v.appendChild(valueNode);
    t.appendChild(v);
    for (const n of notes) t.appendChild(n);
    container.appendChild(t);
  }

  function note(cls, ...parts) {
    const p = el("p", cls);
    for (const x of parts) p.appendChild(typeof x === "string" ? document.createTextNode(x) : x);
    return p;
  }

  function renderAnswer(container, o) {
    container.innerHTML = "";
    const h = o.attention.headline;
    const noneAccepted = o.signoff.accepted.state === "measured" && o.signoff.accepted.value === 0;
    const row = el("div", "answer-lines");
    if (h.state !== "unavailable") {
      headlineTile(row, "Operator attention per accepted outcome", num(h, "duration", { nofn: false }), [
        note("stat-note", "An estimate of the operator's reading and answering time, over the outcomes accepted. Attention spent on work sent back or still waiting stays in the cost."),
        note("stat-trust", trustNode(o.attention.trust)),
      ]);
    } else if (noneAccepted) {
      // No acceptance yet: say so, and answer per delivered task meanwhile.
      headlineTile(row, "Operator attention per accepted outcome", el("span", "num num-unavailable", "none accepted yet"), [
        note("stat-note", "The first acceptance is recorded when the operator answers a delivery."),
      ]);
      const d = o.attention.per_delivered;
      if (d) {
        headlineTile(row, "Operator attention per delivered task", num(d, "duration", { nofn: false, flag: "short" }), [
          note("stat-note", "The interim measure until acceptances exist: the same attention estimate, averaged over delivered tasks instead of accepted ones."),
          ...(d.state === "unavailable" ? [] : [note("stat-note", `Rests on ${d.n} of ${d.N} delivered tasks; the others have no whole attention estimate yet, so the true average could be higher or lower.`)]),
        ]);
      }
    } else {
      const fix = document.createElement("a");
      const safe = F.safeRoute("causes");
      if (safe) fix.href = safe;
      fix.textContent = "What unblocks it";
      headlineTile(row, "Operator attention per accepted outcome", el("span", "num num-unavailable", "no data"), [
        note("stat-note", `Not computed yet: ${F.describe(h, "duration").reason}. `, fix),
      ]);
    }
    container.appendChild(row);
  }

  // ------------------------------------------------------------- trend
  // Only the columns where at least one release has data.

  function renderTrend(container, trend) {
    container.innerHTML = "";
    const cols = [
      ["Accepted", "accepted", "count"],
      ["Sent back", "sent_back", "count"],
      ["First-pass yield", "first_pass_yield", "pct"],
      ["Attention per accepted", "attention", "duration"],
      ["Flow efficiency (median)", "flow_efficiency", "pct"],
    // A column every release leaves empty, or zero throughout, says nothing per release.
    ].filter(([, key]) => (trend || []).some((r) => r[key].state !== "unavailable" && r[key].value !== 0));
    // Only the releases with a figure in a shown column.
    const rowsWithData = (trend || []).filter((r) => cols.some(([, key]) => r[key].state !== "unavailable"));
    if (!rowsWithData.length || !cols.length) {
      container.appendChild(el("p", "chart-empty", "The trend fills in once sign-offs are recorded."));
      return;
    }
    const table = el("table", "data-table task-table trend-table");
    tableHead(table, [["Desk release", ""], ["Tasks", "num"], ...cols.map(([c]) => [c, "num"])]);
    const tbody = document.createElement("tbody");
    const notes = new Map();
    for (const r of rowsWithData) {
      const tr = document.createElement("tr");
      plainCell(tr, "Desk release", el("span", "task-name", r.version === "mixed" ? "several releases" : r.version), "task-cell");
      tableCell(tr, notes, "Tasks", r.jobs, "count", "num");
      for (const [label, key, kind] of cols) tableCell(tr, notes, label, r[key], kind, "num");
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
    tableNotes(container, notes, "release");
    const left = trend.length - rowsWithData.length;
    if (cols.length < 5 || left) container.appendChild(el("p", "chart-caption", `Only columns with a figure other than zero are shown${left ? `, and ${left} releases with no figure yet are left out` : ""}. Accepted, sent back, yield and attention appear once a release has an answered delivery.`));
  }

  // ------------------------------------------------------------ task page
  // One task: what it is, where it stands, what it cost, its waste with
  // confidence, its pull requests and its sessions. Its address is
  // #job-<key>, so a task page can be linked.

  // Which entry of data.scopes each captioned section reads.
  const SCOPE_OF = { headlines: "headlines", tool_calls: "tool_kinds", tool_failures: "tool_kinds", models: "models", subagents: "subagents", harnesses: "harnesses" };

  const STATE_WORD = { measured: "measured", partial: "partial", unavailable: "no data" };
  const JOB_ID = /^[0-9A-Za-z_-]{1,64}$/;

  function idFromHash(prefix) {
    const m = new RegExp(`^#${prefix}-(.+)$`).exec(window.location.hash || "");
    return m && JOB_ID.test(m[1]) ? m[1] : null;
  }

  function confidenceWords(r) {
    const c = r.confidence || {};
    if (!c.high_ms || c.high_ms.state === "unavailable") return "confidence not recorded";
    const parts = ["high", "medium", "low"].filter((k) => c[`${k}_ms`].value > 0);
    return parts.length ? `confidence: ${parts.join(", ")}` : "confidence: none recorded";
  }

  // One figure in a plain row of facts: its label, the figure and a short
  // note on what it counts. No boxes: none of these is clickable.
  function tile(container, label, valueNode, notes) {
    const t = el("div", "fact");
    t.appendChild(el("dt", null, label));
    const v = el("dd", "fact-value");
    v.appendChild(valueNode);
    t.appendChild(v);
    for (const n of notes) {
      const p = el("dd", "fact-note");
      p.appendChild(typeof n === "string" ? document.createTextNode(n) : n);
      t.appendChild(p);
    }
    container.appendChild(t);
    return t;
  }

  function detailsTable(j) {
    const table = el("table", "data-table job-detail-table");
    tableHead(table, [["Measure", ""], ["Figure", "num"], ["State", ""], ["Why", ""]]);
    const tbody = document.createElement("tbody");
    for (const d of j.details || []) {
      const tr = document.createElement("tr");
      tr.className = `state-row state-row-${d.number.state}`;
      tr.appendChild(el("td", null, d.label));
      const figure = F.describe(d.number, d.kind);
      const fig = el("td", `num num-${figure.state}`);
      fig.appendChild(el("span", "num-value", figure.text));
      tr.appendChild(fig);
      const st = el("td");
      st.appendChild(el("span", `state-word state-${d.number.state}`, STATE_WORD[d.number.state]));
      tr.appendChild(st);
      const why = figure.state === "measured" ? (figure.basis === "declared" ? "taken from the task card, not measured from a session" : figure.basis === "inferred" ? "computed from other measures" : "") : figure.reason;
      tr.appendChild(el("td", "state-why", why));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const wrap = el("div", "table-wrap");
    wrap.appendChild(table);
    return wrap;
  }

  // Where a task sits in finish order, in words.
  function finishWords(j, jobs) {
    return F.finishWords(j, jobs);
  }

  // The task's name, key, place in finish order and status: the head of step 1.
  function renderTaskHead(container, jobs, id) {
    container.innerHTML = "";
    const j = id ? jobs.find((x) => x.id === id) : null;
    if (!j) {
      container.appendChild(el("h1", "view-title", "Task not found"));
      container.appendChild(el("p", "lede", "No task in this build has that key. It may have been re-derived or withdrawn. Pick another task above, or see every task under Compare tasks."));
      return null;
    }
    const name = localName(j.id);
    const tn = F.taskName(localNames, j);
    const h = el("h1", "view-title task-title", tn.title);
    if (tn.more) h.appendChild(el("span", "task-more", ` and ${tn.more} more pull request${tn.more === 1 ? "" : "s"}`));
    container.appendChild(h);
    const where = [name && name.track, name && name.task].filter(Boolean).join(" / ");
    const keyLine = tn.kind === "local"
      ? `${where ? `${where} · ` : ""}key ${j.id}`
      : tn.kind === "public"
        ? tn.partial
          ? `Named after the earliest-opened of the public pull requests that could be read; some could not be read for this build, so an earlier one may exist. Task key ${j.id}.`
          : `Named after its earliest-opened public pull request. Task key ${j.id}.`
        : tn.kind === "unnamed"
          ? `Its pull requests' titles could not be read for this build. Task key ${j.id}.`
          : `No public pull request names this task, so it stays private. Task key ${j.id}.`;
    container.appendChild(el("p", "task-key", `${keyLine} ${finishWords(j, jobs)}`));

    // One line on sign-off (the operator's recorded acceptance or return of
    // a delivery): the outcome says it, and a sign-off figure is added only
    // when one is recorded.
    const status = el("p", "task-status");
    status.appendChild(outcomeNode(j));
    if (j.signoff.state === "unavailable") status.appendChild(el("span", "muted", ` (sign-off is the operator's recorded acceptance or return of a delivery; ${F.describe(j.signoff, "text").reason})`));
    else {
      status.appendChild(document.createTextNode(" · sign-off: "));
      status.appendChild(cellNum(j.signoff, "text"));
    }
    if (j.outcome === "accepted" || j.outcome === "sent_back") status.appendChild(el("span", "muted", " (recorded by the agent on the operator's word)"));
    if (j.signoff_wait.state !== "unavailable") {
      status.appendChild(document.createTextNode(" · "));
      status.appendChild(cellNum(j.signoff_wait, "text"));
    }
    container.appendChild(status);
    return j;
  }

  // The labeled time the store's own report holds for a task (data.json),
  // shown under "Where this task's time went" only when the walk's
  // stack-up file is not published.
  function renderStoreWaste(waste, j) {
    const rows = (j.waste && j.waste.rows) || [];
    const cap = el("p", "chart-caption");
    cap.appendChild(document.createTextNode("Labeled by the independent waste evaluator: "));
    cap.appendChild(cellNum(j.waste ? j.waste.sessions_labeled : { state: "unavailable", reasons: ["not_labeled"] }, "count"));
    cap.appendChild(document.createTextNode(" of the "));
    cap.appendChild(cellNum(j.waste ? j.waste.sessions_on_timeline : { state: "unavailable", reasons: ["not_labeled"] }, "count"));
    cap.appendChild(document.createTextNode(" sessions on this task's timeline. Labeled time covers this task's own part of each session's clock (the stretches the session's facts give to this task), including waiting on CI, tools and the operator. Where several tasks hold the same stretch, each of them counts it here."));
    waste.appendChild(cap);
    const shareUnknown = j.waste && j.waste.sessions_share_unknown && j.waste.sessions_share_unknown.state === "measured" ? j.waste.sessions_share_unknown.value : 0;
    if (shareUnknown > 0) {
      waste.appendChild(el("p", "chart-caption", `For ${shareUnknown === 1 ? "1 labeled session" : `${shareUnknown} labeled sessions`}, the session's facts do not record which part was this task's, so those labels are not counted here.`));
    }
    if (j.waste && j.waste.foreign_sessions && j.waste.foreign_sessions.value > 0) {
      waste.appendChild(el("p", "fix-action", "Data defect: some labels filed under this task name sessions that are not on its timeline. They are not counted here."));
    }
    if (!rows.length && shareUnknown > 0 && j.waste.sessions_labeled.value === shareUnknown) {
      waste.appendChild(el("p", "chart-empty", "No labeled time can be counted for this task, so its waste is no data, not zero: the facts of its labeled sessions do not record which part was this task's. Running the evaluator again will not change that."));
    } else if (!rows.length) {
      waste.appendChild(el("p", "chart-empty", "Not labeled yet, so this task's waste is no data, not zero. Do: run the waste evaluator on this task's sessions."));
    } else {
      const barRows = rows.map((r) => ({
        label: wasteName(r.key),
        flag: r.kind === "value" || r.kind === "support" ? "" : confidenceWords(r),
        color: segmentColor(r.key),
        number: r.total_ms,
      }));
      const bars = el("div");
      renderBarList(bars, barRows, { kind: "duration", flag: "short", title: "Labeled time by class and waste", titleTag: "h3" });
      waste.appendChild(bars);
      const top = rows.find((r) => r.kind === "waste" || r.kind === "unknown");
      if (top) {
        const p = el("p", "fix-action task-do");
        p.appendChild(el("span", "fix-do", "Do: "));
        p.appendChild(document.createTextNode(wasteActions[top.key] || "Look at the labeled stretches and remove the cause."));
        waste.appendChild(p);
      }
    }
  }

  function renderJobDetail(container, jobs, id, sessions) {
    container.innerHTML = "";
    const j = id ? jobs.find((x) => x.id === id) : null;
    if (!j) return;
    // Pull requests.
    const prs = el("section", "block");
    prs.appendChild(el("h2", "block-title", "Pull requests"));
    const prLine = el("p", "chart-caption");
    prLine.appendChild(document.createTextNode("Public pull requests that first appeared in the task's sessions (opened or mentioned): "));
    prLine.appendChild(cellNum(j.public_prs, "count"));
    prs.appendChild(prLine);
    if (j.pull_requests.length) {
      const ul = el("ul", "pr-list");
      for (const p of j.pull_requests) {
        const li = document.createElement("li");
        li.appendChild(safeLink(`pull request ${p.ref}`, p.url));
        ul.appendChild(li);
      }
      prs.appendChild(ul);
    }
    container.appendChild(prs);

    // Sessions.
    const ses = el("section", "block");
    ses.appendChild(el("h2", "block-title", "Sessions"));
    const byId = new Map((sessions || []).map((s) => [s.session_id, s]));
    if (!j.sessions.length) {
      ses.appendChild(el("p", "chart-empty", "No session is on this task's timeline."));
    } else {
      const table = el("table", "data-table task-table");
      tableHead(table, [["Session", ""], ["Length", "num"], ["Working time", "num"], ["Tool calls", "num"], ["Failed calls", "num"], ["Subagents", "num"]]);
      const tbody = document.createElement("tbody");
      const notes = new Map();
      const none = { state: "unavailable", reasons: ["facts_missing"] };
      for (const s of j.sessions) {
        const f = byId.get(s.session_id);
        const tr = document.createElement("tr");
        const link = document.createElement("a");
        const safe = F.safeRoute("task", j.id, "session", s.session_id);
        if (safe) link.href = safe;
        link.textContent = `${s.host} · ${s.session_id.slice(0, 8)}`;
        // A session that worked several tasks: its figures are the whole
        // session's, not this task's part, and the row says so.
        const others = f && Array.isArray(f.jobs) ? f.jobs.filter((x) => x && x.id !== j.id).length : 0;
        const cellNode = others ? words(link, el("span", "session-shared", ` shared with ${others} other task${others === 1 ? "" : "s"}; these figures are the whole session's`)) : link;
        plainCell(tr, "Session", cellNode, "task-cell");
        tableCell(tr, notes, "Length", f ? f.duration_ms : none, "duration", "num");
        tableCell(tr, notes, "Working time", f ? f.active_ms : none, "duration", "num");
        tableCell(tr, notes, "Tool calls", f ? f.tool_calls_total : none, "count", "num");
        tableCell(tr, notes, "Failed calls", f ? f.tool_failures_total : none, "count", "num");
        tableCell(tr, notes, "Subagents", f ? f.subagent_count : none, "count", "num");
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      ses.appendChild(table);
      tableNotes(ses, notes, "session");
    }
    container.appendChild(ses);

    const all = el("details", "more-details");
    all.appendChild(el("summary", null, "Every measure, with its state and reason"));
    all.appendChild(
      el(
        "p",
        "chart-caption",
        `Every measure the store's report holds for this task. "Measured" is the whole figure, and a zero here is a measured zero. "Partial" covers only part of the task ("at least" or "at most" says which way the true figure lies, when that is known). "No data" means the store could not measure it.`,
      ),
    );
    all.appendChild(detailsTable(j));
    const report = el("p", "chart-caption");
    report.appendChild(safeLink("The task's full report on the reports branch", `https://github.com/ourostack/factory/blob/reports/jobs/${j.id}.md`));
    all.appendChild(report);
    container.appendChild(all);
  }

  // --------------------------------------------------------- session page

  function renderSessionDetail(container, sessions, jobs, id, jobId) {
    container.innerHTML = "";
    const back = el("p", "back-link");
    const parent = jobId ? jobs.find((x) => x.id === jobId) : null;
    if (parent) {
      back.appendChild(document.createTextNode("\u2190 "));
      back.appendChild(jobLink(parent.id, jobLabel(parent)));
    } else {
      const a = document.createElement("a");
      const safe = F.safeRoute("compare");
      if (safe) a.href = safe;
      a.textContent = "\u2190 Every task";
      back.appendChild(a);
    }
    container.appendChild(back);
    const s = id ? (sessions || []).find((x) => x.session_id === id) : null;
    if (!s) {
      container.appendChild(el("h1", "view-title", "Session not found"));
      container.appendChild(el("p", "lede", "This build has no published facts for that session."));
      return;
    }
    container.appendChild(el("h1", "view-title", `Session ${s.session_id.slice(0, 8)}`));
    container.appendChild(el("p", "task-key", `${s.host} · ${s.entrypoint} · ${s.session_id}`));
    const tiles = el("dl", "facts-row");
    const fig = (n, kind) => num(n, kind, { nofn: false, flag: "short", reason: false });
    tile(tiles, "Length", fig(s.duration_ms, "duration"), ["from the session's first record to its last"]);
    tile(tiles, "Working time", fig(s.active_ms, "duration"), ["agents busy: turns, tools and subagents, waits excluded"]);
    tile(tiles, "Tool calls", fig(s.tool_calls_total, "count"), [words("failed: ", fig(s.tool_failures_total, "count"))]);
    tile(tiles, "Subagents", fig(s.subagent_count, "count"), [s.models.length ? `models: ${s.models.join(", ")}` : "models: none recorded"]);
    container.appendChild(tiles);
    const partly = [s.duration_ms, s.active_ms, s.tool_calls_total, s.tool_failures_total, s.subagent_count].filter((n) => n.state !== "measured");
    if (partly.length) container.appendChild(el("p", "chart-caption", `Why some figures say no data or partial: ${[...new Set(partly.map((n) => F.describe(n, "count").reason))].join("; ")}.`));
    const card = el("section", "block");
    card.appendChild(el("h2", "block-title", "Tasks this session worked on"));
    const ul = el("ul", "pr-list");
    for (const ref of s.jobs) {
      const li = document.createElement("li");
      const j = jobs.find((x) => x.id === ref.id);
      if (j) li.appendChild(jobLink(ref.id, jobLabel(j)));
      else li.appendChild(document.createTextNode(`${F.jobLabel(localNames, ref.id)} (no report in this build)`));
      ul.appendChild(li);
    }
    card.appendChild(ul);
    const raw = el("p", "chart-caption");
    raw.appendChild(safeLink("The session's published facts file", s.facts_url));
    card.appendChild(raw);
    container.appendChild(card);
  }

  // ------------------------------------------------------- step 1: the walk
  // "Follow a task" (design section 4): the lede, the task picker, the value
  // stream map with its timeline ladder, where the task's time went, the
  // session swimlane and the evidence drawer. The rules live in walk.js
  // (FactoryWalk); this part only draws what it returns. The walk's files
  // load on demand: rollups/tasks.json and rollups/stackup.json once,
  // map/<job>.json per task, jobs/<job>/<session>.json per swimlane. A file
  // that is not published reads as "not published yet", never as zeros.

  const W = window.FactoryWalk;
  const SECOND_MS = 1000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const walkFiles = new Map();

  // One published file, fetched once. Resolves to null when it is missing or
  // unreadable, so a view can say so instead of failing.
  function walkFile(path) {
    if (!walkFiles.has(path)) {
      walkFiles.set(
        path,
        fetch(`./${path}`, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      );
    }
    return walkFiles.get(path);
  }

  const mapPath = (job) => `map/${job}.json`;
  // A page or data link that stays valid when copied out of the page.
  function absolute(hashOrPath) {
    const base = `${location.origin}${location.pathname}`;
    return hashOrPath.startsWith("#") ? `${base}${hashOrPath}` : new URL(hashOrPath, base).href;
  }

  function svg(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v));
    return e;
  }

  // A segment's fill: its color, or its hatch where the meaning is "not
  // measured work" (format.js SEGMENTS).
  function segmentFill(key, css) {
    const seg = SEGMENT_BY_KEY.get(key);
    if (!seg) return css ? "var(--c-waste-unknown)" : "var(--c-waste-unknown)";
    if (seg.fill === "hatch") return css ? `var(--hatch-${key === "no_session" ? "no-session" : "agents-working"})` : `url(#hatch-${key === "no_session" ? "no-session" : "agents-working"})`;
    if (seg.fill === "outline") return "transparent";
    return `var(${seg.token})`;
  }

  function swatch(key) {
    // The evaluator's labeled wait: the swimlane's cross-hatch, not the solid waiting color.
    if (key === "labeled_wait") {
      const k = el("span", "swatch lane-key lane-key-wait");
      k.setAttribute("aria-hidden", "true");
      return k;
    }
    const seg = SEGMENT_BY_KEY.get(key);
    const sw = el("span", `swatch${seg && seg.fill === "hatch" ? " swatch-hatch" : ""}${seg && seg.fill === "outline" ? " swatch-outline" : ""}`);
    sw.setAttribute("aria-hidden", "true");
    sw.style.setProperty("--sw", seg ? `var(${seg.token})` : "var(--c-waste-unknown)");
    return sw;
  }

  // A waiting cause's swatch: one warm family (styles.css .wait-*), with
  // "cause not recorded" hatched.
  function waitSwatch(cause) {
    const sw = el("span", `swatch swatch-wait wait-${W.WAIT_KEYS.includes(cause) ? cause : "unknown"}`);
    sw.setAttribute("aria-hidden", "true");
    return sw;
  }

  // Why the agent stopped (addendum §4): a class's fill, as a CSS class
  // (styles.css .why-fill-*) or an SVG pattern (index.html why-pat-*), each
  // a color and a pattern, so no class is told by hue alone.
  function whyFill(why, css) {
    const k = W.WHY_KEYS.includes(why) ? why : "not_known";
    return css ? `why-fill-${k}` : `url(#why-pat-${k})`;
  }
  function whySwatch(why) {
    const sw = el("span", `swatch ${whyFill(why, true)}`);
    sw.setAttribute("aria-hidden", "true");
    return sw;
  }
  // A key of the classes drawn: each its swatch and its name.
  function drawWhyLegend(container, keys, cls) {
    const ul = el("ul", cls || "why-key");
    for (const k of keys) {
      const li = document.createElement("li");
      li.append(whySwatch(k), document.createTextNode(W.whyName(k)));
      ul.appendChild(li);
    }
    container.appendChild(ul);
    return ul;
  }

  // ------------------------------------------------------------- the drawer

  const drawerEl = document.getElementById("evidence-drawer");
  const drawerBody = document.getElementById("drawer-body");
  let drawerOpener = null;
  if (drawerEl) {
    document.getElementById("drawer-close").addEventListener("click", () => drawerEl.close());
    drawerEl.addEventListener("close", () => {
      if (drawerOpener && document.contains(drawerOpener)) drawerOpener.focus();
      drawerOpener = null;
    });
    // A click on the backdrop (outside the panel) closes it.
    drawerEl.addEventListener("click", (evt) => {
      if (evt.target === drawerEl) drawerEl.close();
    });
  }

  // Fills the drawer with one thing's content (walk.js drawer) and opens it.
  // `extra` holds links ({ text, href, external }), the prompt ({ what, name,
  // route, dataPath }) and an optional `more(container)` that loads deeper
  // evidence on request.
  // A task's finish day (UTC) as words for a sentence: "finished on or
  // before 6 Oct (UTC)", "still open", or "finished, not dated yet: why".
  // "short" leaves out the sentence's subject and stop.
  function finishSentence(j, form) {
    const f = F.finishDay(j && j.finish_date);
    const what = f.kind === "open" ? "still open" : f.day ? `finished ${f.words.replace(/ \(direction not known\)$/, "")} (UTC${f.kind === "about" ? "; direction not known" : ""})` : `finished, ${f.words}`;
    return form === "short" ? what : `This task ${f.kind === "open" ? "is still open" : what}. `;
  }

  function openDrawer(opener, content, extra) {
    if (!drawerEl) return;
    const x = extra || {};
    if (opener) drawerOpener = opener;
    document.getElementById("drawer-title").textContent = content.title;
    drawerBody.innerHTML = "";
    // Which task this is, and when it finished (UTC), under the title.
    if (x.job) drawerBody.appendChild(el("p", "drawer-task", `${jobLabel(x.job)} · ${finishSentence(x.job, "short")}`));
    const what = el("p", "drawer-what");
    // A wait wears its cause's own swatch, as on the bar, the legend and Rank causes.
    // A wait whose why is known wears its class's swatch.
    what.appendChild(content.mark ? clockGlyph(content.mark, { why: content.why }) : content.why ? whySwatch(content.why) : content.cause ? waitSwatch(content.cause) : swatch(content.segment));
    what.appendChild(document.createTextNode(content.rows.length ? content.rows[0][1] : ""));
    drawerBody.appendChild(what);
    const dl = el("dl", "drawer-facts");
    for (const [label, text] of content.rows.slice(1)) {
      const d = el("div");
      d.appendChild(el("dt", null, label));
      d.appendChild(el("dd", null, text));
      dl.appendChild(d);
    }
    drawerBody.appendChild(dl);
    if (content.evidence && content.evidence.length) {
      drawerBody.appendChild(el("h3", "drawer-sub", `The evidence it rests on (${content.evidence.length} interval${content.evidence.length === 1 ? "" : "s"})`));
      const table = el("table", "data-table drawer-table");
      tableHead(table, [["Kind", ""], ["Tool kind", ""], ["Outcome", ""], ["Lane", ""], ["Length", "num"]]);
      const tb = document.createElement("tbody");
      for (const e of content.evidence.slice(0, 60)) {
        const tr = document.createElement("tr");
        for (const [v, c] of [[e.kind, ""], [e.tool || "—", ""], [e.outcome || "—", e.outcome === "error" || e.outcome === "timeout" ? "drawer-failed" : ""], [e.lane, ""], [e.duration, "num"]]) tr.appendChild(el("td", c, v));
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      const wrap = el("div", "table-wrap");
      wrap.appendChild(table);
      drawerBody.appendChild(wrap);
      if (content.evidence.length > 60) drawerBody.appendChild(el("p", "chart-caption", `The first 60 of ${content.evidence.length} are listed; the data file holds every one.`));
    } else if (content.evidence) {
      // Nothing to list: say so rather than leave a gap.
    }
    if (typeof x.more === "function") {
      const more = el("div", "drawer-more");
      drawerBody.appendChild(more);
      x.more(more);
    }
    if (x.links && x.links.length) {
      const ul = el("ul", "drawer-links");
      for (const l of x.links) {
        const li = document.createElement("li");
        if (l.external) li.appendChild(safeLink(l.text, l.href));
        else {
          const a = el("a", null, l.text);
          // Only an in-page route built by F.safeRoute reaches here.
          const safe = typeof l.href === "string" && /^#\/[0-9A-Za-z_\/-]+$/.test(l.href) ? l.href : null;
          if (safe) a.href = safe;
          a.addEventListener("click", () => drawerEl.close());
          li.appendChild(a);
        }
        ul.appendChild(li);
      }
      drawerBody.appendChild(ul);
    }
    if (x.prompt) {
      const text = W.promptText({ ...x.prompt, route: absolute(x.prompt.route), dataUrl: absolute(x.prompt.dataPath), indexUrl: absolute("llms.txt") });
      const box = el("div", "drawer-prompt");
      const btn = el("button", "copy-prompt", "Copy as a prompt for your agent");
      btn.type = "button";
      const status = el("span", "copy-status");
      status.setAttribute("role", "status");
      const pre = el("p", "prompt-text", text);
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          status.textContent = "Copied.";
        } catch (err) {
          // No clipboard (an insecure page or a refused permission): select the text so it can be copied by hand.
          const range = document.createRange();
          range.selectNodeContents(pre);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          status.textContent = "The prompt is selected; copy it with the keyboard.";
        }
      });
      box.append(btn, status, pre);
      drawerBody.appendChild(box);
    }
    if (!drawerEl.open) drawerEl.showModal();
    drawerBody.scrollTop = 0;
    // When the drawer is refilled from inside, the control that was used is
    // gone; keep the keyboard inside the dialog.
    if (!drawerEl.contains(document.activeElement) || document.activeElement === drawerEl) document.getElementById("drawer-close").focus();
  }

  // ---------------------------------------------------------------- picker

  function renderPicker(container, jobs, taskRows, current) {
    container.innerHTML = "";
    const wrap = el("nav", "picker");
    wrap.setAttribute("aria-label", "Every task");
    const head = el("div", "picker-head");
    const label = el("label", "picker-label", "Find a task");
    const input = el("input", "picker-search");
    input.type = "search";
    input.placeholder = "Name or key";
    input.setAttribute("aria-controls", "picker-list");
    label.appendChild(input);
    head.appendChild(label);
    const count = el("p", "picker-count");
    head.appendChild(count);
    // Sort by finish day (UTC): newest first by default.
    const sortBox = el("div", "picker-sort mode-toggle");
    sortBox.setAttribute("role", "group");
    sortBox.setAttribute("aria-label", "Sort by finish day");
    sortBox.appendChild(el("span", null, "Finished (UTC):"));
    let sortDir = "newest";
    const sortBtns = [["newest", "newest first"], ["oldest", "oldest first"]].map(([dir, text]) => {
      const b = el("button", "mode-btn", text);
      b.type = "button";
      b.setAttribute("aria-pressed", String(dir === sortDir));
      b.addEventListener("click", () => {
        sortDir = dir;
        for (const x of sortBtns) x.setAttribute("aria-pressed", String(x === b));
        draw();
      });
      sortBox.appendChild(b);
      return b;
    });
    head.appendChild(sortBox);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    wrap.appendChild(head);
    const list = el("ul", "picker-list");
    list.id = "picker-list";
    wrap.appendChild(list);
    const fig = (n, kind) => {
      if (!n) return "no data";
      const d = F.describe(n, kind);
      if (d.state === "unavailable") return "no data";
      // A share above zero never reads 0%. A lead time uses the lede's units
      // (hours up to three days) and says "at least" when it is partial.
      return W.statedText(n, "duration");
    };
    const draw = () => {
      const rows = S.sortPicker(W.pickerRows(jobs, taskRows || [], (j) => jobLabel(j), input.value), (id) => F.finishDay(jobById.has(id) ? jobById.get(id).finish_date : null), sortDir);
      list.innerHTML = "";
      count.textContent = `${rows.length} of ${jobs.length} tasks`;
      let group = null;
      for (const r of rows) {
        if (r.group !== group) {
          group = r.group;
          list.appendChild(el("li", "picker-group", group === "finished" ? `Finished, the ${sortDir === "oldest" ? "earliest" : "latest"} first` : "Still open, the latest to start first"));
        }
        const li = document.createElement("li");
        const a = el("a", "picker-row");
        const safe = F.safeRoute("task", r.id);
        if (safe) a.href = safe;
        if (r.id === current) a.setAttribute("aria-current", "page");
        const name = el("span", "picker-name", r.name);
        if (!/\b[0-9a-f]{8}\b/.test(r.name)) name.appendChild(el("span", "picker-key", ` ${r.short}`));
        a.appendChild(name);
        const meta = el("span", "picker-meta");
        meta.appendChild(el("span", null, r.status || "status unknown"));
        if (r.finish && r.finish.kind !== "open") meta.appendChild(el("span", "picker-finish", r.finish.day ? `finished ${r.finish.words}` : r.finish.words));
        meta.appendChild(el("span", null, `lead ${fig(r.lead, "duration")}`));
        meta.appendChild(el("span", null, `flow ${r.feText || "no data"}`));
        if (r.unlabeled) meta.appendChild(el("span", "picker-badge picker-badge-none", "not labeled yet"));
        if (r.badge) meta.appendChild(el("span", `picker-badge picker-badge-${r.badge === "partial" ? "partial" : "none"}`, r.badge));
        a.appendChild(meta);
        li.appendChild(a);
        list.appendChild(li);
      }
      if (!rows.length) list.appendChild(el("li", "chart-empty", "No task matches."));
    };
    input.addEventListener("input", draw);
    draw();
    // A link before the list, so the keyboard can pass the picker's rows.
    const skip = el("a", "skip-map", "Skip to the map");
    const safe = F.safeRoute("task", String(current || ""));
    if (safe) skip.href = safe;
    skip.addEventListener("click", (evt) => {
      evt.preventDefault();
      const target = document.getElementById("vsm-title");
      if (target) {
        target.tabIndex = -1;
        target.focus();
        target.scrollIntoView({ block: "start" });
      }
    });
    container.appendChild(skip);
    container.appendChild(wrap);
    // The list starts at the top, with the newest tasks; the current one is
    // highlighted wherever it sits.
    list.scrollTop = 0;
  }

  // ------------------------------------------------------------------ lede

  function renderLede(container, row, published, idle, onToken, unlabeled) {
    const model = W.lede(row, F.reasonText, { published, idle, unlabeled_ms: unlabeled });
    container.innerHTML = "";
    container.classList.toggle("lede-missing", model.state !== "ok");
    const parts = model.parts.slice();
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      if (typeof p === "string") container.appendChild(document.createTextNode(p));
      else if (p.term) container.appendChild(el("dfn", null, p.text));
      else {
        const b = el("button", "lede-num", p.text);
        b.type = "button";
        b.dataset.hl = p.key;
        b.setAttribute("aria-pressed", "false");
        b.title = "Highlight this on the map";
        b.addEventListener("click", () => onToken(p, b));
        // Punctuation right after a number stays on its line.
        const next = parts[k + 1];
        const m = typeof next === "string" ? /^[.,;:]/.exec(next) : null;
        if (m) {
          const keep = el("span", "nowrap");
          keep.append(b, document.createTextNode(m[0]));
          container.appendChild(keep);
          parts[k + 1] = next.slice(1);
        } else container.appendChild(b);
      }
    }
    return model;
  }

  // ------------------------------------------------- the value stream map

  // What each lede number lights up on the map (walk.js highlightSelector):
  // a cause lights only the waits that waited on it.
  function highlight(root, key, item, cause, seg, why) {
    const tag = `${key}|${item === undefined ? "" : item}|${cause || ""}|${seg || ""}|${why || ""}`;
    const on = root.dataset.hl === tag;
    root.dataset.hl = on ? "" : tag;
    for (const n of root.querySelectorAll(".is-hl")) n.classList.remove("is-hl");
    if (on) return false;
    const pick = W.highlightSelector(key, { item, cause, seg, why });
    if (pick) for (const n of root.querySelectorAll(pick)) n.classList.add("is-hl");
    return true;
  }

  function renderMap(container, ctx) {
    const { j, map, row, tasksPublished, idle, unlabeled } = ctx;
    container.innerHTML = "";
    if (!map) {
      emptyState(container, tasksPublished === false ? "The value stream map is not published yet: the walk's data files are not part of this build." : "This task's value stream map is not published yet, so no box or triangle is drawn rather than empty ones.");
      return null;
    }
    const width = container.clientWidth || 1000;
    const phone = width < 640;
    // As many boxes as fit at a readable width; the rest of the work is folded.
    const maxBoxes = phone ? 6 : Math.max(2, Math.floor((width - 190 + 84) / 212));
    // Job-level states the bursts' own counts cannot know: operator turns
    // not recorded, and a task not labeled, read "not recorded" and "not
    // labeled yet" in every box, never 0.
    const model = W.mapModel(map, { maxBoxes, jobStates: { operator_turns: j.human_turns || null, labels: row ? row.value_in_working_ms : null } });
    // The prompts and pull requests are still listed when no map is drawn.
    const clockOnly = (origin0) => {
      const lw0 = map.lead_window || {};
      const o = typeof lw0.start_ms === "number" ? lw0.start_ms : origin0;
      const lead0 = typeof lw0.start_ms === "number" && typeof lw0.end_ms === "number" ? lw0.end_ms - lw0.start_ms : null;
      const c0 = W.clockMarks(map, null);
      const ctx0 = { origin_ms: o, lead_ms: lead0, reasonText: F.reasonText, model: null };
      const open0 = Object.assign((opener, thing) => openClock(opener, thing, { j, map, ctxDrawer: ctx0, clock: c0 }), { job: j });
      renderHandoffs(container, map, c0, o, lead0, open0);
      renderPrTable(container, map, c0, o, open0);
    };
    if (!model.items.length) {
      emptyState(container, "No work burst or wait was recorded for this task, so there is nothing to draw.");
      clockOnly(0);
      return null;
    }
    const lw = map.lead_window || {};
    const origin = typeof lw.start_ms === "number" ? lw.start_ms : model.items[0].start_ms;
    // Bursts Desk states as unknown (a session log it could not read) are
    // not drawn: the gaps between them could be log it could not show.
    if (map.bursts_state && map.bursts_state.state === "unavailable") {
      const why = (map.bursts_state.reasons || []).map(F.reasonText).join("; ") || "they were not recorded";
      const lead = typeof lw.start_ms === "number" && typeof lw.end_ms === "number" ? ` Its lead time is known: ${W.durationWords(lw.end_ms - lw.start_ms)}.` : "";
      emptyState(container, `This task's work bursts are not known, because ${why}, so no box or triangle is drawn: a gap could be a stretch the log does not show, not idle time.${lead} The sessions below still list what each one recorded.`);
      clockOnly(origin);
      return null;
    }
    const leadMs = typeof lw.start_ms === "number" && typeof lw.end_ms === "number" ? lw.end_ms - lw.start_ms : null;
    const name = jobLabel(j);
    const marks = W.statusMarks(map, model);
    const segs = W.ladder(model);
    const longest = row && row.longest_gap && row.longest_gap.state !== "unavailable" ? row.longest_gap.value : null;
    const longestItem = longest ? model.items.find((it) => it.type === "wait" && longest.start_ms >= it.start_ms && longest.end_ms <= it.end_ms) : null;

    const root = el("div", `vsm ${phone ? "vsm-phone" : "vsm-wide"}`);
    root.dataset.hl = "";
    const ctxDrawer = { origin_ms: origin, lead_ms: leadMs, reasonText: F.reasonText, fold_ms: model.fold_ms, model, open: false };
    const sessionsOf = (it) => {
      if (it.type === "box") return it.sessions;
      return (map.sessions || []).filter((s) => typeof s.offset_ms === "number" && s.offset_ms <= it.end_ms && (typeof s.end_ms !== "number" || s.end_ms >= it.start_ms)).map((s) => s.id);
    };
    // Operator prompts and pull request times on the task clock (walk.js
    // clockMarks): prompts above the boxes they start and on the ladder,
    // pull request times on the ladder, both in the Handoffs and pull
    // request tables under the map. A time the map file does not place is
    // listed there, never drawn.
    const clock = W.clockMarks(map, model);
    ctxDrawer.open = clock.open;
    const linksFor = (it) =>
      sessionsOf(it)
        .map((sid) => ({ sid, route: F.safeRoute("task", j.id, "session", sid) }))
        .filter((x) => x.route)
        .map((x) => ({ text: `Open session ${x.sid.slice(0, 8)} to scale`, href: x.route }));
    const open = (opener, thing) => {
      const it = thing.item;
      const content = W.drawer(thing, ctxDrawer);
      const route = F.safeRoute("task", j.id) || "#/";
      openDrawer(opener, content, {
        job: j,
        links: linksFor(it),
        prompt: { ...W.promptItem(thing, ctxDrawer), taskName: W.promptName(F.taskName(localNames, j)), route, dataPath: mapPath(j.id) },
        more: (box) => stretchesIn(box, j, map, it, ctxDrawer),
      });
    };
    const openMark = Object.assign((opener, thing) => openClock(opener, thing, { j, map, ctxDrawer, clock }), { job: j });
    // Marks outside the lead window go to a margin before or after the
    // map, never to its edge (their positions do not depend on the layout).
    const outside = W.ladderLanes(clock, [], { origin });
    const off = outside.before.count ? 1 : 0;
    const afterCol = outside.after.count ? 1 : 0;
    const lastCol = model.items.length + off + afterCol;

    // Each item's column (wide) or row (phone).
    const cols = model.items.map((it) => (it.type === "box" ? "minmax(124px, 1.5fr)" : "minmax(84px, 1fr)"));
    if (off) cols.unshift("minmax(104px, 0.8fr)");
    if (afterCol) cols.push("minmax(104px, 0.8fr)");
    if (!phone) root.style.gridTemplateColumns = `${cols.join(" ")} minmax(178px, 1.25fr)`;
    const place = (node, col, row, span) => {
      if (phone) return node;
      node.style.gridColumn = String(col + 1);
      node.style.gridRow = span ? `${row} / span ${span}` : String(row);
      return node;
    };

    // The top row: the operator as customer, top right, and the card's status changes.
    const customer = el("div", "vsm-customer");
    customer.appendChild(el("span", "vsm-customer-name", "The operator"));
    customer.appendChild(el("span", "vsm-customer-role", "the customer: the person the agents work for, who asks for the work and accepts it"));
    const oc = el("span", "vsm-customer-outcome");
    oc.appendChild(outcomeNode(j));
    customer.appendChild(oc);
    root.appendChild(place(customer, lastCol, 1));
    const margin = (side) => {
      const m = outside[side];
      if (!m.count) return;
      const cell = marginCell(m, side, openMark, origin);
      if (phone) {
        const r = el("div", `vsm-row vsm-margin-row`);
        r.appendChild(cell);
        root.appendChild(r);
      } else root.appendChild(place(cell, side === "before" ? 0 : model.items.length + off, 2, 3));
    };
    margin("before");
    const markCells = new Map();
    for (const m of marks) {
      if (!markCells.has(m.item)) markCells.set(m.item, []);
      markCells.get(m.item).push(m);
    }

    let prevLevel = null;
    let segIndex = 0;
    for (const it of model.items) {
      const i = it.index;
      const cell = phone ? el("div", "vsm-row") : null;
      // Status changes over this item.
      const ms = markCells.get(i);
      const info = el("div", "vsm-info");
      if (ms) for (const m of ms) info.appendChild(el("span", "vsm-status", `card: ${m.status}${m.observed ? " (last seen)" : ""}`));
      // The operator's prompts that fall in this item, as one marker.
      const here = (clock.by_item[i] || []).map((k) => clock.prompts[k]);
      const col = i + off;
      if (here.length) info.appendChild(operatorMarker(here, it, model, openMark, origin));
      // The ladder for this item, with a strip for its clock marks.
      const ladCol = el("div", "vsm-ladcol");
      const strip = el("div", "vsm-marks");
      strip.dataset.item = String(i);
      // Two thin lanes: prompt ticks, then pull request glyphs.
      strip.append(el("div", "mark-lane mark-lane-prompt"), el("div", "mark-lane mark-lane-pr"));
      const lad = el("div", "vsm-lad");
      ladCol.append(strip, lad);
      for (; segIndex < segs.length && segs[segIndex].item === i; segIndex++) {
        const sg = segs[segIndex];
        const sgWhy = sg.level === "high" ? (sg.folded ? it.inner_why : it.why) : null;
        const sgWhys = sg.level === "high" ? (sg.folded ? it.inner_whys : it.whys) || [] : [];
        const b = el("button", `lad lad-${sg.level}${sg.folded ? " lad-folded" : ""}${prevLevel && prevLevel !== sg.level ? " lad-turn" : ""}${(sg.causes || []).map((k) => ` has-${k}`).join("")}${sgWhy ? ` why-${sgWhy}` : ""}${sgWhys.map((k) => ` has-why-${k}`).join("")}`);
        b.type = "button";
        b.dataset.item = String(i);
        b.appendChild(el("span", "lad-label", sg.label));
        b.setAttribute("aria-label", `${sg.level === "low" ? "Working" : sg.folded ? "Short waits inside the box" : "Waiting"}: ${W.durationWords(sg.ms)}`);
        b.addEventListener("click", () => open(b, { kind: "ladder", seg: sg, item: it }));
        lad.appendChild(b);
        prevLevel = sg.level;
      }
      let main;
      let data = null;
      if (it.type === "box") {
        // Which working parts of the task's bar light this box.
        const hasMs = (n) => {
          const x = W.stated(n);
          return x.state !== "unavailable" && x.value > 0;
        };
        main = el("button", `vsm-box${hasMs(it.value_ms) ? " has-value" : ""}${hasMs(it.defect_stretches) ? " has-defects" : ""}`);
        main.type = "button";
        main.dataset.item = String(i);
        main.appendChild(el("span", "vsm-box-title", W.boxTitle(it)));
        main.appendChild(el("span", "vsm-box-work", `${W.durationShort(it.working_ms)} working`));
        const rw = W.reworkWords(it);
        if (rw) {
          const r = el("span", "vsm-rework");
          const icon = svg("svg", { viewBox: "0 0 20 14", width: 20, height: 14, "aria-hidden": "true", class: "vsm-rework-icon" });
          icon.appendChild(svg("path", { d: "M3 10 C3 2, 17 2, 17 10", fill: "none", "stroke-width": 1.8 }));
          icon.appendChild(svg("path", { d: "M1 7 L3 11 L6 7.5", fill: "none", "stroke-width": 1.8 }));
          r.appendChild(icon);
          r.appendChild(document.createTextNode(`rework: ${rw}`));
          main.appendChild(r);
        }
        main.setAttribute("aria-label", `${W.boxTitle(it)}: ${W.durationWords(it.working_ms)} working${rw ? `; rework: ${rw}` : ""}. Opens the evidence.`);
        main.addEventListener("click", () => open(main, { kind: "box", item: it }));
        data = el("div", "vsm-data");
        const rows = W.dataBox(it, model.session_count, Array.isArray(map.prs) ? W.boxPrCount(clock, i, map.prs_state) : undefined);
        const dl = el("dl", "vsm-data-list");
        rows.forEach((r, k) => {
          const d = el("div", k >= 2 ? "vsm-data-more" : "");
          d.appendChild(el("dt", null, r.label));
          const dd = el("dd", null, r.text);
          // A figure that is not measured says why, on hover and to screen readers.
          if (r.reasons && r.reasons.length) {
            const why = r.reasons.map(F.reasonText).join("; ");
            dd.title = why;
            dd.appendChild(el("span", "sr-only", ` (${why})`));
          }
          d.appendChild(dd);
          dl.appendChild(d);
        });
        data.appendChild(dl);
        const more = el("button", "vsm-data-toggle", "All figures");
        more.type = "button";
        more.setAttribute("aria-expanded", "false");
        more.addEventListener("click", () => {
          const openNow = data.classList.toggle("is-open");
          more.setAttribute("aria-expanded", String(openNow));
          more.textContent = openNow ? "Fewer figures" : "All figures";
        });
        data.appendChild(more);
      } else {
        main = el("button", `vsm-wait cause-${it.waited_on}${it.causes.map((k) => ` has-${k}`).join("")}${it.why ? ` why-${it.why}` : ""}${(it.whys || []).map((k) => ` has-why-${k}`).join("")}${longestItem === it ? " is-longest" : ""}`);
        main.type = "button";
        main.dataset.item = String(i);
        const tri = svg("svg", { viewBox: "0 0 40 34", width: 40, height: 34, "aria-hidden": "true", class: "vsm-tri" });
        tri.appendChild(svg("path", { d: "M20 2 L38 32 L2 32 Z", "stroke-width": 1.6, "stroke-linejoin": "round" }));
        const t = svg("text", { x: 20, y: 28, "text-anchor": "middle", class: "vsm-tri-i" });
        t.textContent = "I";
        tri.appendChild(t);
        main.appendChild(tri);
        main.appendChild(el("span", "vsm-wait-dur", W.durationShort(it.duration_ms)));
        main.appendChild(el("span", "vsm-wait-what", W.waitTitle(it)));
        main.setAttribute("aria-label", `Wait of ${W.durationWords(it.duration_ms)}: ${W.waitTitle(it)}. Opens the evidence.`);
        main.addEventListener("click", () => open(main, { kind: "wait", item: it }));
      }
      if (phone) {
        const body = el("div", "vsm-row-body");
        if (info.childNodes.length) body.appendChild(info);
        body.appendChild(main);
        if (data) body.appendChild(data);
        cell.append(ladCol, body);
        cell.classList.add(it.type === "box" ? "row-box" : "row-wait");
        root.appendChild(cell);
      } else {
        root.appendChild(place(info, col, 1));
        root.appendChild(place(main, col, 2));
        if (data) root.appendChild(place(data, col, 3));
        root.appendChild(place(ladCol, col, 4));
      }
    }
    margin("after");

    // The summary box: lead time; working time, of which value-adding; flow efficiency.
    const sum = el("div", "vsm-summary");
    const line = (cls, label, node, note) => {
      const d = el("div", `sum-line ${cls}`);
      d.appendChild(el("span", "sum-label", label));
      const v = el("span", "sum-value-text");
      v.appendChild(node);
      d.appendChild(v);
      if (note) d.appendChild(el("span", "sum-note", note));
      sum.appendChild(d);
    };
    // The same words as the lede, so the two never disagree.
    const words = new Map();
    for (const p of W.lede(row, F.reasonText, { published: tasksPublished, idle, unlabeled_ms: unlabeled }).parts) if (p && typeof p === "object" && !p.term) words.set(p.key, `${p.q || ""}${p.text}`);
    const leadWords = (words.has("lead") && row && row.lead_time_ms && row.lead_time_ms.state === "partial" && row.lead_time_ms.bound !== null && !/^at /.test(words.get("lead")) ? "at least " : "") + (words.get("lead") || "");
    const fig = (key, n) => {
      if (words.has(key)) return document.createTextNode((key === "lead" && n && n.state === "partial" && n.bound !== null && !/^at /.test(words.get(key)) ? "at least " : "") + words.get(key));
      const nd = el("span", "num num-unavailable", "no data");
      if (!(n && n.state === "unavailable" && n.reasons && n.reasons.length)) return nd;
      const wrap = el("span");
      wrap.append(nd, el("span", "sum-reason", `because ${n.reasons.map(F.reasonText).join("; ")}`));
      return wrap;
    };
    line("sum-lead", "Lead time", fig("lead", row && row.lead_time_ms), "from start to end");
    line("sum-working", "Working time", fig("working", row && row.working_ms), "agents busy");
    line("sum-value", "of which value-adding", fig("value", row && row.value_in_working_ms), "as the evaluator labeled it");
    line("sum-waiting", "Waiting", idle && idle.state !== "unavailable" && words.has("waiting") ? document.createTextNode(words.get("waiting")) : el("span", "num num-unavailable", "no data"), "idle: lead time − working time");
    line("sum-fe", "Flow efficiency", fig("fe", row && row.flow_efficiency), "working time ÷ lead time");
    // The operator's own time: the Store's attention estimate, for this task.
    const op = W.operatorTime(j, map && map.human_turns, map && map.human_turns_state, F.reasonText, F.reasonCore);
    line("sum-attention", "Operator attention", op.attention ? document.createTextNode(op.attention) : el("span", "num num-unavailable", "no data"), "reading and answering, estimated");
    if (phone) root.appendChild(sum);
    else {
      // The summary sits beside the boxes and adds no height to any row: it
      // is taken out of the grid's sizing, so the data boxes keep their own
      // height and the ladder sits right under them.
      const cell = el("div", "vsm-sum-cell");
      cell.appendChild(sum);
      root.appendChild(place(cell, lastCol, 2, 3));
    }

    container.appendChild(root);
    // A summary taller than the rows beside it extends the map below, never
    // the rows.
    if (!phone) {
      const over = sum.getBoundingClientRect().bottom - root.getBoundingClientRect().bottom;
      if (over > 0) root.style.paddingBottom = `${Math.ceil(over)}px`;
    }
    drawLadderMarks(root, clock, phone, openMark, origin);

    // The legend and how the map was folded.
    const legend = el("div", "vsm-legend");
    const lg = (cls, text) => {
      const p = el("p", "vsm-legend-item");
      p.appendChild(el("span", `vsm-key ${cls}`));
      p.appendChild(document.createTextNode(text));
      legend.appendChild(p);
    };
    lg("key-box", "A box is a burst of agent work; its data box lists what happened in it.");
    lg("key-tri", "A triangle is waiting: idle time between bursts of work, when no agent of this task was working, with what it waited on. Waiting always means idle time here; the evaluator's labels describe working time only.");
    lg("key-ladder", `${phone ? "The ladder runs down the left: a line on the left is working time, a line on the right is waiting." : "The ladder under the map: the low line is working time, the high line is waiting, each step labeled with its length."} A step marked “+” (such as “+5m”) is the short waits folded inside the box before it. Select any step for its evidence.`);
    lg("key-rework", "A loop arrow marks rework: stretches the evaluator labeled as defects inside that box.");
    const lgGlyph = (kind, text, opts) => {
      const p = el("p", "vsm-legend-item");
      const k = el("span", "vsm-key vsm-key-glyph");
      k.appendChild(clockGlyph(kind, opts));
      p.append(k, document.createTextNode(text));
      legend.appendChild(p);
    };
    lgGlyph("prompt", `An operator prompt: above the box it falls in, and as a tick on the ladder's first lane at its time. ${W.whyLegend(clock)}`);
    // The classes drawn on this map, each with its color and pattern.
    const whyKeys = [...new Set([...W.whyKeysIn(clock).filter((k) => k !== "not_known" || clock.prompts.some((p) => p.wait && typeof p.wait.why === "string")), ...model.items.map((x) => (x.type === "wait" ? x.why : x.inner_why)).filter(Boolean)])];
    const ordered = W.WHY_KEYS.filter((k) => whyKeys.includes(k));
    if (ordered.length) {
      const p = el("p", "vsm-legend-item vsm-legend-why", "Why the agent stopped, on the prompts and on the triangles of waiting for the next prompt (a dashed triangle: why not known):");
      legend.appendChild(p);
      drawWhyLegend(legend, ordered);
    } else if (model.items.some((x) => x.type === "wait" && x.by && x.by.next_prompt > 0)) {
      legend.appendChild(el("p", "vsm-legend-item", "Why the agent stopped before each wait for the next prompt is not known yet: Desk does not publish it for this task, so the triangles say only that the agent had stopped."));
    }
    lgGlyph("opened", W.prLegendWords(map && map.prs));
    lgGlyph("opened", "An outlined mark is a time known only in part: its evidence says which way the true time lies.", { partial: true });
    if (outside.before.count || outside.after.count) lgGlyph("opened", `A time before the task started${clock.open ? " or after its last recorded work" : " or after its lead time ended"} is listed in a dashed margin beside the map, with how far outside it lies, never drawn at the map's edge.`);
    {
      const p = el("p", "vsm-legend-item");
      const k = el("span", "vsm-key vsm-key-glyph");
      k.appendChild(markBadge({ lane: "pr", count: 2, marks: [{ kind: "merged" }] }));
      p.append(k, document.createTextNode(MERGE_RULE));
      legend.appendChild(p);
    }
    container.appendChild(legend);
    container.appendChild(el("p", "chart-caption", `${W.foldWords(model)} Lead time ${leadWords || W.durationWords(model.totals.lead_ms)} = working ${W.durationWords(model.totals.working_ms)} + waits inside boxes ${W.durationWords(model.totals.inner_wait_ms)} + waits between boxes ${W.durationWords(model.totals.waiting_ms)}.`));
    // A map Desk states as incomplete (unreadable stretches of a log, or
    // bursts with no labels) says so under the drawing.
    for (const [env, what] of [[map.bursts_state, "The bursts and waits are only partly recorded"], [map.bursts_labels, "The bursts' labels are not all recorded, so value-adding and defect figures read no data where there are none"]]) {
      if (env && env.state && env.state !== "measured") container.appendChild(el("p", "chart-caption", `${what}: ${(env.reasons || []).map(F.reasonText).join("; ") || "not recorded"}. A gap may be a stretch the log could not show, not idle time.`));
    }
    if (lw.state === "unavailable") container.appendChild(el("p", "chart-caption", `This task's start could not be placed (${(lw.reasons || []).map(F.reasonText).join("; ") || "not recorded"}), so its share of lead time is not known.`));

    // The text equivalent: the map as a table.
    const det = el("details", "more-details");
    det.appendChild(el("summary", null, "The map as a table"));
    const table = el("table", "data-table vsm-table");
    tableHead(table, [["Step", ""], ["On the task clock", ""], ["Working", "num"], ["Waiting", "num"], ["Tool calls", "num"], ["Failed", "num"], ["Operator turns", "num"], ["Defect stretches", "num"]]);
    const tb = document.createElement("tbody");
    for (const it of model.items) {
      const tr = document.createElement("tr");
      const cells = it.type === "box"
        ? [W.boxTitle(it), W.clockWords(it.start_ms, it.end_ms, origin), W.durationShort(it.working_ms), it.inner_wait_ms ? W.durationShort(it.inner_wait_ms) : "—", W.statedText(it.tool_calls), W.statedText(it.tool_failures), W.statedText(it.operator_turns), W.statedText(it.defect_stretches)]
        : [`Wait: ${W.waitTitle(it)}`, `${W.clockWords(it.start_ms, it.end_ms, origin)}, ${W.waitPlace(model, it)}`, "—", W.durationShort(it.duration_ms), "—", "—", "—", "—"];
      cells.forEach((c, k) => tr.appendChild(el("td", k >= 2 ? "num" : "", c)));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const tw = el("div", "table-wrap");
    tw.appendChild(table);
    det.appendChild(tw);
    container.appendChild(det);

    // The human-agent clock as text: the Handoffs table and the pull requests.
    renderHandoffs(container, map, clock, origin, leadMs, openMark);
    renderPrTable(container, map, clock, origin, openMark, model);

    // A deep link (?bursts=4-6, ?gaps=3, ?prompt=2, ?pr=1) opens the item that holds it.
    const select = (sel) => {
      if (!sel) return false;
      if (sel.kind === "prompt" || sel.kind === "pr") {
        const mark = sel.kind === "prompt" ? clock.prompts[sel.from - 1] : null;
        const pr = sel.kind === "pr" ? (map.prs || [])[sel.from - 1] : null;
        if (!mark && !pr) return false;
        openMark(null, mark ? { kind: "prompt", mark } : { kind: "pr", pr, k: sel.from - 1 });
        return true;
      }
      const it = model.items.find((x) => (sel.kind === "bursts" && x.type === "box" && x.burst_range[0] <= sel.from && sel.from <= x.burst_range[1]) || (sel.kind === "gaps" && x.type === "wait" && x.gap_range[0] <= sel.from && sel.from <= x.gap_range[1]));
      if (!it) return false;
      const node = root.querySelector(`.vsm-box[data-item="${it.index}"], .vsm-wait[data-item="${it.index}"]`);
      if (node) node.scrollIntoView({ block: "center" });
      open(node, { kind: it.type, item: it });
      return true;
    };
    return {
      root,
      model,
      select,
      highlight: (tok) => highlight(root, tok.key, tok.key === "longest" && longestItem ? longestItem.index : undefined, tok.cause, tok.seg, tok.why),
    };
  }

  // ------------------------------------------- the human-agent clock (page)

  // A clock mark's glyph: an operator prompt (a tick with a head, colored by
  // why the agent had stopped), a pull request opened (an up-triangle) or
  // merged (a diamond). A partial time is drawn outlined, never solid.
  function clockGlyph(kind, opts) {
    const o = opts || {};
    const g = svg("svg", { viewBox: "0 0 12 12", width: 12, height: 12, "aria-hidden": "true", class: `clock-glyph glyph-${kind}${o.partial ? " is-partial" : ""}${o.why ? ` why-${o.why}` : ""}` });
    if (kind === "prompt") {
      g.appendChild(svg("rect", { x: 5, y: 3, width: 2, height: 9, rx: 1 }));
      g.appendChild(svg("circle", { cx: 6, cy: 3, r: 2.6 }));
    } else if (kind === "merged") g.appendChild(svg("path", { d: "M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" }));
    else if (kind === "opened" || kind === "pr") g.appendChild(svg("path", { d: "M6 1 L11.4 11 L0.6 11 Z" }));
    else g.appendChild(svg("circle", { cx: 6, cy: 6, r: 5 }));
    return g;
  }

  // One tab stop for a row of marks: the arrow keys move between them,
  // Home and End jump to the ends, and Enter or Space (a button's own
  // behavior) opens one.
  function roving(buttons) {
    buttons.forEach((b, k) => {
      b.tabIndex = k === 0 ? 0 : -1;
      b.addEventListener("keydown", (evt) => {
        const pos = buttons.indexOf(b);
        const next = { ArrowRight: pos + 1, ArrowDown: pos + 1, ArrowLeft: pos - 1, ArrowUp: pos - 1, Home: 0, End: buttons.length - 1 }[evt.key];
        if (next === undefined) return;
        evt.preventDefault();
        const to = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
        for (const x of buttons) x.tabIndex = -1;
        to.tabIndex = 0;
        to.focus();
      });
      b.addEventListener("focus", () => {
        for (const x of buttons) x.tabIndex = -1;
        b.tabIndex = 0;
      });
    });
  }

  // Opens a prompt's or a pull request's evidence: its drawer, a link to
  // its session (a prompt) or to GitHub (a pull request), and its prompt
  // for an agent.
  function openClock(opener, thing, ctx) {
    const { j, ctxDrawer } = ctx;
    const content = W.drawer(thing, ctxDrawer);
    const links = [];
    if (thing.kind === "prompt") {
      const sid = String(thing.mark.turn.session || "");
      const route = F.safeRoute("task", j.id, "session", sid);
      if (route) links.push({ text: `Open session ${sid.slice(0, 8)} to scale`, href: route });
    } else if (W.validPr(thing.pr.repo, thing.pr.number)) {
      links.push({ text: `Pull request ${thing.pr.repo}#${thing.pr.number} on GitHub`, href: `https://github.com/${thing.pr.repo}/pull/${thing.pr.number}`, external: true });
    }
    const route = F.safeRoute("task", j.id) || "#/";
    openDrawer(opener, content, { job: j, links, prompt: { ...W.promptItem(thing, ctxDrawer), taskName: W.promptName(F.taskName(localNames, j)), route, dataPath: mapPath(j.id) } });
  }

  // The marker above a box for the prompts that fall in it: one prompt
  // opens its evidence; several open a list of them.
  function operatorMarker(prompts, it, model, openMark, origin) {
    const why = W.groupWhy(prompts);
    const b = el("button", `vsm-op why-${why}`);
    b.type = "button";
    b.appendChild(clockGlyph("prompt", { why }));
    const where = it.type === "box" ? `work box ${it.box_no}` : "this wait";
    if (prompts.length === 1) {
      b.appendChild(el("span", "vsm-op-text", `prompt ${prompts[0].n}`));
      const pw = prompts[0].why && prompts[0].why !== "not_known" ? ` Why the agent had stopped: ${W.whyName(prompts[0].why).toLowerCase()}.` : "";
      b.setAttribute("aria-label", `Operator prompt ${prompts[0].n} of ${prompts[0].total}, in ${where}.${pw} Opens the evidence.`);
      if (pw) b.title = pw.trim();
      b.addEventListener("click", () => openMark(b, { kind: "prompt", mark: prompts[0] }));
      return b;
    }
    b.appendChild(el("span", "vsm-op-text", `${prompts.length} prompts`));
    b.setAttribute("aria-label", `${prompts.length} operator prompts in ${where}, prompts ${prompts[0].n} to ${prompts[prompts.length - 1].n}. Opens the list.`);
    b.addEventListener("click", () => openPromptList(b, prompts, where, openMark, origin));
    return b;
  }

  // A list of prompts in the drawer, each opening its own evidence.
  function openPromptList(opener, prompts, where, openMark, origin) {
    openDrawer(opener, { title: `${prompts.length} operator prompts`, mark: "prompt", rows: [["What it is", `The operator's prompts in ${where}, in clock order`]], evidence: [] }, {
      job: openMark.job,
      more: (box) => {
        const ul = el("ul", "stretch-list");
        for (const p of prompts) {
          const li = document.createElement("li");
          const b = el("button", "stretch-row");
          b.type = "button";
          b.appendChild(clockGlyph("prompt", { why: p.why }));
          b.appendChild(document.createTextNode(` Prompt ${p.n}, ${W.clockAt(p.ms, origin)}, ${p.turn.basis === "after_stop" ? "after the agent had stopped" : p.turn.basis === "mid_turn" ? "while the agent was still working" : "the session's first prompt"}`));
          b.addEventListener("click", () => openMark(null, { kind: "prompt", mark: p }));
          li.appendChild(b);
          ul.appendChild(li);
        }
        box.appendChild(ul);
      },
    });
  }

  // The merge rule, one statement for the legend and the merged marks'
  // drawers (walk.js groupMarks is its logic).
  const MERGE_RULE = "Marks that would overlap are shown as one count; select it for the list, each with its time.";

  // A merged mark's badge: its lane's glyph and the count, so a merged
  // prompt never reads as pull requests or the other way round.
  function markBadge(g) {
    const b = el("span", `lad-mark-count count-${g.lane}`);
    b.appendChild(g.lane === "prompt" ? el("span", "count-tick") : clockGlyph(g.marks.every((x) => x.kind === "merged") ? "merged" : "opened"));
    b.appendChild(document.createTextNode(String(g.count)));
    return b;
  }

  // The ladder's two lanes, placed once the map is laid out: each item's
  // strip is measured, and walk.js ladderLanes groups only the marks that
  // collide under MERGE_RULE (prompt ticks and pull request glyphs, never together).
  // Each lane is one tab stop.
  function drawLadderMarks(root, clock, phone, openMark, origin) {
    const strips = [...root.querySelectorAll(".vsm-marks")];
    // The ladder is the time scale: each item's steps, measured where they
    // are drawn, so a mark sits over the step that holds its time.
    const sizes = [];
    for (const st of strips) {
      const i = Number(st.dataset.item);
      const r0 = st.getBoundingClientRect();
      const steps = [...root.querySelectorAll(`.vsm-lad .lad[data-item="${i}"]`)];
      const geo = {};
      steps.forEach((b) => {
        const r = b.getBoundingClientRect();
        const range = phone ? [r.top - r0.top, r.bottom - r0.top] : [r.left - r0.left, r.right - r0.left];
        const name = b.classList.contains("lad-folded") ? "fold" : b.classList.contains("lad-low") ? "work" : "wait";
        geo[name] = range;
      });
      sizes[i] = Object.keys(geo).length ? geo : phone ? st.clientHeight : st.clientWidth;
    }
    const L = W.ladderLanes(clock, sizes, { origin });
    for (const [lane, groups] of [["prompt", L.prompts], ["pr", L.prs]]) {
      const buttons = [];
      for (const g of groups) {
        const st = strips.find((x) => Number(x.dataset.item) === g.item);
        const ln = st && st.querySelector(`.mark-lane-${lane}`);
        if (!ln) continue;
        const first = g.marks[0];
        const partial = g.marks.some((x) => x.state === "partial");
        // A merged group's span, so the badge never hides where its marks lie.
        if (g.count > 1 && g.to - g.from >= 2) {
          const span = el("span", "lad-span");
          span.style.setProperty(phone ? "top" : "left", `${g.from}px`);
          span.style.setProperty(phone ? "height" : "width", `${g.to - g.from}px`);
          ln.appendChild(span);
        }
        const b = el("button", `lad-mark lad-mark-${g.count > 1 ? "multi" : first.kind}${partial ? " is-partial" : ""}`);
        b.type = "button";
        b.style.setProperty(phone ? "top" : "left", `${g.pos}px`);
        b.dataset.item = String(g.item);
        b.dataset.step = g.step;
        if (g.count > 1) b.appendChild(markBadge(g));
        else if (lane === "prompt") b.appendChild(el("span", `lad-tick why-${first.ref.why}`));
        else b.appendChild(clockGlyph(first.kind, { partial }));
        const partialWords = partial ? " (a time known only in part)" : "";
        b.setAttribute("aria-label", `${g.label}${partialWords}. ${g.count > 1 ? "Opens the list." : "Opens the evidence."}`);
        b.title = `${g.label}${partialWords}`;
        b.addEventListener("click", () => {
          if (g.count === 1) openMark(b, first.kind === "prompt" ? { kind: "prompt", mark: first.ref } : { kind: "pr", pr: first.pr, k: first.ref.k });
          else openMarkList(b, g, openMark, origin);
        });
        ln.appendChild(b);
        // A merged badge stays over its own step (never over a neighbour
        // whose time excludes its marks).
        const half = (phone ? b.offsetHeight : b.offsetWidth) / 2;
        const geo = sizes[g.item];
        const range = geo && typeof geo === "object" && geo[g.step] ? geo[g.step] : [0, typeof geo === "number" ? geo : 0];
        if (g.count > 1) b.style.setProperty(phone ? "top" : "left", `${range[1] - range[0] > 2 * half ? Math.min(Math.max(g.pos, range[0] + half), range[1] - half) : (range[0] + range[1]) / 2}px`);
        buttons.push(b);
      }
      roving(buttons);
    }
  }

  // A margin beside the map for the marks outside the lead window: what
  // they are and how far outside they lie, never drawn at the map's edge.
  function marginCell(m, side, openMark, origin) {
    const box = el("div", `vsm-margin vsm-margin-${side}`);
    box.appendChild(el("span", "vsm-margin-title", m.title));
    box.appendChild(el("span", "vsm-margin-what", `${m.short}, ${m.when}`));
    const row = el("div", "vsm-margin-marks");
    const buttons = [];
    const one = (x) => {
      const b = el("button", "lad-mark-inline");
      b.type = "button";
      if (x.kind === "prompt") b.appendChild(el("span", `lad-tick why-${x.ref.why}`));
      else b.appendChild(clockGlyph(x.kind, { partial: x.state === "partial" }));
      b.appendChild(el("span", "lad-mark-text", x.kind === "prompt" ? `prompt ${x.n}` : `#${x.pr.number}`));
      const line = W.markLine(x, origin);
      b.setAttribute("aria-label", `${line}. Opens the evidence.`);
      b.title = line;
      b.addEventListener("click", () => openMark(b, x.kind === "prompt" ? { kind: "prompt", mark: x.ref } : { kind: "pr", pr: x.pr, k: x.ref.k }));
      row.appendChild(b);
      buttons.push(b);
    };
    // Prompts and pull request times each get their own marks or badge,
    // never one count together. A margin's list is grouped because it lies
    // outside the lead time, not because marks overlap.
    for (const k of m.kinds) {
      if (k.count <= 4) {
        k.marks.forEach(one);
        continue;
      }
      const b = el("button", "lad-mark-inline");
      b.type = "button";
      b.appendChild(markBadge(k));
      const label = `${m.title}: ${k.short}, ${k.when}`;
      b.setAttribute("aria-label", `${label}. Opens the list.`);
      b.title = label;
      b.addEventListener("click", () => openMarkList(b, { ...k, title: m.title }, openMark, origin, { rule: false }));
      row.appendChild(b);
      buttons.push(b);
    }
    roving(buttons);
    box.appendChild(row);
    return box;
  }

  // A merged mark's drawer: one line saying what it counts and when, then
  // each mark with its time, each opening its own evidence.
  function openMarkList(opener, g, openMark, origin, opts) {
    const o = opts || {};
    const title = g.title ? `${g.title}: ${g.short}` : g.short.charAt(0).toUpperCase() + g.short.slice(1);
    openDrawer(opener, { title, mark: g.lane === "prompt" ? "prompt" : g.marks.every((m) => m.kind === "merged") ? "merged" : "opened", rows: [["On the task clock", g.when]], evidence: [] }, {
      job: openMark.job,
      more: (box) => {
        if (o.rule !== false) box.appendChild(el("p", "chart-caption", MERGE_RULE));
        const ul = el("ul", "stretch-list");
        for (const x of g.marks) {
          const li = document.createElement("li");
          const b = el("button", "stretch-row");
          b.type = "button";
          if (x.kind === "prompt") b.appendChild(el("span", `lad-tick why-${x.ref.why}`));
          else b.appendChild(clockGlyph(x.kind, { partial: x.state === "partial" }));
          b.appendChild(document.createTextNode(` ${W.markLine(x, origin)}`));
          b.addEventListener("click", () => openMark(null, x.kind === "prompt" ? { kind: "prompt", mark: x.ref } : { kind: "pr", pr: x.pr, k: x.ref.k }));
          li.appendChild(b);
          ul.appendChild(li);
        }
        box.appendChild(ul);
      },
    });
  }

  // The Handoffs table: one row per operator prompt, in clock order, the
  // text equivalent of the prompt markers (map/<job>.json is its JSON twin).
  // Columns Desk does not publish yet are left out and said once; on a
  // phone each row stacks into labeled lines.
  function renderHandoffs(container, map, clock, origin, leadMs, openMark) {
    const sec = el("section", "clock-section");
    sec.appendChild(el("h3", "bars-title", "Handoffs"));
    const state = W.clockListWords(map.human_turns_state, "Operator prompts", F.reasonText);
    const t = W.handoffTable(clock, origin, F.reasonText, leadMs);
    const rows = t.rows;
    sec.appendChild(el("p", "chart-caption", rows.length ? `Each time the operator prompted an agent of this task, in clock order: ${rows.length} prompt${rows.length === 1 ? "" : "s"}. Each row gives the prompt's time on the task clock, how long the task was idle and the main agent stopped before it, how long the agent then worked, and the size of the prompt and of the output the operator read; never the prompt's text.${state ? ` ${state}.` : ""}` : state ? `${state}, so no prompt is drawn rather than none.` : "No operator prompt is recorded for this task."));
    if (rows.length) {
      sec.appendChild(el("p", "chart-caption", `${t.explain}${t.note ? ` ${t.note}` : ""}`));
      const det = el("details", "more-details handoffs");
      if (rows.length <= 15) det.open = true;
      det.appendChild(el("summary", null, `The ${rows.length} prompt${rows.length === 1 ? "" : "s"} as a table`));
      const table = el("table", "data-table vsm-table handoffs-table");
      const cols = [["Prompt", null], ["On the task clock", "clock"], ["Task idle before this prompt", "idle"], ["Main agent stopped before this prompt", "stopped"], ["Agent then worked", "worked"]];
      if (t.show_why) cols.push(["Why the agent stopped", "why"]);
      cols.push(["Prompt size", "prompt"], ["Output read", "output"]);
      tableHead(table, cols.map((c) => [c[0], ""]));
      const tb = document.createElement("tbody");
      rows.forEach((r, k) => {
        const tr = document.createElement("tr");
        const td = el("td");
        td.dataset.label = "Prompt";
        const b = el("button", "link-button", `Prompt ${r.n}`);
        b.type = "button";
        b.addEventListener("click", () => openMark(b, { kind: "prompt", mark: clock.prompts[k] }));
        td.appendChild(b);
        tr.appendChild(td);
        for (const [label, key] of cols.slice(1)) {
          const c = el("td", null, r[key]);
          c.dataset.label = label;
          tr.appendChild(c);
        }
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      const tw = el("div", "table-wrap");
      tw.appendChild(table);
      det.appendChild(tw);
      sec.appendChild(det);
    }
    container.appendChild(sec);
  }

  // The task's pull requests with their times on the task clock; one with
  // no placed time reads "opened, time not recorded", with its reason, and
  // has no marker. When none is placed, the list is one line of links with
  // their states, and the shared reason is said once.
  function renderPrTable(container, map, clock, origin, openMark, model) {
    const prs = Array.isArray(map.prs) ? map.prs : [];
    const sec = el("section", "clock-section");
    sec.appendChild(el("h3", "bars-title", "Pull requests on the task clock"));
    const state = W.clockListWords(map.prs_state, "Pull requests", F.reasonText);
    if (!prs.length) {
      sec.appendChild(el("p", "chart-caption", state ? `${state}; none is recorded for this task.` : "No pull request is recorded for this task."));
      container.appendChild(sec);
      return;
    }
    const placed = prs.filter((p) => typeof p.opened_at_ms === "number").length;
    // When every time not placed has the same reason, it is said once.
    const missing = prs.flatMap((p) => [typeof p.opened_at_ms === "number" ? null : p.opened_state, p.state === "merged" && typeof p.merged_at_ms !== "number" ? p.merged_state : null]).filter(Boolean);
    const keys = new Set(missing.map((st) => ((st && st.reasons) || []).slice().sort().join(",")));
    const shared = missing.length > 1 && keys.size === 1 ? [...keys][0].split(",").filter(Boolean) : null;
    const why = (st) => (shared ? "" : ` (${((st && st.reasons) || []).map(F.reasonText).join("; ") || "no reason recorded"})`);
    const stateWord = (pr) => (pr.state === "merged" ? "merged" : pr.state === "open" ? "open" : pr.state === "closed" ? "closed without merging" : "state not read");
    const link = (pr, k) => {
      const b = el("button", "link-button", `${pr.repo}#${pr.number}`);
      b.type = "button";
      b.addEventListener("click", () => openMark(b, { kind: "pr", pr, k }));
      return b;
    };
    if (!placed) {
      const reason = shared && shared.length ? ` Why: ${shared.map(F.reasonText).join("; ")}.` : "";
      sec.appendChild(el("p", "chart-caption", `${prs.length} pull request${prs.length === 1 ? "" : "s"} first appeared in this task's sessions, but none has a time on the task clock, so none is drawn.${reason}${state ? ` ${state}.` : ""}`));
      const p = el("p", "pr-line");
      prs.forEach((pr, k) => {
        if (k) p.appendChild(document.createTextNode(", "));
        p.appendChild(link(pr, k));
        p.appendChild(document.createTextNode(` (${stateWord(pr)}${shared ? "" : `; ${why(pr.opened_state).trim()}`})`));
      });
      sec.appendChild(p);
      container.appendChild(sec);
      return;
    }
    const anchor = map.pr_anchor && map.pr_anchor.state === "measured" ? " GitHub's times are placed through the task's clock anchor, to within seconds." : "";
    sec.appendChild(el("p", "chart-caption", `${placed} of ${prs.length} pull request${prs.length === 1 ? "" : "s"} have an opening time on the task clock.${anchor} One with no placed time is listed as "opened, time not recorded", with why, and is not drawn.${shared && shared.length ? ` Every time not placed here has one reason: ${shared.map(F.reasonText).join("; ")}.` : ""}${state ? ` ${state}.` : ""}`));
    const det = el("details", "more-details");
    if (prs.length <= 15) det.open = true;
    det.appendChild(el("summary", null, `The ${prs.length} pull request${prs.length === 1 ? "" : "s"} as a table`));
    const table = el("table", "data-table vsm-table pr-clock-table");
    tableHead(table, [["Pull request", ""], ["Opened", ""], ["Merged", ""], ["State", ""]]);
    const tb = document.createElement("tbody");
    const out = (ms) => {
      const o = model ? W.outsideWords(ms, model, clock.open) : null;
      return o ? ` (${o})` : "";
    };
    prs.forEach((pr, k) => {
      const tr = document.createElement("tr");
      const td = el("td");
      td.dataset.label = "Pull request";
      td.appendChild(link(pr, k));
      tr.appendChild(td);
      const opened = typeof pr.opened_at_ms === "number" ? W.prTimeWords(pr.opened_at_ms, pr.opened_state, origin, F.reasonText) + out(pr.opened_at_ms) : `opened, time not recorded${why(pr.opened_state)}`;
      const merged = pr.state === "open" ? "not merged" : pr.state === "closed" ? "closed without merging" : typeof pr.merged_at_ms === "number" ? W.prTimeWords(pr.merged_at_ms, pr.merged_state, origin, F.reasonText) + out(pr.merged_at_ms) : `merged, time not recorded${why(pr.merged_state)}`;
      for (const [label, v] of [["Opened", opened], ["Merged", merged], ["State", pr.state || "not read"]]) {
        const c = el("td", null, v);
        c.dataset.label = label;
        tr.appendChild(c);
      }
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    const tw = el("div", "table-wrap");
    tw.appendChild(table);
    det.appendChild(tw);
    sec.appendChild(det);
    container.appendChild(sec);
  }

  // The labeled stretches inside one map item, loaded from its sessions'
  // swimlane files on request; each opens its own evidence.
  function stretchesIn(box, j, map, it, ctxDrawer) {
    const files = (map.detail_files || []).filter((p) => typeof p === "string" && /^jobs\/[0-9A-Za-z_-]+\/[0-9A-Za-z_-]+\.json$/.test(p));
    const sessions = it.type === "box" ? it.sessions : (map.sessions || []).map((s) => s.id);
    const mine = files.filter((p) => sessions.some((sid) => p.endsWith(`/${sid}.json`)));
    if (!mine.length) {
      box.appendChild(el("p", "chart-caption", "No labeled session file is published for this span, so there are no labeled stretches to list."));
      return;
    }
    const btn = el("button", "drawer-load", "Show the labeled stretches in this span");
    btn.type = "button";
    box.appendChild(btn);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Loading…";
      const details = (await Promise.all(mine.map(walkFile))).filter(Boolean);
      btn.remove();
      const list = el("ul", "stretch-list");
      let n = 0;
      for (const d of details) {
        const lanesOf = W.lanes(d, map.agents);
        const all = d.stretches || [];
        all.forEach((s, k) => {
          if (s.end_ms <= it.start_ms || s.start_ms >= it.end_ms) return;
          n += 1;
          const li = document.createElement("li");
          const b = el("button", "stretch-row");
          b.type = "button";
          const c = W.drawer({ kind: "stretch", stretch: s, index: k, total: all.length, intervals: d.intervals || [], lanes: lanesOf }, ctxDrawer);
          b.appendChild(swatch(c.segment));
          b.appendChild(document.createTextNode(`${c.title} ${k + 1}, ${W.durationShort(s.end_ms - s.start_ms)}${s.waited_on ? ` (${W.waitedOnWords(s.waited_on, "short")})` : ""}`));
          b.addEventListener("click", () => openStretch(null, j, d, k, lanesOf, ctxDrawer));
          li.appendChild(b);
          list.appendChild(li);
        });
      }
      box.appendChild(el("h3", "drawer-sub", n ? `Labeled stretches in this span (${n})` : "No labeled stretch falls in this span"));
      if (n) box.appendChild(list);
    });
  }

  // One stretch's evidence; `k` is its index in the session's stretches.
  function openStretch(opener, j, detail, k, lanesOf, ctxDrawer) {
    const stretches = detail.stretches || [];
    const thing = { kind: "stretch", stretch: stretches[k], index: k, total: stretches.length, session: detail.session, intervals: detail.intervals || [], lanes: lanesOf };
    const content = W.drawer(thing, ctxDrawer);
    const route = F.safeRoute("task", j.id, "session", detail.session) || F.safeRoute("task", j.id) || "#/";
    const links = [{ text: `Open session ${String(detail.session).slice(0, 8)} to scale`, href: route }];
    if (detail.labels_from_shared_session) content.rows.push(["Labels", "These labels come from a session this task shared with other tasks"]);
    openDrawer(opener, content, { job: j, links, prompt: { ...W.promptItem(thing, ctxDrawer), taskName: W.promptName(F.taskName(localNames, j)), route, dataPath: `jobs/${j.id}/${detail.session}.json` } });
  }

  // ------------------------------------------- where this task's time went

  function renderTimeWent(container, ctx) {
    const { j, row, stackRow, stackPublished, idle, light } = ctx;
    container.innerHTML = "";
    if (!stackRow) {
      container.appendChild(el("p", "chart-caption", stackPublished === false ? "The walk's stack-up file is not published yet, so this shows the labeled time the store's own report holds instead." : "This task has no row in the walk's stack-up file, so this shows the labeled time the store's own report holds instead."));
      renderStoreWaste(container, j);
      return;
    }
    const bar = W.timeBar(stackRow, row, idle, F.SEGMENTS);
    if (bar.state === "lead_only") {
      // What is known (the lead time) is drawn; what is not (its split) is said.
      const why = (bar.reasons || []).map(F.reasonText).join("; ") || "it was not recorded";
      const at = bar.lead_state === "partial" && stackRow.lead_time_ms && stackRow.lead_time_ms.bound !== null ? "at least " : "";
      container.appendChild(el("p", "chart-caption tw-title", `The whole lead time as one bar: ${at}${W.durationWords(bar.total_ms)}. How it splits into working and waiting is not known, because ${why}.`));
      const track = el("div", "tw-bar");
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", `Lead time ${at}${W.durationWords(bar.total_ms)}; its split into working and waiting is not known.`);
      const d = el("div", "tw-seg tw-unsplit");
      d.style.width = "100%";
      track.appendChild(d);
      container.appendChild(track);
      container.appendChild(el("p", "chart-empty", "No working or waiting part is drawn rather than a guessed one."));
      return;
    }
    if (bar.state !== "ok") {
      container.appendChild(el("p", "chart-empty", `Not measured for this task, because ${(bar.reasons || []).map(F.reasonText).join("; ") || "it was not recorded"}. No bar is drawn rather than an empty one.`));
      return;
    }
    const atLeast = bar.lead_state === "partial" ? "at least " : "";
    container.appendChild(el("p", "chart-caption tw-title", `The whole lead time as one bar, linear from zero: scale 0 to ${atLeast}${W.durationWords(bar.total_ms)}. Working time comes first, split by the evaluator's labels; then waiting, idle time, split by what it waited on.`));
    // Each part of the bar, and each legend row, is a button that lights its
    // evidence on the map: a working part lights the boxes that hold it, a
    // waiting cause its triangles and ladder steps.
    const press = (s, btn) => {
      if (typeof light === "function") light(s.cause ? { key: "wait_cause", cause: s.cause, why: s.why } : { key: "class", seg: s.key }, btn);
    };
    // A class's figure says "at least" while some of the waiting is not classified.
    const segLabel = (s) => (s.why === "not_known" && s.reasons && s.reasons.length ? `${s.label} (${s.reasons.map(W.whyReasonWords).join("; ")})` : s.label);
    // A class of the next-prompt split states its floor and its ceiling.
    const segMs = (s) => (s.why && typeof s.ceiling_ms === "number" ? W.boundedWords(s.ms, s.ceiling_ms, W.durationWords) : `${s.why ? W.qualOf(s) : ""}${W.durationWords(s.ms)}`);
    const partWords = (s) => `${segLabel(s)}: ${segMs(s)}, ${W.pctWords(s.share)} of the lead time`;
    const track = el("div", "tw-bar");
    track.setAttribute("role", "group");
    track.setAttribute("aria-label", `Lead time ${atLeast}${W.durationWords(bar.total_ms)}: ${bar.groups.map((g) => `${g.label.toLowerCase()} ${W.durationWords(g.ms)}`).join("; ")}. Each part lights its evidence on the map.`);
    for (const g of bar.groups) {
      const gd = el("div", `tw-group tw-group-${g.key}`);
      gd.style.width = `${Math.max(0, (g.ms / bar.total_ms) * 100)}%`;
      for (const s of g.segments) {
        const d = el("button", `tw-seg tw-part tw-${s.key}`);
        d.type = "button";
        d.setAttribute("aria-pressed", "false");
        d.style.width = g.ms > 0 ? `${(s.ms / g.ms) * 100}%` : "0";
        if (s.why) d.classList.add(whyFill(s.why, true), "tw-why");
        else if (s.cause) d.classList.add(`wait-${s.cause}`);
        else {
          d.style.background = s.key === "working_unsplit" ? "transparent" : segmentFill(s.key, true);
          const seg = SEGMENT_BY_KEY.get(s.key);
          if ((seg && seg.fill === "outline") || s.key === "working_unsplit") d.style.boxShadow = `inset 0 0 0 1.5px var(${seg ? seg.token : "--c-not-labeled"})`;
        }
        d.title = partWords(s);
        d.setAttribute("aria-label", `${partWords(s)}. Lights it on the map.`);
        d.addEventListener("click", () => press(s, d));
        gd.appendChild(d);
      }
      track.appendChild(gd);
    }
    container.appendChild(track);
    for (const g of bar.groups) {
      const head = el("p", "tw-group-head");
      head.appendChild(el("strong", null, g.label));
      head.appendChild(document.createTextNode(` ${g.qualifier || ""}${W.durationWords(g.ms)} · ${W.pctWords(g.ms / bar.total_ms)} of the lead time${g.key === "waiting" ? ": idle time, by what it waited on" : ": by the evaluator's labels"}`));
      container.appendChild(head);
      const ul = el("ul", "tw-legend tw-legend-buttons");
      for (const s of g.segments) {
        const li = document.createElement("li");
        const b = el("button", "tw-row tw-part");
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.appendChild(s.why ? whySwatch(s.why) : s.cause ? waitSwatch(s.cause) : swatch(s.key === "working_unsplit" ? "not_labeled" : s.key));
        b.appendChild(el("span", "tw-name", segLabel(s)));
        b.appendChild(el("span", "tw-ms", `${segMs(s)} · ${W.pctWords(s.share)} of the lead time`));
        b.setAttribute("aria-label", `${partWords(s)}. Lights it on the map.`);
        b.addEventListener("click", () => press(s, b));
        li.appendChild(b);
        if (s.cause) {
          const a = el("a", "tw-cause-link", "Rank this cause");
          const key = s.why ? `waiting:${s.cause}:${s.why}` : `waiting:${s.cause}`;
          const safe = window.FactorySteps.isCauseKey(key) ? window.FactorySteps.causeRoute(key) : null;
          if (safe) a.href = safe;
          a.setAttribute("aria-label", `Rank ${W.causeWords(key)} across every task`);
          li.appendChild(a);
        }
        ul.appendChild(li);
      }
      if (!g.segments.length) ul.appendChild(el("li", "chart-empty", "none"));
      container.appendChild(ul);
    }
    for (const n of bar.notes) container.appendChild(el("p", "chart-caption", n));
    if (bar.partial) container.appendChild(el("p", "chart-caption", W.barPartialNote([...new Set([stackRow.lead_time_ms, row && row.working_ms, ...Object.values(stackRow.waste_ms || {}), ...Object.values(stackRow.class_ms || {})].flatMap((n) => (n && n.state === "partial" ? n.reasons : [])))].map(F.reasonText), bar.groups)));
    if (idle.source === "map") container.appendChild(el("p", "chart-caption", idle.burst_causes ? "The waiting split comes from this task's map: each wait between bursts and the idle moments inside bursts, each with what it waited on." : "The waiting split comes from this task's map: each wait between bursts with what it waited on, and idle moments inside bursts as cause not recorded."));

    // Its top causes, in Rank causes' keys and names, in two groups that
    // never mix: waiting (from the same idle split as the bar, so the list
    // and the bar agree) and working time labeled as waste.
    const tc = window.FactorySteps.taskCauses(row, idle);
    container.appendChild(el("h3", "bars-title", "Its top causes of waste, by time"));
    const causeGroup = (title, list, empty) => {
      container.appendChild(el("p", "cause-group", title));
      if (!list.length) {
        container.appendChild(el("p", "chart-empty", empty));
        return;
      }
      const ol = el("ol", "cause-list");
      for (const c of list) {
        const li = document.createElement("li");
        li.appendChild(c.key.startsWith("waiting:") ? waitSwatch(c.key.slice(8)) : swatch(W.causeSegment(c.key)));
        const a = el("a", "cause-link", W.causeWords(c.key));
        const safe = window.FactorySteps.isCauseKey(c.key) ? c.href : null;
        if (safe) a.href = safe;
        li.appendChild(a);
        li.appendChild(el("span", "cause-ms", W.durationWords(c.ms)));
        ol.appendChild(li);
      }
      container.appendChild(ol);
    };
    causeGroup("Waiting, by what it waited on", tc.waiting, "No waiting is recorded for this task.");
    causeGroup("Working time labeled as waste", tc.working, tc.working_state === "unavailable" ? `Not measured: ${tc.working_reasons.map(F.reasonText).join("; ") || "not recorded"}.` : "No labeled waste in this task's working time.");
    container.appendChild(el("p", "chart-caption", "Each cause opens its page on Rank causes, which ranks it against every task. That is step 3; step 2 compares this task's bar with every other task's."));
  }

  // -------------------------------------------------------- the task view

  let walkSeq = 0;
  async function renderTaskWalk(data, id, select) {
    const seq = ++walkSeq;
    const j = renderTaskHead(document.getElementById("task-head"), data.jobs, id);
    const ledeEl = document.getElementById("task-lede");
    const vsmEl = document.getElementById("vsm");
    const twEl = document.getElementById("time-went");
    renderJobDetail(document.getElementById("job-detail"), data.jobs, id, data.sessions);
    if (!j) {
      ledeEl.textContent = "";
      vsmEl.innerHTML = "";
      twEl.innerHTML = "";
      renderPicker(document.getElementById("task-picker"), data.jobs, null, id);
      return;
    }
    ledeEl.textContent = "Loading…";
    const [tasks, stack, map] = await Promise.all([walkFile("rollups/tasks.json"), walkFile("rollups/stackup.json"), walkFile(mapPath(j.id))]);
    if (seq !== walkSeq) return;
    const taskRows = tasks && Array.isArray(tasks.jobs) ? tasks.jobs : null;
    const row = taskRows ? taskRows.find((r) => r.job === j.id) || null : null;
    const stackRow = stack && Array.isArray(stack.jobs) ? stack.jobs.find((r) => r.job === j.id) || null : null;
    safely("task-picker", () => renderPicker(document.getElementById("task-picker"), data.jobs, taskRows, j.id));
    // One waiting figure for the lede, the map's summary and the bar.
    const idle = W.idleSplit(row, map);
    let drawn = null;
    // Every control that lights part of the map: the lede's numbers and the
    // parts of "Where this task's time went". One is pressed at a time.
    const tokens = [];
    const light = (tok, btn) => {
      if (!drawn) return;
      const on = drawn.highlight(tok);
      for (const b of tokens) b.setAttribute("aria-pressed", String(on && b === btn));
      if (on) drawn.root.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    let unlabeled = null;
    try {
      unlabeled = stackRow ? W.unlabeledMs(W.timeBar(stackRow, row, idle, F.SEGMENTS)) : null;
    } catch (err) {
      unlabeled = null;
    }
    safely("vsm", () => {
      drawn = renderMap(vsmEl, { j, map, row, tasksPublished: !!taskRows, idle, unlabeled });
    });
    safely("task-lede", () => {
      renderLede(ledeEl, row, !!taskRows, idle, light, unlabeled);
      // The finish day leads; the next sentence then starts "It took" (M3).
      ledeEl.prepend(el("span", "lede-finish", finishSentence(j)));
      const next = ledeEl.childNodes[1];
      if (next && next.nodeType === 3 && next.textContent.startsWith("This task took")) next.textContent = next.textContent.replace(/^This task took/, "It took");
      // The map's header names the day too.
      const vt = document.getElementById("vsm-title");
      if (vt) {
        const old = vt.querySelector(".vsm-finish");
        if (old) old.remove();
        vt.appendChild(el("span", "vsm-finish", ` · ${finishSentence(j, "short")}`));
      }
      // The operator's own time on this task (A1 I2).
      ledeEl.appendChild(el("span", "lede-operator", ` ${W.operatorTime(j, map && map.human_turns, map && map.human_turns_state, F.reasonText, F.reasonCore).text}`));
      tokens.push(...ledeEl.querySelectorAll(".lede-num"));
    });
    safely("time-went", () => {
      renderTimeWent(twEl, { j, row, stackRow, stackPublished: !!stack, idle, light });
      tokens.push(...twEl.querySelectorAll(".tw-part"));
    });
    // Redraw the map when the width crosses between phone and wide or
    // changes how many boxes fit.
    lastMapWidth = vsmEl.clientWidth;
    lastMapRender = () => safely("vsm", () => {
      drawn = renderMap(vsmEl, { j, map, row, tasksPublished: !!taskRows, idle, unlabeled });
    });
    if (select && drawn) safely("vsm", () => drawn.select(select));
  }

  let lastMapWidth = 0;
  let lastMapRender = null;
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const vsmEl = document.getElementById("vsm");
      if (!lastMapRender || !vsmEl || document.getElementById("view-task").hidden) return;
      if (Math.abs(vsmEl.clientWidth - lastMapWidth) < 40) return;
      lastMapWidth = vsmEl.clientWidth;
      lastMapRender();
    }, 150);
  });

  // ------------------------------------------------------- the swimlane

  const LANE_H = 26;
  const LABEL_ROW_H = 30;
  const AXIS_H = 24;
  // The Operator and Pull requests lanes, at the top.
  const OP_H = 22;
  const TOP_H = AXIS_H + 2 * OP_H;

  // The swimlane's Operator lane (a tick per prompt of this session, with a
  // band from the agent's stop to the prompt) and Pull requests lane (each
  // placed opened and merged time inside the session's span, outlined when
  // partial). Each lane is one tab stop; the arrow keys move along it.
  function drawClockLanes(s, ctx) {
    const { clock, sessionId, t0, t1, x, width, openMark, map } = ctx;
    const yOp = AXIS_H;
    const yPr = AXIS_H + OP_H;
    for (const y of [yOp + OP_H, yPr + OP_H]) s.appendChild(svg("line", { x1: 0, x2: width, y1: y, y2: y, class: "lane-rule" }));
    const note = (y, text) => {
      const t = svg("text", { x: 6, y: y + OP_H - 7, class: "lane-outside-label" });
      t.textContent = text;
      s.appendChild(t);
    };
    const keyed = (g, label, open, list) => {
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", label);
      g.setAttribute("tabindex", list.length ? "-1" : "0");
      const tt = svg("title", {});
      tt.textContent = label;
      g.appendChild(tt);
      g.addEventListener("click", () => open(g));
      g.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          open(g);
          return;
        }
        const pos = list.indexOf(g);
        const next = { ArrowRight: pos + 1, ArrowDown: pos + 1, ArrowLeft: pos - 1, ArrowUp: pos - 1, Home: 0, End: list.length - 1 }[evt.key];
        if (next === undefined) return;
        evt.preventDefault();
        const to = list[Math.max(0, Math.min(list.length - 1, next))];
        for (const q of list) q.setAttribute("tabindex", "-1");
        to.setAttribute("tabindex", "0");
        to.focus();
      });
      list.push(g);
    };
    // Operator lane.
    const ops = W.operatorLane(clock, sessionId);
    const opList = [];
    for (const o of ops) {
      if (o.band) {
        const a = Math.max(t0, o.band[0]);
        const b = Math.min(t1, o.band[1]);
        // At least 2 pixels, so a short stop still shows.
        if (b > a) s.appendChild(svg("rect", { x: x(a), y: yOp + 5, width: Math.max(2, x(b) - x(a)), height: OP_H - 10, class: "lane-op-band" }));
      }
    }
    // Pins merge into one count under MERGE_RULE (walk.js groupMarks, the
    // ladder's rule); a merged pin opens the list.
    const badgeW = (n) => 16 + 7 * String(n).length;
    const inLane = (pos, w) => Math.min(Math.max(pos, w / 2), width - w / 2);
    const opGroups = W.groupMarks(ops.map((o) => ({ ...o, pos: x(o.ms) })), 8, (n) => badgeW(n) + 4);
    for (const gr of opGroups) {
      if (gr.marks.length > 1) {
        const lg = W.ladderLanes({ prompts: gr.marks.map((o) => ({ ...o.mark, item: 0, frac: 0, outside: null })), prs: [] }, [0], { origin: ctx.origin }).prompts[0];
        const g = svg("g", { class: "lane-op lane-op-multi" });
        const cy = yOp + OP_H / 2;
        if (gr.to - gr.from >= 2) g.appendChild(svg("line", { x1: gr.from, x2: gr.to, y1: cy, y2: cy, class: "lane-op-span" }));
        const wpx = badgeW(gr.marks.length);
        const xx = inLane(gr.pos, wpx);
        g.appendChild(svg("rect", { x: xx - wpx / 2, y: cy - 7, width: wpx, height: 14, rx: 7, class: "lane-op-badge" }));
        const tx = svg("text", { x: xx, y: cy + 4, "text-anchor": "middle", class: "lane-pr-count" });
        tx.textContent = String(gr.marks.length);
        g.appendChild(tx);
        keyed(g, `${lg.label}. Opens the list.`, (n) => openMarkList(n, lg, openMark, ctx.origin), opList);
        s.appendChild(g);
        continue;
      }
      const o = gr.marks[0];
      const g = svg("g", { class: `lane-op why-${o.mark.why}` });
      const xx = x(o.ms);
      g.appendChild(svg("rect", { x: xx - 1, y: yOp + 6, width: 2, height: OP_H - 8, rx: 1 }));
      g.appendChild(svg("circle", { cx: xx, cy: yOp + 6, r: 3.5 }));
      // A wider target than the tick itself.
      g.appendChild(svg("rect", { x: xx - 6, y: yOp + 1, width: 12, height: OP_H - 2, class: "lane-hit" }));
      const t = o.mark.turn;
      keyed(g, `Operator prompt ${o.n} of ${o.mark.total}, ${W.clockAt(o.ms, ctx.origin)}${t.basis === "after_stop" && typeof t.window_ms === "number" ? `, ${W.durationWords(t.window_ms)} after the main agent stopped` : t.basis === "mid_turn" ? ", while the agent was still working" : ", the session's first prompt"}.${o.mark.why && o.mark.why !== "not_known" ? ` Why the agent had stopped: ${W.whyName(o.mark.why).toLowerCase()}.` : ""} Opens the evidence.`, (n) => openMark(n, { kind: "prompt", mark: o.mark }), opList);
      s.appendChild(g);
    }
    if (opList.length) opList[0].setAttribute("tabindex", "0");
    else {
      const st = W.clockListWords(map.human_turns_state, "operator prompts", F.reasonText);
      note(yOp, st && map.human_turns_state && map.human_turns_state.state === "unavailable" ? st : "no operator prompt recorded in this session");
    }
    // Pull requests lane.
    const lane = W.prLane(clock, t0, t1);
    const prList = [];
    // Glyphs merge under the same rule as the pins (walk.js groupMarks).
    const groups = W.groupMarks(lane.marks.map((m) => ({ ...m, pos: x(m.ms) })), 12, (n) => badgeW(n) + 12);
    groups.forEach((gr, k) => {
      const cy = yPr + OP_H / 2;
      const xx = gr.pos;
      if (gr.marks.length > 1) {
        const lg = W.ladderLanes({ prompts: [], prs: gr.marks.map((m) => ({ ...m, item: 0, frac: 0, outside: null })) }, [0], { origin: ctx.origin }).prs[0];
        const g = svg("g", { class: "lane-pr lane-pr-multi" });
        if (gr.to - gr.from >= 2) g.appendChild(svg("line", { x1: gr.from, x2: gr.to, y1: cy, y2: cy, class: "lane-pr-span" }));
        const wpx = badgeW(gr.marks.length);
        const bx = inLane(xx, wpx);
        g.appendChild(svg("rect", { x: bx - wpx / 2, y: cy - 7, width: wpx, height: 14, rx: 7, class: "lane-pr-badge" }));
        const tx = svg("text", { x: bx, y: cy + 4, "text-anchor": "middle", class: "lane-pr-count" });
        tx.textContent = String(gr.marks.length);
        g.appendChild(tx);
        keyed(g, `${lg.label}. Opens the list.`, (n) => openMarkList(n, lg, openMark, ctx.origin), prList);
        s.appendChild(g);
        return;
      }
      const m = gr.marks[0];
      const partial = m.state === "partial";
      const g = svg("g", { class: `lane-pr lane-pr-${m.kind}${partial ? " is-partial" : ""}` });
      g.appendChild(svg("path", { d: m.kind === "merged" ? `M${xx} ${cy - 6} L${xx + 6} ${cy} L${xx} ${cy + 6} L${xx - 6} ${cy} Z` : `M${xx} ${cy - 6} L${xx + 6} ${cy + 5} L${xx - 6} ${cy + 5} Z` }));
      const next = groups[k + 1];
      if (!next || next.from - xx > 44) {
        const tx = svg("text", { x: xx + 8, y: cy + 4, class: "lane-pr-label" });
        tx.textContent = `#${m.pr.number}`;
        g.appendChild(tx);
      }
      const q = partial ? (m.bound === "upper" ? "at most " : m.bound === "lower" ? "at least " : "about ") : "";
      const what = m.kind === "merged" ? "merged" : m.pr.created === true ? "opened by this task" : "first appeared in this task's sessions (drawn at GitHub's opening time)";
      keyed(g, `Pull request ${m.pr.repo}#${m.pr.number} ${what}, ${q}${W.clockAt(m.ms, ctx.origin)}${partial ? " (a time known only in part)" : ""}. Opens the evidence, with its link to GitHub.`, (n) => openMark(n, { kind: "pr", pr: m.pr, k: m.k }), prList);
      s.appendChild(g);
    });
    if (prList.length) prList[0].setAttribute("tabindex", "0");
    else note(yPr, lane.outside ? `no pull request time in this session (${lane.outside} elsewhere on the task's clock)` : "no pull request time placed in this session");
  }

  async function renderSwimlane(container, data, jobId, sessionId, select) {
    const seq = ++walkSeq;
    container.innerHTML = "";
    const j = jobId ? data.jobs.find((x) => x.id === jobId) : null;
    if (!j) {
      emptyState(container, "This session's task is not known, so its swimlane cannot be placed on a task clock.");
      return;
    }
    container.appendChild(el("p", "chart-empty", "Loading…"));
    const map = await walkFile(mapPath(j.id));
    if (seq !== walkSeq) return;
    container.innerHTML = "";
    const path = map && Array.isArray(map.detail_files) ? map.detail_files.find((p) => typeof p === "string" && p === `jobs/${j.id}/${sessionId}.json`) : null;
    if (!map) {
      emptyState(container, "The walk's data for this task is not published yet, so the swimlane cannot be drawn.");
      return;
    }
    if (!path) {
      emptyState(container, "No swimlane file is published for this session (only labeled sessions get one), so nothing is drawn rather than an empty lane.");
      return;
    }
    container.appendChild(el("p", "chart-empty", "Loading the session…"));
    const detail = await walkFile(path);
    if (seq !== walkSeq) return;
    container.innerHTML = "";
    if (!detail) {
      emptyState(container, "The session's swimlane file could not be read.");
      return;
    }
    const lw = map.lead_window || {};
    const origin = typeof lw.start_ms === "number" ? lw.start_ms : detail.offset_ms;
    const leadMs = typeof lw.start_ms === "number" && typeof lw.end_ms === "number" ? lw.end_ms - lw.start_ms : null;
    const ctxDrawer = { origin_ms: origin, lead_ms: leadMs, reasonText: F.reasonText };
    const clock = W.clockMarks(map, null);
    const openMark = Object.assign((opener, thing) => openClock(opener, thing, { j, map, ctxDrawer, clock }), { job: j });
    const intervals = Array.isArray(detail.intervals) ? detail.intervals : [];
    const stretches = Array.isArray(detail.stretches) ? detail.stretches : [];
    const allLanes = W.lanes(detail, map.agents);
    const subs = allLanes.filter((l) => l.worker !== 0);
    const t0 = typeof detail.offset_ms === "number" ? detail.offset_ms : Math.min(...intervals.map((i) => i.start_ms));
    const t1 = typeof detail.end_ms === "number" ? detail.end_ms : Math.max(...intervals.map((i) => i.end_ms));
    const span = Math.max(1, t1 - t0);

    container.appendChild(el("p", "chart-caption", `This session ran ${W.clockWords(t0, t1, origin)}. Drawn to scale: the Operator lane marks each prompt, with a band from the main agent's stop to the prompt; the Pull requests lane marks when each pull request first appeared in this task's sessions (a triangle, at GitHub's opening time) or merged (a diamond) in this session's span; below them each lane is one agent, gray marks are its activity, colored bands are the evaluator's labeled stretches and red ticks are failed tool calls.${subs.length ? " Subagent lanes are the subagents seen in this session's evidence, so they can show subagents the session's own count above does not record." : ""}`));
    if (detail.labels_from_shared_session) container.appendChild(el("p", "fix-action", "Labels come from a shared session: this session also worked on other tasks, so its labels were made for the whole session and only partly describe this task."));
    if (detail.intervals_binned) container.appendChild(el("p", "chart-caption", `This session's activity is published binned${typeof detail.resolution_ms === "number" ? ` to ${W.durationWords(detail.resolution_ms)}` : typeof detail.resolution === "number" ? ` to ${W.durationWords(detail.resolution)}` : ""}, so marks closer than that are merged.`));
    if (!detail.labeled) container.appendChild(el("p", "chart-caption", "This session is not labeled yet, so no stretch is drawn."));

    const controls = el("div", "lane-controls");
    const mk = (text, label) => {
      const b = el("button", "lane-btn", text);
      b.type = "button";
      b.setAttribute("aria-label", label);
      controls.appendChild(b);
      return b;
    };
    const fitB = mk("Fit", "Fit the whole session in the frame");
    const inB = mk("Zoom in", "Zoom in");
    const outB = mk("Zoom out", "Zoom out");
    // A shared session can run far longer than this task: a button fits the task's own part.
    const taskPart = leadMs !== null ? [Math.max(t0, origin), Math.min(t1, origin + leadMs)] : null;
    const partial = taskPart && taskPart[1] > taskPart[0] && taskPart[1] - taskPart[0] < span * 0.6;
    const taskB = partial ? mk("Fit this task", "Zoom to this task's part of the session") : null;
    const expandB = subs.length ? mk(`Show ${subs.length} subagent lane${subs.length === 1 ? "" : "s"}`, "Show one lane per subagent") : null;
    container.appendChild(controls);

    const frame = el("div", "lane-frame");
    frame.setAttribute("tabindex", "0");
    frame.setAttribute("aria-label", "The session swimlane; scroll sideways to move along the session");
    const inner = el("div", "lane-inner");
    const labels = el("div", "lane-labels");
    const plot = el("div", "lane-plot");
    inner.append(labels, plot);
    frame.appendChild(inner);
    container.appendChild(frame);

    let zoom = 1;
    let expanded = false;
    // The Labels row is one tab stop: arrow keys move between stretches
    // (a roving tabindex), Enter or Space opens one.
    let current = 0;
    const order = stretches.map((st, k) => k).sort((a, b) => stretches[a].start_ms - stretches[b].start_ms || a - b);

    const draw = () => {
      const frameW = Math.max(200, frame.clientWidth - 112);
      const steps = W.zoomSteps(span, frameW, 32768);
      zoom = Math.min(Math.max(1, zoom), steps[steps.length - 1]);
      inB.disabled = zoom >= steps[steps.length - 1];
      outB.disabled = zoom <= 1;
      const width = Math.round(frameW * zoom);
      const msPerPx = span / width;
      const x = (ms) => ((ms - t0) / span) * width;
      const lanesShown = expanded ? allLanes : [allLanes[0], ...(subs.length ? [{ worker: "subs", depth: 0, label: `Subagents seen (${subs.length})` }] : [])];
      const laneY = new Map();
      lanesShown.forEach((l, k) => laneY.set(l.worker, TOP_H + LABEL_ROW_H + k * LANE_H));
      const laneOf = (w) => (expanded || w === 0 ? w : "subs");
      const height = TOP_H + LABEL_ROW_H + lanesShown.length * LANE_H + 6;

      // Pinned labels.
      labels.innerHTML = "";
      labels.style.height = `${height}px`;
      const lab = (text, y, h, depth, cls) => {
        const d = el("div", `lane-label ${cls || ""}`, text);
        d.style.top = `${y}px`;
        d.style.height = `${h}px`;
        d.style.paddingLeft = `${6 + 10 * Math.min(3, depth)}px`;
        labels.appendChild(d);
      };
      lab("Operator", AXIS_H, OP_H, 0, "lane-label-labels");
      lab("Pull requests", AXIS_H + OP_H, OP_H, 0, "lane-label-labels");
      lab("Labels", TOP_H, LABEL_ROW_H, 0, "lane-label-labels");
      for (const l of lanesShown) lab(l.label, laneY.get(l.worker), LANE_H, l.depth);

      plot.innerHTML = "";
      const s = svg("svg", { width, height, class: "lane-svg", role: "group", "aria-label": "Swimlane of the session" });
      // Axis: ticks on the task clock.
      const tickMs = [SECOND_MS, 5 * SECOND_MS, 15 * SECOND_MS, 60000, 5 * 60000, 15 * 60000, 30 * 60000, 3600000, 2 * 3600000, 4 * 3600000, 8 * 3600000, 12 * 3600000, 86400000, 2 * 86400000].find((t) => t / msPerPx >= 90) || 7 * 86400000;
      const first = Math.ceil((t0 - origin) / tickMs) * tickMs + origin;
      for (let t = first; t <= t1; t += tickMs) {
        const xx = x(t);
        s.appendChild(svg("line", { x1: xx, x2: xx, y1: AXIS_H - 6, y2: height, class: "lane-grid" }));
        const tl = svg("text", { x: xx + 3, y: AXIS_H - 9, class: "lane-tick" });
        tl.textContent = W.clockTick(t - origin);
        s.appendChild(tl);
      }
      // Time outside this task's lead window (a shared session runs before
      // or after it) is shaded, so the task's own part stands out.
      if (leadMs !== null) {
        for (const [a, b, words] of [[t0, Math.min(t1, origin), "before this task"], [Math.max(t0, origin + leadMs), t1, "after this task"]]) {
          if (b <= a) continue;
          s.appendChild(svg("rect", { x: x(a), y: AXIS_H, width: Math.max(1, x(b) - x(a)), height: height - AXIS_H, class: "lane-outside" }));
          if (x(b) - x(a) > 110) {
            const tx = svg("text", { x: x(a) + 6, y: height - 8, class: "lane-outside-label" });
            tx.textContent = words;
            s.appendChild(tx);
          }
        }
      }
      // Lane rules.
      for (const l of lanesShown) s.appendChild(svg("line", { x1: 0, x2: width, y1: laneY.get(l.worker) + LANE_H, y2: laneY.get(l.worker) + LANE_H, class: "lane-rule" }));

      // Stretch bands across the lanes their evidence names (labels carry no lane).
      for (const st of stretches) {
        const seg = W.stretchSegment(st);
        const xa = x(st.start_ms);
        const w = Math.max(1, x(st.end_ms) - xa);
        const fill = st.class === "muda" && st.waste === "waiting" ? "url(#hatch-labeled-wait)" : segmentFill(seg, false);
        for (const wk of new Set(W.stretchWorkers(st, intervals).map(laneOf))) {
          if (!laneY.has(wk)) continue;
          s.appendChild(svg("rect", { x: xa, y: laneY.get(wk) + 2, width: w, height: LANE_H - 4, fill, class: "lane-band" }));
        }
      }
      // Activity: runs per lane, or density for the collapsed subagent lane.
      const actY = (wk) => laneY.get(wk) + LANE_H / 2 - 4;
      if (!expanded && subs.length) {
        for (const c of W.density(intervals, subs.map((l) => l.worker), t0, msPerPx, width)) {
          s.appendChild(svg("rect", { x: c.x, y: actY("subs"), width: c.w || 1, height: 8, class: "lane-act", "fill-opacity": Math.min(1, 0.25 + 0.15 * c.n) }));
        }
      }
      for (const l of expanded ? allLanes : [allLanes[0]]) {
        for (const [a, b] of W.activityRuns(intervals, l.worker, msPerPx)) {
          s.appendChild(svg("rect", { x: x(a), y: actY(l.worker), width: Math.max(1, x(b) - x(a)), height: 8, class: "lane-act" }));
        }
      }
      // Failed tool calls: red ticks, binned to pixel columns.
      for (const l of lanesShown) {
        const ws = l.worker === "subs" ? subs.map((q) => q.worker) : [l.worker];
        for (const tk of W.failureTicks(intervals, ws, t0, msPerPx)) {
          const r = svg("rect", { x: tk.x, y: laneY.get(l.worker) + 3, width: tk.n > 1 ? 3 : 2, height: LANE_H - 6, class: "lane-fail" });
          const tt = svg("title", {});
          tt.textContent = `${tk.n} failed tool call${tk.n === 1 ? "" : "s"}${tk.tools.length ? ` (${tk.tools.join(", ")})` : ""}`;
          r.appendChild(tt);
          s.appendChild(r);
        }
      }
      // The labels row: every stretch, opening its evidence; one tab stop.
      const ly = TOP_H + 3;
      const row = svg("g", { class: "lane-stretches", role: "group", "aria-label": `${stretches.length} labeled stretches; use the arrow keys to move between them and Enter to open one` });
      const marks = [];
      stretches.forEach((st, k) => {
        const seg = W.stretchSegment(st);
        const xa = x(st.start_ms);
        const w = Math.max(2, x(st.end_ms) - xa);
        const g = svg("g", { class: "lane-stretch", tabindex: k === current ? 0 : -1, role: "button" });
        marks[k] = g;
        const c = W.drawer({ kind: "stretch", stretch: st, index: k, total: stretches.length, intervals, lanes: allLanes }, ctxDrawer);
        g.setAttribute("aria-label", `Stretch ${k + 1} of ${stretches.length}: ${c.title}, ${W.durationWords(st.end_ms - st.start_ms)}${st.waited_on ? `, ${W.waitedOnWords(st.waited_on, "short")}` : ""}. Opens the evidence.`);
        const isWait = st.class === "muda" && st.waste === "waiting";
        g.appendChild(svg("rect", { x: xa, y: ly, width: w, height: LABEL_ROW_H - 6, fill: isWait ? "url(#hatch-labeled-wait)" : segmentFill(seg, false), class: `lane-stretch-rect seg-${seg}` }));
        if (isWait && w > 120) {
          const t = svg("text", { x: xa + 4, y: ly + LABEL_ROW_H - 11, class: "lane-wait-label" });
          t.textContent = W.waitLabel(st.waited_on);
          g.appendChild(t);
        }
        const go = () => {
          current = k;
          for (const m of marks) if (m) m.setAttribute("tabindex", "-1");
          g.setAttribute("tabindex", "0");
          openStretch(g, j, detail, k, allLanes, ctxDrawer);
        };
        g.addEventListener("click", go);
        g.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            go();
            return;
          }
          const pos = order.indexOf(k);
          const next = { ArrowRight: pos + 1, ArrowDown: pos + 1, ArrowLeft: pos - 1, ArrowUp: pos - 1, Home: 0, End: order.length - 1 }[evt.key];
          if (next === undefined) return;
          evt.preventDefault();
          const to = order[Math.max(0, Math.min(order.length - 1, next))];
          focusStretch(to);
        });
        row.appendChild(g);
      });
      s.appendChild(row);
      drawClockLanes(s, { clock, sessionId, t0, t1, x, width, openMark, map, origin });
      plot.appendChild(s);
      focusStretch = (k) => {
        const m = marks[k];
        if (!m) return;
        for (const q of marks) if (q) q.setAttribute("tabindex", "-1");
        m.setAttribute("tabindex", "0");
        current = k;
        // Keep the focused stretch in view inside the scrolling frame.
        const xa = x(stretches[k].start_ms);
        if (xa < frame.scrollLeft || xa > frame.scrollLeft + frame.clientWidth - 130) frame.scrollLeft = Math.max(0, xa - 40);
        m.focus({ preventScroll: true });
      };
    };
    let focusStretch = () => {};

    const zoomTo = (z) => {
      const center = (frame.scrollLeft + frame.clientWidth / 2) / Math.max(1, frame.scrollWidth);
      zoom = z;
      draw();
      frame.scrollLeft = Math.max(0, center * frame.scrollWidth - frame.clientWidth / 2);
    };
    fitB.addEventListener("click", () => zoomTo(1));
    const fitTask = () => {
      const frameW = Math.max(200, frame.clientWidth - 112);
      const steps = W.zoomSteps(span, frameW, 32768);
      const want = span / (taskPart[1] - taskPart[0]);
      zoom = steps.filter((z) => z <= want).pop() || 1;
      draw();
      frame.scrollLeft = Math.max(0, ((taskPart[0] - t0) / span) * frameW * zoom - 8);
    };
    if (taskB) taskB.addEventListener("click", fitTask);
    inB.addEventListener("click", () => zoomTo(zoom * 2));
    outB.addEventListener("click", () => zoomTo(zoom / 2));
    if (expandB) {
      expandB.addEventListener("click", () => {
        expanded = !expanded;
        expandB.textContent = expanded ? "Collapse subagents into one lane" : `Show ${subs.length} subagent lane${subs.length === 1 ? "" : "s"}`;
        expandB.setAttribute("aria-expanded", String(expanded));
        draw();
      });
      expandB.setAttribute("aria-expanded", "false");
    }
    if (taskB) fitTask();
    else draw();
    // A deep link (?stretch=17) focuses that stretch and opens its evidence.
    if (select && select.kind === "stretch" && stretches[select.from - 1]) {
      const k = select.from - 1;
      focusStretch(k);
      openStretch(document.activeElement, j, detail, k, allLanes, ctxDrawer);
    }

    // Legend.
    const legend = el("ul", "lane-legend");
    const li = (node, text) => {
      const x = document.createElement("li");
      x.appendChild(node);
      x.appendChild(document.createTextNode(text));
      legend.appendChild(x);
    };
    const keyFor = (cls) => {
      const k = el("span", `lane-key ${cls}`);
      k.setAttribute("aria-hidden", "true");
      return k;
    };
    const present = new Set(stretches.map(W.stretchSegment));
    for (const sg of F.SEGMENTS) if (present.has(sg.key) && sg.key !== "waiting") li(swatch(sg.key), sg.label);
    if (stretches.some((x) => x.class === "muda" && x.waste === "waiting")) li(keyFor("lane-key-wait"), `${W.LABELED_PAUSE} (cross-hatched): a stretch the evaluator labeled waiting, with what it waited on; it is not the page's waiting, which is idle time`);
    if (leadMs !== null && (t0 < origin || t1 > origin + leadMs)) li(keyFor("lane-key-outside"), "Shaded: outside this task's lead time");
    const glyphKey = (kind, opts) => {
      const k = el("span", "lane-key lane-key-glyph");
      k.setAttribute("aria-hidden", "true");
      k.appendChild(clockGlyph(kind, opts));
      return k;
    };
    li(glyphKey("prompt"), "Operator prompt; the band before it runs from the main agent's stop to the prompt (other agents may have been working)");
    li(glyphKey("opened"), "Pull request first appeared in this task's sessions (drawn at GitHub's opening time)");
    li(glyphKey("merged"), "Pull request merged");
    li(glyphKey("opened", { partial: true }), "Outlined: a time known only in part");
    li(el("span", "lane-key-count", "2"), MERGE_RULE);
    li(keyFor("lane-key-act"), "Agent activity (turns, tool calls, subagents)");
    li(keyFor("lane-key-fail"), "Failed tool call (wider where several share a pixel)");
    container.appendChild(legend);
    container.appendChild(el("p", "chart-caption", "Labels carry no lane: the evaluator labels a stretch of the session, and the band is drawn on each lane its evidence names. The Labels row shows every stretch once; select one for its evidence."));

    // Text equivalent: every stretch as a table.
    const det = el("details", "more-details");
    det.appendChild(el("summary", null, `The ${stretches.length} labeled stretches as a table`));
    const table = el("table", "data-table vsm-table");
    tableHead(table, [["Stretch", ""], ["On the task clock", ""], ["Length", "num"], ["Waited on", ""], ["Confidence", ""], ["Evidence", "num"]]);
    const tb = document.createElement("tbody");
    for (const st of stretches) {
      const tr = document.createElement("tr");
      const k = stretches.indexOf(st);
      const c = W.drawer({ kind: "stretch", stretch: st, index: k, total: stretches.length, intervals, lanes: allLanes }, ctxDrawer);
      const b = el("button", "link-button", `${k + 1}. ${c.title}`);
      b.type = "button";
      b.addEventListener("click", () => openStretch(b, j, detail, k, allLanes, ctxDrawer));
      const td = el("td");
      td.appendChild(b);
      tr.appendChild(td);
      for (const [v, cl] of [[W.clockWords(st.start_ms, st.end_ms, origin), ""], [W.durationShort(st.end_ms - st.start_ms), "num"], [st.waited_on ? W.waitedOnWords(st.waited_on, "short") : "—", ""], [st.confidence || "—", ""], [String((st.evidence || []).length), "num"]]) tr.appendChild(el("td", cl, v));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const tw = el("div", "table-wrap");
    tw.appendChild(table);
    det.appendChild(tw);
    container.appendChild(det);
  }
  // ------------------------------------------------------------- routing
  // Hash routes (format.js parseRoute): #/task/<key> (and #/ for the task
  // that finished last), #/task/<key>/session/<id>, #/compare, #/causes,
  // #/act, #/why, #/about and #/store. The first site's #job-<key>,
  // #session-<id> and section anchors redirect to their new homes.

  // The skip link moves focus to the content without changing the hash, so
  // it never leaves a #main behind for the router (or a reload) to read.
  const skipLink = document.querySelector(".skip-link");
  if (skipLink) {
    skipLink.addEventListener("click", (evt) => {
      const main = document.getElementById("main");
      if (!main) return;
      evt.preventDefault();
      main.focus();
    });
  }

  // ======================================================= steps 2 to 4
  // Compare tasks, Rank causes (with each cause's own page) and Act. Every
  // rule lives in steps.js; this only draws what it returns.

  const S = window.FactorySteps;
  let stepSeq = 0;
  // A chart's mode: "all" or "working"; Compare tasks also has "share".
  const modes = { compare: "all", causes: "all" };
  // Compare's Over time: By week or Each task, and what the bars count.
  const overTimeView = { over: "week", otmode: "share" };
  let lastStepRender = null;
  let lastStepWidth = 0;

  // A cause's fill: a waiting cause in its warm family ("cause not recorded"
  // hatched), any other cause in its waste's color, "Other" in neutral.
  function causeFill(bar) {
    if (bar.wait) return bar.wait === "unknown" ? "url(#hatch-waiting)" : `var(--c-wait-${W.WAIT_KEYS.includes(bar.wait) ? bar.wait : "unknown"})`;
    if (bar.segment === "other") return "var(--baseline)";
    return segmentFill(bar.segment, false);
  }
  function causeSwatch(key) {
    const k = String(key);
    const kp = k.split(":");
    if (kp.length === 3 && kp[1] === "next_prompt") return whySwatch(kp[2]);
    if (k.startsWith("waiting:")) return waitSwatch(k.slice(8));
    if (k === "other") {
      const sw = el("span", "swatch");
      sw.setAttribute("aria-hidden", "true");
      sw.style.setProperty("--sw", "var(--baseline)");
      return sw;
    }
    return swatch(W.causeSegment(k));
  }
  // A cause link: only a key steps.js accepts becomes a route.
  function causeLink(key, text) {
    const a = el("a", "cause-link", text || W.causeWords(key));
    const safe = S.isCauseKey(key) ? S.causeRoute(key) : null;
    if (safe) a.href = safe;
    return a;
  }

  // The two buttons that switch a chart between all elapsed time and agent
  // working time.
  function wireModes(viewId, which, redraw) {
    for (const b of document.querySelectorAll(`#${viewId} .mode-btn[data-mode]`)) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === modes[which]));
      b.onclick = () => {
        modes[which] = b.dataset.mode === "working" || (b.dataset.mode === "share" && which === "compare") ? b.dataset.mode : "all";
        for (const x of document.querySelectorAll(`#${viewId} .mode-btn[data-mode]`)) x.setAttribute("aria-pressed", String(x.dataset.mode === modes[which]));
        // The mode goes in the URL, so a link or a reload opens this view.
        try {
          history.replaceState(null, "", which === "compare" ? F.compareHash({ mode: modes.compare, ...overTimeView }) : `#/${which}${modes[which] !== "all" ? `?mode=${modes[which]}` : ""}`);
        } catch (err) {
          /* a sandboxed frame may refuse; the mode still applies */
        }
        redraw();
      };
    }
  }

  // A hover and focus tooltip on an SVG mark.
  function markTip(node, title, rows) {
    const show = (evt) => {
      const r = node.getBoundingClientRect();
      const x = evt && typeof evt.clientX === "number" && evt.clientX ? evt.clientX : r.left + r.width / 2;
      const y = evt && typeof evt.clientY === "number" && evt.clientY ? evt.clientY : r.top;
      showTooltipAt(x, y, title, rows);
    };
    node.addEventListener("mousemove", show);
    node.addEventListener("focus", () => show(null));
    node.addEventListener("mouseleave", hideTooltip);
    node.addEventListener("blur", hideTooltip);
  }

  // An SVG link to an in-page route (a task or a cause), with its label.
  function svgLink(href, label) {
    const a = svg("a", { class: "chart-link" });
    if (typeof href === "string" && /^#\/[0-9A-Za-z_\/:.-]+$/.test(href)) a.setAttribute("href", href);
    a.setAttribute("aria-label", label);
    return a;
  }

  // A bar group's time with its bound; a true zero is "none", never "at least none".
  const groupWords = S.groupWords;

  // Text cut to fit a label: "Revocable sessions: sign…".
  const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

  // A sentence with the count, then the tasks it counts behind a
  // disclosure, by full name (finished tasks with no waste labels, on Rank
  // causes and on Act).
  function unlabeledNote(node, data, where) {
    if (!node) return;
    node.innerHTML = "";
    const list = S.unlabeledFinished(data && data.jobs, (j) => jobLabel(j));
    const words = S.unlabeledWords(list.length, where);
    node.hidden = !words;
    if (!words) return;
    node.appendChild(el("p", "unlabeled-words", words));
    const det = el("details", "unlabeled-list");
    det.appendChild(el("summary", null, `Show the ${list.length === 1 ? "task" : `${list.length} tasks`}`));
    const ul = el("ul", "plain-list");
    for (const t of list) {
      const li = document.createElement("li");
      li.appendChild(jobLink(t.job, t.name));
      ul.appendChild(li);
    }
    det.appendChild(ul);
    node.appendChild(det);
  }

  // ------------------------------------------------- step 2: the stack-up

  const SB = { axisW: 46, top: 40, labelH: 118 };

  function drawStackup(container, bars, mode, marked) {
    container.innerHTML = "";
    if (!bars.length) {
      emptyState(container, "No task is published yet, so there is nothing to compare.");
      return;
    }
    const phone = container.clientWidth < 600;
    const H = phone ? 220 : 280;
    // "Share of each task": every bar is its own lead time as 0 to 100%, so
    // the bars are full height and their labels need room above them.
    const share = mode === "share";
    const T = share ? 104 : SB.top;
    const avail = Math.max(200, container.clientWidth - SB.axisW - 4);
    // A few bars (agent working time mode) get wider columns.
    const colW = Math.max(phone ? 28 : 26, Math.min(bars.length <= 12 ? 64 : 40, Math.floor(avail / bars.length)));
    const plotW = colW * bars.length + 8;
    const drawn = bars.filter((b) => b.state !== "no_data" && typeof b.total_ms === "number");
    // Headroom above the tallest bar for its value label.
    const scale = share ? { unit: "share", per: 1, max_ms: 1, ticks: [0, 0.25, 0.5, 0.75, 1] } : S.timeScale(Math.max(0, ...drawn.map((b) => b.total_ms)) * 1.15);
    const y = (ms) => T + H - (ms / scale.max_ms) * H;
    const totalH = T + H + SB.labelH;

    const row = el("div", "sb-row");
    // The axis stays put while the bars scroll inside their frame.
    const axis = svg("svg", { class: "sb-axis", width: SB.axisW, height: totalH, "aria-hidden": "true" });
    axis.appendChild(svg("text", { x: 12, y: T + H / 2, class: "axis-title", transform: `rotate(-90 12 ${T + H / 2})`, "text-anchor": "middle" })).textContent = share ? (phone ? "% of lead time" : "% of each task's lead time") : `${scale.unit === "hours" ? "Hours" : "Minutes"}${mode === "working" ? " of agent work" : " elapsed"}`;
    for (const t of scale.ticks) {
      const ty = y(t);
      const tx = svg("text", { x: SB.axisW - 6, y: ty + 4, class: "axis-tick", "text-anchor": "end" });
      tx.textContent = share ? `${Math.round(t * 100)}%` : S.tickWords(t, scale);
      axis.appendChild(tx);
    }
    row.appendChild(axis);

    const frame = el("div", "sb-frame chart-frame");
    const plot = svg("svg", { class: "sb-plot", width: plotW, height: totalH, role: "group", "aria-label": share ? `Stack-up of ${bars.length} tasks, each as shares of its own lead time on a 0 to 100% axis. Each bar is a link to its task.` : `Stack-up of ${bars.length} tasks, ${mode === "working" ? "agent working time" : "all elapsed time"}, in ${scale.unit}, linear from zero. Each bar is a link to its task.` });
    for (const t of scale.ticks) plot.appendChild(svg("line", { x1: 0, x2: plotW, y1: y(t), y2: y(t), class: t === 0 ? "sb-base" : "sb-grid" }));
    // The two groups, named above the bars.
    const firstOpen = bars.findIndex((b) => b.group === "open");
    const groupLabel = (x, text) => {
      const t = svg("text", { x, y: 14, class: "sb-group" });
      t.textContent = text;
      plot.appendChild(t);
    };
    if (firstOpen !== 0) groupLabel(4, phone ? "Finished →" : "Finished, by finish day (UTC) →");
    if (firstOpen > 0) plot.appendChild(svg("line", { x1: firstOpen * colW + 2, x2: firstOpen * colW + 2, y1: 4, y2: T + H, class: "sb-divider" }));
    if (firstOpen >= 0) groupLabel(firstOpen * colW + 8, phone ? "Still open →" : "Still open, by when work began →");

    const barW = colW - 8;
    bars.forEach((b, i) => {
      const x0 = i * colW + 4 + 4;
      const label = `${b.name}${b.finish && b.finish.kind !== "open" ? (b.finish.day ? `, finished ${b.finish.words} (UTC)` : `, finished, ${b.finish.words}`) : ""}: ${b.state === "no_data" ? "no data" : share ? (b.state === "unsplit" ? `lead time ${b.words}, split not known` : `${b.label} of a lead time of ${b.words}`) : b.words}${b.open ? ", still open" : ""}${b.unlabeled ? ", not labeled yet" : ""}${b.shared ? ", partial (labels from a shared session)" : ""}`;
      const a = svgLink(b.href, `${label}. Follow this task.`);
      a.setAttribute("class", `chart-link sb-col${b.open ? " is-open" : ""}`);
      a.appendChild(svg("rect", { x: i * colW + 4, y: T - 18, width: colW, height: H + 18 + SB.labelH - 6, class: "hit" }));
      if (b.state === "no_data") {
        a.appendChild(svg("rect", { x: x0, y: T + H - 18, width: barW, height: 18, class: "sb-nodata" }));
        const q = svg("text", { x: x0 + barW / 2, y: T + H - 5, class: "sb-nodata-q", "text-anchor": "middle" });
        q.textContent = "?";
        a.appendChild(q);
      } else {
        let base = 0;
        for (const s of b.segments) {
          const h = (s.ms / scale.max_ms) * H;
          const top = y(base + s.ms);
          const fill = s.key === "unsplit" ? "url(#hatch-unsplit)" : s.cause ? (s.cause === "unknown" ? "url(#hatch-waiting)" : `var(--c-wait-${s.cause})`) : s.key === "working_unsplit" ? "transparent" : segmentFill(s.key, false);
          const r = svg("rect", { x: x0, y: top, width: barW, height: Math.max(0, h), class: `sb-seg seg-${s.cause ? `wait-${s.cause}` : s.key}` });
          r.style.fill = fill;
          const seg = SEGMENT_BY_KEY.get(s.key);
          if ((seg && seg.fill === "outline") || s.key === "working_unsplit" || s.key === "unsplit") {
            r.style.stroke = s.key === "unsplit" ? "var(--baseline)" : `var(${seg ? seg.token : "--c-not-labeled"})`;
            r.style.strokeWidth = "1.2";
          }
          a.appendChild(r);
          base += s.ms;
        }
        if (b.open) {
          const top = Math.min(y(b.total_ms), T + H - 3);
          a.appendChild(svg("rect", { x: x0 - 2.5, y: top - 2.5, width: barW + 5, height: T + H - top + 2.5, class: "sb-open" }));
        }
      }
      // Value and name read upward, so neighbors never overlap.
      const vy = b.state === "no_data" ? T + H - 22 : Math.min(y(b.total_ms), T + H) - 4;
      const vx = x0 + barW / 2 + 4;
      const v = svg("text", { x: vx, y: vy, class: "sb-value", transform: `rotate(-90 ${vx} ${vy})` });
      v.textContent = b.state === "no_data" ? "" : `${b.label}${b.shared ? "*" : ""}`;
      a.appendChild(v);
      // Under each bar: its finish day (UTC) and its name, two lines read upward.
      const dated = b.finish && b.finish.kind !== "open";
      const lx = x0 + barW / 2 + (dated ? 9 : 4);
      const ly = T + H + 8;
      const name = svg("text", { x: lx, y: ly, class: "sb-name", "text-anchor": "end", transform: `rotate(-90 ${lx} ${ly})` });
      name.textContent = clip(b.name, 18);
      a.appendChild(name);
      if (dated) {
        const dx = lx - 11;
        const day = svg("text", { x: dx, y: ly, class: "sb-day", "text-anchor": "end", transform: `rotate(-90 ${dx} ${ly})` });
        day.textContent = b.finish.short;
        a.appendChild(day);
      }
      const tipRows = [];
      if (b.state === "no_data") tipRows.push({ label: "Not measured", value: (b.reasons || []).map(F.reasonText).join("; ") || "not recorded" });
      else {
        tipRows.push({ label: mode === "working" ? "Agent working time" : "Lead time", value: b.words });
        for (const g of b.groups) tipRows.push({ label: g.label, value: share ? `${S.shortPct(g.share_of_lead)} of the lead time` : groupWords(g) });
        if (b.state === "unsplit") tipRows.push({ label: "Split", value: `not known: ${(b.reasons || []).map(F.reasonText).join("; ") || "not recorded"}` });
      }
      if (b.finish && b.finish.kind !== "open") tipRows.push({ label: "Finished (UTC)", value: b.finish.words });
      if (b.open) tipRows.push({ label: "State", value: "still open, figures so far" });
      if (b.shared) tipRows.push({ label: "Partial", value: "its labels come from a session it shared with other tasks" });
      markTip(a, b.name, tipRows);
      plot.appendChild(a);
    });
    // A direct label on the finished task with the most waste, so the chart
    // itself names it: above its value, with a short leader down to the bar.
    if (marked && bars[marked.index] && bars[marked.index].job === marked.job) {
      const b = bars[marked.index];
      const cx = marked.index * colW + 8 + barW / 2;
      const valueTop = Math.min(y(b.total_ms), T + H) - 4 - (b.label.length + (b.shared ? 1 : 0)) * 6.4 - 4;
      const ty = 30;
      const right = cx + 150 > plotW;
      const t = svg("text", { x: right ? cx + 4 : cx - 4, y: ty, class: "sb-callout", "text-anchor": right ? "end" : "start" });
      t.textContent = marked.label;
      plot.appendChild(t);
      if (valueTop > ty + 6) plot.appendChild(svg("line", { x1: cx, x2: cx, y1: ty + 4, y2: valueTop, class: "sb-callout-line" }));
    }
    frame.appendChild(plot);
    row.appendChild(frame);
    container.appendChild(row);

    // The legend: the parts that appear, in stacking order, then the marks.
    const present = new Set(bars.flatMap((b) => b.segments.map((s) => (s.cause ? `wait_${s.cause}` : s.key))));
    const legend = el("div", "sb-legend");
    const group = (title, items) => {
      if (!items.length) return;
      const g = el("div", "sb-legend-group");
      g.appendChild(el("p", "sb-legend-title", title));
      const ul = el("ul", "tw-legend");
      for (const [sw, text] of items) {
        const li = document.createElement("li");
        li.appendChild(sw);
        li.appendChild(el("span", "tw-name", text));
        ul.appendChild(li);
      }
      g.appendChild(ul);
      legend.appendChild(g);
    };
    group("Working, by the evaluator's labels (from the base up)", [...F.SEGMENTS.filter((s) => present.has(s.key)).map((s) => [swatch(s.key), s.label]), ...(present.has("working_unsplit") ? [[swatch("not_labeled"), "Working, not split by label"]] : [])]);
    if (mode !== "working") group("Then waiting, by what it waited on", W.WAIT_KEYS.filter((k) => present.has(`wait_${k}`)).map((k) => [waitSwatch(k), W.waitCauseLabel(k)]));
    const marks = [];
    const keyFor = (cls) => {
      const k = el("span", `sb-key ${cls}`);
      k.setAttribute("aria-hidden", "true");
      return k;
    };
    if (present.has("unsplit")) marks.push([keyFor("sb-key-unsplit"), "Split not known: the lead time alone, because a session's log could not be read"]);
    if (bars.some((b) => b.open)) marks.push([keyFor("sb-key-open"), "Dashed outline: still open, so its figures are so far"]);
    if (bars.some((b) => b.shared)) marks.push([keyFor("sb-key-star"), "Partial: its labels come from a session it shared with other tasks"]);
    if (bars.some((b) => b.finish && b.finish.kind !== "open")) marks.push([Object.assign(keyFor("sb-key-day"), { textContent: "7 Oct" }), "Under each finished bar, its finish day (UTC): plain when measured, ≤ on or before, ≥ on or after, ~ direction not known, \"no date\" with the reason in its tooltip"]);
    if (bars.some((b) => b.state === "no_data")) marks.push([Object.assign(keyFor("sb-key-nodata"), { textContent: "?" }), mode === "working" ? "Not measured: no working time is known for it, so no bar is drawn rather than a zero" : "Not measured: no lead time is known for it, so no bar is drawn rather than a zero"]);
    group("Marks", marks);
    container.appendChild(legend);
  }

  // ------------------------------------------------- step 2: over time

  // The fill of one part of a week's bar, as on the stack-up.
  function partFill(s) {
    if (s.key === "unsplit") return "url(#hatch-unsplit)";
    if (s.cause) return s.cause === "unknown" ? "url(#hatch-waiting)" : `var(--c-wait-${W.WAIT_KEYS.includes(s.cause) ? s.cause : "unknown"})`;
    return segmentFill(s.key, false);
  }
  // A cause's color in the cause × week table.
  function causeFillCss(row) {
    if (row.wait) return row.wait === "unknown" ? "var(--c-waste-waiting)" : `var(--c-wait-${W.WAIT_KEYS.includes(row.wait) ? row.wait : "unknown"})`;
    const seg = SEGMENT_BY_KEY.get(row.segment);
    return seg && seg.fill === "solid" ? `var(${seg.token})` : "var(--c-waste-unknown)";
  }
  // A frame that scrolls inside itself opens at its newest (right) end, and
  // says so when it scrolls.
  function newestInView(frame, cueParent) {
    const fix = () => {
      if (frame.scrollWidth > frame.clientWidth + 1) {
        frame.scrollLeft = frame.scrollWidth;
        if (cueParent && !cueParent.querySelector(":scope > .ot-cue")) cueParent.appendChild(el("p", "ot-cue", "← Older weeks: scroll this chart sideways. The newest week is on the right."));
      }
    };
    fix();
    requestAnimationFrame(fix);
  }
  // A small arrow under a week whose days are bounds (B1): left when its
  // tasks may have finished earlier, right when later, both ways for both.
  function dayBracket(parent, x0, w, y, bracket) {
    if (!bracket) return;
    const mid = x0 + w / 2;
    const half = Math.min(10, w / 2 - 2);
    if (half < 3) return;
    if (bracket === "left" || bracket === "both") parent.appendChild(svg("path", { d: `M${mid} ${y} H${mid - half} m3 -3 l-3 3 l3 3`, class: "ot-bracket" }));
    if (bracket === "right" || bracket === "both") parent.appendChild(svg("path", { d: `M${mid} ${y} H${mid + half} m-3 -3 l3 3 l-3 3`, class: "ot-bracket" }));
  }

  // By week: one stacked bar per finish week (B3).
  function drawWeekBars(container, ot, mode) {
    container.innerHTML = "";
    const bars = S.weekBars(ot, mode);
    const share = mode === "share";
    const axisW = SB.axisW;
    const avail = Math.max(200, container.clientWidth - axisW - 4);
    const ax = S.weekAxis(bars.length, avail, { min: 10, max: 96, labelPx: 52, valuePx: 34 });
    const H = container.clientWidth < 600 ? 200 : 240;
    const T = 22;
    const drawn = bars.filter((b) => !b.empty && typeof b.total === "number");
    const scale = share ? { unit: "share", max_ms: 1, ticks: [0, 0.25, 0.5, 0.75, 1] } : S.timeScale(Math.max(0, ...drawn.map((b) => b.total)) * 1.1);
    const y = (v) => T + H - (v / scale.max_ms) * H;
    // A line under the week labels when any week has tasks with no split.
    const anyUnsplit = bars.some((b) => b.unsplit && b.unsplit.n > 0);
    const totalH = T + H + 46 + (anyUnsplit ? 16 : 0);
    const row = el("div", "sb-row");
    const axis = svg("svg", { class: "sb-axis", width: axisW, height: totalH, "aria-hidden": "true" });
    axis.appendChild(svg("text", { x: 12, y: T + H / 2, class: "axis-title", transform: `rotate(-90 12 ${T + H / 2})`, "text-anchor": "middle" })).textContent = share ? "% of the week's lead time" : `${scale.unit === "hours" ? "Hours" : "Minutes"}${mode === "working" ? " of agent work" : " elapsed"}`;
    for (const t of scale.ticks) {
      const tx = svg("text", { x: axisW - 6, y: y(t) + 4, class: "axis-tick", "text-anchor": "end" });
      tx.textContent = share ? `${Math.round(t * 100)}%` : S.tickWords(t, scale);
      axis.appendChild(tx);
    }
    row.appendChild(axis);
    const frame = el("div", "sb-frame chart-frame ot-scroll");
    const plot = svg("svg", { class: "sb-plot", width: ax.width, height: totalH, role: "group", "aria-label": `By week: ${bars.length} finish weeks, ${share ? "each part as a share of the week's lead time" : mode === "working" ? "hours of agent working time" : "hours of all elapsed time"}, linear from zero, the oldest on the left. Each bar's label names its tasks and how sure their days are.` });
    for (const t of scale.ticks) plot.appendChild(svg("line", { x1: 0, x2: ax.width, y1: y(t), y2: y(t), class: t === 0 ? "sb-base" : "sb-grid" }));
    const barW = Math.max(4, Math.min(44, ax.colW - (ax.colW > 20 ? 10 : 3)));
    bars.forEach((b, i) => {
      const x0 = i * ax.colW;
      const bx = x0 + (ax.colW - barW) / 2;
      const g = svg("g", { tabindex: "0", role: "img", class: "ot-week" });
      const parts = b.segments.map((s) => `${s.label} ${share ? S.overTimeCell({ state: s.state, value: s.share, reasons: ["x"], bound: s.bound }, false, "share").words : S.overTimeCell({ state: s.state, value: s.ms, reasons: ["x"], bound: s.bound }, false, "hours").words}`);
      g.setAttribute("aria-label", b.empty ? `Week of ${b.label}: no task finished.` : `Week of ${b.label}: ${b.count}; ${b.days.words}.${b.unsplit && b.unsplit.n ? ` ${b.unsplit.words}.` : ""} ${b.totalWords}. ${parts.join("; ")}.`);
      if (b.empty) {
        g.appendChild(svg("rect", { x: x0 + 2, y: T, width: Math.max(2, ax.colW - 4), height: H, class: "ot-empty" }));
        if (ax.showValues) {
          const t = svg("text", { x: x0 + ax.colW / 2, y: T + H - 6, class: "ot-empty-text", "text-anchor": "middle" });
          t.textContent = "none";
          g.appendChild(t);
        }
      } else {
        let base = 0;
        for (const s of b.segments) {
          const v = share ? s.share : s.ms;
          const top = y(base + v);
          const h = Math.max(0, y(base) - top);
          const r = svg("rect", { x: bx, y: top, width: barW, height: h, class: "sb-seg" });
          r.style.fill = partFill(s);
          g.appendChild(r);
          if (s.state === "partial" && h > 2) g.appendChild(svg("rect", { x: bx, y: top, width: barW, height: h, fill: "url(#ot-partial)" }));
          base += v;
        }
        if (ax.showValues) {
          const t = svg("text", { x: x0 + ax.colW / 2, y: (share ? T : y(typeof b.total === "number" ? b.total : 0)) - 5, class: "ot-value", "text-anchor": "middle" });
          t.textContent = `${b.n}${b.thin ? "*" : ""}`;
          g.appendChild(t);
        }
      }
      if (ax.brackets) dayBracket(g, x0, ax.colW, T + H + 8, b.days && b.days.bracket);
      const lab = ax.labels.find((l) => l.i === i);
      if (lab) {
        const t = svg("text", { x: lab.x + (x0 - i * ax.colW), y: T + H + 26, class: "axis-tick", "text-anchor": lab.anchor });
        t.textContent = b.label;
        g.appendChild(t);
      }
      // Under the bar: how many of its tasks have no working/waiting split yet (A1 I7).
      if (b.unsplit && b.unsplit.n && ax.showValues) {
        const t = svg("text", { x: x0 + ax.colW / 2, y: T + H + 42, class: "axis-tick ot-unsplit", "text-anchor": "middle" });
        t.textContent = `${b.unsplit.n}/${b.unsplit.of} not split`;
        g.appendChild(t);
      }
      markTip(g, `Week of ${b.label} (UTC)`, b.empty ? [{ label: "Tasks", value: "none finished" }] : [{ label: "Tasks", value: b.count }, { label: "Finish days", value: b.days.words }, ...(b.unsplit && b.unsplit.n ? [{ label: "No split yet", value: b.unsplit.words }] : []), { label: share ? "Lead time (as 100%)" : mode === "working" ? "Agent working time" : "Lead time", value: b.totalWords }]);
      plot.appendChild(g);
    });
    frame.appendChild(plot);
    row.appendChild(frame);
    container.appendChild(row);
    newestInView(frame, container);
    const present = new Map();
    for (const b of bars) for (const s of b.segments) if (!present.has(s.key)) present.set(s.key, s);
    const ul = el("ul", "tw-legend");
    for (const s of present.values()) {
      const li = document.createElement("li");
      li.appendChild(s.cause ? waitSwatch(s.cause) : s.key === "unsplit" ? Object.assign(el("span", "sb-key sb-key-unsplit"), {}) : swatch(s.key));
      li.appendChild(el("span", "tw-name", s.label));
      ul.appendChild(li);
    }
    container.appendChild(ul);
    // Each week whose split is mostly or partly not known says so in words.
    const unsplitWeeks = bars.filter((b) => b.unsplit && b.unsplit.n);
    if (unsplitWeeks.length) {
      const p = el("p", "chart-caption ot-unsplit-note", `Not measured yet: ${unsplitWeeks.map((b) => `week of ${b.label}, ${b.unsplit.words}`).join("; ")}. Their hours count in the week's lead time as "split not known", and in no cause; "n/m not split" under a bar says the same.`);
      container.appendChild(p);
    }
    container.appendChild(el("p", "chart-caption", `The number above a bar is how many tasks finished that week; * marks a thin week (fewer than 3). A dashed slot is a week with no finished task, never a zero bar. Hatched parts are partial. Weeks are labeled by the Monday they start on${ax.every > 1 ? `, every ${ax.every} weeks` : ""}.${ax.brackets ? "" : " The columns are too narrow for the arrows that mark bounded days, so they are left out here; the table below gives each week's days."}`));
  }

  // The cause × week table (I2, I6): rows are causes in Pareto order,
  // columns are weeks with the newest on the right and in view.
  function drawCauseTable(container, t) {
    container.innerHTML = "";
    if (!t.rows.length) {
      emptyState(container, "No cause has time in the weeks with finished tasks.");
      return;
    }
    const table = el("table", "data-table ot-cause-table");
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const th0 = el("th", null, "Cause");
    th0.scope = "col";
    hr.appendChild(th0);
    for (const w of t.columns) {
      const th = document.createElement("th");
      th.scope = "col";
      const h = el("span", "ot-col-head", w.label);
      h.appendChild(el("span", "ot-col-sub", w.empty ? "none" : `${w.n} task${w.n === 1 ? "" : "s"}${w.thin ? "*" : ""}${w.days && w.days.bracket ? (w.days.bracket === "left" ? " ←" : w.days.bracket === "right" ? " →" : " ↔") : ""}`));
      th.title = w.empty ? `Week of ${w.label}: no task finished` : `Week of ${w.label} (${w.week}): ${w.count}; ${w.days.words}`;
      th.appendChild(h);
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = document.createElement("tbody");
    for (const r of t.rows) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      const name = el("span", "ot-cause-name");
      name.appendChild(causeSwatch(r.key));
      name.appendChild(r.href ? causeLink(r.key, r.label) : document.createTextNode(r.label));
      th.appendChild(name);
      tr.appendChild(th);
      const fill = causeFillCss(r);
      r.cells.forEach((c, i) => {
        const td = document.createElement("td");
        const w = t.columns[i];
        const cell = el("span", `ot-cell${c.empty ? " ot-cell-empty" : ""}`);
        cell.setAttribute("aria-label", c.empty ? `week of ${w.label}: no task finished` : `week of ${w.label}: ${c.words}`);
        cell.title = cell.getAttribute("aria-label");
        cell.appendChild(el("span", null, c.empty ? "—" : c.short));
        if (!c.empty) {
          const bar = el("span", "ot-cell-bar");
          bar.setAttribute("aria-hidden", "true");
          if (c.frac !== null && c.frac > 0) {
            const b = el("span", c.state === "partial" ? "is-partial" : null);
            b.style.width = `${Math.max(2, c.frac * 100)}%`;
            b.style.backgroundColor = fill;
            bar.appendChild(b);
          }
          cell.appendChild(bar);
        }
        td.appendChild(cell);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const wrap = el("div", "table-wrap ot-scroll");
    wrap.appendChild(table);
    container.appendChild(wrap);
    newestInView(wrap, container);
  }

  // Flow efficiency by finish week (I4, I5): each task's value as the range
  // its true value lies in, and the week's median as a labeled dash.
  function drawFeWeeks(container, ot) {
    container.innerHTML = "";
    if (!ot.fe.n) {
      emptyState(container, "No finished task with a finish day has a flow efficiency figure yet.");
      return;
    }
    const weeks = ot.fe.weeks;
    const axisW = SB.axisW;
    const avail = Math.max(200, container.clientWidth - axisW - 4);
    const ax = S.weekAxis(weeks.length, avail, { min: 12, max: 160, labelPx: 52, valuePx: 40 });
    const H = container.clientWidth < 600 ? 180 : 210;
    const top = 16;
    const totalH = top + H + 46;
    const y = (v) => top + H - Math.min(1, Math.max(0, v)) * H;
    const row = el("div", "sb-row");
    const axis = svg("svg", { class: "sb-axis", width: axisW, height: totalH, "aria-hidden": "true" });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const tx = svg("text", { x: axisW - 6, y: y(t) + 4, class: "axis-tick", "text-anchor": "end" });
      tx.textContent = `${Math.round(t * 100)}%`;
      axis.appendChild(tx);
    }
    row.appendChild(axis);
    const frame = el("div", "sb-frame chart-frame ot-scroll");
    const plot = svg("svg", { class: "sb-plot", width: ax.width, height: totalH, role: "group", "aria-label": `Flow efficiency of ${ot.fe.n} finished tasks by finish week (UTC), 0 to 100%, the oldest week on the left. Each mark is a link to its task.` });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) plot.appendChild(svg("line", { x1: 0, x2: ax.width, y1: y(t), y2: y(t), class: t === 0 ? "sb-base" : "sb-grid" }));
    weeks.forEach((w, i) => {
      const x0 = i * ax.colW;
      const wk = ot.weeks[i];
      const hasMedian = w.median && w.median.value !== null && w.median.value !== undefined;
      const L = S.feLayout(ax.colW, w.marks.length, { labelPx: hasMedian && ax.showValues ? Math.max(30, 7 * String(w.median.short || "").length + 6) : ax.colW });
      w.marks.forEach((p, k) => {
        const cx = x0 + L.xs[k];
        const a = svgLink(p.href, `${p.name}: finished ${p.finish.words} (UTC); flow efficiency ${p.words}. Follow this task.`);
        a.appendChild(svg("rect", { x: cx - 5, y: top, width: 10, height: H, class: "hit" }));
        if (p.kind === "unknown") {
          a.appendChild(svg("line", { x1: cx, x2: cx, y1: y(1), y2: y(0), class: "ot-range-unknown" }));
          a.appendChild(svg("circle", { cx, cy: y(p.value), r: 3.5, class: "fe-dot fe-hollow" }));
          const q = svg("text", { x: cx, y: y(1) - 3, class: "ot-q", "text-anchor": "middle" });
          q.textContent = "?";
          a.appendChild(q);
        } else if (p.kind === "exact") a.appendChild(svg("circle", { cx, cy: y(p.value), r: 4, class: "fe-dot" }));
        else {
          a.appendChild(svg("line", { x1: cx, x2: cx, y1: y(p.lo), y2: y(p.hi), class: "ot-range" }));
          a.appendChild(svg("line", { x1: cx - 3.5, x2: cx + 3.5, y1: y(p.value), y2: y(p.value), class: "ot-range" }));
        }
        markTip(a, p.name, [{ label: "Finished (UTC)", value: p.finish.words }, { label: "Flow efficiency", value: p.words }]);
        plot.appendChild(a);
      });
      if (hasMedian) {
        const my = y(w.median.value);
        const line = svg("line", { x1: x0 + 3, x2: x0 + ax.colW - 3, y1: my, y2: my, class: "ot-median" });
        const title = svg("title", {});
        title.textContent = `Week of ${w.label}: ${w.median.words}`;
        line.appendChild(title);
        plot.appendChild(line);
        if (ax.showValues && L.label) {
          const t = svg("text", { x: x0 + L.label.x, y: my - 4, class: "ot-median-text", "text-anchor": "end" });
          t.textContent = w.median.short;
          plot.appendChild(t);
        }
      }
      if (ax.brackets) dayBracket(plot, x0, ax.colW, top + H + 8, wk.days && wk.days.bracket);
      const lab = ax.labels.find((l) => l.i === i);
      if (lab) {
        const t = svg("text", { x: lab.x + (x0 - i * ax.colW), y: top + H + 26, class: "axis-tick", "text-anchor": lab.anchor });
        t.textContent = w.label;
        plot.appendChild(t);
      }
    });
    frame.appendChild(plot);
    row.appendChild(frame);
    container.appendChild(row);
    newestInView(frame, container);
    const omitted = ot.fe.omitted.length;
    container.appendChild(el("p", "chart-caption", `${ot.fe.n} finished task${ot.fe.n === 1 ? "" : "s"} drawn${omitted ? `; ${omitted} more ${omitted === 1 ? "has" : "have"} a finish day but no flow efficiency figure (named in the table below the charts)` : ""}. Each week's median, in words, is in the table below.${ax.brackets ? "" : " The columns are too narrow for the arrows that mark bounded days, so they are left out here."}`));
  }

  // The finished tasks the charts do not place, behind one line (I7).
  function drawUndated(container, ot) {
    container.innerHTML = "";
    const items = ot.unplaced.groups.length || ot.fe.omitted.length;
    if (!items && !ot.open) return;
    if (ot.unplaced.n) {
      const det = el("details", "ot-undated");
      det.appendChild(el("summary", null, ot.unplaced.words));
      for (const g of ot.unplaced.groups) {
        det.appendChild(el("p", "ot-undated-title", `${g.words.replace(/^not dated yet: /, "Not dated yet because ")} (${g.items.length})`));
        const ul = el("ul", "plain-list");
        for (const t of g.items) {
          const li = document.createElement("li");
          li.appendChild(jobLink(t.job, t.name));
          ul.appendChild(li);
        }
        det.appendChild(ul);
      }
      container.appendChild(det);
    }
    if (ot.fe.omitted.length) {
      const det = el("details", "ot-undated");
      det.appendChild(el("summary", null, `${ot.fe.omitted.length} dated task${ot.fe.omitted.length === 1 ? " has" : "s have"} no flow efficiency figure, so ${ot.fe.omitted.length === 1 ? "it is" : "they are"} not on the flow efficiency chart.`));
      const ul = el("ul", "plain-list");
      for (const t of ot.fe.omitted) {
        const li = document.createElement("li");
        li.appendChild(jobLink(t.job, t.name));
        li.appendChild(document.createTextNode(`: finished ${t.finish.words}; ${t.words}`));
        ul.appendChild(li);
      }
      det.appendChild(ul);
      container.appendChild(det);
    }
    if (ot.open) container.appendChild(el("p", "chart-caption", `${ot.open} task${ot.open === 1 ? " is" : "s are"} still open, so ${ot.open === 1 ? "it has" : "they have"} no finish day and ${ot.open === 1 ? "is" : "are"} not counted here.`));
  }

  // The weeks as a table, newest first (I1): short figures with their words
  // on hover and for screen readers; on a phone, three columns.
  function drawOverTimeTable(container, ot) {
    container.innerHTML = "";
    const phone = container.clientWidth < 600;
    const table = el("table", "data-table ot-table");
    tableHead(table, phone ? [["Week", ""], ["Tasks", ""], ["Flow efficiency", ""]] : [["Week", ""], ["Tasks and their days", ""], ["Lead time", "num"], ["Working", "num"], ["Flow efficiency", ""]]);
    const tb = document.createElement("tbody");
    const short = (n) => {
      const c = S.overTimeCell(n, false, "hours");
      const td = el("td", "num", c.short);
      td.title = c.words;
      td.setAttribute("aria-label", c.words);
      return td;
    };
    for (const i of ot.weeks.map((_, k) => k).reverse()) {
      const w = ot.weeks[i];
      const tr = document.createElement("tr");
      tr.appendChild(el("td", null, `${w.short} · ${w.label}`));
      tr.appendChild(el("td", null, w.empty ? "none finished" : `${w.count}${w.thin ? " (thin)" : ""}; ${w.days.words}`));
      if (!phone) {
        if (w.empty) {
          tr.appendChild(el("td", "num", "—"));
          tr.appendChild(el("td", "num", "—"));
        } else {
          tr.appendChild(short(w.raw.lead_ms));
          tr.appendChild(short(w.raw.working_ms));
        }
      }
      tr.appendChild(el("td", "ot-fe", w.empty ? "—" : ot.fe.weeks[i].median.words));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const wrap = el("div", "table-wrap");
    wrap.appendChild(table);
    container.appendChild(wrap);
    const det = el("details", "full-table");
    det.appendChild(el("summary", null, `Each finished task with a day (${ot.fe.n + ot.fe.omitted.length}), newest first`));
    const t2 = el("table", "data-table ot-table");
    tableHead(t2, [["Task", ""], ["Finished (UTC)", ""], ["Flow efficiency", ""]]);
    const b2 = document.createElement("tbody");
    const all = [...ot.fe.weeks.flatMap((w) => w.marks.map((p) => ({ ...p, fe: p.words }))), ...ot.fe.omitted.map((p) => ({ ...p, fe: p.words }))].sort((a, b) => (a.finish.key < b.finish.key ? 1 : a.finish.key > b.finish.key ? -1 : 0));
    for (const p of all) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.appendChild(jobLink(p.job, p.name));
      tr.appendChild(td);
      tr.appendChild(el("td", null, p.finish.words));
      tr.appendChild(el("td", "ot-fe", p.fe));
      b2.appendChild(tr);
    }
    t2.appendChild(b2);
    const w2 = el("div", "table-wrap");
    w2.appendChild(t2);
    det.appendChild(w2);
    container.appendChild(det);
  }

  // The stack-up as a table: every figure in words.
  // On a phone: three columns (task, lead time, waiting), with every
  // figure behind a disclosure, so the walk's next step stays near.
  function drawStackTable(container, bars) {
    container.innerHTML = "";
    if (container.clientWidth < 600) {
      const compact = el("table", "data-table sb-compact");
      tableHead(compact, [["Task", ""], ["Lead time", "num"], ["Waiting", "num"]]);
      const cb = document.createElement("tbody");
      for (const r of bars.map(S.compactRow)) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.appendChild(jobLink(r.job, r.name));
        const fb = bars.find((x) => x.job === r.job);
        if (fb && fb.finish && fb.finish.kind !== "open") {
          const d = el("span", "cell-day", fb.finish.day ? `finished ${fb.finish.words}` : "no finish day yet");
          d.title = fb.finish.words;
          td.appendChild(d);
        }
        tr.appendChild(td);
        tr.appendChild(el("td", "num", r.lead));
        tr.appendChild(el("td", "num", r.waiting));
        cb.appendChild(tr);
      }
      compact.appendChild(cb);
      container.appendChild(compact);
      const det = el("details", "full-table");
      const summary = document.createElement("summary");
      summary.textContent = S.fullTableSummary(bars.length);
      det.appendChild(summary);
      drawFullStackTable(det, bars);
      container.appendChild(det);
      return;
    }
    drawFullStackTable(container, bars);
  }

  function drawFullStackTable(container, bars) {
    const table = el("table", "data-table sb-table");
    tableHead(table, [["Task", ""], ["Place", ""], ["Finished (UTC)", ""], ["Lead time", "num"], ["Working", "num"], ["Waiting", "num"], ["Largest wait", ""], ["Note", ""]]);
    const tb = document.createElement("tbody");
    for (const b of bars) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.appendChild(jobLink(b.job, b.name));
      tr.appendChild(name);
      tr.appendChild(el("td", null, b.group === "finished" ? `${F.ordinal(b.pos)} to finish${b.unlabeled ? ", not labeled yet" : ""}` : b.open ? "open" : b.status || "no data"));
      tr.appendChild(el("td", null, b.finish ? (b.finish.kind === "open" ? "open" : b.finish.words) : "—"));
      tr.appendChild(el("td", "num", b.state === "no_data" ? "no data" : b.words));
      const g = (k) => b.groups.find((x) => x.key === k);
      tr.appendChild(el("td", "num", g("working") ? groupWords(g("working")) : "not known"));
      tr.appendChild(el("td", "num", g("waiting") ? groupWords(g("waiting")) : "not known"));
      const w = g("waiting") ? g("waiting").segments.slice().sort((p, q) => q.ms - p.ms)[0] : null;
      tr.appendChild(el("td", null, w ? `${w.label}, ${S.hoursWords(w.ms)}` : "—"));
      const notes = [];
      if (b.state === "unsplit" || b.state === "no_data") notes.push((b.reasons || []).map(F.reasonText).join("; ") || "not recorded");
      if (b.shared) notes.push("labels from a shared session");
      tr.appendChild(el("td", "sb-note", notes.join("; ") || "—"));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const wrap = el("div", "table-wrap");
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  async function renderCompare(data) {
    const seq = ++stepSeq;
    const ledeEl = document.getElementById("compare-lede");
    const [tasks, stack, byWeek] = await Promise.all([walkFile("rollups/tasks.json"), walkFile("rollups/stackup.json"), walkFile("rollups/by_week.json")]);
    if (seq !== stepSeq) return;
    const taskRows = tasks && Array.isArray(tasks.jobs) ? tasks.jobs : null;
    const stackRows = stack && Array.isArray(stack.jobs) ? stack.jobs : null;
    const opts = (mode) => ({ mode, segments: F.SEGMENTS, nameOf: (j) => jobLabel(j) });
    const all = !taskRows && !stackRows ? [] : S.stackBars(data.jobs, stackRows, taskRows, opts("all"));
    safely("compare-lede", () => {
      ledeEl.textContent = S.compareLede(all, taskRows, F.reasonText).text;
    });
    const draw = () => {
      const mode = modes.compare;
      document.getElementById("stackup-caption").textContent =
        mode === "working"
          ? "Agent working time only, for the tasks whose working time the evaluator has labeled, in finish order, linear from zero at their own scale. Waiting is left out, so defects, rework and necessary steps, where agent-side fixes live, show. Select a bar to follow its task."
          : mode === "share"
            ? "Each task's own lead time as 100%, on a 0 to 100% axis, with the same parts in the same order, so a 20-minute task's make-up compares with a 200-hour one's. Each bar is labeled with the share agents were working. A task whose split is not known is one hatched bar, never 100% of one part. Select a bar to follow its task."
            : "The whole lead time of each task, linear from zero. Left to right: every finished task (done or cancelled) by finish day (UTC), the latest on the right, with any finished task that has no finish day after the dated ones; then tasks still open, by when work began. Select a bar to follow its task.";
      const view = !all.length || mode !== "working" ? null : S.workingView(S.stackBars(data.jobs, stackRows, taskRows, opts("working")));
      const bars = !all.length ? [] : view ? view.bars : mode === "share" ? S.shareBars(all, taskRows) : all;
      const leftOut = document.getElementById("stackup-left-out");
      leftOut.textContent = view ? view.text : "";
      leftOut.hidden = !(view && view.text);
      safely("stackup", () => {
        if (!all.length) emptyState(document.getElementById("stackup"), "The walk's stack-up and task files are not published yet, so no bar is drawn rather than a zero.");
        else if (view && !bars.length) emptyState(document.getElementById("stackup"), "No task's working time is labeled yet, so there is nothing to compare in agent working time.");
        else drawStackup(document.getElementById("stackup"), bars, mode, S.mostWaste(bars, mode));
      });
    };
    wireModes("view-compare", "compare", draw);
    draw();
    const ot = S.overTime(byWeek, { jobs: data.jobs, taskRows, nameOf: (j) => jobLabel(j) });
    const OT_CAPTION = {
      share: "Each week's lead time as 100%, in the stack-up's colors and order, so a week of 5 tasks and a week of 1 compare: working time by label from the base up, then waiting by what it waited on.",
      all: "Hours of all elapsed time per finish week, linear from zero: a week with more or longer tasks is taller, so compare shapes with care or switch to the share of lead time.",
      working: "Hours of agent working time per finish week, by the evaluator's labels, linear from zero. Waiting is left out.",
    };
    const OT_TASK_CAPTION = {
      share: "Each finished task with a finish day, earliest on the left, each as shares of its own lead time. Select a bar to follow its task.",
      all: "Each finished task with a finish day, earliest on the left, in hours of all elapsed time, linear from zero. Select a bar to follow its task.",
      working: "Each finished task with a finish day whose working time is labeled, earliest on the left, in hours of agent working time. Select a bar to follow its task.",
    };
    const drawRest = () => {
      const none = ot.state === "absent" ? "The weekly file (rollups/by_week.json) is not published yet, so no week is drawn rather than a zero." : ot.state === "empty" ? "No finished task has a finish day yet, so no week can be drawn." : null;
      const baseEl = document.getElementById("over-time-base");
      baseEl.replaceChildren();
      if (ot.state !== "absent") {
        // One short sentence, then the base, the days and the trend in full
        // behind a disclosure (N6).
        const more = [ot.base.words, [ot.days && ot.days.words, ot.trend && ot.trend.words].filter(Boolean).join(" ")].filter(Boolean);
        if (ot.state === "ok" && more.length) {
          // The sentence is the disclosure's own line, so the block stays
          // that one sentence until the reader opens it.
          const d = el("details", "ot-base-more");
          d.append(el("summary", "ot-summary", ot.summary.words));
          for (const t of more) d.append(el("p", null, t));
          baseEl.append(d);
        } else baseEl.append(el("p", "ot-summary", ot.summary.words));
      }
      for (const b of document.querySelectorAll("#ot-over .ot-btn")) b.setAttribute("aria-pressed", String(b.dataset.over === overTimeView.over));
      for (const b of document.querySelectorAll("#ot-mode .ot-btn")) b.setAttribute("aria-pressed", String(b.dataset.otmode === overTimeView.otmode));
      const mode = overTimeView.otmode;
      const byTask = overTimeView.over === "task";
      document.getElementById("ot-bars-caption").textContent = ot.state === "ok" ? (byTask ? OT_TASK_CAPTION : OT_CAPTION)[mode] : "";
      safely("ot-bars", () => {
        const box = document.getElementById("ot-bars");
        if (none) return emptyState(box, none);
        if (!byTask) return drawWeekBars(box, ot, mode);
        const base = mode === "working" ? S.workingView(S.stackBars(data.jobs, stackRows, taskRows, opts("working"))).bars : all;
        const dated = S.eachTaskBars(base);
        const bars = mode === "share" ? S.shareBars(dated, taskRows) : dated;
        if (!bars.length) return emptyState(box, "No finished task with a finish day has a bar in this mode yet.");
        drawStackup(box, bars, mode, null);
      });
      const table = ot.state === "ok" ? S.causeTable(ot, mode) : null;
      document.getElementById("cause-weeks-caption").textContent = table ? `Rows are causes, largest over these weeks first; columns are finish weeks, newest on the right. Each cell is ${mode === "share" ? "the cause's share of that week's lead time" : mode === "working" ? "the cause's hours of agent working time that week (waits left out)" : "the cause's hours that week"}; ${table.scale.words}. ≥ means at least, ≤ at most, ~ direction not known; hatched bars are partial. An arrow beside a week's task count means its days are bounds (← some may have finished earlier).` : "";
      safely("cause-weeks", () => (none ? emptyState(document.getElementById("cause-weeks"), none) : drawCauseTable(document.getElementById("cause-weeks"), table)));
      safely("fe-dots", () => (none ? emptyState(document.getElementById("fe-dots"), none) : drawFeWeeks(document.getElementById("fe-dots"), ot)));
      safely("over-time-undated", () => (ot.state === "absent" ? (document.getElementById("over-time-undated").innerHTML = "") : drawUndated(document.getElementById("over-time-undated"), ot)));
      safely("over-time-table", () => (ot.state === "ok" ? drawOverTimeTable(document.getElementById("over-time-table"), ot) : emptyState(document.getElementById("over-time-table"), none)));
    };
    const setHash = () => {
      try {
        history.replaceState(null, "", F.compareHash({ mode: modes.compare, ...overTimeView }));
      } catch (err) {
        /* a sandboxed frame may refuse; the choice still applies */
      }
    };
    for (const b of document.querySelectorAll("#ot-over .ot-btn")) {
      b.onclick = () => {
        overTimeView.over = b.dataset.over === "task" ? "task" : "week";
        setHash();
        drawRest();
      };
    }
    for (const b of document.querySelectorAll("#ot-mode .ot-btn")) {
      b.onclick = () => {
        overTimeView.otmode = b.dataset.otmode === "all" || b.dataset.otmode === "working" ? b.dataset.otmode : "share";
        setHash();
        drawRest();
      };
    }
    drawRest();
    const drawTable = () => safely("stackup-table", () => (all.length ? drawStackTable(document.getElementById("stackup-table"), all) : emptyState(document.getElementById("stackup-table"), "Not published yet.")));
    drawTable();
    lastStepRender = () => {
      draw();
      drawRest();
      drawTable();
    };
    lastStepWidth = document.getElementById("stackup").clientWidth;
  }

  // ---------------------------------------------- step 3: the Pareto chart

  function wrapWords(text, perLine, maxLines) {
    const lines = [];
    let cur = "";
    for (const w of String(text).split(/\s+/)) {
      if (!cur) cur = w;
      else if ((cur + " " + w).length <= perLine) cur += ` ${w}`;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = clip(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, perLine);
      return kept;
    }
    return lines;
  }

  function drawPareto(container, model) {
    container.innerHTML = "";
    if (model.state === "absent") {
      emptyState(container, "The causes file is not published yet, so no cause can be ranked. No bar is drawn rather than a zero.");
      return;
    }
    if (!model.bars.length) {
      emptyState(container, model.mode === "working" ? "No labeled waste in agents' working time is recorded yet, so there is nothing to rank once waiting is left out." : "No cause of waste is recorded yet.");
      return;
    }
    const n = model.bars.length;
    const leftW = 50;
    const rightW = 46;
    const phone = container.clientWidth < 600;
    const width = Math.max(300, container.clientWidth);
    const colW = Math.min(120, Math.max(phone ? 70 : 78, Math.floor((width - leftW - rightW) / Math.max(n, 3))));
    // The frame's end is padded by the pinned axis's width, so the last
    // bar's label shows whole, clear of the fade, when scrolled fully right.
    const plotW = colW * n + (phone ? rightW : 8);
    const H = phone ? 220 : 260;
    const top = 26;
    const labelH = 62;
    const totalH = top + H + labelH;
    const scale = S.timeScale(model.bars[0].ms);
    const y = (ms) => top + H - (ms / scale.max_ms) * H;
    const yc = (share) => top + H - share * H;
    // Both axes stay put while the bars scroll inside their frame, so the
    // hours and the running total are always readable on a phone.
    const row = el("div", "sb-row pareto-row");
    const left = svg("svg", { class: "sb-axis", width: leftW, height: totalH, "aria-hidden": "true" });
    for (const t of scale.ticks) {
      const tx = svg("text", { x: leftW - 6, y: y(t) + 4, class: "axis-tick", "text-anchor": "end" });
      tx.textContent = S.tickWords(t, scale);
      left.appendChild(tx);
    }
    const lt = svg("text", { x: 12, y: top + H / 2, class: "axis-title", transform: `rotate(-90 12 ${top + H / 2})`, "text-anchor": "middle" });
    lt.textContent = `${scale.unit === "hours" ? "Hours" : "Minutes"} (per task)`;
    left.appendChild(lt);
    const right = svg("svg", { class: "sb-axis", width: rightW, height: totalH, "aria-hidden": "true" });
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const tx = svg("text", { x: 4, y: yc(t) + 4, class: "axis-tick" });
      tx.textContent = `${Math.round(t * 100)}%`;
      right.appendChild(tx);
    }
    const rx = rightW - 8;
    const rt = svg("text", { x: rx, y: top + H / 2, class: "axis-title", transform: `rotate(90 ${rx} ${top + H / 2})`, "text-anchor": "middle" });
    rt.textContent = "Running total, % of time";
    right.appendChild(rt);
    const frame = el("div", "chart-frame pareto-frame");
    const root = svg("svg", { class: "pareto", width: plotW, height: totalH, role: "group", "aria-label": `Pareto chart of ${n} causes, ${model.mode === "working" ? "agent working time" : "all elapsed time"}: bars in ${scale.unit} from zero, largest first, with the running total as a line on a 0 to 100% axis. Each bar is a link to its cause.` });
    for (const t of scale.ticks) root.appendChild(svg("line", { x1: 0, x2: plotW, y1: y(t), y2: y(t), class: t === 0 ? "sb-base" : "sb-grid" }));
    const barW = Math.min(64, colW * 0.62);
    const pts = [];
    model.bars.forEach((b, i) => {
      const cx = i * colW + colW / 2;
      const words = `${b.label}: ${S.hoursWords(b.ms)}, ${W.pctWords(b.share)} of the time; running total ${S.cumWords(b.cum)}`;
      const a = b.href ? svgLink(b.href, `${words}. Open this cause.`) : svg("g", { class: "chart-other", tabindex: "0", role: "img", "aria-label": `${words}. Folded in: ${b.members.map((k) => W.causeWords(k)).join("; ")}.` });
      a.appendChild(svg("rect", { x: i * colW, y: 0, width: colW, height: totalH, class: "hit" }));
      const r = svg("rect", { x: cx - barW / 2, y: y(b.ms), width: barW, height: Math.max(0, top + H - y(b.ms)), class: "pareto-bar" });
      r.style.fill = causeFill(b);
      if (b.wait === "unknown") {
        r.style.stroke = "var(--c-wait-unknown)";
        r.style.strokeWidth = "1";
      }
      a.appendChild(r);
      // Waiting for the next prompt, stacked by why the agent stopped: the
      // actionable classes from the base, then the human gates, then the
      // time whose why is not known (an outline). The stack adds up to the
      // bar; its own height and the running total are unchanged.
      if (b.why_split === "on" && b.children.length) {
        r.style.fill = "transparent";
        let base = top + H;
        for (const c of b.children) {
          const h = (c.ms / scale.max_ms) * H;
          const seg = svg("rect", { x: cx - barW / 2, y: base - h, width: barW, height: Math.max(0, h), class: "pareto-why-seg" });
          seg.style.fill = whyFill(c.why, false);
          if (c.why === "not_known") {
            seg.style.stroke = "var(--c-why-not_known)";
            seg.style.strokeWidth = "1.5";
          }
          a.appendChild(seg);
          base -= h;
        }
      }
      const v = svg("text", { x: cx, y: y(b.ms) - 6, class: "sb-value", "text-anchor": "middle" });
      v.textContent = S.hoursShort(b.ms);
      a.appendChild(v);
      wrapWords(b.label, Math.max(9, Math.floor(colW / 6.6)), 4).forEach((line, k) => {
        const t = svg("text", { x: cx, y: top + H + 15 + k * 13, class: "pareto-name", "text-anchor": "middle" });
        t.textContent = line;
        a.appendChild(t);
      });
      markTip(a, b.label, [
        { label: "Time", value: `${S.hoursWords(b.ms)}, counted per task` },
        { label: "Share", value: W.pctWords(b.share) },
        { label: "Running total", value: S.cumWords(b.cum) },
        { label: "Tasks", value: String(b.jobs) },
        ...(b.members ? [{ label: "Folded in", value: b.members.map((k) => W.causeWords(k)).join("; ") }] : []),
        ...(b.why_split === "on" ? b.children.map((c) => ({ label: c.label, value: `${S.whyAmountWords(c)}, ${S.whyShareWords(c)} of this bar` })) : []),
      ]);
      root.appendChild(a);
      pts.push([cx, yc(b.cum)]);
    });
    root.appendChild(svg("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "pareto-line" }));
    for (const [px, py] of pts) root.appendChild(svg("circle", { cx: px, cy: py, r: 3.5, class: "pareto-dot" }));
    frame.appendChild(root);
    row.append(left, frame, right);
    container.appendChild(row);
    // A fade at the frame's right edge while more bars lie beyond it.
    const edge = () => frame.classList.toggle("more-right", frame.scrollLeft + frame.clientWidth < frame.scrollWidth - 2);
    frame.addEventListener("scroll", edge, { passive: true });
    edge();
    const key = el("p", "chart-caption pareto-key");
    const lineKey = el("span", "pareto-line-key");
    lineKey.setAttribute("aria-hidden", "true");
    key.append(lineKey, document.createTextNode("The line is the running total: the share of all the time ranked that the causes up to that bar carry, on the right-hand axis."));
    container.appendChild(key);
    // The split by why: its key, or why the bar is not split.
    const np = model.bars.find((b) => b.key === "waiting:next_prompt");
    if (np) {
      if (np.why_split === "on" && np.children.length) {
        container.appendChild(el("p", "chart-caption", `The bar for waiting for the next prompt is stacked by why the agent stopped, from the base: the classes an agent-side change can act on, then the human gates, then the time whose why is not known (an outline). Each class has its own page, listed in the table below.${np.children.some((c) => c.bound === "lower") ? " While some of the bar has no known why, each class is at least its own part and at most that part plus the time not known." : ""}`));
        drawWhyLegend(container, np.children.map((c) => c.why), "pareto-why-legend");
      } else if (np.why_split === "absent") container.appendChild(el("p", "chart-caption", "Why the agent stopped is not known yet for the waiting for the next prompt: Desk does not publish it, so that bar is not split."));
      else if (np.why_split === "mismatch") container.appendChild(el("p", "chart-caption", "Desk's split of the waiting for the next prompt by why the agent stopped does not add up to the bar, so the bar is not split rather than split wrongly."));
    }
  }

  function drawParetoTable(container, model) {
    container.innerHTML = "";
    if (!model.bars.length) return;
    const phone = container.clientWidth < 600;
    const table = el("table", "data-table pareto-table");
    tableHead(table, [["Rank", "num"], ["Cause", ""], ["Time", "num"], ["Share", "num"], ["Running total", "num"], ["Tasks", "num"]]);
    const tb = document.createElement("tbody");
    model.bars.forEach((b, i) => {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", "num", b.key === "other" ? "—" : String(i + 1)));
      const td = document.createElement("td");
      td.appendChild(causeSwatch(b.key));
      if (b.href) td.appendChild(causeLink(b.key, b.label));
      else td.appendChild(document.createTextNode(`${b.label}: ${b.members.map((k) => W.causeWords(k)).join("; ")}`));
      tr.appendChild(td);
      // On a phone, the short forms ("117h", "17m", "<1%") keep a row on one line.
      tr.appendChild(el("td", "num", phone ? S.hoursShort(b.ms) : S.hoursWords(b.ms)));
      tr.appendChild(el("td", "num", phone ? S.shortPct(b.share) : W.pctWords(b.share)));
      tr.appendChild(el("td", "num", S.cumWords(b.cum)));
      tr.appendChild(el("td", "num", String(b.jobs)));
      tb.appendChild(tr);
      // Its split by why, as rows under it: each class's time, its share of
      // the bar, and a link to its page. Never ranked beside the causes.
      if (b.why_split === "on") {
        for (const c of b.children) {
          const sr = el("tr", "why-sub-row");
          sr.appendChild(el("td", "num", "—"));
          const cd = document.createElement("td");
          cd.appendChild(whySwatch(c.why));
          cd.appendChild(causeLink(c.key, `of which: ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}${c.why === "not_known" && c.reasons.length ? ` (${c.reasons.map(W.whyReasonWords).join("; ")})` : ""}`));
          sr.appendChild(cd);
          sr.appendChild(el("td", "num", S.whyAmountWords(c, phone)));
          sr.appendChild(el("td", "num", `${S.whyShareWords(c, phone)} of it`));
          sr.appendChild(el("td", "num", "—"));
          sr.appendChild(el("td", "num", String(c.jobs)));
          tb.appendChild(sr);
        }
      }
    });
    table.appendChild(tb);
    const wrap = el("div", "table-wrap");
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  let whySplitOn = true;
  async function renderCauses(data) {
    const seq = ++stepSeq;
    const [doc, tasks, stack] = await Promise.all([walkFile("rollups/causes.json"), walkFile("rollups/tasks.json"), walkFile("rollups/stackup.json")]);
    if (seq !== stepSeq) return;
    let all = S.paretoModel(doc, "all", { split: whySplitOn });
    const working = doc ? S.paretoModel(doc, "working") : null;
    const byId = new Map(data.jobs.map((j) => [j.id, j]));
    const nameOf = (job) => (byId.has(job) ? jobLabel(byId.get(job)) : F.jobLabel(localNames, job));
    safely("causes-lede", () => {
      document.getElementById("causes-lede").textContent = S.causesLede(all, working, { doc, taskRows: tasks && tasks.jobs, stackRows: stack && stack.jobs, nameOf });
    });
    // With no causes file the chart says so once; the notes add nothing.
    const noteEl = document.getElementById("pareto-note");
    noteEl.textContent = all.state === "absent" ? "" : S.paretoNote(all, F.reasonText);
    if (all.state !== "absent" && all.basis === "job_hours") {
      const g = el("a", null, "What job-hours means");
      const safe = F.glossaryRoute("job-hours");
      if (safe) g.href = safe;
      noteEl.append(" ", g);
    }
    if (all.state === "absent") document.getElementById("causes-unlabeled").hidden = true;
    else unlabeledNote(document.getElementById("causes-unlabeled"), data, "causes");
    // "Split by why" (on by default): the next-prompt bar stacked by why
    // the agent stopped. It applies to all elapsed time; agent working time
    // leaves waiting out.
    const tg = document.getElementById("why-toggle");
    // With nothing to split the toggle is disabled, never drawn pressed,
    // and its note says why.
    const tgNote = document.getElementById("why-toggle-note");
    const tgWords = tgNote ? tgNote.textContent : "";
    const syncToggle = () => {
      if (!tg) return;
      const st = S.whyToggleState(all);
      tg.setAttribute("aria-pressed", String(st.pressed));
      if (st.disabled) tg.setAttribute("aria-disabled", "true");
      else tg.removeAttribute("aria-disabled");
      if (tgNote) tgNote.textContent = st.disabled ? st.note : tgWords;
      const row = tg.parentElement;
      if (row) row.hidden = modes.causes === "working";
    };
    if (tg) {
      tg.onclick = () => {
        if (tg.getAttribute("aria-disabled") === "true") return;
        whySplitOn = !whySplitOn;
        all = S.paretoModel(doc, "all", { split: whySplitOn });
        draw();
      };
    }
    const draw = () => {
      syncToggle();
      const m = modes.causes === "working" ? working || all : all;
      document.getElementById("pareto-caption").textContent = all.state === "absent" ? "" : S.paretoCaption(m);
      safely("pareto", () => drawPareto(document.getElementById("pareto"), m));
      safely("pareto-table", () => drawParetoTable(document.getElementById("pareto-table"), m));
    };
    wireModes("view-causes", "causes", draw);
    draw();
    lastStepRender = draw;
    lastStepWidth = document.getElementById("pareto").clientWidth;
  }

  // ------------------------------------------------- step 3: one cause

  async function renderCause(data, key) {
    const seq = ++stepSeq;
    const box = document.getElementById("cause-detail");
    box.innerHTML = "";
    box.appendChild(el("p", "chart-empty", "Loading…"));
    const [doc, tasks, stack] = await Promise.all([walkFile("rollups/causes.json"), walkFile("rollups/tasks.json"), walkFile("rollups/stackup.json")]);
    if (seq !== stepSeq) return;
    const byId = new Map(data.jobs.map((j) => [j.id, j]));
    const nameOf = (job) => (byId.has(job) ? jobLabel(byId.get(job)) : F.jobLabel(localNames, job));
    const promptNameOf = (job) => W.promptName(F.taskName(localNames, byId.get(job) || { id: job }));
    const d = S.causeDetail(doc, key, { taskRows: tasks && tasks.jobs, stackRows: stack && stack.jobs, nameOf, promptNameOf });
    box.innerHTML = "";
    if (d.why) {
      await renderWhyCause(box, d, { seq, byId, nameOf, doc });
      return;
    }
    const h1 = el("h1", "view-title cause-title");
    h1.appendChild(causeSwatch(key));
    h1.appendChild(document.createTextNode(d.label));
    box.appendChild(h1);
    document.title = `${d.label} · The factory`;
    if (d.state === "absent") {
      box.appendChild(el("p", "lede", "The causes file is not published yet, so this cause cannot be shown. No figure is shown rather than a zero."));
      return;
    }
    if (d.state === "not_ranked") {
      box.appendChild(el("p", "lede", `${S.causeMeaning(key)} It is not in the ranking: none of the ${d.n} tasks the ranking counts (of ${d.N}) has it. A task page can still name it, from its own figures.`));
      return;
    }
    const lede = el("p", "lede");
    const rankWords = `${F.ordinal(d.all.rank)} of ${d.all.of} causes`;
    lede.textContent = `${S.causeMeaning(key)} Across the ${d.n} tasks the ranking counts, it cost ${S.hoursWords(d.ms)} (counted per task), ${W.pctWords(d.all.share)} of all the time ranked: ${rankWords}${d.working ? `, and ${F.ordinal(d.working.rank)} of ${d.working.of} once waiting is left out` : ""}. ${d.jobs === 1 ? "One task has it." : `${d.jobs} tasks have it.`}`;
    box.appendChild(lede);
    // Waiting for the next prompt, by why the agent stopped: each class
    // with its time and page, or why it is not split.
    if (key === "waiting:next_prompt") {
      const row = doc.causes.find((x) => x && x.cause === key);
      const split = row ? S.whyChildren(row, true) : { why_split: "absent", children: [] };
      const p = el("p", "chart-caption");
      if (split.why_split === "on" && split.children.length) {
        p.appendChild(document.createTextNode("By why the agent stopped: "));
        split.children.forEach((c, i) => {
          if (i) p.appendChild(document.createTextNode("; "));
          p.appendChild(whySwatch(c.why));
          p.appendChild(document.createTextNode(" "));
          p.appendChild(causeLink(c.key, c.label.charAt(0).toLowerCase() + c.label.slice(1)));
          p.appendChild(document.createTextNode(`, ${S.whyAmountWords(c)} (${S.whyShareWords(c)})`));
        });
        p.appendChild(document.createTextNode("."));
      } else p.textContent = split.why_split === "mismatch" ? "Desk's split of this waiting by why the agent stopped does not add up to it, so it is not split here." : "Why the agent stopped is not known yet for this waiting: Desk does not publish it, so it is not split here.";
      box.appendChild(p);
    }

    // The A3: an issue already taken on for this cause (Act's mapping
    // table), or S2's copy-as-prompt that starts one, naming the cause, its
    // time, its top tasks and its data.
    const existing = S.causeIssues(S.actRows(data.kaizen_issues, doc), key);
    const a3 = el("section", "block a3-block");
    a3.setAttribute("aria-labelledby", "a3-title");
    const a3h = el("h2", "block-title", existing.length ? "Its A3" : "Start an A3");
    a3h.id = "a3-title";
    a3.appendChild(a3h);
    if (existing.length) {
      const taken = el("p", "taken-on");
      taken.appendChild(document.createTextNode("Already taken on: "));
      existing.forEach((x, i) => {
        if (i) taken.appendChild(document.createTextNode("; "));
        taken.appendChild(safeLink(x.ref.replace(/^ourostack\//, ""), x.url));
        if (x.countermeasure) {
          taken.appendChild(document.createTextNode(", with countermeasure "));
          taken.appendChild(safeLink(x.countermeasure.ref.replace(/^ourostack\//, ""), x.countermeasure.url));
          taken.appendChild(document.createTextNode(x.countermeasure.merged ? " (merged, not yet checked)" : " (not yet merged)"));
        } else taken.appendChild(document.createTextNode(", with no countermeasure yet"));
      });
      taken.appendChild(document.createTextNode(". "));
      const act = el("a", null, "See it on Act");
      const safe = F.safeRoute("act");
      if (safe) act.href = safe;
      taken.appendChild(act);
      a3.appendChild(taken);
      a3.appendChild(el("p", "chart-caption", "An A3 tells one problem's story on one page: the evidence, the cause, a countermeasure and its check. One already exists for this cause, so this prompt asks the agent to help check it or extend it rather than start another."));
    } else a3.appendChild(el("p", "chart-caption", "An A3 tells one problem's story on one page: the evidence, the cause, a countermeasure and its check. This prompt hands the agent this cause, its time, its largest tasks and its data, and asks it to draft one. When a countermeasure is agreed, file it as a kaizen issue; it appears on Act on the next build."));
    const text = S.a3Prompt(d, { route: absolute(S.causeRoute(key)), dataUrl: absolute("rollups/causes.json"), indexUrl: absolute("llms.txt"), existing });
    const pbox = el("div", "drawer-prompt");
    const btn = el("button", "copy-prompt", existing.length ? "Check or extend the A3 with your agent" : "Start an A3 with your agent");
    btn.type = "button";
    const status = el("span", "copy-status");
    status.setAttribute("role", "status");
    const pre = el("p", "prompt-text", text);
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = "Copied. Paste it to the agent.";
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        status.textContent = "The prompt is selected; copy it with the keyboard.";
      }
    });
    pbox.append(btn, status, pre);
    a3.appendChild(pbox);
    box.appendChild(a3);

    // Its tasks.
    const ts = el("section", "block");
    ts.setAttribute("aria-labelledby", "cause-tasks-title");
    const tsh = el("h2", "block-title", "Its tasks, largest first");
    tsh.id = "cause-tasks-title";
    ts.appendChild(tsh);
    const table = el("table", "data-table cause-tasks");
    const narrow = box.clientWidth < 600;
    tableHead(table, narrow ? [["Task", ""], ["Time on this cause", "num"], ["Share of this cause", "num"]] : [["Task", ""], ["Finished (UTC)", ""], ["Time on this cause", "num"], ["Share of this cause", "num"]]);
    const tb = document.createElement("tbody");
    for (const t of d.tasks) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.appendChild(jobLink(t.job, t.name));
      tr.appendChild(td);
      const tj = byId.get(t.job);
      const tf = F.finishDay(tj ? tj.finish_date : null);
      const tfWords = tf.kind === "open" ? "open" : tf.day ? tf.words : "not dated yet";
      if (narrow) {
        const d = el("span", "cell-day", tf.day ? `finished ${tf.words}` : tfWords);
        d.title = tf.words;
        td.appendChild(d);
      } else {
        const c = el("td", null, tfWords);
        c.title = tf.words;
        tr.appendChild(c);
      }
      tr.appendChild(el("td", "num", t.ms === null ? "not stated" : `${t.bound === "lower" ? "at least " : ""}${S.hoursWords(t.ms)}`));
      tr.appendChild(el("td", "num", t.ms === null || !(d.ms > 0) ? "—" : W.pctWords(t.ms / d.ms)));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const tw = el("div", "table-wrap");
    tw.appendChild(table);
    ts.appendChild(tw);
    if (d.tasks.some((t) => t.source === "spans")) ts.appendChild(el("p", "chart-caption", "Where a task's time on a failed tool kind is not in its own figures, it is the sum of the stretches listed below, so it can be less than the whole."));
    box.appendChild(ts);

    // Its stretches, each opening the task's map at the item that holds it.
    const ss = el("section", "block");
    ss.setAttribute("aria-labelledby", "cause-spans-title");
    const ssh = el("h2", "block-title", "Its stretches, longest first");
    ssh.id = "cause-spans-title";
    ss.appendChild(ssh);
    ss.appendChild(el("p", "chart-caption", `The stretches of time behind this cause${d.spans_cut ? `, the first ${d.spans.length} Desk lists` : ""}. Each opens its task's value stream map at the box or wait that holds it, with that item's evidence. Its start and end on the task's clock are in that item's evidence.`));
    const ol = el("ol", "cause-spans");
    const links = [];
    for (const s of d.spans) {
      const li = document.createElement("li");
      li.appendChild(el("span", "cause-span-name", s.name));
      li.appendChild(document.createTextNode(` · ${S.hoursWords(s.ms)} · `));
      const a = el("a", null, "open it on the map");
      const safe = F.safeRoute("task", s.job);
      if (safe) a.href = safe;
      li.appendChild(a);
      links.push({ a, s });
      ol.appendChild(li);
    }
    if (!d.spans.length) ss.appendChild(el("p", "chart-empty", "Desk lists no stretch for this cause."));
    else ss.appendChild(ol);
    box.appendChild(ss);
    // Each task's map file says which of its items holds the stretch.
    const jobs = [...new Set(d.spans.map((s) => s.job))];
    const maps = await Promise.all(jobs.map((j) => walkFile(mapPath(j))));
    if (seq !== stepSeq) return;
    const mapOf = new Map(jobs.map((j, i) => [j, maps[i]]));
    for (const { a, s } of links) {
      const it = S.spanItem(mapOf.get(s.job), s);
      const route = F.safeRoute("task", s.job);
      if (it && route) {
        const safe = `${route}?${it.kind}=${it.n}`;
        a.href = safe;
        a.textContent = it.kind === "gaps" ? `open wait ${it.n} on the map` : `open burst ${it.n} on the map`;
      }
    }
  }

  // One why's page (#/causes/waiting:next_prompt:<why>): what it means, its
  // time and share of the waiting for the next prompt, Copy as a prompt for
  // an A3, its tasks, and every wait of that class with its evidence.
  async function renderWhyCause(box, d, ctx) {
    const { seq, byId, nameOf } = ctx;
    const h1 = el("h1", "view-title cause-title");
    h1.appendChild(whySwatch(d.why));
    h1.appendChild(document.createTextNode(d.label));
    box.appendChild(h1);
    document.title = `${d.label} · The factory`;
    const parentLink = () => causeLink("waiting:next_prompt", "waiting for the next prompt");
    const lede = el("p", "lede");
    lede.appendChild(document.createTextNode(`${S.causeMeaning(d.key)} `));
    // The lede's words, with the link to waiting for the next prompt where
    // they name it: every class figure carries its bound, and a class with
    // no classified wait is a zero only when every wait is classified.
    for (const part of S.whyCauseLedeParts(d)) lede.appendChild(typeof part === "string" ? document.createTextNode(part) : parentLink());
    box.appendChild(lede);
    if (d.state !== "ok") return;

    // Copy as a prompt: an A3 on this why.
    const a3 = el("section", "block a3-block");
    a3.setAttribute("aria-labelledby", "a3-title");
    const a3h = el("h2", "block-title", "Start an A3");
    a3h.id = "a3-title";
    a3.appendChild(a3h);
    a3.appendChild(el("p", "chart-caption", `An A3 tells one problem's story on one page: the evidence, the cause, a countermeasure and its check. This prompt asks: ${S.WHY_A3[d.why]} It hands the agent this why, its time, its largest tasks and where its data is.`));
    const text = S.a3Prompt(d, { route: absolute(S.causeRoute(d.key)), dataUrl: absolute("rollups/causes.json"), indexUrl: absolute("llms.txt") });
    const pbox = el("div", "drawer-prompt");
    const btn = el("button", "copy-prompt", "Copy as a prompt");
    btn.type = "button";
    const status = el("span", "copy-status");
    status.setAttribute("role", "status");
    const pre = el("p", "prompt-text", text);
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = "Copied. Paste it to the agent.";
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        status.textContent = "The prompt is selected; copy it with the keyboard.";
      }
    });
    pbox.append(btn, status, pre);
    a3.appendChild(pbox);
    box.appendChild(a3);

    // Its tasks, each with Desk's own stated figure for this why.
    const ts = el("section", "block");
    ts.setAttribute("aria-labelledby", "cause-tasks-title");
    const tsh = el("h2", "block-title", "Its tasks, largest first");
    tsh.id = "cause-tasks-title";
    ts.appendChild(tsh);
    const table = el("table", "data-table cause-tasks");
    // On a phone the finish day sits under the task's name, as on every cause page.
    const narrow = box.clientWidth < 600;
    tableHead(table, narrow ? [["Task", ""], ["Time with this why", "num"], ["Share of this why", "num"]] : [["Task", ""], ["Finished (UTC)", ""], ["Time with this why", "num"], ["Share of this why", "num"]]);
    const tb = document.createElement("tbody");
    for (const t of d.tasks) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.appendChild(jobLink(t.job, t.name));
      tr.appendChild(td);
      const tj = byId.get(t.job);
      const tf = F.finishDay(tj ? tj.finish_date : null);
      const tfWords = tf.kind === "open" ? "open" : tf.day ? tf.words : "not dated yet";
      if (narrow) {
        const dd = el("span", "cell-day", tf.day ? `finished ${tf.words}` : tfWords);
        dd.title = tf.words;
        td.appendChild(dd);
      } else {
        const fc = el("td", null, tfWords);
        fc.title = tf.words;
        tr.appendChild(fc);
      }
      const q = { lower: "at least ", upper: "at most ", none: "about " }[t.bound] || "";
      // A class's time in a task is at most it plus the task's time not known.
      tr.appendChild(el("td", "num", t.ms === null ? "not stated" : typeof t.ceiling_ms === "number" ? S.whyAmountWords(t, narrow) : `${q}${S.hoursWords(t.ms)}`));
      tr.appendChild(el("td", "num", t.ms === null || !(d.ms > 0) ? "—" : W.pctWords(t.ms / d.ms)));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    const tw = el("div", "table-wrap");
    tw.appendChild(table);
    ts.appendChild(tw);
    box.appendChild(ts);

    // Every wait of this why, from the tasks' map files.
    const ws = el("section", "block");
    ws.setAttribute("aria-labelledby", "why-waits-title");
    const wsh = el("h2", "block-title", "Its waits, longest first");
    wsh.id = "why-waits-title";
    ws.appendChild(wsh);
    const body = el("div");
    body.appendChild(el("p", "chart-empty", "Loading…"));
    ws.appendChild(body);
    box.appendChild(ws);
    const jobs = d.tasks.map((t) => t.job);
    const maps = await Promise.all(jobs.map((j) => walkFile(mapPath(j))));
    if (seq !== stepSeq) return;
    const byJobMap = Object.fromEntries(jobs.map((j, i) => [j, maps[i]]));
    renderWhyWaits(body, S.whyWaitRows(d, byJobMap, nameOf), d);
  }

  // The waits of one why: each with its task, time, how the turn ended,
  // who decided its why and with what confidence, and a link that opens
  // the wait's evidence drawer on the task's map. Never any text.
  function renderWhyWaits(body, out, d) {
    body.innerHTML = "";
    body.appendChild(el("p", "chart-caption", "Each wait for the next prompt with this why, from each task's map file: its time counted as waiting, how the agent's turn ended (Desk's stop facts: never any text), who decided its why and with what confidence. Each opens the wait on its task's map, with its evidence and a prompt for an agent."));
    if (!out.rows.length) body.appendChild(el("p", "chart-empty", "No recorded wait holds this time."));
    const ol = el("ol", "why-waits");
    for (const r of out.rows) {
      const li = document.createElement("li");
      li.appendChild(el("span", "cause-span-name", r.name));
      li.appendChild(document.createTextNode(` · ${S.hoursWords(r.ms)} · `));
      const route = F.safeRoute("task", r.job);
      const a = el("a", null, r.item ? `open wait ${r.item.n} on the map` : "open its task");
      const safe = route ? (r.item ? `${route}?${r.item.kind}=${r.item.n}` : route) : null;
      if (safe) a.href = safe;
      if (r.item && r.item.kind === "bursts") a.textContent = `open burst ${r.item.n} on the map`;
      li.appendChild(a);
      const facts = el("span", "why-wait-facts", `How the turn ended: ${r.stop}. Decided by: ${r.source}; confidence: ${r.confidence}.${r.reasons.length ? ` Why not known: ${r.reasons.map(W.whyReasonWords).join("; ")}.` : ""}`);
      li.appendChild(facts);
      ol.appendChild(li);
    }
    if (out.rows.length) body.appendChild(ol);
    if (out.rest_ms > 1000) body.appendChild(el("p", "chart-caption", `${S.hoursWords(out.rest_ms)} of this time is held by no wait listed here: ${d.why === "not_known" ? "no recorded stop holds it (the stop was not recorded), or its task's map file does not list the wait" : "its task's map file does not list the wait"}.`));
    if (out.missing.length) body.appendChild(el("p", "chart-caption", `The map file of ${out.missing.length === 1 ? "one task" : `${out.missing.length} tasks`} is not published or lists no waits, so its waits are not listed here.`));
  }

  // ----------------------------------------------------------- step 4: act

  async function renderAct(data) {
    const seq = ++stepSeq;
    const box = document.getElementById("problems");
    const causes = await walkFile("rollups/causes.json");
    if (seq !== stepSeq) return;
    box.innerHTML = "";
    unlabeledNote(document.getElementById("act-unlabeled"), data, "act");
    const verified = !(data.kaizen && data.kaizen.verification === "unavailable");
    const rows = S.actRows(data.kaizen_issues, causes);
    if (!rows.length) {
      emptyState(box, verified ? "No kaizen issue has been opened yet." : "Kaizen issues could not be checked for this build (GitHub could not be reached). This says nothing about how many exist.");
    } else {
      if (!verified) box.appendChild(el("p", "chart-caption", "GitHub could not be reached for this build, so this list may be missing issues."));
      box.appendChild(el("p", "act-summary", S.actSummary(rows)));
      const ul = el("ul", "act-list");
      for (const r of rows) {
        const li = el("li", "act-row");
        const head = el("p", "act-head");
        head.appendChild(safeLink(r.title || `Issue ${r.short}`, r.url));
        head.appendChild(el("span", "act-ref", ` ${r.ref} · ${r.state}`));
        li.appendChild(head);
        const dl = el("dl", "act-facts");
        const fact = (label, node) => {
          const d = el("div");
          d.appendChild(el("dt", null, label));
          const dd = el("dd");
          dd.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
          d.appendChild(dd);
          dl.appendChild(d);
        };
        if (r.countermeasure) {
          const span = el("span");
          span.appendChild(safeLink(r.countermeasure.ref, r.countermeasure.url));
          span.appendChild(document.createTextNode(r.countermeasure.merged ? " (merged, not yet checked)" : " (not yet merged)"));
          fact("Countermeasure", span);
        } else fact("Countermeasure", "none yet");
        if (r.cause) {
          const span = el("span");
          span.appendChild(causeSwatch(r.cause.key));
          span.appendChild(causeLink(r.cause.key, r.cause.label));
          if (!r.cause.ranked) span.appendChild(document.createTextNode(" (no time on it in the current ranking)"));
          fact("Cause", span);
        } else fact("Cause", "not mapped to a cause");
        fact("Check", r.check);
        li.appendChild(dl);
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    const owners = document.getElementById("alarm-owners");
    owners.innerHTML = "";
    const alarms = S.alarmRows(data.alarm_issues);
    if (data.alarm_issues_verification === "unavailable") emptyState(owners, "GitHub could not be reached for this build, so the alarm owners were not checked.");
    else if (!Array.isArray(data.alarm_issues)) emptyState(owners, "This build did not look for alarm owners.");
    else if (!alarms.length) emptyState(owners, "No open issue owns an alarm.");
    else {
      const ul = el("ul", "plain-list owner-list");
      for (const a of alarms) {
        const li = document.createElement("li");
        li.appendChild(safeLink(a.ref, a.url));
        li.appendChild(document.createTextNode(a.owns.length ? ` owns ${a.owns.join(" and ")}.` : " owns no alarm the status line names."));
        ul.appendChild(li);
      }
      owners.appendChild(ul);
    }
  }

  // Redraw the charts of steps 2 and 3 when the width changes enough.
  let stepResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(stepResizeTimer);
    stepResizeTimer = setTimeout(() => {
      const view = document.body.dataset.view;
      if (!lastStepRender || (view !== "compare" && view !== "causes")) return;
      const node = document.getElementById(view === "compare" ? "stackup" : "pareto");
      if (!node || Math.abs(node.clientWidth - lastStepWidth) < 40) return;
      lastStepWidth = node.clientWidth;
      lastStepRender();
    }, 150);
  });

  const VIEWS = ["task", "session", "compare", "causes", "cause", "act", "why", "about", "store", "missing"];
  const VIEW_TITLE = { task: "Follow a task", session: "One session", compare: "Compare tasks", causes: "Rank causes", cause: "Rank causes", act: "Act", why: "Why Lean?", about: "About", store: "The store's numbers", missing: "Page not found" };
  let routedOnce = false;

  function route(data) {
    const jobOfSession = (sid) => {
      const j = data.jobs.find((x) => x.sessions.some((s) => s.session_id === sid));
      return j ? j.id : null;
    };
    let r = F.parseRoute(window.location.hash, jobOfSession);
    if (r.view === "skip") {
      // The skip link focuses #main without touching the hash (see the click
      // handler below). A #main that arrives anyway (a reload, a pasted link)
      // is not a view: on first load the page drops it and opens the default
      // route; later it only moves focus, leaving the current view as it is.
      if (routedOnce) {
        const main = document.getElementById("main");
        if (main) main.focus();
        return;
      }
      history.replaceState(null, "", window.location.pathname + window.location.search);
      r = F.parseRoute("", jobOfSession);
    }
    if (r.view === "redirect") {
      history.replaceState(null, "", r.to);
      r = F.parseRoute(r.to, jobOfSession);
    }
    for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== r.view;
    document.body.dataset.view = r.view;
    const step = F.stepOf(r.view);
    for (const a of document.querySelectorAll("[data-step]")) {
      if (a.dataset.step === step || a.dataset.step === r.view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    let title = VIEW_TITLE[r.view];
    if (drawerEl && drawerEl.open) drawerEl.close();
    if (r.view === "task") {
      const fallback = F.defaultTask(data.jobs);
      const id = r.job || (fallback ? fallback.id : null);
      renderTaskWalk(data, id, r.select).catch((err) => emptyState(document.getElementById("vsm"), `This part could not be drawn (${err && err.message ? err.message : "an error"}).`));
      const j = data.jobs.find((x) => x.id === id);
      if (j) title = jobLabel(j);
    }
    if (r.view === "session") {
      renderSessionDetail(document.getElementById("session-detail"), data.sessions, data.jobs, r.session, r.job);
      renderSwimlane(document.getElementById("swimlane"), data, r.job, r.session, r.select).catch((err) => emptyState(document.getElementById("swimlane"), `This part could not be drawn (${err && err.message ? err.message : "an error"}).`));
    }
    const failed = (id) => (err) => emptyState(document.getElementById(id), `This part could not be drawn (${err && err.message ? err.message : "an error"}).`);
    // The chart mode comes from the URL (#/compare?mode=working).
    if (r.view === "compare" || r.view === "causes") modes[r.view] = r.mode === "working" || (r.mode === "share" && r.view === "compare") ? r.mode : "all";
    if (r.view === "compare") {
      overTimeView.over = r.over === "task" ? "task" : "week";
      overTimeView.otmode = r.otmode === "all" || r.otmode === "working" ? r.otmode : "share";
    }
    if (r.view === "compare") renderCompare(data).catch(failed("stackup"));
    if (r.view === "causes") renderCauses(data).catch(failed("pareto"));
    if (r.view === "act") renderAct(data).catch(failed("problems"));
    document.title = `${title} \u00b7 The factory`;
    if (r.view === "cause") renderCause(data, r.cause).catch(failed("cause-detail"));
    window.scrollTo(0, 0);
    // A glossary link (#/why?term=…) opens Why Lean? at that entry.
    if (r.view === "why" && r.term) {
      const dt = document.getElementById(`g-${r.term}`);
      if (dt) {
        dt.tabIndex = -1;
        dt.scrollIntoView({ block: "start" });
        dt.focus({ preventScroll: true });
        for (const x of document.querySelectorAll(".glossary .is-target")) x.classList.remove("is-target");
        dt.classList.add("is-target");
        routedOnce = true;
        return;
      }
    }
    // After the first page load, move focus to the new view's heading, so a
    // keyboard or screen reader user lands where the content changed.
    if (routedOnce) {
      const h = document.querySelector(`#view-${r.view} h1`);
      if (h) {
        h.tabIndex = -1;
        h.focus({ preventScroll: true });
      }
    }
    routedOnce = true;
  }

  // The router under the same guard as every other part: if drawing a view
  // throws, the page says so in place of that view instead of going blank.
  function routeSafely(data) {
    try {
      route(data);
    } catch (err) {
      for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== "missing";
      const view = document.getElementById("view-missing");
      const p = view.querySelector(".lede");
      if (p) p.textContent = `This view could not be drawn (${err && err.message ? err.message : "an error"}). Try another task, or reload the page.`;
    }
  }

  // -------------------------------------------------------------- health

  const VERDICT_WORD = { alive: "Alive", stale: "Stale", broken: "Broken", unknown: "Unknown" };
  const VERDICT_MARK = { alive: "\u25cf", stale: "\u25d0", broken: "\u25a0", unknown: "?" };
  const INTAKE_CLASS = {
    under_1_day: "under a day ago",
    "1_to_3_days": "one to three days ago",
    "3_to_7_days": "three to seven days ago",
    over_7_days: "over seven days ago",
  };
  // How each slot's number reads; a slot with no row is a count.
  const SLOT_KIND = { capture_coverage: "pct" };
  const SLOT_LABEL = {
    capture_coverage: "Capture coverage (share of sessions still on disk)",
    open_improvement_items: "Open improvement items (count and oldest age)",
    unsigned_deliveries: "Unsigned deliveries",
  };

  function hoursAgo(h) {
    const n = Math.max(0, Math.floor(h));
    return n < 1 ? "less than an hour" : `${F.toText(measuredCount(n), "count")} hour${n === 1 ? "" : "s"}`;
  }

  function row(dl, label, node) {
    dl.appendChild(el("dt", null, label));
    const dd = el("dd");
    dd.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
    dl.appendChild(dd);
  }

  function banner(container, status, reason) {
    const b = el("div", `verdict verdict-${status}`);
    b.setAttribute("role", "status");
    b.appendChild(el("span", "verdict-mark", VERDICT_MARK[status]));
    b.appendChild(el("strong", "verdict-word", VERDICT_WORD[status]));
    b.appendChild(el("span", "verdict-reason", ` \u2014 ${reason}`));
    container.appendChild(b);
  }

  // The health panel. A failure here is contained: it downgrades the panel
  // to Unknown and never stops the rest of the page from drawing.
  function renderHealth(container, health, dataLoaded, loadError) {
    container.innerHTML = "";
    try {
      const v = F.pageVerdict(health, Date.now());
      let status = v.status;
      let reason = v.reason;
      if (!dataLoaded) {
        status = "broken";
        reason = `the site data could not be loaded (${loadError}); ${reason}`;
      }
      banner(container, status, reason);
      if (v.ageHours === null && status !== "broken") return;
      if (!health || !Array.isArray(health.facts_by_host)) return;
      drawHealthDetails(container, health, v);
    } catch (err) {
      container.innerHTML = "";
      banner(container, "unknown", "the health record could not be drawn, so health cannot be told");
    }
  }

  function drawHealthDetails(container, health, v) {
    const dl = el("dl", "health-facts");
    // How long ago, never a calendar date.
    row(dl, "Last successful data build", v.ageHours !== null ? `${hoursAgo(v.ageHours)} ago` : "no data (the build stamp could not be read)");
    const ni = health.newest_intake;
    row(dl, "Newest intake", ni.state === "unavailable" ? num(ni, "text") : `${INTAKE_CLASS[ni.value] || "unrecognized"} (at the last build)`);
    const fb = health.factory_build;
    const fbNode = el("span");
    if (fb.state === "unavailable") fbNode.appendChild(num(fb, "text"));
    else {
      fbNode.appendChild(document.createTextNode(fb.value === "success" ? "green" : `not green (${fb.value})`));
      if (F.safeGithubUrl(fb.run_url)) {
        fbNode.appendChild(document.createTextNode(" \u00b7 "));
        fbNode.appendChild(safeLink("run", fb.run_url));
      }
    }
    row(dl, "Last factory-build run", fbNode);
    const hostsNode = el("span");
    if (!health.facts_by_host.length) hostsNode.appendChild(document.createTextNode("none recorded"));
    health.facts_by_host.forEach((h, i) => {
      if (i) hostsNode.appendChild(document.createTextNode(", "));
      hostsNode.appendChild(document.createTextNode(`${h.host} `));
      hostsNode.appendChild(num(h.files, "count"));
    });
    row(dl, "Facts files by host", hostsNode);
    for (const [key, number] of Object.entries(health.slots || {})) {
      const node = el("span");
      node.appendChild(num(number, SLOT_KIND[key] || "count"));
      const detail = health.details && Array.isArray(health.details[key]) ? health.details[key] : [];
      if (key !== "capture_coverage" && detail.length && number.state !== "unavailable") {
        const per = el("span", "slot-detail");
        for (const d of detail) {
          if (!d || typeof d.label !== "string" || !d.number) continue;
          per.appendChild(document.createTextNode(` \u00b7 ${d.label}: `));
          per.appendChild(num(d.number, d.kind || "count", { nofn: false }));
        }
        node.appendChild(per);
      }
      if (key === "capture_coverage" && detail.length && number.state !== "unavailable") {
        const per = el("span", "slot-detail");
        detail.forEach((d, i) => {
          per.appendChild(document.createTextNode(`${i ? ", " : " \u00b7 "}${d.host} `));
          per.appendChild(num(d.share, "pct", { nofn: false }));
        });
        node.appendChild(per);
      }
      row(dl, SLOT_LABEL[key] || key, node);
    }
    container.appendChild(dl);
  }

  // ------------------------------------------------------ capture coverage
  // Per host, what became of every root session still on disk, from the
  // machines' own capture records. Every count says how many machines'
  // records it rests on; the caveats always sit beside the shares.

  const CAPTURE_COLUMNS = [
    ["on_disk", "On disk", "count"],
    ["derived", "Captured", "count"],
    ["held", "Held", "count"],
    ["frozen", "Frozen", "count"],
    ["pending", "Pending", "count"],
    ["not_seen", "Never seen", "count"],
    ["not_in_a_desk", "Not in a desk", "count"],
    ["share", "Share captured", "pct"],
    ["capturable_share", "Of what could be captured", "pct"],
  ];
  const CAPTURE_ALARM = {
    coverage_low: "less than 80% of the sessions that could be captured were captured",
    coverage_dropped: "a machine's capture share fell by 15 points or more since its previous record",
  };

  function renderCaptureCoverage(container, cov) {
    container.innerHTML = "";
    if (!cov || !cov.share) {
      emptyState(container, "Capture coverage is not part of this build's data.");
      return;
    }
    const top = el("p", "capture-total");
    if (cov.share.state === "unavailable") {
      top.appendChild(document.createTextNode("Share of sessions still on disk that were captured: "));
      top.appendChild(num(cov.share, "pct"));
    } else {
      top.appendChild(document.createTextNode("Across every host: "));
      top.appendChild(num(cov.share, "pct"));
      top.appendChild(document.createTextNode(" of sessions still on disk were captured."));
    }
    container.appendChild(top);
    if (cov.share.state === "unavailable") return;
    const wrap = el("div", "table-wrap");
    const table = document.createElement("table");
    table.className = "data-table capture-table";
    const head = document.createElement("tr");
    for (const c of ["Host", "Records", ...CAPTURE_COLUMNS.map((x) => x[1])]) {
      const th = document.createElement("th");
      th.textContent = c;
      if (c !== "Host" && c !== "Records") th.className = "num";
      head.appendChild(th);
    }
    const thead = document.createElement("thead");
    thead.appendChild(head);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const h of cov.hosts || []) {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", null, h.host));
      // How many machines' records the row rests on, with the unverified
      // ones named in words, so a share's partial mark is explained on the
      // page and not only on hover.
      const records = h.records && h.records.state === "measured" ? h.records.value : 0;
      const unverified = h.unverified_machines && h.unverified_machines.state === "measured" ? h.unverified_machines.value : 0;
      const notCounted = h.not_counted_machines && h.not_counted_machines.state === "measured" ? h.not_counted_machines.value : 0;
      tr.appendChild(el("td", unverified || notCounted ? "capture-records capture-unverified" : "capture-records", records ? F.recordsWords(records, unverified, notCounted) : "none"));
      for (const [key, , kind] of CAPTURE_COLUMNS) {
        const td = el("td", "num");
        td.appendChild(num(h[key], kind, { nofn: false }));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    // When the table is wider than its card (a phone, a narrow window), a
    // visible cue says so; no column is hidden without one.
    const cue = el("p", "scroll-cue", "The table is wider than the page: scroll it sideways to see every column.");
    cue.hidden = true;
    container.appendChild(cue);
    container.appendChild(wrap);
    const showCue = () => {
      cue.hidden = !(wrap.scrollWidth > wrap.clientWidth + 1);
    };
    showCue();
    window.addEventListener("resize", showCue);
    const notes = el("ul", "capture-notes");
    notes.appendChild(el("li", null, "A share marked unverified or partial could be higher or lower: an unverified host could not check its own session count, and a host that could not be counted is left out of the sums."));
    for (const c of cov.caveats || []) notes.appendChild(el("li", null, c.text));
    const m = cov.machines || {};
    const parts = [["counted", "counted"], ["empty", "withdrawn"], ["stale", "older than 45 days"], ["invalid", "unreadable"], ["over_limit", "over the limit"]];
    const li = el("li");
    li.appendChild(document.createTextNode("Machines' records: "));
    parts.forEach(([key, word], i) => {
      if (!m[key]) return;
      if (i) li.appendChild(document.createTextNode(", "));
      li.appendChild(num(m[key], "count"));
      li.appendChild(document.createTextNode(` ${word}`));
    });
    notes.appendChild(li);
    notes.appendChild(el("li", null, "A machine sends its record again only when its counts change, so a record not refreshed for 45 days is treated as stale and left out, even if the machine is still working."));
    container.appendChild(notes);
    const alarms = Array.isArray(cov.alarms) ? cov.alarms : [];
    const al = el("p", alarms.length ? "capture-alarms capture-alarms-on" : "capture-alarms");
    al.textContent = alarms.length
      ? `Alarm: ${alarms.map((a) => `${a.host}: ${CAPTURE_ALARM[a.code] || a.code}`).join("; ")}.`
      : "No capture alarm: every host with enough sessions captured at least 80% of what it could.";
    container.appendChild(al);
  }

  // ------------------------------------------------------ improvement loop
  // Whether found problems get fixed by themselves: open and in-progress
  // improvement items, the oldest one's age, what closed this month, and the
  // loop's own alarms. Each figure is the largest any one machine reports
  // (machines can share a desk, so counts are never added), with n of N.

  const LOOP_ROWS = [
    ["open", "Open, not yet taken"],
    ["in_progress", "Taken, fixed or being checked"],
    ["oldest_open_age_days", "Oldest open item, in days"],
    ["closed_confirmed_month", "Closed in the last 30 days, fix confirmed by data"],
    ["closed_unverified_month", "Closed in the last 30 days without a confirming measure"],
    ["loop_alarms_open", "The loop's own alarms open"],
    ["steps_stale", "Loop steps that stopped succeeding"],
  ];
  const LOOP_ALARM = {
    improvement_age: "an improvement item has been open for a week or more",
    loop_alarms_open: "the loop has raised an alarm about itself",
    steps_stale: "a loop step has stopped succeeding",
  };
  const LOOP_NOTICE = {
    headless_blocked: (n) => `the waste evaluator is blocked on ${n} machine${n === 1 ? "" : "s"} (no agent command, not signed in, or host not supported); Desk opens a card after two days`,
    headless_unknown: (n) => `whether the waste evaluator can run could not be told on ${n} machine${n === 1 ? "" : "s"} (its sign-in could not be read)`,
  };
  const LOOP_FIGURE = {
    oldest_open_age_days: "the oldest open item's age",
    loop_alarms_open: "the loop's own alarms",
    steps_stale: "whether every loop step is succeeding",
  };
  const HEADLESS_WORD = {
    idle: "idle",
    ran: "ran today",
    no_agent_cli: "no agent command found",
    no_credentials: "not signed in",
    disabled_would_bill: "off: it would bill an account",
    sign_in_unknown: "sign-in could not be told",
    budget_exhausted: "today's budget spent",
    disabled: "switched off",
    unsupported_host: "host not supported",
    unavailable: "not known today",
  };

  function renderLoop(container, loop) {
    container.innerHTML = "";
    if (!loop || !loop.open) {
      emptyState(container, "The improvement loop is not part of this build's data.");
      return;
    }
    const dl = el("dl", "health-facts");
    for (const [key, label] of LOOP_ROWS) row(dl, label, num(loop[key], "count"));
    const evalNode = el("span");
    if (!loop.headless.length) evalNode.appendChild(document.createTextNode("no data (no machine said)"));
    loop.headless.forEach((h, i) => {
      if (i) evalNode.appendChild(document.createTextNode(", "));
      evalNode.appendChild(document.createTextNode(`${HEADLESS_WORD[h.code] || h.code.replace(/_/g, " ")} on `));
      evalNode.appendChild(num(h.machines, "count"));
      evalNode.appendChild(document.createTextNode(" machine(s)"));
    });
    row(dl, "Waste evaluator, run by itself", evalNode);
    const m = loop.machines;
    const machinesNode = el("span");
    machinesNode.appendChild(num(m.reporting, "count"));
    machinesNode.appendChild(document.createTextNode(" reporting, "));
    machinesNode.appendChild(num(m.without_loop, "count"));
    machinesNode.appendChild(document.createTextNode(F.WITHOUT_LOOP_WORDS));
    machinesNode.appendChild(num(m.quiet, "count"));
    machinesNode.appendChild(document.createTextNode(" quiet for over three days (their ages are counted from their last record)"));
    if (m.stale) {
      machinesNode.appendChild(document.createTextNode(", "));
      machinesNode.appendChild(num(m.stale, "count"));
      machinesNode.appendChild(document.createTextNode(" with a record older than 45 days, not read as current"));
    }
    row(dl, "Machines", machinesNode);
    container.appendChild(dl);
    const alarms = Array.isArray(loop.alarms) ? loop.alarms : [];
    const al = el("p", alarms.length ? "capture-alarms capture-alarms-on" : "capture-alarms");
    // The healthy sentence only when every figure it rests on is measured
    // from current records; otherwise say which are not recorded, and why.
    const verdict = loop.verdict || { status: "cannot_tell", missing: [] };
    const count = (x) => (x && x.state === "measured" ? x.value : 0);
    const silent = [];
    if (count(verdict.quiet)) silent.push(`${count(verdict.quiet)} machine${count(verdict.quiet) === 1 ? " has" : "s have"} sent nothing for over three days`);
    if (count(verdict.stale)) silent.push(`${count(verdict.stale)} machine${count(verdict.stale) === 1 ? "'s record is" : "s' records are"} older than 45 days`);
    if (alarms.length) {
      al.textContent = `Alarm: ${alarms.map((a) => LOOP_ALARM[a.code] || a.code).join("; ")}.`;
    } else if (verdict.status === "healthy") {
      al.textContent = "No loop alarm: nothing has been open for a week, the loop has no alarm of its own, and every loop step is succeeding.";
    } else if (verdict.missing.length && verdict.missing.every((x) => x.codes.length === 1 && x.codes[0] === "no_loop_records")) {
      al.textContent = "No alarm can be told until a machine sends its loop's health.";
    } else {
      const parts = verdict.missing.map((x) => `${LOOP_FIGURE[x.figure] || x.figure} (${x.codes.map((c) => F.reasonText(c)).join("; ")})`);
      const why = [];
      if (parts.length) why.push(`not recorded: ${parts.join("; ")}`);
      if (silent.length) why.push(`${silent.join(", and ")}, so their figures may not hold today`);
      al.textContent = `No alarm is raised, but the loop's health cannot be told: ${why.join("; ")}.`;
    }
    container.appendChild(al);
    const notices = Array.isArray(loop.notices) ? loop.notices : [];
    if (notices.length) {
      const note = el("p", "capture-notes");
      note.textContent = `Notice: ${notices.map((x) => (LOOP_NOTICE[x.code] ? LOOP_NOTICE[x.code](count(x.machines)) : x.code)).join("; ")}.`;
      container.appendChild(note);
    }
  }

  // ---------------------------------------------------------------- main

  async function loadJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  // Draws one part of a page; if it throws, that part says so and the rest of the page still draws.
  function safely(id, fn) {
    try {
      fn();
    } catch (err) {
      const node = document.getElementById(id);
      if (node) emptyState(node, `This part could not be drawn (${err && err.message ? err.message : "an error"}).`);
    }
  }

  // Before the data arrives, show the routed view's own shell (its step label
  // and heading), or nothing but the status line's "Loading the store…".
  function showLoadingShell() {
    const view = F.loadingView(window.location.hash);
    for (const v of VIEWS) {
      const node = document.getElementById(`view-${v}`);
      if (node) node.hidden = v !== view;
    }
    if (view) document.body.dataset.view = view;
  }

  async function main() {
    showLoadingShell();
    let health = null;
    try {
      health = await loadJSON("./health.json");
    } catch (err) {
      health = null;
    }

    let data;
    try {
      data = await loadJSON(DATA_URL);
    } catch (err) {
      renderHealth(document.getElementById("health-panel"), health, false, err.message);
      const msg = "This page could not load the store's data (" + err.message + "). Try reloading, or check the reports branch directly.";
      const line = document.getElementById("status-line");
      line.className = "status-line status-abnormal";
      line.textContent = `\u25a0 Abnormal: the store's data could not be loaded (${err.message}), no one is on this.`;
      for (const id of ["job-detail", "jobs-table", "stackup", "pareto", "problems", "featured-grid", "answer-tiles"]) {
        const node = document.getElementById(id);
        if (node) emptyState(node, msg);
      }
      return;
    }
    renderHealth(document.getElementById("health-panel"), health, true, "");
    // (main continues even if the health panel failed: renderHealth contains its own errors)

    // The overview: at a glance, the answer, the trend, what to fix next.
    await loadLocalNames();
    wasteActions = data.waste_actions && typeof data.waste_actions === "object" ? data.waste_actions : {};
    wasteNames = data.waste_names && typeof data.waste_names === "object" ? data.waste_names : {};
    renderStatusLine(document.getElementById("status-line"), data, health);
    // Route first: the view the reader asked for never waits on, or fails
    // with, the store page's charts below. Each of those is drawn on its own,
    // so one that throws says so in its place and the rest still draw.
    routeSafely(data);
    window.addEventListener("hashchange", () => routeSafely(data));
    safely("answer-tiles", () => renderAnswer(document.getElementById("answer-tiles"), data.outcomes));
    safely("trend", () => renderTrend(document.getElementById("trend"), data.trend));

    // Build metadata footer: how long ago, never a calendar date.
    const builtMs = Date.parse(data.built_at);
    const meta = document.getElementById("build-meta");
    meta.innerHTML = "";
    meta.appendChild(document.createTextNode(Number.isFinite(builtMs) ? `Built ${hoursAgo((Date.now() - builtMs) / 3600000)} ago from the store's public data` : "Built from the store's public data"));
    if (typeof data.reports_commit === "string" && /^[0-9a-f]{7,40}$/.test(data.reports_commit)) {
      meta.appendChild(document.createTextNode(", reports commit "));
      const a = document.createElement("a");
      a.href = `https://github.com/ourostack/factory/commit/${data.reports_commit}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = data.reports_commit.slice(0, 7);
      meta.appendChild(a);
    }
    meta.appendChild(document.createTextNode("."));

    // 1. Proof
    safely("featured-grid", () => renderFeatured(document.getElementById("featured-grid"), data.featured));

    // 2. Work design — scoped to substantial sessions (active at least 5
    // minutes, or bound to a tracked job), since that is real work rather
    // than a launcher blip or a scripted check.
    safely("kpi-row", () => renderKPIs(document.getElementById("kpi-row"), data.headlines));

    const ENTRYPOINT_NAMES = {
      desktop: "desktop",
      launcher: "Copilot launcher",
      sdk: "headless sdk automation",
      cli: "interactive cli",
    };
    function entrypointNode(obj) {
      const span = el("span");
      Object.entries(obj || {})
        .filter(([, v]) => v.state !== "unavailable" && v.value > 0)
        .sort((a, b) => b[1].value - a[1].value)
        .forEach(([k, v], i) => {
          if (i) span.appendChild(document.createTextNode(", "));
          span.appendChild(num(v, "count"));
          span.appendChild(document.createTextNode(` ${ENTRYPOINT_NAMES[k] || k}`));
        });
      return span;
    }
    const scopeContextEl = document.getElementById("scope-context");
    if (scopeContextEl && data.scope) {
      const minutes = F.toText({ state: "measured", value: Math.round(data.config.substantial_active_ms / 60000), reasons: [] }, "count");
      scopeContextEl.innerHTML = "";
      const add = (x) => scopeContextEl.appendChild(typeof x === "string" ? document.createTextNode(x) : x);
      add(num(data.scope.sessions_total, "count"));
      add(" sessions are published in total. ");
      add(F.caption("headlines", data.scopes.headlines));
      add(" Each takeaway names the sessions it counts. The substantial sessions are the ");
      add(num(data.scope.sessions_scoped, "count"));
      add(` that were active at least ${minutes} minutes (turns, tools and subagents, not waiting) or are bound to a tracked job (`);
      add(entrypointNode(data.scope.entrypoints_scoped));
      add(") — real, substantial work, not a launcher blip or a scripted check. The other ");
      add(num(data.scope.sessions_other, "count"));
      add(" sessions on contributing machines (");
      add(entrypointNode(data.scope.entrypoints_other));
      add(
        ") were active for less time and are unbound, shown here as context, not folded into any measure. A published session withholds which plugins it ran by default, so this page cannot identify \"Desk sessions\" specifically and does not claim to — it scopes by active time and job binding instead, both of which every published session carries. Capture coverage per host (sessions that happened but were never captured) is not recorded yet, so none is claimed.",
      );
    }

    safely("capture-coverage", () => renderCaptureCoverage(document.getElementById("capture-coverage"), data.capture_coverage));
    safely("loop-health", () => renderLoop(document.getElementById("loop-health"), data.loop_health));
    safely("takeaways", () => renderTakeaways(document.getElementById("takeaways"), data.takeaways));

    const timeBreakdownNoteEl = document.getElementById("time-breakdown-note");
    if (timeBreakdownNoteEl && data.flow_efficiency) {
      const fe = data.flow_efficiency.median;
      timeBreakdownNoteEl.innerHTML = "";
      timeBreakdownNoteEl.appendChild(num(measuredCount(fe.N), "count"));
      timeBreakdownNoteEl.appendChild(document.createTextNode(" of "));
      timeBreakdownNoteEl.appendChild(num(data.coverage.jobs, "count", { nofn: false }));
      timeBreakdownNoteEl.appendChild(document.createTextNode(" tracked jobs apply here (finished, whole life inside capture); each figure above says how many of those it rests on and how many jobs are out of scope."));
    }

    const timeBreakdownRows = data.time_breakdown.map((r) => ({
      label: r.label,
      number: r.median,
      secondary: r.p75,
      tooltipRows: [
        { label: "Median", value: F.toText(r.median, "duration") },
        { label: "75th percentile", value: F.toText(r.p75, "duration") },
        { label: "Trust", value: `${TRUST_LABEL[r.trust.status]} — ${r.trust.reason}` },
      ],
      trust: r.trust,
    }));
    safely("chart-time-breakdown", () => renderBarList(document.getElementById("chart-time-breakdown"), timeBreakdownRows, {
      title: "Where time goes in a finished task",
      titleTag: "h2",
      color: "var(--series-1)",
      kind: "duration",
      suffix: " median",
      emptyText: "Not enough measured jobs yet.",
    }));
    // Beside each row's figure: its trust state, as text.
    document.querySelectorAll("#chart-time-breakdown .bar-row").forEach((rowEl, i) => {
      const t = timeBreakdownRows[i].trust;
      const line = el("div", "bar-trust");
      line.appendChild(trustNode(t));
      rowEl.after(line);
    });

    safely("outcomes-panel", () => renderOutcomes(document.getElementById("outcomes-panel"), data.outcomes, Array.isArray(data.jobs) ? data.jobs.length : null));

    // 3. Detail views
    safely("chart-intake", () => renderIntakeChart(document.getElementById("chart-intake"), data.intake_over_time));

    const statusRows = Object.entries(data.job_status_counts)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([status, count]) => ({ label: status, number: count, color: statusColor(status) }));
    safely("chart-job-status", () => renderBarList(document.getElementById("chart-job-status"), statusRows, {
      title: "Job lifecycle",
      unit: "jobs",
      kind: "count",
      emptyText: "No jobs tracked yet.",
    }));

    // Every section caption names the population its data counts (format.js).
    for (const section of F.CAPTION_SECTIONS) {
      const node = document.getElementById(`caption-${section}`);
      if (node) node.textContent = F.caption(section, data.scopes[SCOPE_OF[section]]);
    }
    const toolCallRows = data.tool_kinds.slice(0, 10).map((t) => ({
      label: t.tool,
      number: t.calls,
      tooltipRows: [
        { label: "Calls", value: F.toText(t.calls, "count") },
        { label: "Sessions using it", value: F.toText(t.sessions, "count") },
        { label: "Failures", value: F.toText(t.failures, "count") },
      ],
    }));
    safely("chart-tool-calls", () => renderBarList(document.getElementById("chart-tool-calls"), toolCallRows, {
      title: "Tool calls by kind",
      unit: "calls",
      color: "var(--series-1)",
      kind: "compact",
      emptyText: "No tool calls recorded yet.",
    }));

    const failureRows = data.tool_kinds
      .filter((t) => t.calls.state !== "unavailable" && t.calls.value >= 20)
      .slice()
      .sort((a, b) => (b.failure_rate.value ?? -1) - (a.failure_rate.value ?? -1))
      .map((t) => ({
        label: t.tool,
        number: t.failure_rate,
        tooltipRows: [
          { label: "Failure rate", value: F.toText(t.failure_rate, "pct1") },
          { label: "Calls", value: F.toText(t.calls, "count") },
          { label: "Failures", value: F.toText(t.failures, "count") },
        ],
      }));
    safely("chart-tool-failures", () => renderBarList(document.getElementById("chart-tool-failures"), failureRows, {
      title: "Failure rate by tool kind",
      color: "var(--series-2)",
      kind: "pct1",
      emptyText: "No tool kind has 20 or more recorded calls yet.",
    }));

    const modelRows = data.models.map((m) => ({
      label: m.id,
      number: m.requests,
      tooltipRows: [
        { label: "Requests", value: F.toText(m.requests, "count") },
        { label: "Output tokens", value: F.toText(m.output, "compact") },
        { label: "Cache read tokens", value: F.toText(m.cache_read, "compact") },
      ],
    }));
    safely("chart-models", () => renderBarList(document.getElementById("chart-models"), modelRows, {
      title: "Model requests",
      unit: "requests",
      color: "var(--series-3)",
      kind: "compact",
      emptyText: "No model usage recorded yet.",
    }));

    safely("harnesses", () => renderHarnesses(document.getElementById("harnesses"), data.harnesses));

    const bucketOrder = ["0", "1-2", "3-5", "6+"];
    const subagentRows = bucketOrder.map((k) => ({
      label: `${k} subagents`,
      number: data.subagents.buckets[k],
    }));
    safely("chart-subagents", () => renderBarList(document.getElementById("chart-subagents"), subagentRows, {
      title: "Subagent fan-out",
      unit: "sessions",
      color: "var(--series-1)",
      kind: "count",
      suffix: " sessions",
      emptyText: "No session data yet.",
    }));

    safely("jobs-table", () => renderJobsTable(document.getElementById("jobs-table"), data.jobs));
  }

  main();
})();
