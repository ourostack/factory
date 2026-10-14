import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const S = require("../../../site/src/steps.js")
const n = (value, bound) => ({ state: "partial", value, bound, reasons: ["censored"] })

test("an open task retains its working lower bound in words, not only its table", () => {
  assert.equal(S.totalWords(n(287973, "lower"), true), "at least 4 minutes 47 seconds so far")
})

test("an open task retains upper and unknown working bounds with directional rounding", () => {
  assert.equal(S.totalWords(n(287973, "upper"), true), "at most 4 minutes 48 seconds so far")
  assert.equal(S.totalWords(n(287973, null), true), "about 4 minutes 48 seconds so far")
  assert.equal(S.totalWords({ state: "measured", value: 287973, reasons: [] }, true), "4 minutes 48 seconds so far")
})

test("working bar labels retain source bounds for open tasks", () => {
  const task = {
    job: "bounded", status: { state: "measured", value: "drafting", reasons: [] },
    lead_time_ms: n(393280, "lower"), working_ms: n(287973, "lower"),
  }
  const stack = {
    job: "bounded", lead_time_ms: task.lead_time_ms, working_ms: task.working_ms,
    segments: [{ key: "value", ms: 287973 }],
  }
  const [bar] = S.stackBars([{ id: "bounded", status: "drafting" }], [stack], [task], { mode: "working", segments: [{ key: "value", label: "Value-adding" }] })
  assert.equal(bar.label, "≥4m 47s")
  assert.equal(bar.words, "at least 4 minutes 47 seconds so far")
})
