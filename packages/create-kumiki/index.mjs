#!/usr/bin/env node
/**
 * create-kumiki — scaffolder for Kumiki Tools.
 *
 * Usage:
 *   npm create kumiki@latest ab [dir] [--no-install]
 *   npm create kumiki@latest          → interactive tool picker
 */

import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as p from "@clack/prompts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOOLS = {
  ab: {
    label: "Kumiki A/B",
    description: "Agent-native A/B testing on Cloudflare Workers + D1",
    template: "ab",
  },
  analytics: {
    label: "Kumiki Analytics",
    description: "Coming soon — stay tuned",
    comingSoon: true,
  },
};

const NEXT_STEPS = `
  Next steps:
    1. Create your D1 database:
       wrangler d1 create kumiki

    2. Paste the returned database_id into wrangler.toml

    3. Apply migrations and deploy:
       wrangler d1 migrations apply kumiki --remote
       wrangler deploy

    4. Add the snippet to your site's <head>:
       <script src="https://<your-worker>.workers.dev/s.js?site=<SITE_ID>"></script>
`;

/** Recursively copy a directory, renaming _gitignore → .gitignore. */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destEntry = entry === "_gitignore" ? ".gitignore" : entry;
    const destPath = join(dest, destEntry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/** Set the project name in the scaffolded package.json. */
function patchPackageJson(dir, projectName) {
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = projectName;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

async function scaffoldAb(targetDir, install) {
  const templateDir = join(__dirname, "templates", "ab");
  const absTarget = resolve(targetDir);

  p.log.step(`Scaffolding Kumiki A/B into ${absTarget} …`);
  copyDir(templateDir, absTarget);
  patchPackageJson(absTarget, basename(absTarget));
  p.log.success("Template copied.");

  if (install) {
    p.log.step("Installing dependencies (npm install) …");
    execSync("npm install", { cwd: absTarget, stdio: "inherit" });
    p.log.success("Dependencies installed.");
  }

  p.note(NEXT_STEPS, "Ready!");
  p.outro(install ? "Done. Dependencies installed." : "Done. Run npm install when ready.");
}

async function picker() {
  p.intro("Kumiki Tools — agent-native, free, self-hosted marketing tools");

  const options = Object.entries(TOOLS).map(([value, t]) => ({
    value,
    label: t.label,
    hint: t.comingSoon ? "coming soon" : t.description,
  }));

  const tool = await p.select({
    message: "Which tool do you want to scaffold?",
    options,
  });

  if (p.isCancel(tool)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  if (TOOLS[tool].comingSoon) {
    p.outro(`${TOOLS[tool].label} is coming soon — https://github.com/kumikitools/kumiki-ab`);
    process.exit(0);
  }

  const dir = await p.text({
    message: "Project directory?",
    placeholder: "kumiki-ab",
    defaultValue: "kumiki-ab",
    validate(v) {
      const d = resolve(v || "kumiki-ab");
      if (existsSync(d) && readdirSync(d).length > 0) {
        return `Directory "${d}" is not empty. Choose a different name.`;
      }
    },
  });

  if (p.isCancel(dir)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return { tool, dir: dir || "kumiki-ab" };
}

async function main() {
  const args = process.argv.slice(2);
  const noInstall = args.includes("--no-install");
  const filteredArgs = args.filter((a) => a !== "--no-install");

  const toolArg = filteredArgs[0];
  const dirArg = filteredArgs[1];

  // Bare invocation → interactive picker
  if (!toolArg) {
    const { tool, dir } = await picker();
    if (tool === "ab") {
      await scaffoldAb(dir, !noInstall);
    }
    return;
  }

  // Positional dispatch — unknown tool
  if (!TOOLS[toolArg]) {
    console.error(`\n  Unknown tool: "${toolArg}"`);
    console.error(`  Available: ${Object.keys(TOOLS).filter((k) => !TOOLS[k].comingSoon).join(", ")}\n`);
    console.error(`  Usage:  npm create kumiki@latest <tool> [dir] [--no-install]\n`);
    process.exit(1);
  }

  if (TOOLS[toolArg].comingSoon) {
    console.log(`\n  ${TOOLS[toolArg].label} is coming soon.`);
    console.log(`  Track progress: https://github.com/kumikitools/kumiki-ab\n`);
    process.exit(0);
  }

  const targetDir = dirArg || "kumiki-ab";
  const absTarget = resolve(targetDir);

  if (existsSync(absTarget) && readdirSync(absTarget).length > 0) {
    console.error(`\n  Error: directory "${targetDir}" is not empty.\n`);
    process.exit(1);
  }

  p.intro(`Kumiki A/B — ${TOOLS.ab.description}`);

  if (toolArg === "ab") {
    await scaffoldAb(targetDir, !noInstall);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
