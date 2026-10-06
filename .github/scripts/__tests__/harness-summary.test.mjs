import assert from "node:assert/strict"
import { test } from "node:test"

import { harnessSummary, UNPROVEN_HOSTS } from "../../../site/scripts/harness-summary.mjs"

const old = {
  session: { host: "claude-code", host_version: "2.1.0" },
  agents: [{ n: 0, parent: null, model: "claude-opus-4" }],
}
const rich = {
  session: { host: "claude-code", host_version: "2.2.0" },
  agents: [
    { n: 0, parent: null, model: "claude-opus-4", requested_model: "claude-opus-4" },
    { n: 1, parent: 0, model: "claude-sonnet-4", agent_type: "Explore", requested_model: "sonnet" },
    { n: 2, parent: 1, model: "claude-sonnet-4", agent_type: "custom", requested_model: "claude-sonnet-4" },
  ],
}
const codex = {
  session: { host: "codex-cli", host_version: "0.1.0" },
  agents: [{ n: 0, parent: null, model: "gpt-5" }],
}

test("mixed old and new facts aggregate per host", () => {
  const [h] = harnessSummary([old, rich])
  assert.equal(h.host, "claude-code")
  assert.equal(h.sessions, 2)
  assert.equal(h.workers, 4)
  assert.equal(h.subagents, 2)
  assert.deepEqual(h.versions, { "2.1.0": 1, "2.2.0": 1 })
  assert.deepEqual(h.models, { "claude-opus-4": 2, "claude-sonnet-4": 2 })
  assert.deepEqual(h.agent_types, { Explore: 1, custom: 1 })
})

test("depth comes from walking parent", () => {
  assert.equal(harnessSummary([rich])[0].max_depth, 2)
  assert.equal(harnessSummary([old])[0].max_depth, 0)
})

test("requested_vs_resolved lists only pairs that differ", () => {
  const [h] = harnessSummary([rich, rich])
  assert.deepEqual(h.requested_vs_resolved, [
    { requested: "sonnet", resolved: "claude-sonnet-4", workers: 2 },
  ])
})

test("codex-cli is flagged unproven, others are not", () => {
  assert.ok(UNPROVEN_HOSTS.has("codex-cli"))
  const out = harnessSummary([old, codex])
  assert.equal(out.find((h) => h.host === "codex-cli").unproven, true)
  assert.equal(out.find((h) => h.host === "claude-code").unproven, false)
})

test("a host with no files does not appear", () => {
  assert.deepEqual(harnessSummary([]), [])
  assert.deepEqual(harnessSummary([old]).map((h) => h.host), ["claude-code"])
})

test("missing keys never throw", () => {
  const out = harnessSummary([
    {},
    { session: {} },
    { session: { host: "copilot-cli" } },
    { session: { host: "copilot-cli", host_version: "1" }, agents: "nope" },
    { session: { host: "copilot-cli" }, agents: [null, { n: 0 }, { n: 1, parent: 9, model: "m" }] },
    null,
  ])
  const c = out.find((h) => h.host === "copilot-cli")
  assert.equal(c.sessions, 3)
  assert.equal(c.max_depth, 1)
  assert.deepEqual(c.requested_vs_resolved, [])
  assert.deepEqual(c.agent_types, {})
})

test("a parent cycle does not loop forever", () => {
  const [h] = harnessSummary([
    { session: { host: "claude-code" }, agents: [{ n: 0, parent: 1 }, { n: 1, parent: 0 }] },
  ])
  assert.ok(Number.isFinite(h.max_depth))
})

test("store values named like Object properties count as plain keys", () => {
  const f = {
    session: { host: "claude-code", host_version: "constructor" },
    agents: [
      { n: 0, parent: null, model: "__proto__", agent_type: "constructor" },
      { n: 1, parent: 0, model: "toString", agent_type: "constructor" },
    ],
  }
  const [h] = harnessSummary([f])
  assert.equal(h.versions.constructor, 1)
  assert.ok(Object.hasOwn(h.models, "__proto__"))
  assert.equal(h.models.toString, 1)
  assert.equal(h.agent_types.constructor, 2)
  assert.equal(JSON.stringify(h.models), '{"__proto__":1,"toString":1}')
})

test("worker and subagent counts rest only on sessions whose agent list is whole, and say how many", () => {
  const unread = { session: { host: "claude-code", host_version: "2.2.0" }, agents: [], unavailable: [{ field: "agents", reason: "source_unreadable" }] }
  const none = { session: { host: "claude-code", host_version: "2.2.0" } }
  const [h] = harnessSummary([old, rich, unread, none])
  assert.equal(h.sessions, 4)
  assert.equal(h.agents_recorded, 2)
  assert.equal(h.workers, 4)
  assert.equal(h.subagents, 2)
})
