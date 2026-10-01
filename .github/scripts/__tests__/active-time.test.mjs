import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { SUBSTANTIAL_ACTIVE_MS, activeMs, inScope } from "../../../site/scripts/active-time.mjs"

const MIN = 60 * 1000
const iv = (kind, start_ms, end_ms) => ({ kind, agent: 0, start_ms, end_ms })

test("activeMs takes the union of overlapping turn, tool and subagent intervals", () => {
  const facts = {
    intervals: [iv("turn", 0, 10), iv("tool", 5, 20), iv("subagent", 15, 25), iv("tool", 40, 50)],
  }
  assert.equal(activeMs(facts), 35)
})

test("activeMs ignores waits and unknown kinds", () => {
  const facts = { intervals: [iv("turn", 0, 10), iv("human_wait", 10, 5000), iv("api_retry", 10, 99)] }
  assert.equal(activeMs(facts), 10)
})

test("activeMs gives 0 for old facts with no intervals", () => {
  assert.equal(activeMs({}), 0)
  assert.equal(activeMs({ intervals: [] }), 0)
  assert.equal(activeMs(null), 0)
})

test("activeMs skips malformed intervals", () => {
  assert.equal(activeMs({ intervals: [iv("turn", 5, 5), iv("turn", "a", 9), null, iv("turn", 0, 4)] }), 4)
})

test("scope counts a bound session however little it was active", () => {
  assert.equal(inScope({ jobs: [{ job: "a" }], intervals: [] }), true)
})

test("scope counts an unbound session with at least 5 minutes of active time", () => {
  assert.equal(inScope({ intervals: [iv("turn", 0, SUBSTANTIAL_ACTIVE_MS)] }), true)
  assert.equal(inScope({ intervals: [iv("turn", 0, SUBSTANTIAL_ACTIVE_MS - 1)] }), false)
})

test("scope does not count wall-clock span or waiting", () => {
  const facts = {
    session: { duration_ms: 3 * 60 * MIN },
    intervals: [iv("turn", 0, MIN), iv("human_wait", MIN, 3 * 60 * MIN)],
  }
  assert.equal(inScope(facts), false)
  assert.equal(inScope({ session: { duration_ms: 3 * 60 * MIN } }), false)
})

test("the site text describing the scope says active", () => {
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")
  assert.match(app, /were active at least \$\{minutes\} minutes/)
  assert.match(app, /scopes by active time and job binding/)
  assert.doesNotMatch(app, /ran at least/)
})
