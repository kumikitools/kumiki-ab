// Bundle the visual-editor overlay into a single minified IIFE that the
// bookmarklet loads onto the user's live page. Same build shape as the snippet.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const outfile = "dist/editor.js";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2019",
  outfile,
  legalComments: "none",
});

const raw = readFileSync(outfile);
const banner = "/* Kumiki A/B visual editor — MIT — https://github.com/kumikitools/kumiki-ab */\n";
writeFileSync(outfile, banner + raw);

const bytes = raw.byteLength;
const gz = gzipSync(raw).byteLength;
console.log(`built ${outfile}: ${bytes} B (${(bytes / 1024).toFixed(2)} KB), gzip ${gz} B (${(gz / 1024).toFixed(2)} KB)`);
