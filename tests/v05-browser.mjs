import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  m = require("../work/rules/model.js"),
  b = require("../work/rules/battle.js");
const out = "work/acceptance-v05";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const key = "lingtian-408-save-v4",
  url = process.env.TEST_URL || "http://127.0.0.1:5175/";
const get = () =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const act = async (id) => {
  await page.locator(`[data-action="${id}"]`).first().click();
  await page.waitForTimeout(100);
};
const nav = async (id) => {
  await page.locator(`[data-tab="${id}"]`).click();
  await page.waitForTimeout(100);
};
async function load(s) {
  await page.evaluate(
    ({ key, s }) => localStorage.setItem(key, JSON.stringify(s)),
    { key, s },
  );
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
}
async function tile(i, farm = false, p = page) {
  const box = await p.locator("canvas").boundingBox();
  const x = farm ? 270 + (i % 3) * 225 : 300 + (i % 6) * 77,
    y = farm ? 285 + Math.floor(i / 3) * 110 : 155 + Math.floor(i / 6) * 77;
  await p.mouse.click(
    box.x + (x / 1000) * box.width,
    box.y + (y / 650) * box.height,
  );
  await p.waitForTimeout(100);
}
const checks = [];
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await page.goto(url);
  await act("gender");
  await page.locator('[data-gender="female"]').click();
  await page.locator("#player-name").fill("田间验收");
  await page.locator("#name-form button").click();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.equal((await get()).version, 4);
  await tile(0, true);
  assert.equal((await get()).inventory.herb, 4);
  await tile(3, true);
  const ready = (await get()).plots[3].readyAt;
  await tile(3, true);
  assert.equal((await get()).plots[3].readyAt, ready - 360000);
  await tile(3, true);
  assert.equal((await get()).plots[3].readyAt, ready - 360000);
  pass("new female game, harvest, plant, one-time watering via canvas");
  await act("seed-shop");
  const before = (await get()).seedStock.herb;
  await act("seed-buy:herb:5");
  assert.equal((await get()).seedStock.herb, before + 5);
  await page.screenshot({ path: out + "/seed-shop.png" });
  await act("close");
  const second = await context.newPage();
  await second.goto(url);
  await second.locator('#canvas[data-ready="true"]').waitFor();
  await act("seed-shop");
  await second.locator('[data-action="seed-shop"]').click();
  await Promise.all([
    page.locator('[data-action="seed-buy:herb:1"]').click(),
    second.locator('[data-action="seed-buy:herb:1"]').click(),
  ]);
  await page.waitForTimeout(500);
  assert.equal((await get()).seedStock.herb, before + 7);
  assert.equal((await get()).coins, 6);
  await second.close();
  await act("close");
  pass("bulk seed purchase and two-tab purchases preserve both transactions");
  const farm = await get();
  farm.reducedMotion = true;
  farm.plots[3].readyAt = Date.now() - 1;
  await load(farm);
  await tile(3, true);
  assert.equal((await get()).inventory.herb, 6);
  pass("offline deadline survives reload and harvest");
  await nav("battle");
  assert.equal(await page.locator(".level-grid button").count(), 60);
  assert.equal(
    await page.locator('[data-action="battle-1"]').isDisabled(),
    true,
  );
  await page.screenshot({ path: out + "/campaign.png" });
  await act("battle-0");
  let guard = 0;
  while ((await get()).battle.status === "playing" && guard++ < 25) {
    const s = await get(),
      x = s.battle;
    let best = null,
      score = -Infinity;
    for (let i = 0; i < 36; i++)
      for (const j of [i + 1, i + 6]) {
        if (
          j >= 36 ||
          Math.abs((i % 6) - (j % 6)) +
            Math.abs(Math.floor(i / 6) - Math.floor(j / 6)) !==
            1
        )
          continue;
        const z = structuredClone(x);
        z.selected = i;
        const result = b.selectBattleTile(z, j);
        if (!["invalid", "selected"].includes(result)) {
          const n = x.hp - z.hp;
          if (n > score) {
            score = n;
            best = [i, j];
          }
        }
      }
    assert.ok(best);
    await tile(best[0]);
    await tile(best[1]);
    await page.waitForTimeout(100);
  }
  assert.equal((await get()).battle.status, "won");
  const sand = (await get()).sand;
  assert.equal(sand, 10);
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.equal((await get()).sand, sand);
  pass("first stage real canvas win, reward and refresh idempotency");
  const fixture = m.newSave("male", "试炼验收");
  fixture.reducedMotion = true;
  fixture.tutorial.crafted = true;
  fixture.sand = 100;
  fixture.cleared = Array.from({ length: 60 }, (_, i) => i);
  fixture.battle = b.newBattle(59);
  fixture.home.facilities = { spring: true, workshop: true, rack: true };
  fixture.plots[3] = {
    crop: "lotus",
    stage: 1,
    watered: true,
    plantedAt: Date.now(),
    readyAt: Date.now() + 7200000,
    fertilized: false,
  };
  for (const [width, height] of [
    [1600, 900],
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await load(fixture);
    await page.screenshot({ path: `${out}/farm-${width}.png` });
    await act("seed-shop");
    await page.screenshot({ path: `${out}/shop-${width}.png` });
    await act("close");
    await nav("battle");
    await page.locator(".enemy").evaluate(async (img) => {
      if (!img.complete)
        await new Promise((r) => {
          img.onload = r;
          img.onerror = r;
        });
    });
    await page.screenshot({ path: `${out}/boss-${width}.png` });
    await act("tool-shop");
    await act("buy-tool:steps");
    await act("close");
    await act("use-tool:steps");
    assert.equal((await get()).battle.toolUsed, true);
    assert.equal(
      await page.locator('[data-action="use-tool:steps"]').isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  pass(
    "five landscape sizes, mature and growing crops, shop, boss layout and tools",
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  for (let i = 0; i < 6; i++) {
    fixture.battle = b.newBattle(i * 10 + 9);
    await load(fixture);
    await nav("battle");
    await page.screenshot({ path: `${out}/boss-art-${i + 1}.png` });
    assert.ok(
      await page
        .locator(".enemy")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    );
  }
  pass("six distinct boss art files render");
  const legacy = m.newSave("female", "旧存档");
  legacy.version = 3;
  legacy.day = 10;
  legacy.seeds = 9;
  legacy.affinity.lin = 12;
  delete legacy.lastSeen;
  delete legacy.seedStock;
  delete legacy.sand;
  delete legacy.cleared;
  delete legacy.settled;
  delete legacy.tools;
  await page.evaluate(
    ({ key, legacy }) => {
      localStorage.removeItem(key);
      localStorage.setItem("lingtian-408-save-v3", JSON.stringify(legacy));
    },
    { key, legacy },
  );
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.equal((await get()).seeds, 9);
  assert.equal((await get()).affinity.lin, 12);
  assert.ok(
    await page.evaluate(() =>
      localStorage.getItem("lingtian-408-save-v3-backup"),
    ),
  );
  pass("v3 browser migration and original backup");
  await act("settings");
  const downloadPromise = page.waitForEvent("download");
  await act("export");
  const download = await downloadPromise;
  await download.saveAs(out + "/export.json");
  await page.locator("#import-file").setInputFiles(out + "/export.json");
  await page.waitForTimeout(500);
  assert.equal((await get()).name, "旧存档");
  pass("complete export/import round trip");
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "/report.json",
    JSON.stringify(
      { checks, errors, provider: "not used in this gameplay suite" },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({ path: out + "/failure.png" });
  throw e;
} finally {
  await browser.close();
}
