import { type Page, type TestInfo, expect } from "@playwright/test";

export async function chapter(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.locator("main")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
  // A short stable frame makes hosted playback understandable without making CI slow.
  await page.waitForTimeout(450);
}

export async function expectHealthyPage(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await expect(page.getByText(/Something went wrong|couldn't load/i)).toHaveCount(0);
}
