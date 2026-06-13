#!/usr/bin/env node
// Reservation stub for the `create-kumiki` initializer.
// Real scaffold tracked in kumiki-ab TASK-11. Usage shape is final:
//   npm create kumiki@latest ab     → scaffold Kumiki A/B
//   npm create kumiki@latest        → interactive tool picker
const TOOLS = {
  ab: "Kumiki A/B — agent-native A/B testing (Cloudflare + MCP)",
};

const tool = process.argv[2];
const line = "─".repeat(52);

console.log(`\n  Kumiki Tools\n${line}`);

if (tool && TOOLS[tool]) {
  console.log(`  ${tool}: ${TOOLS[tool]}`);
  console.log(`\n  The scaffolder for "${tool}" is on the way.`);
} else if (tool) {
  console.log(`  Unknown tool: "${tool}"`);
  console.log(`  Available: ${Object.keys(TOOLS).join(", ")}`);
} else {
  console.log("  Available tools:");
  for (const [k, v] of Object.entries(TOOLS)) console.log(`    ${k}  ${v}`);
  console.log(`\n  Usage:  npm create kumiki@latest <tool>`);
}

console.log(`\n  Track progress: https://github.com/kumikitools/kumiki-ab`);
console.log(`${line}\n`);
