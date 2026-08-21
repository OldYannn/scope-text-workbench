import { $, expect } from "@wdio/globals";

describe("SCOPE Milestone 1A main flow", () => {
  it("creates a project, imports TXT, lists it, and opens its preview", async () => {
    const projectName = $("#project-name");
    await expect(projectName).toBeDisplayed();
    await projectName.setValue("Windows 中文项目");
    const createButton = $("button=创建项目");
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect($("[data-testid='scope-project']")).toBeDisplayed();
    await $("[aria-label='导入 TXT']").click();
    await expect($("button*=中文语料.txt")).toBeDisplayed();
    await $("button*=中文语料.txt").click();
    await expect($(".text-preview")).toHaveText(
      "这是一份用于验证项目主流程的中文语料。",
    );
  });
});
