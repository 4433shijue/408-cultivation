import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const out = "work/screenshots-v2";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("/api/"))
    errors.push(`${r.status()} ${r.url()}`);
});
const key = "lingtian-408-save-v3";
const state = () =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const click = async (action) => {
  await page.locator(`[data-action="${action}"]`).click();
};
const nav = async (tab) => {
  await page.locator(`[data-tab="${tab}"]`).click();
};
const shot = async (name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png` });
};
const tile = async (x, y) => {
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.click(
    box.x + (x / 1000) * box.width,
    box.y + (y / 650) * box.height,
  );
};
const matching = (c) => {
  for (let i = 0; i < 36; i++) {
    if (i % 6 < 4 && c[i] === c[i + 1] && c[i] === c[i + 2]) return true;
    if (i < 24 && c[i] === c[i + 6] && c[i] === c[i + 12]) return true;
  }
  return false;
};
const checks = [];
const record = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await page.goto("http://127.0.0.1:4175/");
  await page.locator(".opening-comic").waitFor();
  await shot("01-opening");
  await click("gender");
  await shot("02-gender");
  await page.locator('[data-gender="female"]').click();
  await page.locator("#player-name").fill("青禾");
  await page.locator("#name-form button").click();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  await shot("03-home-1600");
  assert.equal((await state()).gender, "female");
  record("female onboarding and first save");
  await tile(270, 290);
  assert.equal((await state()).inventory.herb, 4);
  await tile(270, 290);
  assert.equal((await state()).plots[0].stage, 0);
  await tile(270, 290);
  assert.equal((await state()).plots[0].watered, true);
  record("harvest / seed / water through actual canvas");
  await nav("craft");
  await page
    .locator('[data-item="herb"]')
    .dragTo(page.locator('[data-cell="0"]'));
  assert.equal((await state()).board[0], "herb");
  await page.locator('[data-cell="1"]').click();
  assert.equal((await state()).board[1], "herb");
  await shot("04-craft-preview");
  await click("craft");
  assert.equal((await state()).inventory.tea, 1);
  await nav("farm");
  await click("order");
  assert.equal((await state()).coins, 34);
  record("drag + click crafting and order settlement");
  await nav("battle");
  await click("battle-0");
  await shot("05-battle");
  for (let n = 0; n < 14; n++) {
    const s = await state();
    if (s.battle.status !== "playing") break;
    let pair;
    for (let i = 0; i < 36 && !pair; i++)
      for (const j of [i + 1, i + 6]) {
        if (j >= 36 || (j === i + 1 && i % 6 === 5)) continue;
        const c = [...s.battle.cells];
        [c[i], c[j]] = [c[j], c[i]];
        if (matching(c)) {
          pair = [i, j];
          break;
        }
      }
    assert.ok(pair);
    for (const i of pair)
      await tile(300 + (i % 6) * 77, 155 + Math.floor(i / 6) * 77);
    await page.waitForFunction((k) => {
      const s = JSON.parse(localStorage.getItem(k));
      return s.battle.selected === null;
    }, key);
    await page.waitForTimeout(700);
  }
  assert.equal((await state()).battle.status, "won");
  assert.equal((await state()).inventory.ore, 2);
  record("match-three win and reward");
  await nav("cultivate");
  await click("question");
  await shot("06-question");
  await page.locator('[data-answer="1"]').click();
  await click("submit-answer");
  assert.equal((await state()).qi, 0);
  await shot("07-wrong-answer");
  await click("close-result");
  await click("close");
  await nav("people");
  await shot("08-people");
  await page.locator('[data-person="lin"]').click();
  await click("chat-lin");
  await shot("09-dialogue");
  await click("close");
  record("wrong answer branch and NPC conversation");
  await nav("farm");
  await click("sleep");
  await nav("cultivate");
  await click("question");
  await click("defer");
  assert.equal((await state()).pending.length, 1);
  await click("pending");
  await page.locator("[data-question]").first().click();
  await page.locator('[data-answer="1"]').click();
  await click("submit-answer");
  assert.equal((await state()).qi, 10);
  await click("close-result");
  record("defer / pending answer / correct reward");
  await click("history");
  await page.locator('[data-review="ds-02"]').click();
  await page.locator('[data-answer="1"]').click();
  await click("submit-answer");
  assert.equal((await state()).qi, 10);
  await click("close-result");
  record("review does not reward");
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.equal(await page.locator(".opening-comic").count(), 0);
  assert.equal((await state()).qi, 10);
  record("reload restores save without repeating intro");
  await click("settings");
  await shot("10-settings");
  const download = page.waitForEvent("download");
  await click("export");
  const file = await download;
  await file.saveAs("work/acceptance/exported-save.json");
  await click("close");
  record("save export");
  for (const [w, h] of [
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [844, 390],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const t of ["farm", "craft", "battle", "cultivate", "people"]) {
      await nav(t);
      if (t === "battle") {
        if (await page.locator('[data-action="battle-menu"]').count())
          await click("battle-menu");
        if (await page.locator('[data-action="battle-0"]').count())
          await click("battle-0");
      }
      if (["farm", "battle"].includes(t)) {
        await page.waitForFunction(
          () =>
            document.querySelector("canvas").getBoundingClientRect().width >
            200,
        );
        if (t === "farm") {
          for (let day = 0; day < 3 && (await state()).plots[8].watered; day++)
            await click("sleep");
          const before = await state();
          await tile(720, 510);
          assert.notDeepEqual((await state()).plots[8], before.plots[8]);
        }
      }
      await shot(`${w}x${h}-${t}`);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await nav("cultivate");
    await click("history");
    await page.locator('[data-review="ds-02"]').click();
    await shot(`${w}x${h}-question`);
    await click("defer");
  }
  record("all five scenes and question at four landscape sizes");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("portrait-rotation");
  assert.ok(await page.locator(".rotate-note").isVisible());
  await page.setViewportSize({ width: 1600, height: 900 });
  record("portrait rotation prompt");
  await context.setOffline(true);
  await nav("cultivate");
  await click("history");
  await page.locator('[data-review="ds-01"]').click();
  await page.locator('[data-answer="0"]').click();
  await click("submit-answer");
  await click("close-result");
  await nav("farm");
  await click("sleep");
  await context.setOffline(false);
  record("offline review and next-day play");
  const saved = await state();
  await page.evaluate((k) => localStorage.removeItem(k), key);
  await page.reload();
  await click("gender");
  await page.locator('[data-gender="male"]').click();
  await page.locator("#player-name").fill("归舟");
  await page.locator("#name-form button").click();
  assert.equal((await state()).gender, "male");
  record("male onboarding");
  await page
    .locator("#import-file")
    .setInputFiles("work/acceptance/exported-save.json");
  await page.waitForFunction(
    (k) => JSON.parse(localStorage.getItem(k))?.name === "青禾",
    key,
  );
  assert.equal((await state()).name, "青禾");
  record("save import");
  await page.evaluate(
    ({ k, s }) => {
      localStorage.removeItem(k);
      localStorage.setItem(
        "lingtian-408-save-v1",
        JSON.stringify({ ...s, version: 1, answers: undefined }),
      );
    },
    { k: key, s: saved },
  );
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  assert.equal((await state()).version, 3);
  assert.equal((await state()).answers[0].correct, null);
  assert.ok(
    await page.evaluate(() =>
      localStorage.getItem("lingtian-408-save-v1-backup"),
    ),
  );
  record("old save migration and preserved raw backup");
  assert.deepEqual(errors, []);
  record("no browser runtime or asset loading errors");
  writeFileSync(
    "work/acceptance/browser.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
