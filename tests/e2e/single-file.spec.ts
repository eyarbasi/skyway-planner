import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const file = resolve("dist-single/index.html");
test.skip(!existsSync(file), "run `npm run build:single` first");

test("the single downloaded HTML file works offline (imagery aside)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:/, (r) => r.abort()); // no network at all
  await page.goto(pathToFileURL(file).href);
  await expect(page.locator(".verdict .vword")).toHaveText("PASS");
  await expect(page.locator("table.flights tbody tr")).toHaveCount(3);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  expect(errors).toEqual([]);
});
