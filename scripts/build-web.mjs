import { spawnSync } from "node:child_process";
for (const args of [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_WEB_MODE: "true",
      VITE_BASE_PATH: process.env.VITE_BASE_PATH || "/408-cultivation/",
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
