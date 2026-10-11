#!/usr/bin/env node
// The factory site's rendered-browser gate (v1.2, internal task 13U).
//
//   node site/scripts/verify-v12-browser.mjs --site <absolute-dist> \
//     --out <protected-dir> --playwright-module <absolute-module>
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

export const NEGATIVE_CONTROLS = Object.freeze([
  "injected_document_overflow", "overflow_hidden_clipping", "overlapping_labels",
  "missing_chart_equivalent", "broken_focus_return", "false_copied_claim",
])

const USAGE = "usage: node site/scripts/verify-v12-browser.mjs --site <absolute-dist> --out <protected-dir> --playwright-module <absolute-module>"

// --------------------------------------------------------------- layout

// Problems in one layout measurement. The document may never be wider than
// the viewport (one pixel of rounding is tolerated). An element may scroll
// sideways only as a labeled precision frame that itself stays inside the
// viewport; that never excuses document overflow.
export function assessLayout(m) {
  const problems = []
  const limit = m.doc.clientWidth + 1
  if (m.doc.scrollWidth > limit || m.doc.bodyScrollWidth > limit) problems.push({ code: "document_overflow", detail: `${Math.max(m.doc.scrollWidth, m.doc.bodyScrollWidth)} > ${m.doc.clientWidth}` })
  for (const f of m.frames || []) {
    if (!f.labelled) problems.push({ code: "frame_unlabelled", detail: f.el })
    if (!f.bounded) problems.push({ code: "frame_unbounded", detail: f.el })
  }
  for (const c of m.clipped || []) problems.push({ code: "clipped", detail: `${c.el}: ${c.text || ""}`.trim() })
  for (const c of m.offscreen || []) problems.push({ code: "offscreen_control", detail: c.el })
  for (const o of m.overlaps || []) problems.push({ code: "overlapping_labels", detail: `${o.chart}: "${o.a}" / "${o.b}"` })
  return problems
}

// Runs in the page. Cached element lists are refreshed on request, or when
// a chart redraw replaced a cached element.
export function measureLayout(opts) {
  const refresh = !!(opts && opts.refresh)
  const vw = document.documentElement.clientWidth
  const viewEl = document.getElementById(`view-${document.body.dataset.view}`)
  const own = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "")
  const name = (e) => { const anchor = e.parentElement && e.parentElement.closest("[id]"); return own(e) + (anchor && !e.id ? ` in #${anchor.id}` : "") }
  const hiddenStyle = (cs) => cs.display === "none" || cs.visibility === "hidden" || (cs.clipPath && cs.clipPath !== "none") || (cs.clip && cs.clip !== "auto")
  const shown = (e) => {
    if (!e.isConnected) return false
    const r = e.getBoundingClientRect()
    if (r.width <= 2 || r.height <= 2) return false
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (hiddenStyle(cs) || n.hidden) return false
      if (n.tagName === "DETAILS" && !n.open && n !== e && !e.closest("summary")) return false
    }
    return true
  }
  let cache = window.__gateLayout
  if (refresh || !cache || cache.items.some((e) => !e.isConnected)) {
    const all = [...document.body.querySelectorAll("*")]
    const scrollers = [], hiders = [], controls = [], charts = []
    for (const e of all) {
      const cs = getComputedStyle(e)
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") scrollers.push(e)
      else if ((cs.overflowX === "hidden" || cs.overflowX === "clip" || cs.textOverflow === "ellipsis") && !hiddenStyle(cs)) hiders.push(e)
      if (/^(BUTTON|A|SELECT|INPUT|SUMMARY|LABEL|TH|TD|LI|DT|DD|H1|H2|H3|P)$/.test(e.tagName)) controls.push(e)
      if (e.tagName === "svg" && viewEl && viewEl.contains(e)) charts.push(e)
    }
    cache = window.__gateLayout = { scrollers, hiders, controls, charts, items: [...scrollers, ...hiders, ...charts] }
  }
  const frames = [], clipped = [], offscreen = [], overlaps = []
  const frameOf = (e) => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) if (cache.scrollers.includes(n)) return n; return null }
  for (const e of cache.scrollers) {
    if (!shown(e) || e.scrollWidth <= e.clientWidth + 1) continue
    const r = e.getBoundingClientRect()
    const labelled = !!(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") ||
      e.querySelector("svg[aria-label], svg[aria-labelledby], table > caption, table[aria-label], table[aria-labelledby]"))
    frames.push({ el: name(e), labelled, bounded: r.left >= -1 && r.right <= vw + 1 })
  }
  // Content cut by its own overflow: hidden (or an ellipsis).
  for (const e of cache.hiders) {
    if (!shown(e) || !(e.textContent || "").trim()) continue
    if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 2) clipped.push({ el: name(e), text: e.textContent.trim().slice(0, 40) })
  }
  // A control or label cut by an ancestor, or pushed out of the viewport.
  for (const e of cache.controls) {
    if (!shown(e)) continue
    const r = e.getBoundingClientRect()
    const frame = frameOf(e)
    let cut = false
    for (let n = e.parentElement; n && n !== document.body && n !== frame; n = n.parentElement) {
      if (!cache.hiders.includes(n) || n.scrollWidth <= n.clientWidth + 1) continue
      const p = n.getBoundingClientRect()
      if (r.right > p.right + 1 || r.left < p.left - 1) { clipped.push({ el: name(e), text: (e.textContent || "").trim().slice(0, 40) }); cut = true; break }
    }
    if (cut) continue
    // A skip link waits entirely off screen until it has focus: hidden, not clipped.
    const parked = /^(absolute|fixed)$/.test(getComputedStyle(e).position) && (r.right <= 0 || r.left >= vw)
    if (!frame && !parked && (r.right > vw + 1 || r.left < -1)) offscreen.push({ el: name(e) })
  }
  // Labels drawn on top of each other inside one chart.
  for (const svg of cache.charts) {
    if (!shown(svg)) continue
    const sr = svg.getBoundingClientRect()
    if (sr.width < 100 || sr.height < 50) continue
    const texts = [...svg.querySelectorAll("text")].filter((t) => (t.textContent || "").trim() && getComputedStyle(t).visibility !== "hidden" && getComputedStyle(t).display !== "none" && Number(getComputedStyle(t).opacity) > 0)
      .map((t) => ({ t: t.textContent.trim().slice(0, 30), r: t.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.height > 0)
    for (let i = 0; i < texts.length && overlaps.length < 20; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].r, b = texts[j].r
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (w > 2 && h > 2 && w * h > 0.2 * Math.min(a.width * a.height, b.width * b.height)) {
          overlaps.push({ chart: (svg.closest("[id]") || svg).id || "chart", a: texts[i].t, b: texts[j].t })
        }
      }
    }
  }
  return { width: vw, doc: { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, bodyScrollWidth: document.body.scrollWidth }, frames, clipped: clipped.slice(0, 20), offscreen: offscreen.slice(0, 20), overlaps }
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
    const rows = eq ? eq.querySelectorAll("tbody tr, tr, li").length : 0
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
    if (!["--site", "--out", "--playwright-module"].includes(k) || typeof v !== "string") return { error: USAGE }
    args[k.slice(2)] = v
  }
  for (const k of ["site", "out", "playwright-module"]) if (!args[k] || !isAbsolute(args[k])) return { error: `${USAGE}\n--${k} must be an absolute path` }
  if (insideGitWorkTree(args.out)) return { error: `--out must be outside any Git work tree (screenshots and reports are not committed): ${args.out}` }
  if (!existsSync(join(args.site, "index.html")) || !existsSync(join(args.site, "data.json"))) return { error: `--site must be a built site with index.html and data.json: ${args.site}` }
  return { site: normalize(args.site), out: normalize(args.out), playwright: args["playwright-module"] }
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
    await check("storage_denied_keeps_the_site_usable", async () => {
      const { context, page } = await newPage({ width: 390, init: [{ fn: () => Object.defineProperty(window, "localStorage", { get() { throw new Error("denied") } }) }] })
      try {
        await open(page, ROUTES[0])
        const status = await page.locator("#preferences-status").innerText()
        if (!/not saved|unavailable/i.test(status)) throw new Error(`preferences status: ${status}`)
        await page.getByRole("link", { name: "Tasks", exact: true }).first().click()
        await settle(page, "tasks")
      } finally { await context.close() }
    })
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
    await check("production_and_request_modes_are_unavailable_not_relabelled", async () => {
      const { context, page } = await newPage({ width: 768 })
      try {
        for (const mode of ["production", "request"]) {
          await page.goto(url + `#/compare?mode=${mode}`)
          await settle(page, "compare")
          if (!/unavailable/i.test(await page.locator("#stackup").innerText())) throw new Error(`${mode} not marked unavailable`)
          if (await page.locator("#stackup .sb-col").count()) throw new Error(`${mode} draws legacy bars`)
        }
      } finally { await context.close() }
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

    // 10. Negative controls: each injected defect must make the real check fail.
    const expectFailure = async (name, fn) => {
      let failed = false, why = ""
      try { await fn() } catch (e) { failed = true; why = String(e && e.message || e).slice(0, 300) }
      record(`negative_control_${name}`, failed, failed ? { details: { detected: why } } : { error: "the injected defect was not detected" })
    }
    {
      const { context, page } = await newPage({ width: 390 })
      try {
        const compare = ROUTES.find((r) => r.name === "compare")
        const mustBeClean = async (codes) => {
          const problems = await layout(page)
          const hit = problems.filter((p) => codes.includes(p.code))
          if (hit.length) throw new Error(JSON.stringify(hit.slice(0, 3)))
        }
        await expectFailure("injected_document_overflow", async () => {
          await open(page, compare)
          await page.evaluate(() => { const d = document.createElement("div"); d.style.cssText = "width:2000px;height:2px"; document.getElementById("view-compare").appendChild(d) })
          await mustBeClean(["document_overflow"])
        })
        await expectFailure("overflow_hidden_clipping", async () => {
          await open(page, compare)
          await page.evaluate(() => { const w = document.createElement("div"); w.style.cssText = "overflow:hidden;width:60px"; const b = document.createElement("button"); b.style.whiteSpace = "nowrap"; b.textContent = "Clear every selected filter"; w.appendChild(b); document.getElementById("compare-population").appendChild(w) })
          await mustBeClean(["clipped"])
        })
        await expectFailure("overlapping_labels", async () => {
          await open(page, compare)
          await page.evaluate(() => {
            const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg")
            s.setAttribute("width", "300"); s.setAttribute("height", "100"); s.setAttribute("aria-label", "injected")
            for (const t of ["Overlapping label one", "Overlapping label two"]) { const e = document.createElementNS(ns, "text"); e.setAttribute("x", "10"); e.setAttribute("y", "40"); e.textContent = t; s.appendChild(e) }
            document.getElementById("view-compare").appendChild(s)
          })
          await mustBeClean(["overlapping_labels"])
        })
        await expectFailure("missing_chart_equivalent", async () => {
          await open(page, compare)
          await page.evaluate(() => { document.getElementById("stackup-table").replaceChildren() })
          const r = await page.evaluate(checkChartEquivalents, CHART_EQUIVALENTS)
          if (r.problems.length) throw new Error(r.problems.join("; "))
        })
      } finally { await context.close() }
    }
    await expectFailure("broken_focus_return", async () => {
      const breakFocus = { fn: () => document.addEventListener("DOMContentLoaded", () => {
        const d = document.getElementById("evidence-drawer")
        if (d) d.addEventListener("close", () => setTimeout(() => { if (document.activeElement) document.activeElement.blur() }, 50))
      }) }
      const { context, page } = await newPage({ width: 1280, init: [breakFocus] })
      try { await drawerCheck(page) } finally { await context.close() }
    })
    await expectFailure("false_copied_claim", async () => {
      const lie = { fn: () => new MutationObserver((ms) => { for (const m of ms) { const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (n && n.getAttribute && n.getAttribute("role") === "status" && /Copy failed/.test(n.textContent)) n.textContent = "Copied." } }).observe(document, { subtree: true, childList: true, characterData: true }) }
      const { context, page } = await newPage({ width: 390, init: [rejecting, lie] })
      try { await clipboardFailure(page) } finally { await context.close() }
    })
  } catch (e) {
    record("gate_run", false, { error: String(e && e.stack || e) })
  } finally {
    if (browser) { await browser.close().catch(() => {}); resources.browser_closed = true }
    await new Promise((resolve) => server.close(resolve))
    resources.server_closed = true
  }
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
