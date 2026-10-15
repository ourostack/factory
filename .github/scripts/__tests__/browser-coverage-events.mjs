// Additional real-DOM cases for whole-file coverage. This is measurement,
// not a timing gate; the independent uninstrumented gate owns performance.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises"
import { resolve, join, sep, extname } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { parseArgs } from "../../../site/scripts/verify-v12-browser.mjs"
import { deriveImprovementQueue, validateImprovementQueue } from "../../../site/scripts/improvement-queue.mjs"

const require = createRequire(import.meta.url)
const B = require("../../../site/src/briefing.js")
const measured = (value) => ({ state: "measured", value, reasons: [] })

const [siteArg, moduleArg, outArg] = process.argv.slice(2)
const site = resolve(siteArg), out = resolve(outArg)
const checked = parseArgs(["--site", site, "--baseline-site", site, "--out", out, "--playwright-module", resolve(moduleArg)])
assert.ok(!checked.error, checked.error)
await mkdir(out, { recursive: true })
const data = JSON.parse(await readFile(join(site, "data.json"), "utf8"))
const causeDoc = JSON.parse(await readFile(join(site, "rollups/causes.json"), "utf8"))
const maps = new Map(), details = []
for (const job of data.jobs) {
  try {
    maps.set(job.id, JSON.parse(await readFile(join(site, "map", `${job.id}.json`), "utf8")))
    for (const name of await readdir(join(site, "jobs", job.id))) {
      if (name.endsWith(".json")) details.push({ job, detail: JSON.parse(await readFile(join(site, "jobs", job.id, name), "utf8")) })
    }
  } catch { /* absence is tested explicitly below */ }
}
const task = data.jobs.slice().sort((a, b) =>
  (maps.get(b.id)?.human_turns?.length || 0) - (maps.get(a.id)?.human_turns?.length || 0))[0]
const labeled = details.filter((d) => d.detail.stretches?.length).sort((a, b) =>
  new Set(b.detail.intervals.map((i) => i.worker)).size - new Set(a.detail.intervals.map((i) => i.worker)).size)[0]
const clockScore = ({ job, detail }) => {
  const map = maps.get(job.id), lo = detail.offset_ms, hi = detail.end_ms
  const prs = (map?.prs || []).reduce((n, p) => n + ["opened_at_ms", "merged_at_ms"].filter((k) => typeof p[k] === "number" && p[k] >= lo && p[k] <= hi).length, 0)
  return prs + (map?.human_turns || []).filter((p) => p.session === detail.session).length
}
const clockSession = details.slice().sort((a, b) => clockScore(b) - clockScore(a))[0]
assert.ok(task && labeled, "real task and a published labeled session are required")
const results = [], requests = [], actions = []
let browser = null
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost")
    const path = resolve(site, "." + (url.pathname === "/" ? "/index.html" : url.pathname))
    assert.ok(path.startsWith(site + sep))
    requests.push(url.pathname)
    const body = await readFile(path)
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "text/plain" }); res.end(body)
  } catch (error) {
    if (res.headersSent) res.destroy(error)
    else { res.writeHead(404); res.end("not found") }
  }
})
let base
async function load(page, hash, selector) {
  await page.goto(base + hash)
  await page.waitForSelector(selector)
  await page.waitForFunction(() => ![...document.querySelectorAll(".loading, .is-loading")].some((e) => e.getBoundingClientRect().height > 0))
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}
async function scenario(name, run, options = {}) {
  if (process.env.FACTORY_BROWSER_CASE_FILTER && !new RegExp(process.env.FACTORY_BROWSER_CASE_FILTER).test(name)) return
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options })
  const page = await context.newPage()
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => {
      if (window.fixtureClipboardDenied) throw new Error("fixture clipboard denied")
      window.fixtureCopied = text
    } } })
  })
  try { await run(page, context); results.push({ name, passed: true }) }
  catch (error) {
    const publicDom = await page.evaluate(() => ({
      url: location.href, view: document.body.dataset.view, drawerOpen: document.getElementById("evidence-drawer")?.open,
      vsm: document.getElementById("vsm")?.textContent.slice(0, 4000), navigation: document.getElementById("navigation-context")?.textContent,
    })).catch(() => null)
    results.push({ name, passed: false, error: error.stack, publicDom }); console.error("FAIL", name, error.message)
  }
  finally { await context.close() }
}
async function closeDrawer(page) {
  if (await page.locator("#evidence-drawer").evaluate((d) => d.open)) {
    await page.locator("#evidence-drawer").evaluate((d) => {
      window.fixtureDrawerCloseObserved = false
      d.addEventListener("close", () => { window.fixtureDrawerCloseObserved = true }, { once: true })
    })
    await page.locator("#drawer-close").click()
    await page.waitForFunction(() => window.fixtureDrawerCloseObserved === true)
    assert.equal(await page.locator("#evidence-drawer").evaluate((d) => d.open), false)
  }
}
async function openEvidence(page, selector, max = 2, keyboard = false) {
  const count = Math.min(max, await page.locator(selector).count())
  for (let i = 0; i < count; i++) {
    const control = page.locator(selector).nth(i)
    if (!await control.isVisible() || await control.isDisabled()) continue
    actions.push({ selector, text: await control.textContent(), aria: await control.getAttribute("aria-label"), url: page.url() })
    if (keyboard) { await control.focus(); await page.keyboard.press("Enter") }
    else await control.click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.ok((await page.locator("#drawer-title").innerText()).trim(), `${selector} opens named evidence`)
    const copy = page.locator("#evidence-drawer button").filter({ hasText: /Copy.*prompt/ })
    if (await copy.count()) {
      await copy.first().click()
      assert.ok(await page.evaluate(() => typeof window.fixtureCopied === "string" && window.fixtureCopied.length > 30))
    }
    const nested = page.locator("#evidence-drawer button.stretch-row")
    if (await nested.count()) {
      await nested.first().click()
      assert.ok((await page.locator("#drawer-title").innerText()).trim())
    }
    await closeDrawer(page)
  }
}
async function fixtureJson(context, path, value) {
  await context.route(`**/${path}`, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(value) }))
}
try {
  await new Promise((r, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", r) })
  base = `http://127.0.0.1:${server.address().port}/`
  const { chromium } = await import(pathToFileURL(resolve(moduleArg)))
  browser = await chromium.launch({ headless: true })

  await scenario("legacy_routes_use_the_router_and_real_task_session", async (page) => {
    for (const [hash, view] of [["#/about", "about"], ["#/store", "store"], [`#job-${task.id}`, "task"], [`#session-${labeled.detail.session}`, "session"], ["#/session/not-published", "session"], ["#/task/not-published", "task"], ["#/unrecognized", "missing"], ["#main", "missing"]]) {
      await load(page, hash, `#view-${view}`)
      if (hash !== "#main") assert.equal(await page.locator("body").getAttribute("data-view"), view)
    }
  })
  await scenario("store_bar_tooltips_are_visible_and_carry_real_figures", async (page) => {
    await load(page, "#/store", "#view-store .bar-row")
    for (const selector of ["#view-store .bar-row", "#view-store rect[tabindex]"]) {
      const count = Math.min(10, await page.locator(selector).count())
      for (let i = 0; i < count; i++) {
        const control = page.locator(selector).nth(i)
        if (!await control.isVisible()) continue
        await control.hover()
        assert.ok((await page.locator("#tooltip").innerText()).trim())
        if (selector.includes("rect")) await control.focus()
        await page.mouse.move(1, 1)
      }
    }
  })
  await scenario("preferences_guide_alarm_navigation_are_real_controls", async (page) => {
    await load(page, "#/", "#overview-state")
    await page.locator("summary").filter({ hasText: /Time zone/ }).first().click()
    await page.locator("#display-zone").selectOption("UTC")
    assert.match(await page.locator("#zone-current").innerText(), /UTC/)
    await page.locator("#dismiss-guide").click()
    assert.equal(await page.locator("#overview-guide").isVisible(), false)
    const alarm = page.getByRole("link", { name: "Open this alarm on Improvements" })
    if (await alarm.count()) {
      await alarm.first().click()
      assert.equal(await page.locator("body").getAttribute("data-view"), "act")
    }
    await load(page, "#/help", "#help-stops")
    await page.getByRole("link", { name: "Understand a task" }).click()
    await page.waitForFunction(() => document.body.dataset.view === "task")
  })
  for (const width of [1280, 390]) await scenario(`task_evidence_controls_${width}`, async (page) => {
    await page.addInitScript(() => {
      window.fixtureNativeEvents = []
      for (const kind of ["focusin", "keydown", "keyup", "click", "close"]) document.addEventListener(kind, (event) => {
        window.fixtureNativeEvents.push({ kind, key: event.key, target: event.target.className,
          id: event.target.id, trusted: event.isTrusted, open: document.getElementById("evidence-drawer")?.open })
      }, true)
    })
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    for (const selector of ["#vsm .vsm-box", "#vsm .vsm-wait", "#vsm .lad", "#vsm .vsm-op", "#vsm .lad-mark-inline", "#vsm .lad-mark"]) await openEvidence(page, selector, 3, selector.includes(".lad-mark"))
    for (const selector of ["#time-went .tw-row", "#time-went .tw-seg", ".task-summary button[aria-pressed]"]) {
      for (let i = 0; i < Math.min(3, await page.locator(selector).count()); i++) {
        const control = page.locator(selector).nth(i)
        if (!await control.isVisible()) continue
        const original = await control.elementHandle()
        const before = await original.evaluate((e) => ({ connected: e.isConnected, pressed: e.getAttribute("aria-pressed"), text: e.textContent }))
        await control.focus(); await page.keyboard.press("Enter")
        const after = await original.evaluate((e) => ({ connected: e.isConnected, pressed: e.getAttribute("aria-pressed"), text: e.textContent }))
        actions.push({ action: "native_selection_activation", selector, index: i, width, before, after,
          currentPressed: await control.getAttribute("aria-pressed"), url: page.url(),
          active: await page.evaluate(() => ({ tag: document.activeElement.tagName, cls: document.activeElement.className,
            pressed: document.activeElement.getAttribute("aria-pressed"), loading: [...document.querySelectorAll(".is-loading")].filter((e) => e.getBoundingClientRect().height).length })),
          nativeEvents: await page.evaluate(() => window.fixtureNativeEvents.slice(-30)) })
        assert.equal(await control.getAttribute("aria-pressed"), "true")
        assert.equal(await page.locator("#evidence-drawer").evaluate((d) => d.open), false, "selection is not opening evidence")
        await control.focus(); await page.keyboard.press("Enter")
        if (selector.startsWith(".task-summary")) {
          assert.equal(await control.getAttribute("aria-pressed"), "true", "explicit show stays selected")
          await page.locator(".journey-clear").click()
          assert.equal(await control.getAttribute("aria-pressed"), "false")
        } else assert.equal(await control.getAttribute("aria-pressed"), "false")
      }
    }
    for (const selector of ["#vsm .vsm-data-toggle", "#map-clear"]) {
      for (let i = 0; i < Math.min(3, await page.locator(selector).count()); i++) {
        const control = page.locator(selector).nth(i)
        if (await control.isVisible()) { await control.click(); await closeDrawer(page) }
      }
    }
    const prompts = page.locator("#vsm details").filter({ has: page.locator("button.link-button") })
    for (let i = 0; i < Math.min(2, await prompts.count()); i++) {
      const d = prompts.nth(i)
      if (!await d.evaluate((n) => n.open)) await d.locator(":scope > summary").click()
      await openEvidence(page, "#vsm details[open] button.link-button", 2)
    }
    const buttons = page.locator("#vsm button.lad-mark[tabindex='0']")
    if (await buttons.count()) {
      await buttons.first().focus()
      for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", "a"]) await page.keyboard.press(key)
      await page.keyboard.press("Space"); await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      await page.mouse.click(1, 1)
      assert.equal(await page.locator("#evidence-drawer").evaluate((d) => d.open), false)
    }
  }, { viewport: { width, height: 900 } })

  await scenario("labeled_session_stretches_zoom_worker_expansion_and_keyboard", async (page) => {
    await load(page, `#/task/${labeled.job.id}/session/${labeled.detail.session}`, "#swimlane .lane-plot svg")
    for (const name of ["Zoom in", "Zoom out", "Fit", /Show .*subagent/]) {
      const b = name === "Fit" ? page.locator("#swimlane button.lane-btn").filter({ hasText: /^Fit$/ }) : page.locator("#swimlane").getByRole("button", { name, exact: typeof name === "string" })
      actions.push({ name: String(name), matches: await b.count(), url: page.url() })
      assert.ok(await b.count(), `the real multi-worker session offers ${name}`)
      if (!await b.first().isDisabled()) await b.first().click()
    }
    await openEvidence(page, "#swimlane .lane-stretch", 2, true)
    await openEvidence(page, "#swimlane .lane-op", 2, true)
    await openEvidence(page, "#swimlane .lane-pr", 2, true)
    await page.locator("#swimlane .lane-stretch[tabindex='0']").focus()
    for (const key of ["ArrowRight", "ArrowDown", "ArrowUp", "ArrowLeft", "Home", "End", "a"]) await page.keyboard.press(key)
    await page.keyboard.press("Space"); await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    await closeDrawer(page)
    const table = page.locator("#swimlane details").filter({ hasText: /labeled stretches as a table/ })
    await table.locator(":scope > summary").click()
    await openEvidence(page, "#swimlane table button.link-button", 2)
  })
  await scenario("real_clock_session_prompts_prs_groups_and_focus_survive_resize", async (page) => {
    await load(page, `#/task/${clockSession.job.id}/session/${clockSession.detail.session}`, "#swimlane .lane-plot svg")
    assert.ok(await page.locator("#swimlane .lane-op").count())
    assert.ok(await page.locator("#swimlane .lane-pr").count())
    await openEvidence(page, "#swimlane .lane-op", 3, true)
    await openEvidence(page, "#swimlane .lane-pr", 3, true)
    await openEvidence(page, "#swimlane .lane-op", 1, false)
    const mark = page.locator("#swimlane .lane-op[tabindex='0']").first()
    await mark.focus()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.waitForTimeout(300)
    assert.ok(await page.locator("#swimlane .lane-plot svg").count())
  })
  await scenario("comparison_history_modes_and_date_filters", async (page) => {
    await load(page, "#/compare", "#stackup")
    await page.locator("details.comparison-history > summary").click()
    for (const selector of [".ot-btn[data-over='task']", ".ot-btn[data-over='week']", ".ot-btn[data-otmode='all']", ".ot-btn[data-otmode='working']", ".ot-btn[data-otmode='share']"]) {
      await page.locator(selector).click()
      assert.equal(await page.locator(selector).getAttribute("aria-pressed"), "true")
    }
    const dates = page.locator("#compare-population input[type='date']")
    assert.equal(await dates.count(), 2)
    for (const input of await dates.all()) { await input.fill("2026-10-01"); await input.press("Tab") }
    assert.match(page.url(), /from=|to=/)
  })
  for (const c of causeDoc.causes) {
    const keys = [c.cause, ...(c.children || []).map((x) => x.cause)]
    for (const key of keys) await scenario(`cause_${key}`, async (page) => {
      await load(page, `#/causes/${encodeURIComponent(key)}`, "#cause-detail")
      assert.ok((await page.locator("#cause-detail").innerText()).trim())
      const copy = page.locator("#cause-detail button").filter({ hasText: /Copy|Start an A3/ })
      if (await copy.count()) { await copy.first().click(); assert.ok(await page.evaluate(() => !!window.fixtureCopied)) }
    })
  }
  await scenario("absent_stack_uses_the_retained_legacy_waste_data", async (page, context) => {
    await context.route("**/rollups/stackup.json", (r) => r.fulfill({ status: 404, body: "not published" }))
    const j = data.jobs.find((j) => j.waste?.rows?.length)
    assert.ok(j)
    await load(page, `#/task/${j.id}`, "#time-went")
    assert.match(await page.locator("#time-went").innerText(), /independent waste evaluator/)
  })
  await scenario("unsupported_burst_source_keeps_clock_evidence_without_invented_boxes", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.bursts_state = { state: "unavailable", reasons: ["source_unreadable"] }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm")
    assert.match(await page.locator("#vsm").innerText(), /work bursts are not known/)
    for (const d of await page.locator("#vsm details").all()) await d.locator(":scope > summary").click()
    await openEvidence(page, "#vsm button.link-button", 2)
  })
  await scenario("slow_optional_local_names_abort_and_do_not_block_the_task", async (page, context) => {
    await context.route("**/local-names.json", async (r) => { await new Promise((s) => setTimeout(s, 1200)); await r.fulfill({ body: "{}" }).catch(() => {}) })
    await load(page, `#/task/${task.id}`, "#task-head")
    assert.ok((await page.locator("#task-head").innerText()).trim())
  })
  await scenario("optional_names_work_without_abort_controller", async (page, context) => {
    await context.addInitScript(() => { window.AbortController = undefined })
    await fixtureJson(context, "local-names.json", { version: 1, jobs: { [task.id]: { title: "Synthetic local fixture title", track: "fixture", task: "fixture" } } })
    await load(page, `#/task/${task.id}`, "#task-head")
    assert.match(await page.locator("#task-head").innerText(), /Synthetic local fixture title/)
  })
  await scenario("picker_sort_skip_main_and_explicit_selection_clear", async (page) => {
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    await page.locator(".skip-link").focus()
    await page.keyboard.press("Enter")
    assert.equal(await page.evaluate(() => document.activeElement.id), "main")
    await page.locator("#other-tasks > summary").click()
    for (const name of ["oldest first", "newest first"]) {
      const button = page.getByRole("button", { name, exact: true })
      await button.click()
      assert.equal(await button.getAttribute("aria-pressed"), "true")
    }
    await page.locator(".skip-map").click()
    assert.equal(await page.evaluate(() => document.activeElement.id), "vsm-title")
    const summary = page.locator(".task-summary button[aria-pressed]").first()
    await summary.click()
    assert.ok(await page.locator(".journey-clear").isVisible())
    await closeDrawer(page)
    await load(page, `#/task/${task.id}?bursts=1`, "#map-selection:not([hidden])")
    await closeDrawer(page)
    await page.locator("#map-clear").click()
    assert.equal(await summary.getAttribute("aria-pressed"), "false")
  })
  await scenario("cause_why_toggle_and_filter_clear_preserve_public_ranking", async (page) => {
    await load(page, "#/causes", "#pareto")
    const toggle = page.locator("#why-toggle")
    assert.notEqual(await toggle.getAttribute("aria-disabled"), "true")
    await toggle.click()
    assert.equal(await toggle.getAttribute("aria-pressed"), "false")
    await toggle.click()
    assert.equal(await toggle.getAttribute("aria-pressed"), "true")
    await load(page, `#/causes?task=${task.id}`, ".findings-clear")
    await page.locator(".findings-clear").click()
    await page.waitForFunction(() => !location.hash.includes("task="))
    const c = causeDoc.causes.find((c) => c.jobs?.length && c.spans?.length)
    assert.ok(c, "a real cause has both tasks and evidence spans")
    await load(page, `#/causes/${encodeURIComponent(c.cause)}?task=${c.jobs[0]}`, "#cause-detail")
    assert.ok((await page.locator("#cause-detail").innerText()).trim())
  })
  await scenario("drawer_loads_real_span_stretches_and_local_link_closes_it", async (page) => {
    const spanned = details.find(({ job, detail }) => {
      const raw = maps.get(job.id)?.bursts
      const bursts = Array.isArray(raw) ? raw : raw?.items || []
      return (detail.stretches || []).some((s) => bursts.some((b) => s.start_ms < b.end_ms && s.end_ms > b.start_ms))
    })
    assert.ok(spanned, "real recorded labeled stretches intersect this task's work")
    await load(page, `#/task/${spanned.job.id}`, "#vsm .vsm")
    const boxes = page.locator("#vsm .vsm-box")
    assert.ok(await boxes.count())
    let loaded = false
    for (let i = 0; i < Math.min(12, await boxes.count()); i++) {
      await boxes.nth(i).click()
      const button = page.locator("#evidence-drawer .drawer-load")
      if (await button.count()) {
        await button.click()
        await page.waitForFunction(() => !document.querySelector("#evidence-drawer .drawer-load"))
        assert.ok(await page.locator("#evidence-drawer .drawer-sub").count())
        const stretch = page.locator("#evidence-drawer .stretch-row")
        if (await stretch.count()) {
          await stretch.first().click()
          await page.locator("#evidence-drawer a[href^='#/task/']").first().click()
          await page.waitForFunction(() => !document.getElementById("evidence-drawer").open)
          loaded = true
          break
        }
      }
      await closeDrawer(page)
    }
    assert.ok(loaded, "at least one real task span opens a recorded labeled stretch")
  })
  await scenario("legacy_session_without_offsets_derives_only_recorded_interval_extent", async (page, context) => {
    const detail = structuredClone(labeled.detail)
    delete detail.offset_ms; delete detail.end_ms
    await fixtureJson(context, `jobs/${labeled.job.id}/${detail.session}.json`, detail)
    await load(page, `#/task/${labeled.job.id}/session/${detail.session}`, "#swimlane .lane-plot svg")
    assert.ok(await page.locator("#swimlane .lane-stretch").count())
    await openEvidence(page, "#swimlane .lane-stretch", 1)
  })
  await scenario("real_clock_zoom_separates_marks_and_task_fit_is_a_real_control", async (page) => {
    await load(page, `#/task/${clockSession.job.id}/session/${clockSession.detail.session}`, "#swimlane .lane-plot svg")
    let promptOpened = false, prOpened = false
    for (let z = 0; z < 16; z++) {
      for (const [kind, selector] of [["prompt", "#swimlane .lane-op[aria-label^='Operator prompt ']"], ["pr", "#swimlane .lane-pr[aria-label^='Pull request ']"]]) {
        const mark = page.locator(selector).first()
        if (!await mark.count()) continue
        await mark.focus(); await page.keyboard.press("Enter")
        await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
        actions.push({ zoomIteration: z, mark: await mark.getAttribute("aria-label"), kind })
        await closeDrawer(page)
        if (kind === "prompt") promptOpened = true
        else prOpened = true
      }
      if (promptOpened && prOpened) break
      const zoom = page.getByRole("button", { name: "Zoom in", exact: true })
      if (await zoom.isDisabled()) break
      await zoom.click()
    }
    assert.ok(promptOpened && prOpened, "real zoom exposes individually recorded prompt and PR marks")
    const fitted = details.find(({ job, detail }) => {
      const w = maps.get(job.id)?.lead_window
      if (!w || typeof w.start_ms !== "number" || typeof w.end_ms !== "number") return false
      const part = Math.min(detail.end_ms, w.end_ms) - Math.max(detail.offset_ms, w.start_ms)
      return part > 0 && part < (detail.end_ms - detail.offset_ms) * 0.6
    })
    assert.ok(fitted, "the public corpus contains a shared session longer than its task's part")
    await load(page, `#/task/${fitted.job.id}/session/${fitted.detail.session}`, "#swimlane .lane-plot svg")
    await page.getByRole("button", { name: "Zoom to this task's part of the session", exact: true }).click()
    assert.ok(await page.locator("#swimlane .lane-plot svg").count())
  })
  for (const failure of [false, true]) await scenario(`reducer_produced_overview_handoff_copy_${failure ? "failure" : "success"}`, async (page, context) => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
    const value = structuredClone(fixture.public)
    value.rows.push({ ...structuredClone(value.rows[0]), id: "fedcba9876543210fedcba9876543210", route: "investigate", gate: null })
    value.coverage.reviewed = 2
    const improvements = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000 })
    assert.equal(validateImprovementQueue(improvements).ok, true)
    const d = { ...data, improvements }
    d.overview = B.buildBriefing({ data: d, improvements, now: 1000, validateQueue: validateImprovementQueue })
    assert.ok(d.overview.attention.some((r) => r.triage), "the actual reducer includes an inspection-only decision gate")
    await fixtureJson(context, "data.json", d)
    if (failure) await context.addInitScript(() => { window.fixtureClipboardDenied = true })
    await load(page, "#/", "#overview-state")
    const detail = page.locator(".briefing-item details").first()
    await detail.locator("summary").click()
    await detail.getByRole("button", { name: "Copy as a prompt for your agent" }).click()
    assert.match(await detail.locator("[role=status]").innerText(), failure ? /Copy failed/ : /Copied/)
    await load(page, "#/improvements", "#triage-brief .improvement-row")
    const improvement = page.locator("#triage-brief .improvement-row").first()
    await improvement.locator("button.copy-prompt").click()
    assert.match(await improvement.locator(".improvement-copy-status").innerText(), failure ? /Copy failed/ : /Copied/)
  })
  for (const mode of ["healthy", "no_records", "missing", "alarms"]) await scenario(`source_health_states_${mode}`, async (page, context) => {
    const d = structuredClone(data)
    d.loop_health.alarms = []
    d.loop_health.notices = [{ code: "headless_unknown", machines: measured(mode === "healthy" ? 1 : 2) }]
    d.loop_health.headless = [{ code: "sign_in_unknown", machines: measured(1) }, { code: "future_host_state", machines: measured(2) }]
    d.loop_health.verdict = { status: mode === "healthy" ? "healthy" : "cannot_tell", missing: mode === "no_records" ? [{ figure: "steps_stale", codes: ["no_loop_records"] }] : mode === "missing" ? [{ figure: "steps_stale", codes: ["not_recorded"] }, { figure: "future_health_slot", codes: ["source_unreadable"] }] : [], quiet: measured(mode === "missing" ? 2 : 0), stale: measured(mode === "missing" ? 1 : 0) }
    if (mode === "alarms") {
      d.loop_health.alarms = [{ code: "improvement_age" }, { code: "loop_alarms_open" }, { code: "steps_stale" }]
      d.capture_coverage.alarms = [{ host: "fixture", code: "future_capture_alarm" }, { host: "fixture", code: "low_capture" }]
    } else {
      d.capture_coverage.alarms = []
      d.andon_issues = []
    }
    d.outcomes.refusal_reasons = [{ reason: "test_failed", jobs: measured(1) }, { reason: "legacy_reason", jobs: measured(2) }]
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#view-store")
    assert.match(await page.locator("#view-store").innerText(), /sign-in could not be told/)
    await page.setViewportSize({ width: 390, height: 900 })
    await load(page, "#/", "#overview-state")
    assert.ok((await page.locator("#status-line").innerText()).trim())
  })
  for (const asset of ["walk.js", "steps.js"]) for (const hash of [
    `#/task/${task.id}`,
    `#/task/${labeled.job.id}/session/${labeled.detail.session}`,
    "#/compare", "#/causes", "#/improvements",
  ]) {
    if ((asset === "steps.js" && hash.includes("/session/")) || (asset === "walk.js" && hash === "#/improvements")) continue
    await scenario(`unavailable_dependency_${asset}_${hash}`, async (page, context) => {
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await context.route(`**/${asset}`, (route) => route.fulfill({ status: 404, body: "dependency unavailable" }))
    await page.goto(base + hash)
    if (asset === "steps.js") {
      assert.ok(errors.some((e) => /groupWords/.test(e)), "the missing module prevents renderer initialization at its static binding")
      assert.equal(await page.locator("#vsm svg, #stackup svg, #pareto svg").count(), 0)
      actions.push({ dependency: asset, route: hash, bootstrapErrors: errors })
      return
    }
    const target = hash.includes("/session/") ? "#swimlane" : hash.includes("/task/") ? "#vsm" : hash === "#/compare" ? "#stackup" : hash === "#/causes" ? "#pareto" : "#problems"
    await page.waitForFunction((target) => /could not be drawn/.test(document.querySelector(target)?.innerText || ""), target)
    assert.match(await page.locator(target).innerText(), /could not be drawn/)
    actions.push({ dependency: asset, route: hash, target, evidence: await page.locator(target).innerText() })
    })
  }
  await scenario("data_failure_keeps_hash_and_history_help_navigation_usable", async (page, context) => {
    await context.route("**/data.json", (route) => route.fulfill({ status: 503, body: "source unavailable" }))
    await page.goto(base + "#/compare")
    await page.waitForFunction(() => /could not load the store/.test(document.body.innerText))
    for (const name of ["Understand a task", "Hand off an improvement"]) {
      await page.goto(base + "#/help")
      await page.waitForSelector("#help-stops a")
      await page.getByRole("link", { name, exact: true }).click()
      await page.waitForFunction(() => document.body.dataset.view !== "help")
      assert.match(await page.locator("#status-line").innerText(), /could not be loaded/)
    }
  })
  await scenario("legacy_empty_optional_projections_are_explicit_not_measured_zeros", async (page, context) => {
    const d = structuredClone(data)
    d.jobs = []; d.sessions = []; d.models = []; d.harnesses = []
    d.featured = []; d.takeaways = []; d.intake_over_time = []; d.trend = []
    d.outcomes = null; d.capture_coverage = null; d.loop_health = null
    await fixtureJson(context, "data.json", d)
    for (const [hash, target] of [["#/store", "#view-store"], ["#/tasks", "#task-list"], ["#/help", "#help-stops"]]) {
      await load(page, hash, target)
      assert.ok((await page.locator(target).innerText()).trim())
      if (hash === "#/store") {
        await page.waitForFunction(() => document.getElementById("jobs-table").textContent.includes("No jobs tracked yet"))
        assert.match(await page.locator("#jobs-table").textContent(), /No jobs tracked yet/)
        assert.match(await page.locator(target).textContent(), /No harness data recorded yet/)
      }
    }
    assert.match(await page.locator("#help-stops").innerText(), /No recorded task is available/)
    await load(page, "#/tasks", "#task-list")
    assert.match(await page.locator("#task-list").innerText(), /does not prove no work occurred/)
  })
  await scenario("filtered_task_list_and_unknown_selection_have_real_clear_paths", async (page) => {
    await load(page, "#/tasks?status=accepted", "#task-list")
    assert.ok(await page.locator(".task-filter-note").count())
    await page.getByRole("link", { name: "Show all tasks", exact: true }).click()
    await page.waitForFunction(() => !location.hash.includes("status="))
    await load(page, `#/task/${task.id}?selection=unsupported`, "#navigation-context")
    assert.match(await page.locator("#navigation-context").innerText(), /Nothing else was selected/)
    await page.locator("#navigation-context").getByRole("button", { name: "Clear selection", exact: true }).click()
    await page.waitForFunction(() => !location.hash.includes("selection="))
  })
  for (const verification of ["partial", "unavailable"]) await scenario(`featured_reference_verification_${verification}`, async (page, context) => {
    const d = structuredClone(data)
    assert.ok(d.featured.length, "the retained snapshot contains real featured sessions")
    d.featured[0].verification = verification
    if (d.featured[0].sample_merged_prs.length) d.featured[0].sample_merged_prs[0].url = "unsupported-public-reference"
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#featured-grid")
    assert.match(await page.locator("#featured-grid").innerText(), verification === "partial" ? /Not every reference could be checked/ : /could not be verified/)
    assert.equal(await page.locator("a[href='unsupported-public-reference']").count(), 0)
  })
  for (const state of ["lower", "upper", "unknown", "unavailable", "bound_not_moved"]) await scenario(`source_number_metadata_${state}`, async (page, context) => {
    // Retain every source value; only simulate the producer's recorded
    // confidence/availability. These fixtures are not live measurements.
    const restate = (value) => {
      if (!value || typeof value !== "object") return value
      if (Array.isArray(value)) return value.map(restate)
      if (["measured", "partial"].includes(value.state) && typeof value.value === "number") {
        if (state === "unavailable") return { state: "unavailable", reasons: ["source_unreadable"] }
        return { ...value, state: "partial", bound: state === "unknown" || state === "bound_not_moved" ? null : state, reasons: [...(value.reasons || []), "source_unreadable"], ...(state === "bound_not_moved" ? { bound_reason: "bound_not_moved" } : {}) }
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restate(v)]))
    }
    await fixtureJson(context, "data.json", restate(data))
    for (const file of ["rollups/tasks.json", "rollups/stackup.json", "rollups/by_week.json"]) {
      await fixtureJson(context, file, restate(JSON.parse(await readFile(join(site, file), "utf8"))))
    }
    for (const [hash, target] of [[`#/task/${task.id}`, "#time-went"], [`#/task/${labeled.job.id}/session/${labeled.detail.session}`, "#session-detail"], ["#/store", "#view-store"], ["#/compare", "#stackup"]]) {
      await load(page, hash, target)
      assert.ok((await page.locator(target).innerText()).trim())
      assert.doesNotMatch(await page.locator(target).innerText(), /NaN|Infinity/)
    }
    for (const mode of ["working", "share", "production", "request", "all"]) {
      const button = page.locator(`#view-compare button[data-mode="${mode}"]`)
      assert.ok(await button.count(), `the comparison provides its ${mode} control`)
      await button.click()
      assert.equal(await button.getAttribute("aria-pressed"), "true")
    }
    await page.locator("details.comparison-history > summary").click()
    for (const mode of ["working", "all", "share"]) {
      await page.locator(`button[data-otmode="${mode}"]`).click()
      assert.ok((await page.locator(".comparison-history").innerText()).trim())
    }
    actions.push({ metadata: state, preservedValues: state !== "unavailable", route: page.url() })
  })
  await scenario("cause_and_why_copy_failures_keep_the_exact_evidence_prompt_available", async (page, context) => {
    await context.addInitScript(() => { window.fixtureClipboardDenied = true })
    const parent = causeDoc.causes.find((c) => c.jobs?.length && !c.cause.startsWith("waiting:"))
    const why = causeDoc.causes.flatMap((c) => c.children || []).find((c) => c.cause !== "waiting:next_prompt:not_known")
    assert.ok(parent && why, "two real ranked findings provide the distinct prompt renderers")
    for (const c of [parent, why]) {
      await load(page, `#/causes/${encodeURIComponent(c.cause)}`, "#cause-detail .copy-prompt")
      await page.locator("#cause-detail button.copy-prompt").click()
      assert.match(await page.locator("#cause-detail .copy-status").innerText(), /Copy failed/)
      const selected = await page.evaluate(() => window.getSelection().toString())
      assert.equal(selected, await page.locator("#cause-detail .prompt-text").innerText())
      assert.ok(selected.length > 30)
    }
  })
  for (const absence of ["map", "tasks_and_map", "detail", "detail_path"]) {
    await scenario(`recorded_session_source_absence_${absence}`, async (page, context) => {
      const id = labeled.job.id, sid = labeled.detail.session
      if (absence === "map" || absence === "tasks_and_map") {
        await context.route(`**/map/${id}.json`, (route) => route.fulfill({ status: 404, body: "not published" }))
      }
      if (absence === "tasks_and_map") {
        await context.route("**/rollups/tasks.json", (route) => route.fulfill({ status: 404, body: "not published" }))
      }
      if (absence === "detail") {
        await context.route(`**/jobs/${id}/${sid}.json`, (route) => route.fulfill({ status: 503, body: "unreadable" }))
      }
      if (absence === "detail_path") await fixtureJson(context, `map/${id}.json`, { ...maps.get(id), detail_files: [] })
      await load(page, `#/task/${id}/session/${sid}`, "#swimlane")
      await page.waitForFunction(() => /cannot be drawn|No swimlane file|could not be read/.test(document.getElementById("swimlane").innerText))
      assert.equal(await page.locator("#swimlane .lane-plot svg").count(), 0)
      await load(page, `#/task/${id}`, "#task-head")
      assert.ok((await page.locator("#task-head").innerText()).trim())
      if (absence === "map" || absence === "tasks_and_map") {
        await page.waitForFunction(() => /value stream map is not published/.test(document.getElementById("vsm").innerText))
      }
    })
  }
  for (const outcome of ["accepted", "sent_back"]) {
    await scenario(`recorded_job_outcome_and_uncounted_labels_${outcome}`, async (page, context) => {
      const d = structuredClone(data)
      const j = d.jobs.find((j) => j.id === task.id)
      j.outcome = outcome
      j.waste = { ...j.waste, rows: [], sessions_share_unknown: measured(outcome === "accepted" ? 1 : 2),
        sessions_labeled: measured(outcome === "accepted" ? 1 : 2), foreign_sessions: measured(1) }
      await fixtureJson(context, "data.json", d)
      await context.route("**/rollups/stackup.json", (route) => route.fulfill({ status: 404, body: "not published" }))
      await load(page, `#/task/${j.id}`, "#task-head")
      assert.match(await page.locator("#task-head").innerText(), /recorded by the agent on the operator's word/)
      await page.waitForFunction(() => /No labeled time can be counted/.test(document.getElementById("time-went").innerText))
      assert.match(await page.locator("#time-went").innerText(), /Data defect/)
      assert.match(await page.locator("#time-went").innerText(), /No labeled time can be counted/)
    })
  }
  for (const mode of ["normal", "not_monitored", "owned_alarms"]) {
    await scenario(`honest_status_line_${mode}`, async (page, context) => {
      const d = structuredClone(data)
      const health = JSON.parse(await readFile(join(site, "health.json"), "utf8"))
      health.built_at = new Date().toISOString()
      health.verdict = { status: "alive", reason: "Synthetic current health fixture" }
      d.andon_issues = []; d.andon_verification = "verified"; d.fix_next = []
      d.alarm_issues = []; d.alarm_issues_verification = "verified"
      d.capture_coverage.alarms = []; d.capture_coverage.share = measured(1)
      d.loop_health.alarms = []; d.loop_health.verdict = { status: "healthy", missing: [] }
      if (mode === "not_monitored") {
        d.capture_coverage = null; d.loop_health = null
        await context.route("**/health.json", (route) => route.fulfill({ status: 404, body: "absent" }))
      } else {
        if (mode === "owned_alarms") {
          health.verdict = { status: "broken", reason: "Synthetic build failure fixture" }
          d.andon_issues = [{ ref: "ourostack/factory#1", url: "https://github.com/ourostack/factory/issues/1", issue_state: "open" }]
          d.fix_next = [{ id: "fixture_alarm", title: "Synthetic recorded alarm", severity: "alarm" }]
          d.alarm_issues = [{ ref: "ourostack/factory#2", url: "https://github.com/ourostack/factory/issues/2", issue_state: "open", keys: ["site", "fixture_alarm"] }]
        }
        await fixtureJson(context, "health.json", health)
      }
      await fixtureJson(context, "data.json", d)
      await load(page, "#/store", "#status-line")
      const words = await page.locator("#status-line").innerText()
      assert.match(words, mode === "normal" ? /Normal/ : mode === "not_monitored" ? /Not monitored/ : /Abnormal/)
      await page.locator(".status-details > summary").click()
      assert.match(await page.locator(".status-full").innerText(), mode === "normal" ? /Checked/ : mode === "not_monitored" ? /Not recorded/ : /tracked in issue/)
      if (mode === "owned_alarms") {
        await page.locator("#status-line a.status-term").first().click()
        await page.waitForSelector(".glossary .is-target")
        assert.match(await page.locator(".glossary .is-target").getAttribute("id"), /^g-/)
      }
    })
  }
  await scenario("comparison_real_select_controls_clear_population_and_unsupported_emphasis", async (page) => {
    await load(page, "#/compare", "#compare-task")
    await page.locator("#compare-task").selectOption(task.id)
    await page.waitForFunction(() => document.getElementById("compare-scope").dataset.n === "1")
    await page.locator("#compare-task").selectOption("")
    await page.waitForFunction(() => !location.hash.includes("task="))
    await load(page, "#/compare?task=00000000000000000000000000000000", "#comparison-conclusion")
    assert.match(await page.locator("#comparison-conclusion").innerText(), /No recorded task matches/)
    await page.getByRole("button", { name: "Clear filters", exact: true }).click()
    await page.waitForFunction(() => !location.hash.includes("task="))
    await load(page, "#/compare?category=waste:defects", "#compare-category")
    if (await page.locator("#compare-emphasis-note").count()) {
      assert.match(await page.locator("#compare-emphasis-note").innerText(), /nothing is emphasized/)
    }
    await page.getByRole("button", { name: "Clear emphasis", exact: true }).click()
    await page.waitForFunction(() => !location.hash.includes("category="))
  })
  for (const resolution of [null, 1000, "legacy"]) {
    await scenario(`recorded_binned_shared_session_${resolution}`, async (page, context) => {
      const detail = structuredClone(labeled.detail)
      detail.labels_from_shared_session = true; detail.intervals_binned = true
      delete detail.resolution_ms; delete detail.resolution
      if (resolution === "legacy") detail.resolution = 1000
      else if (resolution !== null) detail.resolution_ms = resolution
      await fixtureJson(context, `jobs/${labeled.job.id}/${detail.session}.json`, detail)
      await load(page, `#/task/${labeled.job.id}/session/${detail.session}?stretch=1`, "#swimlane .lane-plot svg")
      assert.match(await page.locator("#swimlane").innerText(), /shared session/)
      assert.match(await page.locator("#swimlane").innerText(), /published binned/)
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.match(await page.locator("#evidence-drawer").textContent(), /These labels come from a session this task shared/)
      await closeDrawer(page)
      const stretches = page.locator("#swimlane .lane-stretch")
      await stretches.first().focus()
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("Home")
      await page.keyboard.press("End")
      assert.ok(await page.evaluate(() => document.activeElement.matches(".lane-stretch")))
    })
  }
  await scenario("clock_deep_links_folded_waits_and_unavailable_selections", async (page) => {
    for (const selection of ["prompt=1", "pr=1", "gaps=1"]) {
      await load(page, `#/task/${task.id}?${selection}`, "#vsm .vsm")
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.ok((await page.locator("#drawer-title").innerText()).trim())
      await closeDrawer(page)
    }
    await load(page, `#/task/${task.id}?bursts=999999`, "#vsm .vsm")
    await page.waitForSelector(".selection-unavailable")
    assert.match(await page.locator(".selection-unavailable").innerText(), /No substitute item/)
    await load(page, `#/task/${task.id}?prompt=999999`, "#vsm .vsm")
    await page.waitForSelector(".selection-unavailable")
    assert.equal(await page.locator("#evidence-drawer").evaluate((d) => d.open), false)
  }, { viewport: { width: 390, height: 900 } })
  await scenario("individual_prompt_pr_table_and_ladder_group_are_actual_buttons", async (page) => {
    const single = data.jobs.find((j) => maps.get(j.id)?.human_turns?.length === 1)
    assert.ok(single, "the real corpus contains a single-prompt task")
    await load(page, `#/task/${single.id}`, "#vsm .vsm")
    await openEvidence(page, "#vsm .vsm-op", 1)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    for (const details of await page.locator("#vsm details").all()) {
      if (!await details.evaluate((d) => d.open)) await details.locator(":scope > summary").click()
    }
    const prs = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Pull requests on the task clock", exact: true }) })
    const pr = prs.locator("button.link-button").first()
    assert.ok(await pr.count(), "a published PR has its own actual evidence control")
    await pr.click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#evidence-drawer").textContent(), /Pull request/)
    await closeDrawer(page)
    await openEvidence(page, "#vsm .lad-group", 8)
    await openEvidence(page, "#vsm .lad-tick", 8)
  })
  await scenario("drawer_clipboard_denial_selects_the_complete_real_prompt", async (page, context) => {
    await context.addInitScript(() => { window.fixtureClipboardDenied = true })
    await load(page, `#/task/${task.id}?prompt=1`, "#vsm .vsm")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    await page.locator("#evidence-drawer .drawer-prompt button").click()
    assert.match(await page.locator("#evidence-drawer .copy-status").innerText(), /Copy failed/)
    assert.equal(await page.evaluate(() => window.getSelection().toString()), await page.locator("#evidence-drawer .prompt-text").innerText())
    assert.ok((await page.locator("#evidence-drawer .prompt-text").innerText()).length > 30)
  })
  for (const kind of ["abort", "invalid_json"]) await scenario(`unreadable_walk_response_${kind}`, async (page, context) => {
    await context.route(`**/map/${task.id}.json`, (route) => kind === "abort" ? route.abort("failed") : route.fulfill({ contentType: "application/json", body: "{" }))
    await load(page, `#/task/${task.id}`, "#task-head")
    await page.waitForFunction(() => /value stream map is not published/.test(document.getElementById("vsm").innerText))
    assert.equal(await page.locator("#vsm .vsm").count(), 0)
  })
  await scenario("comparison_history_denial_falls_back_to_the_actual_hash_router", async (page, context) => {
    await context.addInitScript(() => {
      history.pushState = () => { throw new DOMException("Synthetic sandbox refusal", "SecurityError") }
    })
    await load(page, "#/compare", "#compare-task")
    await page.locator("#compare-task").selectOption(task.id)
    await page.waitForFunction(() => location.hash.includes("task=") && document.getElementById("compare-scope").dataset.n === "1")
    assert.match(await page.locator("#compare-scope").innerText(), /1 of/)
  })
  await scenario("comparison_missing_history_dom_is_isolated_after_a_real_filter_change", async (page) => {
    await load(page, "#/compare", "#compare-task")
    await page.locator("#over-time").evaluate((node) => node.remove())
    await page.locator("#compare-task").selectOption(task.id)
    await page.waitForFunction(() => /This part could not be drawn/.test(document.getElementById("stackup").innerText))
    await page.locator("nav.steps a").filter({ hasText: /^Tasks$/ }).click()
    await page.waitForSelector("#view-tasks:not([hidden])")
    assert.ok((await page.locator("#task-list").innerText()).trim())
  })
  for (const mode of ["absent", "empty", "waiting_only"]) await scenario(`cause_ranking_unavailable_or_empty_${mode}`, async (page, context) => {
    if (mode === "absent") await context.route("**/rollups/causes.json", (route) => route.fulfill({ status: 404, body: "not published" }))
    else await fixtureJson(context, "rollups/causes.json", { ...causeDoc, causes: mode === "empty" ? [] : causeDoc.causes.filter((c) => c.cause.startsWith("waiting:")) })
    await load(page, "#/causes", "#pareto")
    if (mode === "waiting_only") {
      await page.locator('#view-causes button[data-mode="working"]').click()
      await page.waitForFunction(() => /No labeled waste/.test(document.getElementById("pareto").innerText))
    } else {
      await page.waitForFunction(() => /not published|No cause of waste/.test(document.getElementById("pareto").innerText))
    }
    const key = causeDoc.causes.find((c) => !c.cause.startsWith("waiting:")).cause
    await load(page, `#/causes/${encodeURIComponent(key)}`, "#cause-detail")
    await page.waitForFunction(() => /not published|not in the ranking/.test(document.getElementById("cause-detail").innerText))
  })
  for (const verification of ["verified", "unavailable", "not_recorded"]) await scenario(`improvement_empty_and_owned_alarm_limits_${verification}`, async (page, context) => {
    const d = structuredClone(data)
    d.kaizen_issues = []; d.kaizen = { ...d.kaizen, verification }
    d.fix_next = []; d.andon_issues = []; d.capture_coverage.alarms = []
    d.loop_health.alarms = []; d.loop_health.verdict = { status: verification === "verified" ? "healthy" : "cannot_tell", missing: [] }
    d.improvements = null
    d.alarm_issues_verification = verification
    if (verification === "not_recorded") delete d.alarm_issues
    else if (verification === "verified") {
      d.loop_health.alarms = [{ code: "steps_stale" }]
      d.alarm_issues = [{ ref: "ourostack/factory#2", url: "https://github.com/ourostack/factory/issues/2", issue_state: "open", keys: ["loop:steps_stale"] }]
    } else d.alarm_issues = []
    await fixtureJson(context, "data.json", d)
    await load(page, "#/improvements", "#problems")
    await page.waitForFunction(() => /No kaizen|could not be checked/.test(document.getElementById("problems").innerText))
    const owners = await page.locator("#alarm-owners").innerText()
    assert.match(owners, verification === "verified" ? /owns/ : verification === "unavailable" ? /not checked/ : /did not look/)
    if (verification === "verified") assert.match(await page.locator("#improvement-alarm-list").innerText(), /Owned by public issue/)
    else assert.match(await page.locator("#improvement-alarm-list").innerText(), /health is not recorded/)
  })
  await scenario("store_optional_harness_and_attention_figures_remain_honest", async (page, context) => {
    const d = structuredClone(data)
    for (const harness of d.harnesses) { harness.unproven = true; harness.agent_types = {}; harness.models = {} }
    d.outcomes.rework.reason_check.compared = measured(2)
    d.outcomes.human_time_per_accepted = measured(1000)
    d.loop_health.headless = []
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#view-store")
    assert.match(await page.locator("#view-store").textContent(), /unproven|Unproven/)
    assert.match(await page.locator("#view-store").textContent(), /none recorded/)
  })
  await scenario("failed_data_route_popstate_remains_usable", async (page, context) => {
    await context.route("**/data.json", (route) => route.fulfill({ status: 503, body: "source unavailable" }))
    await page.goto(base + "#/help")
    await page.waitForSelector("#help-stops a")
    await page.getByRole("link", { name: "Understand a task", exact: true }).click()
    await page.waitForFunction(() => document.body.dataset.view === "tasks")
    await page.goBack()
    await page.waitForFunction(() => document.body.dataset.view === "help")
    assert.match(await page.locator("#status-line").innerText(), /could not be loaded/)
  })
  await scenario("real_outside_clock_pr_group_opens_the_margin_list", async (page) => {
    const id = "015ff969ffb5247b877c8cabb9c20967"
    assert.ok(maps.has(id), "the retained source contains the task with nine after-window PR marks")
    await load(page, `#/task/${id}`, "#vsm .vsm")
    const group = page.locator(".vsm-margin-after button.lad-mark-inline[aria-label*='Opens the list']").first()
    assert.ok(await group.count(), "outside-window records have a real grouped margin control")
    await group.click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#evidence-drawer").innerText(), /after|After/)
    assert.ok(await page.locator("#evidence-drawer button.stretch-row").count())
    await closeDrawer(page)
  })
  await scenario("explicit_journey_selection_survives_native_resize", async (page) => {
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    const show = page.locator(".journey-show").first()
    await show.click()
    assert.equal(await show.getAttribute("aria-pressed"), "true")
    await page.setViewportSize({ width: 390, height: 900 })
    await page.waitForTimeout(450)
    assert.ok(await page.locator("#vsm .is-hl").count())
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(450)
    assert.equal(await show.getAttribute("aria-pressed"), "true")
    assert.ok(await page.locator("#vsm .is-hl").count())
  })
  await scenario("compact_comparison_keyboard_focus_and_pointer_tooltips_use_real_geometry", async (page) => {
    await load(page, "#/compare", "#stackup svg")
    assert.ok(await page.locator(".sb-compact").count())
    await page.locator("details.comparison-history > summary").click()
    for (const mode of ["all", "working", "share", "production", "request"]) {
      await page.locator(`#view-compare button[data-mode="${mode}"]`).click()
      for (const selector of ["#stackup svg a", "#ot-bars svg a", "#fe-dots circle[tabindex]"]) {
        const marks = page.locator(selector)
        for (let i = 0; i < Math.min(await marks.count(), 2); i++) {
          const mark = marks.nth(i)
          if (!await mark.isVisible()) continue
          await mark.focus()
          await mark.hover()
          await page.mouse.move(1, 1)
        }
      }
    }
    assert.ok((await page.locator("#stackup-table").innerText()).trim())
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(450)
    await page.setViewportSize({ width: 390, height: 900 })
    await page.waitForTimeout(450)
    assert.ok((await page.locator("#stackup-table").innerText()).trim())
  }, { viewport: { width: 390, height: 900 } })
  await scenario("missing_pr_clock_times_keep_the_recorded_public_reference_states", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    for (const pr of map.prs) {
      if (pr === map.prs[0]) continue
      pr.opened_at_ms = null; pr.opened_state = { state: "unavailable", reasons: [pr === map.prs[1] ? "source_unreadable" : "not_recorded"] }
      if (pr.state === "merged") { pr.merged_at_ms = null; pr.merged_state = { state: "unavailable", reasons: ["source_unreadable"] } }
    }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    assert.match(await page.locator("#vsm").textContent(), /time not recorded/)
    const section = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Pull requests on the task clock", exact: true }) })
    for (const details of await section.locator("details").all()) {
      if (!await details.evaluate((node) => node.open)) await details.locator(":scope > summary").click()
    }
    await section.locator("button.link-button").first().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#evidence-drawer").innerText(), /Pull request/)
    assert.equal(await page.locator("#evidence-drawer a[target='_blank']").first().getAttribute("href"), `https://github.com/${map.prs[0].repo}/pull/${map.prs[0].number}`)
    await closeDrawer(page)
  })
  await scenario("recorded_investigation_task_link_has_a_real_return_path", async (page) => {
    const cause = causeDoc.causes.find((c) => c.jobs?.length && !c.cause.startsWith("waiting:"))
    assert.ok(cause)
    await load(page, `#/causes/${encodeURIComponent(cause.cause)}`, "#cause-detail")
    const link = page.locator("#cause-detail a[href^='#/task/']").first()
    assert.ok(await link.count())
    await link.click()
    await page.waitForSelector("#view-task:not([hidden])")
    await closeDrawer(page)
    const back = page.getByRole("link", { name: "Return to the investigation", exact: true })
    assert.ok(await back.isVisible())
    await back.click()
    await page.waitForSelector("#view-cause:not([hidden])")
    assert.match(await page.locator("#cause-detail").innerText(), /finding|cause|waste|working|Waiting/i)
  })
  await scenario("historical_native_steps_scan_and_named_failure_keep_help_usable", async (page, context) => {
    const legacy = execFileSync("git", ["show", "51b9f859e273923fff75712b84311c74a913a04a:site/src/steps.js"], {
      cwd: new URL("../../../", import.meta.url).pathname, encoding: "utf8",
    })
    assert.ok(!legacy.includes("scan_jobs:") && legacy.includes("causeDetail"), "the fixture is the genuine preceding public Steps API")
    await context.route("**/steps.js", (route) => route.fulfill({ contentType: "application/javascript", body: legacy }))
    const why = causeDoc.causes.flatMap((c) => c.children || []).find((c) => c.cause !== "waiting:next_prompt:not_known")
    assert.ok(why)
    await load(page, `#/causes/${encodeURIComponent(why.cause)}`, "#cause-detail")
    await writeFile(join(out, "legacy-steps-dom.html"), await page.content())
    actions.push({ legacyStepsCommit: "51b9f859e273923fff75712b84311c74a913a04a", legacyCauseBody: await page.locator("#cause-detail").innerText() })
    await page.waitForFunction(() => /whyWaitsSummary/.test(document.getElementById("cause-detail").innerText))
    assert.match(await page.locator("#cause-detail").innerText(), /could not be drawn/)
    await page.getByRole("link", { name: "Help", exact: true }).click()
    await page.waitForSelector("#view-help:not([hidden])")
    assert.ok((await page.locator("#help-stops").innerText()).trim())
  })
  await scenario("hosted_origin_never_reads_the_local_private_name_projection", async (page, context) => {
    const paths = []
    page.on("request", (request) => paths.push(new URL(request.url()).pathname))
    await context.route("http://factory.invalid/**", (route) => {
      const request = new URL(route.request().url())
      return route.fallback({ url: new URL(request.pathname + request.search, base).href })
    })
    await page.goto(`http://factory.invalid/#/task/${task.id}`)
    await page.waitForSelector("#task-head .task-title")
    assert.equal(await page.evaluate(() => location.hostname), "factory.invalid")
    assert.equal(paths.includes("/local-names.json"), false)
    assert.ok((await page.locator("#task-head .task-title").innerText()).trim())
  })
  await scenario("optional_preference_status_nodes_can_disappear_without_losing_the_control", async (page) => {
    await load(page, "#/", "#overview-state")
    await page.locator("summary").filter({ hasText: /Time zone/ }).first().click()
    await page.locator("#preferences-status").evaluate((node) => node.remove())
    await page.locator("#zone-saved").evaluate((node) => node.remove())
    await page.locator("#zone-current").evaluate((node) => node.remove())
    await page.locator("#display-zone").selectOption("UTC")
    assert.equal(await page.locator("#display-zone").inputValue(), "UTC")
    await page.locator("nav.steps a").filter({ hasText: /^Tasks$/ }).click()
    await page.waitForSelector("#view-tasks:not([hidden])")
    await page.waitForFunction(() => document.getElementById("task-list").innerText.trim().length > 0)
    assert.ok((await page.locator("#task-list").innerText()).trim())
  })
  await scenario("real_svg_tooltip_handles_zero_popup_geometry_without_changing_the_figure", async (page) => {
    await load(page, "#/compare", "#stackup svg a")
    await page.locator("#tooltip").evaluate((node) => { node.style.display = "none" })
    const mark = page.locator("#stackup svg a").first()
    await mark.focus()
    await mark.hover()
    assert.ok((await page.locator("#tooltip").textContent()).trim())
    assert.doesNotMatch(await page.locator("#tooltip").textContent(), /NaN|Infinity/)
    await page.locator("#tooltip").evaluate((node) => { node.style.removeProperty("display") })
    await page.mouse.move(1, 1)
    await mark.focus()
    assert.ok((await page.locator("#tooltip").textContent()).trim())
  })
  for (const failure of ["null", "string", "empty_error"]) await scenario(`native_dom_construction_failure_isolated_after_control_change_${failure}`, async (page, context) => {
    await context.addInitScript(() => {
      const create = document.createElement.bind(document)
      document.createElement = (tag, ...args) => {
        if (window.fixtureFailDOM && tag === "table") {
          const kind = window.fixtureFailDOM
          window.fixtureFailDOM = null
          if (kind === "null") throw null
          if (kind === "string") throw "Synthetic DOM construction refusal"
          throw new Error("")
        }
        return create(tag, ...args)
      }
    })
    await load(page, "#/compare", "#compare-task")
    await page.evaluate((value) => { window.fixtureFailDOM = value }, failure)
    await page.locator("#compare-task").selectOption(task.id)
    await page.waitForFunction(() => /This part could not be drawn/.test(document.getElementById("stackup-table").innerText))
    assert.match(await page.locator("#stackup-table").innerText(), /an error/)
    await page.locator("nav.steps a").filter({ hasText: /^Tasks$/ }).click()
    await page.waitForSelector("#view-tasks:not([hidden])")
    await page.waitForFunction(() => document.getElementById("task-list").innerText.trim().length > 0)
    assert.ok((await page.locator("#task-list").innerText()).trim())
  })
  for (const state of ["same", "comparable", "unknown"]) await scenario(`saved_visit_snapshot_is_explicitly_${state}`, async (page, context) => {
    const previous = B.snapshot(data.overview, new Date(Date.now() - 60000).toISOString())
    if (state === "comparable") previous.generation = "factory-site/3:synthetic-earlier-generation"
    if (state === "unknown") previous.generation = "factory-site/3:unknown"
    await context.addInitScript((previous) => {
      localStorage.setItem("factory.preferences/2", JSON.stringify({ schema: "factory.preferences/2", dismissed: false, zone: "UTC", previous }))
    }, previous)
    await load(page, "#/", "#overview-state")
    assert.match(await page.locator("#overview-changes").innerText(), state === "same" ? /same published report generation/ : state === "comparable" ? /snapshot comparison/ : /Comparable previous evidence is unavailable/)
  })
  for (const state of ["available", "no_delivered", "unavailable_delivered"]) await scenario(`attention_answer_source_availability_${state}`, async (page, context) => {
    const d = structuredClone(data)
    if (state === "available") d.outcomes.attention.headline = measured(1000)
    else {
      d.outcomes.attention.headline = { state: "unavailable", reasons: ["not_recorded"] }
      d.outcomes.signoff.accepted = measured(0)
      if (state === "no_delivered") d.outcomes.attention.per_delivered = null
      else d.outcomes.attention.per_delivered = { state: "unavailable", reasons: ["not_recorded"] }
    }
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#answer-tiles")
    assert.match(await page.locator("#answer-tiles").innerText(), /Operator attention per accepted outcome/)
    assert.match(await page.locator("#answer-tiles").innerText(), state === "available" ? /1s|second/ : /none accepted yet/)
  })
  await scenario("preferences_remain_interactive_before_the_data_response_and_without_storage", async (page, context) => {
    let release
    const held = new Promise((resolve) => { release = resolve })
    await context.addInitScript(() => { Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("Synthetic storage refusal", "SecurityError") } }) })
    await context.route("**/data.json", async (route) => { await held; await route.continue() })
    try {
      await page.goto(base + "#/", { waitUntil: "domcontentloaded" })
      await page.waitForSelector("#display-zone option", { state: "attached" })
      await page.locator("summary").filter({ hasText: /Time zone/ }).first().click()
      await page.locator("#display-zone").selectOption("UTC")
      assert.match(await page.locator("#preferences-status").innerText(), /not saved/)
      release()
      await page.waitForSelector("#overview-state")
      assert.match(await page.locator("#zone-saved").innerText(), /storage is unavailable/)
    } finally { release() }
  })
  await scenario("late_optional_mutation_observer_keeps_resize_and_table_evidence", async (page, context) => {
    await context.addInitScript(() => {
      const native = window.MutationObserver
      window.MutationObserver = undefined
      document.addEventListener("DOMContentLoaded", () => { window.MutationObserver = native }, { once: true })
    })
    await load(page, "#/compare", "#stackup-table")
    await page.setViewportSize({ width: 390, height: 900 })
    await page.waitForTimeout(450)
    assert.ok((await page.locator("#stackup-table").innerText()).trim())
  })
  await scenario("recorded_pr_at_a_scoped_session_edge_keeps_its_label_inside_the_plot", async (page, context) => {
    const detail = structuredClone(clockSession.detail)
    const map = structuredClone(maps.get(clockSession.job.id))
    const pr = map.prs.find((pr) => typeof pr.opened_at_ms === "number" && pr.opened_at_ms > detail.offset_ms &&
      pr.opened_at_ms < detail.end_ms && (typeof pr.merged_at_ms !== "number" || pr.merged_at_ms > pr.opened_at_ms + 1))
    assert.ok(pr, "a real independently placed PR opening is in this session")
    // Deliberately scoped source-availability fixture, retaining actual PR
    // anchors and only fully-contained real activity/evaluator intervals.
    detail.end_ms = pr.opened_at_ms + 1
    detail.intervals = detail.intervals.filter((i) => i.end_ms <= detail.end_ms)
    detail.stretches = detail.stretches.filter((s) => s.end_ms <= detail.end_ms)
    map.prs = [pr]
    map.prs_state = { state: "partial", value: 1, reasons: ["source_unreadable"] }
    await fixtureJson(context, `map/${clockSession.job.id}.json`, map)
    await fixtureJson(context, `jobs/${clockSession.job.id}/${detail.session}.json`, detail)
    await load(page, `#/task/${clockSession.job.id}/session/${detail.session}`, "#swimlane .lane-plot svg")
    assert.ok(await page.locator("#swimlane .lane-pr").count())
    assert.equal(await page.locator("#swimlane .lane-pr-label").count(), 1)
    assert.equal(await page.locator("#swimlane .lane-pr-label").getAttribute("text-anchor"), "end")
    for (const width of [390, 320, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(450)
      assert.equal(await page.locator("#swimlane .lane-plot svg").count(), 1)
    }
    await openEvidence(page, "#swimlane .lane-pr", 1, true)
  }, { viewport: { width: 390, height: 900 } })
  await scenario("known_lead_without_work_capture_is_an_unsplit_bar_not_zero_work", async (page, context) => {
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const stack = JSON.parse(await readFile(join(site, "rollups/stackup.json"), "utf8"))
    const row = tasks.jobs.find((r) => r.job === task.id)
    const bar = stack.jobs.find((r) => r.job === task.id)
    assert.ok(row && bar)
    row.working_ms = { state: "unavailable", reasons: ["source_unreadable"] }
    bar.working_ms = { state: "unavailable", reasons: ["source_unreadable"] }
    row.labels_from_shared_session = true
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, "rollups/stackup.json", stack)
    await load(page, `#/task/${task.id}`, "#time-went")
    await page.waitForFunction(() => /No working or waiting part is drawn/.test(document.getElementById("time-went").innerText))
    assert.match(await page.locator("#time-went").innerText(), /split.*not known|splits.*not known/i)
    await load(page, `#/compare?task=${task.id}`, "#stackup svg")
    const link = page.locator("#stackup svg a").first()
    await link.focus()
    await link.hover()
    assert.match(await page.locator("#tooltip").textContent(), /not known|shared session/)
    await page.locator('#view-compare button[data-mode="share"]').click()
    assert.match(await page.locator("#stackup").textContent(), /Split not known/)
  })
  for (const state of ["absent", "unlabeled", "unknown_class"]) await scenario(`legacy_store_label_availability_${state}`, async (page, context) => {
    const d = structuredClone(data), j = state === "unknown_class" ? d.jobs.find((j) => j.waste?.rows?.length) : d.jobs.find((j) => j.id === task.id)
    assert.ok(j)
    if (state === "absent") delete j.waste
    else if (state === "unlabeled") j.waste = { ...j.waste, rows: [], sessions_share_unknown: measured(0) }
    else {
      assert.ok(j.waste.rows.length)
      j.waste.rows[0].key = "future_waste_class"
      j.waste.rows[0].kind = "unknown"
      j.waste.rows[0].confidence = { high_ms: { state: "unavailable", reasons: ["not_recorded"] } }
    }
    await fixtureJson(context, "data.json", d)
    await context.route("**/rollups/stackup.json", (route) => route.fulfill({ status: 404, body: "not published" }))
    await load(page, `#/task/${j.id}`, "#time-went")
    await page.waitForFunction(() => document.getElementById("time-went").innerText.trim().length > 0)
    assert.match(await page.locator("#time-went").innerText(), state === "unknown_class" ? /Unnamed waste|confidence not recorded/ : /Not labeled yet/)
    assert.doesNotMatch(await page.locator("#time-went").innerText(), /NaN|Infinity/)
  })
  await scenario("no_published_detail_for_a_real_span_says_why_stretches_cannot_be_listed", async (page, context) => {
    await fixtureJson(context, `map/${task.id}.json`, { ...maps.get(task.id), detail_files: [] })
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    await page.locator("#vsm .vsm-box").first().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#evidence-drawer").innerText(), /No labeled session file is published/)
    await closeDrawer(page)
  })
  for (const emptySlot of [false, true]) await scenario(`finished_task_with_unavailable_finish_day_${emptySlot ? "empty_slot" : "no_week"}`, async (page, context) => {
    const d = structuredClone(data)
    const j = d.jobs.find((j) => ["done", "cancelled"].includes(j.status))
    assert.ok(j)
    j.finish_date = { state: "unavailable", reasons: ["no_finish_source"] }
    d.jobs = [j]
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    // A one-task source-availability fixture; no duration is invented.
    const slot = weekly.weeks[0]
    weekly.weeks = emptySlot ? [{ week: slot.week, starts_on: slot.starts_on, n: 0, n_partial: 0, jobs: [], lead_ms: measured(0), working_ms: measured(0), idle_ms: measured(0),
      by_class_ms: {}, by_waste_ms: {}, idle_by_waited_on_ms: {}, flow_efficiency: { median: { state: "unavailable", reasons: ["no_measured_members"] }, n: 0, N: 0 } }] : []
    weekly.tasks = []
    weekly.unplaced = { n: 1, jobs: [j.id], reasons: ["no_finish_source"] }
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    await page.waitForSelector(".ot-undated")
    assert.match(await page.locator(".ot-undated").textContent(), /no finish day|not dated/)
    assert.equal(await page.locator(".ot-undated a[href^='#/task/']").count(), 1)
    await page.locator('button[data-over="task"]').click()
    assert.match(await page.locator("#ot-bars").innerText(), emptySlot ? /No finished task with a finish day/ : /No finished task has a finish day/)
  })
  for (const boundary of [0, 1]) await scenario(`synthetic_numeric_envelope_boundary_${boundary}`, async (page, context) => {
    const transform = (value) => {
      if (!value || typeof value !== "object") return value
      if (Array.isArray(value)) return value.map(transform)
      if (["measured", "partial"].includes(value.state) && typeof value.value === "number") return { ...value, value: boundary }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child)]))
    }
    // Explicit numeric boundary fixtures, not remeasured task history.
    await fixtureJson(context, "data.json", transform(data))
    for (const file of ["rollups/tasks.json", "rollups/stackup.json", "rollups/by_week.json"]) {
      await fixtureJson(context, file, transform(JSON.parse(await readFile(join(site, file), "utf8"))))
    }
    for (const [hash, target] of [["#/store", "#view-store"], [`#/task/${task.id}`, "#task-head"], ["#/compare", "#stackup"]]) {
      await load(page, hash, target)
      assert.ok((await page.locator(target).innerText()).trim())
      assert.doesNotMatch(await page.locator(target).innerText(), /NaN|Infinity/)
    }
    await page.locator("details.comparison-history > summary").click()
    for (const mode of ["all", "working", "share"]) await page.locator(`button[data-otmode="${mode}"]`).click()
    assert.doesNotMatch(await page.locator(".comparison-history").innerText(), /NaN|Infinity/)
  })
  await scenario("actual_category_emphasis_changes_no_task_population", async (page) => {
    await load(page, "#/compare", "#compare-category")
    const category = await page.locator("#compare-category option").evaluateAll((options) => options.find((o) => o.value)?.value)
    assert.ok(category)
    const population = await page.locator("#compare-scope").getAttribute("data-n")
    await page.locator("#compare-category").selectOption(category)
    await page.waitForSelector("#stackup .category-muted")
    assert.equal(await page.locator("#compare-scope").getAttribute("data-n"), population)
    await page.getByRole("button", { name: "Clear emphasis", exact: true }).click()
    await page.waitForFunction(() => !location.hash.includes("category="))
    assert.equal(await page.locator("#compare-scope").getAttribute("data-n"), population)
  })
  for (const variant of ["claimed_public_context", "withdrawn_related", "empty_review"]) await scenario(`validated_public_triage_presentation_${variant}`, async (page, context) => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
    const value = structuredClone(fixture.public), publicEvidence = []
    if (variant === "claimed_public_context") {
      const pointer = { kind: "issue", ref: "https://github.com/example/project/issues/1", revision: 1 }
      value.rows[0].ownership = "claimed"; value.rows[0].lifecycle = "claimed"
      value.rows[0].route = "investigate"; value.rows[0].gate = null
      value.rows[0].evidence = [pointer]; value.rows[0].basis.evidence_revisions = [pointer]
      publicEvidence.push({ ...pointer, visibility: "public", label: "Synthetic verified public fixture" })
    } else if (variant === "withdrawn_related") {
      const second = { ...structuredClone(value.rows[0]), id: "fedcba9876543210fedcba9876543210", route: "investigate", gate: null }
      value.rows[0].state = "withdrawn"; value.rows[0].route = null; value.rows[0].gate = null
      value.rows[0].related_ids = [second.id]; second.duplicate_ids = [value.rows[0].id]
      value.rows.push(second); value.coverage.reviewed = 2
    } else {
      value.rows = []; value.coverage.reviewed = 0
    }
    const improvements = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000, publicEvidence })
    assert.equal(validateImprovementQueue(improvements).ok, true)
    const d = { ...data, improvements }
    d.overview = B.buildBriefing({ data: d, improvements, now: 1000, validateQueue: validateImprovementQueue })
    await fixtureJson(context, "data.json", d)
    await load(page, "#/", "#overview-state")
    if (variant === "claimed_public_context") {
      assert.match(await page.locator("#overview-agents").innerText(), /claim is recorded/)
      assert.equal(await page.locator("#overview-agents a[target='_blank']").first().getAttribute("href"), publicEvidence[0].ref)
    }
    await load(page, "#/improvements", "#triage-brief")
    if (variant === "claimed_public_context") {
      assert.equal(await page.locator("#triage-brief a[target='_blank']").first().getAttribute("href"), publicEvidence[0].ref)
    } else if (variant === "withdrawn_related") {
      assert.match(await page.locator("#triage-brief").innerText(), /later publication withdrew/)
      assert.ok(await page.locator(".improvement-links").count())
    } else {
      assert.equal(await page.locator("#triage-brief .improvement-row").count(), 0)
    }
  })
  await scenario("malformed_briefing_is_named_and_other_views_remain_usable", async (page, context) => {
    await fixtureJson(context, "data.json", { ...data, overview: { schema: "unsupported-overview" } })
    await page.goto(base + "#/")
    await page.waitForFunction(() => /briefing.*unavailable or malformed/.test(document.getElementById("overview-state").innerText))
    assert.match(await page.locator("#overview-state").innerText(), /briefing.*unavailable or malformed/)
    await page.locator("nav.steps a").filter({ hasText: /^Tasks$/ }).click()
    await page.waitForFunction(() => document.getElementById("task-list").innerText.trim().length > 0)
    assert.ok((await page.locator("#task-list").innerText()).trim())
  })
  await scenario("legacy_session_reference_without_a_current_task_report_is_text_not_a_guessed_link", async (page, context) => {
    const d = structuredClone(data)
    const session = d.sessions.find((s) => s.session_id === labeled.detail.session)
    assert.ok(session && Array.isArray(session.jobs))
    const id = "00000000000000000000000000000000"
    session.jobs.push({ id })
    await fixtureJson(context, "data.json", d)
    await load(page, `#/task/${labeled.job.id}/session/${session.session_id}`, "#session-detail")
    assert.match(await page.locator("#session-detail").innerText(), /no report in this build/)
    assert.equal(await page.locator(`#session-detail a[href*='${id}']`).count(), 0)
  })
  await scenario("task_with_no_published_session_references_does_not_invent_a_session", async (page, context) => {
    const d = structuredClone(data)
    d.jobs.find((j) => j.id === task.id).sessions = []
    await fixtureJson(context, "data.json", d)
    await load(page, `#/task/${task.id}`, "#job-detail")
    assert.match(await page.locator("#job-detail").innerText(), /No session is on this task's timeline/)
  })
  await scenario("failed_platform_clock_keeps_health_unknown_and_navigation_available", async (page, context) => {
    await context.addInitScript(() => {
      const native = Date.now.bind(Date)
      Date.now = () => {
        const status = document.getElementById("status-line")
        const panel = document.getElementById("health-panel")
        if ((status && !status.childElementCount) || (panel && !panel.childElementCount)) throw new Error("Synthetic unavailable clock during health rendering")
        return native()
      }
    })
    await load(page, "#/store", "#view-store")
    assert.match(await page.locator("#status-line").innerText(), /not watched|not everything|Not monitored|Abnormal/)
    assert.match(await page.locator("#health-panel").innerText(), /could not|unknown|cannot be told/i)
    await page.getByRole("link", { name: "Help", exact: true }).click()
    await page.waitForSelector("#view-help:not([hidden])")
    assert.ok((await page.locator("#help-stops").innerText()).trim())
  })
  await scenario("malformed_session_collection_is_a_named_view_failure_not_a_blank_application", async (page, context) => {
    const d = structuredClone(data)
    d.sessions.find((s) => s.session_id === labeled.detail.session).models = null
    await fixtureJson(context, "data.json", d)
    await page.goto(base + `#/task/${labeled.job.id}/session/${labeled.detail.session}`)
    await page.waitForSelector("#view-missing:not([hidden])")
    assert.match(await page.locator("#view-missing").innerText(), /This view could not be drawn/)
    await page.getByRole("link", { name: "Help", exact: true }).click()
    await page.waitForSelector("#view-help:not([hidden])")
    assert.ok((await page.locator("#help-stops").innerText()).trim())
  })
  await scenario("late_task_map_response_cannot_replace_the_new_task_after_real_navigation", async (page, context) => {
    let release, requested
    const held = new Promise((resolve) => { release = resolve })
    const started = new Promise((resolve) => { requested = resolve })
    await context.route(`**/map/${task.id}.json`, async (route) => { requested(); await held; await route.continue() })
    try {
      await page.goto(base + `#/task/${task.id}`)
      await started
      await page.waitForSelector("#task-head .task-title")
      await page.locator("nav.steps a").filter({ hasText: /^Tasks$/ }).click()
      const next = page.locator(`#task-list a[href^='#/task/']:not([href*='${task.id}'])`).first()
      await next.waitFor()
      const href = await next.getAttribute("href")
      await next.click()
      await page.waitForSelector("#vsm .vsm")
      const shown = await page.locator("#vsm").innerText()
      const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/map/${task.id}.json`))
      release()
      await (await responsePromise).finished()
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.ok(page.url().includes(href))
      assert.equal(await page.locator("#vsm").innerText(), shown)
    } finally { release() }
  })
  await scenario("late_findings_response_cannot_restore_a_previous_view_after_compare_navigation", async (page, context) => {
    let release, requested
    const held = new Promise((resolve) => { release = resolve })
    const started = new Promise((resolve) => { requested = resolve })
    await context.route("**/rollups/causes.json", async (route) => { requested(); await held; await route.continue() })
    try {
      await page.goto(base + "#/causes")
      await started
      await page.waitForSelector("#view-causes:not([hidden])")
      await page.locator("nav.steps a").filter({ hasText: /^Compare$/ }).click()
      await page.waitForSelector("#stackup svg")
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/rollups/causes.json"))
      release()
      await (await responsePromise).finished()
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.locator("body").getAttribute("data-view"), "compare")
      assert.equal(await page.locator("#view-causes").evaluate((node) => node.hidden), true)
      assert.ok(await page.locator("#stackup svg").count())
    } finally { release() }
  })
  await scenario("actual_evaluator_waiting_stretch_has_its_pause_key_label_and_keyboard_evidence", async (page) => {
    const waiting = details.filter(({ detail }) => detail.stretches?.some((s) => s.class === "muda" && s.waste === "waiting"))
      .sort((a, b) => {
        const fraction = ({ detail }) => Math.max(...detail.stretches.filter((s) => s.class === "muda" && s.waste === "waiting")
          .map((s) => (s.end_ms - s.start_ms) / (detail.end_ms - detail.offset_ms)))
        return fraction(b) - fraction(a)
      })[0]
    assert.ok(waiting, "published evaluator evidence includes an actual labeled pause")
    await load(page, `#/task/${waiting.job.id}/session/${waiting.detail.session}`, "#swimlane .lane-plot svg")
    assert.match(await page.locator("#swimlane").innerText(), /labeled waiting|labeled pause/i)
    for (let i = 0; i < 16 && !await page.locator(".lane-wait-label").count(); i++) {
      const zoom = page.getByRole("button", { name: "Zoom in", exact: true })
      if (await zoom.isDisabled()) break
      await zoom.click()
    }
    assert.ok(await page.locator(".lane-wait-label").count(), "real zoom exposes the recorded waiting label")
    const marks = page.locator("#swimlane .lane-stretch")
    await marks.first().focus()
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("End")
    await page.keyboard.press("Home")
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.ok((await page.locator("#drawer-title").innerText()).trim())
    await closeDrawer(page)
    const pause = page.locator('#swimlane .lane-stretch:has(.lane-stretch-rect[fill="url(#hatch-labeled-wait)"])').first()
    await pause.focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.equal(await page.locator(".drawer-what .lane-key-wait").count(), 1)
    assert.match(await page.locator("#drawer-title").innerText(), /pause|waiting/i)
    await closeDrawer(page)
  })
  await scenario("actual_clock_lanes_support_arrow_home_end_and_ignore_other_keys", async (page) => {
    await load(page, `#/task/${clockSession.job.id}/session/${clockSession.detail.session}`, "#swimlane .lane-plot svg")
    for (const selector of ["#swimlane .lane-op", "#swimlane .lane-pr"]) {
      const marks = page.locator(selector)
      if (!await marks.count()) continue
      await marks.first().focus()
      for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "End", "Home", "a"]) {
        await page.keyboard.press(key)
        assert.equal(await page.evaluate((selector) => document.activeElement.matches(selector), selector), true)
      }
      await page.keyboard.press("Enter")
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.ok((await page.locator("#drawer-title").innerText()).trim())
      await closeDrawer(page)
    }
  })
  await scenario("synthetic_large_evidence_list_of_actual_intervals_has_honest_sixty_limit", async (page, context) => {
    const choices = details.flatMap((entry) => (entry.detail.stretches || []).map((stretch, index) => ({
      ...entry, index, count: entry.detail.intervals.filter((i) => i.start_ms < stretch.end_ms && i.end_ms > stretch.start_ms).length,
    }))).sort((a, b) => b.count - a.count)
    const chosen = choices[0]
    assert.ok(chosen.count > 60, "actual published evidence exceeds the disclosure limit")
    const detail = structuredClone(chosen.detail)
    const stretch = detail.stretches[chosen.index]
    // The interval bytes stay actual; only the evaluator's evidence-index
    // list is expanded as an explicit disclosure-limit fixture.
    stretch.evidence = detail.intervals.flatMap((i, k) => i.start_ms < stretch.end_ms && i.end_ms > stretch.start_ms ? [k] : [])
    await fixtureJson(context, `jobs/${chosen.job.id}/${detail.session}.json`, detail)
    await load(page, `#/task/${chosen.job.id}/session/${chosen.detail.session}`, "#swimlane .lane-stretch")
    await page.locator("#swimlane .lane-stretch").nth(chosen.index).focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.equal(await page.locator(".drawer-evidence tbody tr").count(), 60)
    assert.match(await page.locator(".drawer-evidence").textContent(), /The first 60 of \d+ are listed/)
    await closeDrawer(page)
  })
  await scenario("real_intermediate_map_with_outside_marks_uses_rows_without_losing_evidence", async (page) => {
    const job = data.jobs.find((j) => j.id === "1f0ae588c4005f5834263305eff79640")
    assert.ok(job && maps.has(job.id), "actual published outside-clock marks are required")
    await load(page, `#/task/${job.id}`, "#vsm .vsm")
    assert.equal(await page.locator("#vsm .vsm-phone").count(), 1)
    assert.equal(await page.locator("#vsm").evaluate((e) => e.scrollWidth > e.clientWidth + 1), false)
    await openEvidence(page, "#vsm .vsm-box", 1, true)
    await page.setViewportSize({ width: 801, height: 900 })
    await page.waitForTimeout(200)
    assert.equal(await page.locator("#vsm .vsm-phone").count(), 1)
  }, { viewport: { width: 800, height: 900 } })
  await scenario("a_summary_control_without_a_published_map_remains_inert", async (page, context) => {
    await context.route(`**/map/${task.id}.json`, (route) => route.fulfill({ status: 404, body: "not published" }))
    await load(page, `#/task/${task.id}`, "#task-head")
    await page.waitForFunction(() => /map is not published/.test(document.getElementById("vsm").innerText))
    const controls = page.locator("#time-went .tw-part")
    assert.ok(await controls.count())
    await controls.first().click()
    assert.equal(await controls.first().getAttribute("aria-pressed"), "false")
    assert.match(await page.locator("#vsm").innerText(), /not published/)
  })
  await scenario("a_real_map_click_racing_external_invalid_navigation_does_not_write_a_selection", async (page, context) => {
    await context.addInitScript(() => document.addEventListener("click", (event) => {
      if (event.target.closest(".vsm-box")) location.hash = "#unsupported-destination"
    }, { capture: true }))
    await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
    await page.locator("#vsm .vsm-box").first().click()
    await page.waitForFunction(() => document.body.dataset.view === "missing")
    assert.equal(await page.evaluate(() => location.hash), "#unsupported-destination")
    assert.match(await page.locator("#drawer-title").innerText(), /Work|box/i)
  })
  for (const variant of ["jobs_absent", "jobs_empty", "sessions_absent", "trend_absent", "harness_counts_absent", "unknown_outcome", "unknown_trust", "details_absent"]) await scenario(`store_source_boundary_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    if (variant === "jobs_absent") delete d.jobs
    if (variant === "jobs_empty") d.jobs = []
    if (variant === "sessions_absent") delete d.sessions
    if (variant === "trend_absent") delete d.trend
    if (variant === "harness_counts_absent") for (const h of d.harnesses) { delete h.models; delete h.versions }
    if (variant === "unknown_outcome") for (const j of d.jobs) j.outcome = "future_unclassified_outcome"
    if (variant === "unknown_trust") for (const t of d.time_breakdown) t.trust = { ...t.trust, status: "future_unclassified_trust", reason: "" }
    if (variant === "details_absent") for (const j of d.jobs) delete j.details
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#view-store")
    assert.doesNotMatch(await page.locator("#view-store").innerText(), /NaN|Infinity/)
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
    if (!variant.startsWith("jobs_")) {
      await load(page, `#/task/${task.id}`, "#task-head")
      assert.match(await page.locator("#task-head").innerText(), /Task key|task|Task/i)
      assert.doesNotMatch(await page.locator("#job-detail").innerText(), /NaN|Infinity/)
    }
  })
  for (const id of ["evidence-drawer", "main", "map-clear", "comparison-conclusion", "why-toggle", "causes-unlabeled"]) await scenario(`missing_dom_id_${id}_keeps_its_real_boundary_safe`, async (page, context) => {
    const html = await readFile(join(site, "index.html"), "utf8")
    assert.ok(html.includes(`id="${id}"`))
    const damaged = id === "comparison-conclusion"
      ? html.replace(/<p id="comparison-conclusion"[^>]*>[\s\S]*?<\/p>/, "")
      : html.replace(`id="${id}"`, `id="fixture-missing-${id}"`)
    await context.route("**/", (route) => route.fulfill({ contentType: "text/html", body: damaged }))
    if (id === "comparison-conclusion") {
      await load(page, "#/compare", "#stackup svg")
      assert.ok((await page.locator("#comparison-conclusion").innerText()).trim())
    } else if (id === "map-clear") {
      let release
      const gate = new Promise((resolve) => { release = resolve })
      await context.route(`**/map/${task.id}.json`, async (route) => { await gate; await route.continue() })
      try {
        await page.goto(base + `#/task/${task.id}?bursts=999999`)
        await page.waitForSelector("#navigation-context button")
        await page.locator("#navigation-context button").evaluateAll((buttons) => buttons.forEach((e) => e.remove()))
        release()
        await page.waitForSelector("#vsm .vsm")
      } finally { release() }
      await page.waitForFunction(() => /not published|not found|no longer|not present|not available/i.test(document.getElementById("navigation-context").innerText))
      assert.equal(await page.locator("#map-clear").count(), 0)
    } else if (id === "why-toggle" || id === "causes-unlabeled") {
      await load(page, "#/causes", "#pareto svg")
      assert.equal(await page.locator(`#${id}`).count(), 0)
    } else if (id === "evidence-drawer") {
      await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
      await page.locator("#vsm .vsm-box").first().click()
      assert.equal(await page.locator("#fixture-missing-evidence-drawer").evaluate((e) => e.open), false)
    }
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
    if (id === "main") {
      await page.locator(".skip-link").focus()
      await page.keyboard.press("Enter")
      assert.equal(await page.locator("body").getAttribute("data-view"), "help")
    }
  })
  await scenario("a_heading_removed_while_actual_map_data_is_loading_keeps_the_conclusion_readable", async (page, context) => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    await context.route(`**/map/${task.id}.json`, async (route) => { await gate; await route.continue() })
    try {
      await page.goto(base + `#/task/${task.id}`)
      await page.waitForSelector("#task-head .task-title")
      await page.locator("#task-head").evaluate((e) => {
        const stale = document.createElement("p"); stale.className = "task-conclusion"
        stale.textContent = "Synthetic stale conclusion inserted while the source was pending"
        e.appendChild(stale)
      })
      await page.locator("#task-head .task-title").evaluate((e) => e.remove())
      release()
      await page.waitForSelector(".task-summary .task-conclusion")
      assert.ok((await page.locator(".task-summary .task-conclusion").innerText()).trim())
      assert.equal(await page.locator("#task-head .task-title").count(), 0)
      assert.doesNotMatch(await page.locator("#view-task").textContent(), /Synthetic stale conclusion/)
    } finally { release() }
  })
  await scenario("damaged_chart_styles_use_numeric_fallbacks_instead_of_invalid_figures", async (page, context) => {
    await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style")
      style.textContent = "td, svg text {font-size:0px!important} #view-store svg, #stackup svg, #pareto svg {width:1px!important;height:1px!important} #vsm {width:0px!important;min-width:0px!important}"
      document.head.appendChild(style)
    }))
    await load(page, "#/store", "#view-store")
    assert.doesNotMatch(await page.locator("#view-store").innerText(), /NaN|Infinity/)
    await load(page, "#/compare", "#stackup")
    assert.doesNotMatch(await page.locator("#stackup").textContent(), /NaN|Infinity/)
    await load(page, `#/task/${task.id}`, "#task-head")
    await page.waitForFunction(() => document.getElementById("vsm").textContent.trim().length > 0)
    assert.doesNotMatch(await page.locator("#vsm").textContent(), /NaN|Infinity/)
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  await scenario("a_selected_real_summary_survives_a_large_responsive_map_redraw", async (page) => {
    await load(page, "#/task/1f0ae588c4005f5834263305eff79640", "#vsm .vsm")
    const control = page.locator(".journey-show").first()
    await control.click()
    assert.equal(await control.getAttribute("aria-pressed"), "true")
    assert.ok(await page.locator("#vsm .is-hl").count())
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForSelector("#vsm .vsm-phone")
    assert.ok(await page.locator("#vsm .is-hl").count())
    assert.equal(await control.getAttribute("aria-pressed"), "true")
  }, { viewport: { width: 1920, height: 900 } })
  for (const withParent of [false, true]) await scenario(`actual_why_class_in_a_synthetic_top_level_projection_${withParent}`, async (page, context) => {
    const doc = structuredClone(causeDoc)
    const parent = doc.causes.find((c) => c.cause === "waiting:next_prompt")
    const child = parent.children.find((c) => c.cause !== "waiting:next_prompt:not_known" && c.total_ms > 0)
    assert.ok(child)
    // Actual class amounts, projected at the top level only as a schema
    // boundary fixture; this is not a new historical/global measurement.
    doc.causes = withParent ? [parent, structuredClone(child)] : [structuredClone(child)]
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, "#/causes", "#pareto svg")
    assert.match(await page.locator("#pareto-table").textContent(), /next prompt/i)
    await page.goto(base + `#/causes/${child.cause}`)
    await page.waitForSelector("#cause-detail h1")
    assert.ok((await page.locator("#cause-detail").innerText()).trim())
    assert.doesNotMatch(await page.locator("#cause-detail").innerText(), /NaN|Infinity/)
  })
  for (const variant of ["lower", "upper", "unknown", "null_bound", "no_bound", "unavailable", "zero"]) await scenario(`stated_numeric_envelope_across_real_routes_${variant}`, async (page, context) => {
    const transform = (value) => {
      if (!value || typeof value !== "object") return value
      if (Array.isArray(value)) return value.map(transform)
      const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v)]))
      if (["measured", "partial", "unavailable"].includes(value.state) && typeof value.value === "number") {
        if (variant === "unavailable") { out.state = "unavailable"; delete out.value; delete out.bound; out.reasons = [] }
        else if (variant === "zero") { out.state = "measured"; out.value = 0; delete out.bound; out.reasons = [] }
        else {
          out.state = "partial"; out.reasons = []
          if (variant === "no_bound") delete out.bound
          else if (variant === "null_bound") out.bound = null
          else out.bound = variant
        }
      }
      return out
    }
    // Synthetic stated-envelope boundaries over the actual payload, never
    // remeasurement or performance evidence. Bare recorded times stay actual.
    const cache = new Map()
    await context.route("**/*.json", async (route) => {
      const file = new URL(route.request().url()).pathname.slice(1)
      const path = resolve(site, file)
      if (!path.startsWith(site + sep)) return route.continue()
      try {
        if (!cache.has(file)) cache.set(file, transform(JSON.parse(await readFile(path, "utf8"))))
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(cache.get(file)) })
      } catch { await route.continue() }
    })
    const routes = [
      ["#/store", "store"], [`#/task/${task.id}`, "task"],
      [`#/task/${labeled.job.id}/session/${labeled.detail.session}`, "session"],
      ["#/compare", "compare"], ["#/compare?mode=working", "compare"], ["#/compare?mode=share", "compare"],
      ["#/compare?mode=production", "compare"], ["#/compare?mode=request", "compare"],
      ["#/causes", "causes"], ["#/causes?mode=working", "causes"],
      ["#/causes/waiting:next_prompt", "cause"], ["#/improvements", "act"],
    ]
    for (const [hash, view] of routes) {
      await load(page, hash, `#view-${view}`)
      assert.equal(await page.locator("body").getAttribute("data-view"), view)
      assert.doesNotMatch(await page.locator(`#view-${view}`).innerText(), /NaN|Infinity/)
      if (variant === "zero" && view === "task") assert.match(await page.locator("#time-went").innerText(), /share of lead time not known/)
    }
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  for (const availability of ["actual", "one_map_absent", "all_maps_absent"]) await scenario(`phone_actual_why_class_map_availability_${availability}`, async (page, context) => {
    const parent = causeDoc.causes.find((c) => c.cause === "waiting:next_prompt")
    const child = parent.children.find((c) => c.cause !== "waiting:next_prompt:not_known" && c.total_ms > 0)
    assert.ok(child && child.jobs.length)
    if (availability === "one_map_absent") await context.route(`**/map/${child.jobs[0]}.json`, (r) => r.fulfill({ status: 404, body: "not published" }))
    if (availability === "all_maps_absent") await context.route("**/map/*.json", (r) => r.fulfill({ status: 404, body: "not published" }))
    await load(page, `#/causes/${child.cause}`, "#why-waits-title")
    assert.ok(await page.locator(".cause-tasks .cell-day").count())
    if (availability !== "actual") assert.match(await page.locator("#cause-detail").innerText(), /map file.*not published/)
    if (availability === "all_maps_absent") assert.match(await page.locator("#cause-detail").innerText(), /No recorded wait holds this time/)
  }, { viewport: { width: 390, height: 844 } })
  await scenario("recorded_cause_without_projected_spans_says_the_spans_are_not_listed", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const row = doc.causes.find((c) => !c.cause.startsWith("waiting:next_prompt:") && c.total_ms > 0)
    row.spans = []
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, `#/causes/${row.cause}`, "#cause-detail .cause-title")
    await page.waitForFunction(() => /Desk lists no stretch/.test(document.getElementById("cause-detail").innerText))
    assert.match(await page.locator("#cause-detail").innerText(), /Desk lists no stretch/)
  })
  await scenario("unverified_recorded_issues_and_a_synthetic_cause_mapping_keep_review_limits", async (page, context) => {
    const d = structuredClone(data)
    const open = d.kaizen_issues.find((i) => i.issue_state === "open" && !i.resolution?.url)
    assert.ok(open)
    open.cause = "waiting:next_prompt"
    d.kaizen = { ...d.kaizen, verification: "unavailable" }
    await fixtureJson(context, "data.json", d)
    await load(page, "#/causes/waiting:next_prompt", ".taken-on")
    assert.match(await page.locator(".taken-on").innerText(), /; /)
    assert.match(await page.locator(".taken-on").innerText(), /no countermeasure yet/)
    await load(page, "#/improvements?cause=waiting:next_prompt", "#problems")
    assert.match(await page.locator("#problems").innerText(), /GitHub could not be reached/)
    assert.match(await page.locator(".act-cause-addressed").innerText(), /published improvement issues/)
  })
  await scenario("empty_task_projection_has_no_stackup_and_no_unlabeled_list", async (page, context) => {
    const d = structuredClone(data); d.jobs = []
    await fixtureJson(context, "data.json", d)
    for (const file of ["rollups/tasks.json", "rollups/stackup.json"]) {
      const doc = JSON.parse(await readFile(join(site, file), "utf8")); doc.jobs = []
      await fixtureJson(context, file, doc)
    }
    await load(page, "#/compare", "#stackup")
    await page.waitForFunction(() => /No selected task has a bar/.test(document.getElementById("stackup").innerText))
    assert.match(await page.locator("#stackup").innerText(), /No selected task has a bar/)
    await load(page, "#/causes", "#pareto")
    assert.equal(await page.locator("#causes-unlabeled").isVisible(), false)
  })
  await scenario("capture_machine_breakdown_not_projected_is_not_a_fabricated_count", async (page, context) => {
    const d = structuredClone(data)
    d.capture_coverage.machines = {}
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#capture-coverage")
    assert.match(await page.locator("#capture-coverage").textContent(), /Machines' records/)
    assert.doesNotMatch(await page.locator("#capture-coverage").textContent(), /undefined|NaN|Infinity/)
  })
  await scenario("a_crowded_flattened_actual_why_projection_retains_full_names_behind_clipped_labels", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const parent = doc.causes.find((c) => c.cause === "waiting:next_prompt")
    const children = parent.children.filter((c) => c.total_ms > 0)
    doc.causes = [...children, ...doc.causes.filter((c) => c.cause !== parent.cause).slice(0, 10 - children.length)]
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, "#/causes", "#pareto svg")
    const names = await page.locator("#pareto .pareto-name").allTextContents()
    assert.ok(names.some((name) => name.includes("…")))
    const link = page.locator('#pareto a[aria-label*="interrupted"]')
    await link.hover()
    assert.match(await page.locator("#tooltip").textContent(), /interrupted by the operator/i)
  }, { viewport: { width: 800, height: 900 } })
  await scenario("an_aria_disabled_why_toggle_ignores_real_keyboard_activation", async (page, context) => {
    const doc = structuredClone(causeDoc)
    delete doc.causes.find((c) => c.cause === "waiting:next_prompt").children
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, "#/causes", "#pareto svg")
    const toggle = page.locator("#why-toggle")
    assert.equal(await toggle.getAttribute("aria-disabled"), "true")
    const before = await page.locator("#pareto").textContent()
    await toggle.focus()
    await page.keyboard.press("Space")
    assert.equal(await toggle.getAttribute("aria-pressed"), "false")
    assert.equal(await page.locator("#pareto").textContent(), before)
  })
  await scenario("a_real_pointer_at_zero_coordinates_uses_the_tooltip_geometry_fallback", async (page) => {
    await load(page, "#/store", "#chart-time-breakdown .bar-row")
    await page.addStyleTag({ content: "#chart-time-breakdown .bar-row:first-child {position:fixed!important;left:0!important;top:0!important;width:300px!important;z-index:1000!important}" })
    const box = await page.locator("#chart-time-breakdown .bar-row").first().boundingBox()
    assert.equal(box.x, 0); assert.equal(box.y, 0)
    await page.mouse.move(400, 400)
    await page.mouse.move(0, 0)
    assert.ok((await page.locator("#tooltip").innerText()).trim())
    assert.equal(await page.locator("#tooltip").isVisible(), true)
  })
  for (const field of ["sessions", "human_turns", "prs", "detail_files", "lead_window", "bursts_state", "gaps_state"]) await scenario(`actual_map_optional_projection_absent_${field}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id)); delete map[field]
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    assert.doesNotMatch(await page.locator("#vsm").textContent(), /NaN|Infinity/)
    if (field === "detail_files") {
      await page.locator("#vsm .vsm-box").first().click()
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.match(await page.locator("#drawer-body").textContent(), /No labeled session file/)
      await closeDrawer(page)
    }
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  await scenario("a_task_route_without_an_id_is_rejected_instead_of_choosing_unrequested_work", async (page) => {
    await load(page, "#/task", "#view-missing")
    assert.equal(await page.locator("body").getAttribute("data-view"), "missing")
    assert.equal(await page.locator("#task-head").isVisible(), false)
    assert.ok((await page.locator("#view-missing").innerText()).trim())
  })
  for (const path of ["waste_names", "waste_actions", "built_at", "capture_coverage.hosts", "capture_coverage.caveats", "capture_coverage.machines", "capture_coverage.alarms", "loop_health.alarms", "loop_health.notices", "loop_health.verdict", "scope.entrypoints_scoped", "scope.entrypoints_other"]) await scenario(`optional_store_metadata_absent_${path}`, async (page, context) => {
    const d = structuredClone(data), keys = path.split(".")
    const parent = keys.slice(0, -1).reduce((value, key) => value[key], d)
    assert.ok(parent && typeof parent === "object")
    delete parent[keys.at(-1)]
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#view-store")
    assert.doesNotMatch(await page.locator("#view-store").innerText(), /NaN|Infinity/)
    await load(page, `#/task/${task.id}`, "#task-head")
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  await scenario("unknown_loop_alarm_and_notice_keys_are_not_relabeled_as_known", async (page, context) => {
    const d = structuredClone(data)
    d.loop_health.alarms = [{ code: "future_alarm" }]
    d.loop_health.notices = [{ code: "future_notice", machines: measured(1) }]
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#loop-health")
    assert.match(await page.locator("#loop-health").textContent(), /future_alarm/)
    assert.match(await page.locator("#loop-health").textContent(), /future_notice/)
  })
  await scenario("future_weekly_class_keeps_its_amount_and_the_unknown_style_boundary", async (page, context) => {
    const doc = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    const known = doc.classes[0], future = "fixture_future_class"
    assert.ok(known && doc.weeks.some((w) => w.by_class_ms?.[known]?.value > 0))
    doc.classes = doc.classes.map((k) => k === known ? future : k)
    for (const week of doc.weeks) if (week.by_class_ms && known in week.by_class_ms) {
      week.by_class_ms[future] = week.by_class_ms[known]; delete week.by_class_ms[known]
    }
    await fixtureJson(context, "rollups/by_week.json", doc)
    await load(page, "#/compare", "#stackup")
    await page.locator("details.comparison-history > summary").click()
    await page.waitForSelector(`#ot-bars .seg-${future}`)
    assert.match(await page.locator("#ot-bars").textContent(), /fixture_future_class/)
    assert.doesNotMatch(await page.locator("#ot-bars").textContent(), /NaN|Infinity/)
  })
  await scenario("authentic_native_walk_before_unlabeled_api_is_an_explicit_mixed_version_failure", async (page, context) => {
    const ref = "0ea3f1cae50a7f9e020ad6a3f538747f15f033db^:site/src/walk.js"
    const source = execFileSync("git", ["show", ref], { encoding: "utf8" })
    actions.push({ fixture: "authentic_native_walk_before_unlabeled_api", ref,
      blob: execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim() })
    await context.route("**/walk.js", (route) => route.fulfill({ contentType: "text/javascript", body: source }))
    await load(page, `#/task/${task.id}`, "#task-head")
    await page.waitForFunction(() => /could not be drawn/.test(document.getElementById("vsm").textContent))
    assert.match(await page.locator("#vsm").textContent(), /could not be drawn/)
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  await scenario("map_waits_without_a_published_why_keep_the_reason_unknown", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    for (const item of [...map.bursts, ...map.gaps]) delete item.idle_by_why_ms
    map.human_turns = []; map.human_turns_state = { state: "unavailable", reasons: ["source_unreadable"] }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    assert.match(await page.locator("#vsm").textContent(), /Why the agent stopped before each wait.*not known yet/)
  })
  for (const burstCauses of [true, false]) await scenario(`legacy_waiting_split_from_actual_map_${burstCauses}`, async (page, context) => {
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const row = tasks.jobs.find((r) => r.job === task.id); delete row.idle_ms
    const map = structuredClone(maps.get(task.id))
    if (!burstCauses) for (const b of map.bursts) delete b.idle_by_waited_on_ms
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#time-went")
    await page.waitForFunction(() => /waiting split comes from this task's map/.test(document.getElementById("time-went").textContent))
    assert.match(await page.locator("#time-went").textContent(), burstCauses ? /each with what it waited on/ : /idle moments inside bursts as cause not recorded/)
  })
  await scenario("phone_actual_unknown_why_class_keeps_finish_dates_and_review_bounds", async (page) => {
    await load(page, "#/causes/waiting:next_prompt:not_known", "#why-waits-title")
    assert.ok(await page.locator(".cause-tasks .cell-day").count())
    assert.doesNotMatch(await page.locator("#cause-detail").innerText(), /NaN|Infinity/)
  }, { viewport: { width: 390, height: 844 } })
  await scenario("unavailable_clock_notes_remain_readable_on_a_phone", async (page, context) => {
    const map = structuredClone(maps.get(labeled.job.id))
    map.human_turns = []; map.prs = []
    const missing = { state: "unavailable", reasons: ["source_unreadable", "not_in_published_facts", "not_recorded"] }
    map.human_turns_state = missing; map.prs_state = missing
    await fixtureJson(context, `map/${labeled.job.id}.json`, map)
    await load(page, `#/task/${labeled.job.id}/session/${labeled.detail.session}`, "#swimlane .lane-plot svg")
    assert.match(await page.locator("#swimlane").textContent(), /unreadable|not recorded|not published/i)
    assert.equal(await page.locator("#swimlane").evaluate((e) => e.scrollWidth > e.clientWidth + 1), false)
  }, { viewport: { width: 390, height: 844 } })
  await scenario("a_reader_can_reach_the_last_actual_stretch_in_a_zoomed_timeline", async (page) => {
    await load(page, `#/task/${labeled.job.id}/session/${labeled.detail.session}`, "#swimlane .lane-stretch")
    for (let n = 0; n < 5; n++) {
      const zoom = page.getByRole("button", { name: "Zoom in", exact: true })
      if (await zoom.isDisabled()) break
      await zoom.click()
    }
    await page.locator("#swimlane .lane-stretch").first().focus()
    await page.keyboard.press("End")
    assert.ok(await page.locator("#swimlane .lane-frame").evaluate((e) => e.scrollLeft > 0))
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.ok((await page.locator("#drawer-title").textContent()).trim())
  }, { viewport: { width: 390, height: 844 } })
  for (const variant of ["future_partial_buckets", "unreadable_stamp_and_data", "missing_slots_and_data"]) await scenario(`health_real_error_combinations_${variant}`, async (page, context) => {
    const health = JSON.parse(await readFile(join(site, "health.json"), "utf8"))
    health.built_at = new Date().toISOString()
    if (variant === "future_partial_buckets") {
      health.newest_intake = { state: "partial", value: "future_age_bucket", reasons: ["source_unreadable"] }
      health.factory_build = { state: "partial", value: "failure", reasons: ["source_unreadable"] }
    } else {
      if (variant === "unreadable_stamp_and_data") health.built_at = "unreadable-stamp"
      else delete health.slots
      await context.route("**/data.json", (r) => r.fulfill({ status: 503, body: "source unavailable" }))
    }
    await fixtureJson(context, "health.json", health)
    await page.goto(base + "#/store")
    await page.waitForSelector("#health-panel .health-facts")
    if (variant === "future_partial_buckets") {
      assert.match(await page.locator("#health-panel").textContent(), /unrecognized/)
      assert.match(await page.locator("#health-panel").textContent(), /not green/)
      assert.match(await page.locator("#health-panel .verdict").textContent(), /Unknown/)
    } else assert.match(await page.locator("#health-panel .verdict").textContent(), /Broken/)
    if (variant === "unreadable_stamp_and_data") assert.match(await page.locator("#health-panel").textContent(), /build stamp could not be read/)
  })
  await scenario("a_small_actual_pull_request_table_opens_with_its_recorded_times", async (page) => {
    const job = data.jobs.find((j) => {
      const prs = maps.get(j.id)?.prs
      return prs?.length > 0 && prs.length <= 15 && prs.some((p) => typeof p.opened_at_ms === "number")
    })
    assert.ok(job)
    await load(page, `#/task/${job.id}`, ".pr-clock-table")
    assert.equal(await page.locator(".pr-clock-table").evaluate((e) => e.closest("details").open), true)
    await page.locator(".pr-clock-table button").first().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#drawer-title").textContent(), /Pull request/)
  })
  for (const reasons of ["same", "different", "absent"]) await scenario(`unplaced_actual_pr_metadata_${reasons}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.prs = map.prs.slice(0, 3)
    for (const [k, pr] of map.prs.entries()) {
      delete pr.opened_at_ms; delete pr.merged_at_ms
      if (k === 0) pr.state = "open"
      else if (k === 1) pr.state = "closed"
      else delete pr.state
      if (reasons === "absent") { delete pr.opened_state; delete pr.merged_state }
      else {
        const why = reasons === "same" ? ["missing_clock_anchor"] : k === 0 ? [] : ["not_recorded"]
        pr.opened_state = { state: "unavailable", reasons: why }; pr.merged_state = pr.opened_state
      }
    }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .pr-line")
    assert.match(await page.locator("#vsm .pr-line").textContent(), /closed without merging/)
    assert.match(await page.locator("#vsm .pr-line").textContent(), /state not read/)
    if (reasons === "absent") assert.match(await page.locator("#vsm .pr-line").textContent(), /no reason recorded/)
    await page.locator("#vsm .pr-line button").last().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#drawer-title").textContent(), /Pull request/)
  })
  for (const bound of ["upper", "lower", null]) await scenario(`partial_actual_pr_clock_direction_${bound}`, async (page, context) => {
    const map = structuredClone(maps.get(clockSession.job.id))
    const pr = map.prs.find((p) => typeof p.opened_at_ms === "number" && p.opened_at_ms >= clockSession.detail.offset_ms && p.opened_at_ms <= clockSession.detail.end_ms)
    assert.ok(pr)
    map.prs = [pr]
    pr.opened_state = { state: "partial", bound, reasons: [] }
    delete pr.merged_at_ms; pr.merged_state = { state: "unavailable", reasons: [] }
    pr.created = bound === "upper" ? false : bound === "lower" ? true : undefined
    await fixtureJson(context, `map/${clockSession.job.id}.json`, map)
    await load(page, `#/task/${clockSession.job.id}/session/${clockSession.detail.session}`, "#swimlane .lane-pr")
    const label = await page.locator("#swimlane .lane-pr").first().getAttribute("aria-label")
    assert.match(label, bound === "upper" ? /at most/ : bound === "lower" ? /at least/ : /about/)
    assert.match(label, /known only in part/)
    await page.locator("#swimlane .lane-pr").first().focus()
    await page.keyboard.press("Space")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#drawer-title").textContent(), /Pull request/)
  })
  await scenario("a_delayed_actual_cause_response_does_not_populate_a_view_after_leaving_it", async (page, context) => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    await context.route("**/rollups/causes.json", async (route) => { await gate; await route.continue() })
    try {
      await page.goto(base + "#/causes/waiting:next_prompt")
      await page.waitForSelector("#cause-detail .is-loading")
      const response = page.waitForResponse((r) => r.url().endsWith("/rollups/causes.json"))
      await page.locator('nav.steps a[data-destination="#/compare"]').click()
      await page.waitForSelector("#stackup svg")
      release(); await (await response).finished()
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      assert.equal(await page.locator("body").getAttribute("data-view"), "compare")
      assert.equal(await page.locator("#cause-detail .cause-title").count(), 0)
    } finally { release() }
  })
  await scenario("a_delayed_actual_session_response_does_not_draw_after_another_task_is_chosen", async (page, context) => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const file = `jobs/${labeled.job.id}/${labeled.detail.session}.json`
    await context.route(`**/${file}`, async (route) => { await gate; await route.continue() })
    try {
      await page.goto(base + `#/task/${labeled.job.id}/session/${labeled.detail.session}`)
      await page.waitForSelector("#swimlane .is-loading")
      const response = page.waitForResponse((r) => r.url().endsWith("/" + file))
      await page.locator('nav.steps a[data-destination="#/tasks"]').click()
      const next = data.jobs.find((j) => j.id !== labeled.job.id)
      await page.locator(`#task-list a[href^="#/task/${next.id}"]:visible`).first().click()
      await page.waitForSelector("#vsm .vsm")
      release(); await (await response).finished()
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      assert.equal(await page.locator("body").getAttribute("data-view"), "task")
      assert.equal(await page.locator("#swimlane .lane-plot svg").count(), 0)
    } finally { release() }
  })
  await scenario("an_unmodified_actual_task_fit_is_recomputed_when_the_session_frame_resizes", async (page) => {
    const entry = details.find(({ job, detail }) => {
      const w = maps.get(job.id)?.lead_window
      return w && typeof w.start_ms === "number" && typeof w.end_ms === "number" &&
        Math.min(detail.end_ms, w.end_ms) > Math.max(detail.offset_ms, w.start_ms) &&
        Math.min(detail.end_ms, w.end_ms) - Math.max(detail.offset_ms, w.start_ms) < (detail.end_ms - detail.offset_ms) * 0.6
    })
    assert.ok(entry)
    await load(page, `#/task/${entry.job.id}/session/${entry.detail.session}`, "#swimlane .lane-plot svg")
    assert.equal(await page.getByRole("button", { name: "Zoom to this task's part of the session", exact: true }).count(), 1)
    const before = await page.locator("#swimlane .lane-frame").evaluate((e) => e.clientWidth)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)
    assert.notEqual(await page.locator("#swimlane .lane-frame").evaluate((e) => e.clientWidth), before)
    assert.ok(await page.locator("#swimlane .lane-plot svg").count())
    assert.equal(await page.locator("#swimlane").evaluate((e) => e.scrollWidth > e.clientWidth + 1), false)
  })
  await scenario("a_single_actual_known_stop_prompt_names_its_why_on_the_map", async (page, context) => {
    const W = require("../../../site/src/walk.js")
    const entry = [...maps].map(([id, map]) => ({ id, map, clock: W.clockMarks(map, W.mapModel(map)) }))
      .find(({ clock }) => clock.prompts.some((p) => !p.outside && p.why && p.why !== "not_known"))
    assert.ok(entry)
    const prompt = entry.clock.prompts.find((p) => !p.outside && p.why && p.why !== "not_known")
    const map = structuredClone(entry.map)
    map.human_turns = [prompt.turn]
    map.human_turns_state = measured(1)
    await fixtureJson(context, `map/${entry.id}.json`, map)
    await load(page, `#/task/${entry.id}`, "#vsm .vsm-op")
    const marker = page.locator("#vsm .vsm-op")
    assert.equal(await marker.count(), 1)
    assert.match(await marker.getAttribute("title"), /Why the agent had stopped:/)
    await openEvidence(page, "#vsm .vsm-op", 1, true)
  })
  await scenario("one_actual_outside_prompt_keeps_its_margin_tick_and_evidence", async (page, context) => {
    const W = require("../../../site/src/walk.js")
    const entry = [...maps].find(([, map]) => Array.isArray(map.bursts) && map.bursts.length > 1 &&
      map.human_turns?.some((p) => map.bursts.some((b) => b.start_ms > p.at_ms)))
    assert.ok(entry)
    const [id, source] = entry
    const map = structuredClone(source)
    const prompt = map.human_turns.find((p) => map.bursts.some((b) => b.start_ms > p.at_ms))
    map.human_turns = [prompt]
    map.human_turns_state = measured(1)
    // A scoped projection retains a recorded prompt before its remaining
    // recorded work; none of its timestamps or durations is remeasured.
    map.bursts = map.bursts.filter((b) => b.start_ms > prompt.at_ms)
    map.gaps = (map.gaps || []).filter((g) => g.start_ms >= map.bursts[0].start_ms)
    assert.equal(W.clockMarks(map, W.mapModel(map)).prompts[0].outside, "before")
    await fixtureJson(context, `map/${id}.json`, map)
    await load(page, `#/task/${id}`, "#vsm .vsm-margin")
    const marker = page.locator("#vsm .vsm-margin .lad-mark-inline").filter({ has: page.locator(".lad-tick") })
    assert.equal(await marker.count(), 1)
    await marker.click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#drawer-title").innerText(), /Operator prompt/)
    await closeDrawer(page)
  })
  await scenario("actual_box_evidence_omits_session_stretches_outside_its_span", async (page) => {
    const W = require("../../../site/src/walk.js")
    const entry = details.map(({ job, detail }) => ({ job, detail, model: W.mapModel(maps.get(job.id), { maxBoxes: 6 }) }))
      .find(({ detail, model }) => model.items.some((it) => it.type === "box" && it.sessions.includes(detail.session) &&
        detail.stretches?.some((s) => s.end_ms <= it.start_ms || s.start_ms >= it.end_ms) &&
        detail.stretches.some((s) => s.end_ms > it.start_ms && s.start_ms < it.end_ms)))
    assert.ok(entry)
    const box = entry.model.items.find((it) => it.type === "box" && it.sessions.includes(entry.detail.session) &&
      entry.detail.stretches.some((s) => s.end_ms <= it.start_ms || s.start_ms >= it.end_ms) &&
      entry.detail.stretches.some((s) => s.end_ms > it.start_ms && s.start_ms < it.end_ms))
    await load(page, `#/task/${entry.job.id}`, "#vsm .vsm-box")
    await page.locator(`#vsm .vsm-box[data-item="${box.index}"]`).click()
    await page.getByRole("button", { name: "Show the labeled stretches in this span", exact: true }).click()
    await page.waitForSelector("#evidence-drawer .stretch-row")
    assert.ok(await page.locator("#evidence-drawer .stretch-row").count())
    await closeDrawer(page)
  }, { viewport: { width: 390, height: 844 } })
  for (const boundary of ["same_width", "missing_node"]) await scenario(`step_resize_boundary_${boundary}_uses_the_actual_window_event`, async (page) => {
    await load(page, "#/compare", "#stackup svg")
    await page.locator("#stackup").evaluate((e) => { e.dataset.fixtureRetained = "yes" })
    if (boundary === "missing_node") await page.locator("#stackup").evaluate((e) => { e.id = "fixture-disconnected-stackup-id" })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(350)
    const node = page.locator(boundary === "missing_node" ? "#fixture-disconnected-stackup-id" : "#stackup")
    assert.equal(await node.getAttribute("data-fixture-retained"), "yes")
    assert.ok(await node.locator("svg").count())
  })
  await scenario("weekly_known_lead_and_missing_split_have_an_unsplit_hatch_and_no_open_note", async (page, context) => {
    const d = structuredClone(data)
    d.jobs = d.jobs.filter((j) => ["done", "cancelled"].includes(j.status) && j.finish_date?.state === "measured")
    assert.ok(d.jobs.length)
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    weekly.unplaced = { n: 0, jobs: [], reasons: [] }
    const week = weekly.weeks.find((w) => w.n > 0 && w.lead_ms.value > 1000)
    assert.ok(week)
    week.working_ms = { state: "unavailable", reasons: ["source_unreadable"] }
    week.idle_ms = { state: "unavailable", reasons: ["source_unreadable"] }
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    await page.waitForSelector('#ot-bars rect[style*="hatch-unsplit"]')
    assert.doesNotMatch(await page.locator("#over-time-undated").textContent(), /still open/)
    assert.match(await page.locator("#ot-bars").textContent(), /Split not known/)
  })
  await scenario("empty_dated_weeks_with_no_open_task_need_no_unplaced_note", async (page, context) => {
    const d = structuredClone(data)
    d.jobs = []
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    weekly.tasks = []
    weekly.unplaced = { n: 0, jobs: [], reasons: [] }
    for (const week of weekly.weeks) { week.jobs = []; week.n = 0; week.n_partial = 0 }
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    await page.waitForSelector("#ot-bars svg")
    assert.equal(await page.locator("#over-time-undated").textContent(), "")
  })
  await scenario("external_reader_styles_put_ladder_marks_on_distinct_perpendicular_tracks", async (page) => {
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    await page.addStyleTag({ content: ".vsm-row:nth-child(odd) .vsm-marks { transform: translateX(60px); }" })
    await page.setViewportSize({ width: 480, height: 844 })
    await page.waitForTimeout(400)
    assert.ok(await page.locator("#vsm .lad-mark").count())
    await openEvidence(page, "#vsm .lad-mark", 2, true)
  }, { viewport: { width: 390, height: 844 } })
  await scenario("scoped_actual_pr_times_keep_marks_when_large_labels_meet_at_the_right_edge", async (page, context) => {
    const entry = details.find(({ job, detail }) => job.id === "86df72b98beb838965d0bc5c96996d9e" &&
      detail.session === "d0c57c3e-558b-468b-a913-ae1bfc9176be")
    assert.ok(entry)
    const map = structuredClone(maps.get(entry.job.id))
    map.prs = map.prs.filter((pr) => [267, 268].includes(pr.number))
    assert.equal(map.prs.length, 2)
    const detail = structuredClone(entry.detail)
    detail.end_ms = Math.max(...map.prs.map((pr) => pr.opened_at_ms)) + 1
    detail.intervals = detail.intervals.filter((i) => i.end_ms <= detail.end_ms)
    detail.stretches = detail.stretches.filter((s) => s.end_ms <= detail.end_ms)
    for (const pr of map.prs) {
      delete pr.merged_at_ms
      pr.merged_at_state = { state: "unavailable", reasons: ["source_unreadable"] }
    }
    await fixtureJson(context, `map/${entry.job.id}.json`, map)
    await fixtureJson(context, `jobs/${entry.job.id}/${detail.session}.json`, detail)
    await load(page, `#/task/${entry.job.id}/session/${detail.session}`, "#swimlane .lane-plot svg")
    await page.addStyleTag({ content: ".lane-pr-label { font-size: 36px !important; }" })
    for (const width of [900, 1000, 1100, 1200]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(350)
      await page.getByRole("button", { name: "Fit the whole session in the frame", exact: true }).click()
      assert.equal(await page.locator("#swimlane .lane-pr").count(), 2)
      const boxes = await page.locator("#swimlane .lane-pr-label").evaluateAll((nodes) => nodes.map((node) => {
        const b = node.getBBox(); return { x: b.x, width: b.width }
      }))
      if (boxes.length === 2) assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x || boxes[1].x + boxes[1].width <= boxes[0].x)
    }
    await openEvidence(page, "#swimlane .lane-pr", 2, true)
  })
  for (const variant of ["partial_empty_hosts", "malformed_with_data_failure"]) await scenario(`health_source_details_${variant}`, async (page, context) => {
    const health = JSON.parse(await readFile(join(site, "health.json"), "utf8"))
    health.built_at = new Date().toISOString()
    if (variant === "partial_empty_hosts") {
      health.factory_build = { state: "unavailable", reasons: ["not_recorded"] }
      health.newest_intake = { state: "unavailable", reasons: ["not_recorded"] }
      health.facts_by_host = []
      health.slots.synthetic_slot = measured(1)
      health.details = { ...health.details, synthetic_slot: [null, { label: "Synthetic source detail", number: measured(2) }] }
    } else {
      health.facts_by_host = null
      await context.route("**/data.json", (route) => route.fulfill({ status: 503, body: "source unavailable" }))
    }
    await fixtureJson(context, "health.json", health)
    await page.goto(base + "#/store")
    await page.waitForFunction(() => document.getElementById("health-panel").textContent.trim().length > 0)
    if (variant === "partial_empty_hosts") {
      assert.match(await page.locator("#health-panel").textContent(), /none recorded/)
      assert.match(await page.locator("#health-panel").textContent(), /Synthetic source detail/)
    } else {
      assert.match(await page.locator("#health-panel").textContent(), /could not be loaded/)
      assert.equal(await page.locator("#health-panel .health-facts").count(), 0)
    }
  })
  await scenario("malformed_public_queue_rows_are_unavailable_not_inferred_owned_work", async (page, context) => {
    const d = { ...data, improvements: { schema: "factory-improvements/1", state: "reviewed", rows: [null, { unsupported: true }], coverage: {}, runner: {} } }
    await fixtureJson(context, "data.json", d)
    await load(page, "#/improvements", "#triage-brief")
    assert.match(await page.locator("#triage-brief").innerText(), /Public annotation presentation is unavailable/)
    assert.equal(await page.locator("#triage-brief button.copy-prompt").count(), 0)
  })
  await scenario("one_failed_improvement_row_does_not_hide_the_next_valid_row", async (page, context) => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
    const value = structuredClone(fixture.public)
    value.rows.push({ ...structuredClone(value.rows[0]), id: "fedcba9876543210fedcba9876543210", route: "investigate", gate: null })
    value.coverage.reviewed = 2
    const improvements = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000 })
    assert.equal(validateImprovementQueue(improvements).ok, true)
    await fixtureJson(context, "data.json", { ...data, improvements })
    await context.addInitScript(() => {
      const create = document.createElement.bind(document)
      let failed = false
      document.createElement = (tag, ...args) => {
        if (!failed && tag === "section" && document.getElementById("improvement-question")) {
          failed = true
          throw new Error("Synthetic single-row DOM construction refusal")
        }
        return create(tag, ...args)
      }
    })
    await load(page, "#/improvements", "#triage-brief")
    assert.equal(await page.locator(".improvement-row-error").count(), 1)
    assert.match(await page.locator(".improvement-row-error").innerText(), /Other improvements are unaffected/)
    assert.equal(await page.locator("#triage-brief button.copy-prompt").count(), 1)
    await page.locator("#triage-brief button.copy-prompt").click()
    assert.match(await page.locator(".improvement-copy-status").innerText(), /Copied/)
  })
  for (const destination of ["#not-a-local-destination"]) await scenario(`unsupported_nav_destination_${destination}`, async (page) => {
    await load(page, "#/", "#overview-state")
    const overview = page.locator("nav.steps a").filter({ hasText: /^Overview$/ })
    const href = await overview.getAttribute("href")
    await overview.evaluate((node, value) => { node.dataset.destination = value }, destination)
    await page.locator("nav.steps a").filter({ hasText: /^Tasks$/ }).click()
    await page.waitForFunction(() => document.getElementById("task-list").innerText.trim().length > 0)
    assert.equal(await overview.getAttribute("href"), href)
    assert.match(await page.locator("#task-list").innerText(), /Task|Recorded/i)
  })
  await scenario("initial_main_fragment_is_not_a_view_and_opens_the_default_briefing", async (page) => {
    await load(page, "#main", "#overview-state")
    assert.equal(await page.evaluate(() => location.hash), "")
    assert.equal(await page.locator("body").getAttribute("data-view"), "overview")
    await page.goto(base + "#main")
    assert.equal(await page.locator("body").getAttribute("data-view"), "overview")
    assert.equal(await page.evaluate(() => document.activeElement.id), "main")
  })
  for (const variant of ["empty_bursts", "unavailable_origin"]) await scenario(`recorded_map_availability_${variant}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    if (variant === "empty_bursts") { map.bursts = []; map.gaps = [] }
    else map.lead_window = { state: "unavailable", reasons: ["source_unreadable"] }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#task-head")
    if (variant === "empty_bursts") {
      await page.waitForFunction(() => /No work burst or wait was recorded/.test(document.getElementById("vsm").innerText))
      assert.match(await page.locator("#vsm").innerText(), /nothing to draw/)
    } else {
      await page.waitForSelector("#vsm .vsm")
      assert.match(await page.locator("#vsm").innerText(), /start could not be placed/)
    }
  })
  for (const variant of ["recorded", "absent", "mismatch"]) await scenario(`phone_cause_ranking_split_${variant}`, async (page, context) => {
    const doc = structuredClone(causeDoc)
    const row = doc.causes.find((r) => r.cause === "waiting:next_prompt")
    if (variant === "absent") delete row.children
    if (variant === "mismatch") row.children = row.children.slice(0, 1)
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, "#/causes", "#pareto .pareto-names")
    assert.ok(await page.locator("#pareto .pareto-names li").count())
    assert.match(await page.locator("#pareto .pareto-names").innerText(), /Waiting|waiting/)
    if (variant === "absent") assert.match(await page.locator("#pareto").innerText(), /does not publish it/)
    if (variant === "mismatch") assert.match(await page.locator("#pareto").innerText(), /does not add up/)
    await page.goto(base + "#/causes/waiting:next_prompt")
    await page.waitForSelector("#cause-detail .cause-title")
    if (variant === "absent") assert.match(await page.locator("#cause-detail").innerText(), /does not publish it/)
    if (variant === "mismatch") assert.match(await page.locator("#cause-detail").innerText(), /does not add up/)
  }, { viewport: { width: 390, height: 844 } })
  for (const id of ["zone-current", "overview-triage-note", "map-selection"]) await scenario(`optional_dom_absent_before_native_initialization_${id}`, async (page, context) => {
    const html = await readFile(join(site, "index.html"), "utf8")
    assert.ok(html.includes(`id="${id}"`))
    await context.route("**/", (r) => r.fulfill({ contentType: "text/html", body: html.replace(`id="${id}"`, `id="fixture-absent-${id}"`) }))
    await load(page, "#/", "#overview-state")
    await page.locator("summary").filter({ hasText: /Time zone/ }).first().click()
    await page.locator("#display-zone").selectOption("UTC")
    assert.equal(await page.locator("#display-zone").inputValue(), "UTC")
    await load(page, `#/task/${task.id}?prompt=1`, "#vsm .vsm")
    await closeDrawer(page)
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  for (const href of ["#/tasks", "#/causes", "#/tasks?status=awaiting_signoff", "#/improvements"]) await scenario(`valid_briefing_projection_destination_without_a_number_${href}`, async (page, context) => {
    const d = structuredClone(data)
    const row = { id: "coverage:projection", family: "production", title: "Synthetic inspection destination", impact: "The fixture has no published affected count.", ownership: "not_published", next_action: "Inspect the declared local destination.", href }
    d.overview.attention = []
    d.overview.agents = []
    d.overview.investigation = [row]
    d.overview.state = "unknown"
    assert.equal(B.validateBriefing(d.overview).ok, true)
    await fixtureJson(context, "data.json", d)
    await load(page, "#/", "#overview-state")
    assert.match(await page.locator("#overview-state").innerText(), /not an all-clear/)
    const link = page.locator("#overview-investigation a").last()
    assert.equal(await link.getAttribute("href"), href)
    await link.click()
    await page.waitForFunction(() => document.body.dataset.view !== "overview")
  })
  await scenario("unavailable_map_clock_and_capture_without_reason_metadata_stay_unavailable", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.bursts_state = { state: "unavailable" }
    map.lead_window = { state: "unavailable" }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#task-head")
    await page.waitForFunction(() => /not recorded|not available|not published/.test(document.getElementById("vsm").innerText))
    assert.doesNotMatch(await page.locator("#vsm").innerText(), /NaN|Infinity/)
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  await scenario("store_optional_samples_and_future_return_keys_preserve_stated_source_limits", async (page, context) => {
    const d = structuredClone(data)
    for (const f of d.featured) { f.sample_merged_prs = []; f.models = [] }
    d.outcomes.oldest_unsigned_wait = { state: "unavailable", reasons: ["not_recorded"] }
    const r = d.outcomes.rework.returns[0]
    r.caught = "future_catch_point"
    r.by_reason = { future_return_reason: measured(1) }
    r.total = measured(1)
    // The count is an explicit synthetic forward-schema boundary, not a
    // recomputation of the retained production snapshot.
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#view-store .featured-list")
    assert.doesNotMatch(await page.locator("#view-store .featured-list").innerText(), /for example|Models:/)
    assert.match(await page.locator("#view-store").innerText(), /future_catch_point|future_return_reason/)
    assert.doesNotMatch(await page.locator("#view-store").innerText(), /NaN|Infinity/)
  })
  await scenario("crowded_synthetic_columns_of_retained_weeks_keep_phone_history_readable", async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    // Repeat retained columns only to exercise the reader's width boundary;
    // this fixture does not represent distinct newly observed weeks.
    weekly.weeks = Array.from({ length: 64 }, (_, i) => structuredClone(weekly.weeks[i % weekly.weeks.length]))
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    for (const mode of ["all", "working", "share"]) {
      await page.locator(`.ot-btn[data-otmode="${mode}"]`).click()
      assert.equal(await page.locator("#ot-bars .ot-week").count(), 64)
      assert.match(await page.locator("#ot-bars").textContent(), /too narrow|left out|table/i)
    }
    await page.locator(".ot-btn[data-over='task']").click()
    assert.ok(await page.locator(".comparison-history").textContent())
  }, { viewport: { width: 320, height: 844 } })
  for (const variant of ["intervals", "stretches", "both", "lead_window", "single_subagent"]) await scenario(`session_optional_native_projection_${variant}`, async (page, context) => {
    const detail = structuredClone(labeled.detail)
    const map = structuredClone(maps.get(labeled.job.id))
    if (variant === "intervals" || variant === "both") delete detail.intervals
    if (variant === "stretches" || variant === "both") { delete detail.stretches; detail.labeled = false }
    if (variant === "lead_window") delete map.lead_window
    if (variant === "single_subagent") {
      const worker = detail.intervals.find((i) => i.worker !== 0)?.worker
      assert.ok(Number.isInteger(worker))
      detail.intervals = detail.intervals.filter((i) => i.worker === 0 || i.worker === worker)
      map.agents = (map.agents || []).filter((a) => a.session !== detail.session || a.n === 0 || a.n === worker)
      detail.stretches = []
      detail.labeled = false
    }
    await fixtureJson(context, `map/${labeled.job.id}.json`, map)
    await fixtureJson(context, `jobs/${labeled.job.id}/${detail.session}.json`, detail)
    await load(page, `#/task/${labeled.job.id}/session/${detail.session}`, "#swimlane .lane-plot svg")
    assert.doesNotMatch(await page.locator("#swimlane").innerText(), /NaN|Infinity/)
    if (variant === "single_subagent") {
      const toggle = page.getByRole("button", { name: "Show one lane per subagent", exact: true })
      assert.equal(await toggle.innerText(), "Show 1 subagent lane")
      await toggle.click()
      await toggle.click()
      assert.equal(await toggle.innerText(), "Show 1 subagent lane")
    }
    await page.getByRole("button", { name: "Fit the whole session in the frame", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(350)
    assert.equal(await page.locator("#swimlane .lane-plot svg").count(), 1)
  })
  await scenario("zero_stated_work_with_positive_labels_keeps_the_unsplit_zero_group_safe", async (page, context) => {
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const stack = JSON.parse(await readFile(join(site, "rollups/stackup.json"), "utf8"))
    const row = tasks.jobs.find((r) => r.job === task.id)
    const bar = stack.jobs.find((r) => r.job === task.id)
    assert.ok(row && bar)
    row.working_ms = measured(0)
    bar.working_ms = measured(0)
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, "rollups/stackup.json", stack)
    await load(page, `#/task/${task.id}`, "#time-went")
    await page.waitForFunction(() => /working time is not split by label/.test(document.getElementById("time-went").innerText))
    assert.match(await page.locator("#time-went").innerText(), /Working, not split by label/)
    assert.doesNotMatch(await page.locator("#time-went").innerText(), /NaN|Infinity/)
  })
  for (const query of ["over=task&otmode=all", "over=task&otmode=working", "mode=request", "mode=production"]) await scenario(`native_compare_selector_route_${query}`, async (page) => {
    await load(page, `#/compare?${query}`, "#comparison-conclusion")
    const history = page.locator("details.comparison-history")
    if (!await history.evaluate((d) => d.open)) await history.locator(":scope > summary").click()
    assert.ok((await history.textContent()).trim())
    const mode = new URLSearchParams(query).get("mode")
    if (mode) assert.equal(await page.locator(`#view-compare button[data-mode="${mode}"]`).getAttribute("aria-pressed"), "true")
    assert.doesNotMatch(await page.locator("#stackup").innerText(), /NaN|Infinity/)
  })
  await scenario("a_real_cause_resize_redraws_and_a_missing_live_chart_node_stays_guarded", async (page) => {
    await load(page, "#/causes", "#pareto svg")
    await page.setViewportSize({ width: 800, height: 900 })
    await page.waitForTimeout(350)
    assert.ok(await page.locator("#pareto svg").count())
    await page.locator("#pareto").evaluate((e) => { e.id = "fixture-missing-live-pareto" })
    await page.setViewportSize({ width: 640, height: 900 })
    await page.waitForTimeout(350)
    assert.ok(await page.locator("#fixture-missing-live-pareto svg").count())
  })
  await scenario("fresh_publication_metadata_with_no_commit_ref_is_explicit", async (page, context) => {
    const d = structuredClone(data)
    d.built_at = new Date().toISOString()
    delete d.reports_commit
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#view-store")
    assert.match(await page.locator("#build-meta").innerText(), /less than an hour ago/)
    assert.equal(await page.locator("#build-meta a[href*='/commit/']").count(), 0)
  })
  await scenario("task_list_without_the_optional_rollup_keeps_actual_task_rows", async (page, context) => {
    await context.route("**/rollups/tasks.json", (r) => r.fulfill({ status: 404, body: "not published" }))
    await load(page, "#/tasks", "#task-list .picker-row")
    assert.equal(await page.locator("#task-list .picker-row").count(), data.jobs.length)
    assert.doesNotMatch(await page.locator("#task-list").innerText(), /NaN|Infinity/)
  })
  await scenario("clearing_an_unsupported_compare_selection_keeps_its_valid_investigation", async (page) => {
    await load(page, "#/compare?cause=waiting:next_prompt&selection=unsupported", "#stackup")
    const clear = page.getByRole("button", { name: "Clear selection", exact: true })
    assert.equal(await clear.count(), 1)
    assert.equal(await page.locator("#vsm .vsm").count(), 0)
    await clear.click()
    await page.waitForFunction(() => !location.hash.includes("selection"))
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("cause"), "waiting:next_prompt")
    assert.match(await page.locator("#navigation-context").innerText(), /Investigating:/)
  })
  await scenario("an_external_headerless_data_table_gets_roles_without_invented_column_names", async (page) => {
    await load(page, "#/store", "#view-store")
    await page.evaluate(() => {
      const holder = document.createElement("div")
      holder.className = "table-wrap"
      holder.id = "fixture-headerless-table"
      const table = document.createElement("table")
      table.className = "data-table"
      const cell = table.insertRow().insertCell()
      cell.textContent = "An externally inserted value has no declared heading"
      holder.appendChild(table)
      document.querySelector("#view-store .wrap").appendChild(holder)
    })
    await page.waitForFunction(() => document.querySelector("#fixture-headerless-table table").getAttribute("role") === "table")
    assert.equal(await page.locator("#fixture-headerless-table td").getAttribute("data-label"), null)
    assert.equal(await page.locator("#fixture-headerless-table td").getAttribute("role"), "cell")
  })
  for (const variant of ["invalid_day", "duplicate_day", "zero_counts", "malformed_count"]) await scenario(`intake_source_boundary_${variant}_is_finite`, async (page, context) => {
    const d = structuredClone(data)
    assert.ok(d.intake_over_time.length)
    if (variant === "invalid_day") d.intake_over_time[0].day = "unreadable-day"
    if (variant === "duplicate_day") d.intake_over_time.splice(1, 0, structuredClone(d.intake_over_time[0]))
    if (variant === "zero_counts") for (const row of d.intake_over_time) row.count = measured(0)
    if (variant === "malformed_count") d.intake_over_time[0].count = { state: "measured", value: "not-a-number", reasons: [] }
    await fixtureJson(context, "data.json", d)
    if (variant === "malformed_count") {
      await load(page, "#/store", "#chart-intake .chart-empty")
      assert.match(await page.locator("#chart-intake").textContent(), /non-finite value/)
      assert.equal(await page.locator("#chart-intake svg").count(), 0)
      assert.ok(await page.locator("#jobs-table .data-table").count(), "malformed intake does not hide other native data")
      return
    }
    await load(page, "#/store", "#chart-intake svg")
    assert.doesNotMatch(await page.locator("#chart-intake").textContent(), /NaN|Infinity/)
    assert.ok(await page.locator("#chart-intake svg").count())
  })
  for (const variant of ["confidence_absent", "confidence_zero", "only_support"]) await scenario(`legacy_native_label_projection_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    const job = d.jobs.find((j) => j.waste?.rows?.some((r) => r.kind === "support"))
    assert.ok(job)
    if (variant === "confidence_absent") for (const r of job.waste.rows) delete r.confidence
    else if (variant === "confidence_zero") for (const r of job.waste.rows) r.confidence = { high_ms: measured(0), medium_ms: measured(0), low_ms: measured(0) }
    else job.waste.rows = job.waste.rows.filter((r) => r.kind === "support")
    await fixtureJson(context, "data.json", d)
    await context.route("**/rollups/stackup.json", (r) => r.fulfill({ status: 404, body: "not published" }))
    await load(page, `#/task/${job.id}`, "#time-went .bars")
    if (variant === "confidence_absent") assert.match(await page.locator("#time-went").textContent(), /confidence not recorded/)
    else if (variant === "confidence_zero") assert.match(await page.locator("#time-went").textContent(), /confidence: none recorded/)
    else assert.equal(await page.locator("#time-went .task-do").count(), 0)
    assert.doesNotMatch(await page.locator("#time-went").textContent(), /NaN|Infinity/)
  })
  for (const variant of ["public_partial", "unnamed", "declared_details", "inferred_details", "drawer_about_finish", "drawer_open_finish", "drawer_unknown_finish"]) await scenario(`native_task_reference_boundary_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    const job = d.jobs.find((j) => j.id === task.id)
    if (variant === "public_partial") { job.name = "Synthetic partial public title"; job.name_basis = "partial" }
    if (variant === "unnamed") { delete job.name; job.pull_requests = [{ repo: "ourostack/factory", number: 1 }] }
    if (variant.endsWith("_details")) {
      job.details = [{ label: "Synthetic recorded boundary figure", kind: "count", number: { ...measured(1), basis: variant === "declared_details" ? "declared" : "inferred" } }]
    }
    if (variant === "drawer_about_finish") job.finish_date = { state: "partial", value: "2026-10-01", bound: "unknown", reasons: ["not_recorded"] }
    if (variant === "drawer_open_finish") job.finish_date = { state: "unavailable", reasons: ["open_job"] }
    if (variant === "drawer_unknown_finish") job.finish_date = { state: "unavailable", reasons: ["not_recorded"] }
    await fixtureJson(context, "data.json", d)
    await load(page, `#/task/${job.id}`, "#vsm .vsm-box")
    if (variant === "public_partial") assert.match(await page.locator(".task-reference").textContent(), /some could not be read/)
    else if (variant === "unnamed") assert.match(await page.locator(".task-reference").textContent(), /titles could not be read/)
    else if (variant.endsWith("_details")) assert.match(await page.locator(".job-detail-table").textContent(), variant === "declared_details" ? /taken from the task card/ : /computed from other measures/)
    else {
      await page.locator("#vsm .vsm-box").first().click()
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.match(await page.locator(".drawer-task").textContent(), variant === "drawer_open_finish" ? /still open/ : variant === "drawer_unknown_finish" ? /not dated yet/ : /about 1 Oct/)
      await closeDrawer(page)
    }
    assert.doesNotMatch(await page.locator("#view-task").textContent(), /NaN|Infinity/)
  })
  await scenario("native_map_figure_disclosure_can_be_opened_and_closed", async (page) => {
    await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
    const controls = page.locator("#vsm .vsm-data-toggle")
    assert.ok(await controls.count())
    let toggled = 0
    for (let i = 0; i < await controls.count(); i++) {
      const control = controls.nth(i)
      if (!await control.isVisible() || (await control.textContent()).trim() !== "All figures") continue
      await control.click()
      assert.equal((await control.textContent()).trim(), "Fewer figures")
      await control.click()
      assert.equal((await control.textContent()).trim(), "All figures")
      toggled++
    }
    assert.ok(toggled)
  }, { viewport: { width: 390, height: 900 } })
  for (const variant of ["request_measured", "request_lower_bound", "production_unsplit"]) await scenario(`synthetic_native_clock_envelope_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    for (const job of d.jobs) {
      if (!job.clocks) continue
      if (variant === "production_unsplit") {
        job.clocks.active_in_production_ms = { state: "unavailable", reasons: ["not_recorded"] }
        job.clocks.production_remainder_ms = { state: "unavailable", reasons: ["not_recorded"] }
      } else {
        // A synthetic schema boundary, never a claim that our actual payload
        // recorded an original request. Preserve each actual task identity.
        job.clocks.request_to_delivery_ms = variant === "request_measured"
          ? { ...measured(3600000), class: "measured", basis: ["original_request"], so_far: false }
          : { state: "partial", value: 3600000, bound: "lower", class: "measured", basis: ["original_request"], reasons: ["not_recorded"], so_far: false }
        job.clocks.queue_ms = { ...measured(600000), class: "measured", basis: ["original_request"], so_far: false }
      }
    }
    await fixtureJson(context, "data.json", d)
    const mode = variant === "production_unsplit" ? "production" : "request"
    await load(page, `#/compare?mode=${mode}`, "#stackup .clock-modes-table")
    assert.ok(await page.locator("#stackup svg").count())
    assert.match(await page.locator(".clock-modes-table caption").textContent(), mode === "request" ? /Request to delivery/ : /Production time/)
    if (mode === "request") {
      assert.match(await page.locator(".clock-modes-table thead").textContent(), /Queued before production/)
      assert.doesNotMatch(await page.locator(".clock-modes-table thead").textContent(), /Acceptance wait/)
      if (variant === "request_lower_bound") assert.match(await page.locator(".clock-modes-table tbody").textContent(), /at least/)
    } else assert.match(await page.locator("#stackup").textContent(), /Split not known|Split.*not available|not known/)
    assert.doesNotMatch(await page.locator("#stackup").textContent(), /NaN|Infinity/)
  })
  await scenario("headline_count_slot_without_a_kind_uses_the_native_count_formatter", async (page, context) => {
    const d = structuredClone(data)
    assert.ok(d.headlines.length)
    d.headlines[0].note = { template: "Synthetic boundary count {boundary_count}", slots: { boundary_count: measured(7) } }
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#kpi-row .facts-list")
    assert.match(await page.locator("#kpi-row").textContent(), /Synthetic boundary count 7/)
    assert.doesNotMatch(await page.locator("#kpi-row").textContent(), /NaN|Infinity/)
  })
  await scenario("a_real_session_with_no_model_names_says_none_recorded", async (page, context) => {
    const d = structuredClone(data)
    assert.ok(d.sessions.length)
    for (const session of d.sessions) session.models = []
    await fixtureJson(context, "data.json", d)
    await load(page, `#/session/${d.sessions[0].session_id}`, "#session-detail")
    assert.match(await page.locator("#session-detail").textContent(), /models: none recorded/)
  })
  for (const id of ["vsm-title", "vsm-caption", "scope-context", "time-breakdown-note"]) await scenario(`native_optional_dom_boundary_${id}`, async (page, context) => {
    const html = await readFile(join(site, "index.html"), "utf8")
    if (id === "vsm-caption") {
      await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
        document.querySelector(".vsm-block > .chart-caption").remove()
      }))
    } else {
      assert.ok(html.includes(`id="${id}"`))
      await context.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html.replace(`id="${id}"`, `id="fixture-removed-${id}"`) }))
    }
    if (id.startsWith("vsm-")) {
      await load(page, `#/task/${task.id}`, "#vsm .vsm")
      assert.equal(await page.locator(id === "vsm-caption" ? ".vsm-block > .chart-caption" : `#${id}`).count(), 0)
      if (id === "vsm-title") {
        await page.locator("#other-tasks > summary").click()
        await page.getByRole("link", { name: "Skip to the map", exact: true }).click()
        assert.equal(await page.locator("body").getAttribute("data-view"), "task")
        assert.ok(await page.locator("#vsm .vsm-box").count())
      }
    } else {
      await load(page, "#/store", "#jobs-table .data-table")
      assert.equal(await page.locator(`#${id}`).count(), 0)
    }
    assert.doesNotMatch(await page.locator("body").innerText(), /NaN|Infinity/)
  })
  await scenario("a_requested_real_session_without_published_facts_is_not_substituted", async (page, context) => {
    const d = structuredClone(data)
    const id = d.sessions[0].session_id
    delete d.sessions
    await fixtureJson(context, "data.json", d)
    await load(page, `#/session/${id}`, "#session-detail")
    assert.match(await page.locator("#session-detail").textContent(), /Session not found/)
    assert.equal(await page.locator("#session-detail .facts-row").count(), 0)
  })
  for (const [target, hash, output] of [
    ["help-stops", "#/help", "#view-missing"],
    ["task-head", `#/task/${task.id}`, "#vsm"],
    ["stackup", "#/compare", "#stackup"],
  ]) await scenario(`public_dom_non_error_fault_is_contained_${target}`, async (page, context) => {
    // Fault injection at the public DOM API boundary, not an invocation or
    // replacement of any private renderer. The real route builds its DOM.
    await context.addInitScript(({ target }) => {
      const append = Node.prototype.appendChild
      window.fixtureDomFaultObserved = false
      Node.prototype.appendChild = function (child) {
        if (this.id === target && !window.fixtureDomFaultObserved) {
          window.fixtureDomFaultObserved = true
          throw undefined
        }
        return append.call(this, child)
      }
    }, { target })
    await page.goto(base + hash)
    await page.waitForFunction(({ output }) => /an error/.test(document.querySelector(output).textContent), { output })
    assert.equal(await page.evaluate(() => window.fixtureDomFaultObserved), true)
    assert.match(await page.locator(output).textContent(), /could not.*an error/)
    await page.locator('footer a[href="#/store"]').click()
    await page.waitForFunction(() => document.body.dataset.view === "store")
    assert.ok(await page.locator("#jobs-table .data-table").count(), "unrelated actual data remains usable")
  })
  await scenario("recorded_tool_counts_with_unknown_failure_rates_keep_unknown_figures", async (page, context) => {
    const d = structuredClone(data)
    assert.ok(d.tool_kinds.length > 1)
    for (const tool of d.tool_kinds) {
      tool.calls = measured(20)
      tool.failures = { state: "unavailable", reasons: ["not_recorded"] }
      tool.failure_rate = { state: "unavailable", reasons: ["not_recorded"] }
    }
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#chart-tool-failures .bar-row")
    assert.match(await page.locator("#chart-tool-failures").textContent(), /no data/)
    assert.doesNotMatch(await page.locator("#chart-tool-failures").textContent(), /NaN|Infinity/)
    assert.ok(await page.locator("#jobs-table .data-table").count())
  })
  for (const why of [false, true]) await scenario(`retained_cause_rollup_without_task_records_${why}`, async (page, context) => {
    const d = structuredClone(data)
    d.jobs = []
    const row = why ? causeDoc.causes.find((c) => c.cause === "waiting:next_prompt").children.find((c) => c.jobs?.length) : causeDoc.causes.find((c) => c.jobs?.length)
    assert.ok(row)
    await fixtureJson(context, "data.json", d)
    await load(page, `#/causes/${row.cause}`, "#cause-detail h1")
    assert.ok((await page.locator("#cause-detail").textContent()).trim())
    assert.doesNotMatch(await page.locator("#cause-detail").textContent(), /NaN|Infinity/)
    for (const disclosure of await page.locator("#cause-detail details").all()) {
      if (await disclosure.isVisible() && !await disclosure.evaluate((e) => e.open)) await disclosure.locator(":scope > summary").click()
    }
    const taskLink = page.locator('#cause-detail a[href^="#/task/"]').first()
    assert.ok(await taskLink.count())
    await taskLink.click()
    await page.waitForFunction(() => /Task not found/.test(document.getElementById("task-head").textContent))
    assert.equal(await page.locator("#vsm .vsm").count(), 0, "an absent task is not replaced with a different record")
  })
  await scenario("a_second_real_glossary_destination_replaces_the_previous_highlight", async (page) => {
    await load(page, "#/why?term=job-hours", "#g-job-hours.is-target")
    assert.equal(await page.locator(".glossary .is-target").count(), 1)
    await load(page, "#/why?term=capture-coverage", "#g-capture-coverage.is-target")
    assert.equal(await page.locator("#g-job-hours").evaluate((e) => e.classList.contains("is-target")), false)
    assert.equal(await page.locator(".glossary .is-target").count(), 1)
    assert.equal(await page.evaluate(() => document.activeElement.id), "g-capture-coverage")
  })
  for (const variant of ["tied_stretches", "unidentified_activity", "failure_without_tool_name"]) await scenario(`native_session_evidence_boundary_${variant}`, async (page, context) => {
    // Synthetic schema boundaries keep actual task/session IDs and timestamp
    // coordinates; they are not additional events in our published history.
    const detail = structuredClone(labeled.detail)
    if (variant === "tied_stretches") {
      const copy = structuredClone(detail.stretches[0])
      copy.confidence = null
      copy.waited_on = null
      copy.evidence = []
      detail.stretches.push(copy)
    } else if (variant === "unidentified_activity") {
      const copy = structuredClone(detail.intervals[0])
      copy.worker = "not-recorded"
      copy.kind = "tool"
      copy.tool = null
      copy.outcome = ""
      detail.intervals.push(copy)
    } else {
      const copy = structuredClone(detail.intervals[0])
      copy.worker = 0
      copy.kind = "tool"
      copy.tool = null
      copy.outcome = "error"
      detail.intervals = [copy]
    }
    await fixtureJson(context, `jobs/${labeled.job.id}/${detail.session}.json`, detail)
    await load(page, `#/task/${labeled.job.id}/session/${detail.session}`, "#swimlane .lane-plot svg")
    if (variant === "tied_stretches") {
      const disclosure = page.locator("#swimlane details").filter({ has: page.locator("table.vsm-table") })
      await disclosure.locator(":scope > summary").click()
      assert.equal(await disclosure.locator("tbody tr").count(), detail.stretches.length)
      assert.match(await disclosure.locator("tbody tr").last().textContent(), /—/)
      await disclosure.locator("tbody button").last().click()
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      await closeDrawer(page)
    } else if (variant === "unidentified_activity") {
      const disclosure = page.locator("#swimlane details").filter({ has: page.locator("table.lane-activity-table") })
      await disclosure.locator(":scope > summary").click()
      assert.match(await disclosure.locator("tbody tr").last().textContent(), /Agent not recorded.*Not recorded/)
    } else {
      assert.ok(await page.locator("#swimlane .lane-fail").count())
      assert.equal(await page.locator("#swimlane .lane-fail title").first().textContent(), "1 failed tool call")
    }
    assert.doesNotMatch(await page.locator("#swimlane").textContent(), /NaN|Infinity/)
  })
  await scenario("a_title_only_local_alias_keeps_the_actual_task_key_without_invented_folders", async (page, context) => {
    await fixtureJson(context, "local-names.json", { version: 1, jobs: { [task.id]: { title: "Synthetic local title without folder fields" } } })
    await load(page, `#/task/${task.id}`, "#task-head .task-title")
    assert.equal(await page.locator("#task-head .task-title").textContent(), "Synthetic local title without folder fields")
    const reference = await page.locator("#task-head .task-reference p").textContent()
    assert.match(reference, new RegExp(`^key ${task.id}`))
    assert.doesNotMatch(reference, /^ ·|undefined|null/)
  })
  for (const variant of ["known_empty", "missing_state"]) await scenario(`native_public_reference_boundary_${variant}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    if (variant === "known_empty") {
      map.prs = []
      map.prs_state = measured(0)
    } else {
      assert.ok(map.prs.length)
      for (const pr of map.prs) delete pr.state
    }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    const section = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Pull requests on the task clock", exact: true }) })
    if (variant === "known_empty") {
      assert.equal(await section.locator("table").count(), 0)
      assert.match(await section.textContent(), /No pull request/)
    } else {
      assert.match(await section.locator("tbody").textContent(), /not read/)
      assert.equal(await section.locator("tbody tr").count(), map.prs.length)
    }
    assert.doesNotMatch(await section.textContent(), /NaN|Infinity/)
  })
  await scenario("a_malformed_published_task_key_is_text_not_a_generated_route", async (page, context) => {
    const d = structuredClone(data)
    d.jobs[0].id = "invalid:route"
    d.jobs[0].name = "Synthetic malformed task key"
    await fixtureJson(context, "data.json", d)
    await load(page, "#/tasks", "#task-list .picker-row")
    const row = page.locator("#task-list .picker-row").filter({ hasText: "Synthetic malformed task key" })
    assert.equal(await row.count(), 1)
    assert.equal(await row.locator("a").getAttribute("href"), null)
    await load(page, "#/store", "#jobs-table .data-table")
    const stored = page.locator("#jobs-table tbody tr").filter({ hasText: "Synthetic malformed task key" })
    assert.equal(await stored.count(), 1)
    assert.equal(await stored.locator("a").first().getAttribute("href"), null)
  })
  for (const variant of ["one_unowned", "mixed_one_unowned", "owner_unchecked", "nothing_checked"]) await scenario(`native_alarm_caption_boundary_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    d.andon_issues = []
    d.andon_verification = "unavailable"
    d.fix_next = []
    d.capture_coverage.share = { state: "unavailable", reasons: ["not_recorded"] }
    d.capture_coverage.alarms = variant === "nothing_checked" ? [] : [
      { host: "synthetic0", code: "coverage_dropped" },
      ...(variant === "mixed_one_unowned" ? [{ host: "synthetic1", code: "coverage_dropped" }] : []),
    ]
    d.loop_health.alarms = []
    d.loop_health.verdict = { status: "unknown", missing: [] }
    d.alarm_issues = variant === "mixed_one_unowned"
      ? [{ keys: ["capture:synthetic0"], issue_state: "open", ref: "Synthetic fixture issue", url: "https://github.com/example/project/issues/1" }]
      : []
    d.alarm_issues_verification = variant === "owner_unchecked" ? "unavailable" : "verified"
    await fixtureJson(context, "data.json", d)
    await context.route("**/health.json", (r) => r.fulfill({ status: 404, body: "unavailable" }))
    await load(page, "#/help", "#help-stops li")
    const status = page.locator("#status-line")
    if (variant === "nothing_checked") {
      assert.match(await status.textContent(), /Not monitored/)
      assert.doesNotMatch(await status.textContent(), /Checked:/)
    } else {
      assert.match(await status.textContent(), /Abnormal/)
      if (variant !== "owner_unchecked") assert.match(await status.locator(".status-summary").textContent(), variant === "mixed_one_unowned" ? /2 alarms, 1 with no one on it/ : /1 alarm, no one is on it/)
      await status.locator("summary").click()
      if (variant === "owner_unchecked") assert.match(await status.textContent(), /owner not checked/)
    }
  })
  await scenario("a_synthetic_empty_week_keeps_empty_chart_and_table_cells_in_every_history_mode", async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    const week = weekly.weeks[0]
    const omitted = new Set(week.jobs)
    // Clear one retained column only as an empty-population schema fixture;
    // do not claim its actual tasks or historical work disappeared.
    week.n = 0
    week.n_partial = 0
    week.n_day_measured = 0
    week.n_day_on_or_before = 0
    week.n_day_on_or_after = 0
    week.n_day_about = 0
    week.n_unsplit = 0
    week.jobs = []
    const clear = (value) => {
      if (!value || typeof value !== "object") return
      if (["measured", "partial"].includes(value.state) && typeof value.value === "number") Object.assign(value, measured(0))
      else for (const child of Object.values(value)) clear(child)
    }
    clear(week)
    if (Array.isArray(weekly.tasks)) weekly.tasks = weekly.tasks.filter((t) => !omitted.has(t.job))
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    for (const mode of ["all", "working", "share"]) {
      await page.locator(`.ot-btn[data-otmode="${mode}"]`).click()
      assert.match(await page.locator(".comparison-history").textContent(), /no task finished|none finished/)
      assert.ok(await page.locator(".comparison-history .ot-cell-empty").count())
      assert.doesNotMatch(await page.locator(".comparison-history").textContent(), /NaN|Infinity/)
    }
  })
  await scenario("a_malformed_empty_alarm_identifier_stays_an_unnamed_alarm_without_a_route", async (page, context) => {
    const d = structuredClone(data)
    d.andon_issues = []
    d.capture_coverage.alarms = []
    d.loop_health.alarms = []
    d.fix_next = [{ id: [], severity: "alarm", title: "Synthetic alarm with a malformed identifier" }]
    d.alarm_issues = []
    d.alarm_issues_verification = "verified"
    await fixtureJson(context, "data.json", d)
    await context.route("**/health.json", (r) => r.fulfill({ status: 404, body: "unavailable" }))
    await load(page, "#/help", "#help-stops li")
    assert.match(await page.locator("#status-line .status-summary").textContent(), /an alarm/)
    assert.equal(await page.locator("#status-line .status-summary a").count(), 0)
    await page.locator("#status-line summary").click()
    assert.match(await page.locator("#status-line").textContent(), /synthetic alarm with a malformed identifier/i)
  })
  for (const variant of ["states_absent", "shared_empty_reasons", "partly_placed_without_states"]) await scenario(`native_missing_pr_time_reason_boundary_${variant}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    assert.ok(map.prs.length > 1)
    const placed = map.prs.find((p) => typeof p.opened_at_ms === "number")
    assert.ok(placed)
    map.prs = map.prs.slice(0, 3)
    for (const [index, pr] of map.prs.entries()) {
      pr.opened_at_ms = variant === "partly_placed_without_states" && index === 0 ? placed.opened_at_ms : null
      pr.merged_at_ms = null
      delete pr.opened_state
      delete pr.merged_state
      if (variant === "shared_empty_reasons") {
        pr.opened_state = { state: "unavailable", reasons: [] }
        pr.merged_state = { state: "unavailable", reasons: [] }
      }
    }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    const section = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Pull requests on the task clock", exact: true }) })
    assert.match(await section.textContent(), /time|recorded/)
    assert.doesNotMatch(await section.textContent(), /NaN|Infinity/)
    if (variant === "shared_empty_reasons") assert.doesNotMatch(await section.textContent(), /Why:|Every time not placed here has one reason/)
    else assert.match(await section.textContent(), /no reason recorded/)
    await openEvidence(page, "#vsm .clock-section .pr-line button, #vsm .pr-clock-table button", 1)
  })
  await scenario("a_zero_duration_folded_gap_opens_its_box_without_inventing_a_wait_rung", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    assert.ok(map.bursts.length >= 7 && map.gaps.length)
    map.bursts = map.bursts.slice(0, 7)
    let next = map.bursts[0].start_ms
    map.gaps = map.bursts.slice(0, -1).map((burst, index) => {
      const gap = structuredClone(maps.get(task.id).gaps[0])
      const duration = burst.end_ms - burst.start_ms
      burst.start_ms = next
      burst.end_ms = next + duration
      burst.working_ms = measured(duration)
      burst.idle_ms = measured(0)
      burst.idle_by_waited_on_ms = {}
      burst.idle_by_why_ms = {}
      next = burst.end_ms
      gap.start_ms = next
      gap.end_ms = next
      gap.waited_on = "unknown"
      gap.idle_by_waited_on_ms = {}
      gap.idle_by_why_ms = {}
      gap.n = index + 1
      return gap
    })
    const last = map.bursts.at(-1)
    const duration = last.end_ms - last.start_ms
    last.start_ms = next
    last.end_ms = next + duration
    last.working_ms = measured(duration)
    last.idle_ms = measured(0)
    last.idle_by_waited_on_ms = {}
    last.idle_by_why_ms = {}
    // This is a zero-time schema/folding fixture, not a rewritten history.
    map.human_turns = []
    map.human_turns_state = measured(0)
    map.prs = []
    map.prs_state = measured(0)
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}?gaps=1`, "#vsm .vsm")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.equal(await page.locator("#vsm .lad-folded").count(), 0)
    assert.equal(await page.locator("#vsm .vsm-box.is-hl").count(), 1)
    assert.doesNotMatch(await page.locator("#evidence-drawer").textContent(), /NaN|Infinity/)
    await closeDrawer(page)
    await page.evaluate(() => {
      const append = Node.prototype.appendChild
      window.fixtureFoldedTargetRemoved = false
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child)
        if (this.id === "vsm" && child.nodeType === 1 && child.classList.contains("vsm")) {
          for (const target of child.querySelectorAll(".vsm-box, .lad-folded")) {
            target.remove()
            window.fixtureFoldedTargetRemoved = true
          }
        }
        return result
      }
    })
    await page.goto(base + `#/task/${task.id}?gaps=1`)
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.equal(await page.evaluate(() => window.fixtureFoldedTargetRemoved), true)
    assert.equal(await page.locator("#vsm .vsm-box, #vsm .lad-folded").count(), 0)
    assert.ok((await page.locator("#drawer-title").textContent()).trim())
    await closeDrawer(page)
  }, { viewport: { width: 390, height: 900 } })
  for (const id of ["landing-note", "why-toggle-note", "improvement-status", "answer-tiles", "jobs-table"]) await scenario(`remaining_optional_shell_${id}`, async (page, context) => {
    const html = await readFile(join(site, "index.html"), "utf8")
    assert.ok(html.includes(`id="${id}"`))
    await context.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html.replace(`id="${id}"`, `id="fixture-absent-${id}"`) }))
    if (id === "landing-note") await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
    else if (id === "why-toggle-note") {
      await load(page, "#/causes", "#pareto svg")
      await page.locator("#why-toggle").click()
      await page.locator('#view-causes [data-mode="working"]').click()
    } else {
      await context.route("**/data.json", (route) => route.fulfill({ status: 503, body: "Synthetic unavailable data boundary" }))
      await load(page, "#/help", "#help-stops li")
      assert.match(await page.locator("#status-line").textContent(), /could not be loaded/)
      assert.equal(await page.locator("#help-stops li").count(), 3)
    }
    assert.equal(await page.locator(`#${id}`).count(), 0)
  })
  await scenario("remaining_absent_causes_in_working_mode_uses_the_missing_model", async (page, context) => {
    await context.route("**/rollups/causes.json", (route) => route.fulfill({ status: 404, body: "Synthetic missing ranking" }))
    await load(page, "#/causes?mode=working", "#pareto .chart-empty")
    assert.match(await page.locator("#pareto").textContent(), /not published/)
    assert.equal(await page.locator("#pareto svg").count(), 0)
  })
  for (const variant of ["missing_rollups", "one_inexact_finish", "unavailable_production_empty_reasons"]) await scenario(`remaining_compare_population_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    if (variant === "one_inexact_finish") {
      d.jobs = d.jobs.slice(0, 2)
      d.jobs[0].finish_date = measured("2026-10-01")
      d.jobs[1].finish_date = { state: "unavailable", reasons: ["open_job"] }
    }
    if (variant === "unavailable_production_empty_reasons") {
      for (const j of d.jobs) j.clocks = {
        production_time_ms: { state: "unavailable", reasons: [] },
        production_active_ms: { state: "unavailable", reasons: [] },
        request_to_delivery_ms: { state: "unavailable", reasons: [] },
      }
    }
    await fixtureJson(context, "data.json", d)
    if (variant === "missing_rollups") for (const path of ["rollups/tasks.json", "rollups/stackup.json"]) {
      await context.route(`**/${path}`, (route) => route.fulfill({ status: 404, body: "Synthetic missing comparison" }))
    }
    const hash = variant === "one_inexact_finish" ? "#/compare?from=2026-09-01" : variant === "unavailable_production_empty_reasons" ? "#/compare?mode=production" : "#/compare"
    await load(page, hash, "#comparison-conclusion")
    if (variant === "one_inexact_finish") assert.match(await page.locator("#compare-scope").textContent(), /excluded 1 task without/)
    else assert.match(await page.locator("#stackup").textContent(), variant === "missing_rollups" ? /not published/ : /Production time is not available/)
    assert.doesNotMatch(await page.locator("#stackup").textContent(), /NaN|Infinity/)
  })
  await scenario("remaining_compare_changed_control_blurs_after_real_change", async (page) => {
    await load(page, "#/compare", "#compare-status")
    await page.locator("#compare-status").selectOption("done")
    await page.waitForFunction(() => location.hash.includes("status=done"))
    await page.locator("#compare-status").focus()
    await page.keyboard.press("Tab")
    await page.getByRole("button", { name: "Clear filters", exact: true }).click()
    await page.waitForFunction(() => !location.hash.includes("status="))
    assert.equal(await page.locator("#compare-status").inputValue(), "")
  })
  await scenario("remaining_recent_build_and_unknown_entrypoint_keep_native_words", async (page, context) => {
    const d = structuredClone(data)
    d.built_at = new Date(Date.now() - 70 * 60 * 1000).toISOString()
    d.scope.entrypoints_scoped = { synthetic_entrypoint: measured(1) }
    d.loop_health.machines.stale = measured(1)
    d.loop_health.verdict.stale = measured(1)
    d.loop_health.verdict.quiet = measured(1)
    d.loop_health.verdict.status = "cannot_tell"
    d.loop_health.alarms = []
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#jobs-table .data-table")
    assert.match(await page.locator("#build-meta").textContent(), /1 hour ago/)
    assert.match(await page.locator("#scope-context").textContent(), /synthetic_entrypoint/)
    assert.match(await page.locator("#loop-health").textContent(), /record is older than 45 days/)
  })
  await scenario("remaining_b_future_rollup_wait_key_is_not_mistaken_for_a_valid_route", async (page, context) => {
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const row = tasks.jobs.find((r) => r.job === task.id)
    assert.ok(row && row.idle_ms && row.lead_time_ms && row.working_ms)
    const idle = row.idle_ms.value
    assert.ok(idle > 0)
    row.waiting_by_waited_on_ms = { "synthetic_future_wait?": measured(idle) }
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await context.route(`**/map/${task.id}.json`, (route) => route.fulfill({ status: 404, body: "Synthetic rollup-only task" }))
    await load(page, `#/task/${task.id}`, "#time-went .tw-part")
    assert.ok(await page.locator("#time-went .wait-unknown").count())
    assert.ok(await page.locator("#time-went .tw-cause-link:not([href])").count())
    await page.locator("#time-went .tw-part").last().click()
    assert.equal(await page.locator("#time-went .tw-part").last().getAttribute("aria-pressed"), "false")
    assert.equal(await page.locator("#vsm .vsm").count(), 0)
    assert.doesNotMatch(await page.locator("#time-went").textContent(), /NaN|Infinity/)
  })
  for (const width of [1280, 390]) await scenario(`remaining_b_future_weekly_keys_${width}`, async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    weekly.classes = [...weekly.classes, "synthetic_future_class"]
    weekly.wastes = [...weekly.wastes, "synthetic_future_waste?"]
    weekly.idle_waited_on = [...weekly.idle_waited_on, "synthetic_future_wait?"]
    for (const week of weekly.weeks) {
      week.by_class_ms.synthetic_future_class = measured(1000)
      week.by_waste_ms["synthetic_future_waste?"] = measured(1000)
      week.idle_by_waited_on_ms["synthetic_future_wait?"] = measured(1000)
    }
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    for (const mode of ["all", "working", "share"]) {
      await page.locator(`.ot-btn[data-otmode="${mode}"]`).click()
      assert.match(await page.locator(".comparison-history").textContent(), /synthetic_future_waste/)
      assert.ok(await page.locator(".comparison-history .cause-link:not([href])").count())
      assert.doesNotMatch(await page.locator(".comparison-history").textContent(), /NaN|Infinity/)
    }
  }, { viewport: { width, height: 900 } })
  for (const variant of ["no_stretches", "outside_stretches", "no_intervals"]) await scenario(`remaining_b_drawer_detail_${variant}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    assert.ok(map.detail_files.length)
    for (const path of map.detail_files) {
      const detail = JSON.parse(await readFile(join(site, path), "utf8"))
      if (variant === "no_stretches") delete detail.stretches
      else if (variant === "outside_stretches") for (const stretch of detail.stretches || []) {
        stretch.start_ms = map.lead_window.end_ms + 1000
        stretch.end_ms = stretch.start_ms + 1000
      }
      else {
        delete detail.intervals
        const stretch = structuredClone(labeled.detail.stretches[0])
        stretch.start_ms = map.bursts[0].start_ms + 1
        stretch.end_ms = Math.min(map.bursts[0].end_ms, stretch.start_ms + 1000)
        detail.stretches = [stretch]
      }
      await fixtureJson(context, path, detail)
    }
    await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
    await page.locator("#vsm .vsm-box").first().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    const button = page.getByRole("button", { name: "Show the labeled stretches in this span", exact: true })
    assert.equal(await button.count(), 1)
    await button.click()
    await page.waitForFunction(() => !document.querySelector("#evidence-drawer .drawer-load"))
    if (variant !== "no_intervals") {
      assert.match(await page.locator("#evidence-drawer").textContent(), /No labeled stretch falls in this span/)
      assert.equal(await page.locator("#evidence-drawer .stretch-row").count(), 0)
    } else {
      assert.ok(await page.locator("#evidence-drawer .stretch-row").count())
      await page.locator("#evidence-drawer .stretch-row").first().click()
      assert.ok((await page.locator("#drawer-title").textContent()).trim())
    }
    await closeDrawer(page)
  })
  await scenario("remaining_b_missing_session_key_in_a_prompt_keeps_evidence_without_an_unsafe_link", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    assert.ok(map.human_turns.length)
    for (const turn of map.human_turns) delete turn.session
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    const section = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Handoffs", exact: true }) })
    if (!await section.locator("details.handoffs").evaluate((node) => node.open)) await section.locator("details.handoffs > summary").click()
    await section.locator("button.link-button").first().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.equal(await page.locator("#evidence-drawer a").filter({ hasText: "Open this session's timeline" }).count(), 0)
    assert.ok((await page.locator("#drawer-title").textContent()).trim())
    await closeDrawer(page)
  })
  await scenario("remaining_b_plural_subagent_lanes_expand_and_collapse_real_controls", async (page, context) => {
    const detail = structuredClone(labeled.detail)
    const map = structuredClone(maps.get(labeled.job.id))
    assert.ok(detail.intervals.length)
    const interval = structuredClone(detail.intervals[0])
    detail.intervals = [0, 1, 2].map((worker) => ({ ...interval, worker }))
    detail.stretches = []
    detail.labeled = false
    map.agents = (map.agents || []).filter((agent) => agent.session !== detail.session || [0, 1, 2].includes(agent.n))
    await fixtureJson(context, `map/${labeled.job.id}.json`, map)
    await fixtureJson(context, `jobs/${labeled.job.id}/${detail.session}.json`, detail)
    await load(page, `#/task/${labeled.job.id}/session/${detail.session}`, "#swimlane .lane-plot svg")
    const button = page.getByRole("button", { name: "Show one lane per subagent", exact: true })
    assert.equal(await button.textContent(), "Show 2 subagent lanes")
    await button.click()
    assert.equal(await button.textContent(), "Collapse subagents into one lane")
    await button.click()
    assert.equal(await button.textContent(), "Show 2 subagent lanes")
  })
  for (const variant of ["stale_private_decision", "verified_public_issue_context_no_decision_fields"]) await scenario(`remaining_c_public_review_${variant}`, async (page, context) => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
    const boundary = fixture.cases.find((row) => row.name === variant)
    const value = structuredClone(fixture.public)
    Object.assign(value.rows[0], boundary.row)
    const improvements = deriveImprovementQueue({
      batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }],
      publicEvidence: boundary.publicEvidence || [], now: 1000,
    })
    assert.equal(validateImprovementQueue(improvements).ok, true)
    await fixtureJson(context, "data.json", { ...data, improvements })
    await load(page, "#/improvements?cause=waiting:next_prompt", "#triage-brief .improvement-row")
    assert.match(await page.locator("#improvement-question").textContent(), /with this investigation context/)
    assert.match(await page.locator("#triage-brief").textContent(), variant.startsWith("stale") ? /Review needs refreshing|Stale or conflicting/ : /Verified public context is available/)
    assert.doesNotMatch(await page.locator("#triage-brief").textContent(), /PRIVATE_SYNTHETIC_DECISION_PROSE/)
  })
  for (const target of ["help-stops", "swimlane", "pareto", "problems", "cause-detail", "featured-grid", "answer-tiles"]) await scenario(`remaining_c_null_dom_error_${target}`, async (page, context) => {
    const hash = target === "help-stops" ? "#/help" : target === "swimlane" ? `#/task/${labeled.job.id}/session/${labeled.detail.session}` : target === "pareto" ? "#/causes" : target === "problems" ? "#/improvements" : target === "cause-detail" ? `#/causes/${causeDoc.causes.find((row) => row.jobs?.length).cause}` : "#/store"
    const output = target === "help-stops" ? "#view-missing" : `#${target}`
    await context.addInitScript(({ target }) => {
      const append = Node.prototype.appendChild
      window.fixtureNullFaultObserved = false
      Node.prototype.appendChild = function (child) {
        if (this.id === target && !window.fixtureNullFaultObserved) {
          window.fixtureNullFaultObserved = true
          throw null
        }
        return append.call(this, child)
      }
    }, { target })
    await page.goto(base + hash)
    await page.waitForFunction(({ output }) => /an error/.test(document.querySelector(output).textContent), { output })
    assert.equal(await page.evaluate(() => window.fixtureNullFaultObserved), true)
    await page.locator('footer a[href="#/store"]').click()
    await page.waitForFunction(() => document.body.dataset.view === "store")
    assert.ok(await page.locator("#jobs-table .data-table").count())
  })
  await scenario("remaining_c_full_release_trend_needs_no_missing_column_caption", async (page, context) => {
    const d = structuredClone(data)
    const row = structuredClone(d.trend[0])
    for (const key of ["accepted", "sent_back", "first_pass_yield", "attention", "flow_efficiency"]) row[key] = measured(1)
    d.trend = [row]
    await fixtureJson(context, "data.json", d)
    await load(page, "#/store", "#trend .trend-table")
    assert.equal(await page.locator("#trend .trend-table thead th").count(), 7)
    assert.doesNotMatch(await page.locator("#trend").textContent(), /Only columns/)
  })
  for (const variant of ["row_missing", "stack_row_missing", "clock_only", "reasonless_partial", "unavailable_lead"]) await scenario(`remaining_c_task_native_boundary_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    const job = d.jobs.find((job) => job.id === task.id)
    delete job.human_turns
    const map = structuredClone(maps.get(task.id))
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const stack = JSON.parse(await readFile(join(site, "rollups/stackup.json"), "utf8"))
    if (variant === "row_missing") tasks.jobs = tasks.jobs.filter((row) => row.job !== task.id)
    if (variant === "stack_row_missing") stack.jobs = stack.jobs.filter((row) => row.job !== task.id)
    if (variant === "clock_only") {
      map.bursts = []
      map.gaps = []
      delete map.lead_window
    }
    if (variant === "reasonless_partial") {
      map.bursts_state = { state: "partial" }
      map.bursts_labels = {}
      map.lead_window.state = "unavailable"
      delete map.lead_window.reasons
    }
    if (variant === "unavailable_lead") {
      tasks.jobs.find((row) => row.job === task.id).lead_time_ms = { state: "unavailable", reasons: [] }
      stack.jobs.find((row) => row.job === task.id).lead_time_ms = { state: "unavailable", reasons: [] }
    }
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, `map/${task.id}.json`, map)
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, "rollups/stackup.json", stack)
    await load(page, `#/task/${task.id}`, variant === "clock_only" ? "#vsm .clock-section" : "#vsm .vsm")
    if (variant === "unavailable_lead") assert.match(await page.locator("#time-went").textContent(), /it was not recorded/)
    if (variant === "stack_row_missing") assert.match(await page.locator("#time-went").textContent(), /no row in the walk/)
    if (variant === "clock_only") assert.equal(await page.locator("#vsm .vsm-box").count(), 0)
    assert.doesNotMatch(await page.locator("#vsm").textContent(), /NaN|Infinity/)
  })
  for (const variant of ["partial_single_pr", "invalid_pr", "unknown_prompt_why"]) await scenario(`remaining_c_clock_record_${variant}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    const start = map.bursts[0].start_ms, end = map.bursts[0].end_ms
    map.prs = [structuredClone(map.prs[0])]
    map.prs[0].opened_at_ms = start + (end - start) / 2
    map.prs[0].merged_at_ms = null
    map.prs[0].opened_state = { state: "partial", bound: "upper", reasons: ["not_recorded"] }
    map.prs[0].merged_state = { state: "unavailable", reasons: ["not_recorded"] }
    if (variant === "invalid_pr") map.prs[0].repo = "not/a/valid/repo"
    if (variant === "unknown_prompt_why") {
      map.human_turns = [structuredClone(map.human_turns[0])]
      map.human_turns[0].at_ms = start + (end - start) / 3
      map.human_turns[0].why = "synthetic_future_why"
    }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    if (variant === "unknown_prompt_why") {
      await page.locator("#vsm .lad-mark-prompt").first().click()
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.ok(await page.locator("#evidence-drawer .glyph-prompt.why-synthetic_future_why").count())
      assert.match(await page.locator("#evidence-drawer").textContent(), /no stop before it: the session's first prompt/)
    } else {
      await page.locator("#vsm .lad-mark-opened").first().click()
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.match(await page.locator("#vsm .pr-clock-table").textContent(), /1 pull request|#/)
      if (variant === "invalid_pr") assert.equal(await page.locator("#evidence-drawer a[href^='https://github.com/']").count(), 0)
      else assert.ok(await page.locator("#vsm .lad-mark-opened.is-partial").count())
    }
    await closeDrawer(page)
  })
  await scenario("remaining_c_legacy_clocks_in_a_mixed_selected_population_stay_unavailable", async (page, context) => {
    const d = structuredClone(data)
    for (const job of d.jobs.slice(1)) delete job.clocks
    assert.ok(d.jobs[0].clocks.production_ms.value > 0)
    await fixtureJson(context, "data.json", d)
    await load(page, "#/compare?mode=production", "#stackup .clock-modes-table")
    assert.match(await page.locator("#stackup .clock-modes-table tbody tr").nth(1).textContent(), /Not available/)
    assert.match(await page.locator("#stackup").textContent(), /Desk published no production time for it/)
  })
  await scenario("remaining_d_unknown_valid_ranking_cause_keeps_the_neutral_wait_fill", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const row = structuredClone(doc.causes.find((row) => row.total_ms > 0))
    row.cause = "waiting:synthetic_future_wait"
    row.total_ms = Math.max(...doc.causes.map((row) => row.total_ms)) + 1000
    delete row.children
    doc.causes.push(row)
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, "#/causes", "#pareto svg")
    assert.match(await page.locator("#pareto").textContent(), /Waiting/)
    assert.ok(await page.locator('#pareto [style*="--c-wait-unknown"]').count())
  })
  for (const variant of ["one_drawn", "one_omitted", "empty_weeks"]) await scenario(`remaining_d_weekly_singular_population_${variant}`, async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const d = structuredClone(data)
    const recorded = structuredClone(weekly.tasks[0])
    const week = structuredClone(weekly.weeks.find((week) => week.jobs.includes(recorded.job)))
    recorded.finish_date = measured(week.starts_on)
    recorded.flow_efficiency = measured(0.5)
    const row = tasks.jobs.find((row) => row.job === recorded.job)
    assert.ok(row)
    row.flow_efficiency = measured(0.5)
    week.n = 1
    week.n_partial = 0
    week.n_day_measured = 1
    week.n_day_on_or_before = 0
    week.n_day_on_or_after = 0
    week.n_day_about = 0
    week.jobs = [recorded.job]
    week.flow_efficiency = { n: 1, N: 1, median: measured(0.5) }
    weekly.weeks = variant === "empty_weeks" ? [] : [week]
    weekly.tasks = variant === "empty_weeks" ? [] : [recorded]
    weekly.unplaced = { n: 0, jobs: [], reasons: [] }
    const finished = structuredClone(d.jobs.find((job) => job.id === recorded.job))
    finished.finish_date = recorded.finish_date
    finished.status = "done"
    const open = structuredClone(d.jobs.find((job) => job.id !== recorded.job))
    open.finish_date = { state: "unavailable", reasons: ["open_job"] }
    open.status = "open"
    d.jobs = [finished, open]
    if (variant === "one_omitted") {
      const other = structuredClone(JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8")).tasks.find((task) => task.job !== recorded.job && task.job !== open.id))
      other.finish_date = measured(week.starts_on)
      other.flow_efficiency = { state: "unavailable", reasons: ["not_recorded"] }
      tasks.jobs.find((row) => row.job === other.job).flow_efficiency = other.flow_efficiency
      weekly.tasks.push(other)
      week.jobs.push(other.job)
      week.n = 2
      week.n_day_measured = 2
      week.flow_efficiency.N = 2
      const second = structuredClone(data.jobs.find((job) => job.id === other.job))
      second.finish_date = other.finish_date
      second.status = "done"
      d.jobs.push(second)
    }
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    if (variant === "empty_weeks") assert.match(await page.locator("#over-time").textContent(), /No finished task has a finish day yet/)
    else {
      assert.match(await page.locator(".comparison-history").textContent(), /1 task|1 finished task|1 dated task/)
      assert.match(await page.locator("#over-time-undated").textContent(), /1 task is still open/)
      if (variant === "one_omitted") {
        assert.match(await page.locator("#fe-dots").textContent(), /1 more has a finish day but no flow efficiency figure/)
        assert.match(await page.locator("#over-time-undated").textContent(), /1 dated task has no flow efficiency figure/)
      }
      else assert.match(await page.locator("#fe-dots").textContent(), /1 finished task drawn/)
    }
  })
  await scenario("remaining_d_unknown_svg_route_is_not_linked_and_short_names_are_not_clipped", async (page, context) => {
    const d = structuredClone(data)
    d.jobs = [structuredClone(d.jobs[0])]
    d.jobs[0].id = "synthetic?unsafe-task"
    d.jobs[0].name = "A"
    d.jobs[0].name_basis = "complete"
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, "local-names.json", {})
    await load(page, "#/compare?mode=production", "#stackup svg .chart-link")
    assert.equal(await page.locator("#stackup svg .chart-link[href]").count(), 0)
    assert.equal(await page.locator("#stackup .sb-name").first().textContent(), "A")
    assert.match(await page.locator("#stackup .clock-modes-table").textContent(), /A/)
  })
  for (const variant of ["missing_periods", "legacy"]) await scenario(`remaining_d_task_clock_contract_${variant}`, async (page, context) => {
    const d = structuredClone(data)
    const job = d.jobs.find((job) => job.id === task.id)
    if (variant === "legacy") delete job.clocks
    else delete job.clocks.production_periods
    await fixtureJson(context, "data.json", d)
    await load(page, `#/task/${task.id}`, "#task-clocks-title")
    assert.match(await page.locator(".task-clocks").textContent(), variant === "legacy" ? /publishes no production clocks/ : /production clocks are malformed/)
    if (variant === "missing_periods") assert.equal(await page.locator(".task-clocks .clock-figures").count(), 0)
  })
  await scenario("remaining_d_native_health_arrays_and_stale_counts_may_be_absent", async (page, context) => {
    const d = structuredClone(data)
    delete d.loop_health.machines.stale
    d.loop_health.verdict.stale = measured(2)
    d.loop_health.verdict.status = "cannot_tell"
    d.loop_health.alarms = []
    const health = JSON.parse(await readFile(join(site, "health.json"), "utf8"))
    for (const key of Object.keys(health.slots)) health.details[key] = {}
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, "health.json", health)
    await load(page, "#/store", "#loop-health")
    assert.match(await page.locator("#loop-health").textContent(), /2 machines' records are older/)
    assert.ok((await page.locator("#health-panel").textContent()).trim())
  })
  await scenario("remaining_d_legacy_unknown_session_and_missing_glossary_destination_are_named", async (page) => {
    await load(page, "#session-00000000-0000-0000-0000-000000000000", "#session-detail")
    assert.match(await page.locator("#session-detail").textContent(), /Session not found/)
    await load(page, "#/why?term=lead-time", "#view-why")
    await page.locator("#g-lead-time").evaluate((node) => node.id = "fixture-absent-lead-time")
    await page.locator('footer a[href="#/store"]').click()
    await page.goto(base + "#/why?term=lead-time")
    await page.waitForFunction(() => document.body.dataset.view === "why")
    assert.equal(await page.locator("#g-lead-time").count(), 0)
    assert.equal(await page.locator("#fixture-absent-lead-time.is-target").count(), 1)
    assert.equal(await page.locator("#view-why h1").evaluate((node) => node === document.activeElement), true)
  })
  for (const variant of ["left_group", "missing_row", "missing_axis", "large_axis_text"]) await scenario(`remaining_e_external_chart_boundary_${variant}`, async (page, context) => {
    await context.addInitScript(({ variant }) => {
      window.fixtureExternalChartBoundary = false
      const append = Node.prototype.appendChild
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child)
        if (variant === "missing_row" && child.nodeType === 1 && child.classList.contains("sb-row")) {
          child.classList.replace("sb-row", "fixture-external-row")
          window.fixtureExternalChartBoundary = true
        }
        if (variant === "missing_row" && child.nodeType === 1 && child.classList.contains("sb-group")) child.removeAttribute("data-long")
        if (variant === "missing_axis" && child.nodeType === 1 && child.classList.contains("sb-axis")) {
          child.remove()
          window.fixtureExternalChartBoundary = true
        }
        return result
      }
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent = variant === "left_group" ? ".sb-group { transform: translateX(-500px) !important; }"
          : variant === "missing_row" ? ".sb-group { font-size: 1000px !important; }"
          : variant === "missing_axis" ? ".sb-name { transform: translate(0,500px) !important; }"
          : ".axis-tick { font-size: 66px !important; }"
        document.head.appendChild(style)
      })
    }, { variant })
    await load(page, "#/compare", "#stackup svg.sb-plot")
    if (variant === "missing_row" || variant === "missing_axis") assert.equal(await page.evaluate(() => window.fixtureExternalChartBoundary), true)
    assert.ok(await page.locator("#stackup-table table").count())
    assert.doesNotMatch(await page.locator("#stackup").textContent(), /could not be drawn|NaN|Infinity/)
    await page.locator("details.comparison-history > summary").click()
    assert.ok(await page.locator("#ot-bars svg").count())
  })
  await scenario("remaining_e_dense_week_columns_keep_tables_when_value_labels_do_not_fit", async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    const template = structuredClone(weekly.weeks[0])
    const origin = Date.parse(template.starts_on)
    weekly.weeks = [template, ...Array.from({ length: 119 }, (_, index) => {
      const date = new Date(origin + (index + 1) * 7 * 86400000)
      const thursday = new Date(date.getTime() + 3 * 86400000)
      const year = thursday.getUTCFullYear()
      const weekNumber = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)
      const row = structuredClone(template)
      row.week = `${year}-W${String(weekNumber).padStart(2, "0")}`
      row.starts_on = date.toISOString().slice(0, 10)
      row.n = 0
      row.n_partial = 0
      row.jobs = []
      row.n_day_measured = row.n_day_on_or_before = row.n_day_on_or_after = row.n_day_about = row.n_unsplit = 0
      const zero = (value) => {
        if (!value || typeof value !== "object") return
        if (["measured", "partial"].includes(value.state) && typeof value.value === "number") Object.assign(value, measured(0))
        else for (const child of Object.values(value)) zero(child)
      }
      zero(row)
      return row
    })]
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    assert.match(await page.locator("#fe-dots").textContent(), /columns are too narrow for the arrows/)
    assert.ok(await page.locator("#over-time-table .ot-table").count())
    assert.doesNotMatch(await page.locator(".comparison-history").textContent(), /NaN|Infinity/)
  }, { viewport: { width: 390, height: 900 } })
  await scenario("remaining_e_an_enlarged_count_badge_stays_centered_over_its_short_step", async (page, context) => {
    await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style")
      style.textContent = ".lad-mark-multi { min-width: 1000px !important; min-height: 1000px !important; }"
      document.head.appendChild(style)
    }))
    await load(page, `#/task/${task.id}`, "#vsm .lad-mark-multi")
    assert.ok(await page.locator("#vsm .lad-mark-multi").count())
    await openEvidence(page, "#vsm .lad-mark-multi", 1, true)
    assert.doesNotMatch(await page.locator("#vsm").textContent(), /NaN|Infinity/)
  })
  await scenario("remaining_e_a_first_prompt_without_any_published_why_omits_the_why_column", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.human_turns = [structuredClone(map.human_turns[0])]
    delete map.human_turns[0].why
    map.human_turns[0].basis = "first"
    map.waits = []
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .handoffs-table")
    const section = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Handoffs", exact: true }) })
    assert.match(await section.textContent(), /that column is left out/)
    assert.equal(await section.locator("th").filter({ hasText: "Why the agent stopped" }).count(), 0)
  })
  await scenario("remaining_f_malformed_session_reference_is_displayed_without_a_route", async (page, context) => {
    const d = structuredClone(data)
    const job = d.jobs.find((job) => job.id === task.id)
    job.sessions[0].session_id = "synthetic?unsafe-session"
    await fixtureJson(context, "data.json", d)
    await load(page, `#/task/${task.id}`, "#job-detail")
    const link = page.locator("#job-detail a").filter({ hasText: "synthet" })
    assert.equal(await link.count(), 1)
    assert.equal(await link.getAttribute("href"), null)
    assert.ok(await page.locator("#vsm .vsm-box").count())
  })
  await scenario("remaining_f_malformed_swimlane_session_key_keeps_a_safe_task_fallback", async (page, context) => {
    const detail = structuredClone(labeled.detail)
    detail.session = "synthetic?unsafe-session"
    delete detail.stretches[0].evidence
    await fixtureJson(context, `jobs/${labeled.job.id}/${labeled.detail.session}.json`, detail)
    await load(page, `#/task/${labeled.job.id}/session/${labeled.detail.session}`, "#swimlane .lane-stretch")
    await page.locator("#swimlane .lane-stretch").first().focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    const link = page.locator("#evidence-drawer a").filter({ hasText: "Open session" })
    assert.equal(await link.count(), 1)
    assert.match(await link.getAttribute("href"), new RegExp(`^#/task/${labeled.job.id}(?:\\?|$)`))
    assert.doesNotMatch(await link.getAttribute("href"), /unsafe-session/)
    await closeDrawer(page)
  })
  await scenario("remaining_f_missing_map_session_list_does_not_invent_wait_session_links", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    delete map.sessions
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm-wait")
    await page.locator("#vsm .vsm-wait").first().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.equal(await page.locator("#evidence-drawer a").filter({ hasText: "Open this session's timeline" }).count(), 0)
    assert.match(await page.locator("#evidence-drawer").textContent(), /No labeled session file is published for this span/)
    await closeDrawer(page)
  })
  for (const variant of ["reasonless_work_unavailable", "labels_cover_more_than_work"]) await scenario(`remaining_f_task_work_boundary_${variant}`, async (page, context) => {
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const stack = JSON.parse(await readFile(join(site, "rollups/stackup.json"), "utf8"))
    const row = tasks.jobs.find((row) => row.job === task.id)
    const stacked = stack.jobs.find((row) => row.job === task.id)
    if (variant === "reasonless_work_unavailable") {
      row.working_ms = { state: "unavailable", reasons: [] }
      stacked.working_ms = { state: "unavailable", reasons: [] }
      row.idle_ms = measured(row.idle_ms.value)
      await context.route(`**/map/${task.id}.json`, (route) => route.fulfill({ status: 404, body: "Synthetic rollup-only missing work boundary" }))
    } else {
      row.working_ms = measured(1000)
      stacked.working_ms = measured(1000)
    }
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, "rollups/stackup.json", stack)
    await load(page, `#/task/${task.id}`, "#time-went")
    assert.match(await page.locator("#time-went").textContent(), variant === "reasonless_work_unavailable" ? /it was not recorded/ : /working time is not split by label/)
    await load(page, "#/compare", "#stackup svg")
    if (variant === "labels_cover_more_than_work") assert.match(await page.locator("#stackup").textContent(), /Working, not split by label/)
    assert.doesNotMatch(await page.locator("#stackup").textContent(), /NaN|Infinity/)
  })
  for (const mode of ["production", "request"]) await scenario(`remaining_f_empty_clock_population_${mode}`, async (page) => {
    await load(page, `#/compare?mode=${mode}&task=00000000000000000000000000000000`, "#comparison-conclusion")
    assert.match(await page.locator("#stackup").textContent(), /No selected task has a bar/)
    assert.equal(await page.locator("#stackup svg").count(), 0)
  })
  await scenario("remaining_f_prompt_inside_a_wait_names_the_wait_not_a_work_box", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    const gap = map.gaps.reduce((left, right) => right.end_ms - right.start_ms > left.end_ms - left.start_ms ? right : left)
    map.human_turns = [structuredClone(map.human_turns[0])]
    map.human_turns[0].at_ms = gap.start_ms + (gap.end_ms - gap.start_ms) / 2
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    const marker = page.locator('#vsm .vsm-op[aria-label*="in this wait"]')
    assert.equal(await marker.count(), 1)
    await marker.click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.match(await page.locator("#drawer-title").textContent(), /Operator prompt/)
    await closeDrawer(page)
  })
  await scenario("remaining_f_single_unplaced_pr_without_reason_arrays_still_has_named_evidence", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.prs = [structuredClone(map.prs[0])]
    map.prs[0].state = "merged"
    map.prs[0].opened_at_ms = map.prs[0].merged_at_ms = null
    map.prs[0].opened_state = map.prs[0].merged_state = { state: "unavailable" }
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    const section = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Pull requests on the task clock", exact: true }) })
    assert.match(await section.textContent(), /1 pull request/)
    const disclosure = section.locator("details")
    if (await disclosure.count() && !await disclosure.evaluate((node) => node.open)) await disclosure.locator(":scope > summary").click()
    await section.locator("button.link-button").first().click()
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.ok((await page.locator("#drawer-title").textContent()).trim())
    await closeDrawer(page)
  })
  for (const variant of ["waste", "why"]) await scenario(`remaining_g_synthetic_public_enum_table_skew_${variant}`, async (page, context) => {
    // A synthetic public-library compatibility fault, not evidence that
    // this producer version was deployed. The app still runs its real route.
    const file = variant === "waste" ? "walk.js" : "format.js"
    const before = await readFile(join(site, file), "utf8")
    const marker = variant === "waste" ? '    unknown: "Could not classify",' : "acceptance|not_known))$/;"
    assert.equal(before.split(marker).length, 2)
    const after = before.replace(marker, variant === "waste"
      ? '    synthetic_enum_skew: "Synthetic producer enum skew",\n' + marker
      : "acceptance|not_known|synthetic_enum_skew))$/;")
    const receipt = join(out, `synthetic-${variant}-enum-response.json`)
    await writeFile(receipt, JSON.stringify({ boundary: "synthetic public enum-table version skew", file,
      before_sha256: createHash("sha256").update(before).digest("hex"),
      served_sha256: createHash("sha256").update(after).digest("hex"), marker, actual_deployment_claim: false }, null, 2))
    console.log("CREATED", receipt)
    await context.route(`**/${file}`, (route) => route.fulfill({ contentType: "text/javascript", body: after }))
    if (variant === "waste") {
      const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
      weekly.wastes.push("synthetic_enum_skew")
      for (const week of weekly.weeks) week.by_waste_ms.synthetic_enum_skew = measured(1000)
      await fixtureJson(context, "rollups/by_week.json", weekly)
      await load(page, "#/compare", "#comparison-conclusion")
      await page.locator("details.comparison-history > summary").click()
      assert.match(await page.locator("#cause-weeks").textContent(), /Synthetic producer enum skew/)
      assert.ok(await page.locator('#cause-weeks .swatch[style*="--c-waste-unknown"]').count())
    } else {
      const doc = structuredClone(causeDoc)
      const row = structuredClone(doc.causes[0])
      row.cause = "waiting:next_prompt:synthetic_enum_skew"
      row.total_ms = 1000
      row.jobs = []
      row.spans = []
      delete row.children
      doc.causes.push(row)
      await fixtureJson(context, "rollups/causes.json", doc)
      await load(page, `#/causes/${encodeURIComponent(row.cause)}`, "#cause-detail .cause-title")
      assert.ok(await page.locator("#cause-detail .cause-title .why-fill-not_known").count())
      assert.doesNotMatch(await page.locator("#cause-detail").textContent(), /could not be drawn|NaN|Infinity/)
    }
  })
  await scenario("remaining_g_a_temporarily_detached_loading_view_is_restored_before_data_rendering", async (page, context) => {
    await context.addInitScript(() => {
      const get = document.getElementById.bind(document)
      window.fixtureLoadingDetachObserved = false
      document.getElementById = (id) => {
        const node = get(id)
        if (id === "view-about" && node && !window.fixtureLoadingDetachObserved) {
          window.fixtureLoadingDetachObserved = true
          const parent = node.parentNode, next = node.nextSibling
          node.remove()
          queueMicrotask(() => parent.insertBefore(node, next))
          return get(id)
        }
        return node
      }
    })
    await load(page, "#/help", "#help-stops li")
    assert.equal(await page.evaluate(() => window.fixtureLoadingDetachObserved), true)
    assert.equal(await page.locator("#view-about").count(), 1)
    assert.equal(await page.locator("#help-stops li").count(), 3)
  })
  await scenario("remaining_g_a_detached_why_control_keeps_its_handlers_when_restored", async (page, context) => {
    await context.addInitScript(() => {
      const get = document.getElementById.bind(document)
      window.fixtureWhyDetachObserved = false
      document.getElementById = (id) => {
        const node = get(id)
        if (id === "why-toggle" && node && !window.fixtureWhyDetachObserved) {
          window.fixtureWhyDetachObserved = true
          const parent = node.parentNode, next = node.nextSibling
          node.remove()
          queueMicrotask(() => parent.insertBefore(node, next))
        }
        return node
      }
    })
    await load(page, "#/causes", "#pareto svg")
    assert.equal(await page.evaluate(() => window.fixtureWhyDetachObserved), true)
    const button = page.locator("#why-toggle")
    const pressed = await button.getAttribute("aria-pressed")
    await button.click()
    assert.notEqual(await button.getAttribute("aria-pressed"), pressed)
  })
  await scenario("remaining_g_external_group_without_long_metadata_uses_its_native_text", async (page, context) => {
    await context.addInitScript(() => {
      const append = Node.prototype.appendChild
      window.fixtureGroupMetadataRemoved = false
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child)
        if (child.nodeType === 1 && child.classList.contains("sb-group")) {
          child.removeAttribute("data-long")
          window.fixtureGroupMetadataRemoved = true
        }
        return result
      }
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style")
        style.textContent = ".sb-group { font-size: 1000px !important; }"
        document.head.appendChild(style)
      })
    })
    await load(page, "#/compare", "#stackup .sb-group-note")
    assert.equal(await page.evaluate(() => window.fixtureGroupMetadataRemoved), true)
    assert.ok((await page.locator("#stackup .sb-group-note").first().textContent()).trim())
  })
  await scenario("remaining_g_no_skip_link_and_no_answer_tile_are_optional_to_the_store", async (page, context) => {
    const html = await readFile(join(site, "index.html"), "utf8")
    assert.ok(html.includes('class="skip-link"') && html.includes('id="answer-tiles"'))
    await context.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html.replace('class="skip-link"', 'class="fixture-absent-skip-link"').replace('id="answer-tiles"', 'id="fixture-absent-answer-tiles"') }))
    await load(page, "#/store", "#jobs-table .data-table")
    assert.equal(await page.locator(".skip-link, #answer-tiles").count(), 0)
    assert.ok(await page.locator("#jobs-table .data-table").count())
  })
  await scenario("remaining_g_three_alarms_name_two_unowned_alarms_in_the_plural", async (page, context) => {
    const d = structuredClone(data)
    d.andon_issues = []
    d.fix_next = []
    d.capture_coverage.alarms = [0, 1, 2].map((n) => ({ host: `synthetic${n}`, code: "coverage_dropped" }))
    d.loop_health.alarms = []
    d.alarm_issues = [{ keys: ["capture:synthetic0"], issue_state: "open", ref: "Synthetic fixture owner", url: "https://github.com/example/project/issues/1" }]
    d.alarm_issues_verification = "verified"
    await fixtureJson(context, "data.json", d)
    await context.route("**/health.json", (route) => route.fulfill({ status: 404, body: "Synthetic unavailable site health" }))
    await load(page, "#/help", "#help-stops li")
    assert.match(await page.locator("#status-line .status-summary").textContent(), /3 alarms, 2 with no one on them/)
  })
  for (const variant of ["shared_placed", "unplaced_known_list"]) await scenario(`remaining_g_pr_caption_${variant}`, async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.prs = map.prs.slice(0, 2)
    for (const pr of map.prs) {
      pr.opened_at_ms = null
      pr.merged_at_ms = null
      pr.state = "merged"
      pr.opened_state = pr.merged_state = { state: "unavailable", reasons: ["not_recorded"] }
    }
    if (variant === "shared_placed") map.prs[0].opened_at_ms = map.bursts[0].start_ms
    map.prs_state = measured(map.prs.length)
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    const section = page.locator("#vsm .clock-section").filter({ has: page.getByRole("heading", { name: "Pull requests on the task clock", exact: true }) })
    assert.match(await section.textContent(), variant === "shared_placed" ? /Every time not placed here has one reason/ : /none has a time/)
    assert.doesNotMatch(await section.textContent(), /no reason recorded/)
  })
  await scenario("remaining_g_healthy_improvement_loop_and_unowned_issue_keep_explicit_words", async (page, context) => {
    const d = structuredClone(data)
    d.loop_health.alarms = []
    d.loop_health.verdict.status = "healthy"
    d.fix_next = []
    d.alarm_issues = [{ issue_state: "open", keys: [], ref: "Synthetic issue", url: "https://github.com/example/project/issues/1" }]
    d.alarm_issues_verification = "verified"
    d.kaizen_issues.push({ ref: "#99991", title: "", issue_state: "open", url: "https://github.com/ourostack/factory/issues/99991" })
    await fixtureJson(context, "data.json", d)
    await load(page, "#/improvements", "#alarm-owners")
    assert.match(await page.locator("#improvement-alarm-list").textContent(), /No improvement-system alarm is active/)
    assert.match(await page.locator("#alarm-owners").textContent(), /owns no alarm the status line names/)
    assert.match(await page.locator("#problems").textContent(), /Issue #99991/)
  })
  await scenario("remaining_g_a_large_axis_title_uses_the_short_pareto_titles", async (page, context) => {
    await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style")
      style.textContent = ".axis-title, .axis-tick { font-size: 33px !important; }"
      document.head.appendChild(style)
    }))
    await load(page, "#/causes", "#pareto svg")
    assert.ok(await page.locator("#pareto .axis-title").count())
    assert.doesNotMatch(await page.locator("#pareto").textContent(), /could not be drawn|NaN|Infinity/)
  })
  await scenario("remaining_h_a_newer_weekly_class_can_draw_the_existing_no_session_hatch", async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    weekly.classes.push("no_session")
    for (const week of weekly.weeks) week.by_class_ms.no_session = measured(1000)
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    assert.ok(await page.locator('#ot-bars [style*="hatch-no-session"]').count())
  })
  await scenario("remaining_h_after_bounded_finish_days_point_right_in_chart_and_table", async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    const week = weekly.weeks[0]
    week.n_day_on_or_before = 0
    week.n_day_on_or_after = week.n
    week.n_day_measured = week.n_day_about = 0
    for (const task of weekly.tasks.filter((task) => week.jobs.includes(task.job))) task.finish_date = { state: "partial", value: week.starts_on, bound: "lower", reasons: ["not_recorded"] }
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    assert.ok(await page.locator("#ot-bars .ot-bracket").count())
    assert.match(await page.locator("#cause-weeks .ot-col-sub").first().textContent(), /→/)
  })
  await scenario("remaining_h_a_single_unlabeled_finished_task_has_a_singular_disclosure", async (page, context) => {
    const d = structuredClone(data)
    const job = d.jobs.find((job) => ["done", "cancelled"].includes(job.status) && job.finish_basis !== "labels")
    assert.ok(job)
    d.jobs = [job]
    await fixtureJson(context, "data.json", d)
    await load(page, "#/improvements", "#act-unlabeled")
    assert.match(await page.locator("#act-unlabeled").textContent(), /Show the task/)
  })
  await scenario("remaining_h_a_missing_weekly_file_does_not_substitute_global_or_zero_weeks", async (page, context) => {
    await context.route("**/rollups/by_week.json", (route) => route.fulfill({ status: 404, body: "Synthetic absent weekly file" }))
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    assert.match(await page.locator("#ot-bars").textContent(), /weekly file.*not published/)
    assert.equal(await page.locator("#ot-bars svg").count(), 0)
  })
  await scenario("remaining_h_one_known_request_and_legacy_clocks_keep_request_specific_missing_words", async (page, context) => {
    const d = structuredClone(data)
    d.jobs[0].clocks.request_to_delivery_ms = { ...measured(600000), class: "measured", basis: ["original_request"], so_far: false }
    d.jobs[0].clocks.queue_ms = { ...measured(590000), class: "measured", basis: ["original_request"], so_far: false }
    for (const job of d.jobs.slice(1)) delete job.clocks
    await fixtureJson(context, "data.json", d)
    await load(page, "#/compare?mode=request", "#stackup .clock-modes-table")
    assert.match(await page.locator("#stackup").textContent(), /the original request was not recorded/)
    assert.match(await page.locator("#stackup .clock-modes-table tbody tr").nth(1).textContent(), /Not available/)
  })
  await scenario("remaining_h_a_task_partial_window_and_measured_stack_window_keep_the_partial_prefix", async (page, context) => {
    const stack = JSON.parse(await readFile(join(site, "rollups/stackup.json"), "utf8"))
    const row = stack.jobs.find((row) => row.job === task.id)
    row.lead_time_ms = measured(row.lead_time_ms.value)
    await fixtureJson(context, "rollups/stackup.json", stack)
    await load(page, `#/task/${task.id}`, "#time-went")
    assert.match(await page.locator("#time-went .tw-title").textContent(), /at least/)
  })
  await scenario("remaining_h_a_missing_pr_array_makes_its_requested_selection_unavailable", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    delete map.prs
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}?pr=1`, "#navigation-context .selection-unavailable")
    assert.match(await page.locator("#navigation-context").textContent(), /No substitute item was selected/)
    assert.equal(await page.locator("#evidence-drawer").evaluate((node) => node.open), false)
  })
  await scenario("remaining_h_a_reader_removed_main_box_does_not_block_its_deep_link_evidence", async (page, context) => {
    await context.addInitScript(() => {
      const append = Node.prototype.appendChild
      window.fixtureBoxRemoved = false
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child)
        if (this.id === "vsm" && child.nodeType === 1 && child.classList.contains("vsm")) {
          for (const box of child.querySelectorAll(".vsm-box")) { box.remove(); window.fixtureBoxRemoved = true }
        }
        return result
      }
    })
    await load(page, `#/task/${task.id}?bursts=1`, "#vsm .vsm")
    await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
    assert.equal(await page.evaluate(() => window.fixtureBoxRemoved), true)
    assert.equal(await page.locator("#vsm .vsm-box").count(), 0)
    assert.ok((await page.locator("#drawer-title").textContent()).trim())
    await closeDrawer(page)
  })
  await scenario("remaining_h_an_external_prefix_remains_before_the_native_task_lede", async (page, context) => {
    await context.addInitScript(() => {
      const append = Node.prototype.appendChild
      window.fixturePrefixInserted = false
      Node.prototype.appendChild = function (child) {
        if (this.id === "task-lede" && !this.childNodes.length && !window.fixturePrefixInserted) {
          window.fixturePrefixInserted = true
          const prefix = document.createElement("span")
          prefix.textContent = "Synthetic external reader prefix. "
          append.call(this, prefix)
        }
        return append.call(this, child)
      }
    })
    await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
    assert.equal(await page.evaluate(() => window.fixturePrefixInserted), true)
    assert.match(await page.locator("#task-lede").textContent(), /Synthetic external reader prefix/)
  })
  await scenario("remaining_h_a_removed_selection_note_and_map_label_do_not_invent_a_selected_item", async (page, context) => {
    const html = await readFile(join(site, "index.html"), "utf8")
    assert.ok(html.includes('id="map-selection"'))
    await context.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html.replace('id="map-selection"', 'id="fixture-absent-map-selection"') }))
    await context.addInitScript(() => {
      const append = Node.prototype.appendChild
      window.fixtureSelectionNoteRemoved = false
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child)
        if (child.nodeType === 1 && child.classList.contains("selection-note")) {
          child.remove()
          window.fixtureSelectionNoteRemoved = true
        }
        return result
      }
    })
    await load(page, `#/task/${task.id}?gaps=9999`, "#navigation-context .selection-unavailable")
    assert.equal(await page.evaluate(() => window.fixtureSelectionNoteRemoved), true)
    assert.equal(await page.locator("#evidence-drawer").evaluate((node) => node.open), false)
    await page.locator("#navigation-context").getByRole("button", { name: "Clear selection", exact: true }).click()
    await page.waitForFunction(() => !location.hash.includes("gaps="))
  })
  for (const variant of ["coincident", "outside"]) await scenario(`remaining_h_session_pr_geometry_${variant}`, async (page, context) => {
    const map = structuredClone(maps.get(clockSession.job.id))
    map.prs = map.prs.slice(0, 2)
    assert.equal(map.prs.length, 2)
    for (const pr of map.prs) {
      pr.opened_at_ms = variant === "coincident" ? clockSession.detail.offset_ms + (clockSession.detail.end_ms - clockSession.detail.offset_ms) / 2 : clockSession.detail.end_ms + 60000
      pr.merged_at_ms = null
      pr.state = "open"
    }
    await fixtureJson(context, `map/${clockSession.job.id}.json`, map)
    await load(page, `#/task/${clockSession.job.id}/session/${clockSession.detail.session}`, "#swimlane .lane-plot svg")
    if (variant === "coincident") {
      assert.ok(await page.locator("#swimlane .lane-pr-multi").count())
      assert.equal(await page.locator("#swimlane .lane-pr-span").count(), 0)
    } else assert.match(await page.locator("#swimlane").textContent(), /elsewhere on the task's clock/)
  })
  await scenario("remaining_h_a_real_compare_control_change_contains_a_null_platform_error", async (page) => {
    await load(page, "#/compare", "#compare-status")
    await page.evaluate(() => {
      const get = document.getElementById.bind(document)
      window.fixtureCompareNullObserved = false
      document.getElementById = (id) => {
        if (id === "stackup-caption" && !window.fixtureCompareNullObserved) {
          window.fixtureCompareNullObserved = true
          throw null
        }
        return get(id)
      }
    })
    await page.locator("#compare-status").selectOption("done")
    await page.waitForFunction(() => /an error/.test(document.getElementById("stackup").textContent))
    assert.equal(await page.evaluate(() => window.fixtureCompareNullObserved), true)
    await page.getByRole("button", { name: "Clear filters", exact: true }).click()
    await page.waitForSelector("#stackup svg")
  })
  await scenario("remaining_h_missing_optional_improvement_nodes_and_alarm_focus_use_the_view_heading", async (page, context) => {
    const d = structuredClone(data)
    d.loop_health.alarms = [{ code: "steps_stale" }]
    d.loop_health.verdict = { status: "cannot_tell", missing: [], quiet: measured(0), stale: measured(1) }
    d.overview = B.buildBriefing({ data: d, improvements: d.improvements, now: 1000, validateQueue: validateImprovementQueue })
    assert.equal(B.validateBriefing(d.overview).ok, true)
    assert.ok(d.overview.attention.some((row) => row.id.startsWith("alarm:") && row.family === "improvement_system"))
    await fixtureJson(context, "data.json", d)
    const html = await readFile(join(site, "index.html"), "utf8")
    const ids = ["improvement-status", "overview-triage-note", "improvement-triage-note", "improvement-alarms"]
    for (const id of ids) assert.ok(html.includes(`id="${id}"`))
    const altered = ids.reduce((body, id) => body.replace(`id="${id}"`, `id="fixture-absent-${id}"`), html)
    await context.route("**/", (route) => route.fulfill({ contentType: "text/html", body: altered }))
    await load(page, "#/", "#overview-state")
    const alarm = page.getByRole("link", { name: "Open this alarm on Improvements", exact: true }).first()
    assert.ok(await alarm.count())
    await alarm.click()
    await page.waitForFunction(() => document.body.dataset.view === "act")
    assert.equal(await page.locator("#view-act h1").evaluate((node) => node === document.activeElement), true)
    await page.waitForSelector("#problems .act-summary, #problems .chart-empty:not(.is-loading)")
  })
  await scenario("height_only_task_resize_keeps_evidence_membership_and_current_selection", async (page) => {
    await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
    const labels = await page.locator("#vsm .vsm-box, #vsm .vsm-wait").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")))
    await page.locator("#vsm .vsm-box").first().click()
    await page.waitForSelector("#evidence-drawer[open]")
    const selection = page.url()
    await page.setViewportSize({ width: 1280, height: 901 })
    await page.waitForTimeout(300)
    assert.equal(page.url(), selection)
    assert.deepEqual(await page.locator("#vsm .vsm-box, #vsm .vsm-wait").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))), labels)
    await closeDrawer(page)
  })
  await scenario("overview_alarm_focus_targets_the_present_section_then_clears_on_real_navigation", async (page, context) => {
    const d = structuredClone(data)
    d.loop_health.alarms = [{ code: "steps_stale" }]
    d.loop_health.verdict = { status: "cannot_tell", missing: [], quiet: measured(0), stale: measured(1) }
    d.overview = B.buildBriefing({ data: d, improvements: d.improvements, now: 1000, validateQueue: validateImprovementQueue })
    assert.equal(B.validateBriefing(d.overview).ok, true)
    await fixtureJson(context, "data.json", d)
    await load(page, "#/", "#overview-state")
    const alarm = page.getByRole("link", { name: "Open this alarm on Improvements", exact: true }).first()
    assert.ok(await alarm.count())
    await alarm.click()
    await page.waitForFunction(() => document.body.dataset.view === "act" && document.activeElement.id === "improvement-alarms")
    await page.getByRole("link", { name: "Help", exact: true }).click()
    await page.waitForFunction(() => document.body.dataset.view === "help" && document.activeElement === document.querySelector("#view-help h1"))
    assert.ok((await page.locator("#help-stops").innerText()).trim())
  })
  await scenario("remaining_h_unavailable_store_data_and_a_skip_route_fail_closed_as_a_missing_view", async (page, context) => {
    await context.route("**/data.json", (route) => route.fulfill({ status: 503, body: "Synthetic unavailable store" }))
    await load(page, "#/help", "#help-stops li")
    await page.goto(base + "#main")
    await page.waitForFunction(() => document.body.dataset.view === "missing")
    assert.match(await page.locator("#status-line").textContent(), /could not be loaded/)
  })
  for (const finish of ["open", "undated"]) await scenario(`remaining_i_cause_tasks_without_exact_finish_days_${finish}`, async (page, context) => {
    const d = structuredClone(data)
    for (const job of d.jobs) job.finish_date = { state: "unavailable", reasons: [finish === "open" ? "open_job" : "not_recorded"] }
    await fixtureJson(context, "data.json", d)
    const ordinary = causeDoc.causes.find((row) => row.jobs?.length && !row.cause.startsWith("waiting:next_prompt:"))
    const why = causeDoc.causes.flatMap((row) => row.children || []).find((row) => row.jobs?.length)
    assert.ok(ordinary && why)
    for (const row of [ordinary, why]) {
      await load(page, `#/causes/${encodeURIComponent(row.cause)}`, "#cause-detail .cause-title")
      assert.ok(await page.locator("#cause-detail .cell-day").count())
      assert.match(await page.locator("#cause-detail .cell-day").first().textContent(), finish === "open" ? /open/ : /not dated yet/)
    }
    if (finish === "undated") {
      await load(page, "#/compare", "#stackup-table .sb-compact")
      assert.match(await page.locator("#stackup-table").textContent(), /no finish day yet/)
    }
  }, { viewport: { width: 390, height: 900 } })
  await scenario("remaining_i_a_why_task_with_no_published_amount_says_not_stated", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const child = doc.causes.find((row) => row.cause === "waiting:next_prompt").children.find((row) => row.jobs?.length && !row.cause.endsWith(":not_known"))
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const job = child.jobs.find((job) => tasks.jobs.some((row) => row.job === job))
    assert.ok(job)
    const row = tasks.jobs.find((row) => row.job === job)
    delete row.top_causes
    row.next_prompt_by_why_ms = { ...(row.next_prompt_by_why_ms || {}), [child.cause.split(":")[2]]: { state: "unavailable", reasons: ["not_recorded"] } }
    child.spans = (child.spans || []).filter((span) => span.job !== job)
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, `#/causes/${encodeURIComponent(child.cause)}`, "#cause-detail .cause-title")
    assert.match(await page.locator("#cause-detail").textContent(), /not stated/)
    assert.doesNotMatch(await page.locator("#cause-detail").textContent(), /NaN|Infinity/)
  })
  await scenario("remaining_i_a_measured_why_amount_and_no_unknown_class_need_no_floor_note", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const parent = doc.causes.find((row) => row.cause === "waiting:next_prompt")
    parent.children = parent.children.filter((row) => !row.cause.endsWith(":not_known"))
    parent.total_ms = parent.children.reduce((total, row) => total + row.total_ms, 0)
    for (const child of parent.children) child.bound = null
    const child = parent.children.find((row) => row.jobs?.length)
    assert.ok(child)
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    for (const job of child.jobs) {
      const row = tasks.jobs.find((row) => row.job === job)
      if (!row) continue
      delete row.top_causes
      row.next_prompt_by_why_ms = { ...(row.next_prompt_by_why_ms || {}), [child.cause.split(":")[2]]: measured(1000) }
    }
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, "#/causes", "#pareto svg")
    assert.doesNotMatch(await page.locator("#pareto").textContent(), /While some of the bar has no known why/)
    await load(page, `#/causes/${encodeURIComponent(child.cause)}`, "#cause-detail .cause-title")
    assert.doesNotMatch(await page.locator("#cause-detail").textContent(), /NaN|Infinity/)
  })
  await scenario("remaining_i_a_stop_outside_the_map_has_a_task_fallback_and_no_overlap_claim", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const parent = doc.causes.find((row) => row.cause === "waiting:next_prompt")
    const child = parent.children.find((row) => row.jobs?.length && !row.cause.endsWith(":not_known"))
    const job = child.jobs.find((job) => maps.get(job)?.waits?.length)
    assert.ok(job)
    parent.jobs = child.jobs = [job]
    const map = structuredClone(maps.get(job))
    const wait = structuredClone(map.waits[0])
    wait.why = child.cause.split(":")[2]
    wait.start_ms = map.lead_window.end_ms + 60000
    wait.end_ms = wait.start_ms + 60000
    wait.next_prompt_ms = 0
    map.waits = [wait]
    await fixtureJson(context, `map/${job}.json`, map)
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, `#/causes/${encodeURIComponent(child.cause)}`, "#cause-detail .why-waits li")
    assert.match(await page.locator(".why-waits li").textContent(), /Counted as waiting: none\. How the turn ended/)
    const link = page.locator(".why-waits a")
    assert.equal(await link.textContent(), "open its task")
    assert.match(await link.getAttribute("href"), new RegExp(`^#/task/${job}(?:\\?|$)`))
  })
  await scenario("remaining_i_an_unsafe_stop_job_key_is_not_made_into_a_navigation_link", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const parent = doc.causes.find((row) => row.cause === "waiting:next_prompt")
    const child = parent.children.find((row) => row.jobs?.length && !row.cause.endsWith(":not_known"))
    const map = structuredClone([...maps.values()].find((map) => map.waits?.length))
    const job = "synthetic?unsafe"
    parent.jobs = child.jobs = [job]
    const wait = structuredClone(map.waits[0])
    wait.why = child.cause.split(":")[2]
    wait.next_prompt_ms = 1000
    map.waits = [wait]
    await fixtureJson(context, `map/${job}.json`, map)
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, `#/causes/${encodeURIComponent(child.cause)}`, "#cause-detail .why-waits li")
    assert.equal(await page.locator(".why-waits a").getAttribute("href"), null)
    assert.doesNotMatch(await page.locator("#cause-detail").textContent(), /could not be drawn/)
  })
  await scenario("remaining_i_unknown_lifecycle_is_not_relabelled_as_open", async (page, context) => {
    const d = structuredClone(data)
    const job = structuredClone(d.jobs[0])
    delete job.status
    d.jobs = [job]
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    const row = tasks.jobs.find((row) => row.job === job.id)
    assert.ok(row)
    row.status = { state: "unavailable", reasons: ["not_recorded"] }
    row.lead_time_ms = measured(row.lead_time_ms.value)
    await fixtureJson(context, "data.json", d)
    await fixtureJson(context, "rollups/tasks.json", tasks)
    await load(page, "#/compare", "#stackup-table .sb-table")
    assert.match(await page.locator("#stackup-table tbody tr").textContent(), /no data/)
    assert.equal(await page.locator("#stackup-table tbody tr td").nth(1).textContent(), "no data")
  })
  await scenario("remaining_i_an_unsafe_or_unmapped_cause_span_keeps_only_its_safe_fallback", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const row = doc.causes.find((row) => row.spans?.some((span) => maps.has(span.job)) && !row.cause.startsWith("waiting:next_prompt:"))
    const source = structuredClone(row.spans[0])
    assert.ok(source)
    row.spans = [{ ...source, job: "synthetic?unsafe" }, { ...source, start_ms: maps.get(source.job).lead_window.end_ms + 60000, end_ms: maps.get(source.job).lead_window.end_ms + 61000 }]
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, `#/causes/${encodeURIComponent(row.cause)}`, "#cause-detail .cause-spans")
    const links = page.locator("#cause-detail .cause-spans a")
    assert.equal(await links.count(), 2)
    assert.equal(await links.nth(0).getAttribute("href"), null)
    await page.waitForFunction(() => !document.querySelector("#cause-detail .loading"))
    assert.equal(await links.nth(1).textContent(), "open it on the map")
  })
  await scenario("remaining_i_unmerged_countermeasures_are_not_presented_as_shipped", async (page, context) => {
    const d = structuredClone(data)
    const issue = structuredClone(d.kaizen_issues[0])
    issue.cause = causeDoc.causes.find((row) => row.jobs?.length).cause
    issue.resolution = { ref: "ourostack/factory#1", url: "https://github.com/ourostack/factory/pull/1", merged: false }
    d.kaizen_issues = [issue]
    await fixtureJson(context, "data.json", d)
    await load(page, "#/improvements", "#problems .act-summary")
    assert.match(await page.locator("#problems").textContent(), /not yet merged/)
    await load(page, `#/causes/${encodeURIComponent(issue.cause)}`, "#cause-detail .taken-on")
    assert.match(await page.locator("#cause-detail .taken-on").textContent(), /not yet merged/)
  })
  await scenario("remaining_i_sorting_two_public_reviews_puts_stale_context_first", async (page, context) => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
    const value = structuredClone(fixture.public)
    value.rows.push({ ...structuredClone(value.rows[0]), id: "fedcba9876543210fedcba9876543210", state: "stale", age: "stale" })
    value.coverage.reviewed = 2
    const improvements = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000 })
    assert.equal(validateImprovementQueue(improvements).ok, true)
    await fixtureJson(context, "data.json", { ...data, improvements })
    await load(page, "#/improvements", "#triage-brief .improvement-row")
    assert.equal(await page.locator("#triage-brief .improvement-row").count(), 2)
    assert.match(await page.locator("#triage-brief .improvement-row").first().textContent(), /Review needs refreshing/)
  })
  await scenario("remaining_j_a_drawer_waiting_stretch_states_what_it_waited_on", async (page, context) => {
    const map = maps.get(task.id)
    for (const path of map.detail_files) {
      const detail = JSON.parse(await readFile(join(site, path), "utf8"))
      const stretch = structuredClone(labeled.detail.stretches[0])
      Object.assign(stretch, { class: "muda", waste: "waiting", waited_on: "next_prompt", start_ms: map.bursts[0].start_ms + 1, end_ms: map.bursts[0].start_ms + 60001 })
      detail.stretches = [stretch]
      await fixtureJson(context, path, detail)
    }
    await load(page, `#/task/${task.id}`, "#vsm .vsm-box")
    await page.locator("#vsm .vsm-box").first().click()
    await page.getByRole("button", { name: "Show the labeled stretches in this span", exact: true }).click()
    await page.waitForSelector("#evidence-drawer .stretch-row")
    assert.match(await page.locator("#evidence-drawer .stretch-row").first().textContent(), /next prompt/)
    await closeDrawer(page)
  })
  await scenario("remaining_j_all_present_marker_types_need_no_other_marker_disclosure", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
    tasks.jobs.find((row) => row.job === task.id).value_in_working_ms = measured(2000)
    await fixtureJson(context, "rollups/tasks.json", tasks)
    map.bursts = map.bursts.slice(0, 2)
    const start = map.bursts[0].start_ms
    for (const [index, burst] of map.bursts.entries()) {
      burst.start_ms = start + index * 960000
      burst.end_ms = burst.start_ms + 60000
      burst.working_ms = measured(60000)
      burst.idle_ms = measured(0)
      burst.defect_stretches = measured(1)
      burst.defect_ms = measured(1000)
      burst.value_ms = measured(1000)
      burst.idle_by_waited_on_ms = {}
    }
    const gap = structuredClone(map.gaps[0])
    Object.assign(gap, { start_ms: map.bursts[0].end_ms, end_ms: map.bursts[1].start_ms, n: 1, waited_on: "next_prompt",
      idle_by_waited_on_ms: { next_prompt: measured(900000) }, idle_by_why_ms: { approval: measured(450000), decision: measured(450000) } })
    map.gaps = [gap]
    map.bursts_state = map.bursts_labels = measured(2)
    map.lead_window = { state: "measured", start_ms: start, end_ms: map.bursts[1].end_ms, reasons: [] }
    map.human_turns = map.human_turns.slice(0, 2).map((turn, index) => ({ ...turn, at_ms: start + 1000 + index, why: "approval" }))
    map.prs = [structuredClone(map.prs[0])]
    Object.assign(map.prs[0], { opened_at_ms: map.bursts[1].start_ms + 30000, merged_at_ms: map.bursts[1].start_ms + 59000, state: "merged",
      opened_state: { state: "partial", bound: "upper", reasons: ["not_recorded"] }, merged_state: measured(1) })
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm")
    assert.ok(await page.locator("#vsm .vsm-rework").count())
    assert.ok(await page.locator("#vsm .lad-mark-multi").count())
    assert.ok(await page.locator("#vsm .is-partial").count())
    assert.equal(await page.locator("#vsm .vsm-legend-more").count(), 0)
  })
  await scenario("remaining_j_an_unfinished_weekly_split_is_not_presented_as_final", async (page, context) => {
    const weekly = JSON.parse(await readFile(join(site, "rollups/by_week.json"), "utf8"))
    weekly.weeks[0].n_unsplit = 1
    weekly.weeks[0].unsplit_reasons = ["log_truncated"]
    await fixtureJson(context, "rollups/by_week.json", weekly)
    await load(page, "#/compare", "#comparison-conclusion")
    await page.locator("details.comparison-history > summary").click()
    assert.match(await page.locator("#ot-bars").textContent(), /not split/)
  })
  await scenario("remaining_j_a_transiently_removed_history_summary_is_restored_without_breaking_compare", async (page, context) => {
    await context.addInitScript(() => {
      const append = Node.prototype.appendChild
      window.fixtureHistorySummaryDetached = false
      Node.prototype.appendChild = function (child) {
        const result = append.call(this, child)
        if (this.nodeType === 1 && this.classList.contains("comparison-history") && child.nodeName === "SUMMARY") {
          window.fixtureHistorySummaryDetached = true
          child.remove()
          const parent = this
          queueMicrotask(() => parent.insertBefore(child, parent.firstChild))
        }
        return result
      }
    })
    await load(page, "#/compare", "#stackup svg")
    assert.equal(await page.evaluate(() => window.fixtureHistorySummaryDetached), true)
    await page.locator("details.comparison-history > summary").click()
    assert.ok(await page.locator("#ot-bars svg").count())
  })
  await scenario("remaining_j_the_findings_intro_falls_back_to_its_retained_identifier", async (page, context) => {
    await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      for (const node of document.querySelectorAll("#view-causes > .wrap > .lede")) node.classList.remove("lede")
    }))
    await load(page, "#/causes", "#pareto svg")
    assert.ok((await page.locator("#causes-lede").textContent()).trim())
  })
  await scenario("remaining_k_a_no_session_ranking_names_the_missing_task_session", async (page, context) => {
    const doc = structuredClone(causeDoc)
    const row = structuredClone(doc.causes.find((row) => row.total_ms > 0))
    row.cause = "waiting:no_session"
    row.jobs = []
    row.spans = []
    delete row.children
    doc.causes = [row]
    await fixtureJson(context, "rollups/causes.json", doc)
    await load(page, "#/causes", "#pareto svg")
    assert.match(await page.locator(".findings-conclusion").textContent(), /No recorded task session/)
  })
  await scenario("remaining_j_a_view_error_without_its_optional_lede_still_allows_recovery", async (page, context) => {
    await context.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => document.querySelector("#view-missing .lede").classList.remove("lede"))
      const append = Node.prototype.appendChild
      window.fixtureMissingLedeFault = false
      Node.prototype.appendChild = function (child) {
        if (this.id === "help-stops" && !window.fixtureMissingLedeFault) { window.fixtureMissingLedeFault = true; throw null }
        return append.call(this, child)
      }
    })
    await page.goto(base + "#/help")
    await page.waitForSelector("#view-missing:not([hidden])")
    assert.equal(await page.evaluate(() => window.fixtureMissingLedeFault), true)
    assert.equal(await page.locator("#view-missing .lede").count(), 0)
    await page.locator('footer a[href="#/store"]').click()
    await page.waitForSelector("#jobs-table .data-table")
  })
  await scenario("remaining_j_a_null_improvement_row_error_does_not_hide_a_second_review", async (page, context) => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/v12-triage.json", import.meta.url), "utf8"))
    const value = structuredClone(fixture.public)
    value.rows.push({ ...structuredClone(value.rows[0]), id: "fedcba9876543210fedcba9876543210" })
    value.coverage.reviewed = 2
    const improvements = deriveImprovementQueue({ batches: [{ path: "triage/0123456789abcdef.json", bytes: JSON.stringify(value), committedAtMs: 1000 }], now: 1000 })
    assert.equal(validateImprovementQueue(improvements).ok, true)
    await fixtureJson(context, "data.json", { ...data, improvements })
    await context.addInitScript(() => {
      const create = document.createElement.bind(document)
      window.fixtureNullReviewObserved = false
      document.createElement = (tag, ...args) => {
        if (tag === "section" && document.getElementById("improvement-question") && !window.fixtureNullReviewObserved) {
          window.fixtureNullReviewObserved = true
          throw null
        }
        return create(tag, ...args)
      }
    })
    await load(page, "#/improvements", "#triage-brief .improvement-row-error")
    assert.equal(await page.evaluate(() => window.fixtureNullReviewObserved), true)
    assert.match(await page.locator(".improvement-row-error").textContent(), /an error/)
    assert.equal(await page.locator("#triage-brief button.copy-prompt").count(), 1)
  })
  for (const variant of ["missing_query", "missing_median_label", "blank_cause_label", "working_nodata", "unknown_wait_tag"]) await scenario(`remaining_j_synthetic_public_producer_boundary_${variant}`, async (page, context) => {
    const file = ["missing_median_label", "working_nodata"].includes(variant) ? "steps.js" : "walk.js"
    const before = await readFile(join(site, file), "utf8")
    const edits = {
      missing_query: ['        select: `prompt=${p.n}`,', ""],
      missing_median_label: ["short: b ? shortPct(mv, b) : pctShort(mv), ", ""],
      blank_cause_label: ['    defects: "Defects",', '    defects: " ",'],
      working_nodata: ['const kept = list.filter((b) => b.state === "ok" && labeledMs(b) > 0);', 'const kept = list.filter((b) => b.state === "no_data" || (b.state === "ok" && labeledMs(b) > 0));'],
      unknown_wait_tag: ['        type: "wait",\n        why_by:', '        type: "synthetic_unknown_wait",\n        why_by:'],
    }
    const [marker, replacement] = edits[variant]
    assert.equal(before.split(marker).length, 2)
    const served = before.replace(marker, replacement)
    const receipt = join(out, `${variant}-public-producer-response.json`)
    await writeFile(receipt, JSON.stringify({ boundary: `synthetic public producer fault: ${variant}`, file,
      before_sha256: createHash("sha256").update(before).digest("hex"), served_sha256: createHash("sha256").update(served).digest("hex"),
      marker, replacement, actual_deployment_claim: false }, null, 2))
    console.log("CREATED", receipt)
    await context.route(`**/${file}`, (route) => route.fulfill({ contentType: "text/javascript", body: served }))
    if (variant === "missing_query") {
      await load(page, `#/task/${task.id}?prompt=1`, "#vsm .vsm")
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.doesNotMatch(await page.locator("#evidence-drawer .prompt-text").textContent(), /\?undefined/)
      await closeDrawer(page)
    } else if (variant === "missing_median_label") {
      await load(page, "#/compare", "#comparison-conclusion")
      await page.locator("details.comparison-history > summary").click()
      await page.locator('.ot-btn[data-otmode="all"]').click()
      assert.ok(await page.locator("#fe-dots svg").count())
      assert.doesNotMatch(await page.locator("#fe-dots").textContent(), /could not be drawn|NaN|Infinity/)
    } else if (variant === "blank_cause_label") {
      const doc = structuredClone(causeDoc)
      const row = structuredClone(doc.causes.find((row) => row.total_ms > 0))
      row.cause = "defects:all"
      delete row.children
      doc.causes = [row]
      await fixtureJson(context, "rollups/causes.json", doc)
      await load(page, "#/causes", "#pareto svg")
      assert.doesNotMatch(await page.locator("#pareto").textContent(), /could not be drawn|NaN|Infinity/)
    } else if (variant === "working_nodata") {
      const tasks = JSON.parse(await readFile(join(site, "rollups/tasks.json"), "utf8"))
      const stack = JSON.parse(await readFile(join(site, "rollups/stackup.json"), "utf8"))
      tasks.jobs.find((row) => row.job === task.id).working_ms = { state: "unavailable", reasons: ["not_recorded"] }
      stack.jobs.find((row) => row.job === task.id).working_ms = { state: "unavailable", reasons: ["not_recorded"] }
      await fixtureJson(context, "rollups/tasks.json", tasks)
      await fixtureJson(context, "rollups/stackup.json", stack)
      await load(page, "#/compare?mode=working", "#stackup svg")
      assert.match(await page.locator("#stackup").textContent(), /Not measured: no working time is known/)
    } else {
      await load(page, `#/task/${task.id}`, "#vsm .vsm-wait")
      await page.locator("#vsm .vsm-wait").first().click()
      await page.waitForFunction(() => document.getElementById("evidence-drawer").open)
      assert.ok((await page.locator("#drawer-title").textContent()).trim())
      assert.doesNotMatch(page.url(), /selection=gap/)
      await closeDrawer(page)
    }
  })
  await scenario("S1_taller_reader_data_rows_do_not_need_extra_summary_padding", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.bursts = map.bursts.slice(0, 1)
    map.gaps = []
    map.human_turns = []
    map.prs = []
    await fixtureJson(context, `map/${task.id}.json`, map)
    await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style")
      style.textContent = ".vsm-data { min-height: 1000px !important; }"
      document.head.appendChild(style)
    }))
    await load(page, `#/task/${task.id}`, "#vsm .vsm-wide")
    assert.equal(await page.locator("#vsm .vsm-wide").evaluate((root) => root.style.paddingBottom), "")
  })
  await scenario("S1_grouped_prompt_lists_keep_mid_turn_and_first_prompt_interpretations", async (page, context) => {
    const map = structuredClone(maps.get(task.id))
    map.bursts = map.bursts.slice(0, 1)
    map.gaps = []
    map.prs = []
    map.human_turns = map.human_turns.slice(0, 2).map((turn, index) => ({
      ...turn, at_ms: map.bursts[0].start_ms + 1000 + index, basis: index ? "first" : "mid_turn",
    }))
    await fixtureJson(context, `map/${task.id}.json`, map)
    await load(page, `#/task/${task.id}`, "#vsm .vsm-op")
    await page.locator("#vsm .vsm-op").first().click()
    await page.waitForSelector("#evidence-drawer[open]")
    assert.match(await page.locator("#drawer-body").textContent(), /while the agent was still working/)
    assert.match(await page.locator("#drawer-body").textContent(), /session's first prompt/)
    await closeDrawer(page)
  })
  await scenario("S1_synthetic_public_display_producer_can_omit_optional_triage_figures", async (page, context) => {
    const before = await readFile(join(site, "steps.js"), "utf8")
    const served = before
      .replace("function triageCoverageWords(queue) {", "function triageCoverageWords(queue) { return [];")
      .replace("function triageRunnerWords(queue) {", "function triageRunnerWords(queue) { return null;")
    assert.notEqual(served, before)
    const receipt = join(out, "optional-triage-display-public-producer-response.json")
    await writeFile(receipt, JSON.stringify({
      boundary: "synthetic public display producer omits optional coverage/runner sentences",
      before_sha256: createHash("sha256").update(before).digest("hex"),
      served_sha256: createHash("sha256").update(served).digest("hex"),
      actual_deployment_claim: false,
    }, null, 2))
    console.log("CREATED", receipt)
    await context.route("**/steps.js", (route) => route.fulfill({ contentType: "text/javascript", body: served }))
    await load(page, "#/improvements", "#triage-brief .improvement-row")
    assert.equal(await page.locator("#triage-brief .triage-coverage").count(), 0)
    assert.ok(await page.locator("#triage-brief .improvement-row").count())
    assert.doesNotMatch(await page.locator("#triage-brief").textContent(), /all.clear|NaN|Infinity/i)
  })
} catch (error) { results.push({ name: "harness_exception", passed: false, error: error.stack }) }
finally {
  if (browser) await browser.close()
  if (server.listening) await new Promise((r) => server.close(r))
  await writeFile(join(out, "results.json"), JSON.stringify({ results, actions, requests, resources: { pid: process.pid, server_closed: !server.listening, browser_closed: !browser || !browser.isConnected() } }, null, 2))
  console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, out }))
}
process.exitCode = results.some((r) => !r.passed) ? 1 : 0
