import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const seeds = JSON.parse(readFileSync("shared/seeds.json"));
const save = JSON.parse(
  readFileSync("work/acceptance/exported-save.json"),
).game;
const key = "lingtian-408-save-v3";
let down = true,
  retired = false,
  requests = 0;
await page.route("**/api/questions", (route) =>
  route.fulfill({
    json: {
      questions: retired ? seeds.filter((q) => q.id !== "ds-01") : seeds,
      retired: retired ? ["ds-01"] : [],
    },
  }),
);
await page.route("**/api/report", (route) => {
  requests++;
  if (down) return route.abort("failed");
  retired = true;
  return route.fulfill({ json: { ok: true } });
});
try {
  await page.goto("http://127.0.0.1:4175/");
  await page.evaluate(
    ({ k, s }) => localStorage.setItem(k, JSON.stringify(s)),
    { k: key, s: save },
  );
  await page.reload();
  await page.locator('[data-tab="cultivate"]').click();
  await page.locator('[data-action="history"]').click();
  await page.locator('[data-review="ds-01"]').click();
  await page.locator('[data-answer="0"]').click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator('[data-action="report"]').click();
  await page.waitForFunction(
    (k) => JSON.parse(localStorage.getItem(k)).reportQueue.includes("ds-01"),
    key,
  );
  assert.ok(
    (
      await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key)
    ).reported.includes("ds-01"),
  );
  down = false;
  await page.reload();
  await page.waitForFunction(
    (k) => JSON.parse(localStorage.getItem(k)).reportQueue.length === 0,
    key,
  );
  assert.ok(retired);
  const afterSync = requests;
  retired = false;
  await page.reload();
  await page.waitForFunction(
    (k) => !JSON.parse(localStorage.getItem(k)).reported.includes("ds-01"),
    key,
  );
  assert.equal(requests, afterSync);
  writeFileSync(
    "work/acceptance/reports.json",
    JSON.stringify(
      {
        offlineQueued: true,
        synced: true,
        reviewRestored: true,
        noRepeatedReport: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS offline report queue, sync, review restoration without repeated quarantine",
  );
} finally {
  await browser.close();
}
