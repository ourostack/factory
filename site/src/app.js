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

  function renderBarList(container, rows, opts) {
    container.innerHTML = "";
    if (!rows.length) {
      emptyState(container, opts.emptyText || "No data yet.");
      return;
    }
    const wrap = el("div", "bars");
    const color = opts.color || "var(--series-1)";
    const raw = (n) => (n && n.state !== "unavailable" ? n.value : null);
    const values = rows.flatMap((r) => [raw(r.number), raw(r.secondary)].filter((v) => typeof v === "number"));
    const maxVal = opts.max ?? Math.max(1, ...values);
    const useLog = opts.scale === "log";
    const denom = useLog ? Math.log1p(maxVal) || 1 : maxVal || 1;
    function widthPct(v) {
      if (!v || v <= 0) return 0;
      const scaled = useLog ? Math.log1p(v) : v;
      return Math.min(100, (scaled / denom) * 100);
    }

    for (const row of rows) {
      const rowEl = el("div", "bar-row");
      rowEl.tabIndex = 0;
      const labelEl = el("span", "bar-label", row.label);
      labelEl.title = row.label;
      if (row.flag) {
        // The doubt must stay readable: let the label wrap rather than cut it off.
        labelEl.appendChild(el("span", "bar-flag", ` (${row.flag})`));
        labelEl.style.whiteSpace = "normal";
        labelEl.style.overflow = "visible";
      }
      const trackEl = el("div", "bar-track");
      if (typeof raw(row.secondary) === "number") {
        const secEl = el("div", "bar-fill secondary");
        secEl.style.width = `${widthPct(raw(row.secondary))}%`;
        trackEl.appendChild(secEl);
      }
      const fillEl = el("div", "bar-fill");
      fillEl.style.width = `${widthPct(raw(row.number))}%`;
      fillEl.style.background = row.color || color;
      trackEl.appendChild(fillEl);
      const valueEl = el("span", "bar-value");
      valueEl.appendChild(num(row.number, opts.kind, { nofn: opts.nofn }));
      if (opts.suffix) valueEl.appendChild(document.createTextNode(opts.suffix));
      rowEl.append(labelEl, trackEl, valueEl);

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
      rowEl.addEventListener("focus", showTT);
      rowEl.addEventListener("blur", hideTooltip);
      wrap.appendChild(rowEl);
    }
    container.appendChild(wrap);
  }

  // -------------------------------------------------------- intake chart
  // The one true time-series in this page: daily count of facts files
  // first landing on `main`, from ordinary public Git commit metadata.

  function formatDayLabel(dayStr) {
    const m = dayStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dayStr;
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
  }

  function renderIntakeChart(container, rawItems) {
    container.innerHTML = "";
    if (!rawItems.length) {
      emptyState(container, "No intake history available yet.");
      return;
    }
    // Each day's count is a measured number; the running total is their sum.
    let running = 0;
    const items = rawItems.map((i) => {
      running += i.count.value;
      return { day: i.day, count: running, added: i.count };
    });
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
    svg.setAttribute("aria-label", "Cumulative sessions published, by day");

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
    const tickEvery = Math.max(1, Math.ceil(items.length / 6));

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
      rect.setAttribute("class", "mark");
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
        tick.textContent = formatDayLabel(item.day);
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

  const WASTE_NAMES = {
    defects: "Defects",
    overproduction: "Overproduction",
    waiting: "Waiting",
    non_utilized_talent: "Non-utilized talent",
    transportation: "Transportation",
    inventory: "Inventory",
    motion: "Motion",
    extra_processing: "Extra processing",
    // A real label: the evaluator looked and could not tell. Never folded into another.
    unknown: "Unknown (the evaluator could not tell)",
  };

  const WASTE_QUALIFIER_TEXT = {
    unknown_label: "the evaluator looked at this time and could not tell what kind of waste it was. It is shown as its own row, is not counted as any other waste, and is not counted in the waste total because it is not known to be waste. It is part of the waste and unknown time the shares are taken of.",
    low_confidence: "some of this time rests on labels the evaluator marked low confidence, so do not rely on it.",
    confidence_not_recorded: "the evaluator's confidence was not recorded, so this is not shown as sound.",
  };

  function statusColor(status) {
    return STATUS_COLOR[status] || "var(--text-muted)";
  }

  function measuredCount(v) {
    return { state: "measured", value: v, reasons: [] };
  }

  // ----------------------------------------------------- trust and slots

  const TRUST_LABEL = { ok: "ok", thin_sample: "thin sample", partial: "partial", low_coverage: "low coverage" };

  // The trust state of a headline, as text beside the figure: its status in
  // words, why, and what is known about capture coverage. Coverage is never
  // shown as a percentage until a coverage record exists.
  function trustNode(t) {
    const wrap = el("span", `trust trust-${t.status}`);
    wrap.appendChild(el("span", "trust-label", `trust: ${TRUST_LABEL[t.status] || t.status}`));
    wrap.appendChild(el("span", "trust-reason", ` — ${t.reason}`));
    wrap.appendChild(el("span", "trust-coverage", ` · ${F.coverageWords(t.coverage)}`));
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

  function renderKPIs(container, headlines) {
    container.innerHTML = "";
    for (const h of headlines) {
      const tile = el("div", "stat-tile");
      tile.appendChild(el("p", "stat-label", h.label));
      const value = el("p", "stat-value");
      value.appendChild(num(h.number, KPI_KIND[h.id] || "count"));
      tile.appendChild(value);
      const note = el("p", "stat-note");
      note.appendChild(templated(h.note.template, h.note.slots));
      tile.appendChild(note);
      const t = el("p", "stat-trust");
      t.appendChild(trustNode(h.trust));
      tile.appendChild(t);
      container.appendChild(tile);
    }
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
    takeaways.forEach((t, idx) => {
      const row = el("div", "takeaway");
      row.appendChild(el("span", "takeaway-index", String(idx + 1)));
      const textEl = el("span", "takeaway-text");
      // The model-request total is a compact count; everything else is a count
      // or a share. The slot's own name picks the kind.
      textEl.appendChild(templated(t.template, t.slots, TAKEAWAY_KINDS, true));
      const tr = el("span", "takeaway-trust");
      tr.appendChild(trustNode(t.trust));
      textEl.appendChild(tr);
      row.appendChild(textEl);
      container.appendChild(row);
    });
  }

  // ------------------------------------------------------------ featured

  function renderFeatured(container, featured) {
    container.innerHTML = "";
    if (!featured.length) {
      emptyState(
        container,
        "No session in the store yet references a public pull request long enough to feature here.",
      );
      return;
    }
    for (const f of featured) {
      const card = el("div", "featured-card");

      const figure = el("div", "featured-figure");
      figure.appendChild(num(f.duration_ms, "hours"));
      figure.appendChild(el("span", "unit", " hours, one session"));
      card.appendChild(figure);

      card.appendChild(el("p", "featured-sub", `${f.host} · session ${f.session_id.slice(0, 8)}`));

      const stats = el("div", "featured-stats");
      const statDefs = [
        ["Active time", f.active_ms, "duration"],
        ["Subagents dispatched", f.subagent_count, "count"],
        ["Tool calls", f.tool_calls_total, "count"],
        ["Tool failures", f.tool_failures_total, "count"],
      ];
      for (const [label, number, kind] of statDefs) {
        const s = el("div");
        const strong = el("strong");
        strong.appendChild(num(number, kind));
        s.appendChild(strong);
        s.appendChild(document.createTextNode(label));
        stats.appendChild(s);
      }
      card.appendChild(stats);

      const mergeLine = el("p", "featured-merge");
      const merged = el("span", "merge-count");
      merged.appendChild(num(f.prs_merged, "count", { nofn: false }));
      merged.appendChild(document.createTextNode(" of "));
      merged.appendChild(num(f.prs_total, "count"));
      mergeLine.appendChild(merged);
      mergeLine.appendChild(document.createTextNode(" referenced pull requests confirmed merged"));
      card.appendChild(mergeLine);
      if (f.verification === "partial") {
        card.appendChild(el("p", "featured-sub", "Not every reference could be checked live against GitHub for this build."));
      } else if (f.verification === "unavailable") {
        card.appendChild(el("p", "featured-sub", "Merge status could not be verified for this build."));
      }

      if (f.sample_merged_prs.length) {
        const list = el("ul", "pr-repo-list");
        for (const pr of f.sample_merged_prs) {
          const li = document.createElement("li");
          li.appendChild(safeLink(`merged pull request ${pr.ref}`, pr.url));
          list.appendChild(li);
        }
        card.appendChild(list);
      }

      if (f.models.length) {
        card.appendChild(el("p", "featured-models", `Models: ${f.models.join(", ")}`));
      }

      container.appendChild(card);
    }
  }

  // -------------------------------------------------------------- waste

  function renderWaste(captionEl, panelEl, waste) {
    const total = waste.jobs_total;
    const labeled = waste.jobs_labeled;
    const labelFiles = waste.label_files;
    const isPositive = (n) => n.state !== "unavailable" && n.value > 0;
    captionEl.innerHTML = "";
    if (isPositive(labeled)) {
      captionEl.appendChild(num(labeled, "count", { nofn: false }));
      captionEl.appendChild(document.createTextNode(" of "));
      captionEl.appendChild(num(total, "count", { nofn: false }));
      captionEl.appendChild(document.createTextNode(" jobs are fully labeled for waste. Bars show total time lost to each type, across labeled jobs."));
    } else if (isPositive(labelFiles)) {
      captionEl.appendChild(document.createTextNode("Labeling has just started: "));
      captionEl.appendChild(num(labelFiles, "count", { nofn: false }));
      captionEl.appendChild(document.createTextNode(" session labels exist, but no job is fully labeled yet — a job needs every one of its sessions evaluated before it counts here. The taxonomy below is what labeling classifies against; bars appear as finished jobs are evaluated."));
    } else if (labelFiles.state === "unavailable") {
      captionEl.appendChild(document.createTextNode("Labeling coverage is not recorded in this build ("));
      captionEl.appendChild(document.createTextNode(F.describe(labelFiles, "count").reason));
      captionEl.appendChild(document.createTextNode("). The taxonomy below is what labeling classifies against."));
    } else {
      captionEl.textContent = "Labeling has just started: no session has been evaluated yet. The taxonomy below is what labeling will classify against; bars appear here as finished jobs are evaluated.";
    }

    panelEl.innerHTML = "";
    if (isPositive(labeled) && waste.breakdown && waste.breakdown.length) {
      const nameOf = (w) => WASTE_NAMES[w.waste] || w.waste;
      const rows = waste.breakdown.map((w) => {
        const q = Array.isArray(w.qualifiers) ? w.qualifiers : ["confidence_not_recorded"];
        const conf = w.confidence || {};
        const confRow = (label, key) => ({ label, value: conf[key] ? F.toText(conf[key], "duration") : "not recorded" });
        return {
          label: nameOf(w),
          flag: q.length ? "not sound" : "",
          color: w.waste === "unknown" ? "var(--text-muted)" : undefined,
          number: w.total_ms,
          tooltipRows: [
            { label: "Time lost", value: F.toText(w.total_ms, "duration") },
            { label: "Jobs affected", value: F.toText(w.jobs, "count") },
            { label: "Share of waste and unknown time", value: F.toText(w.share, "pct1") },
            { label: "Evaluator versions", value: w.evaluator_versions && w.evaluator_versions.state !== "unavailable" ? String(w.evaluator_versions.value) : "not recorded" },
            confRow("Resting on high-confidence labels", "high_ms"),
            confRow("Resting on medium-confidence labels", "medium_ms"),
            confRow("Resting on low-confidence labels", "low_ms"),
          ],
        };
      });
      renderBarList(panelEl, rows, { color: "var(--series-8)", kind: "duration" });
      // The same facts in plain, always-visible words: a hover is not the only place a doubt is stated.
      const notes = el("ul", "waste-notes");
      for (const w of waste.breakdown) {
        const q = Array.isArray(w.qualifiers) ? w.qualifiers : ["confidence_not_recorded"];
        for (const code of q) notes.appendChild(el("li", "", `${nameOf(w)}: ${WASTE_QUALIFIER_TEXT[code] || code.replace(/_/g, " ")}`));
      }
      if (notes.children.length) panelEl.appendChild(notes);
      else panelEl.appendChild(el("p", "chart-caption", "Every row above rests on labels whose confidence was recorded and none of it low."));
      const known = waste.breakdown.filter((w) => w.evaluator_versions && w.evaluator_versions.state !== "unavailable");
      const unrecorded = waste.breakdown.filter((w) => !(w.evaluator_versions && w.evaluator_versions.state !== "unavailable")).map(nameOf);
      const versions = [...new Set(known.flatMap((w) => String(w.evaluator_versions.value).split(", ")))];
      const said = [];
      if (versions.length) said.push(`Labels assigned by evaluator version ${versions.join(", ")}.`);
      if (unrecorded.length) said.push(`The evaluator version was not recorded for: ${unrecorded.join(", ")}.`);
      panelEl.appendChild(el("p", "chart-caption", said.join(" ")));
      return;
    }

    const grid = el("div", "waste-grid");
    for (const code of waste.wastes) {
      const item = el("div", "waste-item");
      item.appendChild(el("p", "waste-name", WASTE_NAMES[code] || code));
      item.appendChild(el("p", "waste-code", code));
      grid.appendChild(item);
    }
    panelEl.appendChild(grid);
  }

  // ------------------------------------------------------------- kaizen

  function renderKaizen(container, kaizenIssues, andonIssues, kaizenVerification, andonVerification) {
    container.innerHTML = "";
    const kaizenOk = kaizenVerification !== "unavailable";
    const andonOk = andonVerification !== "unavailable";
    if (!kaizenIssues.length && !andonIssues.length && !kaizenOk && !andonOk) {
      emptyState(
        container,
        "Kaizen and andon issues couldn't be checked for this build (the GitHub request didn't succeed). This says nothing about how many actually exist — check back on the next build.",
      );
      return;
    }
    if (!kaizenIssues.length && !andonIssues.length) {
      emptyState(container, "No kaizen or andon issues opened yet.");
      return;
    }
    function list(title, issues, emptyNote) {
      const wrap = document.createElement("div");
      wrap.style.marginBottom = "14px";
      wrap.appendChild(el("p", "stat-label", title));
      if (!issues.length) {
        wrap.appendChild(el("p", "chart-empty", emptyNote));
        return wrap;
      }
      const ul = el("ul", "issue-list");
      for (const issue of issues.slice(0, 12)) {
        const li = document.createElement("li");
        const left = document.createElement("span");
        const dot = el("span", "status-dot");
        dot.style.background = issue.issue_state === "open" ? "var(--status-warning)" : "var(--status-good)";
        left.appendChild(dot);
        // Only an auto-filed title is published; anything else is the number.
        left.appendChild(safeLink(issue.title || `Issue ${issue.ref}`, issue.url));
        li.appendChild(left);

        const right = el("span", "issue-right");
        right.appendChild(el("span", "issue-num", `${issue.ref} · ${issue.issue_state}`));
        const res = issue.resolution;
        if (issue.issue_state === "closed" && res && res.kind === "countermeasure") {
          const resLine = document.createElement("span");
          resLine.className = "issue-resolution";
          resLine.appendChild(document.createTextNode(res.merged === true ? "fixed by " : "closed, references "));
          resLine.appendChild(safeLink(`pull request ${res.ref}`, res.url));
          if (res.merged === false) resLine.appendChild(document.createTextNode(" (not yet merged)"));
          if (res.merged === "unknown") resLine.appendChild(document.createTextNode(" (merge state not checked)"));
          right.appendChild(resLine);
        } else if (issue.issue_state === "closed") {
          right.appendChild(el("span", "issue-resolution", "closed"));
        }
        li.appendChild(right);
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      return wrap;
    }
    container.appendChild(
      list("Kaizen — improvement issues", kaizenIssues, kaizenOk ? "No kaizen issues opened yet." : "Kaizen issues couldn't be checked for this build."),
    );
    container.appendChild(
      list(
        "Andon — stop-the-line signals",
        andonIssues,
        andonOk ? "No andon issues — no tracked plugin release has been flagged." : "Andon issues couldn't be checked for this build.",
      ),
    );
  }

  // ------------------------------------------------------------ outcomes
  // Sign-off, first-pass yield, rework and attention, each a stated number
  // from the reports. An unwitnessed answer is never an acceptance here.

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

  function renderOutcomes(container, o) {
    container.innerHTML = "";
    if (!o || !o.signoff) {
      emptyState(container, "Sign-off is not part of this build's data.");
      return;
    }
    const grid = el("div", "outcome-tiles");

    const head = el("div", "stat-tile outcome-block");
    head.appendChild(el("h4", null, "Human attention per accepted outcome"));
    const v = el("p", "stat-value");
    v.appendChild(num(o.attention.headline, "duration"));
    head.appendChild(v);
    head.appendChild(el("div", "stat-note", "An estimate of the time a human spent reading and answering, over the outcomes they accepted."));
    const turns = el("p", "stat-note");
    turns.appendChild(document.createTextNode("Human turns per accepted outcome: "));
    turns.appendChild(num(o.attention.turns_per_accepted, "count"));
    head.appendChild(turns);
    // A trust line speaks of a figure; with no figure there is nothing to trust.
    if (o.attention.headline.state !== "unavailable") {
      const t = el("p", "stat-trust");
      t.appendChild(trustNode(o.attention.trust));
      head.appendChild(t);
    }
    grid.appendChild(head);
    container.appendChild(grid);

    const so = el("div", "outcome-block");
    so.appendChild(el("h4", null, "Sign-off"));
    const dl = el("dl", "health-facts");
    figure(dl, "Accepted, witnessed", o.signoff.accepted);
    figure(dl, "Accepted, not witnessed", o.signoff.accepted_unverified);
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
    figure(dl, "Sent back, not witnessed (part of sent back)", o.signoff.refused_unverified);
    figure(dl, "Delivered before sign-off was recorded", o.signoff.not_recorded);
    figure(dl, "Jobs with no sign-off record", o.signoff.no_record);
    so.appendChild(dl);

    const fp = el("div", "stat-tile outcome-block");
    fp.appendChild(el("h4", null, "First-pass yield"));
    const fv = el("p", "stat-value");
    fv.appendChild(num(o.first_pass_yield, "pct"));
    fp.appendChild(fv);
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
    container.appendChild(so);

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
      check.appendChild(document.createTextNode(" refusals, "));
      check.appendChild(num(o.rework.reason_check.compared_verified, "count"));
      check.appendChild(document.createTextNode(" of them witnessed"));
    }
    row(rdl, "Agent's and human's reasons disagreed", check);
    figure(rdl, "Defect time caught inside the task", o.rework.defects.in_task_ms, "duration");
    figure(rdl, "Defect time with no catch point", o.rework.defects.not_placed_ms, "duration");
    rw.appendChild(rdl);
    container.appendChild(rw);
  }

  // --------------------------------------------------------------- jobs

  function renderJobsTable(container, jobs) {
    container.innerHTML = "";
    if (!jobs.length) {
      emptyState(container, "No jobs tracked yet.");
      return;
    }
    const wrap = el("div", "table-wrap");
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const cols = ["Job", "Status", "Sign-off", "Lead time", "Active time", "Flow eff.", "Tool failures", "Tool retries", "Sessions", "Public PRs"];
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = c;
      if (c === "Flow eff.") th.title = "Active time ÷ lead time. Higher means less of the job's time was spent waiting.";
      if (c !== "Job" && c !== "Status" && c !== "Sign-off") th.className = "num";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const j of jobs) {
      const tr = document.createElement("tr");

      const idTd = document.createElement("td");
      const link = document.createElement("a");
      const safe = F.safeAnchor(`job-${j.id}`);
      if (safe) link.href = safe;
      link.title = `Open the job page for ${j.id}`;
      const code = document.createElement("code");
      code.textContent = j.id.slice(0, 10);
      link.appendChild(code);
      idTd.appendChild(link);
      tr.appendChild(idTd);

      const statusTd = document.createElement("td");
      const dot = el("span", "status-dot");
      dot.style.background = statusColor(j.status);
      statusTd.appendChild(dot);
      statusTd.appendChild(document.createTextNode(j.status));
      tr.appendChild(statusTd);

      const signTd = document.createElement("td");
      signTd.appendChild(num(j.signoff, "text"));
      tr.appendChild(signTd);

      const cells = [
        [j.lead_time_ms, "duration"],
        [j.active_time_ms, "duration"],
        [j.flow_efficiency, "pct"],
        [j.tool_failures, "count"],
        [j.tool_retries, "count"],
        [j.sessions_bound, "count"],
        [j.public_prs, "count"],
      ];
      cells.forEach(([number, kind], i) => {
        const td = document.createElement("td");
        td.className = "num";
        td.appendChild(num(number, kind));
        if (i === 5 && number.state !== "unavailable") td.appendChild(document.createTextNode(" bound"));
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // ------------------------------------------------------------ job page
  // One job's every measure, each with its state in words and its reason in
  // text beside it, not only on hover. Opened from the jobs table; its
  // address is #job-<id>, so a job page can be linked.

  // Which entry of data.scopes each captioned section reads.
  const SCOPE_OF = { headlines: "headlines", tool_calls: "tool_kinds", tool_failures: "tool_kinds", models: "models", subagents: "subagents", harnesses: "harnesses" };

  const STATE_WORD = { measured: "measured", partial: "partial", unavailable: "no data" };
  const JOB_ID = /^[0-9A-Za-z_-]{1,64}$/;

  function jobIdFromHash() {
    const m = /^#job-(.+)$/.exec(window.location.hash || "");
    return m && JOB_ID.test(m[1]) ? m[1] : null;
  }

  function renderJobDetail(container, jobs, id) {
    container.innerHTML = "";
    const j = id ? jobs.find((x) => x.id === id) : null;
    const card = container.closest(".chart-card") || container;
    if (!j) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    container.appendChild(el("h3", null, `Job ${j.id.slice(0, 10)}`));
    container.appendChild(
      el(
        "p",
        "chart-caption",
        `Status: ${j.status}. Every measure the store's report holds for this job. "Measured" is the whole figure, and a zero here is a measured zero. "Partial" covers only part of the job ("at least" or "at most" says which way the true figure lies, when that is known). "No data" means the store could not measure it. The reason is beside each.`,
      ),
    );
    const wrap = el("div", "table-wrap");
    const table = document.createElement("table");
    table.className = "data-table job-detail-table";
    const head = document.createElement("tr");
    for (const c of ["Measure", "Figure", "State", "Why"]) {
      const th = document.createElement("th");
      th.textContent = c;
      if (c === "Figure") th.className = "num";
      head.appendChild(th);
    }
    const thead = document.createElement("thead");
    thead.appendChild(head);
    table.appendChild(thead);
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
      tr.appendChild(el("td", "state-why", figure.state === "measured" ? "" : figure.reason));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    const back = document.createElement("a");
    const safe = F.safeAnchor("jobs-table");
    back.href = safe;
    back.textContent = "Back to every job";
    container.appendChild(back);
  }

  function showJobFromHash(jobs) {
    const container = document.getElementById("job-detail");
    if (!container) return;
    const id = jobIdFromHash();
    renderJobDetail(container, jobs, id);
    if (id && !container.closest(".chart-card").hidden) container.closest(".chart-card").scrollIntoView({ block: "start" });
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
    const builtDate = new Date(health.built_at);
    row(
      dl,
      "Last successful data build",
      Number.isFinite(builtDate.getTime())
        ? `${builtDate.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${v.ageHours !== null ? ` (${Math.max(0, Math.floor(v.ageHours))} hours ago)` : ""}`
        : "no data (the build stamp could not be read)",
    );
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
    } else if (verdict.missing.length && verdict.missing.every((x) => x.codes.length === 1 && x.codes[0] === "no_records")) {
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

  async function main() {
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
      emptyState(document.getElementById("featured-grid"), msg);
      return;
    }
    renderHealth(document.getElementById("health-panel"), health, true, "");
    // (main continues even if the health panel failed: renderHealth contains its own errors)

    // Build metadata footer
    const built = new Date(data.built_at);
    const meta = document.getElementById("build-meta");
    meta.innerHTML = "";
    meta.appendChild(
      document.createTextNode(
        `Built ${built.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} from the store's public data`,
      ),
    );
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
    renderFeatured(document.getElementById("featured-grid"), data.featured);

    // 2. Work design — scoped to substantial sessions (active at least 5
    // minutes, or bound to a tracked job), since that is real work rather
    // than a launcher blip or a scripted check.
    renderKPIs(document.getElementById("kpi-row"), data.headlines);

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

    renderCaptureCoverage(document.getElementById("capture-coverage"), data.capture_coverage);
    renderLoop(document.getElementById("loop-health"), data.loop_health);
    renderTakeaways(document.getElementById("takeaways"), data.takeaways);

    const timeBreakdownNoteEl = document.getElementById("time-breakdown-note");
    if (timeBreakdownNoteEl && data.flow_efficiency) {
      const fe = data.flow_efficiency.median;
      timeBreakdownNoteEl.innerHTML = "";
      timeBreakdownNoteEl.appendChild(num(measuredCount(fe.N), "count"));
      timeBreakdownNoteEl.appendChild(document.createTextNode(" of "));
      timeBreakdownNoteEl.appendChild(num(data.coverage.jobs, "count", { nofn: false }));
      timeBreakdownNoteEl.appendChild(document.createTextNode(" tracked jobs apply here (finished, whole life inside capture); each figure below says how many of those it rests on and how many jobs are out of scope."));
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
    renderBarList(document.getElementById("chart-time-breakdown"), timeBreakdownRows, {
      scale: "log",
      color: "var(--series-1)",
      kind: "duration",
      suffix: " med.",
      emptyText: "Not enough measured jobs yet.",
    });
    // Beside each row's figure: its trust state, as text.
    document.querySelectorAll("#chart-time-breakdown .bar-row").forEach((rowEl, i) => {
      const t = timeBreakdownRows[i].trust;
      const line = el("div", "bar-trust");
      line.appendChild(trustNode(t));
      rowEl.after(line);
    });

    renderWaste(document.getElementById("waste-caption"), document.getElementById("waste-panel"), data.waste);
    renderOutcomes(document.getElementById("outcomes-panel"), data.outcomes);
    renderKaizen(
      document.getElementById("kaizen-panel"),
      data.kaizen_issues,
      data.andon_issues,
      data.kaizen.verification,
      data.andon_verification,
    );

    // 3. Detail views
    renderIntakeChart(document.getElementById("chart-intake"), data.intake_over_time);

    const statusRows = Object.entries(data.job_status_counts)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([status, count]) => ({ label: status, number: count, color: statusColor(status) }));
    renderBarList(document.getElementById("chart-job-status"), statusRows, {
      kind: "count",
      emptyText: "No jobs tracked yet.",
    });

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
    renderBarList(document.getElementById("chart-tool-calls"), toolCallRows, {
      color: "var(--series-1)",
      kind: "compact",
      emptyText: "No tool calls recorded yet.",
    });

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
    renderBarList(document.getElementById("chart-tool-failures"), failureRows, {
      color: "var(--series-2)",
      max: Math.max(0.05, ...failureRows.map((r) => (r.number.state === "unavailable" ? 0 : r.number.value))),
      kind: "pct1",
      emptyText: "No tool kind has 20 or more recorded calls yet.",
    });

    const modelRows = data.models.map((m) => ({
      label: m.id,
      number: m.requests,
      tooltipRows: [
        { label: "Requests", value: F.toText(m.requests, "count") },
        { label: "Output tokens", value: F.toText(m.output, "compact") },
        { label: "Cache read tokens", value: F.toText(m.cache_read, "compact") },
      ],
    }));
    renderBarList(document.getElementById("chart-models"), modelRows, {
      color: "var(--series-3)",
      kind: "compact",
      emptyText: "No model usage recorded yet.",
    });

    renderHarnesses(document.getElementById("harnesses"), data.harnesses);

    const bucketOrder = ["0", "1-2", "3-5", "6+"];
    const subagentRows = bucketOrder.map((k) => ({
      label: `${k} subagents`,
      number: data.subagents.buckets[k],
    }));
    renderBarList(document.getElementById("chart-subagents"), subagentRows, {
      color: "var(--series-1)",
      kind: "count",
      suffix: " sessions",
      emptyText: "No session data yet.",
    });

    renderJobsTable(document.getElementById("jobs-table"), data.jobs);
    showJobFromHash(data.jobs);
    window.addEventListener("hashchange", () => showJobFromHash(data.jobs));
  }

  main();
})();
