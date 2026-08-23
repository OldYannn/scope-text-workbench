import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  "../../engine/tests/fixtures/corpus/frequency-gui.txt",
);
const secondFixtureFile = path.resolve(
  configurationDirectory,
  "../../engine/tests/fixtures/corpus/batch-frequency-2.txt",
);
const exportDirectory = path.join(fixtureDirectory, "中文导出");
mkdirSync(exportDirectory);
const exportedXlsx = path.join(exportDirectory, "词频结果.xlsx");

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
        SCOPE_E2E_FILES: [fixtureFile, secondFixtureFile].join(path.delimiter),
        SCOPE_E2E_EXPORT_DIR: exportDirectory,
      },
      stdio: "inherit",
    },
  );
  if (result.status === 0) {
    const validation = spawnSync(
      process.platform === "win32" ? "python" : "python3",
      [
        "-c",
        [
          "import sys",
          "from openpyxl import load_workbook",
          "workbook = load_workbook(sys.argv[1], read_only=True, data_only=True)",
          "assert workbook.sheetnames == ['词频结果', '分析说明']",
          "assert next(workbook['词频结果'].values) == ('词语', '词频（TF）', '文档频率（DF）', '文档覆盖率', '标准化词频（每万词，RF10K）')",
          "rows = list(workbook['词频结果'].values)",
          "assert len(rows) > 1",
        ].join("; "),
        exportedXlsx,
      ],
      { stdio: "inherit" },
    );
    if (validation.status !== 0 || validation.error) {
      result = validation;
    }
  }
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}

if (result.error) {
  console.error("Unable to start WebdriverIO:", result.error);
}

process.exitCode = result.status ?? 1;
