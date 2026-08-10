import { $, browser, expect } from "@wdio/globals";

describe("Windows diagnostic smoke", () => {
  it("starts, cancels, reruns, and shows a reproducibility manifest", async () => {
    await expect($("[data-testid='scope-hero']")).toBeDisplayed();

    const runButton = $("[data-testid='diagnostic-run']");
    const cancelButton = $("[data-testid='diagnostic-cancel']");
    const progress = $("[data-testid='diagnostic-progress']");
    const status = $("[data-testid='diagnostic-status']");
    const manifest = $("[data-testid='diagnostic-manifest']");

    await runButton.click();
    await browser.waitUntil(
      async () => (await progress.getAttribute("aria-label")) !== "诊断进度 0%",
      { timeout: 10_000, timeoutMsg: "diagnostic progress did not start" },
    );

    await cancelButton.click();
    await expect(status).toHaveText("诊断已安全取消");
    await expect(runButton).toBeEnabled();

    await runButton.click();
    await expect(status).toHaveText("诊断完成，已生成可复现清单");
    await expect(progress).toHaveAttribute("aria-label", "诊断进度 100%");
    await expect(manifest).toHaveText(
      expect.stringContaining('"network_used": false'),
    );
    await expect(manifest).toHaveText(expect.stringContaining('"steps": 5'));
  });
});
