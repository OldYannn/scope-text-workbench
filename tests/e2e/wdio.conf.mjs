import path from "node:path";
import os from "node:os";
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
};
