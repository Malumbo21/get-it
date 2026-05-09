/**
 * Verify the NEXT_PUBLIC_AUTO_GENERATE_VIZ=false (manual) mode:
 *   - tags appear after detection
 *   - NO viz generation network calls fire automatically
 *   - clicking a tag triggers ONE generate-viz call
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const reqs = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/analyze-pdf") || u.includes("/api/generate-viz")) {
    reqs.push({ method: r.method(), url: u, at: Date.now() });
  }
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator('button:has-text("Classical Mechanics")').first().click();
await page.waitForURL(/\/viewer\//);

// Check the manual-mode chip in the header
await page.waitForTimeout(2000);
const chipPresent = await page.locator("text=manual mode").first().isVisible().catch(() => false);
console.log("manual-mode chip visible:", chipPresent);

// Wait until at least one tag pill is on screen.
console.log("waiting for tags to appear from detection…");
await page.waitForSelector("[data-page] button", { timeout: 90_000 });

// Now wait 25 seconds — during this window NO generate-viz request should fire.
console.log("watching for spontaneous generate-viz calls (25 s)…");
await page.waitForTimeout(25_000);
const spontaneous = reqs.filter((r) => r.url.includes("/api/generate-viz"));
console.log("spontaneous generate-viz calls:", spontaneous.length);

// Now click a tag and check that exactly ONE generate-viz call appears.
const before = reqs.length;
const firstTag = page.locator("[data-page] button:not([disabled])").first();
const tagText = (await firstTag.textContent())?.trim();
console.log("clicking tag:", tagText);
await firstTag.click();
await page.waitForTimeout(3000);
const after = reqs.length;
const newOnes = reqs.slice(before).filter((r) => r.url.includes("/api/generate-viz"));
console.log("generate-viz calls triggered by click:", newOnes.length);

await browser.close();

const ok = chipPresent && spontaneous.length === 0 && newOnes.length === 1;
console.log(ok ? "\n✓ manual mode behaves correctly" : "\n✗ manual mode misbehaving");
process.exit(ok ? 0 : 2);
