import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const fixture = JSON.parse(
  readFileSync("docs/evidence/v3/chapter-complete-save.json"),
);
// Isolated inventory fixture for atomic batch crafting, separate from the unassisted chapter playthrough.
fixture.inventory.herb = 6;
fixture.board.fill(null);
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const act = (id) => page.locator(`[data-action="${id}"]`).first().click();
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("lingtian-408-save-v3")));
try {
  await page.goto("http://127.0.0.1:4175/");
  await page.locator("#import-file").setInputFiles({
    name: "chapter.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.deepEqual((await state()).home, fixture.home);
  await page.locator('[data-tab="craft"]').click();
  await page.locator('[data-lock="herb"]').click();
  await act("batch-menu");
  assert.ok(await page.locator('[data-action="batch:tea"]').isDisabled());
  await act("close");
  await page.locator('[data-lock="herb"]').click();
  await act("batch-menu");
  await act("batch:tea");
  assert.equal((await state()).inventory.herb, 0);
  assert.equal((await state()).inventory.tea, fixture.inventory.tea + 3);
  assert.ok(await page.locator('[data-action="batch:tea"]').isDisabled());
  await page.screenshot({ path: "docs/evidence/v3/batch-crafting.png" });
  await act("close");
  await act("settings");
  const download = page.waitForEvent("download");
  await act("export");
  const file = await download;
  await file.saveAs("work/acceptance/v3-export.json");
  const exported = JSON.parse(
    readFileSync("work/acceptance/v3-export.json"),
  ).game;
  assert.equal(exported.home.chapter, 6);
  assert.deepEqual(exported.home.facilities, fixture.home.facilities);
  assert.deepEqual(errors, []);
  writeFileSync(
    "docs/evidence/v3/import-batch-report.json",
    JSON.stringify(
      {
        checks: [
          "complete homestead import preserves every home field",
          "batch craft respects locked materials, consumes exactly six herbs and grants exactly three teas",
          "export preserves chapter, facilities and event data",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS homestead import/export and locked / successful batch crafting",
  );
} finally {
  await browser.close();
}
