import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { llmsText, publishData } from "../../../site/scripts/publish-files.mjs";

test("the published data inventory and agent index discover session catalog and fragments", (t) => {
  const root = mkdtempSync(join(tmpdir(), "factory-session-publication-"));
  t.diagnostic(`Retained synthetic fixture: ${root}`);
  const reports = join(root, "reports"), dist = join(root, "dist");
  const id = "11111111-1111-4111-8111-111111111111";
  mkdirSync(reports);
  mkdirSync(join(dist, "sessions"), { recursive: true });
  writeFileSync(join(dist, "sessions", "index.json"), JSON.stringify({ schema: "factory-session-catalog/1", sessions: [] }));
  writeFileSync(join(dist, "sessions", `${id}.json`), JSON.stringify({ schema: "factory-session-detail/1" }));
  const result = publishData({ reports, dist });
  const files = result.files.filter((file) => file.path.startsWith("sessions/"));
  assert.deepEqual(files.map((file) => file.path).sort(), [`sessions/${id}.json`, "sessions/index.json"].sort());
  const index = llmsText("{{FILES}}", result.files);
  assert.ok(index.includes("sessions/index.json"));
  assert.ok(index.includes(`sessions/${id}.json`));
  assert.match(index, /factory-session-catalog\/1/);
  assert.match(index, /factory-session-detail\/1/);
  assert.match(index, /overlap/);
});
