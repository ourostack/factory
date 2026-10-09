import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { ALLOWLIST } from "../maintenance-allowlist.mjs"
import { LOOP_KEYS } from "../../../site/scripts/loop-health.mjs"

const README = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")

test("the README explains how the loop closes, so the doc and the scripts cannot drift", () => {
  assert.match(README, /^## How the loop closes itself$/m)
  const section = README.slice(README.indexOf("## How the loop closes itself"))
  // Every auto-merged path the script allows is named, and the paths it keeps for a maintainer are too.
  assert.equal(ALLOWLIST.length, 2)
  assert.match(section, /`corrections\/\*\.json`/)
  assert.match(section, /`factory\.json`/)
  for (const kept of ["`intake.json`", "`capture.json`", "`.github/`"]) assert.ok(section.includes(kept), kept)
  // Every key of the loop slot the site reads is named.
  for (const key of LOOP_KEYS) assert.ok(section.includes(`\`${key}\``), key)
})

test("the README does not say Desk has yet to send the loop slot, and names why a record has none", () => {
  assert.doesNotMatch(README, /does not yet \(that delivery/)
  assert.match(README, /Desk sends each machine's loop health inside its capture record/)
  assert.match(README, /an older Desk, or its loop has not run yet or has not measured for over three days/)
})

test("the README's store guarantees cover /4, including that a public desk publishes every PR as created: false", () => {
  const section = README.slice(README.indexOf("## What the store guarantees"), README.indexOf("## Capture records"))
  assert.match(section, /`desk\.factory\.published\/1`, `\/2`, `\/3` or `\/4`/)
  for (const key of ["jobs[].finished_on", "jobs[].finished_basis", "refs.prs[].created", "stop", "asks", "pending_agents"]) assert.ok(section.includes(`\`${key}\``), key)
  assert.match(section, /A public desk publishes every pull request as `created: false`/)
  assert.match(section, /A correction under `corrections\/` knows all four/)
})

test("the README's No content bullet says stop.asks is only a yes/no bit, and the section names finish days and prompt times", () => {
  const section = README.slice(README.indexOf("## No who, no content, just how"), README.indexOf("## What the store guarantees"))
  assert.match(section, /`stop\.asks`, a yes\/no bit/)
  assert.match(section, /UTC day each task finished and the times of the operator's prompts/)
})

test("the README states the unavailable limit the store's mirror accepts: every field with every reason once", async () => {
  const { PUBLISHED_UNAVAILABLE_FIELDS, UNAVAILABLE_REASONS, UNAVAILABLE_LIMIT } = await import("../lib/corrections.mjs")
  const stated = /(\d+) fields by (\d+) reasons today, so (\d+) entries/u.exec(README)
  assert.ok(stated, "the README states the unavailable limit")
  assert.deepEqual(stated.slice(1).map(Number), [PUBLISHED_UNAVAILABLE_FIELDS.length, UNAVAILABLE_REASONS.length, UNAVAILABLE_LIMIT])
})
