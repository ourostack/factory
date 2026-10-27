// Explicit actual-artifact browser regression; existing installed Playwright only.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { createServer } from "node:http"
import { pathToFileURL } from "node:url"
import { assessLayout, measureLayout, readSessionChart, textScaleInit } from "../../../site/scripts/verify-v12-browser.mjs"

const [site, module, out, mode = "candidate"] = process.argv.slice(2)
assert(site && module && out && !fs.existsSync(out), "actual site, installed Playwright and fresh protected output required")
fs.mkdirSync(out, { recursive: true })
const leaf = "jobs/f30ef731387cce1fd7d0eb83befe98df/d5078b5a-5993-4015-a99d-d6c2deed2921.json"
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex")
const expected = "dda048baa8cc4d8d53b102bcd0a3e429e6db5176f8aec97f8d529c9f7ed9d5ae"
assert.equal(digest(fs.readFileSync(path.join(site, leaf))), expected)
const candidate = fs.readFileSync(new URL("../../../site/src/styles.css", import.meta.url))
const original = fs.readFileSync(path.join(site, "styles.css"))
const results = [], errors = []
// The previous reader moved to evidence.html when the Loom became the entry;
// older built artifacts still carry it as index.html.
const ENTRY = fs.existsSync(path.join(site, "evidence.html")) ? "evidence.html" : "index.html"
const server = createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname
  const file = path.resolve(site, "." + (name === "/" ? `/${ENTRY}` : name))
  if (!file.startsWith(path.resolve(site) + path.sep)) { res.writeHead(400).end(); return }
  try {
    const bytes = name === "/styles.css" ? mode === "candidate" ? candidate : original : fs.readFileSync(file)
    res.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" })[path.extname(file)] || "application/octet-stream" })
    res.end(bytes)
  } catch { res.writeHead(404).end() }
})
await new Promise(r => server.listen(0, "127.0.0.1", r))
const base = `http://127.0.0.1:${server.address().port}/`
const { chromium } = await import(pathToFileURL(path.resolve(module)))
let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [1280, 768, 390]) for (const theme of ["light", "dark"]) for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
    try {
      await context.addInitScript(textScaleInit, scale)
      const page = await context.newPage()
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(base + "#/task/f30ef731387cce1fd7d0eb83befe98df/session/d5078b5a-5993-4015-a99d-d6c2deed2921")
      await page.waitForSelector("#swimlane .lane-plot svg", { state: "visible", timeout: 20000 })
      const problems = assessLayout(await page.evaluate(measureLayout, { refresh: true }))
      const geometry = await page.locator("#swimlane .lane-label").evaluateAll(nodes => nodes.map(n => {
        const r = document.createRange(); r.selectNodeContents(n)
        const s = getComputedStyle(n)
        return { text: n.textContent, rect: n.getBoundingClientRect().toJSON(), textRect: r.getBoundingClientRect().toJSON(), scrollHeight: n.scrollHeight, clientHeight: n.clientHeight, font: s.fontSize, lineHeight: s.lineHeight, whiteSpace: s.whiteSpace, padding: s.padding }
      }))
      const chart = await page.evaluate(readSessionChart)
      results.push({ width, theme, scale, passed: problems.length === 0, problems, geometry, chart })
      await page.screenshot({ path: path.join(out, `${width}-${theme}-${scale}x.png`), fullPage: true })
    } finally { await context.close() }
  }
} finally {
  if (browser) await browser.close()
  await new Promise(r => server.close(r))
}
const failures = results.filter(r => !r.passed)
const report = { at: new Date().toISOString(), mode, kind: "ACTUAL_POST324_DATA_LOCAL_CSS_CANDIDATE_NOT_DEPLOYED_PROOF", expected_report_sha256: expected, css_sha256: digest(mode === "candidate" ? candidate : original), results, errors, failed: failures.length, passed: results.length - failures.length, browser_closed: !browser?.isConnected(), server_closed: !server.listening }
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ failed: report.failed, passed: report.passed, label: results.find(r => r.scale === 2)?.geometry.find(g => g.text.startsWith("Subagents seen")), out }))
if (mode === "removal") {
  assert.equal(failures.length, 6)
  assert(failures.every(r => r.scale === 2 && r.problems.every(p => p.code === "clipped_vertical" && p.detail.includes("Subagents seen (30)"))))
} else assert.equal(failures.length, 0)
assert.equal(errors.length, 0)
