import { expect, test } from "@playwright/test";
import { chapter, expectHealthyPage } from "./support";

test("maintainer finds repository risk and reviews its coverage", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.getByText("Live demo")).toBeVisible();
  await expect(page.getByText("Overall coverage")).toBeVisible();
  await expect(page.getByText("Risk map")).toBeVisible();
  // Scoped to main: the sidebar has its own "Needs attention" link now.
  await expect(page.locator("main").getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText("Confidence coverage", { exact: true })).toBeVisible();
  await expect(page.getByText("Journeys", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Components", { exact: true }).first()).toBeVisible();
  await expect(page.locator('a[href="#/r/covallaby/server/commits"]')).toContainText(
    "Commit is missing journeys and components",
  );

  // The unified activity feed mixes all three signals: a pinned review item,
  // a failed journey run, and coverage rows — with green noise kept quiet.
  await expect(page.getByText("Recent activity", { exact: true })).toBeVisible();
  await expect(page.getByText("Component changes await review")).toBeVisible();
  await expect(page.getByText("1 of 32 journeys failed")).toBeVisible();
  await expect(page.getByText(/quiet update/).first()).toBeVisible();

  // Filter chips narrow the chronology to one signal and share via ?type=.
  await page.getByRole("button", { name: "Journeys", exact: true }).click();
  await expect(page).toHaveURL(/type=journeys/);
  await expect(page.getByText("1 of 32 journeys failed")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page).not.toHaveURL(/type=/);
  await chapter(page, testInfo, "01-portfolio-health");

  // The rail's "Needs attention" shortcut lands on Home with the review queue in view.
  await page.getByRole("link", { name: "Needs attention", exact: true }).click();
  await expect(page).toHaveURL(/#\/\?focus=review$/);
  await expect(page.locator("main").getByText("Needs attention", { exact: true })).toBeInViewport();

  await page.locator('a[href="#/r/covallaby/covallaby"]').first().click();
  await expect(page).toHaveURL(/#\/r\/covallaby\/covallaby$/);
  await expect(page.getByRole("heading", { name: "covallaby/covallaby" })).toBeVisible();
  const scopePicker = page.getByRole("button", { name: "Branch or pull request" });
  await expect(scopePicker).toContainText("main");
  await scopePicker.click();
  await expect(page.getByRole("listbox", { name: "Branch or pull request" })).toBeVisible();
  await expect(page.getByText("Open pull requests", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
  await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
  await expect(page.getByText(/One commit, three independent signals/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Journeys.*34 passed/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Components.*24 states/ })).toBeVisible();
  await chapter(page, testInfo, "02-repository-summary");

  const repoTabs = page.getByRole("navigation", { name: "Repository sections" });
  await expect(repoTabs.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await repoTabs.getByRole("link", { name: "Commits", exact: true }).click();
  await expect(page.getByText(/joined by commit SHA/)).toBeVisible();
  await expect(page.getByText("Missing code", { exact: true })).toHaveCount(2);
  await expect(repoTabs.getByRole("link", { name: "Commits", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await chapter(page, testInfo, "03-commit-evidence");

  await repoTabs.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(page.getByText(/coverage/i).first()).toBeVisible();
  await chapter(page, testInfo, "04-coverage-insights");
  await expectHealthyPage(page);
});

test("merge-gate verdict leads the commit and PR pages", async ({ page }, testInfo) => {
  // covallaby/covallaby's demo policy (floor 90%) fails its latest upload (82%).
  await page.goto("./#/r/covallaby/covallaby/u/10");
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByText("merge gate", { exact: true })).toBeVisible();
  await expect(page.getByText("Project coverage").first()).toBeVisible();
  await expect(page.getByText("Delta vs baseline")).toBeVisible();
  await expect(page.getByText(/is required/)).toBeVisible();
  await chapter(page, testInfo, "01-upload-verdict");

  await page.goto("./#/r/covallaby/covallaby/pr/50");
  await expect(page.getByText("merge gate", { exact: true })).toBeVisible();
  await chapter(page, testInfo, "02-pr-verdict");

  // A repo without a policy gets a friendly nudge to set one, never a shaming.
  await page.goto("./#/r/covallaby/server/u/18");
  await expect(page.getByText("No policy set", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Set a policy →" })).toBeVisible();
  await chapter(page, testInfo, "03-no-policy-nudge");
  await expectHealthyPage(page);
});

test("maintainer discovers browser runs and component previews", async ({ page }, testInfo) => {
  await page.goto("./#/r/covallaby/covallaby/playbacks");
  await expect(page.getByText("Playwright runs", { exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("34 passed")).toBeVisible();
  await expect(page.getByRole("table").getByText("PR #128 Playwright run")).toBeVisible();
  await chapter(page, testInfo, "01-playwright-runs");

  await page
    .getByRole("navigation", { name: "Repository sections" })
    .getByRole("link", { name: "Captures", exact: true })
    .click();
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

  // Approve the current stop from the keyboard loop and watch progress move.
  await expect(page.getByText("0 of 2 reviewed")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByText("1 of 2 reviewed")).toBeVisible();
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();
  // Re-pressing the same verdict key returns the stop to pending.
  await page.keyboard.press("a");
  await expect(page.getByText("0 of 2 reviewed")).toBeVisible();
  // Reject via the visible button instead of the keyboard.
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("1 of 2 reviewed")).toBeVisible();
  await expect(page.getByText("rejected", { exact: true }).first()).toBeVisible();
  await chapter(page, testInfo, "05-review-verdicts");

  // Lateral navigation: [ jumps to the previous run; the exhausted end renders disabled.
  await expect(page.getByRole("link", { name: "Previous run" })).toBeVisible();
  await page.keyboard.press("[");
  await expect(page).toHaveURL(/storybook-previews\/17$/);
  await expect(page.getByRole("link", { name: "Next run" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous run" })).toHaveCount(0);
  await chapter(page, testInfo, "06-lateral-run-navigation");
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
    const drawer = page.locator('aside[aria-label="Dashboard navigation"]');
    await expect(drawer).toBeVisible();
    // The slim rail: Recent repos instead of the old org→repo tree with sub-links.
    await expect(drawer.getByText("Recent", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Needs attention" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Component captures" })).toHaveCount(0);
    await chapter(page, testInfo, "02-mobile-navigation");
    // Repo sections live in the tab bar now: hop to the repo via Recent, then tab over.
    await drawer.getByRole("link", { name: "covallaby", exact: true }).click();
    await expect(page).toHaveURL(/#\/r\/covallaby\/covallaby$/);
    await page
      .getByRole("navigation", { name: "Repository sections" })
      .getByRole("link", { name: "Captures", exact: true })
      .click();
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
