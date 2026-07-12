import { expect, test } from "@playwright/test";
import { chapter, expectHealthyPage } from "./support";

test("maintainer finds repository risk and reviews its coverage", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.getByText("Live demo")).toBeVisible();
  await expect(page.getByText("Overall coverage")).toBeVisible();
  await expect(page.getByText("Risk map")).toBeVisible();
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText("24 component captures are ready to review")).toBeVisible();
  await chapter(page, testInfo, "01-portfolio-health");

  await page.locator('a[href="#/r/covallaby/covallaby"]').first().click();
  await expect(page).toHaveURL(/#\/r\/covallaby\/covallaby$/);
  await expect(page.getByRole("heading", { name: "covallaby/covallaby" })).toBeVisible();
  await expect(page.getByText("Latest checks", { exact: true })).toBeVisible();
  await expect(page.getByText("Component captures", { exact: true })).toBeVisible();
  await chapter(page, testInfo, "02-repository-summary");

  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(page.getByText(/coverage/i).first()).toBeVisible();
  await chapter(page, testInfo, "03-coverage-insights");
  await expectHealthyPage(page);
});

test("maintainer discovers browser runs and component previews", async ({ page }, testInfo) => {
  await page.goto("./#/r/covallaby/covallaby/playbacks");
  await expect(page.getByText("Playwright runs", { exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("34 passed")).toBeVisible();
  await expect(page.getByRole("table").getByText("PR #128 Playwright run")).toBeVisible();
  await chapter(page, testInfo, "01-playwright-runs");

  await page.getByRole("link", { name: "Storybook previews", exact: true }).click();
  await expect(page.getByText("Storybook previews", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("table").getByText("PR #128 preview")).toBeVisible();
  await chapter(page, testInfo, "02-storybook-previews");
  await expectHealthyPage(page);
});

test.describe("mobile product playback", () => {
  test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } });

  test("navigation and browser-run cards remain usable", async ({ page }, testInfo) => {
    await page.goto("./#/r/covallaby/covallaby/playbacks");
    await expect(page.getByText("Playwright runs", { exact: true })).toBeVisible();
    await expect(page.locator(".md\\:hidden").getByText("34 passed")).toBeVisible();
    await chapter(page, testInfo, "01-mobile-playwright-runs");

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator('aside[aria-label="Dashboard navigation"]')).toBeVisible();
    await chapter(page, testInfo, "02-mobile-navigation");
    await page.getByRole("link", { name: "Storybook previews", exact: true }).click();
    await expect(page.getByText("Storybook previews", { exact: true }).first()).toBeVisible();
    await expectHealthyPage(page);
  });
});
