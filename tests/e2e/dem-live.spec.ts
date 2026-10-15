import { expect, test } from "@playwright/test";

// Talks to the real USGS 3DEP service. Run with LIVE=1 npx playwright test dem-live
test.skip(!process.env.LIVE, "needs internet");

test("ground elevation loads from USGS and the plan is checked against it", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".verdict");
  await page.getByLabel("Check the true height above ground (USGS elevation)").check();
  await expect(page.getByText(/Checked against USGS ground height at \d+ points/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#panel > .notes")).not.toContainText("No ground-elevation");
  await expect(page.locator(".verdict .vword")).toHaveText(/PASS|FAIL/);
});
