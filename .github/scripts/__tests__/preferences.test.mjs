import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
const require = createRequire(import.meta.url)
const file = new URL("../../../site/src/preferences.js", import.meta.url)
const P = existsSync(file) ? require(file.pathname) : {}
const storage = () => {
  const values = new Map()
  return { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) }
}
test("return_visit_requires_comparable_generation", () => {
  assert.equal(typeof P.readPreferences, "function")
  const s = storage()
  const fresh = P.readPreferences(s, "America/Los_Angeles")
  assert.equal(fresh.schema, "factory.preferences/2")
  assert.equal(fresh.zone, "America/Los_Angeles")
  assert.equal(fresh.previous, null)
  assert.equal(P.savePreferences(s, { dismissed: true, zone: "UTC" }).saved, true)
  assert.equal(P.readPreferences(s, "America/Los_Angeles").dismissed, true)
  const previous = { schema: "factory-overview-summary/1", generation: "factory-site/3:" + "a".repeat(40), at: "2026-10-11T15:00:00Z", attention: ["loop:alarm"], agents: [], investigation: [] }
  assert.equal(P.savePreferences(s, { previous }).saved, true)
  assert.deepEqual(P.readPreferences(s, "UTC").previous, previous)
  assert.equal(P.savePreferences(s, { previous: { ...previous, schema: "other" } }).saved, false)
  assert.equal(P.savePreferences(s, { zone: "PST" }).saved, false)
  assert.equal(P.savePreferences(s, { previous: { ...previous, at: "2099-01-01T00:00:00Z" } }).saved, false, "a future timestamp is not a previous visit")
  for (const denied of [null, { getItem() { throw Error("denied") }, setItem() { throw Error("quota") } }]) {
    assert.equal(P.readPreferences(denied, "UTC").persistent, false)
    assert.equal(P.savePreferences(denied, { dismissed: true }).saved, false)
  }
})
test("only comparable public overview summaries support bounded deltas, not a complete history", () => {
  const bFile = new URL("../../../site/src/briefing.js", import.meta.url)
  const B = existsSync(bFile) ? require(bFile.pathname) : {}
  assert.equal(typeof B.visitChanges, "function")
  const doc = { generation: "factory-site/3:" + "b".repeat(40), attention: [{ id: "new" }], agents: [], investigation: [] }
  const previous = { schema: "factory-overview-summary/1", generation: "factory-site/3:" + "a".repeat(40), at: "2026-10-10T15:00:00Z", attention: ["old"], agents: [], investigation: [] }
  const changes = B.visitChanges(doc, previous)
  assert.equal(changes.state, "comparable")
  assert.equal(changes.added, 1)
  assert.equal(changes.removed, 1)
  assert.equal(changes.complete_history, false)
  for (const prev of [null, { ...previous, schema: "other" }, { ...previous, generation: doc.generation }, { ...previous, attention: null }]) assert.notEqual(B.visitChanges(doc, prev).state, "comparable")
  assert.equal(B.visitChanges({ ...doc, generation: "factory-site/3:unknown" }, { ...previous, generation: "factory-site/3:unknown" }).state, "not_comparable")
})
