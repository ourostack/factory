// Spec 4.5: no sideways page scroll from 320 to 1440 CSS px, at normal and
// increased text size; only a labeled, bounded precision-timeline frame may
// pan. Tables reflow instead of scrolling, task names wrap instead of being
// cut, and chart labels never draw on top of one another. The rendered proof
// is the browser gate (site/scripts/verify-v12-browser.mjs); these tests pin
// the rules that make it pass.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const S = require("../../../site/src/steps.js")
const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

test("a stacked table cell is named by its column heading, spans included", () => {
  assert.deepEqual(S.columnLabels([{ text: "Task", span: 1 }, { text: "Lead time", span: 1 }]), ["Task", "Lead time"])
  assert.deepEqual(S.columnLabels([{ text: " Week ", span: 1 }, { text: "Bars", span: 2 }, { text: "", span: 1 }]), ["Week", "Bars", "Bars", ""])
  assert.deepEqual(S.columnLabels([{ text: "A", span: 0 }, { text: "B" }]), ["A", "B"], "a missing or zero span counts as one column")
  assert.deepEqual(S.columnLabels(null), [])
})

test("a table that does not fit its holder becomes stacked cards instead of scrolling", () => {
  const app = read("site/src/app.js")
  assert.match(app, /function fitTables\(/)
  // Measured with the cards undone, so a holder that has grown wide enough goes back to a table.
  assert.match(app, /classList\.remove\("stacked", "fit-wrap"\)/)
  assert.match(app, /new MutationObserver\(scheduleFit\)/)
  const css = read("site/src/styles.css")
  assert.match(css, /\.stacked > table\.data-table > thead \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\); \}/)
  assert.match(css, /\.stacked > table\.data-table td::before, \.stacked > table\.data-table tbody th::before \{ content: attr\(data-label\) ": ";/)
})

test("long public task names wrap in Compare's phone table; none is cut with an ellipsis", () => {
  const css = read("site/src/styles.css")
  assert.doesNotMatch(css, /sb-compact[^{]*\{[^}]*text-overflow: ellipsis/)
  assert.match(css, /table\.data-table\.sb-compact td:first-child \{ width: 100%; white-space: normal; overflow-wrap: anywhere; \}/)
})

test("only the session's precision timeline may pan, marked and named by a visible label", () => {
  const app = read("site/src/app.js")
  assert.match(app, /data-precision-frame/)
  assert.match(app, /aria-labelledby/)
})

test("a chart wraps its bars into rows that fit, so it never pans", () => {
  // Bars per row: as many columns as fit, never fewer than one; every bar lands in exactly one row.
  assert.deepEqual(S.chartRows(10, 30, 100), [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]])
  assert.deepEqual(S.chartRows(5, 100, 50), [[0], [1], [2], [3], [4]])
  assert.deepEqual(S.chartRows(4, 10, 1000), [[0, 1, 2, 3]])
  assert.deepEqual(S.chartRows(0, 10, 100), [])
})

test("weekly labels are thinned to what fits; the table keeps every week", () => {
  // Every label is kept when there is room; otherwise every nth, always the last.
  assert.deepEqual(S.labelStride(8, 40, 30), 1)
  assert.equal(S.labelStride(26, 20, 70), 4)
  assert.equal(S.labelStride(26, 0, 70), 26)
  const kept = S.thinnedLabels(26, 4)
  assert.equal(kept[kept.length - 1], 25, "the latest week keeps its label")
  assert.ok(kept.every((k, i) => i === 0 || k - kept[i - 1] >= 4 || k === 25))
})

test("a body cell's column accounts for row spans above it", () => {
  // Row 1: a cell spanning two rows, then two cells; row 2 starts in column 1.
  assert.deepEqual(S.bodyCellColumns([[{ rowSpan: 2 }, {}, {}], [{}, {}]]), [[0, 1, 2], [1, 2]])
  assert.deepEqual(S.bodyCellColumns([[{ colSpan: 2 }, {}], [{}, {}, {}]]), [[0, 2], [0, 1, 2]])
  assert.deepEqual(S.bodyCellColumns([]), [])
})

test("a table first wraps its text to fit; only a table that still cannot fit becomes cards, which keep table semantics", () => {
  const app = read("site/src/app.js")
  // Wrapping is tried before cards.
  assert.match(app, /classList\.add\("fit-wrap"\)/)
  assert.ok(app.indexOf('classList.add("fit-wrap")') < app.indexOf('classList.add("stacked")'))
  // Cards keep the table's structure for screen readers that drop it when display changes.
  for (const role of ["table", "rowgroup", "row", "cell", "columnheader", "rowheader"]) assert.match(app, new RegExp(`"${role}"`))
  const css = read("site/src/styles.css")
  assert.doesNotMatch(css, /table\.data-table td, table\.data-table th \{ min-width: 60px; \}/)
  assert.match(css, /\.fit-wrap > table\.data-table td, \.fit-wrap > table\.data-table th \{/)
  // On a wide holder the cards sit side by side, each value on its label's line.
  assert.match(css, /@container \(width > 560px\) \{\n  \.stacked > table\.data-table > tbody \{ display: grid;/)
})

test("the phone steps break between words, never inside one", () => {
  const css = read("site/src/styles.css")
  const phone = css.slice(css.indexOf("@media (max-width: 600px) {\n  .topbar-row"))
  const block = phone.slice(0, phone.indexOf("\n}\n"))
  assert.doesNotMatch(block, /overflow-wrap: anywhere/)
  assert.doesNotMatch(block, /\.step \{[^}]*min-width: 0/)
})

test("a wrapped chart row repeats no element id", () => {
  const app = read("site/src/app.js")
  assert.match(app, /removeAttribute\("id"\)/)
})

test("a table that fits only by wrapping keeps whichever is shorter, the table or the cards", () => {
  const app = read("site/src/app.js")
  assert.match(app, /const asTable = h\.getBoundingClientRect\(\)\.height;\n\s+h\.classList\.add\("stacked"\);\n\s+if \(h\.getBoundingClientRect\(\)\.height >= asTable\) h\.classList\.remove\("stacked"\);/)
  const css = read("site/src/styles.css")
  assert.match(css, /minmax\(min\(100%, 300px\), 1fr\)/, "cards grid by pixels, so doubled text still gets several columns")
})
