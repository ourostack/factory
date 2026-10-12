#!/usr/bin/env node
// The factory site's rendered-browser gate (v1.2, internal task 13U).
//
//   node site/scripts/verify-v12-browser.mjs --site <absolute-dist> \
//     --baseline-site <absolute-dist> --out <protected-dir> \
//     --playwright-module <absolute-module>
//
// It serves one exact static build (the Pages artifact: index.html, the
// scripts, data.json and the published files) from an owned loopback server
// and drives a real browser over it. It checks layout at every CSS width from
// 320 to 1440 in both themes and at 1x and 2x text, keyboard use, storage,
// clipboard, empty, error and unavailable states, that the JSON twins agree
// with what the page says, and that each check fails on a deliberately
// injected defect (negative controls). Screenshots and the report go to
// --out, which must be outside any Git work tree.
//
// The browser module is supplied by path (an existing, independently
// provisioned Playwright); this repository adds no browser dependency, and no
// workflow runs this gate. A missing module blocks the gate; it never skips.
//
// The constants and assessLayout are exported so a test can pin the contract
// without a browser. Nothing runs on import.

import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { loadavg } from "node:os"
import { existsSync, statSync } from "node:fs"
import { mkdir, readFile, readdir, stat, writeFile, chmod } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, extname, isAbsolute, join, normalize, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const WIDTHS = Object.freeze(Array.from({ length: 1440 - 320 + 1 }, (_, i) => 320 + i))
export const THEMES = Object.freeze(["light", "dark"])
export const TEXT_SCALES = Object.freeze([1, 2])
export const SCREENSHOT_WIDTHS = Object.freeze([320, 390, 768, 1280, 1440])

// Every primary destination plus the legacy addresses. {task}, {session},
// {cause} and {return} are filled from the build's own data.
export const ROUTES = Object.freeze([
  { name: "overview", hash: "#/", view: "overview" },
  { name: "tasks", hash: "#/tasks", view: "tasks" },
  { name: "task", hash: "#/task/{task}", view: "task" },
  { name: "session", hash: "#/task/{task}/session/{session}", view: "session" },
  { name: "compare", hash: "#/compare", view: "compare" },
  { name: "findings", hash: "#/causes", view: "causes" },
  { name: "cause", hash: "#/causes/{cause}", view: "cause" },
  { name: "improvements", hash: "#/improvements", view: "act" },
  { name: "improvements_contextual", hash: "#/improvements?cause={cause}&task={task}&return={return}", view: "act" },
  { name: "why", hash: "#/why", view: "why" },
  { name: "help", hash: "#/help", view: "help" },
  { name: "legacy_act", hash: "#/act", view: "act" },
].map((r) => Object.freeze(r)))

export const SCREENSHOT_ROUTES = Object.freeze(["overview", "task", "compare", "cause", "improvements_contextual"])
export const SCREENSHOT_VARIANTS = Object.freeze([
  Object.freeze({ theme: "light", scale: 1 }), Object.freeze({ theme: "dark", scale: 1 }), Object.freeze({ theme: "light", scale: 2 }),
])

// Each chart and the accessible table or list that carries the same values.
export const CHART_EQUIVALENTS = Object.freeze({
  stackup: "#stackup-table table",
  pareto: "#pareto-table table, #pareto-table ol, #pareto-table ul",
  "ot-bars": "#over-time-table table",
  "fe-dots": "#over-time-table table",
  swimlane: "#swimlane table",
})

// The routes that promise a chart: each must draw it, with its equivalent.
export const EXPECTED_CHARTS = Object.freeze({ compare: Object.freeze(["stackup"]), findings: Object.freeze(["pareto"]), session: Object.freeze(["swimlane"]) })

export const NEGATIVE_CONTROLS = Object.freeze([
  "injected_document_overflow", "overflow_hidden_clipping", "vertical_clipping", "overlapping_labels", "overlapping_controls",
  "unmarked_scroll_frame", "missing_chart_equivalent", "broken_focus_return", "false_copied_claim",
  "chart_text_out_of_bounds", "unnamed_link",
  "conclusion_below_first_screen", "cards_at_wide_screen", "page_height_over_budget", "stacked_table_without_roles",
  "caveat_in_the_conclusion_place", "clipped_text_in_narrow_plot", "view_unit_mismatch_on_compare", "task_figure_differs_on_compare", "bound_before_under_on_compare", "task_lead_differs_from_compare", "bound_before_under_on_task_page", "share_edge_on_task_page", "share_label_differs_from_words", "slow_data_file", "slowdown_3x_over_budget", "slow_after_action", "loading_marker_never_clears",
])

// Fixed-name checks a run must record; a run that misses one fails.
export const REQUIRED_CHECKS = Object.freeze([
  "keyboard_enter_selects_evidence_escape_closes_and_returns_focus", "keyboard_space_selects_evidence_escape_closes_and_returns_focus",
  "keyboard_select_by_type_ahead_and_clear_with_space_keep_focus", "tab_order_follows_the_page_on_primary_routes",
  "filter_change_updates_aggregates_and_coverage", "clear_selection_without_the_original_link",
  "guide_never_blocks_the_page", "touch_targets_are_at_least_24px", "status_and_legends_carry_non_color_markers",
  "storage_denied_keeps_the_site_usable", "storage_methods_throwing_keep_the_site_usable",
  "data_fetch_failure_says_so_and_navigation_works", "render_error_is_isolated", "production_and_request_modes_follow_published_clocks",
  "json_twins_match_data_and_rendered_meaning", "chart_equivalents_compare_over_time_open",
  "clipboard_failure_is_stated_with_a_selected_complete_prompt", "clipboard_success_copies_exactly_the_shown_prompt",
  "private_decision_fixture_agrees_across_queue_overview_and_page",
  "wide_screen_tables_stay_tables_at_normal_text", "page_height_within_budget_of_baseline", "stacked_tables_keep_table_roles",
  "conclusion_starts_within_the_first_screen", "page_height_within_budget_at_doubled_text",
  "narrow_one_task_plot_keeps_text_in_bounds", "compare_axis_sum_and_lead_share_one_unit", "compare_task_figures_match_everywhere", "compare_no_bound_before_under", "task_page_lead_time_matches_compare", "task_pages_no_bound_before_under", "pages_settle_within_budget",
])

// Spec 4.5: a wide screen uses its room for information. Against the
// baseline build (the one this release replaces), Compare and Overview at
// normal text may grow at most this much: wrapping that replaces a sideways
// scroll or a cut-off name costs some height on a phone, and almost none on
// a desktop.
export const HEIGHT_BUDGET = Object.freeze({ 1280: 1.15, 390: 1.5 })
export const HEIGHT_ROUTES = Object.freeze(["compare", "overview"])

// Doubled text has the same budget, against the baseline build's page at
// doubled text, so shortening the normal-text page can never trip it. The
// ratio to the same page at normal text is reported, not judged.

// Heights over their budget, as reader sentences. `heights` maps
// "<route>_<width>" to { site, reference }; `budget` maps width to a multiple.
export function assessHeights(heights, budget) {
  const over = []
  for (const [key, h] of Object.entries(heights)) {
    const i = key.lastIndexOf("_"), name = key.slice(0, i), width = Number(key.slice(i + 1))
    if (h.site > h.reference * budget[width]) over.push(`${name} at ${width} px: ${h.site} px vs reference ${h.reference} px (budget ${budget[width]}x)`)
  }
  return over
}

// Spec 4.3: a page leads with its conclusion. The conclusion sentence (never
// a caveat about partial figures) must start within the first screen, judged
// on its own, not against a baseline. A phone's first screen is shorter
// (640 px up to 480 px wide; an iPhone SE shows 667 px, an iPhone 14 844 px)
// than a desktop's (900 px). With doubled text the page header alone fills
// most of a phone's screen, so the conclusion must start within two screens.
export const FIRST_SCREEN = Object.freeze({ phone: 640, phoneMaxWidth: 480, wide: 900, text2xScreens: 2 })
export function firstScreenHeight(width) { return width <= FIRST_SCREEN.phoneMaxWidth ? FIRST_SCREEN.phone : FIRST_SCREEN.wide }
// Each covered page's view. The page marks its conclusion sentence with
// data-role="conclusion" and any caveat with data-role="caveat"; the first
// marked sentence in the view must be the conclusion. The marker decides,
// never the wording.
export const CONCLUSIONS = Object.freeze({ task: "#view-task", compare: "#view-compare", overview: "#view-overview" })
export function assessFirstScreen(m, width, scale = 1) {
  if (!m || !m.found) return "no conclusion is shown"
  if (m.role !== "conclusion") return `the conclusion's place holds a caveat, not a conclusion: "${String(m.text).slice(0, 80)}"`
  const limit = firstScreenHeight(width) * (scale === 2 ? FIRST_SCREEN.text2xScreens : 1)
  if (m.top >= limit) return `the conclusion starts at ${m.top} px, below the first screen (${limit} px at ${width} px wide${scale === 2 ? ", two screens with doubled text" : ""})`
  return null
}
// Runs in the page: the first marked sentence in the view, where it starts,
// what it is marked as and what it says.
export function measureConclusion(scope) {
  const c = [...document.querySelectorAll(`${scope} [data-role="conclusion"], ${scope} [data-role="caveat"]`)].find((e) => e.getBoundingClientRect().height > 0 && (e.textContent || "").trim() && !/^Loading/.test(e.textContent.trim()))
  return c ? { found: true, role: c.dataset.role, top: Math.round(c.getBoundingClientRect().top + window.scrollY), text: c.textContent.trim() } : { found: false, role: null, top: 0, text: "" }
}

// A duration's form, from a bar label ("≥2.2d", "<1s", "400ms") or a
// sentence ("at least 2.2 days so far", "under a second"): its bound, its
// number as written and its unit; null when the text holds none. The first
// duration in the text wins.
const UNIT_NAME = { d: "days", day: "days", h: "hours", hour: "hours", m: "minutes", minute: "minutes", s: "seconds", second: "seconds", ms: "milliseconds", millisecond: "milliseconds" }
const BOUND_OF = { "≥": "lower", "at least": "lower", "≤": "upper", "at most": "upper", "~": "about", about: "about", "<": "under", under: "under" }
export function durationForm(text) {
  const t = String(text || "")
  const hits = []
  const w = t.match(/(at least |at most |about |under )?(\d[\d,]*(?:\.\d+)?) (day|hour|minute|second|millisecond)s?\b/i)
  if (w) hits.push({ at: w.index, bound: w[1] ? BOUND_OF[w[1].trim().toLowerCase()] : null, value: w[2].replace(/,/g, ""), unit: UNIT_NAME[w[3].toLowerCase()] })
  const sh = t.match(/(?:^|[^\w.])([≥≤~<])?(\d[\d,]*(?:\.\d+)?)(ms|d|h|m|s)(?![\w])/)
  if (sh) hits.push({ at: sh.index, bound: sh[1] ? BOUND_OF[sh[1]] : null, value: sh[2].replace(/,/g, ""), unit: UNIT_NAME[sh[3]] })
  const sec = t.match(/\bunder a second\b/i)
  if (sec) hits.push({ at: sec.index, bound: "under", value: "1", unit: "seconds" })
  if (!hits.length) return null
  const { bound, value, unit } = hits.sort((a, b) => a.at - b.at)[0]
  return { bound, value, unit }
}
// Each task's figure has one form: its bar label, table cell, tooltip and
// accessible label agree in bound, number and unit. Rows are
// { job, label, cell, tip, aria }; a missing field is not compared.
export function assessTaskForms(rows) {
  const out = []
  for (const r of rows || []) {
    const base = durationForm(r.label)
    if (!base) continue
    for (const [key, name] of [["cell", "table cell"], ["tip", "tooltip"], ["aria", "accessible label"]]) {
      if (r[key] === null || r[key] === undefined) continue
      const f = durationForm(r[key])
      if (!f || f.bound !== base.bound || f.value !== base.value || f.unit !== base.unit) out.push(`${r.job}: the ${name} reads "${String(r[key]).slice(0, 60)}", the bar label "${r.label}"`)
    }
  }
  return out
}
// The axis, the summed task exposure and the lead sentence compare
// magnitudes, so they share one unit (the view's, from its largest value).
export function assessViewUnits(r) {
  const axisWord = r && r.axis ? String(r.axis).split(/\s+/)[0].toLowerCase() : null
  const parts = [
    ["lead sentence", r && r.lead ? (durationForm(r.lead) || {}).unit : null],
    ["axis", ["days", "hours", "minutes"].includes(axisWord) ? axisWord : null],
    ["sum", r && r.sum ? (durationForm(r.sum) || {}).unit : null],
  ].filter(([, u]) => u)
  if (parts.length < 2) return null
  const [baseName, baseUnit] = parts[0]
  const off = parts.slice(1).filter(([, u]) => u !== baseUnit).map(([n, u]) => `the ${n} in ${u}, the ${baseName} in ${baseUnit}`)
  return off.length ? off.join("; ") : null
}
// A task's lead time reads the same on its own page (the one-bar caption and
// its accessible label) as in Compare's all-mode Lead time cell: the same
// number in the same unit, and the same bound where Compare states one
// (Compare's "so far" stands in for "at least"). Rows are
// { job, compare, caption, aria }.
export function assessLeadAgreement(rows) {
  const out = []
  for (const r of rows || []) {
    const c = durationForm(r.compare)
    if (!c) continue
    for (const [key, name] of [["caption", "caption"], ["aria", "accessible label"]]) {
      const f = durationForm(r[key])
      if (!f) { out.push(`${r.job}: the task page's ${name} has no lead time, Compare reads "${r.compare}"`); continue }
      if (f.value !== c.value || f.unit !== c.unit || (c.bound && f.bound !== c.bound)) out.push(`${r.job}: the task page's ${name} reads "${String(r[key]).slice(0, 70)}", Compare "${r.compare}"`)
    }
  }
  return out
}
// Runs in the page: the task page's lead time, from its one-bar chart.
export function taskLeadFigures() {
  const t = document.querySelector("#view-task .tw-title"), b = document.querySelector("#view-task .tw-bar")
  const cap = t ? t.textContent : null
  return { caption: cap ? (cap.match(/(?:one bar: |scale 0 to )(.*)$/) || [null, cap])[1] : null, aria: b ? (b.getAttribute("aria-label") || "").replace(/^Lead time /, "") : null }
}
// Runs in the page: every text a reader can meet on a task page.
export function taskPageTexts() {
  const view = document.getElementById("view-task")
  return [view.innerText, ...[...view.querySelectorAll("[aria-label], [title]")].flatMap((e) => [e.getAttribute("aria-label"), e.getAttribute("title")]).filter(Boolean)]
}
// Runs in the page: each part of the task page's time bar as its duration and
// its share of the lead time, by group and by part.
export function taskShareFigures() {
  // "under 1%" is kept: its part still has time beside a 100%.
  const split = (t) => { const m = /^\s*(.*?) · (under )?(\d+(?:\.\d+)?)% of the lead time/.exec(t || ""); return m ? { dur: m[1].trim(), pct: `${m[2] ? "<" : ""}${m[3]}` } : null }
  const groups = [...document.querySelectorAll("#view-task .tw-group-head")].map((h) => { const l = h.querySelector("strong"); return split(h.textContent.slice(l ? l.textContent.length : 0)) }).filter(Boolean)
  const parts = [...document.querySelectorAll("#view-task .tw-row .tw-ms")].map((e) => split(e.textContent)).filter(Boolean)
  return { groups, parts }
}
// Only exactly 0 and 1 read as 0% and 100%: a part reading 0% has no time,
// and a part reading 100% is the only one with time.
export function assessShareEdges(figs) {
  const out = []
  const zero = (d) => /^(?:none|(?:at least |at most |about )?0 seconds)$/.test(d)
  for (const [name, list] of [["group", figs.groups || []], ["part", figs.parts || []]]) {
    list.forEach((f, i) => {
      if (Number(f.pct) === 0 && !zero(f.dur)) out.push(`a ${name} of ${f.dur} reads 0%`)
      if (Number(f.pct) === 100) { const other = list.find((g, j) => j !== i && !zero(g.dur)); if (other) out.push(`a ${name} of ${f.dur} reads 100% beside one of ${other.dur}`) }
    })
  }
  return out
}
// Runs in the page (Compare, share mode): each task's bar label share and its
// flow-efficiency words on the dot chart, by task.
export function shareModePairs() {
  const job = (h) => ((h || "").match(/#\/task\/([^?/&]+)/) || [])[1] || null
  const bars = {}, dots = {}
  const tip = document.getElementById("tooltip"), tips = {}
  for (const a of document.querySelectorAll("#view-compare a.sb-col")) {
    const m = /: ([^:]*?) working of a lead time/.exec(a.getAttribute("aria-label") || "")
    if (!m) continue
    bars[job(a.getAttribute("href"))] = m[1]
    // The tooltip's working row is the same quantity.
    a.dispatchEvent(new FocusEvent("focus"))
    const row = tip ? [...tip.querySelectorAll(".tt-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()).find((t) => /^Working\b/.test(t)) : null
    const t = row ? /^Working:? (.*?) of the lead time/.exec(row) : null
    if (t) tips[job(a.getAttribute("href"))] = t[1]
    a.dispatchEvent(new FocusEvent("blur"))
  }
  for (const a of document.querySelectorAll("#view-compare a.chart-link")) { const m = /flow efficiency (.*?)\. Follow this task/.exec(a.getAttribute("aria-label") || ""); if (m) dots[job(a.getAttribute("href"))] = m[1] }
  return Object.keys(bars).filter((j) => j in dots).map((j) => ({ job: j, bar: bars[j], words: dots[j], tip: j in tips ? tips[j] : null }))
}
// One quantity reads one way: a bar's "≤49%" is the words' "at most 49%".
export function assessSharePairs(pairs) {
  const out = []
  const sign = { "≥": "at least ", "≤": "at most ", "~": "about " }
  for (const r of pairs || []) {
    // "~" and "(direction not known)" both say the direction is open, so the
    // figure and any at least or at most are what must agree.
    const bar = (r.bar === "<1%" ? "under 1%" : r.bar.replace(/^([≥≤~])/, (m) => sign[m])).replace(/^about /, "")
    // At the edge the words say the one way off; the label's sign says the same.
    const words = r.words.replace(/^(.*) \(could be lower\)$/, "at most $1").replace(/^(.*) \(could be higher\)$/, "at least $1").replace(/ \((?:partial, )?direction not known\)$| \(partial\)$| so far$/, "").replace(/^about /, "")
    if (bar !== words) out.push(`${String(r.job).slice(0, 8)}: the bar reads "${r.bar}", the words "${r.words}"`)
    // An open direction is said on both, or on neither.
    const open = (t) => /^about |direction not known\)$/.test(t)
    if (/^~/.test(r.bar) !== open(r.words)) out.push(`${String(r.job).slice(0, 8)}: the bar reads "${r.bar}", the words "${r.words}", one says the direction is open and the other does not`)
    if (typeof r.tip === "string" && r.tip !== r.bar) out.push(`${String(r.job).slice(0, 8)}: the bar reads "${r.bar}", its tooltip "${r.tip}"`)
  }
  return out
}
// A bound sign or word followed by "<" or "under" says two things at once.
export function boundsBeforeUnder(texts) {
  const out = []
  for (const t of texts || []) for (const x of String(t || "").matchAll(/(≥|≤|~|\bat least|\bat most|\babout)\s*(<|under\b)/gi)) out.push(x[0])
  return out
}
// Runs in the page: Compare's view-unit figures, each drawn task's figures
// (bar label, table cell in this mode's column, tooltip, accessible label)
// and every text a reader can meet (page text, accessible labels, tooltips).
export function compareFigures() {
  const view = document.getElementById("view-compare")
  const tip = document.getElementById("tooltip")
  const after = (t) => { const i = t.lastIndexOf(": "); return i >= 0 ? t.slice(i + 2) : t }
  const jobOf = (href) => ((href || "").match(/#\/task\/([^?/&]+)/) || [])[1] || null
  const mode = new URLSearchParams(location.hash.split("?")[1] || "").get("mode") || "all"
  const column = { all: /^Lead time$/, working: /^Working$/, production: /^Production time$/, request: /^Request to delivery$/ }[mode]
  const cells = new Map()
  let columnShown = false
  if (column) for (const table of view.querySelectorAll("#stackup-table table, #stackup .clock-modes-table")) {
    const head = table.tHead ? table.tHead.rows[0] : table.rows[0]
    const idx = head ? [...head.cells].findIndex((c) => column.test(c.textContent.trim())) : -1
    if (idx < 0) continue
    columnShown = true
    for (const tr of table.tBodies[0] ? table.tBodies[0].rows : []) {
      const a = tr.querySelector("a[href*='#/task/']"), td = tr.cells[idx], job = a && jobOf(a.getAttribute("href"))
      if (job && td && !cells.has(job)) cells.set(job, td.textContent.trim())
    }
  }
  const rows = [], tips = []
  for (const a of view.querySelectorAll("#stackup a.sb-col")) {
    const v = a.querySelector(".sb-value")
    const label = v ? v.textContent.trim().replace(/\*$/, "") : ""
    a.dispatchEvent(new FocusEvent("focus"))
    const strong = tip ? tip.querySelector(".tt-row strong") : null
    if (tip) tips.push(tip.innerText)
    a.dispatchEvent(new FocusEvent("blur"))
    if (!label) continue
    const job = jobOf(a.getAttribute("href"))
    const aria = (a.getAttribute("aria-label") || "").replace(/\. Follow this task\.$/, "")
    rows.push({ job, label, aria: after(aria), tip: strong ? strong.textContent.trim() : null, cell: cells.has(job) ? cells.get(job) : null })
  }
  const one = (sel) => { const e = view.querySelector(sel); return e ? e.textContent.trim() : null }
  const conclusion = one("#comparison-conclusion")
  return {
    mode, rows, cells: cells.size, cellsByJob: Object.fromEntries(cells), column: columnShown,
    axis: one("#stackup .axis-title"), sum: one("#stackup .clock-exposure"), lead: conclusion ? after(conclusion) : null,
    texts: [view.innerText, ...[...view.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")), ...tips],
  }
}
// Runs in the page: tables shown as cards (a .stacked holder that is visible).
export function findCardTables() {
  return [...document.querySelectorAll(".stacked")].filter((h) => h.getBoundingClientRect().height > 0)
    .map((h) => ({ el: (h.closest("[id]") || h).id || "table", planted: !!h.closest("[data-gate-planted]") }))
}
// Runs in the page: each table shown as cards keeps its table roles.
export function checkTableRoles() {
  const holders = [...document.querySelectorAll(".stacked")].filter((h) => h.getBoundingClientRect().height > 0)
  const bad = []
  for (const h of holders) {
    const planted = !!h.closest("[data-gate-planted]")
    const add = (what) => bad.push({ what, planted })
    const t = h.querySelector(":scope > table")
    if (!t || t.getAttribute("role") !== "table") { add("table without role=table"); continue }
    for (const tr of t.rows) if (tr.getAttribute("role") !== "row") add("row without role=row")
    for (const c of t.querySelectorAll("thead th")) if (c.getAttribute("role") !== "columnheader") add(`heading "${c.textContent.trim().slice(0, 20)}" without role=columnheader`)
    for (const c of t.querySelectorAll("tbody td, tbody th")) if (!["cell", "rowheader"].includes(c.getAttribute("role"))) add("body cell without role=cell")
    for (const c of t.querySelectorAll("tbody td")) if (!c.dataset.label && c.textContent.trim()) add("body cell without its column label")
  }
  return { holders: holders.length, bad }
}

const USAGE = "usage: node site/scripts/verify-v12-browser.mjs --site <absolute-dist> --baseline-site <absolute-dist> --out <protected-dir> --playwright-module <absolute-module>"

// --------------------------------------------------------------- layout

// Problems in one layout measurement. The document may never be wider than
// the viewport (one pixel of rounding is tolerated). Spec 4.5: only an
// explicitly marked precision-timeline frame (data-precision-frame) with a
// visible label may pan, and it must itself stay inside the viewport; any
// other element that scrolls sideways (a captioned table, a labeled chart)
// must reflow instead. Nothing excuses document overflow. Each problem says
// whether it is on an element a negative control planted.
export function assessLayout(m) {
  const problems = []
  const add = (code, detail, x) => problems.push({ code, detail, planted: !!(x && x.planted) })
  const limit = m.doc.clientWidth + 1
  if (m.doc.scrollWidth > limit || m.doc.bodyScrollWidth > limit) add("document_overflow", `${Math.max(m.doc.scrollWidth, m.doc.bodyScrollWidth)} > ${m.doc.clientWidth}`, m.doc)
  for (const f of m.frames || []) {
    if (!f.precision) add("sideways_scroll", f.el, f)
    else if (!f.labelled) add("frame_unlabelled", f.el, f)
    if (!f.bounded) add("frame_unbounded", f.el, f)
  }
  for (const c of m.clipped || []) add("clipped", `${c.el}: ${c.text || ""}`.trim(), c)
  for (const c of m.clippedY || []) add("clipped_vertical", `${c.el}: ${c.text || ""}`.trim(), c)
  for (const c of m.offscreen || []) add("offscreen_control", c.el, c)
  for (const o of m.overlaps || []) add("overlapping_labels", `${o.chart}: "${o.a}" / "${o.b}"`, o)
  for (const o of m.controlOverlaps || []) add("overlapping_controls", `${o.a} / ${o.b}`, o)
  for (const t of m.chartTextOut || []) add("chart_text_out_of_bounds", `${t.chart}: "${t.text}"`, t)
  for (const l of m.unnamedLinks || []) add("unnamed_link", l.el, l)
  return problems
}

// Runs in the page. The expensive lists (every element's overflow style) are
// rebuilt whenever the DOM changed since the last measurement; controls and
// charts are re-read at every call, so a redraw is never missed.
export function measureLayout(opts) {
  const refresh = !!(opts && opts.refresh)
  const vw = document.documentElement.clientWidth
  const viewEl = document.getElementById(`view-${document.body.dataset.view}`)
  const own = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "")
  const name = (e) => { const anchor = e.parentElement && e.parentElement.closest("[id]"); return own(e) + (anchor && !e.id ? ` in #${anchor.id}` : "") }
  const planted = (e) => !!(e && e.closest && e.closest("[data-gate-planted]"))
  const hiddenStyle = (cs) => cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0" || (cs.clipPath && cs.clipPath !== "none") || (cs.clip && cs.clip !== "auto")
  const shown = (e) => {
    if (!e.isConnected) return false
    const r = e.getBoundingClientRect()
    if (r.width <= 2 || r.height <= 2) return false
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (hiddenStyle(cs) || n.hidden) return false
      // A closed disclosure shows only its own summary.
      if (n.tagName === "DETAILS" && !n.open && n !== e) { const own = n.querySelector(":scope > summary"); if (!own || !own.contains(e)) return false }
    }
    return true
  }
  if (!window.__gateObserver) {
    window.__gateDirty = true
    window.__gateObserver = new MutationObserver(() => { window.__gateDirty = true })
    window.__gateObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] })
  }
  let cache = window.__gateLayout
  if (refresh || window.__gateDirty || !cache) {
    window.__gateDirty = false
    const scrollers = [], hiders = []
    for (const e of document.body.querySelectorAll("*")) {
      const cs = getComputedStyle(e)
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") scrollers.push(e)
      else if ((cs.overflowX === "hidden" || cs.overflowX === "clip" || cs.textOverflow === "ellipsis") && !hiddenStyle(cs)) hiders.push(e)
      else if ((cs.overflowY === "hidden" || cs.overflowY === "clip" || cs.webkitLineClamp !== "none" && cs.webkitLineClamp) && !hiddenStyle(cs)) hiders.push(e)
    }
    cache = window.__gateLayout = { scrollers, hiders }
  }
  const controls = [...document.body.querySelectorAll("button, a, select, input, textarea, summary, label, th, td, li, dt, dd, h1, h2, h3, p")]
  const charts = viewEl ? [...viewEl.querySelectorAll("svg")] : []
  const frames = [], clipped = [], clippedY = [], offscreen = [], overlaps = [], controlOverlaps = [], chartTextOut = [], unnamedLinks = []
  const frameOf = (e) => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) if (cache.scrollers.includes(n)) return n; return null }
  for (const e of cache.scrollers) {
    if (!shown(e) || e.scrollWidth <= e.clientWidth + 1) continue
    const r = e.getBoundingClientRect()
    // A precision frame names itself with a visible label (aria-labelledby).
    const labelIds = (e.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
    const labelled = labelIds.length > 0 && labelIds.every((id) => { const l = document.getElementById(id); return l && shown(l) && l.textContent.trim() })
    frames.push({ el: name(e), precision: e.hasAttribute("data-precision-frame"), labelled, bounded: r.left >= -1 && r.right <= vw + 1, planted: planted(e) })
  }
  // Content cut by its own overflow: hidden (sideways, an ellipsis, or downward).
  for (const e of cache.hiders) {
    if (!shown(e) || !(e.textContent || "").trim()) continue
    const cs = getComputedStyle(e)
    const x = cs.overflowX === "hidden" || cs.overflowX === "clip" || cs.textOverflow === "ellipsis"
    if (x && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 2) clipped.push({ el: name(e), text: e.textContent.trim().slice(0, 40), planted: planted(e) })
    const y = cs.overflowY === "hidden" || cs.overflowY === "clip" || (cs.webkitLineClamp && cs.webkitLineClamp !== "none")
    if (y && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 2) clippedY.push({ el: name(e), text: e.textContent.trim().slice(0, 40), planted: planted(e) })
  }
  // A control or label cut by an ancestor, or pushed out of the viewport.
  const boxes = []
  for (const e of controls) {
    if (!shown(e)) continue
    const r = e.getBoundingClientRect()
    const frame = frameOf(e)
    let cut = false
    for (let n = e.parentElement; n && n !== document.body && n !== frame; n = n.parentElement) {
      if (!cache.hiders.includes(n) || n.scrollWidth <= n.clientWidth + 1) continue
      const p = n.getBoundingClientRect()
      if (r.right > p.right + 1 || r.left < p.left - 1) { clipped.push({ el: name(e), text: (e.textContent || "").trim().slice(0, 40), planted: planted(e) }); cut = true; break }
    }
    if (cut) continue
    // Only the skip link may wait off screen, parked until it has focus.
    const parked = e.matches(".skip-link") && e !== document.activeElement && (r.right <= 0 || r.left >= vw || r.bottom <= 0)
    if (!frame && !parked && (r.right > vw + 1 || r.left < -1)) offscreen.push({ el: name(e), planted: planted(e) })
    // An inline control that wraps is judged by its line boxes, not their union.
    if (!frame && !parked && /^(BUTTON|A|SELECT|INPUT|TEXTAREA|SUMMARY|LABEL)$/.test(e.tagName) && e instanceof HTMLElement) boxes.push({ e, r, parts: [...e.getClientRects()].filter((q) => q.width > 0 && q.height > 0) })
  }
  // Interactive controls drawn on top of one another (not one inside the other).
  boxes.sort((p, q) => p.r.top - q.r.top)
  for (let i = 0; i < boxes.length && controlOverlaps.length < 20; i++) {
    const a = boxes[i]
    for (let j = i + 1; j < boxes.length && boxes[j].r.top < a.r.bottom; j++) {
      const b = boxes[j]
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue
      if (a.e.tagName === "LABEL" && (a.e.control === b.e || a.e.htmlFor === b.e.id)) continue
      if (b.e.tagName === "LABEL" && (b.e.control === a.e || b.e.htmlFor === a.e.id)) continue
      const hit = a.parts.some((p) => b.parts.some((q) => {
        const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top)
        return w > 2 && h > 2 && w * h > 0.2 * Math.min(p.width * p.height, q.width * q.height)
      }))
      if (hit) controlOverlaps.push({ a: name(a.e), b: name(b.e), planted: planted(a.e) || planted(b.e) })
    }
  }
  // Labels drawn on top of each other inside one chart, or past its edge.
  // Every visible chart is measured, however narrow (a one-task plot is
  // 72 px wide, its axis 46 px): these checks read only <text>, so an icon
  // or swatch without text adds nothing and no size floor is needed.
  const chartsMeasured = []
  for (const svg of charts) {
    if (!shown(svg)) continue
    const sr = svg.getBoundingClientRect()
    if (!(sr.width > 0 && sr.height > 0)) continue
    const texts = [...svg.querySelectorAll("text")].filter((t) => (t.textContent || "").trim() && getComputedStyle(t).visibility !== "hidden" && getComputedStyle(t).display !== "none" && Number(getComputedStyle(t).opacity) > 0)
      .map((t) => ({ t: t.textContent.trim().slice(0, 30), r: t.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.height > 0)
    if (texts.length) chartsMeasured.push({ chart: (svg.closest("[id]") || svg).id || "chart", cls: svg.getAttribute("class") || "", width: Math.round(sr.width), height: Math.round(sr.height), texts: texts.length })
    // A label drawn past the chart's own box is cut off: an svg clips at its edge.
    for (const x of texts) {
      if (chartTextOut.length >= 20) break
      if (x.r.left < sr.left - 1 || x.r.right > sr.right + 1 || x.r.top < sr.top - 1 || x.r.bottom > sr.bottom + 1) chartTextOut.push({ chart: (svg.closest("[id]") || svg).id || "chart", text: x.t, planted: planted(svg) })
    }
    for (let i = 0; i < texts.length && overlaps.length < 20; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].r, b = texts[j].r
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (w > 2 && h > 2 && w * h > 0.2 * Math.min(a.width * a.height, b.width * b.height)) {
          overlaps.push({ chart: (svg.closest("[id]") || svg).id || "chart", a: texts[i].t, b: texts[j].t, planted: planted(svg) })
        }
      }
    }
  }
  // Every link the reader can reach has a name a screen reader can announce.
  for (const a of document.body.querySelectorAll("a[href]")) {
    if (unnamedLinks.length >= 20) break
    if (a.checkVisibility ? !a.checkVisibility() : !shown(a)) continue
    const ids = (a.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
    const named = (a.getAttribute("aria-label") || "").trim() || ids.map((id) => (document.getElementById(id) || {}).textContent || "").join("").trim() || (a.textContent || "").trim() || [...a.querySelectorAll("img[alt], svg title")].map((n) => n.getAttribute("alt") || n.textContent || "").join("").trim() || (a.getAttribute("title") || "").trim()
    if (!named) unnamedLinks.push({ el: name(a), planted: planted(a) })
  }
  const sw = document.documentElement.scrollWidth
  return { width: vw, doc: { scrollWidth: sw, clientWidth: vw, bodyScrollWidth: document.body.scrollWidth, planted: sw > vw + 1 && [...document.querySelectorAll("[data-gate-planted]")].some((p) => p.getBoundingClientRect().right > vw + 1) },
    frames, clipped: clipped.slice(0, 20), clippedY: clippedY.slice(0, 20), offscreen: offscreen.slice(0, 20), overlaps, controlOverlaps, chartTextOut, unnamedLinks, chartsMeasured: chartsMeasured.slice(0, 40) }
}

// Runs in the page: each visible chart has a known equivalent with rows.
export function checkChartEquivalents(map) {
  const view = document.getElementById(`view-${document.body.dataset.view}`)
  const problems = [], seen = []
  if (!view) return { problems: ["no_view"], seen }
  for (const svg of view.querySelectorAll("svg")) {
    const r = svg.getBoundingClientRect()
    if (r.width < 100 || r.height < 50) continue
    let key = null
    for (let n = svg; n && n !== view; n = n.parentElement) if (n.id && Object.hasOwn(map, n.id)) { key = n.id; break }
    if (!key) { problems.push(`chart_without_known_equivalent: ${(svg.closest("[id]") || {}).id || "unknown"}`); continue }
    seen.push(key)
    const eq = document.querySelector(map[key])
    // A header row is not an equivalent: the table needs body rows (or the list items).
    const rows = eq ? (eq.tagName === "TABLE" ? eq.querySelectorAll("tbody tr").length : eq.querySelectorAll("li").length) : 0
    if (!eq || rows === 0) problems.push(`missing_chart_equivalent: ${key}`)
    if (!svg.getAttribute("aria-label") && !svg.getAttribute("aria-labelledby")) problems.push(`unlabelled_chart: ${key}`)
  }
  return { problems, seen }
}

// Runs in the page before any script: an increased-text mode that doubles
// every pixel font size in the site's style sheets and the root size, so
// px-specified text grows as it does with a reader's larger text setting.
export function textScaleInit(scale) {
  if (scale === 1) return
  const apply = () => {
    if (window.__gateTextScale === scale) return
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules) visit(rule.cssRules)
        if (rule.style && /px$/.test(rule.style.fontSize)) rule.style.fontSize = `${parseFloat(rule.style.fontSize) * scale}px`
      }
    }
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules) } catch { /* cross-origin sheet */ } }
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    document.documentElement.style.fontSize = `${root * scale}px`
    window.__gateTextScale = scale
  }
  if (document.readyState === "complete") apply()
  else window.addEventListener("load", apply)
}

// ---------------------------------------------------------------- server

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" }

function serve(site) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname)
      const file = normalize(join(site, path === "/" ? "index.html" : path))
      if (!file.startsWith(site + sep) && file !== site) throw new Error("outside")
      const body = await readFile(file)
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" })
      res.end(body)
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("not found")
    }
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)))
}

async function digestSite(site) {
  const out = {}
  for (const f of ["index.html", "app.js", "format.js", "steps.js", "walk.js", "briefing.js", "preferences.js", "styles.css", "data.json", "rollups/overview.json", "rollups/improvements.json"]) {
    try { out[f] = createHash("sha256").update(await readFile(join(site, f))).digest("hex") } catch { out[f] = null }
  }
  return out
}

// ------------------------------------------------------------------ args

function insideGitWorkTree(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true
    if (dirname(d) === d) return false
  }
}

export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1]
    if (!["--site", "--baseline-site", "--out", "--playwright-module"].includes(k) || typeof v !== "string") return { error: USAGE }
    args[k.slice(2)] = v
  }
  for (const k of ["site", "baseline-site", "out", "playwright-module"]) if (!args[k] || !isAbsolute(args[k])) return { error: `${USAGE}\n--${k} must be an absolute path` }
  if (insideGitWorkTree(args.out)) return { error: `--out must be outside any Git work tree (screenshots and reports are not committed): ${args.out}` }
  for (const k of ["site", "baseline-site"]) if (!existsSync(join(args[k], "index.html")) || !existsSync(join(args[k], "data.json"))) return { error: `--${k} must be a built site with index.html and data.json: ${args[k]}` }
  return { site: normalize(args.site), baseline: normalize(args["baseline-site"]), out: normalize(args.out), playwright: args["playwright-module"] }
}

// ------------------------------------------------------------------- run

async function pickTargets(site) {
  const data = JSON.parse(await readFile(join(site, "data.json"), "utf8"))
  let causes = null
  try { causes = JSON.parse(await readFile(join(site, "rollups/causes.json"), "utf8")) } catch { /* absent */ }
  const keys = causes && Array.isArray(causes.causes) ? causes.causes.map((c) => c.cause).filter((k) => typeof k === "string") : []
  const cause = keys.includes("waiting:other_task") ? "waiting:other_task" : keys[0] || "waiting:next_prompt"
  // A session with a real swimlane: the median-sized published session file.
  const sessions = []
  try {
    for (const job of await readdir(join(site, "jobs"))) {
      const dir = join(site, "jobs", job)
      if (!statSync(dir).isDirectory()) continue
      for (const f of await readdir(dir)) if (f.endsWith(".json")) sessions.push({ job, session: f.slice(0, -5), size: (await stat(join(dir, f))).size })
    }
  } catch { /* no session files */ }
  sessions.sort((a, b) => a.size - b.size)
  const pick = sessions[Math.floor(sessions.length / 2)] || null
  const task = pick ? pick.job : data.jobs[0] && data.jobs[0].id
  return { data, cause, task, session: pick ? pick.session : null }
}

export function routeHash(route, t) {
  return route.hash.replace("{task}", t.task).replace("{session}", t.session || "").replace("{cause}", encodeURIComponent(t.cause))
    .replace("{return}", encodeURIComponent(`#/causes/${t.cause}`))
}

// The requests a page has in flight (the site fetches its rollups only when
// a view first needs them), so settle() can wait for the data itself rather
// than for a guessed time.
const IN_FLIGHT = new WeakMap()
export function trackRequests(page) {
  const open = new Set()
  IN_FLIGHT.set(page, open)
  page.on("request", (r) => open.add(r))
  page.on("requestfinished", (r) => open.delete(r))
  page.on("requestfailed", (r) => open.delete(r))
  return open
}
// How long a route may take to settle against the local server. Every
// settle() is timed and recorded with the kind of page it ran in (width,
// height, text scale, theme) and whether it followed a navigation or an
// action on the page. A navigation over budget is timed again, twice, in the
// same kind of page, back to back with main's same route (the baseline
// build), and the faster time of each is kept. pages_settle_within_budget
// then passes it only when the re-timed route is within budget (a spike), or
// main is itself over budget in this run (the machine is busy) and the route
// is at most SETTLE_RATIO times main's. On a quiet machine the budget is a
// hard limit. A settle that followed an action cannot be replayed from its
// URL, so it is never excused: over budget, it fails.
export const SETTLE_BUDGET_MS = 5000
export const SETTLE_RATIO = 2
const SETTLE_TIMES = []
// One re-timing per route and kind of page: { ms, main_ms }, the faster of
// two runs each.
export const settleKey = (t) => [t.where, t.width, t.height, t.scale, t.theme].join("|")
const RETIMES = new Map()
// A page whose settle times go to its own list instead (a control's page).
const SINKS = new WeakMap()
// Each page's text scale and theme, and whether the check altered it (an
// init script, or a route override that plants or holds back data).
const PAGE_KIND = new WeakMap()
// The URL each page's last goto asked for and where it landed, until a
// settle reads it. A settle is a navigation only when the page is still there.
const NAVIGATED = new WeakMap()
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`
const kindWords = (t) => (t.width ? ` at ${t.width} px${t.scale && t.scale !== 1 ? `, text ${t.scale}x` : ""}${t.theme && t.theme !== "light" ? `, ${t.theme}` : ""}` : "")
const settleName = (t) => `${t.view}${t.where ? ` (${t.where})` : ""}${kindWords(t)}`
// Why a settle cannot be re-timed from its URL in a fresh page, or null.
const unrepeatable = (t) => (t.after === "interaction" ? "after an action on the page" : t.altered ? "on a page the check altered" : null)
const excusedBy = (t, budget, retimes) => {
  if (unrepeatable(t)) return null
  const r = retimes.get(settleKey(t))
  if (!r) return null
  if (r.ms <= budget) return "within budget when re-timed"
  return r.main_ms > budget && r.ms <= SETTLE_RATIO * r.main_ms ? "main was over budget too" : null
}
export function assessSettle(times, budget = SETTLE_BUDGET_MS, retimes = new Map()) {
  return (times || [])
    .filter((t) => t.ms > budget && !excusedBy(t, budget, retimes))
    .map((t) => { const r = retimes.get(settleKey(t)); return `${settleName(t)}: ${secs(t.ms)}, ${unrepeatable(t) ? `${unrepeatable(t)}, so not re-timed` : r ? `re-timed ${secs(r.ms)} (main ${secs(r.main_ms)})` : "not re-timed"}` })
}
// Every route that went over budget and was excused, with why.
export function settleExcused(times, budget = SETTLE_BUDGET_MS, retimes = RETIMES) {
  return (times || []).filter((t) => t.ms > budget && excusedBy(t, budget, retimes)).map((t) => ({ ...t, retimed_ms: retimes.get(settleKey(t)).ms, main_ms: retimes.get(settleKey(t)).main_ms, because: excusedBy(t, budget, retimes) }))
}
export const excusedWarning = (x) => `warning: ${settleName(x)} settled in ${secs(x.ms)}, over the ${SETTLE_BUDGET_MS / 1000} s budget, and was excused: ${x.because} (re-timed ${secs(x.retimed_ms)}, main ${secs(x.main_ms)})`
// The body of pages_settle_within_budget: throws when no route was timed or
// a route over budget is not excused by its re-timing; the slow-file controls
// run this same function.
export function settleBudget(times, budget = SETTLE_BUDGET_MS, retimes = RETIMES) {
  if (!times.length) throw new Error("no route was timed")
  const over = assessSettle(times, budget, retimes)
  if (over.length) throw new Error(`${over.length} of ${times.length} over ${budget / 1000} s: ${over.slice(0, 5).join("; ")}`)
  const sorted = [...times].sort((a, b) => a.ms - b.ms)
  return { settled: times.length, after_an_action: times.filter((t) => t.after === "interaction").length, on_an_altered_page: times.filter((t) => t.altered).length, budget_ms: budget, ratio: SETTLE_RATIO, median_ms: sorted[Math.floor(sorted.length / 2)].ms, slowest: sorted.slice(-5).reverse(), over_budget_excused: settleExcused(times, budget, retimes), load: loadavg() }
}
// Two URLs for the same page: the same once parsed.
export function sameUrl(a, b) {
  try { return new URL(a).href === new URL(b).href } catch { return a === b }
}
// A goto that changes only the hash loads nothing: the page that is already
// open redraws, as it does after a click.
export function hashOnly(from, to) {
  try { const a = new URL(from), b = new URL(to); a.hash = ""; b.hash = ""; return a.href === b.href } catch { return false }
}
// A navigation is a settle at the URL the last goto asked for or landed on,
// with no settle since, when that goto loaded the page. Anything else
// followed an action on the page: no goto, a goto and then a click that
// moved the page on, or a goto that only changed the hash. `nav` is
// { from, asked, landed }.
export function settleAfter(nav, url) {
  if (!nav || hashOnly(nav.from, nav.asked)) return "interaction"
  return sameUrl(nav.asked, url) || (nav.landed != null && sameUrl(nav.landed, url)) ? "navigation" : "interaction"
}
// A view is ready when it is shown, no request is in flight, nothing in it
// is marked as loading (aria-busy, or the site's shared is-loading class,
// whatever its words), and its markup is the same on two reads 300 ms apart
// with the network idle in between. A slow fetch extends the wait up to
// `networkTimeout`; a view that keeps changing with the network idle fails
// after `timeout`.
async function settle(page, view, timeout = 20000, networkTimeout = 60000) {
  const t0 = Date.now()
  await page.waitForFunction((v) => document.body.dataset.view === v && !document.getElementById(`view-${v}`).hidden, view, { timeout })
  const open = IN_FLIGHT.get(page) || new Set()
  const start = Date.now()
  let idleSince = null
  let last = -1
  let loading = false
  while (true) {
    const busy = open.size > 0
    const now = await page.evaluate((v) => {
      const el = document.getElementById(`view-${v}`)
      const loading = [...el.querySelectorAll('[aria-busy="true"], .is-loading')].some((n) => n.getClientRects().length > 0)
      return loading ? -2 : el.innerHTML.length
    }, view)
    loading = now === -2
    if (busy) { idleSince = null; last = -1 }
    else {
      if (idleSince === null) idleSince = Date.now()
      if (now === last && now >= 0) {
        const ms = Date.now() - t0
        const size = page.viewportSize() || {}
        const kind = PAGE_KIND.get(page) || {}
        const asked = NAVIGATED.get(page)
        NAVIGATED.delete(page)
        const after = settleAfter(asked, page.url())
        ;(SINKS.get(page) || SETTLE_TIMES).push({ view, ms, where: page.url().replace(/^https?:\/\/[^/]+\//, ""), width: size.width, height: size.height, scale: kind.scale, theme: kind.theme, after, altered: !!kind.altered })
        return ms
      }
      last = now
    }
    if (busy && Date.now() - start > networkTimeout) throw new Error(`route never settled: ${view} (${open.size} requests still in flight: ${[...open].slice(0, 3).map((r) => r.url().replace(/^https?:\/\/[^/]+/, "")).join(", ")})`)
    if (!busy && Date.now() - idleSince > timeout) throw new Error(`route never settled: ${view} (the network was idle, but the view ${loading ? "stayed marked as loading" : "kept changing"})`)
    await page.waitForTimeout(300)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.error) { process.stderr.write(args.error + "\n"); return 2 }
  await mkdir(args.out, { recursive: true })
  const cases = [], screenshots = []
  const resources = { pid: process.pid, server: null, server_closed: false, browser_closed: false, load_at_start: loadavg() }
  const record = (name, passed, extra = {}) => { cases.push({ name, passed, ...extra }); if (!passed) process.stderr.write(`FAIL ${name}: ${extra.error || JSON.stringify(extra.problems || "").slice(0, 400)}\n`) }
  const check = async (name, fn) => {
    try { const details = await fn(); record(name, true, details ? { details } : {}) }
    catch (e) { record(name, false, { error: String(e && e.message || e).slice(0, 2000) }) }
  }
  let chromium
  try { ({ chromium } = await import(pathToFileURL(args.playwright).href)) }
  catch (e) { record("gate_blocked_browser_module_unavailable", false, { error: String(e) }) }
  const here = dirname(fileURLToPath(import.meta.url))
  const { deriveImprovementQueue, validateImprovementQueue } = await import(pathToFileURL(join(here, "improvement-queue.mjs")).href)
  const { buildBriefing } = createRequire(import.meta.url)(join(here, "..", "src", "briefing.js"))
  const S = createRequire(import.meta.url)(join(here, "..", "src", "steps.js"))
  const fixture = JSON.parse(await readFile(join(here, "..", "..", ".github", "scripts", "__tests__", "fixtures", "v12-triage.json"), "utf8"))
  const targets = await pickTargets(args.site)
  const server = await serve(args.site)
  const url = `http://127.0.0.1:${server.address().port}/`
  resources.server = url
  let browser = null
  try {
    if (!chromium) throw new Error("browser module unavailable")
    browser = await chromium.launch({ headless: true })
    // A crashed browser is relaunched for the checks that follow; the check
    // that was running when it crashed has already failed.
    const live = async () => {
      if (!browser.isConnected()) { resources.browser_relaunches = (resources.browser_relaunches || 0) + 1; browser = await chromium.launch({ headless: true }) }
      return browser
    }
    const newPage = async ({ width = 1280, height = 900, theme = "light", scale = 1, init = [], on = null } = {}) => {
      const context = await (on || await live()).newContext({ viewport: { width, height }, colorScheme: theme })
      await context.addInitScript(textScaleInit, scale)
      for (const s of init) await context.addInitScript(s.fn, s.arg)
      const page = await context.newPage()
      trackRequests(page)
      const kind = { scale, theme, altered: init.length > 0 }
      PAGE_KIND.set(page, kind)
      // The settle after a goto, at the URL it asked for, is a navigation.
      const goto = page.goto.bind(page)
      // `landed` is where the page stood when the goto resolved: the site's
      // own redirect of a legacy route is part of the navigation.
      page.goto = async (to, ...a) => { const nav = { from: page.url(), asked: to, landed: null }; NAVIGATED.set(page, nav); const r = await goto(to, ...a); nav.landed = page.url(); return r }
      // A route override changes what the page loads, so its settles cannot
      // be re-timed in a fresh page.
      const route = page.route.bind(page)
      page.route = (...a) => { kind.altered = true; return route(...a) }
      page.setDefaultTimeout(15000)
      const errors = []
      page.on("pageerror", (e) => errors.push(String(e)))
      return { context, page, errors }
    }
    const open = async (page, route, scale = 1) => {
      await page.goto(url + routeHash(route, targets))
      await settle(page, route.view)
      if (scale !== 1) await page.waitForFunction((s) => window.__gateTextScale === s, scale)
    }
    const layout = async (page, refresh = true) => assessLayout(await page.evaluate(measureLayout, { refresh }))

    // 1. The width sweep: every route, every width, both themes, both text
    // scales. Each configuration has its own browser process and each route
    // a fresh context, two configurations at a time, to bound memory.
    const configs = THEMES.flatMap((theme) => TEXT_SCALES.map((scale) => ({ theme, scale })))
    const sweepConfig = async ({ theme, scale }) => {
      let own = await chromium.launch({ headless: true })
      try {
        for (const route of ROUTES) {
          const name = `layout_sweep_${route.name}_${theme}_text${scale}x`
          if (!own.isConnected()) { resources.browser_relaunches = (resources.browser_relaunches || 0) + 1; own = await chromium.launch({ headless: true }) }
          const { context, page, errors } = await newPage({ width: 1440, theme, scale, on: own })
          try {
            await page.setViewportSize({ width: 1440, height: 900 })
            await open(page, route, scale)
            const failures = []
            for (let i = WIDTHS.length - 1; i >= 0; i--) {
              const w = WIDTHS[i]
              await page.setViewportSize({ width: w, height: 900 })
              let problems = await layout(page, i % 16 === 0)
              if (problems.length) {
                // A chart redraw is debounced after a resize; judge the settled page.
                await page.waitForTimeout(300)
                problems = await layout(page, true)
              }
              if (problems.length) failures.push({ width: w, problems })
            }
            const byCode = {}
            for (const f of failures) for (const p of f.problems) (byCode[p.code] ||= new Set()).add(f.width)
            const summary = Object.fromEntries(Object.entries(byCode).map(([c, ws]) => [c, { widths: ws.size, min: Math.min(...ws), max: Math.max(...ws) }]))
            const examples = failures.slice(0, 3).concat(failures.length > 3 ? [failures[failures.length - 1]] : [])
            if (failures.length) process.stderr.write(`  first ${name}: ${JSON.stringify(failures[0]).slice(0, 600)}\n`)
            record(name, failures.length === 0 && errors.length === 0, failures.length ? { problems: summary, examples } : errors.length ? { error: errors.join("; ") } : { details: { widths: WIDTHS.length } })
          } catch (e) { record(name, false, { error: String(e && e.message || e) }) }
          finally { await context.close().catch(() => {}) }
        }
      } finally { await own.close().catch(() => {}) }
    }
    for (let i = 0; i < configs.length; i += 2) await Promise.all(configs.slice(i, i + 2).map(sweepConfig))

    // 2. Representative screenshots (viewport), re-measured fresh at each width.
    for (const variant of SCREENSHOT_VARIANTS) {
      for (const width of SCREENSHOT_WIDTHS) {
        const { context, page } = await newPage({ width, height: 900, ...variant })
        try {
          for (const routeName of SCREENSHOT_ROUTES) {
            const route = ROUTES.find((r) => r.name === routeName)
            await check(`screenshot_${routeName}_${width}_${variant.theme}_text${variant.scale}x`, async () => {
              await open(page, route, variant.scale)
              const file = `shot-${routeName}-${width}-${variant.theme}-text${variant.scale}x.png`
              await page.screenshot({ path: join(args.out, file) })
              screenshots.push(file)
              const problems = await layout(page)
              if (problems.length) throw new Error(JSON.stringify(problems.slice(0, 6)))
            })
          }
        } finally { await context.close() }
      }
    }

    // 3. Charts have accessible equivalents.
    {
      const { context, page } = await newPage({ width: 1280 })
      try {
        for (const route of ROUTES) {
          await check(`chart_equivalents_${route.name}`, async () => {
            await open(page, route)
            const r = await page.evaluate(checkChartEquivalents, CHART_EQUIVALENTS)
            for (const key of EXPECTED_CHARTS[route.name] || []) if (!r.seen.includes(key)) r.problems.push(`expected_chart_not_drawn: ${key}`)
            if (r.problems.length) throw new Error(r.problems.join("; "))
            return { charts: r.seen }
          })
        }
        await page.goto(url + "#/compare")
        await settle(page, "compare")
        await page.locator("#over-time").evaluate((n) => { const d = n.closest("details"); if (d) d.open = true })
        await page.waitForTimeout(300)
        await check("chart_equivalents_compare_over_time_open", async () => {
          const r = await page.evaluate(checkChartEquivalents, CHART_EQUIVALENTS)
          if (r.problems.length) throw new Error(r.problems.join("; "))
          if (!r.seen.includes("ot-bars")) throw new Error("the weekly chart did not draw")
          return { charts: r.seen }
        })
      } finally { await context.close() }
    }

    // 4. Keyboard: selection, drawer open and Escape close with focus return, Clear with Space, select by type-ahead.
    // An evidence item on a task's value-stream map opens the drawer in
    // place. (A cause page's evidence link navigates to the task instead, so
    // its opener is no longer on screen.)
    // Ladder steps also open evidence but record no selection, so both keys
    // are tried on the same value-stream box.
    const drawerCheck = async (page, key = "Enter", nth = 0) => {
      await open(page, ROUTES.find((r) => r.name === "task"))
      const item = page.locator('#vsm [aria-label$="Opens the evidence."]').nth(nth)
      if (!(await item.count())) throw new Error("no in-place evidence item on the task page")
      await item.evaluate((a) => { a.dataset.gateOpener = "1" })
      await item.focus()
      await page.keyboard.press(key)
      await page.waitForSelector("#evidence-drawer[open]")
      await page.waitForFunction(() => location.hash.includes("selection="), null, { timeout: 3000 }).catch(() => {})
      if (!page.url().includes("selection=")) throw new Error(`${key} did not select the evidence`)
      const inside = await page.evaluate(() => document.getElementById("evidence-drawer").contains(document.activeElement))
      if (!inside) throw new Error("focus did not move into the opened drawer")
      await page.keyboard.press("Escape")
      await page.waitForFunction(() => !document.getElementById("evidence-drawer").open)
      await page.waitForTimeout(200)
      const back = await page.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.gateOpener === "1")
      if (!back) throw new Error("Escape closed the drawer but focus did not return to the opener")
    }
    {
      const { context, page } = await newPage({ width: 1280 })
      try {
        await check("keyboard_enter_selects_evidence_escape_closes_and_returns_focus", () => drawerCheck(page, "Enter", 0))
        await check("keyboard_space_selects_evidence_escape_closes_and_returns_focus", () => drawerCheck(page, "Space", 0))
        await check("keyboard_select_by_type_ahead_and_clear_with_space_keep_focus", async () => {
          await open(page, ROUTES.find((r) => r.name === "compare"))
          await page.focus("#compare-status")
          await page.keyboard.press("d")
          await page.waitForFunction(() => location.hash.includes("status=done"))
          await page.waitForTimeout(300)
          if (await page.evaluate(() => document.activeElement.id) !== "compare-status") throw new Error("focus left the changed select")
          const clear = page.getByRole("button", { name: "Clear filters", exact: true })
          await clear.focus()
          await page.keyboard.press("Space")
          await page.waitForFunction(() => !location.hash.includes("status="))
          await page.waitForTimeout(300)
          if (await page.evaluate(() => document.activeElement && document.activeElement.textContent) !== "Clear filters") throw new Error("focus left Clear filters")
          await page.goBack()
          await page.waitForFunction(() => location.hash.includes("status=done"))
        })
      } finally { await context.close() }
    }

    // 4b. Tab order, filters that change the numbers, and clearing a
    // selection that was opened from an address rather than its link.
    {
      const { context, page } = await newPage({ width: 1280 })
      try {
        await check("tab_order_follows_the_page_on_primary_routes", async () => {
          const out = []
          for (const routeName of ["overview", "tasks", "task", "compare", "findings", "improvements"]) {
            const route = ROUTES.find((r) => r.name === routeName)
            await open(page, route)
            // Start from the top of the document: a throwaway focus point before everything else.
            await page.evaluate(() => { const s = document.createElement("span"); s.tabIndex = -1; s.id = "gate-tab-start"; document.body.prepend(s); s.focus(); window.scrollTo(0, 0) })
            const positive = await page.evaluate(() => [...document.querySelectorAll("[tabindex]")].filter((e) => e.tabIndex > 0).length)
            if (positive) out.push(`${routeName}: ${positive} positive tabindex`)
            let prev = null
            for (let i = 0; i < 30; i++) {
              await page.keyboard.press("Tab")
              const f = await page.evaluate((i) => {
                const e = document.activeElement
                if (!e || e === document.body) return { none: true }
                e.dataset.gateTab = ((e.dataset.gateTab || "") + " " + i).trim()
                const r = e.getBoundingClientRect()
                const label = (e.getAttribute("aria-label") || e.textContent || e.id || e.tagName).trim().slice(0, 30)
                const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
                return { label, visible, inDialog: !!e.closest("dialog[open]") }
              }, i)
              if (i === 0) await page.evaluate(() => { const s = document.getElementById("gate-tab-start"); if (s) s.remove() })
              if (f.none) break
              if (!f.visible) out.push(`${routeName}: tab ${i + 1} "${f.label}" is not on screen when focused`)
              if (i === 0 && !/skip/i.test(f.label)) out.push(`${routeName}: first tab is "${f.label}", not the skip link`)
              if (prev !== null && !f.inDialog) {
                // A date input's month, day and year are one element: staying on it is not moving backward.
                const forward = await page.evaluate(([a, b]) => { const x = document.querySelector(`[data-gate-tab~="${a}"]`), y = document.querySelector(`[data-gate-tab~="${b}"]`); return !!(x && y && (x === y || (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING))) }, [prev, i])
                if (!forward) out.push(`${routeName}: tab ${i + 1} "${f.label}" moves backward in the page`)
              }
              prev = i
            }
            await page.evaluate(() => { for (const e of document.querySelectorAll("[data-gate-tab]")) delete e.dataset.gateTab })
          }
          if (out.length) throw new Error(out.slice(0, 10).join("; "))
        })
        await check("filter_change_updates_aggregates_and_coverage", async () => {
          await page.goto(url + "#/compare")
          await settle(page, "compare")
          const read = () => page.evaluate(() => ({
            scope: (document.getElementById("compare-scope") || {}).textContent || "",
            bars: document.querySelectorAll("#stackup .sb-col").length,
            rows: document.querySelectorAll("#stackup-table tbody tr").length,
            conclusion: (document.getElementById("comparison-conclusion") || {}).textContent || "",
          }))
          const before = await read()
          const expected = S.selectTaskPopulation(targets.data.jobs, { status: "done" }).length
          const all = S.selectTaskPopulation(targets.data.jobs, {}).length
          if (expected === all) throw new Error("the build has no task outside status done, so a filter change cannot be checked")
          await page.selectOption("#compare-status", "done")
          await page.waitForFunction(() => location.hash.includes("status=done"))
          await page.waitForFunction((b) => document.querySelectorAll("#stackup .sb-col").length !== b, before.bars, { timeout: 5000 }).catch(() => {})
          const after = await read()
          const problems = []
          if (after.scope === before.scope) problems.push("the coverage statement did not change")
          if (!after.scope.includes(String(expected))) problems.push(`the coverage statement does not name ${expected} tasks: "${after.scope.slice(0, 160)}"`)
          if (after.bars !== expected) problems.push(`the chart draws ${after.bars} tasks, the filter selects ${expected}`)
          if (after.rows !== expected) problems.push(`the table lists ${after.rows} tasks, the filter selects ${expected}`)
          if (problems.length) throw new Error(problems.join("; "))
          return { before: { bars: before.bars, rows: before.rows }, after: { bars: after.bars, rows: after.rows }, expected }
        })
        await check("clear_selection_without_the_original_link", async () => {
          await page.goto(url + routeHash(ROUTES.find((r) => r.name === "task"), targets) + "?selection=bursts%3A1-1")
          await settle(page, "task")
          // An address selection may open its evidence; close it first, as a reader would.
          if (await page.evaluate(() => !!document.getElementById("evidence-drawer")?.open)) {
            await page.keyboard.press("Escape")
            await page.waitForFunction(() => !document.getElementById("evidence-drawer").open)
          }
          const clear = page.locator("#navigation-context").getByRole("button", { name: "Clear selection", exact: true })
          if (!(await clear.count())) throw new Error("no Clear selection control for a selection opened from its address")
          await clear.focus()
          await page.keyboard.press("Enter")
          await page.waitForFunction(() => !location.hash.includes("selection="))
          await page.waitForTimeout(300)
          const r = await page.evaluate(() => ({
            requested: /An item from this link is selected/.test((document.getElementById("navigation-context") || {}).textContent || ""),
            lit: document.querySelectorAll("#vsm .is-hl").length,
            body: document.activeElement === document.body || !document.activeElement,
          }))
          if (r.requested || r.lit) throw new Error(`selection still shown: ${JSON.stringify(r)}`)
          if (r.body) throw new Error("focus was dropped to the page body after clearing")
        })
      } finally { await context.close() }
    }

    // 5. Touch-friendly targets, non-color markers, no blocking guide.
    {
      const { context, page } = await newPage({ width: 390, height: 844 })
      try {
        await check("guide_never_blocks_the_page", async () => {
          await open(page, ROUTES[0])
          const modal = await page.evaluate(() => !!document.querySelector("dialog:modal, [aria-modal=true]:not([hidden])"))
          if (modal) throw new Error("a modal blocks the first visit")
          await page.getByRole("link", { name: "Tasks", exact: true }).first().click()
          await settle(page, "tasks")
        })
        await check("touch_targets_are_at_least_24px", async () => {
          const small = []
          for (const routeName of ["compare", "cause", "improvements", "tasks"]) {
            await open(page, ROUTES.find((r) => r.name === routeName))
            small.push(...await page.evaluate((rn) => {
              const view = document.getElementById(`view-${document.body.dataset.view}`)
              const out = []
              for (const e of view.querySelectorAll("button, select, input, summary, .mode-btn")) {
                const r = e.getBoundingClientRect()
                if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)) out.push(`${rn}: ${e.tagName.toLowerCase()} "${(e.textContent || e.id).trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
              }
              for (const a of view.querySelectorAll(".cause-spans a, .cause-tasks a")) {
                const row = a.closest("li, tr") || a
                if (row.getBoundingClientRect().height < 24) out.push(`${rn}: evidence row ${Math.round(row.getBoundingClientRect().height)}px`)
              }
              return out
            }, routeName))
          }
          if (small.length) throw new Error(small.slice(0, 12).join("; ") + (small.length > 12 ? ` (+${small.length - 12} more)` : ""))
        })
        await check("status_and_legends_carry_non_color_markers", async () => {
          await open(page, ROUTES.find((r) => r.name === "compare"))
          const r = await page.evaluate(() => {
            const status = document.getElementById("status-line")
            const word = /Alive|Stale|Broken|Unknown|Abnormal|Normal/.test(status ? status.textContent : "")
            const glyph = /[●◐■?]/.test(status ? status.textContent : "")
            const blank = [...document.querySelectorAll("#view-compare .tw-legend li")].filter((li) => !li.textContent.trim()).length
            return { word, glyph, blank }
          })
          if (!r.word || !r.glyph || r.blank) throw new Error(JSON.stringify(r))
        })
      } finally { await context.close() }
    }

    // 5b. Space and structure. At 1280 px and normal text no table becomes
    // cards; Compare and Overview stay within HEIGHT_BUDGET of the baseline
    // build; a table that does become cards keeps its table roles, which
    // display: block would otherwise drop in some browsers.
    {
      const baseServer = await serve(args.baseline)
      const baseUrl = `http://127.0.0.1:${baseServer.address().port}/`
      const height = async (page, at, route) => {
        await page.goto(at + route.hash)
        await settle(page, route.view)
        await page.waitForTimeout(600)
        return page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(document.documentElement.scrollHeight))))
      }
      try {
        await check("wide_screen_tables_stay_tables_at_normal_text", async () => {
          const { context, page } = await newPage({ width: 1280, height: 900 })
          try {
            const cards = []
            for (const route of ROUTES) {
              await open(page, route)
              await page.waitForTimeout(300)
              cards.push(...(await page.evaluate(findCardTables)).map((c) => `${route.name}: ${c.el}`))
            }
            if (cards.length) throw new Error(`tables shown as cards at 1280 px: ${cards.join("; ")}`)
            return { routes: ROUTES.length }
          } finally { await context.close() }
        })
        await check("page_height_within_budget_of_baseline", async () => {
          const over = [], heights = {}
          for (const width of Object.keys(HEIGHT_BUDGET).map(Number)) {
            const { context, page } = await newPage({ width, height: 900 })
            try {
              for (const name of HEIGHT_ROUTES) {
                const route = ROUTES.find((r) => r.name === name)
                const site = await height(page, url, route), base = await height(page, baseUrl, route)
                heights[`${name}_${width}`] = { site, reference: base, ratio: Math.round((site / base) * 100) / 100 }
              }
            } finally { await context.close() }
          }
          over.push(...assessHeights(heights, HEIGHT_BUDGET).map((o) => o.replace("vs reference", "vs baseline")))
          if (over.length) throw new Error(over.join("; "))
          return heights
        })
        await check("page_height_within_budget_at_doubled_text", async () => {
          // Against the baseline build at doubled text, with the normal-text
          // budget; the ratio to this page at normal text is reported only.
          const heights = {}
          for (const width of Object.keys(HEIGHT_BUDGET).map(Number)) {
            for (const scale of [2, 1]) {
              const { context, page } = await newPage({ width, height: 900, scale })
              try {
                for (const name of HEIGHT_ROUTES) {
                  const route = ROUTES.find((r) => r.name === name), k = `${name}_${width}`
                  if (scale === 2) {
                    const site = await height(page, url, route), base = await height(page, baseUrl, route)
                    heights[k] = { site, reference: base, ratio: Math.round((site / base) * 100) / 100 }
                  } else heights[k].text2x_over_text1x = Math.round((heights[k].site / (await height(page, url, route))) * 100) / 100
                }
              } finally { await context.close() }
            }
          }
          const over = assessHeights(heights, HEIGHT_BUDGET).map((o) => o.replace("vs reference", "vs the baseline's doubled text"))
          if (over.length) throw new Error(over.join("; "))
          return heights
        })
        await check("stacked_tables_keep_table_roles", async () => {
          const { context, page } = await newPage({ width: 390, height: 844, scale: 2 })
          try {
            await open(page, ROUTES.find((r) => r.name === "compare"), 2)
            await page.waitForTimeout(300)
            const r = await page.evaluate(checkTableRoles)
            r.bad = [...new Set(r.bad.map((x) => x.what))]
            if (!r.holders) throw new Error("no table became cards at 390 px with doubled text, so the roles were not exercised")
            if (r.bad.length) throw new Error(r.bad.join("; "))
            return { stacked: r.holders }
          } finally { await context.close() }
        })
      } finally { await new Promise((resolve) => baseServer.close(resolve)) }
    }

    // 5c. The task page, Compare and Overview lead with their conclusion: it
    // starts within the first screen at every width and both text sizes,
    // judged absolutely.
    await check("conclusion_starts_within_the_first_screen", async () => {
      const late = [], worst = {}
      for (const scale of TEXT_SCALES) {
        for (const [name, selector] of Object.entries(CONCLUSIONS)) {
          const { context, page } = await newPage({ width: 1440, height: firstScreenHeight(1440), scale })
          try {
            await open(page, ROUTES.find((r) => r.name === name), scale)
            await page.waitForFunction((sel) => { const e = document.querySelector(`${sel} [data-role="conclusion"]`); return e && e.textContent.trim() && !/^Loading/.test(e.textContent.trim()) }, selector, { timeout: 15000 }).catch(() => {})
            for (let i = WIDTHS.length - 1; i >= 0; i--) {
              await page.setViewportSize({ width: WIDTHS[i], height: firstScreenHeight(WIDTHS[i]) })
              const m = await page.evaluate(measureConclusion, selector)
              const why = assessFirstScreen(m, WIDTHS[i], scale)
              if (why) late.push({ name, width: WIDTHS[i], scale, why })
              const k = `${name}_text${scale}x`
              if (m.found && (!worst[k] || m.top > worst[k].top)) worst[k] = { top: m.top, width: WIDTHS[i] }
            }
          } finally { await context.close() }
        }
      }
      if (late.length) throw new Error(`${late.length} page, width and text-size cases: ${late.slice(0, 4).map((l) => `${l.name} at ${l.width} px, ${l.scale}x text: ${l.why}`).join("; ")}`)
      return { widths: WIDTHS.length, text_scales: TEXT_SCALES, pages: Object.keys(CONCLUSIONS), worst }
    })

    // 6. Long names, bounded values and a 26-week lookback stay readable.
    {
      const long = "A very long local task name that keeps going to test wrapping across narrow screens without clipping any of its words ".repeat(1).trim()
      const names = { version: 1, jobs: Object.fromEntries(targets.data.jobs.map((j) => [j.id, { title: `${long} ${j.id.slice(0, 6)}`, track: "track", task: "task" }])) }
      let byWeek = null
      try { byWeek = JSON.parse(await readFile(join(args.site, "rollups/by_week.json"), "utf8")) } catch { /* absent */ }
      const { context, page } = await newPage({ width: 320, height: 800 })
      try {
        await page.route("**/local-names.json", (r) => r.fulfill({ json: names }))
        if (byWeek && Array.isArray(byWeek.weeks) && byWeek.weeks.length) {
          const base = byWeek.weeks[byWeek.weeks.length - 1]
          const start = Date.parse(base.starts_on + "T00:00:00Z")
          const weeks = Array.from({ length: 26 }, (_, i) => {
            const d = new Date(start - (25 - i) * 7 * 86400000)
            const iso = (() => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3)); const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7); return `${y}-W${String(w).padStart(2, "0")}` })()
            return { ...base, week: iso, starts_on: d.toISOString().slice(0, 10) }
          })
          await page.route("**/rollups/by_week.json", (r) => r.fulfill({ json: { ...byWeek, weeks } }))
        }
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          for (const routeName of ["tasks", "task", "compare", "cause"]) {
            await check(`long_names_and_26_weeks_${routeName}_${width}`, async () => {
              await open(page, ROUTES.find((r) => r.name === routeName))
              if (routeName === "compare") {
                await page.locator("#over-time").evaluate((n) => { const d = n.closest("details"); if (d) d.open = true })
                await page.waitForTimeout(300)
              }
              const text = await page.locator(`#view-${ROUTES.find((r) => r.name === routeName).view}`).innerText()
              if (["tasks", "compare"].includes(routeName) && !text.includes(long.slice(0, 40))) throw new Error("the long local name is not shown")
              const problems = await layout(page)
              if (problems.length) throw new Error(JSON.stringify(problems.slice(0, 6)))
              if (routeName === "tasks" && !/so far|at least|at most|about|≥|≤|or more|or less|not known|unavailable/i.test(text)) throw new Error("no bounded or unavailable value is marked in words")
              if (routeName === "compare" && width === 1440) {
                const weekRows = await page.locator("#over-time-table tr").count()
                if (weekRows < 26) throw new Error(`the 26-week lookback shows ${weekRows} table rows`)
              }
            })
          }
        }
        await page.screenshot({ path: join(args.out, "long-names-26-weeks-compare-1440.png") })
        screenshots.push("long-names-26-weeks-compare-1440.png")
      } finally { await context.close() }
    }

    // 7. Storage denied, data fetch failure, a render error and unavailable modes keep navigation.
    const storageUsable = async (init) => {
      const { context, page, errors } = await newPage({ width: 390, init: [init] })
      try {
        await open(page, ROUTES[0])
        // Said where the reader sees it without opening the time zone control.
        const status = await page.locator("#display-settings > summary").innerText()
        if (!/not saved|unavailable/i.test(status)) throw new Error(`the visible time zone control does not say preferences are not saved: ${status}`)
        await page.selectOption("#display-zone", { index: 1 }).catch(() => {})
        await page.getByRole("link", { name: "Tasks", exact: true }).first().click()
        await settle(page, "tasks")
        if (errors.length) throw new Error(`page errors: ${errors.join("; ").slice(0, 300)}`)
      } finally { await context.close() }
    }
    // Both stores denied at the accessor, then present but throwing on every call.
    await check("storage_denied_keeps_the_site_usable", () => storageUsable({ fn: () => {
      for (const k of ["localStorage", "sessionStorage"]) Object.defineProperty(window, k, { configurable: true, get() { throw new Error("denied") } })
    } }))
    await check("storage_methods_throwing_keep_the_site_usable", () => storageUsable({ fn: () => {
      for (const m of ["getItem", "setItem", "removeItem", "clear", "key"]) Storage.prototype[m] = function () { throw new Error("denied") }
    } }))
    await check("data_fetch_failure_says_so_and_navigation_works", async () => {
      const { context, page } = await newPage({ width: 390 })
      try {
        await page.route("**/data.json", (r) => r.abort())
        await page.goto(url + "#/")
        await page.waitForFunction(() => /could not/i.test(document.getElementById("status-line")?.textContent || ""))
        for (const [link, view] of [["Why Lean?", "why"], ["Help", "help"]]) {
          await page.getByRole("link", { name: link, exact: true }).first().click()
          await page.waitForFunction((v) => document.body.dataset.view === v, view)
          if ((await page.locator(`#view-${view}`).innerText()).trim().length < 20) throw new Error(`${view} is empty after a data failure`)
        }
        const problems = await layout(page)
        if (problems.length) throw new Error(JSON.stringify(problems))
      } finally { await context.close() }
    })
    await check("render_error_is_isolated", async () => {
      const { context, page } = await newPage({ width: 390 })
      try {
        await page.route("**/data.json", async (r) => r.fulfill({ json: { ...targets.data, overview: { malformed: true } } }))
        await page.goto(url + "#/")
        await page.waitForFunction(() => /malformed|could not|unavailable/i.test(document.getElementById("overview-state")?.textContent || ""))
        await page.getByRole("link", { name: "Tasks", exact: true }).first().click()
        await settle(page, "tasks")
      } finally { await context.close() }
    })
    await check("production_and_request_modes_follow_published_clocks", async () => {
      // Each mode draws a bar exactly for the tasks whose clock Desk published
      // with a value; the rest say why, and nothing is drawn as a zero or
      // relabelled from the legacy lead time. A drawn sum is task exposure.
      const jobs = Array.isArray(targets.data && targets.data.jobs) ? targets.data.jobs : []
      const valued = (key) => jobs.filter((j) => { const n = j && j.clocks && j.clocks[key]; return n && n.state !== "unavailable" && typeof n.value === "number" }).length
      const { context, page } = await newPage({ width: 768 })
      try {
        for (const [mode, key] of [["production", "production_ms"], ["request", "request_to_delivery_ms"]]) {
          await page.goto(url + `#/compare?mode=${mode}`)
          await settle(page, "compare")
          const r = await page.evaluate(() => ({
            drawn: [...document.querySelectorAll("#stackup .sb-col")].filter((c) => (c.querySelector(".sb-value") || {}).textContent).length,
            text: document.getElementById("stackup").innerText,
            view: document.getElementById("view-compare").innerText,
          }))
          const expected = valued(key)
          if (r.drawn !== expected) throw new Error(`${mode}: ${r.drawn} bars with a value, the data publishes ${expected}`)
          if (expected < jobs.length && !/not available/i.test(r.text)) throw new Error(`${mode}: tasks without the clock are not said to be unavailable`)
          if (expected > 0 && !/task exposure/i.test(r.view)) throw new Error(`${mode}: the summed time is not labelled task exposure`)
        }
      } finally { await context.close() }
    })
    // Compare's figures, read once per mode and width for the three checks
    // below: page text, accessible labels and tooltips.
    let compareRead = null
    const readCompare = async () => {
      if (compareRead) return compareRead
      const out = []
      for (const width of [1280, 390]) {
        const { context, page } = await newPage({ width })
        try {
          for (const mode of ["all", "working", "production", "request"]) {
            await page.goto(url + `#/compare?mode=${mode}`)
            await settle(page, "compare")
            out.push({ width, ...(await page.evaluate(compareFigures)) })
          }
        } finally { await context.close() }
      }
      return (compareRead = out)
    }
    // A one-task Compare plot is the narrowest chart (72 px, beside a 46 px
    // axis). In every mode with a drawn bar, its labels stay inside it at both
    // widths and both text sizes, and the measurement really covers a chart
    // under 100 px wide.
    await check("narrow_one_task_plot_keeps_text_in_bounds", async () => {
      const seen = {}
      const firstBar = {}
      for (const r of await readCompare()) if (r.width === 1280 && !firstBar[r.mode] && r.rows.length) firstBar[r.mode] = r.rows[0].job
      const modes = ["all", "working", "production", "request"]
      for (const mode of modes) {
        const task = mode === "all" ? targets.task : firstBar[mode]
        if (!task) { seen[mode] = "no bar drawn in this mode"; continue }
        for (const scale of TEXT_SCALES) {
          for (const width of [390, 1280]) {
            const { context, page } = await newPage({ width, height: 900, scale })
            try {
              await page.goto(url + `#/compare?mode=${mode}&task=${encodeURIComponent(task)}`)
              await settle(page, "compare")
              if (scale !== 1) await page.waitForFunction((s) => window.__gateTextScale === s, scale)
              const m = await page.evaluate(measureLayout, { refresh: true })
              const narrow = (m.chartsMeasured || []).filter((c) => c.width < 100)
              if (!narrow.some((c) => /sb-plot/.test(c.cls))) throw new Error(`${mode}, ${width} px, ${scale}x text: no one-task plot under 100 px wide was measured (${JSON.stringify((m.chartsMeasured || []).map((c) => [c.cls, c.width]))})`)
              const bad = assessLayout(m).filter((p) => p.code === "chart_text_out_of_bounds" || p.code === "overlapping_labels")
              if (bad.length) throw new Error(`${mode}, ${width} px, ${scale}x text: ${bad.slice(0, 3).map((p) => p.detail || p.code).join("; ")}`)
              seen[`${mode}_${width}_text${scale}x`] = narrow.map((c) => ({ chart: c.cls || c.chart, width: c.width, texts: c.texts }))
            } finally { await context.close() }
          }
        }
      }
      if (Object.values(seen).every((v) => typeof v === "string")) throw new Error("no mode drew a bar to measure")
      return seen
    })
    // Every task's lead time on its own page equals Compare's.
    // Every task page, read once at each width for the two checks below: its
    // lead time and every text a reader can meet (page text, accessible
    // labels and titles).
    let taskPagesRead = null
    const readTaskPages = async () => {
      if (taskPagesRead) return taskPagesRead
      const ids = (Array.isArray(targets.data && targets.data.jobs) ? targets.data.jobs : []).map((j) => j.id)
      const out = []
      for (const width of [1280, 390]) {
        const { context, page } = await newPage({ width })
        try {
          for (const job of ids) {
            await page.goto("about:blank")
            await page.goto(url + `#/task/${encodeURIComponent(job)}`)
            await settle(page, "task")
            out.push({ width, job, ...(await page.evaluate(taskLeadFigures)), texts: await page.evaluate(taskPageTexts), shares: await page.evaluate(taskShareFigures) })
          }
        } finally { await context.close() }
      }
      return (taskPagesRead = out)
    }
    await check("task_page_lead_time_matches_compare", async () => {
      const all = (await readCompare()).find((r) => r.mode === "all" && r.width === 1280)
      if (!all || !all.cellsByJob) throw new Error("Compare's all-mode table was not read")
      const jobs = Object.entries(all.cellsByJob).filter(([, c]) => durationForm(c))
      if (!jobs.length) throw new Error("no Compare lead time to compare")
      const pages = new Map((await readTaskPages()).filter((r) => r.width === 1280).map((r) => [r.job, r]))
      const rows = jobs.map(([job, compare]) => ({ job, compare, caption: pages.has(job) ? pages.get(job).caption : null, aria: pages.has(job) ? pages.get(job).aria : null }))
      const off = assessLeadAgreement(rows)
      if (off.length) throw new Error(`${off.length} of ${rows.length * 2} lead times differ: ${off.slice(0, 4).join("; ")}`)
      return { tasks: rows.length, sample: rows.slice(0, 5) }
    })
    await check("task_pages_share_edges_exact", async () => {
      const pages = await readTaskPages()
      if (!pages.length) throw new Error("no task page was read")
      const bad = pages.flatMap((r) => assessShareEdges(r.shares).map((x) => `${r.job.slice(0, 8)} at ${r.width} px: ${x}`))
      if (bad.length) throw new Error(`${bad.length} found: ${[...new Set(bad)].slice(0, 4).join("; ")}`)
      return { pages: pages.length, figures: pages.reduce((a, r) => a + r.shares.groups.length + r.shares.parts.length, 0) }
    })
    await check("task_pages_no_bound_before_under", async () => {
      const pages = await readTaskPages()
      if (!pages.length) throw new Error("no task page was read")
      const bad = pages.flatMap((r) => boundsBeforeUnder(r.texts).map((x) => `${r.job.slice(0, 8)} at ${r.width} px: ${x}`))
      if (bad.length) throw new Error(`${bad.length} found: ${[...new Set(bad)].slice(0, 4).join("; ")}`)
      return { pages: pages.length, texts: pages.reduce((a, r) => a + r.texts.length, 0) }
    })
    await check("compare_axis_sum_and_lead_share_one_unit", async () => {
      const seen = {}
      for (const r of await readCompare()) {
        const why = assessViewUnits(r)
        if (why) throw new Error(`${r.mode} at ${r.width} px: ${why}`)
        seen[`${r.mode}_${r.width}`] = { axis: r.axis, sum: r.sum ? (durationForm(r.sum) || {}).unit : null, lead: r.lead ? (durationForm(r.lead) || {}).unit : null }
      }
      return seen
    })
    await check("compare_task_figures_match_everywhere", async () => {
      const seen = {}
      for (const r of await readCompare()) {
        const off = assessTaskForms(r.rows)
        if (off.length) throw new Error(`${r.mode} at ${r.width} px: ${off.length} figures differ: ${off.slice(0, 3).join("; ")}`)
        if (r.column && r.rows.length && !r.rows.some((x) => x.cell !== null)) throw new Error(`${r.mode} at ${r.width} px: a table column is shown but no bar matched a cell`)
        seen[`${r.mode}_${r.width}`] = { bars: r.rows.length, with_table_cell: r.rows.filter((x) => x.cell !== null).length, with_tooltip: r.rows.filter((x) => x.tip !== null).length }
      }
      // A mode may draw no bar (no task has that clock), but the check must read some.
      if (!Object.values(seen).some((x) => x.bars > 0)) throw new Error("no bar with a value was read in any mode")
      return seen
    })
    // Share mode is read only for its texts: its figures are shares, not the
    // durations the other Compare checks compare.
    let shareRead = null
    const readCompareShare = async () => {
      if (shareRead) return shareRead
      const out = []
      for (const width of [1280, 390]) {
        const { context, page } = await newPage({ width })
        try {
          await page.goto(url + "#/compare?mode=share")
          await settle(page, "compare")
          out.push({ width, mode: "share", ...(await page.evaluate(compareFigures)), pairs: await page.evaluate(shareModePairs) })
        } finally { await context.close() }
      }
      return (shareRead = out)
    }
    await check("share_mode_label_matches_flow_efficiency", async () => {
      const seen = {}
      for (const r of await readCompareShare()) {
        const pairs = r.pairs || []
        if (!pairs.length) throw new Error(`no task in share mode at ${r.width} px has both a bar and flow-efficiency words`)
        if (!pairs.some((p) => typeof p.tip === "string")) throw new Error(`no share-mode tooltip was read at ${r.width} px`)
        const off = assessSharePairs(pairs)
        if (off.length) throw new Error(`${off.length} of ${pairs.length} at ${r.width} px differ: ${off.slice(0, 4).join("; ")}`)
        seen[`share_${r.width}`] = { tasks: pairs.length, tooltips: pairs.filter((p) => typeof p.tip === "string").length }
      }
      return seen
    })
    await check("compare_no_bound_before_under", async () => {
      const seen = {}
      for (const r of [...(await readCompare()), ...(await readCompareShare())]) {
        const bad = boundsBeforeUnder(r.texts)
        if (bad.length) throw new Error(`${r.mode} at ${r.width} px: ${[...new Set(bad)].slice(0, 4).join(", ")}`)
        seen[`${r.mode}_${r.width}`] = { texts: r.texts.length }
      }
      return seen
    })

    // 8. JSON twins agree with each other and with what the page says.
    await check("json_twins_match_data_and_rendered_meaning", async () => {
      const twin = async (p) => JSON.parse(await readFile(join(args.site, p), "utf8"))
      const overview = await twin("rollups/overview.json"), improvements = await twin("rollups/improvements.json")
      if (JSON.stringify(overview) !== JSON.stringify(targets.data.overview)) throw new Error("overview twin differs from data.json")
      if (JSON.stringify(improvements) !== JSON.stringify(targets.data.improvements)) throw new Error("improvements twin differs from data.json")
      const { context, page } = await newPage({ width: 1280 })
      try {
        await open(page, ROUTES[0])
        const counts = await page.evaluate(() => ({
          attention: document.querySelectorAll("#overview-attention .briefing-list > li").length,
          investigation: document.querySelectorAll("#overview-investigation .briefing-list > li").length,
        }))
        if (Array.isArray(overview.attention) && counts.attention !== overview.attention.length) throw new Error(`attention: page ${counts.attention}, twin ${overview.attention.length}`)
        if (Array.isArray(overview.investigation) && counts.investigation !== overview.investigation.length) throw new Error(`investigation: page ${counts.investigation}, twin ${overview.investigation.length}`)
        await open(page, ROUTES.find((r) => r.name === "improvements"))
        const text = await page.locator("#view-act").innerText()
        const rows = await page.locator(".improvement-row").count()
        if (improvements.state === "not_reviewed" && (!/not (been )?reviewed/i.test(text) || rows)) throw new Error("not-reviewed twin is not what the page says")
        if (improvements.state !== "not_reviewed" && rows !== improvements.rows.length) throw new Error(`improvement rows: page ${rows}, twin ${improvements.rows.length}`)
        return { overview_attention: counts.attention, overview_investigation: counts.investigation, improvements_state: improvements.state }
      } finally { await context.close() }
    })

    // 9. The paired private-decision fixture, stale and conflicting queues, and the clipboard.
    const now = Date.now()
    const batch = (v, at = now) => ({ path: `triage/${v.batch}.json`, bytes: JSON.stringify(v), committedAtMs: at })
    const privateQueue = deriveImprovementQueue({ batches: [batch(fixture.public)], now })
    const conflictAlt = structuredClone(fixture.public); conflictAlt.batch = "fedcba9876543210"; conflictAlt.rows[0].route = "investigate"; conflictAlt.rows[0].gate = null
    const queues = {
      private_human_decision_without_public_issue: privateQueue,
      equal_revision_conflict: deriveImprovementQueue({ batches: [batch(fixture.public), batch(conflictAlt)], now }),
      stale_publication: deriveImprovementQueue({ batches: [batch(fixture.public, now - 30 * 86400000)], now }),
      empty_never_reviewed: deriveImprovementQueue({ batches: [], now }),
    }
    for (const [name, q] of Object.entries(queues)) if (!validateImprovementQueue(q).ok) record(`fixture_queue_${name}_valid`, false, { error: "derived queue failed validation" })
    const withQueue = (q) => ({ ...targets.data, improvements: q, overview: buildBriefing({ data: { ...targets.data, improvements: q }, improvements: q, now, validateQueue: validateImprovementQueue }) })
    const contextual = ROUTES.find((r) => r.name === "improvements_contextual")
    const clipboardFailure = async (page) => {
      await page.route("**/data.json", (r) => r.fulfill({ json: withQueue(privateQueue) }))
      await open(page, contextual)
      const row = page.locator(".improvement-row").first()
      await row.getByRole("button", { name: "Copy as a prompt for your agent", exact: true }).click()
      await page.waitForTimeout(200)
      const status = await row.locator('[role="status"]').innerText()
      if (/Copied/.test(status) || !/Copy failed/.test(status)) throw new Error(`status after a refused copy: "${status}"`)
      const pre = row.locator("pre")
      if (!(await pre.isVisible())) throw new Error("the prompt is not shown after a refused copy")
      const prompt = await pre.innerText()
      for (const must of [fixture.public.rows[0].id, "inspect_only_no_new_authority", `"cause":"${targets.cause}"`, `"return":"#/causes/${targets.cause}"`]) if (!prompt.includes(must)) throw new Error(`prompt lacks ${must}`)
      for (const s of fixture.privacy_sentinels) if (prompt.includes(s)) throw new Error("prompt carries a private sentinel")
      const selected = await page.evaluate(() => String(window.getSelection()))
      if (selected.trim() !== prompt.trim()) throw new Error("the complete prompt is not selected")
    }
    const rejecting = { fn: () => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } }) }
    await check("clipboard_failure_is_stated_with_a_selected_complete_prompt", async () => {
      const { context, page } = await newPage({ width: 390, init: [rejecting] })
      try { await clipboardFailure(page) } finally { await context.close() }
    })
    await check("clipboard_success_copies_exactly_the_shown_prompt", async () => {
      const { context, page } = await newPage({ width: 390, init: [{ fn: () => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve() } } }) }] })
      try {
        await page.route("**/data.json", (r) => r.fulfill({ json: withQueue(privateQueue) }))
        await open(page, contextual)
        const row = page.locator(".improvement-row").first()
        await row.getByRole("button", { name: "Copy as a prompt for your agent", exact: true }).click()
        await page.waitForFunction(() => typeof window.__copied === "string")
        const status = await row.locator('[role="status"]').innerText()
        if (!/Copied/.test(status)) throw new Error(`status after a copy: "${status}"`)
        const copied = await page.evaluate(() => window.__copied)
        const shown = await row.locator("pre").textContent()
        if (copied !== shown) throw new Error("the copied text differs from the shown prompt")
      } finally { await context.close() }
    })
    await check("private_decision_fixture_agrees_across_queue_overview_and_page", async () => {
      const { context, page } = await newPage({ width: 768 })
      try {
        const doc = withQueue(privateQueue)
        await page.route("**/data.json", (r) => r.fulfill({ json: doc }))
        await open(page, ROUTES[0])
        const overviewText = await page.locator("#view-overview").innerText()
        await open(page, ROUTES.find((r) => r.name === "improvements"))
        const rowText = await page.locator(".improvement-row").first().innerText()
        const row = privateQueue.rows[0]
        if (row.availability !== "private_detail_not_published") throw new Error(`fixture availability ${row.availability}`)
        for (const [where, text] of [["overview", overviewText], ["improvements", rowText]]) {
          if (!/Ownership not published/.test(text)) throw new Error(`${where}: owner claimed or missing limitation`)
          if (!/private or not published/i.test(text)) throw new Error(`${where}: private-detail limitation missing`)
        }
        if (!rowText.includes(row.gate_explanation)) throw new Error("gate explanation differs from the queue")
        for (const s of fixture.privacy_sentinels) if ((overviewText + rowText).includes(s)) throw new Error("private sentinel rendered")
        if (/\bDecision:|\bRecommendation:|\bSafe continuation:/.test(rowText)) throw new Error("a specific decision is claimed")
      } finally { await context.close() }
    })
    for (const name of ["equal_revision_conflict", "stale_publication", "empty_never_reviewed"]) {
      await check(`queue_${name}_is_honest`, async () => {
        const { context, page } = await newPage({ width: 390 })
        try {
          const q = queues[name]
          await page.route("**/data.json", (r) => r.fulfill({ json: withQueue(q) }))
          await open(page, ROUTES.find((r) => r.name === "improvements"))
          const text = await page.locator("#view-act").innerText()
          if (name === "empty_never_reviewed") {
            if (!/not (been )?reviewed/i.test(text) || await page.locator(".improvement-row").count()) throw new Error("empty queue not shown as not reviewed")
          } else if (!/cannot support execution/i.test(text) || !/refresh|stale|conflict/i.test(text)) throw new Error("stale or conflicting row presented as ready")
          const problems = await layout(page)
          if (problems.length) throw new Error(JSON.stringify(problems))
          await page.screenshot({ path: join(args.out, `queue-${name}-390.png`) })
          screenshots.push(`queue-${name}-390.png`)
        } finally { await context.close() }
      })
    }

    // 10. Negative controls: each injected defect must make the real check
    // fail on the planted element itself (data-gate-planted), so a defect
    // the page already has can never stand in for the one injected.
    // A route timed on this build or on main (the baseline build), in the
    // kind of page `t` settled in, into its own list. `delay` holds one data
    // file back, for the slowdown controls.
    let mainServer = null
    const timeRoute = async (onMain, t, delay = 0) => {
      if (onMain && !mainServer) { mainServer = await serve(args.baseline); resources.main_server = `http://127.0.0.1:${mainServer.address().port}/` }
      const { context, page } = await newPage({ width: t.width || 1280, height: t.height || 900, scale: t.scale || 1, theme: t.theme || "light" })
      const sink = []
      SINKS.set(page, sink)
      try {
        if (delay) await page.route("**/rollups/causes.json", async (r) => { await new Promise((ok) => setTimeout(ok, delay)); await r.continue() })
        await page.goto((onMain ? resources.main_server : url) + t.where)
        await settle(page, t.view)
      } finally { await context.close() }
      return sink[0].ms
    }
    // A route re-timed twice on this build and on main, alternating, so a
    // spike of load falls on both; the faster of each is kept.
    const retime = async (t, delay = 0, mainDelay = 0) => {
      const here = [], main = []
      for (let i = 0; i < 2; i++) { here.push(await timeRoute(false, t, delay)); main.push(await timeRoute(true, t, mainDelay)) }
      return { ms: Math.min(...here), main_ms: Math.min(...main), load: loadavg() }
    }
    // The re-timing of each navigation over budget that has none yet.
    const retimeOver = async (times) => {
      for (const t of times) if (t.ms > SETTLE_BUDGET_MS && t.after !== "interaction" && !t.altered && !RETIMES.has(settleKey(t))) RETIMES.set(settleKey(t), await retime(t))
    }
    const expectFailure = async (name, fn, mustMatch) => {
      let failed = false, why = ""
      try { await fn() } catch (e) { why = String(e && e.message || e).slice(0, 300); failed = mustMatch.test(why) }
      record(`negative_control_${name}`, failed, failed ? { details: { detected: why } } : { error: why ? `failed for another reason: ${why}` : "the injected defect was not detected" })
    }
    {
      const { context, page } = await newPage({ width: 390 })
      try {
        const compare = ROUTES.find((r) => r.name === "compare")
        const mustBeClean = async (code) => {
          const problems = await layout(page)
          const hit = problems.filter((p) => p.code === code && p.planted)
          if (hit.length) throw new Error(`planted ${code}: ${JSON.stringify(hit.slice(0, 2))}`)
        }
        // Each control starts from a fresh document, so nothing planted earlier remains.
        const openFresh = async () => { await page.goto("about:blank"); await open(page, compare) }
        const plant = (html) => page.evaluate((h) => { const w = document.createElement("div"); w.dataset.gatePlanted = "1"; w.innerHTML = h; document.getElementById("compare-population").appendChild(w) }, html)
        await expectFailure("injected_document_overflow", async () => {
          await openFresh()
          await page.evaluate(() => { const d = document.createElement("div"); d.dataset.gatePlanted = "1"; d.style.cssText = "width:2000px;height:2px"; document.getElementById("view-compare").appendChild(d) })
          await mustBeClean("document_overflow")
        }, /^planted document_overflow/)
        await expectFailure("overflow_hidden_clipping", async () => {
          await openFresh()
          await plant('<div style="overflow:hidden;width:60px"><button style="white-space:nowrap">Clear every selected filter</button></div>')
          await mustBeClean("clipped")
        }, /^planted clipped/)
        await expectFailure("vertical_clipping", async () => {
          await openFresh()
          await plant('<p style="overflow:hidden;height:1.2em;width:120px;line-height:1.2">A label that needs three lines to be read at this width</p>')
          await mustBeClean("clipped_vertical")
        }, /^planted clipped_vertical/)
        await expectFailure("overlapping_labels", async () => {
          await openFresh()
          await page.evaluate(() => {
            const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg")
            s.setAttribute("width", "300"); s.setAttribute("height", "100"); s.setAttribute("aria-label", "injected"); s.setAttribute("data-gate-planted", "1")
            for (const t of ["Overlapping label one", "Overlapping label two"]) { const e = document.createElementNS(ns, "text"); e.setAttribute("x", "10"); e.setAttribute("y", "40"); e.textContent = t; s.appendChild(e) }
            document.getElementById("view-compare").appendChild(s)
          })
          await mustBeClean("overlapping_labels")
        }, /^planted overlapping_labels/)
        await expectFailure("chart_text_out_of_bounds", async () => {
          await openFresh()
          await page.evaluate(() => {
            const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg")
            s.setAttribute("width", "300"); s.setAttribute("height", "100"); s.setAttribute("aria-label", "injected"); s.setAttribute("data-gate-planted", "1")
            const e = document.createElementNS(ns, "text"); e.setAttribute("x", "240"); e.setAttribute("y", "40"); e.textContent = "Still open, cut at the edge"; s.appendChild(e)
            document.getElementById("view-compare").appendChild(s)
          })
          await mustBeClean("chart_text_out_of_bounds")
        }, /^planted chart_text_out_of_bounds/)
        await expectFailure("clipped_text_in_narrow_plot", async () => {
          await page.goto("about:blank")
          await page.goto(url + `#/compare?task=${encodeURIComponent(targets.task)}`)
          await settle(page, "compare")
          const plot = await page.evaluate(() => { const s = document.querySelector("#stackup .sb-plot"); return s ? Math.round(s.getBoundingClientRect().width) : 0 })
          if (!(plot > 0 && plot < 100)) throw new Error(`before planting: the one-task plot is ${plot} px wide, not a narrow plot`)
          await mustBeClean("chart_text_out_of_bounds")
          // A label pushed past the narrow plot's right edge, where the svg clips it.
          await page.evaluate(() => {
            const s = document.querySelector("#stackup .sb-plot"), e = document.createElementNS("http://www.w3.org/2000/svg", "text")
            s.setAttribute("data-gate-planted", "1"); e.setAttribute("x", String(s.getBoundingClientRect().width - 10)); e.setAttribute("y", "60"); e.textContent = "Cut at the edge"; s.appendChild(e)
          })
          await mustBeClean("chart_text_out_of_bounds")
        }, /^planted chart_text_out_of_bounds/)
        await expectFailure("unnamed_link", async () => {
          await openFresh()
          await plant('<a href="#/compare" style="display:inline-block;width:24px;height:24px"></a>')
          await mustBeClean("unnamed_link")
        }, /^planted unnamed_link/)
        await expectFailure("cards_at_wide_screen", async () => {
          await openFresh()
          await page.setViewportSize({ width: 1280, height: 900 })
          try {
            // The page re-lays out after the resize; give it that moment before reading.
            await page.waitForFunction(() => ![...document.querySelectorAll(".stacked")].some((h) => h.getBoundingClientRect().height > 0), null, { timeout: 5000 }).catch(() => {})
            if ((await page.evaluate(findCardTables)).length) throw new Error("cards already shown before planting")
            await plant('<div class="stacked"><table><tbody><tr><td>planted</td></tr></tbody></table></div>')
            const hit = (await page.evaluate(findCardTables)).filter((c) => c.planted)
            if (hit.length) throw new Error(`planted cards at 1280 px: ${hit.length}`)
          } finally { await page.setViewportSize({ width: 390, height: 900 }) }
        }, /^planted cards/)
        await expectFailure("stacked_table_without_roles", async () => {
          await openFresh()
          await plant('<div class="stacked"><table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>planted</td></tr></tbody></table></div>')
          const hit = (await page.evaluate(checkTableRoles)).bad.filter((b) => b.planted)
          if (hit.length) throw new Error(`planted table roles: ${hit.map((b) => b.what).join("; ")}`)
        }, /^planted table roles/)
        await expectFailure("page_height_over_budget", async () => {
          await openFresh()
          const reference = await page.evaluate(() => document.documentElement.scrollHeight)
          if (assessHeights({ compare_390: { site: reference, reference } }, HEIGHT_BUDGET).length) throw new Error("over budget before planting")
          await plant(`<div style="height:${reference}px"></div>`)
          const site = await page.evaluate(() => document.documentElement.scrollHeight)
          const over = assessHeights({ compare_390: { site, reference } }, HEIGHT_BUDGET)
          if (over.length) throw new Error(`planted height: ${over[0]}`)
        }, /^planted height/)
        await expectFailure("conclusion_below_first_screen", async () => {
          await page.goto("about:blank")
          await open(page, ROUTES.find((r) => r.name === "task"))
          const before = assessFirstScreen(await page.evaluate(measureConclusion, CONCLUSIONS.task), 390)
          if (before) throw new Error(`before planting: ${before}`)
          await page.evaluate(() => { const d = document.createElement("div"); d.dataset.gatePlanted = "1"; d.style.height = "1200px"; const head = document.getElementById("task-head"); head.parentNode.insertBefore(d, head) })
          const why = assessFirstScreen(await page.evaluate(measureConclusion, CONCLUSIONS.task), 390)
          if (why) throw new Error(`planted conclusion: ${why}`)
        }, /^planted conclusion/)
        await expectFailure("caveat_in_the_conclusion_place", async () => {
          await page.goto("about:blank")
          await open(page, ROUTES.find((r) => r.name === "task"))
          const before = assessFirstScreen(await page.evaluate(measureConclusion, CONCLUSIONS.task), 390)
          if (before) throw new Error(`before planting: ${before}`)
          // A caveat-marked sentence takes the conclusion's place, ahead of it.
          await page.evaluate(() => { const c = document.querySelector('#view-task [data-role="conclusion"]'); const p = document.createElement("p"); p.dataset.gatePlanted = "1"; p.dataset.role = "caveat"; p.textContent = "Keep the bounds in view before comparing tasks."; c.before(p) })
          const why = assessFirstScreen(await page.evaluate(measureConclusion, CONCLUSIONS.task), 390)
          if (why) throw new Error(`planted caveat: ${why}`)
        }, /^planted caveat: .*caveat/)
        await expectFailure("view_unit_mismatch_on_compare", async () => {
          await openFresh()
          const before = await page.evaluate(compareFigures)
          if (assessViewUnits(before)) throw new Error(`before planting: ${assessViewUnits(before)}`)
          const other = (before.axis || "").toLowerCase().startsWith("hours") ? "Days elapsed" : "Hours elapsed"
          await page.evaluate((t) => { const a = document.querySelector("#stackup .axis-title"); a.dataset.gatePlanted = "1"; a.textContent = t }, other)
          const why = assessViewUnits(await page.evaluate(compareFigures))
          if (why) throw new Error(`planted view unit: ${why}`)
        }, /^planted view unit: the axis in/)
        await expectFailure("task_figure_differs_on_compare", async () => {
          await openFresh()
          const before = assessTaskForms((await page.evaluate(compareFigures)).rows)
          if (before.length) throw new Error(`before planting: ${before[0]}`)
          // One bar's label changes form; its table cell, tooltip and accessible label do not.
          await page.evaluate(() => { const v = [...document.querySelectorAll("#stackup .sb-value")].find((e) => e.textContent.trim()); v.dataset.gatePlanted = "1"; v.textContent = "≥999h" })
          const off = assessTaskForms((await page.evaluate(compareFigures)).rows)
          if (off.length) throw new Error(`planted task figure: ${off[0]}`)
        }, /^planted task figure: .*the (table cell|tooltip|accessible label) reads/)
        await expectFailure("task_lead_differs_from_compare", async () => {
          await page.goto("about:blank")
          await page.goto(url + "#/compare?mode=all")
          await settle(page, "compare")
          const cells = (await page.evaluate(compareFigures)).cellsByJob
          const [job, compare] = Object.entries(cells).find(([, c]) => durationForm(c)) || []
          if (!job) throw new Error("before planting: no Compare lead time")
          await page.goto("about:blank")
          await page.goto(url + `#/task/${encodeURIComponent(job)}`)
          await settle(page, "task")
          const before = assessLeadAgreement([{ job, compare, ...(await page.evaluate(taskLeadFigures)) }])
          if (before.length) throw new Error(`before planting: ${before[0]}`)
          // The caption's number moves; Compare's cell and the accessible label do not.
          await page.evaluate(() => { const t = document.querySelector("#view-task .tw-title"); t.dataset.gatePlanted = "1"; t.textContent = t.textContent.replace(/(\d[\d,]*(?:\.\d+)?)( (?:day|hour|minute|second|millisecond)s?\b)/, (m, n, u) => `${Number(n.replace(/,/g, "")) + 1}${u}`) })
          const off = assessLeadAgreement([{ job, compare, ...(await page.evaluate(taskLeadFigures)) }])
          if (off.length) throw new Error(`planted lead time: ${off[0]}`)
        }, /^planted lead time: .*the task page's caption reads/)
        await expectFailure("bound_before_under_on_task_page", async () => {
          await page.goto("about:blank")
          await page.goto(url + `#/task/${encodeURIComponent(targets.task)}`)
          await settle(page, "task")
          const before = boundsBeforeUnder(await page.evaluate(taskPageTexts))
          if (before.length) throw new Error(`before planting: ${before[0]}`)
          await page.evaluate(() => { const b = document.querySelector("#view-task .tw-bar") || document.getElementById("task-lede"); b.dataset.gatePlanted = "1"; b.setAttribute("aria-label", `${b.getAttribute("aria-label") || ""} (about under a second)`) })
          const bad = boundsBeforeUnder(await page.evaluate(taskPageTexts))
          if (bad.length) throw new Error(`planted bound on a task page: ${bad[0]}`)
        }, /^planted bound on a task page: about under/)
        await expectFailure("share_edge_on_task_page", async () => {
          // A task whose bar has two parts with time: one planted to read 100%.
          const two = (await readTaskPages()).find((r) => r.width === 1280 && r.shares.groups.filter((g) => !/^(?:none|(?:at least |at most |about )?0 seconds)$/.test(g.dur)).length >= 2)
          if (!two) throw new Error("no task page has two groups with time")
          await page.goto("about:blank")
          await page.goto(url + `#/task/${encodeURIComponent(two.job)}`)
          await settle(page, "task")
          const before = assessShareEdges(await page.evaluate(taskShareFigures))
          if (before.length) throw new Error(`before planting: ${before[0]}`)
          await page.evaluate(() => { const h = [...document.querySelectorAll("#view-task .tw-group-head")].find((x) => / · \d+(?:\.\d+)?% of the lead time/.test(x.textContent)); h.dataset.gatePlanted = "1"; for (const n of h.childNodes) if (n.nodeType === 3) n.textContent = n.textContent.replace(/\d+(?:\.\d+)?% of the lead time/, "100% of the lead time") })
          const bad = assessShareEdges(await page.evaluate(taskShareFigures))
          if (bad.length) throw new Error(`planted share edge: ${bad[0]}`)
        }, /^planted share edge: a group of .* reads 100% beside/)
        await expectFailure("share_label_differs_from_words", async () => {
          await page.goto("about:blank")
          await page.goto(url + "#/compare?mode=share")
          await settle(page, "compare")
          const before = assessSharePairs(await page.evaluate(shareModePairs))
          if (before.length) throw new Error(`before planting: ${before[0]}`)
          // One bar's share moves by a point; its flow-efficiency words do not.
          await page.evaluate(() => { const pairs = new Set([...document.querySelectorAll("#view-compare a.chart-link")].map((a) => a.getAttribute("href"))); const a = [...document.querySelectorAll("#view-compare a.sb-col")].find((x) => pairs.has(x.getAttribute("href")) && /: [≥≤~]?\d+% working of a lead time/.test(x.getAttribute("aria-label") || "")); a.dataset.gatePlanted = "1"; a.setAttribute("aria-label", a.getAttribute("aria-label").replace(/: ([≥≤~]?)(\d+)% working/, (m, s, n) => `: ${s}${Number(n) + 1}% working`)) })
          const off = assessSharePairs(await page.evaluate(shareModePairs))
          if (off.length) throw new Error(`planted share label: ${off[0]}`)
        }, /^planted share label: .*: the bar reads/)
        await expectFailure("slow_data_file", async () => {
          // One data file answers 10 s late. The page is timed like any other,
          // into its own list, and pages_settle_within_budget's own body must
          // fail on the run's times with it added.
          const slow = await newPage({ width: 1280 })
          const sink = []
          SINKS.set(slow.page, sink)
          try {
            await slow.page.route("**/rollups/causes.json", async (r) => { await new Promise((ok) => setTimeout(ok, 10000)); await r.continue() })
            await slow.page.goto(url + routeHash(ROUTES.find((x) => x.name === "cause"), targets))
            await settle(slow.page, "cause")
          } finally { await slow.context.close() }
          if (!sink.length) throw new Error("the slow page was not timed")
          // Re-timed like any route over budget, with the file still late.
          await retimeOver(SETTLE_TIMES)
          // The re-timing holds the same file back, so the page's one
          // alteration is replayed and the route is judged on its times.
          const slowed = { ...sink[0], altered: false }
          settleBudget([...SETTLE_TIMES, slowed], SETTLE_BUDGET_MS, new Map([...RETIMES, [settleKey(slowed), await retime(slowed, 10000)]]))
        }, /^1 of \d+ over 5 s: cause \(#\/causes\/[^)]*\) at 1280 px: 1\d\.\d s, re-timed 1\d\.\d s \(main \d+\.\d s\)/)
        await expectFailure("slowdown_3x_over_budget", async () => {
          // Main is held back 2.5 s; this build three times main's time.
          // Re-timed back to back it is still over the budget, and main is
          // not, so it must fail.
          const t = { view: "cause", where: routeHash(ROUTES.find((x) => x.name === "cause"), targets), width: 1280, height: 900, scale: 1, theme: "light", after: "navigation" }
          const main = await timeRoute(true, t, 2500)
          const r = await retime(t, 3 * main, 2500)
          if (r.ms < 3 * r.main_ms) throw new Error(`not a 3x slowdown: ${secs(r.ms)} against main ${secs(r.main_ms)}`)
          settleBudget([{ ...t, ms: r.ms }], SETTLE_BUDGET_MS, new Map([[settleKey(t), r]]))
        }, /^1 of 1 over 5 s: cause \(#\/causes\/[^)]*\) at 1280 px: \d+\.\d s, re-timed \d+\.\d s \(main [2-4]\.\d s\)/)
        await expectFailure("slow_after_action", async () => {
          // A view opened by an action on the page (not a goto) with its data
          // 6 s late. A fast re-timing of its URL must not excuse it.
          const acted = await newPage({ width: 1280 })
          const sink = []
          SINKS.set(acted.page, sink)
          try {
            await acted.page.goto(url + "#/tasks")
            await settle(acted.page, "tasks")
            await acted.page.route("**/*.json", async (r) => { await new Promise((ok) => setTimeout(ok, 6000)); await r.continue() })
            await acted.page.evaluate((job) => { location.hash = `#/task/${job}` }, targets.task)
            await settle(acted.page, "task")
          } finally { await acted.context.close() }
          const t = sink[sink.length - 1]
          if (!t || t.after !== "interaction") throw new Error(`the settle after the action was recorded as ${t ? t.after : "nothing"}`)
          if (sink[0].after !== "navigation") throw new Error(`the settle after the goto was recorded as ${sink[0].after}`)
          if (t.ms <= SETTLE_BUDGET_MS) throw new Error(`the action was not slow: ${secs(t.ms)}`)
          // A goto, then a click that moves the page on, then one settle: the
          // page is no longer where the goto asked, so that is an action too.
          const clicked = await newPage({ width: 1280 })
          const sink2 = []
          SINKS.set(clicked.page, sink2)
          try {
            await clicked.page.goto(url + "#/")
            await clicked.page.waitForSelector('a[href="#/tasks"]')
            await clicked.page.evaluate(() => { location.hash = "#/tasks" })
            await settle(clicked.page, "tasks")
            // A goto that only changes the hash loads nothing, so its settle
            // is an action as well.
            await clicked.page.goto(url + "#/compare")
            await settle(clicked.page, "compare")
          } finally { await clicked.context.close() }
          if (!sink2.length || sink2[0].after !== "interaction") throw new Error(`a settle after a goto and a click was recorded as ${sink2.length ? sink2[0].after : "nothing"}`)
          if (sink2.length < 2 || sink2[1].after !== "interaction") throw new Error(`a settle after a goto that only changed the hash was recorded as ${sink2.length < 2 ? "nothing" : sink2[1].after}`)
          settleBudget([t], SETTLE_BUDGET_MS, new Map([[settleKey(t), { ms: 600, main_ms: 590 }]]))
        }, /^1 of 1 over 5 s: task \(#\/task\/[^)]*\) at 1280 px: \d+\.\d s, after an action on the page, so not re-timed/)
        await expectFailure("loading_marker_never_clears", async () => {
          // A loading marker left in a settled view must keep settle() from passing.
          const stuck = await newPage({ width: 1280 })
          SINKS.set(stuck.page, [])
          try {
            await stuck.page.goto(url + `#/task/${encodeURIComponent(targets.task)}`)
            await settle(stuck.page, "task")
            await stuck.page.evaluate(() => { const n = document.createElement("span"); n.className = "is-loading"; n.dataset.gatePlanted = "1"; n.textContent = "Fetching"; document.getElementById("task-lede").appendChild(n) })
            await settle(stuck.page, "task", 3000)
          } finally { await stuck.context.close() }
        }, /^route never settled: task \(the network was idle, but the view stayed marked as loading\)/)
        await expectFailure("bound_before_under_on_compare", async () => {
          await openFresh()
          const before = boundsBeforeUnder((await page.evaluate(compareFigures)).texts)
          if (before.length) throw new Error(`before planting: ${before[0]}`)
          await page.evaluate(() => { const a = document.querySelector("#stackup a.sb-col"); a.dataset.gatePlanted = "1"; a.setAttribute("aria-label", `${a.getAttribute("aria-label")} (at least under 0.01 days)`) })
          const bad = boundsBeforeUnder((await page.evaluate(compareFigures)).texts)
          if (bad.length) throw new Error(`planted bound: ${bad[0]}`)
        }, /^planted bound: at least under/)
        await expectFailure("overlapping_controls", async () => {
          await openFresh()
          await plant('<div style="position:relative;height:40px"><button style="position:absolute;left:0;top:0;width:120px">First control</button><button style="position:absolute;left:20px;top:4px;width:120px">Second control</button></div>')
          await mustBeClean("overlapping_controls")
        }, /^planted overlapping_controls/)
        await expectFailure("unmarked_scroll_frame", async () => {
          await openFresh()
          await plant('<div style="overflow-x:auto" aria-label="A wide table"><table style="min-width:1200px"><caption>A captioned wide table</caption><tbody><tr><td>wide</td></tr></tbody></table></div>')
          await mustBeClean("sideways_scroll")
        }, /^planted sideways_scroll/)
        await expectFailure("missing_chart_equivalent", async () => {
          await openFresh()
          await page.evaluate(() => { document.getElementById("stackup-table").replaceChildren() })
          const r = await page.evaluate(checkChartEquivalents, CHART_EQUIVALENTS)
          if (r.problems.length) throw new Error(r.problems.join("; "))
        }, /missing_chart_equivalent: stackup/)
      } finally { await context.close() }
    }
    await expectFailure("broken_focus_return", async () => {
      const breakFocus = { fn: () => document.addEventListener("DOMContentLoaded", () => {
        const d = document.getElementById("evidence-drawer")
        if (d) d.addEventListener("close", () => setTimeout(() => { if (document.activeElement) document.activeElement.blur() }, 50))
      }) }
      const { context, page } = await newPage({ width: 1280, init: [breakFocus] })
      try { await drawerCheck(page) } finally { await context.close() }
    }, /focus did not return to the opener/)
    await expectFailure("false_copied_claim", async () => {
      const lie = { fn: () => new MutationObserver((ms) => { for (const m of ms) { const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (n && n.getAttribute && n.getAttribute("role") === "status" && /Copy failed/.test(n.textContent)) n.textContent = "Copied." } }).observe(document, { subtree: true, childList: true, characterData: true }) }
      const { context, page } = await newPage({ width: 390, init: [rejecting, lie] })
      try { await clipboardFailure(page) } finally { await context.close() }
    }, /status after a refused copy/)
    // Every route over budget is re-timed beside main, in this run, for
    // pages_settle_within_budget below.
    await retimeOver(SETTLE_TIMES)
    if (mainServer) await new Promise((resolve) => mainServer.close(resolve))
  } catch (e) {
    record("gate_run", false, { error: String(e && e.stack || e) })
  } finally {
    if (browser) { await browser.close().catch(() => {}); resources.browser_closed = true }
    await new Promise((resolve) => server.close(resolve))
    resources.server_closed = true
  }
  // Every route settled within its budget (a control's page is timed into its own list).
  await check("pages_settle_within_budget", async () => settleBudget(SETTLE_TIMES))
  // An excused route passes, so it is said aloud: a main that stays over
  // budget would otherwise be excused run after run with no one told.
  for (const x of settleExcused(SETTLE_TIMES)) process.stderr.write(excusedWarning(x) + "\n")
  // A run proves every required check and every negative control ran.
  const ran = new Set(cases.map((c) => c.name))
  const missing = [...REQUIRED_CHECKS, ...NEGATIVE_CONTROLS.map((n) => `negative_control_${n}`)].filter((n) => !ran.has(n))
  record("gate_ran_every_required_check", missing.length === 0, missing.length ? { error: `not run: ${missing.join(", ")}` } : { details: { required: REQUIRED_CHECKS.length + NEGATIVE_CONTROLS.length } })
  resources.load_at_end = loadavg()
  const report = {
    passed: cases.filter((c) => c.passed).length,
    failed: cases.filter((c) => !c.passed).length,
    cases,
    screenshots,
    resources,
    site: { path: args.site, digests: await digestSite(args.site) },
    targets: { task: targets.task, session: targets.session, cause: targets.cause },
    contract: { widths: `${WIDTHS[0]}..${WIDTHS[WIDTHS.length - 1]} (${WIDTHS.length})`, themes: THEMES, text_scales: TEXT_SCALES, screenshot_widths: SCREENSHOT_WIDTHS, routes: ROUTES.map((r) => r.name), negative_controls: NEGATIVE_CONTROLS },
  }
  const path = join(args.out, "verify-v12-browser.json")
  await writeFile(path, JSON.stringify(report, null, 2) + "\n")
  await chmod(path, 0o600)
  process.stdout.write(JSON.stringify({ passed: report.passed, failed: report.failed, report: path, resources }) + "\n")
  return report.failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code }, (e) => { process.stderr.write(String(e && e.stack || e) + "\n"); process.exitCode = 1 })
}
