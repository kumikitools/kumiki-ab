#!/usr/bin/env node
/**
 * Smoke test for create-kumiki (TASK-11 DoD).
 *
 * Asserts:
 *   (a) wrangler deploy --dry-run bundles the scaffolded project cleanly (no auth)
 *   (b) vitest run is green inside the scaffolded project (Miniflare + local D1, no auth)
 *   (c) unknown-tool invocation exits nonzero and prints help
 *
 * Run: node test/smoke.mjs  (or via `npm test -w create-kumiki`)
 * Requires: npm, wrangler (available via the scaffolded devDeps after npm install)
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const repoRoot = resolve(pkgRoot, "../..");
const schemaDir = resolve(repoRoot, "packages/schema");
const cliEntry = join(pkgRoot, "index.mjs");

let tmpDir;
let pass = 0;
let fail = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  pass++;
}

function fail_(label, detail = "") {
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
  fail++;
}

function run(cmd, cwd, opts = {}) {
  return spawnSync(cmd, { shell: true, cwd, encoding: "utf8", timeout: 300_000, ...opts });
}

try {
  console.log("\ncreate-kumiki smoke test\n");

  // (c) Unknown-tool exits nonzero
  {
    const r = run(`node ${cliEntry} unknown-xyz-tool`, repoRoot);
    if (r.status !== 0 && (r.stderr || r.stdout).includes("Unknown tool")) {
      ok("unknown-tool exits nonzero with help");
    } else {
      fail_("unknown-tool exits nonzero with help", `exit ${r.status}`);
    }
  }

  // Build schema to ensure dist/ exists
  {
    const r = run("npm run build -w @kumikitools/schema", repoRoot);
    if (r.status === 0) {
      ok("schema builds at 0.1.0");
    } else {
      fail_("schema builds at 0.1.0", r.stderr || r.stdout);
      throw new Error("schema build failed — cannot continue smoke test");
    }
  }

  // Pack schema into a local tarball
  let tarball;
  {
    const r = run("npm pack --json", schemaDir);
    if (r.status !== 0) {
      fail_("npm pack schema", r.stderr || r.stdout);
      throw new Error("npm pack failed");
    }
    const packed = JSON.parse(r.stdout.trim());
    tarball = resolve(schemaDir, packed[0].filename);
    ok(`schema packed → ${packed[0].filename}`);
  }

  // Scaffold into a temp dir (--no-install; we'll patch package.json first)
  tmpDir = mkdtempSync(join(tmpdir(), "kumiki-smoke-"));
  const scaffoldDir = join(tmpDir, "ab");
  {
    const r = run(`node ${cliEntry} ab ${scaffoldDir} --no-install`, repoRoot);
    if (r.status === 0 && existsSync(join(scaffoldDir, "package.json"))) {
      ok("scaffold ab --no-install succeeds");
    } else {
      fail_("scaffold ab --no-install", r.stderr || r.stdout);
      throw new Error("scaffold failed — cannot continue");
    }
  }

  // Patch package.json: replace @kumikitools/schema version with file: tarball
  {
    const pkgPath = join(scaffoldDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.dependencies["@kumikitools/schema"] = `file:${tarball}`;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    ok("patched package.json to use local schema tarball");
  }

  // npm install in scaffolded dir
  {
    const r = run("npm install", scaffoldDir);
    if (r.status === 0) {
      ok("npm install in scaffolded project");
    } else {
      fail_("npm install in scaffolded project", r.stderr || r.stdout);
      throw new Error("npm install failed");
    }
  }

  // (a) wrangler deploy --dry-run
  {
    const outDir = join(tmpDir, "dry-run-out");
    const r = run(`npx wrangler deploy --dry-run --outdir ${outDir}`, scaffoldDir);
    if (r.status === 0) {
      ok("wrangler deploy --dry-run bundles clean");
    } else {
      fail_("wrangler deploy --dry-run", r.stderr || r.stdout);
    }
  }

  // (b) vitest run (Miniflare + local D1, no auth)
  {
    const r = run("npx vitest run", scaffoldDir);
    if (r.status === 0) {
      ok("vitest run is green in scaffolded project");
    } else {
      fail_("vitest run in scaffolded project", r.stderr || r.stdout);
    }
  }
} finally {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
