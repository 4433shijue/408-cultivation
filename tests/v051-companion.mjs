import { chromium } from "playwright";
import { createService } from "../server/index.mjs";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { newSave, SAVE_KEY } = require("../work/rules/model.js");
const requests = [];
const app = createService({
  dbPath: ":memory:",
  companionOptions: {
    fetchImpl: async (_url, { body }) => {
      requests.push(JSON.parse(body));
      return new Response(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: "【模拟接口验收】已收到当前姓名与关系资料。",
                },
              },
            ],
          }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  },
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  }),
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const save = newSave("female", "欧阳知微");
save.nameParts = { surname: "欧阳", givenName: "知微" };
save.companion.romances = ["lin", "yu", "shen"];
for (const id of save.companion.romances) {
  save.affinity[id] = 15;
  save.events.push(id, id + "-2", id + "-3");
}
await page.addInitScript(
  ({ key, save }) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify(save));
  },
  { key: SAVE_KEY, save },
);
const action = async (id) => {
  await page.locator(`[data-action="${id}"]`).last().click();
  await page.waitForTimeout(150);
};
const cp = async (id) => {
  await page.locator(`[data-cp="${id}"]`).first().click();
  await page.waitForTimeout(150);
};
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.locator('#canvas[data-ready="true"]').waitFor();
  await action("settings");
  await action("companion-config");
  await page.locator('[name="baseUrl"]').fill("https://mock.test/v1");
  await page.locator('[name="model"]').fill("mock-persona");
  await page.locator('[name="key"]').fill("mock-only-key");
  await page.locator('[data-cp-form="config"] button').first().click();
  for (const id of ["lin", "yu", "shen"]) {
    await cp("npc:" + id);
    await cp("view:chat");
    await page.locator('[name="message"]').fill("你可以怎么叫我？");
    const n = requests.length;
    await page.locator('[data-cp-form="chat"] button').first().click();
    await page.waitForFunction(
      () => document.querySelector("#companion-root").dataset.busy !== "true",
    );
    for (let i = 0; requests.length === n && i < 30; i++)
      await page.waitForTimeout(100);
    assert.equal(requests.length, n + 1);
    const req = requests.at(-1);
    assert.ok(req.messages[1].content.includes('"givenName":"知微"'));
    assert.ok(req.messages[1].content.includes('"romance":true'));
    await page.waitForTimeout(300);
  }
  await cp("close");
  await action("settings");
  await action("rename");
  await page.locator("#player-name").fill("听澜");
  await page.locator("#rename-form button[type=submit]").click();
  await page.waitForTimeout(200);
  await action("close");
  await page.locator('[data-tab="people"]').click();
  await page.locator('[data-person="lin"]').click();
  await action("open-npc:lin");
  await cp("view:chat");
  await page.locator('[name="message"]').fill("我改名了。");
  await page.locator('[data-cp-form="chat"] button').first().click();
  for (let i = 0; requests.length < 4 && i < 30; i++)
    await page.waitForTimeout(100);
  assert.equal(requests.length, 4);
  assert.ok(requests.at(-1).messages[1].content.includes('"name":"欧阳听澜"'));
  assert.ok(requests.at(-1).messages[1].content.includes('"givenName":"听澜"'));
  await page.waitForTimeout(1500);
  await cp("close");
  await action("settings");
  const downloaded = page.waitForEvent("download");
  await action("export");
  const file = await downloaded;
  const bundle = JSON.parse(readFileSync(await file.path(), "utf8"));
  assert.equal(bundle.game.nameParts.givenName, "听澜");
  assert.equal(bundle.game.stamina.value, 5);
  assert.ok(bundle.companion.messages.length >= 8);
  await action("rename");
  await page.locator("#player-name").fill("临时名");
  await page.locator("#rename-form button[type=submit]").click();
  await page.waitForTimeout(200);
  await page
    .locator("#import-file")
    .setInputFiles({
      name: "roundtrip.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)).name,
      SAVE_KEY,
    ),
    "欧阳听澜",
  );
  mkdirSync("work/acceptance-v051", { recursive: true });
  writeFileSync(
    "work/acceptance-v051/companion.json",
    JSON.stringify(
      {
        provider: "mock only",
        requests: requests.length,
        checks: [
          "three NPC requests receive confirmed relationship and explicit given name",
          "renaming updates next request while preserving chat history",
          "complete export/import preserves surname, given name, stamina and chat history",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS three NPC name contexts and rename propagation (mock provider only)",
  );
} finally {
  await browser.close();
  await app.close();
}
