import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withFragmentFocus } from "../../../site/scripts/fragment-focus.mjs";
import { fragmentFocusScript } from "../../../lib/ouro/fragment-focus-script.ts";

test("fragmentFocusScript goes first in the body, after the head's stylesheets, once", () => {
  const page = '<!doctype html><html><head><link rel="stylesheet" href="styles.css" /></head>\n<body class="x">\n<main></main></body></html>';
  const out = withFragmentFocus(page);
  const script = `<script data-ouro-fragment-focus>${fragmentFocusScript()}</script>`;
  assert.ok(out.indexOf(script) > out.indexOf('<body class="x">'), "after the body's start tag");
  assert.ok(out.indexOf(script) < out.indexOf("<main>"), "before anything in the body");
  assert.equal(withFragmentFocus(out), out, "a page that has it is left as it was");
  assert.throws(() => withFragmentFocus("<p>no body</p>"), /no <body>/);
});

test("both of the site's pages get it when built as pages.yml builds them", () => {
  const dir = mkdtempSync(join(tmpdir(), "fragment-focus-"));
  const pages = ["index.html", "evidence.html"].map((name) => {
    const to = join(dir, name);
    writeFileSync(to, readFileSync(new URL(`../../../site/src/${name}`, import.meta.url), "utf8"));
    return to;
  });
  execFileSync(process.execPath, [new URL("../../../site/scripts/fragment-focus.mjs", import.meta.url).pathname, ...pages]);
  for (const page of pages) assert.match(readFileSync(page, "utf8"), /<body[^>]*>\n<script data-ouro-fragment-focus>/);
  assert.match(readFileSync(new URL("../../workflows/pages.yml", import.meta.url), "utf8"), /node site\/scripts\/fragment-focus\.mjs site\/dist\/index\.html site\/dist\/evidence\.html/);
});
