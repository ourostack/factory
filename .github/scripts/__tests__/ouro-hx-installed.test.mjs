import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

// The Ouro HX files this site installs must still be the ones the record names, byte for byte.
const record = JSON.parse(readFileSync(new URL("../../ouro-hx-installed.json", import.meta.url), "utf8"));
const root = new URL("../../../", import.meta.url);

test("every installed Ouro file equals the sha256 the record names", () => {
  assert.match(record.tag, /^v\d+\.\d+\.\d+$/);
  assert.match(record.tagCommit, /^[0-9a-f]{40}$/);
  for (const [file, digest] of Object.entries(record.files)) {
    const actual = createHash("sha256").update(readFileSync(new URL(file, root))).digest("hex");
    assert.equal(actual, digest, `${file} differs from ${record.tag}; reinstall it from that tag`);
  }
});
