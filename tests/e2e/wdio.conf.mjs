import path from "node:path";
import { fileURLToPath } from "node:url";

const configurationDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(configurationDirectory, "../..");
const appBinaryPath =
  process.env.SCOPE_E2E_APP ??
  path.join(
    repositoryRoot,
    "apps/desktop/src-tauri/target/e2e/release/scope-desktop-dev.exe",
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
      },
    },
  ],
  services: [
    [
      "tauri",
      {
        appBinaryPath,
        driverProvider: "embedded",
        embeddedPort: 4445,
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
  // Basic WebDriver commands remain available without exposing the test-only
  // Tauri execute API. The service's defensive window-focus checks may each
  // consume five seconds on CI, so the real multi-step project flow needs a
  // larger overall Mocha budget than the old single-screen smoke test.
  mochaOpts: { ui: "bdd", timeout: 180_000 },
  beforeTest: () => console.info("SCOPE_E2E_SPEC_STARTED"),
};
