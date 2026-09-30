import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const commands = [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  [
    "node_modules/typescript/bin/tsc",
    "src/model.ts",
    "src/content.ts",
    "src/battle.ts",
    "src/companion/rules.ts",
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--outDir",
    "work/rules",
    "--noEmit",
    "false",
    "--moduleResolution",
    "node",
    "--skipLibCheck",
  ],
];
function run(args) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
for (const args of commands) run(args);
mkdirSync("work/rules", { recursive: true });
writeFileSync("work/rules/package.json", '{"type":"commonjs"}\n');
run([
  "--test",
  "tests/rules.cjs",
  "tests/chapter.cjs",
  "tests/service.mjs",
  "tests/service-edge.mjs",
  "tests/companion-rules.cjs",
  "tests/companion-service.mjs",
]);
