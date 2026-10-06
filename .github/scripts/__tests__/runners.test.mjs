import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { test } from "node:test"

const DIR = new URL("../../workflows/", import.meta.url)

// GitHub moves the `ubuntu-latest` label to a new image on its own schedule,
// which can break a build nobody changed. Every job names a pinned image.
test("every workflow job runs on a pinned image, never a moving label", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".yml"))
  assert.ok(files.length >= 5)
  for (const f of files) {
    const text = readFileSync(new URL(f, DIR), "utf8")
    const runners = [...text.matchAll(/^\s*runs-on:\s*(\S+)/gm)].map((m) => m[1])
    assert.ok(runners.length > 0, f)
    for (const r of runners) assert.equal(r, "ubuntu-24.04", `${f}: ${r}`)
  }
})
