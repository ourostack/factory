import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { measured, rollup, trust } from "../../../site/scripts/state.mjs"
import { createRequire } from "node:module"
const { coverageWords } = createRequire(import.meta.url)("../../../site/src/format.js")

// A missing value never reads as "ok" or as 0, and a check that cannot run fails the job.

const sound = rollup(Array(6).fill(measured(1)), { of: "jobs", measure: "sum", reduce: (v) => v[0] })
const unavailable = (...reasons) => ({ state: "unavailable", reasons })

test("trust is not ok when capture coverage could not be computed", () => {
  for (const reasons of [["no_capture_records"], ["x"], ["not_recorded"], []]) {
    const t = trust(sound, { coverage: unavailable(...reasons) })
    assert.notEqual(t.status, "ok", JSON.stringify(reasons))
    assert.equal(t.status, "coverage_unknown")
    assert.ok(t.causes.includes("coverage_unknown"))
    // The reason speaks of the figure and holds no raw code; the coverage words carry the coverage fact.
    assert.equal(t.reason, "6 of 6 measured")
    assert.doesNotMatch(t.reason, /not_recorded|no_capture_records|^x$/)
  }
})

test("trust keeps its other causes beside an unknown coverage", () => {
  const t = trust({ state: "measured", n: 2, N: 9 }, { coverage: unavailable("no_capture_records") })
  assert.ok(t.causes.includes("coverage_unknown") && t.causes.includes("thin_sample") && t.causes.includes("partial"))
})

test("coverage that is only not recorded yet, or measured, is unchanged", () => {
  assert.equal(trust(sound).status, "ok")
  assert.equal(trust(sound, { coverage: unavailable("not_recorded_yet") }).status, "ok")
  assert.equal(trust(sound, { coverage: { state: "measured", value: 0.9, reasons: [] } }).status, "ok")
})

test("the site words the unknown status as not measured, with the reason", () => {
  const app = readFileSync(new URL("../../../site/src/app.js", import.meta.url), "utf8")
  assert.match(app, /coverage_unknown: "capture coverage not measured"/)
  const css = readFileSync(new URL("../../../site/src/styles.css", import.meta.url), "utf8")
  assert.match(css, /\.trust-coverage_unknown/)
  assert.match(coverageWords(unavailable("no_capture_records")), /no data/)
})

const workflow = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), "utf8")

test("triage trusted checks are independent in validate/merge and main build/pages", () => {
  for (const name of ["validate.yml", "merge.yml"]) {
    const text = workflow(name)
    assert.match(text, /check-triage\.sh/)
    assert.match(text, /triage_authority_check_unavailable/)
    assert.doesNotMatch(text, /\[ -[fex] [^\]]*check-triage/)
  }
  const merge = workflow("merge.yml")
  assert.match(merge, /current_actor/)
  assert.match(merge, /collaborators\/.*\/permission/)
  assert.match(merge, /--repo "\$REPOSITORY" --pr "\$number"/)
  assert.match(merge, /trusted_maintainer/)
  for (const name of ["build.yml", "pages.yml"]) assert.match(workflow(name), /triage-values\.mjs --store/)
})

test("the store's own check scripts are never skipped when absent", () => {
  for (const name of ["validate.yml", "merge.yml"]) {
    const text = workflow(name)
    assert.doesNotMatch(text, /\[ -[fex] [^\]]*check-(corrections|capture)/, `${name} guards a check on the script existing`)
  }
  assert.doesNotMatch(workflow("validate.yml"), /; skipped"/)
  assert.match(workflow("validate.yml"), /node \.github\/scripts\/check-corrections\.mjs "\$BASE_SHA" "\$HEAD_SHA"/)
  assert.match(workflow("validate.yml"), /bash \.github\/scripts\/check-capture\.sh "\$BASE_SHA" "\$HEAD_SHA"/)
})

test("a store check that cannot run leaves the pull request open and fails the job, never rejects it", () => {
  const merge = workflow("merge.yml")
  // It is reported like validator_unavailable (no action, job fails), not as a rejection code.
  assert.match(merge, /jq -n -c --arg code "\$unavailable_check" '\{unavailable: \$code\}'/)
  assert.doesNotMatch(merge, /codes\+="capture_check_unavailable"/)
  assert.match(merge, /_check_unavailable\$/)
  assert.match(merge, /; no action"/)
  const validate = workflow("validate.yml")
  for (const code of ["corrections_check_unavailable", "capture_check_unavailable", "intake_check_unavailable", "tests_unavailable"]) {
    assert.match(validate, new RegExp(code), code)
  }
})

// The merge step's own check block, run for real: a missing capture script marks the result unavailable, it does not reject.
test("merge.yml: a missing check script yields an unavailable result, not a rejection", () => {
  const text = workflow("merge.yml")
  const a = text.indexOf('              codes=""\n              unavailable_check')
  const b = text.indexOf("            # The maintenance allowlist")
  assert.ok(a > 0 && b > a)
  const snippet = text.slice(a, b).split("\n").map((l) => l.slice(14)).join("\n")
  const run = (scripts) => {
    const dir = mkdtempSync(join(tmpdir(), "merge-"))
    mkdirSync(join(dir, ".github/scripts"), { recursive: true })
    for (const [name, body] of Object.entries(scripts)) writeFileSync(join(dir, ".github/scripts", name), body)
    writeFileSync(join(dir, "r.json"), '{"ok":true}')
    const r = spawnSync("bash", ["-c", `set -uo pipefail\nresult=r.json base_sha=a HEAD_SHA=b\n${snippet}`], { cwd: dir, encoding: "utf8" })
    return JSON.parse(readFileSync(join(dir, "r.json"), "utf8"))
  }
  assert.deepEqual(run({ "check-intake-plugins.sh": "exit 0\n" }), { unavailable: "capture_check_unavailable" })
  assert.deepEqual(run({ "check-capture.sh": "exit 0\n" }), { unavailable: "intake_check_unavailable" })
  assert.deepEqual(run({ "check-intake-plugins.sh": "exit 0\n", "check-capture.sh": "echo capture_check_unavailable; exit 1\n" }), { unavailable: "capture_check_unavailable" })
  const bad = run({ "check-intake-plugins.sh": "exit 0\n", "check-capture.sh": "echo capture_path; exit 1\n" })
  assert.deepEqual(bad, { ok: false, errors: [{ code: "capture_path" }] })
  assert.deepEqual(run({ "check-intake-plugins.sh": "exit 0\n", "check-capture.sh": "exit 0\n" }), { ok: true })
})
