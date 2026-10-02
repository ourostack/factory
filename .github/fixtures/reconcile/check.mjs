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

// Accepts the old Desk shape (`no_marker`, `mechanical_only` in `tasks`) and the
// declared-focus shape (`not_bound`, tidy/sweep cards only in `housekeeping_cards`).
const housekeeping = report.housekeeping_cards ?? []
const inHousekeeping = (key) => Array.isArray(housekeeping)
  ? has(housekeeping, key)
  : typeof housekeeping === "number" && housekeeping >= 5
const unbound = (key) => ["no_marker", "not_bound"].some((r) => reasonsOf(key).includes(r))

for (const key of ["alpha/real-work", "alpha/odd-status"]) {
  expect(has(tasks, key), `task missing from report: ${key}`)
  expect(unbound(key), `${key} should be no_marker or not_bound`)
}
expect(reasonsOf("alpha/odd-status").includes("invalid_status"), "alpha/odd-status should be invalid_status")
for (const key of ["alpha/tidy-only", "beta/sweep-1", "beta/sweep-2", "beta/sweep-3", "beta/sweep-4"]) {
  expect(reasonsOf(key).includes("mechanical_only") || inHousekeeping(key), `${key} should be mechanical_only or in housekeeping_cards`)
}
expect(!has(tasks, "alpha/old-work"), "alpha/old-work committed before the window but is listed")
expect(!unbound("alpha/tidy-only"), "housekeeping-only task must not be unbound")
expect(!JSON.stringify(report).includes("machine-secret"), "report mentions the machine secret")

if (failures.length > 0) {
  console.error(failures.map((f) => `reconcile fixture: ${f}`).join("\n"))
  process.exit(1)
}
console.log(`reconcile fixture: ok (${tasks.length} tasks, ${mismatches.length} mismatches, ${Array.isArray(housekeeping) ? housekeeping.length : housekeeping} housekeeping)`)
