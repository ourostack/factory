import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const sources = [
  ["head-tests", new URL("../../workflows/validate.yml", import.meta.url), "AUTHOR"],
  ["validate", new URL("../../workflows/validate.yml", import.meta.url), "AUTHOR"],
  ["merge", new URL("../../workflows/merge.yml", import.meta.url), "author"],
]

function permissionBlock(text, variable) {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line.includes(`if printf '%s' "$${variable}" | grep`)
    || line.includes(`if [[ \${#${variable}}`))
  assert.notEqual(start, -1, "actual author guard must exist")
  const indent = lines[start].match(/^ */)[0]
  const end = lines.findIndex((line, i) => i > start && line === `${indent}fi`)
  assert.notEqual(end, -1)
  return lines.slice(start, end + 1).map((line) => line.slice(indent.length)).join("\n")
}

for (const [name, url, variable] of sources) {
  const text = readFileSync(url, "utf8")
  const source = name === "validate" ? text.slice(text.indexOf("\n  factory-validate:\n")) : text
  const block = permissionBlock(source, variable)
  function authorize(login, permission = "write", status = "0") {
    const result = spawnSync("bash", ["-c", `
      set -uo pipefail
      association=NONE
      maintainer=no
      trusted_maintainer=unknown
      permission_json=null
      REPOSITORY=synthetic/store
      number=1
      summary() { :; }
      gh() {
        test "$2" = "repos/$REPOSITORY/collaborators/$${variable}/permission" || return 9
        test "$API_STATUS" = 0 || return "$API_STATUS"
        if [ "$RESPONSE_FORMAT" = scalar ]; then
          printf '%s' "$API_PERMISSION"
        else
          printf '{"permission":"%s"}' "$API_PERMISSION"
        fi
      }
      ${block}
      if [ "$maintainer" = yes ]; then association=COLLABORATOR; fi
      printf '\\nRESULT:%s' "$association"
    `], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, [variable]: login, API_PERMISSION: permission, API_STATUS: status,
        RESPONSE_FORMAT: name === "head-tests" ? "scalar" : "json", GITHUB_STEP_SUMMARY: "/dev/null" },
    })
    if (name === "head-tests" && status !== "0") {
      assert.equal(result.status, 1, result.stderr)
      return "NONE"
    }
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.split("RESULT:").at(-1)
  }

  test(`${name}: regular and managed usernames reach the permission API`, () => {
    for (const login of ["a", "synthetic-maintainer", "synthetic-user_example", "a".repeat(29) + "_synthetic", "a".repeat(39)]) {
      assert.equal(authorize(login), "COLLABORATOR", login)
    }
  })

  test(`${name}: empty, malformed and malicious login values fail closed`, () => {
    for (const login of ["", "_example", "user_", "user__example", "user_ex-ample", "-user", "a".repeat(40),
      "a".repeat(30) + "_synthetic", "user/permission", "../user", "user?x=1", "user%2fowner", "user name",
      "user\nother", "user\r", "user\n", "user;echo nope", "$(echo nope)", "üser_example"]) {
      assert.equal(authorize(login), "NONE", JSON.stringify(login))
    }
  })

  test(`${name}: valid syntax alone never grants maintainer authority`, () => {
    for (const permission of ["none", "read", "triage", "unknown"]) {
      assert.equal(authorize("synthetic-user_example", permission), "NONE", permission)
    }
    assert.equal(authorize("synthetic-user_example", "write", "1"), "NONE", "API denial")
    assert.equal(authorize("synthetic-user_example", "write", "22"), "NONE", "API failure")
    assert.equal(authorize("synthetic-user_example", "admin"), "COLLABORATOR")
  })
}
