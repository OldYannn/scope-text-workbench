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

describe("SCOPE Milestone 1A main flow", () => {
  it("creates a project, imports TXT, lists it, and opens its preview", async () => {
    const projectName = $("#project-name");
    await expect(projectName).toExist();
    await projectName.setValue("Windows 中文项目");
    const createButton = $("button=创建项目");
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await waitForProjectWorkspace();
    await expect($("[data-testid='scope-project']")).toExist();
    await $("[aria-label='导入 TXT']").click();
    await expect($("button*=中文语料.txt")).toBeDisplayed();
    await $("button*=中文语料.txt").click();
    await expect($(".text-preview")).toHaveText(
      "这是一份用于验证项目主流程的中文语料。",
    );
  });
});
