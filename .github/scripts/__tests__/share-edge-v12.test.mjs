// Ruling (2026-10-12): only exactly 0 and exactly 1 read as 0% and 100%. A
// share that would round onto either keeps one decimal ("99.6%"), and one that
// would still round onto the edge says which side it is on, in describe and in
// clockShareWords alike.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const F = require("../../../site/src/format.js")
const S = require("../../../site/src/steps.js")

const BOUNDS = ["measured", "lower", "upper", null, "unknown"]
const stated = (value, b) => (b === "measured" ? { state: "measured", value, reasons: [] } : { state: "partial", value, bound: b, reasons: ["log_truncated"] })
const PROD = 1e6
const shareWords = (work, b) => S.clockShareWords(stated(work, b), { state: "measured", value: PROD, reasons: [] })

// Every share near both edges, in steps of a thousandth of a point, plus a
// little past 100% (a share can exceed 1).
function* nearEdges() {
  for (let i = 0; i <= 2000; i++) yield i
  for (let i = 980000; i <= 1020000; i += 10) yield i
}

// The figure a text shows, and whether it is one of the strict side forms.
function shown(text) {
  const m = /^(?:at least |at most |about )?(more than |under |over )?(\d+(?:\.\d+)?)%/.exec(text)
  assert.ok(m, `no figure in ${JSON.stringify(text)}`)
  return { side: (m[1] || "").trim(), n: Number(m[2]) }
}

function honest(v, b, text, where) {
  const p = v * 100
  const { side, n } = shown(text)
  const at = `${where} ${JSON.stringify(b)} ${v}: ${JSON.stringify(text)}`
  if (v === 0) return assert.equal(n, 0, at)
  if (v === 1) return assert.equal(n, 100, at)
  if (side === "more than") return assert.ok(p > n, at)
  if (side === "under") return assert.ok(p < n, at)
  if (side === "over") return assert.ok(p > n, at)
  assert.ok(n !== 0 && n !== 100, `shows the edge: ${at}`)
  if (b === "lower") assert.ok(n <= p + 1e-9, `lower bound rounded up: ${at}`)
  if (b === "upper") assert.ok(n >= p - 1e-9, `upper bound rounded down: ${at}`)
  if (b !== "lower" && b !== "upper") assert.ok(Math.abs(n - p) <= 0.05 + 1e-9 || (n >= 1 && n <= 99 && Math.abs(n - p) <= 0.5 + 1e-9) || (n >= 101 && Math.abs(n - p) <= 0.5 + 1e-9), `not nearest: ${at}`)
  assert.doesNotMatch(text, /\d\.0%/, `odd form: ${at}`)
}

test("only exactly 0 and 1 read as 0% and 100%, in describe and clockShareWords, swept near both edges", () => {
  let checked = 0
  for (const w of nearEdges()) {
    const v = w / PROD
    for (const b of BOUNDS) {
      const d = F.describe(stated(v, b), "pct").text
      if (!(b === "lower" && v === 0)) honest(v, b, d, "describe")
      const c = shareWords(w, b)
      honest(v, b, c, "clockShareWords")
      checked += 2
    }
  }
  assert.ok(checked > 40000)
})

test("the ruling's examples", () => {
  assert.equal(F.describe(stated(0.996, null), "pct").text, "99.6%")
  assert.equal(F.describe(stated(0.996, "measured"), "pct").text, "99.6%")
  assert.equal(F.describe(stated(0.004, "unknown"), "pct").text, "0.4%")
  assert.equal(F.describe(stated(0.996, "lower"), "pct").text, "at least 99.6%")
  assert.equal(F.describe(stated(0.9996, "upper"), "pct").text, "under 100%")
  assert.equal(F.describe(stated(0.9996, null), "pct1").text, "over 99.9%")
  assert.equal(F.describe(stated(1, null), "pct").text, "100% (could be lower)")
  assert.equal(F.describe(stated(0, null), "pct").text, "0% (could be higher)")
  assert.equal(shareWords(996000, "measured"), "99.6% of production time")
  assert.equal(shareWords(996000, null), "about 99.6% of production time (could be higher or lower)")
  assert.equal(shareWords(4000, "upper"), "at most 0.4% of production time")
  assert.equal(shareWords(PROD, "lower"), "100% of production time")
})
