import { expect, test, type Page } from "@playwright/test";

/** Map imagery is not what is under test, and tests must not depend on third-party servers. */
async function stubTiles(page: Page) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.route(/basemap\.nationalmap\.gov|imagery\.nationalmap\.gov|tiles\.maps\.eox\.at|arcgisonline\.com|tile\.openstreetmap\.org|tile\.googleapis\.com/, (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: png }));
}

/** Screen position (page coordinates) of the point a fraction `f` of the way (by distance) along the planned centreline. */
async function pointAlongPlan(page: Page, f: number) {
  return page.evaluate((frac) => {
    type LL = [number, number];
    const w = window as unknown as { __skyway: { store: { state: { result: { centreline: LL[] } } }; view: { map: { distance(a: LL, b: LL): number; latLngToContainerPoint(p: LL): { x: number; y: number }; getContainer(): HTMLElement } } } };
    const { map } = w.__skyway.view;
    const pts = w.__skyway.store.state.result.centreline.map((p): LL => [p[1], p[0]]);
    const seg = pts.slice(1).map((p, i) => map.distance(pts[i], p));
    const total = seg.reduce((a, b) => a + b, 0);
    let want = total * frac, i = 0;
    while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
    const t = seg[i] ? want / seg[i] : 0;
    const q: LL = [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])];
    const c = map.latLngToContainerPoint(q);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + c.x, y: r.top + c.y };
  }, f);
}

test.beforeEach(async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  await expect(page.locator(".verdict")).toBeVisible();
});

test("loads with the Skyway, an assumed-zone warning, and a PASS for the default stretch", async ({ page }) => {
  await expect(page.locator(".verdict .vword")).toHaveText("PASS");
  await expect(page.locator("#panel > .notes")).toContainText("Assumed fly zone");
  await expect(page.locator("#panel > .notes")).toContainText("placeholders");
  await expect(page.locator("table.flights tbody tr")).toHaveCount(3);
});

test("pick a stretch, add 2 pilot spots, get PASS and the expected flight count, download KML", async ({ page }) => {
  await page.getByRole("spinbutton", { name: "Start (km along the line)" }).fill("4");
  await page.getByRole("spinbutton", { name: /^Length/ }).fill("1500");
  await expect(page.locator(".verdict .vsum")).toContainText("km 4.00");

  await page.getByRole("button", { name: "Add by clicking the map" }).first().click();
  for (const f of [0.25, 0.75]) {
    const p = await pointAlongPlan(page, f);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press("Escape");

  await expect(page.locator(".pilot-badge")).toHaveCount(2);
  await expect(page.locator(".verdict .vword")).toHaveText("PASS");
  // two pilots flying ~745 m each: five layers plus the climb-and-descend pass is just under 22 min each
  const rows = page.locator("table.flights tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("table.flights td.bad")).toHaveCount(0);

  const flightCount = await rows.count();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download: Google Earth/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.kml$/);
  const text = await (await import("node:fs/promises")).readFile((await dl.path())!, "utf8");
  const parsed = await page.evaluate((t) => {
    const doc = new DOMParser().parseFromString(t, "application/xml");
    return { error: doc.getElementsByTagName("parsererror").length, lines: doc.getElementsByTagName("LineString").length, polys: doc.getElementsByTagName("Polygon").length };
  }, text);
  expect(parsed.error).toBe(0);
  expect(parsed.lines).toBe(flightCount);
  expect(parsed.polys).toBeGreaterThanOrEqual(1);
  expect(text).toContain("relativeToGround");
});

test("CSV download has the agreed columns", async ({ page }) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download: Waypoint table/ }).click()]);
  const text = await (await import("node:fs/promises")).readFile((await dl.path())!, "utf8");
  expect(text.split("\n")[0]).toBe("flight,seq,lat,lon,alt_above_launch_m,alt_above_launch_ft,speed_mps,hover_s,route_test_objective,block,pilot,pilot_lat,pilot_lon,note");
});

test("a ceiling below the top layer fails with a plain-language reason", async ({ page }) => {
  await page.getByRole("spinbutton", { name: /^Highest allowed altitude/ }).fill("100");
  await expect(page.locator(".verdict .vword")).toHaveText("FAIL");
  await expect(page.locator("#panel > .notes")).toContainText("above the ceiling");
});

test("the Skydio export is shown as waiting for the sample file, not hidden", async ({ page }) => {
  const b = page.getByRole("button", { name: /Download: Skydio X10 mission/ });
  await expect(b).toBeDisabled();
  await expect(page.getByText(/Waiting for a sample mission file/)).toBeVisible();
});

test("save the plan, change it, open it again: identical result", async ({ page }) => {
  await page.getByRole("spinbutton", { name: "Start (km along the line)" }).fill("12");
  await expect(page.locator(".verdict .vsum")).toContainText("km 12.00");
  const before = await page.locator(".verdict .vsum").innerText();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download: Save plan/ }).click()]);
  const file = (await dl.path())!;
  await page.getByRole("spinbutton", { name: "Start (km along the line)" }).fill("30");
  await expect(page.locator(".verdict .vsum")).toContainText("km 30.00");
  await page.locator("#open-plan").setInputFiles(file);
  await expect(page.locator(".verdict .vsum")).toHaveText(before);
});

test("drawing an area gives flights", async ({ page }) => {
  await page.getByRole("button", { name: "Over an area" }).click();
  await expect(page.locator(".verdict .vword")).toHaveText("NOT READY");
  await page.getByRole("button", { name: "Draw area" }).click();
  const box = (await page.locator("#map").boundingBox())!;
  for (const [dx, dy] of [[-120, -80], [120, -80], [120, 80], [-120, 80]]) await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "Add by clicking the map" }).first().click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 100);
  await page.keyboard.press("Escape");
  await expect(page.locator("table.flights tbody tr").first()).toBeVisible();
});

test("works on a phone-sized screen without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await expect(page.locator(".verdict .vword")).toHaveText("PASS");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("share link: copy it, open it in a fresh page, get the same plan", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("spinbutton", { name: "Start (km along the line)" }).fill("12");
  await page.getByRole("spinbutton", { name: /^Length/ }).fill("2200");
  await expect(page.locator(".verdict .vsum")).toContainText("km 12.00–14.20");
  const before = await page.locator(".verdict .vsum").innerText();
  await page.getByRole("button", { name: "Copy a link to this plan" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("#plan=");
  await page.goto("about:blank");
  await stubTiles(page);
  await page.goto(url);
  await expect(page.locator(".verdict .vsum")).toHaveText(before);
});

test("print cards: one page per flight, with the checklist and the waypoint table", async ({ page }) => {
  await page.evaluate(() => { window.print = () => undefined; });
  await page.getByRole("button", { name: "Print flight cards" }).click();
  await expect(page.locator("#print-root article")).toHaveCount(3);
  await expect(page.locator("#print-root article").first()).toContainText("Backtrack");
  await expect(page.locator("#print-root article").first().locator("table.wp tbody tr").first()).toBeAttached();
  await expect(page.locator("#print-root article").first()).toContainText("PLACEHOLDER");
});

test("an imported KML polygon becomes the approved zone and removes the assumed-zone warning", async ({ page }) => {
  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>zone</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
    -83.7440,42.2900,0 -83.7300,42.2900,0 -83.7300,42.2840,0 -83.7440,42.2840,0 -83.7440,42.2900,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
  await page.locator("#import-kml").setInputFiles({ name: "zone.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from(kml) });
  await expect(page.getByText("The approved fly-zone polygon is loaded.")).toBeVisible();
  await expect(page.locator("#panel > .notes")).not.toContainText("Assumed fly zone");
});
