// Factory site renderer. Fetches ./data.json (built at CI time from the
// public store) and draws every chart with plain DOM/SVG - no chart library,
// no framework. All labels come from the store and are inserted with
// textContent, never innerHTML, since they are untrusted data.

(function () {
  "use strict";

  const DATA_URL = "./data.json";
  const tooltip = document.getElementById("tooltip");

  // ---------------------------------------------------------------- format

  function fmtDuration(ms) {
    if (ms === null || ms === undefined) return "unavailable";
    const v = Math.max(0, ms);
    if (v < 1000) return "<1s";
    const sec = v / 1000;
    if (sec < 60) return `${Math.round(sec)}s`;
    const min = sec / 60;
    if (min < 60) return `${Math.round(min)}m`;
    const hr = min / 60;
    if (hr < 48) return `${hr.toFixed(1)}h`;
    const day = hr / 24;
    return `${day.toFixed(1)}d`;
  }

  function fmtHours1(ms) {
    if (ms === null || ms === undefined) return "unavailable";
    return (ms / 3600000).toFixed(1);
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return "unavailable";
    return n.toLocaleString();
  }

  function fmtCompact(n) {
    if (n === null || n === undefined) return "unavailable";
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return `${n}`;
  }

  function fmtPct(x, digits = 0) {
    if (x === null || x === undefined) return "unavailable";
    return `${(x * 100).toFixed(digits)}%`;
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
  // rows: [{ label, value, secondaryValue?, color?, tooltipRows? }]

  function renderBarList(container, rows, opts) {
    container.innerHTML = "";
    if (!rows.length) {
      emptyState(container, opts.emptyText || "No data yet.");
      return;
    }
    const wrap = el("div", "bars");
    const color = opts.color || "var(--series-1)";
    const values = rows.flatMap((r) =>
      [r.value, r.secondaryValue].filter((v) => typeof v === "number"),
    );
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
      const trackEl = el("div", "bar-track");
      if (typeof row.secondaryValue === "number") {
        const secEl = el("div", "bar-fill secondary");
        secEl.style.width = `${widthPct(row.secondaryValue)}%`;
        trackEl.appendChild(secEl);
      }
      const fillEl = el("div", "bar-fill");
      fillEl.style.width = `${widthPct(row.value)}%`;
      fillEl.style.background = row.color || color;
      trackEl.appendChild(fillEl);
      const valueEl = el("span", "bar-value", opts.formatValue(row));
      rowEl.append(labelEl, trackEl, valueEl);

      const showTT = (evt) => {
        const rect = rowEl.getBoundingClientRect();
        const x = evt && "clientX" in evt && evt.clientX ? evt.clientX : rect.right;
        const y = evt && "clientY" in evt && evt.clientY ? evt.clientY : rect.top + rect.height / 2;
        const ttRows = row.tooltipRows || [{ label: "Value", value: opts.formatValue(row) }];
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
  // The one true time-series in this page: hourly count of facts files
  // first landing on `main`, from ordinary public Git commit metadata.

  function formatHourLabel(hourStr) {
    const m = hourStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/);
    if (!m) return hourStr;
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)} ${m[4]}:00`;
  }

  function renderIntakeChart(container, rawItems) {
    container.innerHTML = "";
    if (!rawItems.length) {
      emptyState(container, "No intake history available yet.");
      return;
    }
    let running = 0;
    const items = rawItems.map((i) => {
      running += i.count;
      return { hour: i.hour, count: running, added: i.count };
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
    svg.setAttribute("aria-label", "Cumulative sessions published, by hour");

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
      label.textContent = String(Math.round(maxCount * frac));
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
        showTooltipAt(cx, cy, item.hour.replace("T", " "), [
          { label: "Total published so far", value: item.count.toLocaleString() },
          { label: "Published this hour", value: item.added.toLocaleString() },
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
        tick.textContent = formatHourLabel(item.hour);
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
  };

  function statusColor(status) {
    return STATUS_COLOR[status] || "var(--text-muted)";
  }

  // ---------------------------------------------------------------- KPIs

  function renderKPIs(container, tiles) {
    container.innerHTML = "";
    for (const t of tiles) {
      const tile = el("div", "stat-tile");
      tile.appendChild(el("p", "stat-label", t.label));
      tile.appendChild(el("p", "stat-value", t.value));
      if (t.note) tile.appendChild(el("p", "stat-note", t.note));
      container.appendChild(tile);
    }
  }

  // ----------------------------------------------------------- takeaways

  function renderTakeaways(container, takeaways) {
    container.innerHTML = "";
    if (!takeaways.length) {
      emptyState(container, "Not enough evidence yet for a computed takeaway.");
      return;
    }
    takeaways.forEach((t, idx) => {
      const row = el("div", "takeaway");
      row.appendChild(el("span", "takeaway-index", String(idx + 1)));
      const textEl = el("span", "takeaway-text", t.text);
      if (t.small_sample) {
        const badge = el("span", "badge badge-sample", `small sample, n=${t.n}`);
        textEl.appendChild(badge);
      }
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
      figure.appendChild(document.createTextNode(fmtHours1(f.duration_ms)));
      figure.appendChild(el("span", "unit", " hours, one session"));
      card.appendChild(figure);

      card.appendChild(
        el(
          "p",
          "featured-sub",
          `${f.host} · session ${f.session_id.slice(0, 8)}`,
        ),
      );

      const stats = el("div", "featured-stats");
      const statDefs = [
        ["Active time", fmtDuration(f.active_ms)],
        ["Subagents dispatched", fmtNum(f.subagent_count)],
        ["Tool calls", fmtNum(f.tool_calls_total)],
        ["Tool failures", fmtNum(f.tool_failures_total)],
      ];
      for (const [label, value] of statDefs) {
        const s = el("div");
        s.appendChild(el("strong", null, value));
        s.appendChild(document.createTextNode(label));
        stats.appendChild(s);
      }
      card.appendChild(stats);

      const mergeLine = el("p", "featured-merge");
      mergeLine.appendChild(
        el("span", "merge-count", `${f.prs_merged} of ${f.prs_total}`),
      );
      mergeLine.appendChild(
        document.createTextNode(" referenced pull requests confirmed merged"),
      );
      card.appendChild(mergeLine);
      if (f.verification === "partial") {
        card.appendChild(
          el(
            "p",
            "featured-sub",
            "Not every reference could be checked live against GitHub for this build.",
          ),
        );
      } else if (f.verification === "unavailable") {
        card.appendChild(
          el("p", "featured-sub", "Merge status could not be verified for this build."),
        );
      }

      if (f.sample_merged_prs.length) {
        const list = el("ul", "pr-repo-list");
        for (const pr of f.sample_merged_prs) {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = pr.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = `${pr.repo}#${pr.number}`;
          li.appendChild(a);
          const repoTotal = f.pr_repos.find((r) => r.repo === pr.repo);
          li.appendChild(
            el(
              "span",
              null,
              repoTotal ? `${repoTotal.count} referenced` : "",
            ),
          );
          list.appendChild(li);
        }
        card.appendChild(list);
      }

      if (f.models.length) {
        const top = f.models
          .slice(0, 2)
          .map((m) => m.id)
          .join(", ");
        card.appendChild(el("p", "featured-models", `Models: ${top}`));
      }

      container.appendChild(card);
    }
  }

  // -------------------------------------------------------------- waste

  function renderWaste(captionEl, panelEl, waste) {
    const total = waste.jobs_total ?? 0;
    const labeled = waste.jobs_labeled ?? 0;
    const labelFiles = waste.label_files ?? 0;
    if (labeled > 0) {
      captionEl.textContent = `${labeled} of ${total} jobs are fully labeled for waste. Bars show total time lost to each type, across labeled jobs.`;
    } else if (labelFiles > 0) {
      captionEl.textContent = `Labeling has just started: ${labelFiles} session${labelFiles === 1 ? "" : "s"} labeled, but no job is fully labeled yet — a job needs every one of its sessions evaluated before it counts here. The taxonomy below is what labeling classifies against; bars appear as finished jobs are evaluated.`;
    } else {
      captionEl.textContent = `Labeling has just started: no session has been evaluated yet. The taxonomy below is what labeling will classify against; bars appear here as finished jobs are evaluated.`;
    }

    panelEl.innerHTML = "";
    if (labeled > 0 && waste.breakdown && waste.breakdown.length) {
      const rows = waste.breakdown.map((w) => ({
        label: WASTE_NAMES[w.waste] || w.waste,
        value: w.total_ms,
        tooltipRows: [
          { label: "Time lost", value: fmtDuration(w.total_ms) },
          { label: "Jobs affected", value: fmtNum(w.jobs) },
          { label: "Share of labeled waste", value: w.share != null ? fmtPct(w.share, 1) : "unavailable" },
        ],
      }));
      renderBarList(panelEl, rows, {
        color: "var(--series-8)",
        formatValue: (r) => fmtDuration(r.value),
      });
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
        dot.style.background =
          issue.state === "open" ? "var(--status-warning)" : "var(--status-good)";
        left.appendChild(dot);
        const a = document.createElement("a");
        a.href = issue.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = issue.title;
        left.appendChild(a);
        li.appendChild(left);

        const right = el("span", "issue-right");
        right.appendChild(el("span", "issue-num", `#${issue.number} · ${issue.state}`));
        const res = issue.resolution;
        if (issue.state === "closed" && res && res.kind === "countermeasure") {
          const resLine = document.createElement("span");
          resLine.className = "issue-resolution";
          resLine.appendChild(document.createTextNode(res.merged ? "fixed by " : "closed, references "));
          const ra = document.createElement("a");
          ra.href = res.url;
          ra.target = "_blank";
          ra.rel = "noopener";
          ra.textContent = `${res.repo}#${res.number}`;
          resLine.appendChild(ra);
          if (res.merged === false) resLine.appendChild(document.createTextNode(" (not yet merged)"));
          right.appendChild(resLine);
        } else if (issue.state === "closed") {
          right.appendChild(el("span", "issue-resolution", "closed"));
        }
        li.appendChild(right);
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      return wrap;
    }
    container.appendChild(
      list(
        "Kaizen — improvement issues",
        kaizenIssues,
        kaizenOk ? "No kaizen issues opened yet." : "Kaizen issues couldn't be checked for this build.",
      ),
    );
    container.appendChild(
      list(
        "Andon — stop-the-line signals",
        andonIssues,
        andonOk
          ? "No andon issues — no tracked plugin release has been flagged."
          : "Andon issues couldn't be checked for this build.",
      ),
    );
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
    const cols = [
      "Job",
      "Status",
      "Lead time",
      "Active time",
      "Flow eff.",
      "Tool failures",
      "Tool retries",
      "Sessions",
      "Public PRs",
    ];
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = c;
      if (c === "Flow eff.") th.title = "Active time ÷ lead time. Higher means less of the job's time was spent waiting.";
      if (c !== "Job" && c !== "Status" && c !== "Sessions") th.className = "num";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const j of jobs) {
      const tr = document.createElement("tr");

      const idTd = document.createElement("td");
      const code = document.createElement("code");
      code.textContent = j.id.slice(0, 10);
      code.title = j.id;
      idTd.appendChild(code);
      tr.appendChild(idTd);

      const statusTd = document.createElement("td");
      const dot = el("span", "status-dot");
      dot.style.background = statusColor(j.status);
      statusTd.appendChild(dot);
      statusTd.appendChild(document.createTextNode(j.status));
      tr.appendChild(statusTd);

      const leadTime = j.lead_time_censored && j.lead_time_ms != null
        ? `≥ ${fmtDuration(j.lead_time_ms)} (open)`
        : fmtDuration(j.lead_time_ms);
      const cells = [
        leadTime,
        j.active_time_shared && j.active_time_ms != null
          ? `≤ ${fmtDuration(j.active_time_ms)} (shared)`
          : fmtDuration(j.active_time_ms),
        j.flow_efficiency_shared && j.flow_efficiency != null
          ? `≤ ${fmtPct(j.flow_efficiency)} (shared)`
          : fmtPct(j.flow_efficiency),
        fmtNum(j.tool_failures),
        fmtNum(j.tool_retries),
        j.sessions_bound != null ? `${j.sessions_bound} bound` : "unavailable",
        fmtNum(j.public_prs),
      ];
      cells.forEach((val, i) => {
        const td = document.createElement("td");
        if (i !== 5) td.className = "num";
        td.textContent = val;
        if (i === 0 && j.lead_time_censored) {
          td.title = "Still open or no valid status: lower bound, not a measured lead time";
        }
        if ((i === 1 && j.active_time_shared) || (i === 2 && j.flow_efficiency_shared)) {
          td.title = "Includes time from a session shared with other jobs: an upper bound, not this job's own measured time";
        }
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // ---------------------------------------------------------------- main

  async function main() {
    let data;
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`data.json: ${res.status}`);
      data = await res.json();
    } catch (err) {
      const msg = "This page could not load the store's data (" + err.message + "). Try reloading, or check the reports branch directly.";
      emptyState(document.getElementById("featured-grid"), msg);
      return;
    }

    // Build metadata footer
    const built = new Date(data.built_at);
    const meta = document.getElementById("build-meta");
    meta.innerHTML = "";
    meta.appendChild(
      document.createTextNode(
        `Built ${built.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} from the store's public data`,
      ),
    );
    if (data.reports_commit) {
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

    // 2. Work design — scoped to substantial sessions (ran at least 5
    // minutes, or bound to a tracked job), since that is real work rather
    // than a launcher blip or a scripted check. Published sessions withhold
    // which plugins they ran by default, so plugin data cannot tell "Desk
    // sessions" apart from the rest; this page never claims to.
    const totalToolCalls = data.tool_kinds.reduce((s, t) => s + t.calls, 0);
    const totalModelRequests = data.models.reduce((s, m) => s + m.requests, 0);
    const kaizenVerified = data.kaizen.verification !== "unavailable";
    const kaizenValue = kaizenVerified ? `${fmtNum(data.kaizen.raised)} raised` : "unavailable";
    const kaizenNote = !kaizenVerified
      ? "couldn't check GitHub for this build"
      : data.kaizen.raised > 0 && data.kaizen.resolved === data.kaizen.raised
        ? `all ${data.kaizen.resolved} resolved`
        : `${fmtNum(data.kaizen.resolved)} of ${fmtNum(data.kaizen.raised)} resolved`;
    renderKPIs(document.getElementById("kpi-row"), [
      { label: "Substantial sessions", value: fmtNum(data.scope.sessions_scoped), note: `of ${fmtNum(data.scope.sessions_total)} published` },
      { label: "Jobs tracked", value: fmtNum(data.coverage.jobs), note: `${fmtNum(data.coverage.jobs_open)} open` },
      { label: "Subagent dispatches", value: fmtNum(data.subagents.subagent_dispatches), note: "substantial sessions" },
      { label: "Tool calls recorded", value: fmtCompact(totalToolCalls), note: "substantial sessions" },
      { label: "Model requests", value: fmtCompact(totalModelRequests), note: "substantial sessions" },
      { label: "Kaizen issues", value: kaizenValue, note: kaizenNote },
    ]);

    const ENTRYPOINT_NAMES = {
      desktop: "desktop",
      launcher: "Copilot launcher",
      sdk: "headless sdk automation",
      cli: "interactive cli",
    };
    function entrypointPhrase(obj) {
      return Object.entries(obj || {})
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${fmtNum(v)} ${ENTRYPOINT_NAMES[k] || k}`)
        .join(", ");
    }
    const scopeContextEl = document.getElementById("scope-context");
    if (scopeContextEl && data.scope) {
      const minutes = Math.round((data.scope.substantial_duration_ms ?? 300000) / 60000);
      scopeContextEl.textContent =
        `${fmtNum(data.scope.sessions_total)} sessions are published in total. Everything above and below in this section is scoped to the ` +
        `${fmtNum(data.scope.sessions_scoped)} that ran at least ${minutes} minutes or are bound to a tracked job (${entrypointPhrase(data.scope.entrypoints_scoped)}) — ` +
        `real, substantial work, not a launcher blip or a scripted check. The other ${fmtNum(data.scope.sessions_other)} sessions on contributing machines ` +
        `(${entrypointPhrase(data.scope.entrypoints_other)}) are shorter and unbound, shown here as context, not folded into any measure. A published session ` +
        `withholds which plugins it ran by default; only a session whose publisher separately marks each plugin name public would show one, so this page cannot ` +
        `identify "Desk sessions" specifically and does not claim to — it scopes by session length and job binding instead, both of which every published session carries.`;
    }

    renderTakeaways(document.getElementById("takeaways"), data.takeaways);

    const timeBreakdownNoteEl = document.getElementById("time-breakdown-note");
    if (timeBreakdownNoteEl && data.flow_efficiency) {
      const n = data.flow_efficiency.eligible_jobs ?? 0;
      const jobsTotal = data.flow_efficiency.jobs_total ?? data.coverage.jobs;
      timeBreakdownNoteEl.textContent =
        n > 0
          ? `Only ${n} of ${fmtNum(jobsTotal)} tracked jobs qualify right now (finished, whole life inside capture) — treat this as a small-sample signal, not a settled figure.`
          : `No job yet both finished and had its whole life inside capture, so this chart has nothing to show yet.`;
    }

    const timeBreakdownRows = data.time_breakdown.map((r) => ({
      label: r.label,
      value: r.median,
      secondaryValue: r.p75,
      tooltipRows: [
        { label: "Median", value: fmtDuration(r.median) },
        { label: "75th percentile", value: fmtDuration(r.p75) },
        { label: "Jobs measured", value: String(r.jobs_counted) },
      ],
    }));
    renderBarList(document.getElementById("chart-time-breakdown"), timeBreakdownRows, {
      scale: "log",
      color: "var(--series-1)",
      formatValue: (r) => `${fmtDuration(r.value)} med.`,
      emptyText: "Not enough measured jobs yet.",
    });

    renderWaste(document.getElementById("waste-caption"), document.getElementById("waste-panel"), data.waste);
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
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({
        label: status,
        value: count,
        color: statusColor(status),
      }));
    renderBarList(document.getElementById("chart-job-status"), statusRows, {
      formatValue: (r) => fmtNum(r.value),
      emptyText: "No jobs tracked yet.",
    });

    const toolCallRows = data.tool_kinds.slice(0, 10).map((t) => ({
      label: t.tool,
      value: t.calls,
      tooltipRows: [
        { label: "Calls", value: fmtNum(t.calls) },
        { label: "Sessions", value: fmtNum(t.sessions) },
        { label: "Failures", value: fmtNum(t.failures) },
      ],
    }));
    renderBarList(document.getElementById("chart-tool-calls"), toolCallRows, {
      color: "var(--series-1)",
      formatValue: (r) => fmtCompact(r.value),
      emptyText: "No tool calls recorded yet.",
    });

    const failureRows = data.tool_kinds
      .filter((t) => t.calls >= 20)
      .slice()
      .sort((a, b) => b.failure_rate - a.failure_rate)
      .map((t) => ({
        label: t.tool,
        value: t.failure_rate,
        tooltipRows: [
          { label: "Failure rate", value: fmtPct(t.failure_rate, 1) },
          { label: "Calls", value: fmtNum(t.calls) },
          { label: "Failures", value: fmtNum(t.failures) },
        ],
      }));
    renderBarList(document.getElementById("chart-tool-failures"), failureRows, {
      color: "var(--series-2)",
      max: Math.max(0.05, ...failureRows.map((r) => r.value)),
      formatValue: (r) => fmtPct(r.value, 1),
      emptyText: "No tool kind has 20 or more recorded calls yet.",
    });

    const modelRows = data.models.map((m) => ({
      label: m.id,
      value: m.requests,
      tooltipRows: [
        { label: "Requests", value: fmtNum(m.requests) },
        { label: "Output tokens", value: fmtCompact(m.output) },
        { label: "Cache read tokens", value: fmtCompact(m.cache_read) },
      ],
    }));
    renderBarList(document.getElementById("chart-models"), modelRows, {
      color: "var(--series-3)",
      formatValue: (r) => fmtCompact(r.value),
      emptyText: "No model usage recorded yet.",
    });

    const bucketOrder = ["0", "1-2", "3-5", "6+"];
    const subagentRows = bucketOrder.map((k) => ({
      label: `${k} subagents`,
      value: data.subagents.buckets[k] || 0,
    }));
    renderBarList(document.getElementById("chart-subagents"), subagentRows, {
      color: "var(--series-1)",
      formatValue: (r) => `${fmtNum(r.value)} session${r.value === 1 ? "" : "s"}`,
      emptyText: "No session data yet.",
    });

    renderJobsTable(document.getElementById("jobs-table"), data.jobs);
  }

  main();
})();
