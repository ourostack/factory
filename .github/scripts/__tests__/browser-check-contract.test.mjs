import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

// The rendered-browser gate (site/scripts/verify-v12-browser.mjs) runs with a
// real browser outside CI. These tests pin its contract without a browser:
// what it enumerates, what layout it accepts, which negative controls it must
// catch and how its command refuses unsafe or incomplete invocations.
const SCRIPT = fileURLToPath(new URL("../../../site/scripts/verify-v12-browser.mjs", import.meta.url))
const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const G = await import(SCRIPT)

test("the gate enumerates every CSS width from 320 to 1440, both themes and text scales 1 and 2", () => {
  assert.equal(G.WIDTHS.length, 1121)
  G.WIDTHS.forEach((w, i) => assert.equal(w, 320 + i))
  assert.deepEqual([...G.THEMES], ["light", "dark"])
  assert.deepEqual([...G.TEXT_SCALES], [1, 2])
  assert.deepEqual([...G.SCREENSHOT_WIDTHS], [320, 390, 768, 1280, 1440])
  assert.ok(Object.isFrozen(G.WIDTHS) && Object.isFrozen(G.ROUTES))
})

test("the gate covers every primary and legacy route", () => {
  const byName = Object.fromEntries(G.ROUTES.map((r) => [r.name, r]))
  const expected = {
    overview: ["#/", "overview"], tasks: ["#/tasks", "tasks"], task: ["#/task/{task}", "task"],
    session: ["#/task/{task}/session/{session}", "session"], compare: ["#/compare", "compare"],
    findings: ["#/causes", "causes"], cause: ["#/causes/{cause}", "cause"], improvements: ["#/improvements", "act"],
    improvements_contextual: ["#/improvements?cause={cause}&task={task}&return={return}", "act"],
    why: ["#/why", "why"], help: ["#/help", "help"], legacy_act: ["#/act", "act"],
  }
  assert.deepEqual(Object.keys(byName).sort(), Object.keys(expected).sort())
  for (const [name, [hash, view]] of Object.entries(expected)) {
    assert.equal(byName[name].hash, hash, name)
    assert.equal(byName[name].view, view, name)
  }
  for (const name of ["overview", "compare", "cause", "improvements_contextual", "task"]) assert.ok(G.SCREENSHOT_ROUTES.includes(name), name)
  assert.ok(G.SCREENSHOT_VARIANTS.some((v) => v.theme === "dark") && G.SCREENSHOT_VARIANTS.some((v) => v.scale === 2))
})

const clean = { doc: { scrollWidth: 390, clientWidth: 390, bodyScrollWidth: 390 }, frames: [], clipped: [], offscreen: [], overlaps: [] }
const codes = (m) => G.assessLayout(m).map((p) => p.code)

test("only labeled bounded precision frames may scroll; the document never overflows", () => {
  assert.deepEqual(codes(clean), [])
  assert.deepEqual(codes({ ...clean, doc: { ...clean.doc, scrollWidth: 391 } }), [], "one pixel of rounding is tolerated")
  assert.deepEqual(codes({ ...clean, doc: { ...clean.doc, scrollWidth: 392 } }), ["document_overflow"])
  assert.deepEqual(codes({ ...clean, doc: { ...clean.doc, bodyScrollWidth: 500 } }), ["document_overflow"])
  const frame = { el: "div.chart-frame", labelled: true, bounded: true }
  assert.deepEqual(codes({ ...clean, frames: [frame] }), [])
  assert.deepEqual(codes({ ...clean, frames: [{ ...frame, labelled: false }] }), ["frame_unlabelled"])
  assert.deepEqual(codes({ ...clean, frames: [{ ...frame, bounded: false }] }), ["frame_unbounded"])
  // A labeled frame never excuses document overflow.
  assert.deepEqual(codes({ ...clean, frames: [frame], doc: { ...clean.doc, scrollWidth: 900 } }), ["document_overflow"])
  assert.deepEqual(codes({ ...clean, clipped: [{ el: "button", text: "Clear" }] }), ["clipped"])
  assert.deepEqual(codes({ ...clean, offscreen: [{ el: "a" }] }), ["offscreen_control"])
  assert.deepEqual(codes({ ...clean, overlaps: [{ chart: "pareto", a: "x", b: "y" }] }), ["overlapping_labels"])
})

test("the gate must catch every planned negative control", () => {
  for (const name of ["injected_document_overflow", "overflow_hidden_clipping", "overlapping_labels", "missing_chart_equivalent", "broken_focus_return", "false_copied_claim"]) {
    assert.ok(G.NEGATIVE_CONTROLS.includes(name), name)
  }
  for (const chart of ["stackup", "pareto", "ot-bars", "fe-dots", "swimlane"]) assert.ok(G.CHART_EQUIVALENTS[chart], chart)
})

test("the command refuses missing, relative or in-repository paths before launching a browser", () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 20000 })
  const none = run()
  assert.equal(none.status, 2)
  assert.match(none.stderr, /--site <absolute-dist> --out <protected-dir> --playwright-module <absolute-module>/)
  const tmp = mkdtempSync(join(tmpdir(), "gate-"))
  assert.equal(run("--site", "dist", "--out", tmp, "--playwright-module", "/x.mjs").status, 2, "relative site")
  const inRepo = run("--site", tmp, "--out", join(ROOT, "site", "gate-output"), "--playwright-module", "/x.mjs")
  assert.equal(inRepo.status, 2)
  assert.match(inRepo.stderr, /outside any Git work tree/)
  const noSite = run("--site", join(tmp, "missing"), "--out", join(tmp, "out"), "--playwright-module", "/x.mjs")
  assert.equal(noSite.status, 2)
  assert.match(noSite.stderr, /index\.html/)
})

test("the gate is run by a person or agent with a provisioned browser, never by CI, and adds no dependency", () => {
  const source = readFileSync(SCRIPT, "utf8")
  assert.doesNotMatch(source, /from "playwright"|require\("playwright"\)/, "the browser module is supplied by path, not installed")
  assert.match(source, /resources/)
  assert.match(source, /finally/)
  assert.match(readFileSync(join(ROOT, "README.md"), "utf8"), /node site\/scripts\/verify-v12-browser\.mjs --site/)
})
