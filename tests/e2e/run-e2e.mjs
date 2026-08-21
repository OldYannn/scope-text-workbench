import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const configurationDirectory = path.dirname(fileURLToPath(import.meta.url));
const wdioCliPath = path.join(
  configurationDirectory,
  "node_modules/@wdio/cli/bin/wdio.js",
);

const fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), "scope-e2e-"));
const fixtureFile = path.resolve(
  configurationDirectory,
  "../../engine/tests/fixtures/corpus/正常中文.txt",
);

let result;
try {
  result = spawnSync(
    process.execPath,
    [wdioCliPath, "run", "./wdio.conf.mjs"],
    {
      cwd: configurationDirectory,
      env: {
        ...process.env,
        SCOPE_E2E_PARENT: fixtureDirectory,
        SCOPE_E2E_FILES: fixtureFile,
      },
      stdio: "inherit",
    },
  );
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}

if (result.error) {
  console.error("Unable to start WebdriverIO:", result.error);
}

process.exitCode = result.status ?? 1;
