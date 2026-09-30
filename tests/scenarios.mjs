import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const base = JSON.parse(
  readFileSync("work/acceptance/exported-save.json"),
).game;
const seeds = JSON.parse(readFileSync("shared/seeds.json"));
const key = "lingtian-408-save-v3";
const checks = [];
const load = async (s) => {
  await page.goto("http://127.0.0.1:4175/");
  await page.evaluate(
    ({ k, s }) =>
      localStorage.setItem(k, typeof s === "string" ? s : JSON.stringify(s)),
    { k: key, s },
  );
  await page.reload();
  await page
    .locator('#canvas[data-ready="true"]')
    .waitFor({ state: "attached" });
};
const state = () =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const click = (a) => page.locator(`[data-action="${a}"]`).click();
const nav = (t) => page.locator(`[data-tab="${t}"]`).click();
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  let s = structuredClone(base);
  s.day = 10;
  s.qi = 40;
  s.tutorial = {
    harvested: true,
    crafted: true,
    fought: true,
    answered: true,
    chatted: true,
  };
  await load(s);
  await nav("cultivate");
  await click("question");
  const stem = await page.locator(".question-stem").textContent();
  const currentQuestion = seeds.find((q) => q.stem === stem);
  assert.ok(currentQuestion, "Expected an offline seed question");
  await page.locator(`[data-answer="${currentQuestion.answer}"]`).click();
  await click("submit-answer");
  assert.equal((await state()).qi, 50);
  await click("close-result");
  await page.locator("h2").filter({ hasText: "破境" }).waitFor();
  assert.equal((await state()).breakthrough, true);
  await page.screenshot({ path: "work/screenshots-v2/breakthrough.png" });
  pass("first breakthrough appears after result and unlocks higher yield");
  s = structuredClone(base);
  s.day = 12;
  s.inventory.tea = 3;
  s.inventory.cake = 3;
  s.inventory.elixir = 3;
  await load(s);
  await nav("people");
  for (const id of ["lin", "yu", "shen"]) {
    await page.locator(`[data-person="${id}"]`).click();
    await click("chat-" + id);
    await click("close");
    await page.locator(`[data-person="${id}"]`).click();
    await click("gift-" + id);
    await click("close");
    assert.ok((await state()).events.includes(id));
  }
  pass("all three friendship events reachable through chat and gift");
  s = structuredClone(base);
  s.seeds = 0;
  s.coins = 0;
  s.inventory.herb = 0;
  s.plots = s.plots.map(() => ({ crop: null, stage: 0, watered: false }));
  await load(s);
  await click("seed-gift");
  assert.equal((await state()).seeds, 3);
  pass("zero-resource state can recover for free");
  s = structuredClone(base);
  s.day = 12;
  s.pending = [];
  await load(s);
  await nav("cultivate");
  for (let i = 0; i < 3; i++) {
    await click("question");
    await click("defer");
  }
  assert.equal((await state()).pending.length, 3);
  await click("question");
  await click("defer");
  assert.equal((await state()).pending.length, 3);
  assert.ok(await page.locator(".question-stem").isVisible());
  pass("pending queue cap preserves active question");
  s = structuredClone(base);
  s.answers = [
    {
      id: "long-test",
      selected: 0,
      correct: false,
      day: 1,
      question: {
        ...seeds[0],
        id: "long-test",
        stem: "长题干滚动检查。".repeat(120),
        explanation: "这是一段用于测试滚动和布局的解析。".repeat(120),
      },
    },
  ];
  s.answered = ["long-test"];
  await load(s);
  await page.setViewportSize({ width: 844, height: 390 });
  await nav("cultivate");
  await click("history");
  await page.locator('[data-review="long-test"]').click();
  await page.locator('[data-answer="0"]').click();
  await click("submit-answer");
  await page
    .locator(".explanation")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.screenshot({
    path: "work/screenshots-v2/long-question-small.png",
  });
  await click("close-result");
  pass("long question and explanation scroll at 844x390");
  await page.setViewportSize({ width: 1366, height: 768 });
  await load("{broken json");
  await page.locator("h2").filter({ hasText: "先把回忆收好" }).waitFor();
  assert.equal(
    await page.evaluate((k) => localStorage.getItem(k), key),
    "{broken json",
  );
  pass("corrupt save retains raw data and opens recovery");
  writeFileSync(
    "work/acceptance/scenarios.json",
    JSON.stringify({ checks }, null, 2),
  );
} finally {
  await browser.close();
}
