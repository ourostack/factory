import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
    assert.match(t.reason, /coverage/)
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
  assert.match(app, /coverage_unknown: "[^"]*not measured/)
  const css = readFileSync(new URL("../../../site/src/styles.css", import.meta.url), "utf8")
  assert.match(css, /\.trust-coverage_unknown/)
  assert.match(coverageWords(unavailable("no_capture_records")), /no data/)
})

const workflow = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), "utf8")

test("the store's own check scripts are never skipped when absent", () => {
  for (const name of ["validate.yml", "merge.yml"]) {
    const text = workflow(name)
    assert.doesNotMatch(text, /\[ -[fex] [^\]]*check-(corrections|capture)/, `${name} guards a check on the script existing`)
  }
  assert.match(workflow("validate.yml"), /node \.github\/scripts\/check-corrections\.mjs "\$BASE_SHA" "\$HEAD_SHA"/)
  assert.match(workflow("validate.yml"), /bash \.github\/scripts\/check-capture\.sh "\$BASE_SHA" "\$HEAD_SHA"/)
})

test("a check that produces no code still rejects with a stable code", () => {
  const merge = workflow("merge.yml")
  assert.match(merge, /capture_check_unavailable/)
  const validate = workflow("validate.yml")
  assert.match(validate, /corrections_check_unavailable/)
  assert.match(validate, /capture_check_unavailable/)
})
