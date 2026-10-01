import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  m = require("../work/rules/model.js"),
  b = require("../work/rules/battle.js");
const out = "work/acceptance-v051";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
  }),
  page = await context.newPage();
const url = process.env.TEST_URL || "http://127.0.0.1:5175/",
  key = m.SAVE_KEY,
  checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const get = () =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const act = async (id) => {
  const modal = page.locator(`#modal-root [data-action="${id}"]`);
  await (
    (await modal.count())
      ? modal.first()
      : page.locator(`[data-action="${id}"]`).first()
  ).click();
  await page.waitForTimeout(180);
};
const nav = async (id) => {
  await page.locator(`[data-tab="${id}"]`).click();
  await page.waitForTimeout(150);
};
async function load(s) {
  await page.evaluate(
    ({ key, s }) => localStorage.setItem(key, JSON.stringify(s)),
    { key, s },
  );
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
}
async function tile(i) {
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.click(
    box.x + ((300 + (i % 6) * 77) / 1000) * box.width,
    box.y + ((155 + Math.floor(i / 6) * 77) / 650) * box.height,
  );
  await page.waitForTimeout(650);
}
async function win() {
  let guard = 0;
  while ((await get()).battle.status === "playing" && guard++ < 30) {
    const x = (await get()).battle;
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
        const r = b.selectBattleTile(z, j);
        if (!["invalid", "selected"].includes(r) && x.hp - z.hp > score) {
          score = x.hp - z.hp;
          best = [i, j];
        }
      }
    assert.ok(best);
    await tile(best[0]);
    await tile(best[1]);
  }
  assert.equal((await get()).battle.status, "won");
}
try {
  await page.goto(url);
  for (let i = 0; i < 4; i++) {
    assert.equal(
      await page.locator(".opening-screen > img").getAttribute("src"),
      `assets/v6/opening-${i + 1}.webp`,
    );
    await page.screenshot({ path: `${out}/opening-${i + 1}.png` });
    await act("intro-next");
  }
  await page.locator('[data-gender="female"]').click();
  await act("random-name");
  assert.ok(await page.locator("#player-name").inputValue());
  await page.locator("#player-surname").fill("欧阳");
  await act("random-given");
  assert.equal(await page.locator("#player-surname").inputValue(), "欧阳");
  await page.locator("#player-name").fill("知微");
  await page.locator("#name-form button[type=submit]").click();
  await page.waitForTimeout(400);
  assert.equal((await get()).name, "欧阳知微");
  pass(
    "four individual opening screens, random names, compound surname creation",
  );
  await act("settings");
  await act("rename");
  await page.locator("#player-name").fill("听澜");
  await page.locator("#rename-form button[type=submit]").click();
  await page.waitForTimeout(200);
  assert.equal((await get()).name, "欧阳听澜");
  await act("close");
  pass("settings rename preserves separated surname and given name");
  await nav("battle");
  await act("battle-0");
  for (let n = 0; n < 3; n++) {
    await win();
    assert.equal((await get()).battle.level, n);
    await page.screenshot({ path: `${out}/victory-${n + 1}.png` });
    await act(`battle-${n + 1}`);
    assert.equal((await get()).battle.level, n + 1);
    assert.equal((await get()).battle.status, "playing");
  }
  pass(
    "three real canvas wins and next-stage button transitions with animations enabled",
  );
  const active = (await get()).battle;
  await act("battle-menu");
  await act(`battle-${active.level}`);
  assert.equal((await get()).battle.id, active.id);
  await act("battle-menu");
  await act("battle-0");
  assert.equal((await get()).stamina.value, 5);
  await act("abandon-trial");
  assert.equal((await get()).stamina.value, 4);
  assert.equal((await get()).battle.level, 0);
  pass(
    "map departure resumes same attempt; confirmed abandonment costs exactly one",
  );
  let s = await get();
  s.battle.moves = 1;
  s.battle.hp = 999;
  s.reducedMotion = true;
  await load(s);
  await nav("battle");
  const x = s.battle;
  let move;
  for (let i = 0; i < 36 && !move; i++)
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
      if (!["invalid", "selected"].includes(b.selectBattleTile(z, j))) {
        move = [i, j];
        break;
      }
    }
  await tile(move[0]);
  await tile(move[1]);
  assert.equal((await get()).battle.status, "lost");
  assert.equal((await get()).stamina.value, 3);
  await page.reload();
  await page.waitForTimeout(500);
  assert.equal((await get()).stamina.value, 3);
  pass("failure deducts once, refresh does not repeat deduction");
  s = m.newSave("male", "旧完整名字");
  delete s.revision;
  delete s.nameParts;
  delete s.stamina;
  await load(s);
  assert.equal((await get()).name, "旧完整名字");
  assert.equal((await get()).nameParts, null);
  assert.ok(
    await page.evaluate(
      (k) => localStorage.getItem(k + "-before-identity-stamina"),
      key,
    ),
  );
  pass(
    "legacy save migrated and raw backup retained without guessing name split",
  );
  s = m.newSave("female", "无体力验收");
  s.stamina = { value: 0, at: Date.now() - 3598000 };
  await load(s);
  await nav("battle");
  assert.equal(
    await page.locator('.tower-header [data-action="battle-0"]').isDisabled(),
    true,
  );
  await page.waitForTimeout(2500);
  assert.equal(
    await page.locator('.tower-header [data-action="battle-0"]').isDisabled(),
    false,
  );
  await act("battle-0");
  assert.equal((await get()).stamina.value, 1);
  pass("zero stamina recovers on real timer and unlocks entry without reload");
  s = m.newSave("female", "多窗口");
  s.battle = b.newBattle(0);
  s.battle.status = "won";
  m.rewardBattle(s);
  await load(s);
  await nav("battle");
  const second = await context.newPage();
  await second.goto(url);
  await second.locator('#canvas[data-ready="true"]').waitFor();
  await second.locator('[data-tab="battle"]').click();
  await Promise.all([
    page.evaluate(() =>
      document.querySelector('[data-action="battle-1"]')?.click(),
    ),
    second.evaluate(() =>
      document.querySelector('[data-action="battle-1"]')?.click(),
    ),
  ]);
  await page.waitForTimeout(200);
  assert.equal((await get()).battle.level, 1);
  assert.equal((await get()).sand, 10);
  assert.equal((await get()).stamina.value, 5);
  await second.close();
  pass(
    "two tabs continuing the same win do not duplicate reward or charge stamina",
  );
  s = m.newSave("female", "沈时珏");
  s.nameParts = { surname: "沈", givenName: "时珏" };
  s.cleared = Array.from({ length: 24 }, (_, i) => i);
  for (const [width, height] of [
    [1600, 900],
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await load(s);
    await nav("battle");
    assert.equal(await page.locator(".tower-node").count(), 60);
    await page.screenshot({ path: `${out}/tower-${width}.png` });
    const old = await page
      .locator(".tower-scroll")
      .evaluate((el) => el.scrollTop);
    await page.locator(".tower-scroll").hover();
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(200);
    assert.ok(
      (await page.locator(".tower-scroll").evaluate((el) => el.scrollTop)) <
        old,
    );
    await act("tower-focus");
    await nav("people");
    await page.screenshot({ path: `${out}/people-${width}.png` });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await act("settings");
    await act("rename");
    await page.screenshot({ path: `${out}/rename-${width}.png` });
    await act("settings");
    await act("close");
  }
  pass(
    "five landscape sizes: current node focus, vertical scroll, portraits, rename, no horizontal overflow",
  );
  // Exercise an actual touch gesture on the small-screen map.
  await nav("battle");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const box = await page.locator(".tower-scroll").boundingBox();
  const beforeTouch = await page
    .locator(".tower-scroll")
    .evaluate((el) => el.scrollTop);
  {
    const x = box.x + box.width / 2,
      y = box.y + 20;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let n = 1; n <= 6; n++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + n * 12 }],
      });
      await page.waitForTimeout(30);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(200);
    assert.ok(
      (await page.locator(".tower-scroll").evaluate((el) => el.scrollTop)) <
        beforeTouch,
    );
    pass("844x390 touch swipe scrolls the tower map");
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    `${out}/results.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (e) {
  await page.screenshot({ path: `${out}/failure.png` });
  throw e;
} finally {
  await browser.close();
}
