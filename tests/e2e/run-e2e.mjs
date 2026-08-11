import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const configurationDirectory = path.dirname(fileURLToPath(import.meta.url));
const wdioCliPath = path.join(
  configurationDirectory,
  "node_modules/@wdio/cli/bin/wdio.js",
);

const result = spawnSync(
  process.execPath,
  [wdioCliPath, "run", "./wdio.conf.mjs"],
  {
    cwd: configurationDirectory,
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error("Unable to start WebdriverIO:", result.error);
}

process.exitCode = result.status ?? 1;
