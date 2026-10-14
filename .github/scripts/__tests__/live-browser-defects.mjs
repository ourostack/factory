// Run explicitly against a real published-data build; no package is installed.
// node .github/scripts/__tests__/live-browser-defects.mjs <dist> <playwright ESM> <protected output>
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { assessLayout, measureLayout, checkChartEquivalents, CHART_EQUIVALENTS, compareFigures, assessTaskForms, textScaleInit, parseArgs } from "../../../site/scripts/verify-v12-browser.mjs"

const [siteArg, moduleArg, outArg] = process.argv.slice(2)
assert.ok(siteArg && moduleArg && outArg, "dist, existing Playwright ESM and protected output are required")
const site = resolve(siteArg), out = resolve(outArg)
const safe = parseArgs(["--site", site, "--baseline-site", site, "--out", out, "--playwright-module", resolve(moduleArg)])
assert.ok(!safe.error, safe.error)
await mkdir(out, { recursive: true })
const created = []
const save = async (name, data) => {
  const path = join(out, name)
  created.push(path)
  await writeFile(path, data)
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }
const results = []
const resources = { pid: process.pid, started: new Date().toISOString(), launch_log: [], processes: [], browser_closed: false, server_closed: false }
function processGenerations() {
  const rows = execFileSync("ps", ["-axo", "pid,ppid,lstart"], { encoding: "utf8" }).split("\n").slice(1).filter((l) => l.trim()).map((l) => {
    const p = l.trim().split(/\s+/)
    return { pid: Number(p[0]), ppid: Number(p[1]), started: p.slice(2).join(" ") }
  })
  const owned = new Set([process.pid])
  for (let changed = true; changed;) {
    changed = false
    for (const p of rows) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true }
  }
  return rows.filter((p) => p.pid !== process.pid && owned.has(p.pid))
}
function recordProcesses() {
  for (const p of processGenerations()) if (!resources.processes.some((x) => x.pid === p.pid && x.started === p.started)) resources.processes.push(p)
}
const server = createServer(async (req, res) => {
  try {
    const path = resolve(site, "." + (new URL(req.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(req.url, "http://localhost").pathname))
    assert.ok(path.startsWith(site + sep))
    const body = await readFile(path)
    res.writeHead(200, { "Content-Type": types[extname(path)] || "text/plain" })
    if (process.env.FACTORY_BROWSER_SETUP_FAILURE === "headers_sent") throw new Error("Injected post-header server exception")
    res.end(body)
  } catch (error) {
    if (error.code !== "ENOENT") results.push({ name: "harness_server_exception", passed: false, error: error.message })
    if (res.headersSent) res.destroy(error)
    else { res.writeHead(error.code === "ENOENT" ? 404 : 500); res.end("not found") }
  }
})
let browser = null, base = null
const task = "800163a15783a69bceaf189f60d686fd", session = "c2a25a10-d203-4cb5-82d0-02195923a8d8"
async function loaded(page, hash, selector) {
  await page.goto(base + hash)
  await page.waitForSelector(selector)
  await page.waitForFunction(() => ![...document.querySelectorAll(".loading")].some((e) => e.getBoundingClientRect().height > 0))
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}
const check = (name, fn) => {
  try { fn(); results.push({ name, passed: true }) }
  catch (e) { results.push({ name, passed: false, error: e.message }) }
}
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  base = `http://127.0.0.1:${server.address().port}/`
  resources.server = base
  const { chromium } = await import(pathToFileURL(resolve(moduleArg)))
  browser = await chromium.launch({ headless: true, logger: {
    isEnabled: () => true,
    log: (name, severity, message) => resources.launch_log.push({ name, severity, message }),
  } })
  recordProcesses()
  if (process.env.FACTORY_BROWSER_SETUP_FAILURE === "after_launch") throw new Error("Injected setup exception after browser launch")
  for (const theme of ["light", "dark"]) for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1028, height: 900 }, colorScheme: theme })
    await context.addInitScript(textScaleInit, scale)
    const page = await context.newPage()
    for (const width of [1028, 1027, 822, 781]) {
      await page.setViewportSize({ width, height: 900 })
      await loaded(page, `#/task/${task}`, "#vsm button")
      const layout = assessLayout(await page.evaluate(measureLayout, { refresh: true }))
      const offenders = await page.evaluate(() => [...document.querySelectorAll("#view-task *")].map((e) => {
        const r = e.getBoundingClientRect()
        return { tag: e.tagName, cls: e.className, text: e.textContent.slice(0, 90), left: r.left, right: r.right, width: r.width }
      }).filter((r) => r.width && r.right > innerWidth + 1))
      results.push({ name: `diagnostic_${theme}_${scale}_${width}`, layout, offenders })
      check(`task_layout_${theme}_${scale}_${width}`, () => assert.deepEqual(layout, []))
    }
    if (scale === 1) {
      const path = join(out, `task-${theme}-1028.png`); created.push(path)
      await page.setViewportSize({ width: 1028, height: 900 })
      await loaded(page, `#/task/${task}`, "#vsm button")
      await page.screenshot({ path, fullPage: true })
    }
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await loaded(page, `#/task/${task}/session/${session}`, "#swimlane svg")
  const charts = await page.evaluate(checkChartEquivalents, CHART_EQUIVALENTS)
  check("real_unlabeled_session_has_accessible_activity", () => assert.deepEqual(charts.problems, []))
  const activity = await page.locator("#swimlane .lane-activity-table tbody tr").count()
  check("activity_equivalent_keeps_all_202_published_intervals", () => assert.equal(activity, 202))
  const path = join(out, "session-1280.png"); created.push(path); await page.screenshot({ path, fullPage: true })
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await loaded(page, `#/task/${task}/session/${session}`, "#swimlane svg")
    await page.locator("#swimlane details:has(.lane-activity-table) > summary").click()
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.locator("#swimlane .lane-activity-table").scrollIntoViewIfNeeded()
    const row = await page.locator("#swimlane .lane-activity-table tbody tr").first().innerText()
    check(`activity_equivalent_names_real_first_event_${width}`, () => {
      assert.match(row, /Main agent/)
      assert.match(row, /turn/)
      assert.match(row, /Not recorded/)
    })
    const layout = assessLayout(await page.evaluate(measureLayout, { refresh: true }))
    check(`activity_equivalent_is_readable_without_overflow_${width}`, () => assert.deepEqual(layout, []))
    const path = join(out, `session-activity-${width}.png`); created.push(path); await page.screenshot({ path })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await loaded(page, "#/compare?mode=working", "#stackup a.sb-col")
  const figures = await page.evaluate(compareFigures)
  const row = figures.rows.find((r) => r.job === "21ed3b3de83c2e8c51bf457535c25f7f")
  check("open_working_bar_keeps_lower_bound", () => assert.match(row.label, /^≥4m 47s$/))
  check("all_working_figures_agree", () => assert.deepEqual(assessTaskForms(figures.rows), []))
  await context.close()

  // Each control removes one fix from the served source, not from the
  // repository or retained artifact, and must reproduce its own defect.
  const app = await readFile(join(site, "app.js"), "utf8")
  const steps = await readFile(join(site, "steps.js"), "utf8")
  const mutations = [
    { name: "removing_column_fit_recreates_overflow", file: "app.js", source: app.replace("if (!phone && minimumWidth > width)", "if (false)"), hash: `#/task/${task}`, selector: "#vsm button", width: 1028,
      verify: async (p) => assert.ok(assessLayout(await p.evaluate(measureLayout, { refresh: true })).some((x) => x.code === "document_overflow")) },
    { name: "removing_activity_equivalent_recreates_missing_chart", file: "app.js", source: app.replace("if (intervals.length) {", "if (false) {"), hash: `#/task/${task}/session/${session}`, selector: "#swimlane svg", width: 1280,
      verify: async (p) => assert.ok((await p.evaluate(checkChartEquivalents, CHART_EQUIVALENTS)).problems.includes("missing_chart_equivalent: swimlane")) },
    { name: "removing_short_bound_recreates_figure_disagreement", file: "steps.js", source: steps.replace('const b = totalBound(n);\n    const round =', 'const b = open ? null : totalBound(n);\n    const round ='), hash: "#/compare?mode=working", selector: "#stackup a.sb-col", width: 1280,
      verify: async (p) => assert.ok(assessTaskForms((await p.evaluate(compareFigures)).rows).some((x) => x.includes("21ed3b3de83c2e8c51bf457535c25f7f"))) },
  ]
  for (const mutant of mutations) {
    const ctx = await browser.newContext({ viewport: { width: mutant.width, height: 900 } })
    await ctx.route(`**/${mutant.file}`, (route) => route.fulfill({ contentType: "text/javascript", body: mutant.source }))
    const p = await ctx.newPage()
    try {
      assert.notEqual(mutant.source, mutant.file === "app.js" ? app : steps, "the source mutation must actually remove the fix")
      await loaded(p, mutant.hash, mutant.selector)
      await mutant.verify(p)
      results.push({ name: mutant.name, passed: true })
    } catch (e) { results.push({ name: mutant.name, passed: false, error: e.message }) }
    await ctx.close()
  }
} catch (error) {
  results.push({ name: "harness_exception", passed: false, error: error.message })
} finally {
  recordProcesses()
  if (browser) {
    try { await browser.close() }
    catch (error) { results.push({ name: "harness_browser_close", passed: false, error: error.message }) }
  }
  if (server.listening) await new Promise((r) => server.close(r))
  resources.server_closed = !server.listening
  resources.browser_closed = !browser || !browser.isConnected()
  const current = execFileSync("ps", ["-axo", "pid,lstart"], { encoding: "utf8" }).split("\n").slice(1).filter((l) => l.trim()).map((l) => {
    const p = l.trim().split(/\s+/); return { pid: Number(p[0]), started: p.slice(1).join(" ") }
  })
  resources.remaining_same_generation = resources.processes.filter((p) => current.some((x) => x.pid === p.pid && x.started === p.started))
  check("owned_browser_and_server_generation_closed", () => {
    assert.ok(resources.browser_closed && resources.server_closed)
    assert.deepEqual(resources.remaining_same_generation, [])
  })
  await save("resources.json", JSON.stringify(resources, null, 2))
  await save("results.json", JSON.stringify({ results, created, server_closed: resources.server_closed, browser_closed: resources.browser_closed, resources }, null, 2))
  console.log(JSON.stringify({ failed: results.filter((r) => r.passed === false).length, created }))
}
process.exitCode = results.some((r) => r.passed === false) ? 1 : 0
