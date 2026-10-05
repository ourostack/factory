import assert from "node:assert/strict"
import { test } from "node:test"

import {
  featuredNumbers,
  modelRollups,
  subagentRollups,
  toolKindRollups,
} from "../../../site/scripts/session-numbers.mjs"

const session = (over = {}) => ({
  session: { host: "claude-code", id: "s", duration_ms: 1000, ended: true },
  models: [],
  agents: [],
  intervals: [],
  counts: { tool_calls: {}, tool_failures: {} },
  unavailable: [],
  ...over,
})
const model = (id, requests, tokens = {}) => ({
  id,
  requests,
  tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4, reasoning: null, ...tokens },
})

test("sessions with no models are unmeasured members, not zero requests", () => {
  const r = modelRollups([
    session({ models: [model("m1", 10)] }),
    session({ models: [model("m1", 5)] }),
    session({ models: [] }),
  ])
  assert.equal(r.total_requests.value, 15)
  assert.equal(r.total_requests.n, 2)
  assert.equal(r.total_requests.N, 3)
  assert.equal(r.total_requests.state, "partial")
  assert.deepEqual(r.models.map((m) => m.id), ["m1"])
  assert.equal(r.models[0].requests.value, 15)
  assert.equal(r.models[0].requests.n, 2)
  assert.equal(r.models[0].output.value, 4)
})

test("a null token counter is unmeasured, never added as zero", () => {
  const r = modelRollups([
    session({ models: [model("m1", 1, { output: null })] }),
    session({ models: [model("m1", 1, { output: 7 })] }),
  ])
  assert.equal(r.models[0].output.value, 7)
  assert.equal(r.models[0].output.n, 1)
  assert.equal(r.models[0].output.N, 2)
  assert.equal(r.models[0].requests.n, 2)
})

test("a model used by no measured session is unavailable, with no value", () => {
  const r = modelRollups([session({ models: [model("m1", null)] })])
  assert.equal(r.models[0].requests.state, "unavailable")
  assert.equal("value" in r.models[0].requests, false)
})

test("a session that flags its models field is unmeasured with the flag's reason", () => {
  const r = modelRollups([
    session({ models: [], unavailable: [{ field: "models", reason: "source_unreadable" }] }),
  ])
  assert.equal(r.total_requests.state, "unavailable")
  assert.ok(r.total_requests.reasons.includes("source_unreadable"))
})

test("a session whose subagent logs could not be read does not count as zero subagents", () => {
  const r = subagentRollups([
    session({ agents: [{ n: 1, parent: null }, { n: 2, parent: 1 }, { n: 3, parent: 1 }] }),
    session({ agents: [] }),
    session({ agents: [], unavailable: [{ field: "turns", reason: "source_unreadable" }] }),
    session({ agents: [], unavailable: [{ field: "tool_durations", reason: "log_truncated" }] }),
  ])
  assert.equal(r.dispatches.value, 2)
  assert.equal(r.dispatches.n, 2)
  assert.equal(r.dispatches.N, 4)
  assert.equal(r.sessions_with_subagents.value, 1)
  assert.equal(r.buckets["0"].value, 1)
  assert.equal(r.buckets["1-2"].value, 1)
  assert.equal(r.buckets["0"].N, 4)
  assert.equal(r.buckets["0"].n, 2)
})

test("a session still open is not unmeasured for subagents", () => {
  const r = subagentRollups([session({ unavailable: [{ field: "tool_durations", reason: "session_open" }] })])
  assert.equal(r.dispatches.state, "measured")
  assert.equal(r.dispatches.value, 0)
})

test("tool kinds roll up calls and failures over the same measured sessions", () => {
  const r = toolKindRollups([
    session({ counts: { tool_calls: { shell: 10 }, tool_failures: { shell: 2 } } }),
    session({ counts: { tool_calls: { shell: 5, read: 1 }, tool_failures: {} } }),
    session({ counts: {}, unavailable: [] }),
    session({
      counts: { tool_calls: { shell: 100 }, tool_failures: { shell: 50 } },
      unavailable: [{ field: "tool_durations", reason: "log_truncated" }],
    }),
  ])
  const shell = r.kinds.find((k) => k.tool === "shell")
  assert.equal(shell.calls.value, 15)
  assert.equal(shell.failures.value, 2)
  assert.equal(shell.calls.n, 2)
  assert.equal(shell.calls.N, 4)
  assert.equal(shell.failure_rate.value, 2 / 15)
  const read = r.kinds.find((k) => k.tool === "read")
  assert.equal(read.failures.value, 0)
  assert.equal(r.total_calls.value, 16)
  assert.equal(r.total_calls.n, 2)
})

test("featured session numbers carry state", () => {
  const f = featuredNumbers(
    session({
      session: { host: "claude-code", id: "abcdef123456", duration_ms: 7200000, ended: true },
      intervals: [{ kind: "turn", start_ms: 0, end_ms: 1000 }, { kind: "human_wait", start_ms: 1000, end_ms: 5000 }],
      agents: [{ n: 1, parent: null }, { n: 2, parent: 1 }],
      counts: { tool_calls: { shell: 3 }, tool_failures: { shell: 1 } },
    }),
  )
  assert.deepEqual(f.duration_ms, { state: "measured", value: 7200000, reasons: [] })
  assert.equal(f.active_ms.value, 1000)
  assert.equal(f.subagent_count.value, 1)
  assert.equal(f.tool_calls_total.value, 3)
  assert.equal(f.tool_failures_total.value, 1)

  const bare = featuredNumbers(session({ intervals: [], counts: {} }))
  assert.equal(bare.active_ms.state, "unavailable")
  assert.equal(bare.tool_calls_total.state, "unavailable")
  const flagged = featuredNumbers(
    session({ intervals: [{ kind: "turn", start_ms: 0, end_ms: 10 }], unavailable: [{ field: "turns", reason: "log_truncated" }] }),
  )
  assert.equal(flagged.active_ms.state, "partial")
})
