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
