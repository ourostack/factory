// Run explicitly against a real published-data build; no package is installed.
// node .github/scripts/__tests__/live-browser-defects.mjs <dist> <playwright ESM> <protected output>
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { runInNewContext } from "node:vm"
import { assessLayout, measureLayout, checkChartEquivalents, CHART_EQUIVALENTS, compareFigures, assessTaskForms, textScaleInit, parseArgs, ROUTES } from "../../../site/scripts/verify-v12-browser.mjs"

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
  const denseTask = "eaa7a23cb71326d0aa5e8d2fb3b350c8"
  const denseHash = `#/task/${denseTask}`
  const denseResults = []
  const actualCheck = async (name, fn) => {
    try { const details = await fn(); results.push({ name, passed: true }); denseResults.push({ name, details }) }
    catch (error) { results.push({ name, passed: false, error: error.message }); denseResults.push({ name, error: error.message }) }
  }
  for (const [width, scale] of [[722, 2], [736, 2], [768, 2], [1060, 1]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(textScaleInit, scale)
    const page = await context.newPage()
    try {
      await actualCheck(`actual_dense_task_fresh_${width}_text${scale}x`, async () => {
        await loaded(page, denseHash, "#vsm .vsm-box")
        await page.locator("#vsm .vsm").evaluate((n) => n.scrollIntoView({ block: "start" }))
        await page.screenshot({ path: join(out, `dense-visible-${width}-text${scale}x.png`) })
        const problems = assessLayout(await page.evaluate(measureLayout, { refresh: true }))
        assert.deepEqual(problems, [])
        return { width, scale, items: await page.locator("#vsm .vsm-box, #vsm .vsm-wait").count() }
      })
    } finally { await context.close() }
  }
  for (const [from, to, scale] of [[1099, 1060, 1], [768, 722, 2]]) {
    const context = await browser.newContext({ viewport: { width: from, height: 900 } })
    await context.addInitScript(textScaleInit, scale)
    const page = await context.newPage()
    try {
      await actualCheck(`actual_dense_task_pixel_resize_${from}_${to}_text${scale}x`, async () => {
        await loaded(page, denseHash, "#vsm .vsm-box")
        const failures = []
        const labels = await page.locator("#vsm .vsm-box, #vsm .vsm-wait").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")))
        for (let width = from; width >= to; width--) {
          await page.setViewportSize({ width, height: 900 })
          await page.waitForTimeout(300)
          const problems = assessLayout(await page.evaluate(measureLayout, { refresh: true }))
          if (problems.length) failures.push({ width, problems })
          assert.deepEqual(await page.locator("#vsm .vsm-box, #vsm .vsm-wait").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))), labels)
        }
        assert.deepEqual(failures, [])
        return { from, to, scale, labels }
      })
    } finally { await context.close() }
  }
  const nativeSource = await readFile(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url), "utf8")
  const drawerStart = nativeSource.indexOf('const drawerCheck = async (page, key = "Enter", nth = 0) => {')
  const drawerEnd = nativeSource.indexOf("\n    {\n      const { context, page } = await newPage({ width: 1280 })", drawerStart)
  assert.ok(drawerStart >= 0 && drawerEnd > drawerStart)
  const nativeDrawerCheck = runInNewContext(`(${nativeSource.slice(drawerStart, drawerEnd).trim().replace("const drawerCheck = ", "")})`, {
    ROUTES,
    open: async (page) => { await page.goto("about:blank"); await loaded(page, denseHash, "#vsm .vsm-box") },
  })
  for (const key of ["Enter", "Space"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    try {
      await actualCheck(`actual_dense_task_native_keyboard_${key}`, async () => {
        await nativeDrawerCheck(page, key)
        return { key, url: page.url(), active: await page.evaluate(() => document.activeElement.outerHTML) }
      })
    } finally { await context.close() }
  }
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    try {
      await actualCheck("actual_dense_task_unknown_prompt_does_not_invent_burst_selection", async () => {
        await loaded(page, denseHash, "#vsm .vsm-box")
        const prompt = page.locator('#vsm .vsm-op.why-not_known[aria-label$="Opens the evidence."]').first()
        assert.ok(await prompt.count(), "actual unknown-reason prompt must remain available")
        await prompt.focus()
        await page.keyboard.press("Enter")
        await page.waitForSelector("#evidence-drawer[open]")
        assert.equal(new URL(page.url()).hash.includes("selection="), false)
        assert.match(await page.locator("#drawer-body").textContent(), /Operator prompt/)
        await page.keyboard.press("Escape")
        await page.waitForFunction(() => !document.getElementById("evidence-drawer").open)
        return { prompt: await prompt.getAttribute("aria-label") }
      })
      await actualCheck("actual_dense_task_unavailable_selection_preserves_unknown_figures_and_no_substitute", async () => {
        await loaded(page, denseHash, "#vsm .vsm-box")
        let last = 0
        const count = await page.locator("#vsm .vsm-box").count()
        for (let index = 0; index < count; index++) {
          await page.locator("#vsm .vsm-box").nth(index).click()
          await page.waitForSelector("#evidence-drawer[open]")
          const selection = new URLSearchParams(page.url().split("?")[1]).get("selection")
          last = Math.max(last, ...selection.slice("bursts:".length).split("-").map(Number))
          assert.match(await page.locator("#drawer-body").textContent(), /not labeled/)
          await page.keyboard.press("Escape")
          await page.waitForFunction(() => !document.getElementById("evidence-drawer").open)
        }
        assert.ok(last > 0)
        await page.goto("about:blank")
        await loaded(page, denseHash + `?selection=${encodeURIComponent(`bursts:${last + 1}`)}`, ".selection-unavailable")
        assert.match(await page.locator(".selection-unavailable").textContent(), /No substitute item was selected/)
        assert.equal(await page.locator("#evidence-drawer[open]").count(), 0)
        return { requested_unavailable_burst: last + 1 }
      })
    } finally { await context.close() }
  }
  await save("actual-dense-contract.json", JSON.stringify(denseResults, null, 2))
  const groupingContext = await browser.newContext({ viewport: { width: 320, height: 900 } })
  const groupingPage = await groupingContext.newPage()
  const grouping = []
  try {
    for (const width of [320, 390, 768, 1028, 1280, 1440]) {
      await groupingPage.setViewportSize({ width, height: 900 })
      await groupingPage.goto(`${base}?grouping-width=${width}#/task/${task}`)
      await groupingPage.waitForSelector("#vsm .vsm-box, #vsm .vsm-wait")
      await groupingPage.waitForFunction(() => ![...document.querySelectorAll(".loading")].some((e) => e.getBoundingClientRect().height > 0))
      const items = []
      const count = await groupingPage.locator("#vsm .vsm-box, #vsm .vsm-wait").count()
      for (let index = 0; index < count; index++) {
        const item = groupingPage.locator("#vsm .vsm-box, #vsm .vsm-wait").nth(index)
        const label = await item.getAttribute("aria-label")
        await item.click()
        await groupingPage.waitForSelector("#evidence-drawer[open]")
        items.push({
          label, selection: await groupingPage.evaluate(() => location.hash),
          evidence: await groupingPage.locator("#drawer-body").textContent(),
        })
        await groupingPage.evaluate(() => {
          window.fixtureGroupingClosed = false
          document.getElementById("evidence-drawer").addEventListener("close", () => { window.fixtureGroupingClosed = true }, { once: true })
        })
        await groupingPage.locator("#drawer-close").click()
        await groupingPage.waitForFunction(() => window.fixtureGroupingClosed === true)
      }
      grouping.push({ width, items })
    }
    const caption = await groupingPage.locator(".vsm-block > .chart-caption").first().textContent()
    check("actual_task_group_membership_durations_drawers_and_selection_are_viewport_independent", () => {
      for (const snapshot of grouping) assert.deepEqual(snapshot.items, grouping[0].items, `actual task at ${snapshot.width}px`)
      assert.ok(grouping[0].items.some((item) => /Wait of 4\.6 hours/.test(item.label)), "the material interruption remains a separate wait")
      assert.match(caption, /15-minute/)
    })
  } finally {
    await save("actual-task-grouping.json", JSON.stringify(grouping, null, 2))
    await groupingContext.close()
  }
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 900 }, colorScheme: theme })
    await ctx.addInitScript(textScaleInit, 2)
    const p = await ctx.newPage()
    try {
      for (const width of [345, 320]) {
        await p.setViewportSize({ width, height: 900 })
        await loaded(p, "#/task/b93b442957bae64932a7666a4f9f3bf8", "#vsm button")
        const layout = assessLayout(await p.evaluate(measureLayout, { refresh: true }))
        const controls = await p.locator("#vsm .link-button").evaluateAll((buttons) => buttons.map((button) => ({
          text: button.textContent, html: button.outerHTML, rect: button.getBoundingClientRect().toJSON(),
          ancestors: [button.parentElement, button.parentElement.parentElement].map((element) => ({
            html: element.outerHTML.slice(0, 900), rect: element.getBoundingClientRect().toJSON(),
            display: getComputedStyle(element).display, whiteSpace: getComputedStyle(element).whiteSpace,
          })),
        })))
        results.push({ name: `long_actual_task_phone_diagnostic_${theme}_${width}`, layout, controls })
        check(`long_actual_task_text2x_controls_fit_${theme}_${width}`, () => assert.deepEqual(layout, []))
      }
    } finally { await ctx.close() }
  }
  const neighbourMap = JSON.parse(await readFile(new URL("./fixtures/v12-ladder-neighbours-map.json", import.meta.url), "utf8"))
  neighbourMap.job = task
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    await ctx.route(`**/map/${task}.json`, (route) => route.fulfill({ json: neighbourMap }))
    const p = await ctx.newPage()
    try {
      await loaded(p, `#/task/${task}`, "#vsm .mark-lane-prompt .lad-mark")
      const original = await p.evaluate(() => {
        const marks = [...document.querySelectorAll("#vsm .mark-lane-prompt .lad-mark")]
        const [first, second] = marks.map((mark, index) => [marks[index - 1], mark]).find(([a, b]) => a && Number(b.dataset.item) === Number(a.dataset.item) + 1)
        second.dataset.fixtureNeighbour = "1"
        const original = { vertical: !!second.closest(".vsm-phone"), css: second.style.cssText, top: second.style.top, left: second.style.left }
        second.style.left = `${parseFloat(second.style.left) - (second.getBoundingClientRect().left - first.getBoundingClientRect().left)}px`
        return original
      })
      const oldHits = assessLayout(await p.evaluate(measureLayout, { refresh: true })).filter((hit) => hit.code === "overlapping_controls")
      await p.evaluate((original) => {
        const marks = [...document.querySelectorAll("#vsm .mark-lane-prompt .lad-mark")]
        const second = document.querySelector('[data-fixture-neighbour="1"]')
        const first = marks[marks.indexOf(second) - 1]
        second.style.cssText = original.css
        const axis = original.vertical ? "top" : "left"
        second.dataset.gatePlanted = "1"
        second.style[axis] = `${parseFloat(second.style[axis]) - (second.getBoundingClientRect()[axis] - first.getBoundingClientRect()[axis])}px`
      }, original)
      const hits = assessLayout(await p.evaluate(measureLayout, { refresh: true })).filter((hit) => hit.code === "overlapping_controls" && hit.planted)
      results.push({ name: `neighbour_ladder_axis_diagnostic_${width}`, original, oldHits, hits })
      check(`neighbour_ladder_overlap_control_remains_sensitive_${width}`, () => assert.ok(hits.length))
    } finally { await ctx.close() }
  }
  for (const theme of ["light", "dark"]) for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1028, height: 900 }, colorScheme: theme })
    await context.addInitScript(textScaleInit, scale)
    const page = await context.newPage()
    for (const width of [1028, 1027, 822, 781, 345, 320]) {
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
  const css = await readFile(join(site, "styles.css"), "utf8")
  const mutations = [
    { name: "removing_pixel_resize_refresh_recreates_dense_mark_collision", file: "app.js", source: app.replace("Math.abs(vsmEl.clientWidth - lastMapWidth) < 1", "Math.abs(vsmEl.clientWidth - lastMapWidth) < 40"), hash: denseHash, selector: "#vsm .vsm-box", width: 1099,
      verify: async (p) => {
        for (let width = 1099; width >= 1060; width--) { await p.setViewportSize({ width, height: 900 }); await p.waitForTimeout(300) }
        assert.ok(assessLayout(await p.evaluate(measureLayout, { refresh: true })).some((x) => x.code === "overlapping_controls" && x.detail.includes("lad-mark")))
      } },
    { name: "removing_prompt_marker_wrapping_recreates_dense_text2x_collision", file: "styles.css", source: css.replace("min-width: 0; max-width: 100%; background: none;", "background: none;").replace(".vsm-op-text { min-width: 0; overflow-wrap: anywhere; }\n", ""), hash: denseHash, selector: "#vsm .vsm-box", width: 768, scale: 2,
      verify: async (p) => assert.ok(assessLayout(await p.evaluate(measureLayout, { refresh: true })).some((x) => x.code === "overlapping_controls" && x.detail.includes("vsm-op"))) },
    { name: "removing_PR_token_wrapping_recreates_phone_text2x_overflow", file: "app.js", source: app.replace('      b.style.maxWidth = "100%";\n      b.style.overflowWrap = "anywhere";\n', ""), hash: "#/task/b93b442957bae64932a7666a4f9f3bf8", selector: "#vsm button", width: 320, scale: 2,
      verify: async (p) => assert.ok(assessLayout(await p.evaluate(measureLayout, { refresh: true })).some((hit) => hit.code === "offscreen_control")) },
    { name: "removing_fixed_short_gap_grouping_folds_material_interruptions", file: "app.js", source: app.replace("shortGapGrouping: true", "shortGapGrouping: false"), hash: `#/task/${task}`, selector: "#vsm button", width: 768,
      verify: async (p) => {
        assert.ok(await p.locator("#vsm .vsm-box, #vsm .vsm-wait").count() < grouping[0].items.length)
        assert.match(await p.locator("#vsm").textContent(), /waits shorter than 4 hours/)
      } },
    { name: "removing_column_fit_recreates_overflow", file: "app.js", source: app.replace("if (!phone && minimumWidth > width)", "if (false)"), hash: `#/task/${task}`, selector: "#vsm button", width: 1028,
      verify: async (p) => assert.ok(assessLayout(await p.evaluate(measureLayout, { refresh: true })).some((x) => x.code === "document_overflow")) },
    { name: "removing_activity_equivalent_recreates_missing_chart", file: "app.js", source: app.replace("if (intervals.length) {", "if (false) {"), hash: `#/task/${task}/session/${session}`, selector: "#swimlane svg", width: 1280,
      verify: async (p) => assert.ok((await p.evaluate(checkChartEquivalents, CHART_EQUIVALENTS)).problems.includes("missing_chart_equivalent: swimlane")) },
    { name: "removing_short_bound_recreates_figure_disagreement", file: "steps.js", source: steps.replace('const b = totalBound(n);\n    const round =', 'const b = open ? null : totalBound(n);\n    const round ='), hash: "#/compare?mode=working", selector: "#stackup a.sb-col", width: 1280,
      verify: async (p) => assert.ok(assessTaskForms((await p.evaluate(compareFigures)).rows).some((x) => x.includes("21ed3b3de83c2e8c51bf457535c25f7f"))) },
  ]
  for (const mutant of mutations) {
    const ctx = await browser.newContext({ viewport: { width: mutant.width, height: 900 } })
    if (mutant.scale) await ctx.addInitScript(textScaleInit, mutant.scale)
    await ctx.route(`**/${mutant.file}`, (route) => route.fulfill({ contentType: mutant.file.endsWith(".css") ? "text/css" : "text/javascript", body: mutant.source }))
    const p = await ctx.newPage()
    try {
      assert.notEqual(mutant.source, mutant.file === "app.js" ? app : mutant.file === "styles.css" ? css : steps, "the source mutation must actually remove the fix")
      await loaded(p, mutant.hash, mutant.selector)
      await mutant.verify(p)
      results.push({ name: mutant.name, passed: true })
    } catch (e) { results.push({ name: mutant.name, passed: false, error: e.message }) }
    await ctx.close()
  }
  {
    const expression = nativeSource.slice(drawerStart, drawerEnd).trim().replace("const drawerCheck = ", "")
    const reverted = expression.replace('#vsm .vsm-box[aria-label$="Opens the evidence."], #vsm .vsm-wait[aria-label$="Opens the evidence."]', '#vsm [aria-label$="Opens the evidence."]')
    assert.notEqual(reverted, expression, "the keyboard eligibility removal must change the native check")
    const checkWithoutEligibility = runInNewContext(`(${reverted})`, {
      ROUTES,
      open: async (page) => { await page.goto("about:blank"); await loaded(page, denseHash, "#vsm .vsm-box") },
    })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    try {
      await actualCheck("removing_keyboard_target_eligibility_recreates_wrong_selection_premise", async () => {
        await assert.rejects(checkWithoutEligibility(page, "Enter"), /Enter did not select the evidence/)
      })
    } finally { await context.close() }
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
