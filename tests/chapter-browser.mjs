import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const out = "docs/evidence/v3";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  reducedMotion: "reduce",
});
const page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("/api/"))
    errors.push(`${r.status()} ${r.url()}`);
});
const key = "lingtian-408-save-v3";
const state = () =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const act = async (id) => {
  await page.locator(`[data-action="${id}"]`).first().click();
};
const nav = async (id) => page.locator(`[data-tab="${id}"]`).click();
const shot = async (name) => {
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/${name}.png` });
};
const tile = async (i) => {
  const b = await page.locator("canvas").boundingBox();
  await page.mouse.click(
    b.x + ((270 + (i % 3) * 225) / 1000) * b.width,
    b.y + ((285 + Math.floor(i / 3) * 110) / 650) * b.height,
  );
};
const recipe = async (id) => {
  await nav("craft");
  await page.locator(`[data-recipe="${id}"]`).click();
  assert.ok(
    await page.locator('[data-action="craft"]').isEnabled(),
    `Cannot craft ${id}: ${JSON.stringify((await state()).inventory)}`,
  );
  await act("craft");
};
const claim = async () => {
  await act("chapter");
  await act("claim-chapter");
  await act("close");
};
const friends = async () => {
  await nav("people");
  for (const id of ["lin", "yu", "shen"]) {
    await page.locator(`[data-person="${id}"]`).click();
    await act(`chat-${id}`);
    await act("close");
  }
};
const upgrade = async (id) => {
  await act("home");
  await act(`upgrade:${id}`);
  await act("close");
};
const record = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await page.goto("http://127.0.0.1:4175/");
  await act("gender");
  await page.locator('[data-gender="female"]').click();
  await page.locator("#player-name").fill("青禾");
  await page.locator("#name-form button").click();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  await shot("01-new-home");
  for (let i = 0; i < 3; i++) await tile(i);
  await recipe("tea");
  await nav("farm");
  await act("order");
  await friends();
  await claim();
  await nav("farm");
  const crops = [
    "herb",
    "rice",
    "mint",
    "mint",
    "berry",
    "chrys",
    "lotus",
    "lotus",
    "rice",
  ];
  for (let i = 0; i < 9; i++) {
    if (!(await state()).seeds) await act("seed-gift");
    await act("crops");
    await page.locator(`[data-crop="${crops[i]}"]`).click();
    await tile(i);
    await tile(i);
    assert.equal((await state()).plots[i].crop, crops[i]);
  }
  record(
    "all nine actual plot positions plant and water, all six crops selectable",
  );
  for (let day = 2; day <= 10; day++) {
    await nav("farm");
    await act("sleep");
    assert.equal((await state()).day, day);
    await friends();
    await nav("farm");
    if (day === 3) {
      assert.ok((await state()).plots.every((p) => p.watered));
      await shot("02-rain-and-crops");
    }
    for (let i = 0; i < 9; i++) {
      if ((await state()).plots[i].crop) await tile(i);
    }
    if (day === 3) {
      await upgrade("rack");
      await claim();
      await recipe("dried");
      await recipe("dried");
      assert.equal((await state()).home.drying.length, 2);
      await act("home");
      await shot("03-drying");
      await act("close");
    }
    if (day === 4) {
      await act("home");
      await act("collect-drying");
      await act("close");
      assert.equal((await state()).inventory.dried, 2);
      for (let i = 0; i < 4; i++) await act("buy-ore");
      await upgrade("spring");
      await claim();
      await upgrade("workshop");
      await recipe("sachet");
      await recipe("jam");
      await claim();
      await recipe("tonic");
      record(
        "crafted, dried overnight, collected, upgraded all facilities and delivered chapter materials",
      );
    }
  }
  await claim();
  await act("chapter");
  await act("claim-chapter");
  assert.equal((await state()).home.chapter, 6);
  await shot("04-chapter-ending");
  await act("close");
  assert.equal((await state()).qi, 0);
  record(
    "chapter completed on day 10 entirely through browser actions, no injected inventory or qi",
  );
  await nav("farm");
  await shot("05-completed-home");
  await act("home");
  await shot("06-facilities");
  await act("close");
  await act("journal");
  await shot("07-journal");
  await act("close");
  await act("settings");
  await act("sound");
  assert.ok((await state()).home.sound);
  await act("sound");
  assert.equal((await state()).home.sound, false);
  await act("close");
  record("sound on/off UI updates and persists without browser errors");
  // Continue ordinary conversation until all nine friendship episodes are reached.
  for (let day = 11; day <= 12; day++) {
    await nav("farm");
    await act("sleep");
    await friends();
  }
  for (const id of ["lin", "yu", "shen"])
    for (const suffix of ["", "-2", "-3"])
      assert.ok((await state()).events.includes(id + suffix));
  await nav("farm");
  await act("visit");
  await act("close");
  const visitSeeds = (await state()).seeds;
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.equal((await state()).seeds, visitSeeds);
  assert.ok((await state()).home.visits.includes("visit-12"));
  record(
    "all nine NPC episodes and visitor reward survive refresh without repeats",
  );
  // Plant a second generation using the newly restored spring.
  await page.waitForTimeout(350);
  for (let i = 0; i < 9; i++) {
    if (!(await state()).seeds) await act("seed-gift");
    await tile(i);
    assert.ok(
      (await state()).plots[i].crop,
      `second sow plot ${i}: ${JSON.stringify((await state()).plots)}`,
    );
  }
  await act("water-all");
  assert.ok((await state()).plots.every((p) => p.watered));
  record("restored spring waters all plots");
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await shot(`08-home-${width}`);
    for (const id of ["crops", "home", "chapter", "journal"]) {
      await act(id);
      assert.ok(await page.locator(".modal").isVisible());
      await shot(`09-${id}-${width}`);
      await act("close");
    }
    assert.ok(await page.locator('[data-action="sleep"]').isVisible());
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false);
  }
  record(
    "four desktop/small landscape layouts render all new panels without page overflow",
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  const exported = await state();
  writeFileSync(
    `${out}/chapter-complete-save.json`,
    JSON.stringify(exported, null, 2),
  );
  // Genuine v0.2 shape, migrated via startup; assert source backup is untouched.
  const legacy = structuredClone(exported);
  legacy.version = 2;
  delete legacy.home;
  delete legacy.companion;
  for (const id of [
    "mint",
    "berry",
    "chrys",
    "dried",
    "jam",
    "sachet",
    "tonic",
  ])
    delete legacy.inventory[id];
  legacy.selectedCrop = "herb";
  legacy.selectedItem = "herb";
  legacy.plots = legacy.plots.map(() => ({
    crop: null,
    stage: 0,
    watered: false,
  }));
  await page.evaluate(
    ({ key, legacy }) => (
      localStorage.removeItem(key),
      localStorage.setItem("lingtian-408-save-v2", JSON.stringify(legacy))
    ),
    { key, legacy },
  );
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.equal((await state()).home.startedOn, legacy.day);
  assert.equal((await state()).name, legacy.name);
  assert.equal((await state()).inventory.herb, legacy.inventory.herb);
  const backup = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem("lingtian-408-save-v2-backup")),
    key,
  );
  assert.equal(backup.home, undefined);
  record("v0.2 migration backs up exact old shape and preserves progress");
  assert.deepEqual(errors, []);
  writeFileSync(
    `${out}/browser-report.json`,
    JSON.stringify({ checks, errors, realProviderRetested: false }, null, 2),
  );
} finally {
  await browser.close();
}
