import { $, browser, expect } from "@wdio/globals";
import { existsSync } from "node:fs";
import path from "node:path";

async function waitForProjectWorkspace() {
  await browser.waitUntil(
    async () => {
      const workspace = $("[data-testid='scope-project']");
      if (await workspace.isExisting()) return true;

      const notice = $(".notice");
      if (await notice.isExisting()) {
        const message = await notice.getText();
        if (message.startsWith("无法创建项目")) {
          throw new Error(`SCOPE project creation failed: ${message}`);
        }
      }
      return false;
    },
    { timeout: 60_000, interval: 1_000 },
  );
}

async function waitForImportedDocument() {
  await browser.waitUntil(
    async () => {
      const document = $("button*=frequency-gui.txt");
      if (await document.isExisting()) return true;

      const notice = $(".notice");
      if (await notice.isExisting()) {
        const message = await notice.getText();
        if (message.startsWith("无法导入语料") || message.includes("个失败")) {
          throw new Error(`SCOPE TXT import failed: ${message}`);
        }
      }
      return false;
    },
    { timeout: 60_000, interval: 1_000 },
  );
}

describe("SCOPE Milestone 1A main flow", () => {
  it("creates a project, imports TXT, lists it, and opens its preview", async () => {
    const projectName = $("#project-name");
    await expect(projectName).toExist();
    await projectName.setValue("Windows 中文项目");
    const createButton = $("button=创建项目");
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await waitForProjectWorkspace();
    await $("[aria-label='导入 TXT']").click();
    await waitForImportedDocument();
    await browser.waitUntil(
      async () => $("button*=batch-frequency-2.txt").isExisting(),
      { timeout: 60_000, interval: 1_000 },
    );
    const longFilenames = [
      "中国证券监督管理委员会关于准予中欧养老产业混合型证券投资基金注册的批复-without-any-spaces.txt",
      "AnExtremelyLongEnglishFilenameWithoutAnySpacesThatMustNeverOverflowThePreviewPanel.txt",
    ];
    for (const longFilename of longFilenames) {
      await $("button*=" + longFilename).click();
      const longFilenameLayout = await browser.execute(() => {
        const filename = document.querySelector(
          "[data-testid='preview-filename']",
        );
        const panel = document.querySelector(".preview-panel");
        if (!filename || !panel)
          throw new Error("Missing preview filename layout");
        return {
          title: filename.getAttribute("title"),
          truncated: filename.scrollWidth > filename.clientWidth,
          panelDoesNotOverflow: panel.scrollWidth <= panel.clientWidth,
        };
      });
      expect(longFilenameLayout).toEqual({
        title: longFilename,
        truncated: true,
        panelDoesNotOverflow: true,
      });
    }
    await $("button*=frequency-gui.txt").click();
    await expect($(".text-preview")).toHaveText(
      "基层治理需要政策支持。基层治理需要实践检验。",
    );

    // Keep the wiring smoke compact because each WebDriver command has a Tauri focus hook.
    await expect($("nav[aria-label='研究工作区']")).toExist();
    await expect($("nav[aria-label='处理流程状态']")).toExist();
    for (const stage of ["text", "cleaning", "tokenize", "frequency"]) {
      await expect(
        $("[data-testid='pipeline-stage-" + stage + "']"),
      ).toBeDisplayed();
    }
    const readWorkspace = () =>
      browser.execute(() => ({
        cleaning: Boolean(document.querySelector("[aria-label='文本清洗']")),
        tokenize: Boolean(document.querySelector("[aria-label='中文分词']")),
        frequency: Boolean(document.querySelector("[aria-label='词频分析']")),
      }));

    await $("[data-testid='pipeline-stage-cleaning']").click();
    await browser.waitUntil(async () => (await readWorkspace()).cleaning, {
      timeout: 15_000,
      interval: 100,
    });
    let workspaceState = await readWorkspace();
    expect(workspaceState).toEqual({
      cleaning: true,
      tokenize: false,
      frequency: false,
    });
    await $("[data-testid='pipeline-stage-tokenize']").click();
    await browser.waitUntil(async () => (await readWorkspace()).tokenize, {
      timeout: 15_000,
      interval: 100,
    });
    workspaceState = await readWorkspace();
    expect(workspaceState).toEqual({
      cleaning: false,
      tokenize: true,
      frequency: false,
    });
    await $("[data-testid='pipeline-stage-frequency']").click();
    await browser.waitUntil(async () => (await readWorkspace()).frequency, {
      timeout: 15_000,
      interval: 100,
    });
    workspaceState = await browser.execute(() => ({
      cleaning: Boolean(document.querySelector("[aria-label='文本清洗']")),
      tokenize: Boolean(document.querySelector("[aria-label='中文分词']")),
      frequency: Boolean(document.querySelector("[aria-label='词频分析']")),
      profileOptions: document.querySelectorAll(
        ".stopword-controls select option",
      ).length,
      scopeDefault: document.querySelector(".stopword-controls select")?.value,
      exportCsv: Boolean(
        Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "导出 CSV",
        ),
      ),
      exportXlsx: Boolean(
        Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "导出 XLSX",
        ),
      ),
    }));
    expect(workspaceState).toEqual({
      cleaning: false,
      tokenize: false,
      frequency: true,
      profileOptions: expect.any(Number),
      scopeDefault: "scope-cn-general-v1",
      exportCsv: true,
      exportXlsx: true,
    });
    expect(workspaceState.profileOptions).toBeGreaterThanOrEqual(7);

    await browser.execute(async () => {
      const clickButton = (label) => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (item) => item.textContent?.trim() === label,
        );
        if (!button) throw new Error(`Missing button: ${label}`);
        button.click();
      };
      const waitFor = async (predicate) => {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          if (predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("Timed out waiting for workflow state");
      };
      clickButton("清洗");
      await waitFor(() =>
        Array.from(document.querySelectorAll("button")).some(
          (item) => item.textContent?.trim() === "执行清洗",
        ),
      );
      clickButton("批量清洗");
      await waitFor(() =>
        document
          .querySelector(".notice")
          ?.textContent?.includes("批量清洗已完成"),
      );
      clickButton("分词");
      await waitFor(() =>
        Array.from(document.querySelectorAll("button")).some(
          (item) => item.textContent?.trim() === "重新运行分词",
        ),
      );
      clickButton("批量分词");
      await waitFor(() =>
        document
          .querySelector(".notice")
          ?.textContent?.includes("批量分词已完成"),
      );
      clickButton("词频");
    });

    const frequencyState = await browser.execute(async () => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === "计算 TF / DF / RF10K",
      );
      if (!button) throw new Error("Missing frequency calculate button");
      if (button.disabled)
        throw new Error("Frequency calculate button is disabled");
      button.click();
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const status = document.querySelector(".frequency-status");
        if (status?.classList.contains("frequency-status-success")) {
          return { status: "success", text: status.textContent ?? "" };
        }
        if (status?.classList.contains("frequency-status-error")) {
          throw new Error(
            `Frequency analysis failed: ${status.textContent ?? ""}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const status = document.querySelector(".frequency-status");
      throw new Error(
        `Timed out waiting for frequency success: ${status?.className ?? "missing"} ${status?.textContent ?? ""}`,
      );
    });
    expect(frequencyState.status).toBe("success");
    await expect($(".frequency-table")).toExist();
    const frequencyTableLayout = await browser.execute(() => {
      const headers = Array.from(
        document.querySelectorAll(".frequency-table th"),
      );
      const container = document.querySelector(".frequency-table-wrap");
      if (!container) throw new Error("Missing frequency table container");
      return {
        headers: headers.map((header) => header.textContent?.trim()),
        allHeadersNoWrap: headers.every(
          (header) => getComputedStyle(header).whiteSpace === "nowrap",
        ),
        localScrollContainer: getComputedStyle(container).overflowX === "auto",
        exposedLexicalSort: Array.from(
          document.querySelectorAll(".frequency-toolbar option"),
        ).some((option) => option.textContent?.trim() === "词语"),
      };
    });
    expect(frequencyTableLayout).toEqual({
      headers: [
        "词语",
        "词频（TF）",
        "文档频率（DF）",
        "文档覆盖率",
        "标准化词频（每万词，RF10K）",
        "操作",
      ],
      allHeadersNoWrap: true,
      localScrollContainer: true,
      exposedLexicalSort: false,
    });
    const defaultViewportLayout = await browser.execute(() => {
      const shell = document.querySelector(".app-shell");
      const table = document.querySelector(".frequency-table");
      const container = document.querySelector(".frequency-table-wrap");
      if (!shell || !table || !container)
        throw new Error("Missing default viewport layout");
      return {
        appDoesNotOverflow:
          document.documentElement.scrollWidth <= window.innerWidth,
        tableFitsAtDefaultWidth: table.scrollWidth <= container.clientWidth,
      };
    });
    expect(defaultViewportLayout).toEqual({
      appDoesNotOverflow: true,
      tableFitsAtDefaultWidth: true,
    });
    await browser.setWindowSize(980, 720);
    await browser.waitUntil(
      async () => (await browser.execute(() => window.innerWidth)) <= 980,
      { timeout: 15_000, interval: 100 },
    );
    const minimumViewportLayout = await browser.execute(() => {
      const shell = document.querySelector(".app-shell");
      const sidebar = document.querySelector(".document-panel");
      const workspace = document.querySelector(".preview-panel");
      const table = document.querySelector(".frequency-table");
      const container = document.querySelector(".frequency-table-wrap");
      if (!shell || !sidebar || !workspace || !table || !container)
        throw new Error("Missing minimum viewport layout");
      const sidebarBounds = sidebar.getBoundingClientRect();
      const workspaceBounds = workspace.getBoundingClientRect();
      return {
        appDoesNotOverflow:
          document.documentElement.scrollWidth <= window.innerWidth,
        tableUsesLocalScroll: table.scrollWidth > container.clientWidth,
        sidebarDoesNotCoverWorkspace:
          sidebarBounds.right <= workspaceBounds.left,
      };
    });
    expect(minimumViewportLayout).toEqual({
      appDoesNotOverflow: true,
      tableUsesLocalScroll: true,
      sidebarDoesNotCoverWorkspace: true,
    });
    const frequencyRow = await browser.execute(() => {
      const row = Array.from(
        document.querySelectorAll(".frequency-table tbody tr"),
      ).find((item) => item.textContent?.includes("需要"));
      return row
        ? Array.from(row.cells).map((cell) => cell.textContent?.trim())
        : null;
    });
    expect(frequencyRow?.[0]).toBe("需要");
    expect(frequencyRow?.[1]).toBe("3");
    expect(frequencyRow?.[2]).toBe("2");

    const metricsHelpTrigger = $("[data-testid='metrics-help-trigger']");
    const metricsHelpPopover = $("[data-testid='metrics-help-popover']");
    await metricsHelpTrigger.click();
    await expect(metricsHelpPopover).toBeDisplayed();
    await expect(metricsHelpPopover).toHaveAttribute("data-state", "open");
    await expect(metricsHelpPopover).toHaveText(
      expect.stringContaining("RF10K(w) = TF(w)"),
    );
    await browser.keys("Escape");
    await expect(metricsHelpPopover).not.toExist();
    expect(await metricsHelpTrigger.isFocused()).toBe(true);

    const optimizationTrigger = $(
      "[data-testid='optimization-drawer-trigger']",
    );
    const optimizationDrawer = $("[data-testid='optimization-drawer']");
    await optimizationTrigger.click();
    await expect(optimizationTrigger).toHaveAttribute("data-state", "open");
    await expect(optimizationDrawer).toBeDisplayed();
    await expect(optimizationDrawer).toHaveText(
      expect.stringContaining("候选停用词检查"),
    );
    await expect(optimizationDrawer).toHaveText(
      expect.stringContaining("文档覆盖率 ≥ 80%"),
    );
    await expect($(".frequency-table")).toExist();
    await browser.keys("Escape");
    await expect(optimizationTrigger).toHaveAttribute("data-state", "closed");
    await expect(optimizationDrawer).not.toExist();
    expect(await optimizationTrigger.isFocused()).toBe(true);

    const resolvedStopwordsTrigger = $(
      "[data-testid='resolved-stopwords-trigger']",
    );
    const resolvedStopwordsDrawer = $(
      "[data-testid='resolved-stopwords-drawer']",
    );
    const resolvedStopwordsClose = $(
      "[data-testid='resolved-stopwords-drawer-close']",
    );
    await resolvedStopwordsTrigger.click();
    await expect(resolvedStopwordsTrigger).toHaveAttribute(
      "data-state",
      "open",
    );
    await expect(resolvedStopwordsDrawer).toBeDisplayed();
    await expect(resolvedStopwordsDrawer).toHaveText(
      expect.stringContaining("当前停用词集合"),
    );
    await expect($(".frequency-table")).toExist();
    await $("[data-testid='resolved-stopword-word-的']").click();
    await expect($(".stale-result-banner")).not.toExist();
    await resolvedStopwordsClose.click();
    await expect(resolvedStopwordsTrigger).toHaveAttribute(
      "data-state",
      "closed",
    );
    await expect(resolvedStopwordsDrawer).not.toExist();
    expect(await resolvedStopwordsTrigger.isFocused()).toBe(true);

    await $("input[aria-label='手动增加停用词']").setValue("需要");
    await $("button=增加").click();
    await expect($(".stale-result-banner")).toHaveText(
      expect.stringContaining("待应用修改：1 项"),
    );
    await expect($("[data-testid='pipeline-stage-frequency']")).toHaveText(
      expect.stringContaining("需重新计算"),
    );
    await expect($(".frequency-table")).toExist();
    await $("button=分词").click();
    expect(await $(".token-result").getText()).toContain("需要");
    await $("button=词频").click();
    const filteredFrequencyState = await browser.execute(async () => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === "应用修改并重新计算",
      );
      if (!button)
        throw new Error("Missing filtered frequency calculate button");
      if (button.disabled)
        throw new Error("Filtered frequency calculate button is disabled");
      button.click();
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const status = document.querySelector(".frequency-status");
        const hasPendingChanges = Boolean(
          document.querySelector(".stale-result-banner"),
        );
        if (
          !hasPendingChanges &&
          status?.classList.contains("frequency-status-success")
        ) {
          return { status: "success", text: status.textContent ?? "" };
        }
        if (status?.classList.contains("frequency-status-error")) {
          throw new Error(
            `Filtered frequency analysis failed: ${status.textContent ?? ""}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const status = document.querySelector(".frequency-status");
      throw new Error(
        `Timed out waiting for filtered frequency success: pending=${Boolean(document.querySelector(".stale-result-banner"))} ${status?.className ?? "missing"} ${status?.textContent ?? ""}`,
      );
    });
    expect(filteredFrequencyState.status).toBe("success");
    const filteredRow = await browser.execute(() =>
      Array.from(document.querySelectorAll(".frequency-table tbody tr")).some(
        (item) => item.textContent?.includes("需要"),
      ),
    );
    expect(filteredRow).toBe(false);

    await $("button=导出 CSV").click();
    await browser.waitUntil(
      async () =>
        existsSync(path.join(process.env.SCOPE_E2E_EXPORT_DIR, "词频结果.csv")),
      { timeout: 30_000, interval: 500 },
    );
    await $("button=导出 XLSX").click();
    await browser.waitUntil(
      async () =>
        existsSync(
          path.join(process.env.SCOPE_E2E_EXPORT_DIR, "词频结果.xlsx"),
        ),
      { timeout: 30_000, interval: 500 },
    );
  });
});
