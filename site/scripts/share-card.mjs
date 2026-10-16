#!/usr/bin/env node
// Draws the site's share card at deploy time, from the page's own og:title and
// og:description, so the card can never drift from the copy.
//
//   node site/scripts/share-card.mjs --deps <dir with satori and @resvg/resvg-js> --out site/dist/og.png
//
// The site has no package.json, so the pages workflow installs the two pinned
// renderers into a temporary folder and passes it here. Design: the Ouro brand,
// light theme, as on ouroboros.bot and ouro.bot: warm paper, a green rule, the
// title in Cormorant Garamond, the description in Outfit, the approved Factory
// render on the right and the "ouro" wordmark with its mark bottom left.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
if (!args.deps || !args.out) throw new Error("usage: share-card.mjs --deps <dir> --out <png>");

const fromDeps = createRequire(join(resolve(args.deps), "package.json"));
const load = async (name) => import(pathToFileURL(fromDeps.resolve(name)).href);
// require.resolve finds the CommonJS entry, whose exports arrive as the default.
const satoriModule = await load("satori");
const satori = typeof satoriModule.default === "function" ? satoriModule.default : satoriModule.default.default;
const resvgModule = await load("@resvg/resvg-js");
const Resvg = resvgModule.Resvg ?? resvgModule.default.Resvg;

// The page's own share text: the attribute values, entities decoded.
const html = readFileSync(join(here, "../src/index.html"), "utf8");
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const meta = (property) => {
  const match = html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`));
  if (!match) throw new Error(`site/src/index.html needs ${property} for its share card`);
  return decode(match[1]);
};
const title = meta("og:title");
const subtitle = meta("og:description");

const COLOR = { paper: "#FFFAF0", cream: "#F5EFE0", scale: "#1F6A37", ink: "#1A2118", mist: "#3D4839" };
const png = (file) => `data:image/png;base64,${readFileSync(join(here, "../og/marks", file)).toString("base64")}`;
const div = (style, children) => ({ type: "div", props: { style, children } });
const titleSize = title.length > 60 ? 62 : title.length > 40 ? 72 : title.length > 25 ? 84 : 96;

const svg = await satori(
  div({ width: "1200px", height: "630px", display: "flex", position: "relative", background: `linear-gradient(160deg, ${COLOR.paper} 0%, ${COLOR.cream} 100%)`, fontFamily: "Outfit", overflow: "hidden" }, [
    div({ position: "absolute", top: 0, left: 0, right: 0, height: "6px", background: COLOR.scale }),
    div({ display: "flex", flexDirection: "column", justifyContent: "center", width: "760px", padding: "64px 0 120px 80px" }, [
      div({ display: "flex", fontFamily: "Cormorant Garamond", fontSize: `${titleSize}px`, lineHeight: 1.04, letterSpacing: "-0.01em", color: COLOR.ink, textWrap: "balance" }, title),
      div({ display: "flex", fontSize: "25px", lineHeight: 1.4, color: COLOR.mist, marginTop: "28px", textWrap: "balance" }, subtitle),
    ]),
    div({ position: "absolute", right: "72px", top: "0", bottom: "40px", width: "320px", display: "flex", alignItems: "center", justifyContent: "center" }, [
      { type: "img", props: { src: png("factory.png"), width: 320, height: 320 } },
    ]),
    div({ position: "absolute", left: "80px", bottom: "48px", display: "flex", alignItems: "center", gap: "14px" }, [
      { type: "img", props: { src: png("ouro.png"), width: 48, height: 48 } },
      div({ display: "flex", fontFamily: "Cormorant Garamond", fontSize: "40px", color: COLOR.ink }, "ouro"),
    ]),
  ]),
  {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Cormorant Garamond", data: readFileSync(join(here, "../og/fonts/CormorantGaramond-Regular.ttf")), weight: 400, style: "normal" },
      { name: "Outfit", data: readFileSync(join(here, "../og/fonts/Outfit-Regular.ttf")), weight: 400, style: "normal" },
    ],
  },
);
writeFileSync(args.out, new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng());
console.log(`Share card drawn: ${args.out}`);
