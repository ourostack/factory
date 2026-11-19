#!/usr/bin/env node
// Puts Ouro UI's fragmentFocusScript first in each built page's <body>, after every stylesheet in its <head>, so
// Safari keeps a person's focus on a page opened at a place on it (evidence.html#method) as later stylesheets load.
// The script comes from the Ouro UI release this repository records (lib/ouro/fragment-focus-script.ts), so an update
// of that release updates it too. Ouro check's fragment-focus rule names a page without it.
//
//   node site/scripts/fragment-focus.mjs site/dist/index.html site/dist/evidence.html
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fragmentFocusScript } from "../../lib/ouro/fragment-focus-script.ts";

const MARK = "data-ouro-fragment-focus";

/** The page with the script first in its body, once: a page that already has it is returned as it was. */
export function withFragmentFocus(html) {
  if (html.includes(MARK)) return html;
  const body = /<body\b[^>]*>/i.exec(html);
  if (!body) throw new Error("the page has no <body> to put fragmentFocusScript in");
  const at = body.index + body[0].length;
  return `${html.slice(0, at)}\n<script ${MARK}>${fragmentFocusScript()}</script>${html.slice(at)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const pages = process.argv.slice(2);
  if (!pages.length) throw new Error("usage: fragment-focus.mjs <page.html>…");
  for (const page of pages) writeFileSync(page, withFragmentFocus(readFileSync(page, "utf8")));
  console.log(`fragmentFocusScript: first in the body of ${pages.length} page(s)`);
}
