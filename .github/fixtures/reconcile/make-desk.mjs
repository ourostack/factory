// Builds a small fixture desk for `factory reconcile`: a temporary Git
// repository with dated commits, one mass commit and one housekeeping-only
// task. Usage: node make-desk.mjs <empty directory to create the desk in>.
//
// Fixture tasks (all in the window 2026-09-10 to 2026-09-13 unless noted):
//   alpha/real-work     real commits, no sessions       -> no_marker
//   alpha/odd-status    real commit, status "Active"    -> no_marker, invalid_status
//   alpha/tidy-only     only a `updated:` card edit     -> mechanical_only
//   beta/sweep-1..4     touched only by a 4-task commit -> mechanical_only (mass)
//   alpha/old-work      committed before the window     -> not listed

import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const desk = process.argv[2]
if (!desk) {
  console.error("usage: make-desk.mjs <desk directory>")
  process.exit(2)
}
mkdirSync(desk, { recursive: true })

function git(date, ...args) {
  execFileSync("git", ["-C", desk, ...args], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      PATH: process.env.PATH,
      HOME: desk,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.com",
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    },
  })
}

function write(file, text) {
  mkdirSync(join(desk, file, ".."), { recursive: true })
  writeFileSync(join(desk, file), text)
}

const card = (track, slug, { status = "processing", updated = "2026-08-01" } = {}) =>
  `---\ntitle: ${slug}\ntrack: ${track}\nstatus: ${status}\ncreated: 2026-08-01\nupdated: ${updated}\n---\n\n# ${slug}\n`

function commit(date, message, files) {
  for (const [file, text] of Object.entries(files)) write(file, text)
  git(date, "add", "-A")
  git(date, "commit", "-q", "-m", message)
}

git("2026-08-01T09:00:00Z", "init", "-q", "-b", "main")
commit("2026-08-01T09:00:00Z", "cards", {
  "alpha/track.md": "---\ntitle: alpha\n---\n",
  "beta/track.md": "---\ntitle: beta\n---\n",
  "alpha/old-work/task.md": card("alpha", "old-work"),
  "alpha/real-work/task.md": card("alpha", "real-work"),
  "alpha/odd-status/task.md": card("alpha", "odd-status", { status: "Active" }),
  "alpha/tidy-only/task.md": card("alpha", "tidy-only"),
  "beta/sweep-1/task.md": card("beta", "sweep-1"),
  "beta/sweep-2/task.md": card("beta", "sweep-2"),
  "beta/sweep-3/task.md": card("beta", "sweep-3"),
  "beta/sweep-4/task.md": card("beta", "sweep-4"),
})
commit("2026-08-02T09:00:00Z", "old work", { "alpha/old-work/notes.md": "before the window\n" })

// In the window.
commit("2026-09-10T10:00:00Z", "real work", { "alpha/real-work/notes.md": "did a thing\n" })
commit("2026-09-11T10:00:00Z", "more real work", { "alpha/real-work/notes.md": "did a thing\nand another\n" })
commit("2026-09-11T11:00:00Z", "odd status work", { "alpha/odd-status/notes.md": "work\n" })
commit("2026-09-11T12:00:00Z", "housekeeping", { "alpha/tidy-only/task.md": card("alpha", "tidy-only", { updated: "2026-09-11" }) })
commit("2026-09-12T10:00:00Z", "mass sweep", Object.fromEntries(
  [1, 2, 3, 4].map((n) => [`beta/sweep-${n}/notes.md`, "swept\n"]),
))
