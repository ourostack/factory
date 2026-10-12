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
  "caveat_in_the_conclusion_place", "mixed_units_on_compare",
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
  "compare_uses_one_duration_unit",
])

// Spec 4.5: a wide screen uses its room for information. Against the
// baseline build (the one this release replaces), Compare and Overview at
// normal text may grow at most this much: wrapping that replaces a sideways
// scroll or a cut-off name costs some height on a phone, and almost none on
// a desktop.
export const HEIGHT_BUDGET = Object.freeze({ 1280: 1.15, 390: 1.5 })
export const HEIGHT_ROUTES = Object.freeze(["compare", "overview"])

// Doubled text has its own budget against a fixed reference: the same page
// of the same build at normal text, so neither the baseline nor the data
// moves it. Text alone grows up to four times at doubled size on a phone
// (twice the line height, half the words per line), which bounds these
// multiples from above. The multiples themselves are fitted tripwires, not
// values derived from the spec: each sits just above the tallest page
// measured when it was set (Compare: 3.02x at 390 px, 2.44x at 1280 px), so
// an unrelated change can trip them, and a trip means "look", not "wrong".
export const TEXT2X_HEIGHT_BUDGET = Object.freeze({ 1280: 2.5, 390: 3.25 })

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

// The duration units a set of texts uses: "7 days", "≥7d", "3.6 hours",
// "48m", "under a second". Compare shows one unit per view.
const UNIT_ORDER = ["days", "hours", "minutes", "seconds"]
const UNIT_OF = { d: "days", day: "days", h: "hours", hour: "hours", m: "minutes", minute: "minutes", s: "seconds", second: "seconds" }
export function durationUnitsIn(texts) {
  const found = new Set()
  for (const t of texts || []) {
    const text = String(t || "")
    for (const x of text.matchAll(/\d[\d,]*(?:\.\d+)?\s+(day|hour|minute|second)s?\b/gi)) found.add(UNIT_OF[x[1].toLowerCase()])
    for (const x of text.matchAll(/(?:^|[\s(≥≤~<])\d[\d,]*(?:\.\d+)?([dhms])(?![\w])/g)) found.add(UNIT_OF[x[1]])
    if (/\bunder a second\b/i.test(text)) found.add("seconds")
  }
  return UNIT_ORDER.filter((u) => found.has(u))
}
// A Compare view's problem with its units, or null: one unit in every
// figure, and the axis titled with that unit.
export function assessCompareUnits(r) {
  const units = durationUnitsIn(r && r.texts)
  if (units.length > 1) return `mixes units: ${units.join(", ")}`
  const axis = r && r.axis ? String(r.axis).split(/\s+/)[0].toLowerCase() : null
  if (units.length === 1 && axis && UNIT_ORDER.includes(axis) && axis !== units[0]) return `the axis is in ${axis}, the figures in ${units[0]}`
  return null
}
// Runs in the page: Compare's duration texts and its axis title.
export function compareDurationTexts() {
  const texts = [...document.querySelectorAll('#comparison-conclusion, #stackup .sb-value, #stackup .clock-exposure, #stackup td.num, #stackup-left-out, #stackup-table td.num, #stackup-table .sb-table td:nth-child(7)')].map((e) => e.textContent.trim()).filter(Boolean)
  const axis = document.querySelector("#stackup .axis-title")
  return { texts, axis: axis ? axis.textContent.trim() : null }
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
  // Labels drawn on top of each other inside one chart.
  for (const svg of charts) {
    if (!shown(svg)) continue
    const sr = svg.getBoundingClientRect()
    if (sr.width < 100 || sr.height < 50) continue
    const texts = [...svg.querySelectorAll("text")].filter((t) => (t.textContent || "").trim() && getComputedStyle(t).visibility !== "hidden" && getComputedStyle(t).display !== "none" && Number(getComputedStyle(t).opacity) > 0)
      .map((t) => ({ t: t.textContent.trim().slice(0, 30), r: t.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.height > 0)
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
    frames, clipped: clipped.slice(0, 20), clippedY: clippedY.slice(0, 20), offscreen: offscreen.slice(0, 20), overlaps, controlOverlaps, chartTextOut, unnamedLinks }
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
function textScaleInit(scale) {
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

async function settle(page, view, timeout = 20000) {
  await page.waitForFunction((v) => document.body.dataset.view === v && !document.getElementById(`view-${v}`).hidden, view, { timeout })
  const start = Date.now()
  let last = -1
  while (Date.now() - start < timeout) {
    const now = await page.evaluate((v) => {
      const el = document.getElementById(`view-${v}`)
      return el.textContent.includes("Loading…") ? -2 : el.innerHTML.length
    }, view)
    if (now === last && now >= 0) return true
    last = now
    await page.waitForTimeout(300)
  }
  throw new Error(`route never settled: ${view}`)
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.error) { process.stderr.write(args.error + "\n"); return 2 }
  await mkdir(args.out, { recursive: true })
  const cases = [], screenshots = []
  const resources = { pid: process.pid, server: null, server_closed: false, browser_closed: false }
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
          const heights = {}
          for (const width of Object.keys(TEXT2X_HEIGHT_BUDGET).map(Number)) {
            for (const scale of [1, 2]) {
              const { context, page } = await newPage({ width, height: 900, scale })
              try {
                for (const name of HEIGHT_ROUTES) {
                  const h = await height(page, url, ROUTES.find((r) => r.name === name))
                  const k = `${name}_${width}`
                  heights[k] = { ...heights[k], [scale === 1 ? "reference" : "site"]: h }
                }
              } finally { await context.close() }
            }
          }
          const over = assessHeights(heights, TEXT2X_HEIGHT_BUDGET)
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
    await check("compare_uses_one_duration_unit", async () => {
      // The lead sentence, bar labels, sums and tables of each Compare view
      // read in one unit, and the axis is titled with it.
      const { context, page } = await newPage({ width: 1280 })
      const seen = {}
      try {
        for (const mode of ["all", "working", "production", "request"]) {
          await page.goto(url + `#/compare?mode=${mode}`)
          await settle(page, "compare")
          const r = await page.evaluate(compareDurationTexts)
          const why = assessCompareUnits(r)
          if (why) throw new Error(`${mode}: ${why}`)
          seen[mode] = { units: durationUnitsIn(r.texts), axis: r.axis, texts: r.texts.length }
        }
      } finally { await context.close() }
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
        await expectFailure("unnamed_link", async () => {
          await openFresh()
          await plant('<a href="#/compare" style="display:inline-block;width:24px;height:24px"></a>')
          await mustBeClean("unnamed_link")
        }, /^planted unnamed_link/)
        await expectFailure("cards_at_wide_screen", async () => {
          await openFresh()
          await page.setViewportSize({ width: 1280, height: 900 })
          try {
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
        await expectFailure("mixed_units_on_compare", async () => {
          await openFresh()
          const before = assessCompareUnits(await page.evaluate(compareDurationTexts))
          if (before) throw new Error(`before planting: ${before}`)
          const units = durationUnitsIn((await page.evaluate(compareDurationTexts)).texts)
          const other = units[0] === "hours" ? "3 days" : "3.6 hours"
          await page.evaluate((t) => { const s = document.createElement("span"); s.dataset.gatePlanted = "1"; s.textContent = ` (${t})`; document.getElementById("comparison-conclusion").appendChild(s) }, other)
          const why = assessCompareUnits(await page.evaluate(compareDurationTexts))
          if (why) throw new Error(`planted units: ${why}`)
        }, /^planted units: mixes/)
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
  } catch (e) {
    record("gate_run", false, { error: String(e && e.stack || e) })
  } finally {
    if (browser) { await browser.close().catch(() => {}); resources.browser_closed = true }
    await new Promise((resolve) => server.close(resolve))
    resources.server_closed = true
  }
  // A run proves every required check and every negative control ran.
  const ran = new Set(cases.map((c) => c.name))
  const missing = [...REQUIRED_CHECKS, ...NEGATIVE_CONTROLS.map((n) => `negative_control_${n}`)].filter((n) => !ran.has(n))
  record("gate_ran_every_required_check", missing.length === 0, missing.length ? { error: `not run: ${missing.join(", ")}` } : { details: { required: REQUIRED_CHECKS.length + NEGATIVE_CONTROLS.length } })
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
