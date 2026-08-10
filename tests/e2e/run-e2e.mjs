import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const configurationDirectory = path.dirname(fileURLToPath(import.meta.url));
const webviewUserDataFolder = path.join(
  os.tmpdir(),
  `scope-wdio-webview2-${process.pid}`,
);
const wdioCliPath = path.join(
  configurationDirectory,
  "node_modules/@wdio/cli/bin/wdio.js",
);

let exitCode = 1;

try {
  const result = spawnSync(
    process.execPath,
    [wdioCliPath, "run", "./wdio.conf.mjs"],
    {
      cwd: configurationDirectory,
      env: {
        ...process.env,
        SCOPE_E2E_WEBVIEW_DATA_FOLDER: webviewUserDataFolder,
      },
      stdio: "inherit",
    },
  );

  if (result.error) {
    console.error("Unable to start WebdriverIO:", result.error);
  } else {
    exitCode = result.status ?? 1;
  }
} finally {
  try {
    fs.rmSync(webviewUserDataFolder, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (error) {
    console.warn(
      `Unable to remove temporary WebView2 data at ${webviewUserDataFolder}:`,
      error,
    );
  }
}

process.exitCode = exitCode;
