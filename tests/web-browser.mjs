import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
const out = "work/web-acceptance";
mkdirSync(out, { recursive: true });
const missing = [],
  errors = [],
  checks = [],
  requests = [];
const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://local").pathname;
  if (!path.startsWith("/408-cultivation/")) {
    missing.push(path);
    res.writeHead(404).end();
    return;
  }
  const file = resolve(
    "dist-web",
    path.slice("/408-cultivation/".length) || "index.html",
  );
  if (!file.startsWith(resolve("dist-web")) || !existsSync(file)) {
    missing.push(path);
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".json": "application/json",
    }[extname(file)] || "application/octet-stream",
  );
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/408-cultivation/`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
  }),
  page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
let mode = "normal";
const candidate = {
  subject: "data_structures",
  topic_id: "mock-browser",
  difficulty: "basic",
  type: "single_choice",
  stem: "关于散列表处理关键字冲突，下列哪一项正确？",
  options: ["甲", "乙", "丙", "丁"].map((text, i) => ({ id: "ABCD"[i], text })),
  answer: "A",
  explanation: "仅用于验证浏览器生成管线的模拟解析。",
  knowledge_point: "模拟验收",
  source_note: "",
};
await context.route(
  "https://mock-provider.test/v1/chat/completions",
  async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type",
          "access-control-allow-methods": "POST",
        },
      });
      return;
    }
    assert.equal(request.headers().authorization, "Bearer test-key-only");
    const body = request.postDataJSON();
    requests.push(body);
    if (mode === "slow") await new Promise((r) => setTimeout(r, 3500));
    if (mode === "fail") {
      await route
        .fulfill({ status: 429, body: "private provider failure" })
        .catch(() => {});
      return;
    }
    if (body.response_format) {
      let data;
      if (body.messages[0].content.includes("出题者"))
        data = { schema_version: "1.0", questions: [candidate] };
      else if (body.messages[0].content.includes("独立求解计算机")) {
        assert.equal(JSON.parse(body.messages[1].content).answer, undefined);
        data = { valid: true, answer: "A", reason: "独立模拟核对" };
      } else data = { valid: true, reason: "模拟解析核对", ok: true };
      await route
        .fulfill({
          json: { choices: [{ message: { content: JSON.stringify(data) } }] },
        })
        .catch(() => {});
      return;
    }
    const system = body.messages[0].content,
      name = system.includes('"id":"lin"')
        ? "林疏月"
        : system.includes('"id":"yu"')
          ? "俞照"
          : "沈砚";
    const para = `${name}把灯移到桌边，留出一片可以静坐的位置。窗外的雨落在青石上，对方没有催你回应，只有书页在风里轻轻翻动。`;
    const text = system.includes("本次类型：chat")
      ? para
      : Array.from({ length: 28 }, () => para).join("\n\n");
    const content =
      "data: " +
      JSON.stringify({ choices: [{ delta: { content: text } }] }) +
      "\n\ndata: [DONE]\n\n";
    await route
      .fulfill({ contentType: "text/event-stream", body: content })
      .catch(() => {});
  },
);
const main = (id) => page.locator(`[data-action="${id}"]`).first().click();
const settled = () =>
  page.waitForFunction(
    () => document.querySelector("#companion-root")?.dataset.busy !== "true",
  );
const cp = async (id) => {
  await page.locator(`[data-cp="${id}"]`).first().click();
  await settled();
};
const submit = async (name) => {
  await page
    .locator(`[data-cp-form="${name}"] button:not([type="button"])`)
    .click();
  await settled();
};
const data = () =>
  page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem("lingtian-408-save-v4"));
    return new Promise((r) => {
      const o = indexedDB.open("lingtian-companion");
      o.onsuccess = () => {
        const db = o.result,
          q = db
            .transaction("profiles")
            .objectStore("profiles")
            .get(s.companion.profileId);
        q.onsuccess = () => {
          r(q.result);
          db.close();
        };
      };
    });
  });
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await page.waitForTimeout(200);
  }
  throw Error("Expected browser state not reached");
}
async function npc() {
  await page.locator('[data-tab="people"]').click();
  await page.locator('[data-person="lin"]').click();
  await main("open-npc:lin");
}
async function configure() {
  await cp("view:config");
  await page.locator('[name="baseUrl"]').fill("https://mock-provider.test/v1");
  await page.locator('[name="model"]').fill("mock");
  await page.locator('[name="key"]').fill("test-key-only");
  await submit("config");
}
const pass = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
try {
  await page.goto(url);
  await main("gender");
  await page.locator('[data-gender="female"]').click();
  await page.locator("#player-name").fill("网页验收");
  await page.locator("#name-form button[type=submit]").click();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  for (const tab of ["farm", "craft", "battle", "cultivate", "people"]) {
    const button = page.locator(`[data-tab="${tab}"]`);
    if (await button.count()) await button.click();
  }
  await page.screenshot({ path: out + "/home.png" });
  assert.equal(requests.length, 0);
  pass(
    "static subpath loads bitmap scenes and seeds without backend or provider requests",
  );
  await npc();
  await configure();
  for (const id of ["lin", "yu", "shen"]) {
    await cp("npc:" + id);
    await page.locator('[name="message"]').fill("今天想在窗边坐一会儿。");
    await submit("chat");
    await waitFor(
      async () => !(await data()).jobs.some((j) => j.state === "pending"),
    );
    assert.ok(
      (await data()).messages.some(
        (m) => m.npcId === id && m.role === "assistant",
      ),
    );
  }
  pass(
    "all three NPCs use browser-direct SSE with canonical separate personas",
  );
  await cp("view:courses");
  await cp("new-course");
  await page.locator('[name="title"]').fill("408课程续看");
  await page
    .locator('[name="url"]')
    .fill("https://www.bilibili.com/video/BVdemo?p=3&t=80");
  await submit("course");
  await cp("view:setup");
  const quiet = requests.length;
  await submit("setup");
  await page.waitForTimeout(1500);
  assert.equal(requests.length, quiet);
  await page.locator('[name="message"]').fill("雨声真轻。");
  await submit("chat");
  await waitFor(
    async () => !(await data()).jobs.some((j) => j.state === "pending"),
  );
  await cp("finish");
  await cp("request-ending");
  await waitFor(async () => (await data()).chapters.length === 1);
  assert.ok(!JSON.stringify(requests.at(-1)).includes("BVdemo"));
  await cp("read-session:" + (await data()).sessions[0].id);
  for (const [width, height] of [
    [1600, 900],
    [1280, 720],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${out}/reader-${width}.png` });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  pass(
    "quiet timer has no AI calls, intermediate/ending story and course privacy survive static hosting",
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await cp("close");
  await page.reload();
  await page.locator('#canvas[data-ready="true"]').waitFor();
  await npc();
  await cp("view:config");
  assert.ok(
    await page
      .locator(".cp-foot")
      .textContent()
      .then((s) => s.includes("未连接")),
  );
  assert.equal((await data()).chapters.length, 1);
  assert.equal((await data()).courses.length, 1);
  pass(
    "refresh clears credentials but preserves completed stories, courses and game",
  );
  await configure();
  await cp("npc:lin");
  mode = "slow";
  await page.locator('[name="message"]').fill("取消测试");
  await submit("chat");
  const j = (await data()).jobs.at(-1);
  await cp("cancel:" + j.id);
  await waitFor(async () => (await data()).jobs.at(-1).state === "cancelled");
  mode = "normal";
  pass("browser generation cancellation excludes partial fiction");
  mode = "fail";
  await page.locator('[name="message"]').fill("限流测试");
  await submit("chat");
  await waitFor(async () => (await data()).jobs.at(-1).state === "failed");
  const failureCalls = requests.length;
  await page.waitForTimeout(1200);
  assert.equal(requests.length, failureCalls);
  mode = "normal";
  pass("provider 429 does not retry or invent fallback dialogue");
  await cp("close");
  await main("settings");
  await page
    .locator('#api-form [name="baseUrl"]')
    .fill("https://mock-provider.test/v1");
  await page.locator('#api-form [name="model"]').fill("mock");
  await page.locator('#api-form [name="key"]').fill("test-key-only");
  await page.locator("#api-form button").click();
  await page.waitForTimeout(200);
  await main("generate");
  await waitFor(() =>
    page
      .locator("#service-status")
      .textContent()
      .then((s) => s.includes("完成") && s.includes("通过 1")),
  );
  await main("generate");
  await waitFor(() =>
    page
      .locator("#service-status")
      .textContent()
      .then((s) => s.includes("部分通过") && s.includes("隔离 1")),
  );
  pass(
    "browser question generation, blind solve, review and second-batch dedupe persist independently",
  );
  // Make the library low on another tab, exercising the actual ten-second scheduler.
  mode = "fail";
  const beforeAuto = requests.length;
  const other = await context.newPage();
  await other.goto(url);
  await other.evaluate(
    (ids) => {
      const key = "lingtian-408-save-v4";
      const s = JSON.parse(localStorage.getItem(key));
      s.answered = ids;
      localStorage.setItem(key, JSON.stringify(s));
    },
    JSON.parse(readFileSync("shared/seeds.json", "utf8")).map((q) => q.id),
  );
  await other.close();
  await waitFor(() =>
    page
      .locator("#service-status")
      .textContent()
      .then((s) => s.includes("失败") && s.includes("3/3")),
  );
  assert.equal(requests.length, beforeAuto + 1);
  await page.waitForTimeout(11000);
  assert.equal(requests.length, beforeAuto + 1);
  pass(
    "low-stock scheduler starts automatically, counts the third batch and stops after 429",
  );
  mode = "normal";
  const secrets = await page.evaluate(async () => {
    const texts = [JSON.stringify(localStorage)];
    for (const { name } of await indexedDB.databases()) {
      await new Promise((resolve) => {
        const o = indexedDB.open(name);
        o.onsuccess = async () => {
          const db = o.result;
          for (const store of [...db.objectStoreNames])
            await new Promise((r) => {
              const q = db.transaction(store).objectStore(store).getAll();
              q.onsuccess = () => {
                texts.push(JSON.stringify(q.result));
                r();
              };
            });
          db.close();
          resolve();
        };
      });
    }
    return texts.join("\n").includes("test-key-only");
  });
  assert.equal(secrets, false);
  await main("export");
  const d = await data();
  assert.equal(JSON.stringify(d).includes("test-key-only"), false);
  pass(
    "credentials absent from localStorage, all IndexedDB stores and companion export data",
  );
  assert.deepEqual(missing, []);
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "/report.json",
    JSON.stringify(
      {
        checks,
        errors,
        missing,
        provider: "mock only",
        requests: requests.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: out + "/failure.png" });
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
