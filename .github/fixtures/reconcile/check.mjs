// Checks `factory reconcile` JSON (stdin) against the fixture desk.
// Exits 1 with the failed expectations on stderr.

import { readFileSync } from "node:fs"

const report = JSON.parse(readFileSync(0, "utf8"))
const failures = []
const expect = (ok, message) => { if (!ok) failures.push(message) }

expect(report.ok !== false, `reconcile reported failure: ${report.error ?? "unknown"}`)
const tasks = report.tasks ?? []
const mismatches = report.mismatches ?? []
const has = (list, key) => list.some((item) => `${item.track}/${item.slug}` === key)
const reasonsOf = (key) => mismatches.filter((m) => `${m.track}/${m.slug}` === key).map((m) => m.reason)

for (const key of ["alpha/real-work", "alpha/odd-status", "alpha/tidy-only", "beta/sweep-1", "beta/sweep-2", "beta/sweep-3", "beta/sweep-4"]) {
  expect(has(tasks, key), `task missing from report: ${key}`)
}
expect(!has(tasks, "alpha/old-work"), "alpha/old-work committed before the window but is listed")

expect(reasonsOf("alpha/real-work").includes("no_marker"), "alpha/real-work should be no_marker")
expect(reasonsOf("alpha/odd-status").includes("no_marker"), "alpha/odd-status should be no_marker")
expect(reasonsOf("alpha/odd-status").includes("invalid_status"), "alpha/odd-status should be invalid_status")
expect(reasonsOf("alpha/tidy-only").includes("mechanical_only"), "alpha/tidy-only should be mechanical_only")
for (const n of [1, 2, 3, 4]) {
  expect(reasonsOf(`beta/sweep-${n}`).includes("mechanical_only"), `beta/sweep-${n} should be mechanical_only (mass commit)`)
}
expect(!reasonsOf("alpha/tidy-only").includes("no_marker"), "housekeeping-only task must not be no_marker")
expect(!JSON.stringify(report).includes("machine-secret"), "report mentions the machine secret")

if (failures.length > 0) {
  console.error(failures.map((f) => `reconcile fixture: ${f}`).join("\n"))
  process.exit(1)
}
console.log(`reconcile fixture: ok (${tasks.length} tasks, ${mismatches.length} mismatches)`)
