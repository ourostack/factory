// Text fills its column: the page container (.wrap) is the only width limit on
// text (Ari, 2026-10-20). Table cells, inputs and the tooltip keep their own sizes.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const css = readFileSync(new URL("../../../site/src/styles.css", import.meta.url), "utf8")
const allowed = /^(\.wrap|\.tooltip|\.task-select|\.picker-search|#chart-intake)$/
const tableCell = /\b(td|th)\b/

test("no text has its own line-length cap", () => {
  assert.match(css, /--prose-width:\s*none;/)
  const offenders = []
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/max-width:\s*[\d.]+(ch|em|rem)\b/.test(body)) continue
    const name = selector.trim().split("\n").pop().trim()
    if (!allowed.test(name) && !tableCell.test(name)) offenders.push(name)
  }
  assert.deepEqual(offenders, [])
})
