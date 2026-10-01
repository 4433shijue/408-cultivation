import { chromium } from "playwright";
import { createService } from "../server/index.mjs";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { newSave } = require("../work/rules/model.js");
const out = "docs/evidence/v4";
mkdirSync(out, { recursive: true });
let calls = 0,
  mode = "normal",
  requests = [];
const app = createService({
  dbPath: ":memory:",
  companionOptions: {
    fetchImpl: async (_url, { body, signal }) => {
      calls++;
      const payload = JSON.parse(body);
      requests.push(payload);
      if (mode === "fail")
        return new Response("provider failure", { status: 429 });
      if (mode === "slow")
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      const system = payload.messages[0].content,
        npc = system.includes('"id":"lin"')
          ? "林疏月"
          : system.includes('"id":"yu"')
            ? "俞照"
            : "沈砚";
      const kind = system.includes("本次类型：ending")
        ? "ending"
        : system.includes("本次类型：during")
          ? "during"
          : "chat";
      const paragraph = `${npc}将灯移到桌边，窗外的风轻轻拂过竹帘。对方没有催你开口，只把还温着的茶留在伸手可及的地方。檐下落了一阵细雨，这片刻的安静也成为你们共同记得的日常。`;
      const text =
        kind === "chat"
          ? paragraph
          : "【模拟接口验收文本，不代表真实AI质量】\n\n" +
            Array.from(
              { length: kind === "ending" ? 24 : 9 },
              (_, i) => `第${i + 1}段。${paragraph}`,
            ).join("\n\n");
      return new Response(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: text } }] }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  },
});
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    reducedMotion: "reduce",
  }),
  page = await context.newPage(),
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
const data = () =>
  page.evaluate(async (k) => {
    const s = JSON.parse(localStorage.getItem(k));
    return await new Promise((resolve, reject) => {
      const open = indexedDB.open("lingtian-companion", 1);
      open.onsuccess = () => {
        const r = open.result
          .transaction("profiles")
          .objectStore("profiles")
          .get(s.companion.profileId);
        r.onsuccess = () => {
          resolve(r.result);
          open.result.close();
        };
        r.onerror = reject;
      };
      open.onerror = reject;
    });
  }, key);
const settle = () =>
  page.waitForFunction(
    () => document.querySelector("#companion-root").dataset.busy !== "true",
  );
const cp = async (id) => {
  await page.locator(`[data-cp="${id}"]`).first().click();
  await settle();
};
const submit = async (name, last = false) => {
  const buttons = page.locator(`[data-cp-form="${name}"] button`);
  await (last ? buttons.last() : buttons.first()).click();
  await settle();
};
const main = (id) => page.locator(`[data-action="${id}"]`).first().click();
let expectedJobs = 0;
const waitJob = async () => {
  expectedJobs++;
  for (let i = 0; i < 80; i++) {
    const d = await data();
    if (
      d?.jobs.length >= expectedJobs &&
      d.jobs.every((j) => j.state !== "pending")
    )
      return;
    await page.waitForTimeout(250);
  }
  throw Error("Companion job did not settle");
};
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
};
const pass = (text) => {
  checks.push(text);
  console.log("PASS", text);
};
async function openNpc(npc = "lin", study = false) {
  await page.locator('[data-tab="people"]').click();
  await page.locator(`[data-person="${npc}"]`).click();
  await main((study ? "study-npc:" : "open-npc:") + npc);
}
try {
  await page.goto(origin);
  await main("gender");
  await page.locator('[data-gender="female"]').click();
  await page.locator("#player-name").fill("青禾");
  await page.locator("#name-form button[type=submit]").click();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  await openNpc();
  await cp("view:config");
  await page.locator('[name="baseUrl"]').fill("https://mock.test/v1");
  await page.locator('[name="model"]').fill("mock-novel");
  await page.locator('[name="key"]').fill("mock-secret");
  await submit("config");
  for (const npc of ["lin", "yu", "shen"]) {
    await cp("npc:" + npc);
    await page
      .locator('[name="message"]')
      .fill("我喜欢听雨。今天想安静坐一会儿。");
    if (npc === "lin") await page.locator('[name="remember"]').check();
    await submit("chat");
    await waitJob();
    assert.ok(
      (await data()).messages.some(
        (m) => m.npcId === npc && m.role === "assistant",
      ),
    );
  }
  await cp("npc:lin");
  await cp("view:memory");
  assert.ok(
    await page
      .locator('[name="memory"]')
      .inputValue()
      .then((t) => t.includes("我喜欢听雨")),
  );
  await cp("npc:yu");
  await cp("view:memory");
  assert.equal(await page.locator('[name="memory"]').inputValue(), "");
  pass(
    "three NPC chats, isolated explicit memories and independent API configuration",
  );
  await cp("view:courses");
  await cp("new-course");
  await page.locator('[name="title"]').fill("408操作系统课程");
  await page
    .locator('[name="url"]')
    .fill("https://www.bilibili.com/video/BVtest?p=12&t=1122");
  await page.locator('[name="position"]').fill("18:42");
  await submit("course");
  const course = (await data()).courses[0];
  assert.equal(course.part, 12);
  assert.ok(
    await page
      .locator(".cp-link")
      .first()
      .getAttribute("href")
      .then((v) => v.includes("p=12") && v.includes("t=1122")),
  );
  await shot("01-course-bookmarks");
  await cp("npc:lin");
  await cp("view:setup");
  await page.locator('[name="course"]').selectOption(course.id);
  await page.locator('[name="duration"]').fill("25");
  await page.locator('[name="scene"]').selectOption("檐下");
  const before = calls;
  await submit("setup", true);
  await page.waitForTimeout(2200);
  assert.equal(calls, before);
  await shot("02-quiet-room");
  await cp("pause");
  const paused = (await data()).sessions.at(-1).elapsedMs;
  await cp("close");
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  await openNpc("yu", true);
  await cp("active-session");
  assert.ok(
    await page
      .locator("#cp-state")
      .textContent()
      .then((t) => t.includes("歇一歇")),
  );
  assert.equal((await data()).sessions.at(-1).elapsedMs, paused);
  await cp("resume");
  assert.ok(
    await page
      .locator(".cp-course-current")
      .textContent()
      .then((t) => t.includes("P12")),
  );
  pass(
    "course part/timestamp preserved across NPC selection; silent session makes zero AI calls; paused timer survives reload",
  );
  await page.locator('[name="message"]').fill("今天药圃里有什么新鲜事？");
  await submit("chat");
  await waitJob();
  assert.ok(
    (await data()).messages.find((m) => m.sessionId && m.role === "assistant")
      .text.length > 600,
  );
  assert.ok(!JSON.stringify(requests.at(-1)).includes("BVtest"));
  assert.ok(!JSON.stringify(requests.at(-1)).includes("408操作系统课程"));
  await shot("03-mid-session-story");
  await cp("finish");
  await cp("request-ending");
  await waitJob();
  await page.waitForFunction(() =>
    document.querySelector("#cp-ending-state")?.textContent?.includes("故事书"),
  );
  assert.equal((await data()).chapters.length, 1);
  await cp("read-session:" + (await data()).sessions.at(-1).id);
  await shot("04-ending-reader");
  await page.locator("#cp-reader").evaluate((el) => {
    el.scrollTop = 500;
  });
  await page.waitForTimeout(400);
  await cp("view:book");
  assert.ok((await data()).chapters[0].readPosition > 0);
  pass(
    "manual mid-session novel, ordered ending chapter, course privacy and saved reading position",
  );
  // Virtual clock for deadline / background / multi-tab tests, no 25-minute wall-clock claim.
  await cp("view:setup");
  await page.locator('[name="duration"]').fill("25");
  await submit("setup", true);
  const newSession = (await data()).sessions.at(-1);
  const priorAffinity = (await state()).affinity.lin ?? 0;
  await cp("close");
  await page.clock.install();
  const other = await context.newPage();
  await other.goto(origin);
  await other.locator('#canvas[data-ready="true"]').waitFor();
  await other.clock.install();
  const beforeEnd = calls;
  await page.clock.fastForward(25 * 60 * 1000 + 2000);
  await other.clock.fastForward(25 * 60 * 1000 + 2000);
  await page.waitForTimeout(2000);
  await waitJob();
  assert.equal(calls, beforeEnd + 1);
  assert.equal((await data()).chapters.length, 2);
  assert.equal((await state()).affinity.lin, priorAffinity + 1);
  await other.close();
  await openNpc("lin", true);
  await cp("view:room");
  await cp("correct-time");
  await page.locator('[name="minutes"]').fill("10");
  await submit("correct");
  assert.equal((await state()).affinity.lin, priorAffinity);
  assert.equal(
    (await data()).sessions.find((s) => s.id === newSession.id).elapsedMs,
    600000,
  );
  pass(
    "virtual deadline finishes quietly, two tabs generate once/reward once, mistaken time correction reverses reward",
  );
  await cp("npc:lin");
  await page.locator('[name="message"]').fill("这句还没写完");
  await page.waitForTimeout(400);
  await cp("close");
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  await openNpc();
  assert.equal(
    await page.locator('[name="message"]').inputValue(),
    "这句还没写完",
  );
  mode = "slow";
  await submit("chat");
  await page.waitForTimeout(300);
  const pending = (await data()).jobs.at(-1);
  await cp("cancel:" + pending.id);
  await waitJob();
  assert.equal((await data()).jobs.at(-1).state, "cancelled");
  const afterCancel = calls;
  await page.waitForTimeout(1200);
  assert.equal(calls, afterCancel);
  mode = "fail";
  await page.locator('[name="message"]').fill("故障测试");
  await submit("chat");
  await waitJob();
  assert.equal((await data()).jobs.at(-1).state, "failed");
  const failedCalls = calls;
  await page.waitForTimeout(1300);
  assert.equal(calls, failedCalls);
  mode = "normal";
  pass(
    "draft persists, cancellation drops incomplete response, HTTP429 never auto-retries",
  );
  for (const [width, height] of [
    [1600, 900],
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await cp("view:setup");
    await shot(`setup-${width}`);
    await cp("view:courses");
    await shot(`courses-${width}`);
    await cp("view:book");
    await cp("read:" + (await data()).chapters[0].id);
    await shot(`reader-${width}`);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  pass(
    "five landscape sizes: setup, course list and long story reader inspected, no horizontal page overflow",
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await cp("close");
  await main("settings");
  const download = page.waitForEvent("download");
  await main("export");
  const exported = await download;
  await exported.saveAs("work/acceptance/v4-complete-export.json");
  const oldProfile = (await state()).companion.profileId;
  await main("close");
  await page
    .locator("#import-file")
    .setInputFiles("work/acceptance/v4-complete-export.json");
  await page.waitForFunction(
    ({ key, old }) =>
      JSON.parse(localStorage.getItem(key)).companion.profileId !== old,
    { key, old: oldProfile },
  );
  assert.equal((await data()).chapters.length, 2);
  assert.equal((await data()).courses[0].part, 12);
  assert.ok((await data()).memories.lin.text.includes("我喜欢听雨"));
  pass(
    "complete game + IndexedDB export/import retains stories, courses and memories under a fresh namespace",
  );
  // Both player genders and explicit relationship gates use a controlled relationship fixture.
  for (const gender of ["female", "male"]) {
    const fixture = newSave(gender, "关系验收");
    fixture.affinity = { lin: 12, yu: 12, shen: 12 };
    fixture.events = [
      "lin",
      "lin-2",
      "lin-3",
      "yu",
      "yu-2",
      "yu-3",
      "shen",
      "shen-2",
      "shen-3",
    ];
    await page.locator("#import-file").setInputFiles({
      name: "relationships.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.waitForFunction(
      ({ key, g }) =>
        JSON.parse(localStorage.getItem(key)).gender === g &&
        JSON.parse(localStorage.getItem(key)).name === "关系验收",
      { key, g: gender },
    );
    await openNpc();
    for (const npc of ["lin", "yu", "shen"]) {
      await cp("npc:" + npc);
      await cp("relationship");
      const allowed = npc !== "lin" || gender === "female";
      assert.equal(
        await page.locator('[data-cp="confirm-romance"]').isEnabled(),
        allowed,
      );
      if (allowed) await cp("confirm-romance");
      await cp("view:setup");
      assert.equal(
        await page.locator('[name="mode"] option[value="dual"]').count(),
        allowed ? 1 : 0,
      );
      assert.equal(
        await page.locator('[name="mode"] option[value="together"]').count(),
        1,
      );
    }
    await cp("close");
  }
  pass(
    "female/male compatibility, all three friendship sessions and explicit romance confirmation",
  );
  // Finish while a slow intermediate chapter is still running: ending must wait and use its completed text.
  await openNpc("yu", true);
  await submit("setup", true);
  mode = "slow";
  const raceStart = calls;
  await page.locator('[name="message"]').fill("山路上有一盏灯坏了吗？");
  await submit("chat");
  await cp("finish");
  await cp("request-ending");
  await page.waitForTimeout(800);
  assert.equal(calls, raceStart + 1);
  mode = "normal";
  for (let i = 0; i < 60; i++) {
    if ((await data()).chapters.length === 1) break;
    await page.waitForTimeout(250);
  }
  assert.equal(calls, raceStart + 2);
  assert.equal((await data()).chapters.length, 1);
  assert.ok(JSON.stringify(requests.at(-1)).includes("第9段"));
  pass(
    "ending requested during an active intermediate reply waits and includes completed scene history",
  );
  await cp("view:book");
  const deleted = (await data()).chapters[0].id;
  await cp("favorite:" + deleted);
  assert.equal((await data()).chapters[0].favorite, true);
  await cp("delete-story:" + deleted);
  assert.equal((await data()).chapters.length, 0);
  await page.waitForTimeout(1500);
  assert.equal((await data()).pendingDeletes.length, 0);
  await cp("view:memory");
  await page.locator('[name="memory"]').fill("可以删除的记忆");
  await submit("memory");
  await cp("delete-memory");
  assert.equal((await data()).memories.yu.text, "");
  await cp("close");
  const beforeInvalid = (await state()).companion.profileId;
  await page.locator("#import-file").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "lingtian-complete",
        game: await state(),
        companion: { schema: 99 },
      }),
    ),
  });
  await page.waitForTimeout(500);
  assert.equal((await state()).companion.profileId, beforeInvalid);
  pass(
    "story favorite/delete, provider deletion receipt, memory deletion and failed import preserve game progress",
  );
  await openNpc("yu", true);
  await page.route("**/api/companion/**", (route) => route.abort());
  const offlineCalls = calls;
  await submit("setup", true);
  await page.waitForTimeout(1100);
  assert.equal(calls, offlineCalls);
  await cp("finish");
  await cp("request-ending");
  await page.waitForTimeout(1800);
  assert.equal((await data()).sessions.at(-1).ending, "failed");
  assert.equal(calls, offlineCalls);
  await page.unroute("**/api/companion/**");
  pass(
    "offline study remains usable and saves an ungenerated ending without model retries",
  );
  await cp("view:courses");
  await cp("new-course");
  await page.locator('[name="title"]').fill("续看测试");
  await page
    .locator('[name="url"]')
    .fill("https://www.bilibili.com/video/BVresume?p=4&t=90");
  await submit("course");
  const resumeCourse = (await data()).courses[0];
  await cp("next-part:" + resumeCourse.id);
  await submit("course");
  assert.ok(
    await page
      .getByRole("link", { name: "继续上次课程" })
      .getAttribute("href")
      .then((v) => v.includes("p=5") && v.includes("t=0")),
  );
  pass(
    "next part starts at zero while preserving original URL; last-course shortcut follows saved progress",
  );
  await cp("close");
  const uncertainFixture = newSave("female", "断线核对");
  await page
    .locator("#import-file")
    .setInputFiles({
      name: "uncertain.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(uncertainFixture)),
    });
  await page.waitForFunction(
    (k) => JSON.parse(localStorage.getItem(k)).name === "断线核对",
    key,
  );
  await openNpc("lin", true);
  await submit("setup", true);
  mode = "slow";
  const unknownCalls = calls;
  await page.locator('[name="message"]').fill("今晚的风真轻。");
  await submit("chat");
  await page.route("**/api/companion/jobs/*", (route) =>
    route.request().method() === "GET" ? route.abort() : route.continue(),
  );
  await cp("finish");
  await cp("request-ending");
  await page.waitForTimeout(2200);
  assert.equal(calls, unknownCalls + 1);
  assert.equal((await data()).jobs[0].uncertain, true);
  assert.equal((await data()).sessions[0].ending, "waiting");
  await page.unroute("**/api/companion/jobs/*");
  mode = "normal";
  await cp("view:config");
  await cp("retry:" + (await data()).jobs[0].id);
  for (let i = 0; i < 60; i++) {
    if ((await data()).chapters.length === 1) break;
    await page.waitForTimeout(250);
  }
  assert.equal((await data()).chapters.length, 1);
  assert.equal(calls, unknownCalls + 2);
  pass(
    "uncertain network result blocks ending until manual same-task recovery; recovery does not duplicate provider call",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "/browser-report.json",
    JSON.stringify(
      { provider: "mock only", checks, errors, calls, virtualClock: true },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
  console.log("BROWSER ERRORS", JSON.stringify(errors));
  console.log(
    "STORED JOBS",
    JSON.stringify(
      (await data())?.jobs.map((j) => ({
        state: j.state,
        error: j.error,
        kind: j.kind,
        npc: j.npcId,
      })),
    ),
  );
  throw e;
} finally {
  await browser.close();
  await app.close();
}
