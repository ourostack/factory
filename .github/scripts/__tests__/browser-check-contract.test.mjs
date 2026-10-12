import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
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

const clean = { doc: { scrollWidth: 390, clientWidth: 390, bodyScrollWidth: 390 }, frames: [], clipped: [], clippedY: [], offscreen: [], overlaps: [], controlOverlaps: [] }
const codes = (m) => G.assessLayout(m).map((p) => p.code)

test("only an explicitly marked, visibly labeled, bounded precision-timeline frame may pan; the document never overflows", () => {
  assert.deepEqual(codes(clean), [])
  assert.deepEqual(codes({ ...clean, doc: { ...clean.doc, scrollWidth: 391 } }), [], "one pixel of rounding is tolerated")
  assert.deepEqual(codes({ ...clean, doc: { ...clean.doc, scrollWidth: 392 } }), ["document_overflow"])
  assert.deepEqual(codes({ ...clean, doc: { ...clean.doc, bodyScrollWidth: 500 } }), ["document_overflow"])
  const frame = { el: "div.lanes", precision: true, labelled: true, bounded: true }
  assert.deepEqual(codes({ ...clean, frames: [frame] }), [])
  // A captioned table or a labeled chart that scrolls is not a precision timeline: it must reflow.
  assert.deepEqual(codes({ ...clean, frames: [{ ...frame, precision: false }] }), ["sideways_scroll"])
  assert.deepEqual(codes({ ...clean, frames: [{ ...frame, labelled: false }] }), ["frame_unlabelled"])
  assert.deepEqual(codes({ ...clean, frames: [{ ...frame, bounded: false }] }), ["frame_unbounded"])
  // A labeled frame never excuses document overflow.
  assert.deepEqual(codes({ ...clean, frames: [frame], doc: { ...clean.doc, scrollWidth: 900 } }), ["document_overflow"])
  assert.deepEqual(codes({ ...clean, clipped: [{ el: "button", text: "Clear" }] }), ["clipped"])
  assert.deepEqual(codes({ ...clean, clippedY: [{ el: "p", text: "Two lines" }] }), ["clipped_vertical"])
  assert.deepEqual(codes({ ...clean, offscreen: [{ el: "a" }] }), ["offscreen_control"])
  assert.deepEqual(codes({ ...clean, overlaps: [{ chart: "pareto", a: "x", b: "y" }] }), ["overlapping_labels"])
  assert.deepEqual(codes({ ...clean, controlOverlaps: [{ a: "button", b: "a" }] }), ["overlapping_controls"])
  // Chart text drawn past its chart's edge is cut off for the reader (the cold walk's Compare labels).
  assert.deepEqual(codes({ ...clean, chartTextOut: [{ chart: "stackup", text: "Still open" }] }), ["chart_text_out_of_bounds"])
  // A link with no accessible name is announced as "link" and nothing else.
  assert.deepEqual(codes({ ...clean, unnamedLinks: [{ el: "a in #vsm" }] }), ["unnamed_link"])
})

test("each problem says whether it is on a planted element, so a negative control proves it caught its own defect", () => {
  const p = G.assessLayout({ ...clean, clipped: [{ el: "button", text: "x", planted: true }, { el: "td", text: "y" }] })
  assert.deepEqual(p.map((x) => x.planted), [true, false])
  const o = G.assessLayout({ ...clean, overlaps: [{ chart: "c", a: "x", b: "y", planted: true }], controlOverlaps: [{ a: "a", b: "b", planted: true }], clippedY: [{ el: "p", planted: true }], frames: [{ el: "div", precision: false, labelled: true, bounded: true, planted: true }] })
  assert.ok(o.every((x) => x.planted === true))
  const source = readFileSync(SCRIPT, "utf8")
  assert.match(source, /data-gate-planted/)
  // The off-screen exemption covers only the parked skip link.
  assert.match(source, /\.skip-link/)
})

test("the gate must catch every planned negative control, and each control is actually run", () => {
  const names = ["injected_document_overflow", "overflow_hidden_clipping", "vertical_clipping", "overlapping_labels", "overlapping_controls", "unmarked_scroll_frame",
    "missing_chart_equivalent", "broken_focus_return", "false_copied_claim", "chart_text_out_of_bounds", "unnamed_link",
    "conclusion_below_first_screen", "cards_at_wide_screen", "page_height_over_budget", "stacked_table_without_roles",
    "caveat_in_the_conclusion_place", "view_unit_mismatch_on_compare", "task_figure_differs_on_compare", "bound_before_under_on_compare"]
  assert.deepEqual([...G.NEGATIVE_CONTROLS].sort(), [...names].sort())
  const source = readFileSync(SCRIPT, "utf8")
  for (const name of names) assert.equal(source.split(`expectFailure("${name}"`).length - 1, 1, `${name} is run exactly once`)
  for (const chart of ["stackup", "pareto", "ot-bars", "fe-dots", "swimlane"]) assert.ok(G.CHART_EQUIVALENTS[chart], chart)
})

test("routes that promise a chart must draw it, with an equivalent table that has body rows", () => {
  assert.deepEqual(G.EXPECTED_CHARTS, { compare: ["stackup"], findings: ["pareto"], session: ["swimlane"] })
})

test("every required check is recorded by name, and a run that skips one fails", () => {
  const required = ["keyboard_enter_selects_evidence_escape_closes_and_returns_focus", "keyboard_space_selects_evidence_escape_closes_and_returns_focus",
    "keyboard_select_by_type_ahead_and_clear_with_space_keep_focus", "tab_order_follows_the_page_on_primary_routes", "filter_change_updates_aggregates_and_coverage",
    "clear_selection_without_the_original_link", "storage_denied_keeps_the_site_usable", "storage_methods_throwing_keep_the_site_usable",
    "data_fetch_failure_says_so_and_navigation_works", "render_error_is_isolated", "json_twins_match_data_and_rendered_meaning"]
  for (const name of required) assert.ok(G.REQUIRED_CHECKS.includes(name), name)
  const source = readFileSync(SCRIPT, "utf8")
  for (const name of G.REQUIRED_CHECKS) assert.ok(source.includes(`check("${name}"`), `${name} is a check in the source`)
  assert.match(source, /gate_ran_every_required_check/)
  // The selection note uses the reader wording, never the old internal status line.
  assert.match(source, /An item from this link is selected/)
  assert.doesNotMatch(source, /\/Selection requested\//)
  // The Space check waits for the selection instead of reading the address at once.
  assert.match(source, /waitForFunction\(\(\) => location\.hash\.includes\("selection="\)/)
})

test("the command refuses missing, relative or in-repository paths before launching a browser", () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 20000 })
  const none = run()
  assert.equal(none.status, 2)
  assert.match(none.stderr, /--site <absolute-dist> --baseline-site <absolute-dist> --out <protected-dir> --playwright-module <absolute-module>/)
  const tmp = mkdtempSync(join(tmpdir(), "gate-"))
  assert.equal(run("--site", "dist", "--baseline-site", tmp, "--out", tmp, "--playwright-module", "/x.mjs").status, 2, "relative site")
  const inRepo = run("--site", tmp, "--baseline-site", tmp, "--out", join(ROOT, "site", "gate-output"), "--playwright-module", "/x.mjs")
  assert.equal(inRepo.status, 2)
  assert.match(inRepo.stderr, /outside any Git work tree/)
  const noSite = run("--site", join(tmp, "missing"), "--baseline-site", tmp, "--out", join(tmp, "out"), "--playwright-module", "/x.mjs")
  assert.equal(noSite.status, 2)
  assert.match(noSite.stderr, /--site must be a built site with index\.html/)
  // The height budget needs the build this release replaces.
  const noBase = run("--site", tmp, "--out", join(tmp, "out"), "--playwright-module", "/x.mjs")
  assert.equal(noBase.status, 2)
  assert.match(noBase.stderr, /--baseline-site must be an absolute path/)
  const site = join(tmp, "site")
  mkdirSync(site)
  writeFileSync(join(site, "index.html"), "<!doctype html>")
  writeFileSync(join(site, "data.json"), "{}")
  const badBase = run("--site", site, "--baseline-site", join(tmp, "missing"), "--out", join(tmp, "out"), "--playwright-module", "/x.mjs")
  assert.equal(badBase.status, 2)
  assert.match(badBase.stderr, /--baseline-site must be a built site with index\.html/)
})

test("space and structure: wide screens keep tables, heights stay within budget of the baseline, cards keep table roles", () => {
  for (const name of ["wide_screen_tables_stay_tables_at_normal_text", "page_height_within_budget_of_baseline", "stacked_tables_keep_table_roles"]) assert.ok(G.REQUIRED_CHECKS.includes(name), name)
  assert.deepEqual({ ...G.HEIGHT_BUDGET }, { 390: 1.5, 1280: 1.15 })
  assert.deepEqual([...G.HEIGHT_ROUTES], ["compare", "overview"])
  const source = readFileSync(SCRIPT, "utf8")
  assert.match(source, /serve\(args\.baseline\)/)
  for (const role of ["table", "row", "columnheader", "cell"]) assert.match(source, new RegExp(`"${role}"`))
})

test("the gate is run by a person or agent with a provisioned browser, never by CI, and adds no dependency", () => {
  const source = readFileSync(SCRIPT, "utf8")
  assert.doesNotMatch(source, /from "playwright"|require\("playwright"\)/, "the browser module is supplied by path, not installed")
  assert.match(source, /resources/)
  assert.match(source, /finally/)
  assert.match(readFileSync(join(ROOT, "README.md"), "utf8"), /node site\/scripts\/verify-v12-browser\.mjs --site/)
})

test("the task conclusion starts within the first screen at every width and text size, judged absolutely", () => {
  assert.ok(G.REQUIRED_CHECKS.includes("conclusion_starts_within_the_first_screen"))
  assert.deepEqual(G.FIRST_SCREEN, { phone: 640, phoneMaxWidth: 480, wide: 900, text2xScreens: 2 })
  assert.equal(G.assessFirstScreen({ top: 120, found: true, role: "conclusion", text: "Waiting is the largest recorded part." }, 1280), null)
  assert.match(G.assessFirstScreen({ top: 901, found: true, role: "conclusion", text: "Waiting is the largest recorded part." }, 1280), /starts at 901 px/)
  assert.equal(G.assessFirstScreen({ top: 1200, found: true, role: "conclusion", text: "Waiting is the largest recorded part." }, 390, 2), null)
  assert.match(G.assessFirstScreen({ top: 1300, found: true, role: "conclusion", text: "Waiting is the largest recorded part." }, 390, 2), /two screens with doubled text/)
  assert.match(G.assessFirstScreen({ top: 0, found: false }, 1280), /no conclusion/)
  const source = readFileSync(SCRIPT, "utf8")
  assert.match(source, /for \(const scale of TEXT_SCALES\)[\s\S]{0,900}WIDTHS\.length/)
})

test("doubled text has a height budget against the baseline's doubled text", () => {
  assert.deepEqual(G.assessHeights({ compare_390: { site: 900, reference: 1000 } }, { 390: 1 }), [])
  assert.deepEqual(G.assessHeights({ compare_390: { site: 1600, reference: 1000 } }, { 390: 1.5 }), ["compare at 390 px: 1600 px vs reference 1000 px (budget 1.5x)"])
  const source = readFileSync(SCRIPT, "utf8")
  assert.match(source, /check\("page_height_within_budget_at_doubled_text"/)
  assert.ok(G.REQUIRED_CHECKS.includes("page_height_within_budget_at_doubled_text"))
})
