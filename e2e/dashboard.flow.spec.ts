import { expect, test } from "@playwright/test";
import { chapter, expectHealthyPage } from "./support";

test("maintainer finds repository risk and reviews its coverage", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.getByText("Live demo")).toBeVisible();
  await expect(page.getByText("Overall coverage")).toBeVisible();
  await expect(page.getByText("Risk map")).toBeVisible();
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText("Confidence coverage", { exact: true })).toBeVisible();
  await expect(page.getByText("Journey execution", { exact: true })).toBeVisible();
  await expect(page.getByText("Component coverage", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="#/r/covallaby/server/commits"]')).toContainText(
    "Commit is missing journeys and components",
  );
  await chapter(page, testInfo, "01-portfolio-health");

  await page.locator('a[href="#/r/covallaby/covallaby"]').first().click();
  await expect(page).toHaveURL(/#\/r\/covallaby\/covallaby$/);
  await expect(page.getByRole("heading", { name: "covallaby/covallaby" })).toBeVisible();
  await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/One commit, with code, journey, and component evidence/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Journeys 34 passed/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Components 24 states/ })).toBeVisible();
  await chapter(page, testInfo, "02-repository-summary");

  await page.getByRole("link", { name: "Commits", exact: true }).click();
  await expect(page.getByText(/joined by commit SHA/)).toBeVisible();
  await expect(page.getByText("Missing code", { exact: true })).toHaveCount(2);
  await chapter(page, testInfo, "03-commit-evidence");

  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(page.getByText(/coverage/i).first()).toBeVisible();
  await chapter(page, testInfo, "04-coverage-insights");
  await expectHealthyPage(page);
});

test("maintainer discovers browser runs and component previews", async ({ page }, testInfo) => {
  await page.goto("./#/r/covallaby/covallaby/playbacks");
  await expect(page.getByText("Playwright runs", { exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("34 passed")).toBeVisible();
  await expect(page.getByRole("table").getByText("PR #128 Playwright run")).toBeVisible();
  await chapter(page, testInfo, "01-playwright-runs");

  await page.getByRole("link", { name: "Component captures", exact: true }).click();
  await expect(page.getByText("Component captures", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("table").getByText("PR #128 preview")).toBeVisible();
  await chapter(page, testInfo, "02-storybook-previews");
  await page.getByRole("table").getByText("PR #128 preview").click();
  await expect(page.getByPlaceholder("Search 2 component captures")).toBeVisible();
  await expect(page.getByRole("heading", { name: "With component captures" })).toBeVisible();
  await expect(page.getByText(/2 reviewable changes against main/)).toBeVisible();
  await chapter(page, testInfo, "03-component-capture-gallery");
  await page.getByRole("button", { name: "diff", exact: true }).click();
  await expect(page.getByAltText("Pixel diff for With component captures")).toBeVisible();
  await chapter(page, testInfo, "04-component-pixel-diff");
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
    await page.getByRole("link", { name: "Component captures", exact: true }).click();
    await expect(page.getByText("Component captures", { exact: true }).first()).toBeVisible();
    await expectHealthyPage(page);
  });

  test("dashboard routes contain wide content instead of overflowing the phone viewport", async ({
    page,
  }) => {
    const routes = [
      "./",
      "./#/r/covallaby/covallaby",
      "./#/r/covallaby/covallaby/commits",
      "./#/r/covallaby/covallaby/uploads",
      "./#/r/covallaby/covallaby/pulls",
      "./#/r/covallaby/covallaby/playbacks",
      "./#/r/covallaby/covallaby/storybook-previews",
      "./#/r/covallaby/covallaby/u/10",
    ];

    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByText("Live demo")).toBeVisible();
      const audit = await page.evaluate(() => {
        const viewportOverflow = document.documentElement.scrollWidth - window.innerWidth;
        const brokenScrollRegions = [...document.querySelectorAll("[data-mobile-scroll-region]")]
          .filter((element) => element.scrollWidth > element.clientWidth)
          .filter((element) => {
            const overflow = getComputedStyle(element).overflowX;
            return overflow !== "auto" && overflow !== "scroll";
          }).length;
        return { viewportOverflow, brokenScrollRegions };
      });
      expect(audit, route).toEqual({ viewportOverflow: 0, brokenScrollRegions: 0 });
    }
  });
});
