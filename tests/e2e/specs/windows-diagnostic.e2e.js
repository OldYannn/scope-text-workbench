import { $, expect } from "@wdio/globals";

describe("SCOPE embedded WebDriver smoke", () => {
  it("starts the real app and displays the diagnostic entry point", async () => {
    await expect($("[data-testid='scope-hero']")).toBeDisplayed();
    await expect($("[data-testid='diagnostic-run']")).toBeDisplayed();
  });
});
