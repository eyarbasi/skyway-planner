import { test, type Page } from "@playwright/test";

// Run with SHOTS=1 npx playwright test screenshots  (uses the real imagery servers, so it needs internet)
test.skip(!process.env.SHOTS, "screenshots are made on request");
test.setTimeout(180_000);

async function twoPilots(page: Page) {
  await page.getByRole("spinbutton", { name: "Start (km along the line)" }).fill("4");
  await page.getByRole("button", { name: "Add by clicking the map" }).first().click();
  for (const f of [0.25, 0.75]) {
    const p = await page.evaluate((frac) => {
      type LL = [number, number];
      const w = window as unknown as { __skyway: { store: { state: { result: { centreline: LL[] } } }; view: { map: { distance(a: LL, b: LL): number; latLngToContainerPoint(p: LL): { x: number; y: number }; getContainer(): HTMLElement } } } };
      const { map } = w.__skyway.view;
      const pts = w.__skyway.store.state.result.centreline.map((q): LL => [q[1], q[0]]);
      const seg = pts.slice(1).map((q, i) => map.distance(pts[i], q));
      let want = seg.reduce((a, b) => a + b, 0) * frac, i = 0;
      while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
      const t = seg[i] ? want / seg[i] : 0;
      const c = map.latLngToContainerPoint([pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]);
      const r = map.getContainer().getBoundingClientRect();
      return { x: r.left + c.x, y: r.top + c.y };
    }, f);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press("Escape");
}

test("screenshots", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".verdict");
  await twoPilots(page);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "docs/screenshots/corridor.png" });

  await page.locator("table.flights tbody tr").nth(1).click();
  await page.locator(".detail").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/flight-detail.png" });

  await page.getByRole("button", { name: "Light/Dark" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshots/theme-toggle.png" });

  // sharp NAIP aerial photos, zoomed in
  await page.getByText("Map", { exact: true }).first().click();
  await page.getByLabel(/USGS sharp aerial/).check();
  await page.evaluate(() => (window as any).__skyway.view.map.setZoom(17));
  await page.waitForTimeout(45_000);
  await page.screenshot({ path: "docs/screenshots/naip-zoom17.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForSelector(".verdict");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "docs/screenshots/phone.png" });
});
