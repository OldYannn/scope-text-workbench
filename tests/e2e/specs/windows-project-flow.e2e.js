import { $, browser, expect } from "@wdio/globals";

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
    await $("button*=frequency-gui.txt").click();
    await expect($(".text-preview")).toHaveText(
      "基层治理需要政策支持。基层治理需要实践检验。",
    );

    // Keep the wiring smoke compact because each WebDriver command has a Tauri focus hook.
    await expect($("nav[aria-label='研究工作区']")).toExist();
    const readWorkspace = () =>
      browser.execute(() => ({
        cleaning: Boolean(document.querySelector("[aria-label='文本清洗']")),
        tokenize: Boolean(document.querySelector("[aria-label='中文分词']")),
        frequency: Boolean(document.querySelector("[aria-label='词频分析']")),
      }));

    await $("button=清洗").click();
    await browser.pause(300);
    let workspaceState = await readWorkspace();
    expect(workspaceState).toEqual({
      cleaning: true,
      tokenize: false,
      frequency: false,
    });
    await $("button=分词").click();
    await browser.pause(300);
    workspaceState = await readWorkspace();
    expect(workspaceState).toEqual({
      cleaning: false,
      tokenize: true,
      frequency: false,
    });
    await $("button=词频").click();
    await browser.pause(1_000);
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
      clickButton("执行清洗");
      await waitFor(() =>
        document.querySelector(".notice")?.textContent?.includes("清洗已保存"),
      );
      clickButton("分词");
      await waitFor(() =>
        Array.from(document.querySelectorAll("button")).some(
          (item) => item.textContent?.trim() === "重新运行分词",
        ),
      );
      clickButton("重新运行分词");
      await waitFor(() =>
        document
          .querySelector(".token-result")
          ?.textContent?.includes("基层治理"),
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
    const frequencyRow = await browser.execute(() => {
      const row = Array.from(
        document.querySelectorAll(".frequency-table tbody tr"),
      ).find((item) => item.textContent?.includes("基层治理"));
      return row?.textContent ?? null;
    });
    expect(frequencyRow).toContain("基层治理");
    expect(frequencyRow).toContain("2");
    expect(frequencyRow).toContain("1");

    await $("input[aria-label='手动增加停用词']").setValue("基层治理");
    await $("button=增加").click();
    await expect($(".frequency-status-idle")).toExist();
    await expect($(".frequency-status-idle")).toHaveText(
      expect.stringContaining("尚未执行词频分析"),
    );
    await $("button=分词").click();
    expect(await $(".token-result").getText()).toContain("基层治理");
    await $("button=词频").click();
    const filteredFrequencyState = await browser.execute(async () => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (item) => item.textContent?.trim() === "计算 TF / DF / RF10K",
      );
      if (!button)
        throw new Error("Missing filtered frequency calculate button");
      if (button.disabled)
        throw new Error("Filtered frequency calculate button is disabled");
      button.click();
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const status = document.querySelector(".frequency-status");
        if (status?.classList.contains("frequency-status-success")) {
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
        `Timed out waiting for filtered frequency success: ${status?.className ?? "missing"} ${status?.textContent ?? ""}`,
      );
    });
    expect(filteredFrequencyState.status).toBe("success");
    const filteredRow = await browser.execute(() =>
      Array.from(document.querySelectorAll(".frequency-table tbody tr")).some(
        (item) => item.textContent?.includes("基层治理"),
      ),
    );
    expect(filteredRow).toBe(false);
  });
});
