import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

for (const theme of ["light", "dark"] as const) {
  test(`no serious accessibility violations in the ${theme} theme`, async ({ page }) => {
    await page.route(/nationalmap\.gov|eox\.at|arcgisonline|openstreetmap|googleapis/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: png }));
    await page.addInitScript((t) => localStorage.setItem("skyway-planner.theme", t), theme);
    await page.goto("/");
    await page.waitForSelector(".verdict");
    await page.locator("details.card:not([open]) > summary").evaluateAll((els) => els.forEach((e) => (e.parentElement as HTMLDetailsElement).open = true));
    const r = await new AxeBuilder({ page }).include("#panel").withTags(["wcag2a", "wcag2aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}
