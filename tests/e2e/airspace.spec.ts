import { expect, test } from "@playwright/test";

const ring = [[-83.60, 42.20], [-83.45, 42.20], [-83.45, 42.30], [-83.60, 42.30], [-83.60, 42.20]];
const fixture = { features: [{ properties: { IDENT: "YIP", NAME: "TEST CLASS D", CLASS: "D", UPPER_VAL: 3000 }, geometry: { type: "Polygon", coordinates: [ring] } }] };

test("airspace outlines are drawn with their class and can be switched off; a failed load says so", async ({ page }) => {
  await page.route("**/Class_Airspace/**", (r) => r.fulfill({ json: fixture, headers: { "access-control-allow-origin": "*" } }));
  await page.goto("/");
  await page.waitForSelector(".verdict");
  await expect(page.locator(".airspace-label")).toHaveText(/YIP · Class Ds*to 3,000 ft/);
  await page.locator("summary", { hasText: /^Map$/ }).click();
  await page.getByLabel("Airport airspace (FAA outlines, display only)").uncheck();
  await expect(page.locator(".airspace-label")).toHaveCount(0);
});

test("when the FAA service is unreachable the pilot is told", async ({ page }) => {
  await page.route("**/Class_Airspace/**", (r) => r.abort());
  await page.goto("/");
  await expect(page.locator(".toast")).toContainText("Could not load the FAA airspace outlines");
});

// Talks to the real FAA service. Run with LIVE=1 npx playwright test airspace
test("live: ARB, YIP, DET are Class D and DTW is Class B", async ({ page }) => {
  test.skip(!process.env.LIVE, "needs internet");
  await page.goto("/");
  await expect(page.locator(".airspace-label")).toHaveCount(4, { timeout: 30_000 });
  const t = (await page.locator(".airspace-label").allInnerTexts()).join(" | ");
  for (const s of ["ARB · Class D", "YIP · Class D", "DET · Class D", "DTW · Class B"]) expect(t).toContain(s);
});
