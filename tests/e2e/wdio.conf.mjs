import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configurationDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(configurationDirectory, "../..");
const appBinaryPath =
  process.env.SCOPE_E2E_APP ??
  path.join(
    repositoryRoot,
    "apps/desktop/src-tauri/target/release/scope-desktop-dev.exe",
  );
const webviewUserDataFolder = path.join(
  os.tmpdir(),
  `scope-wdio-webview2-${process.pid}`,
);

function cleanupWebviewUserDataFolder() {
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

export const config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinaryPath,
        webviewOptions: { userDataFolder: webviewUserDataFolder },
      },
    },
  ],
  services: [
    [
      "tauri",
      {
        appBinaryPath,
        driverProvider: "external",
        autoInstallTauriDriver: false,
        autoDownloadEdgeDriver: true,
        startTimeout: 60_000,
        logLevel: "info",
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  waitforTimeout: 15_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  mochaOpts: { ui: "bdd", timeout: 30_000 },
  onWorkerEnd: cleanupWebviewUserDataFolder,
};
