import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createService } from "../server/index.mjs";
import { fingerprint, similar, validateCandidate } from "../server/quality.mjs";
const make = (stem = "哪一个字段用于标识测试知识点？") => ({
  subject: "data_structures",
  topic_id: "mock",
  difficulty: "basic",
  type: "single_choice",
  stem,
  options: [
    { id: "A", text: "甲" },
    { id: "B", text: "乙" },
    { id: "C", text: "丙" },
    { id: "D", text: "丁" },
  ],
  answer: "A",
  explanation: "甲符合条件，其他选项不成立。",
  knowledge_point: "模拟题，仅测试管线",
  source_note: "",
});
test("schema, canonical option order and near duplicate checks", () => {
  const q = make();
  validateCandidate(q);
  assert.throws(() => validateCandidate({ ...q, answer: "E" }));
  assert.throws(() => validateCandidate({ ...q, reward: 999 }));
  assert.equal(
    fingerprint(q),
    fingerprint({ ...q, options: [...q.options].reverse() }),
  );
  assert.ok(similar(make("长度为 20 的序列"), make("长度为 30 的序列")));
});
test("two batches, blind verification, quarantine, report, cancel and failure", async () => {
  let mode = "normal",
    generation = 0;
  const prompts = [];
  const provider = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    prompts.push(body);
    if (mode === "http") {
      res.writeHead(429);
      res.end("{}");
      return;
    }
    if (mode === "slow") {
      setTimeout(() => {
        if (!res.destroyed) res.end("{}");
      }, 500);
      return;
    }
    let result;
    if (body.messages[0].content.includes("出题者")) {
      generation++;
      result = {
        schema_version: "1.0",
        questions:
          generation === 1
            ? [
                make("关于散列表处理关键字冲突，下列哪一项正确？"),
                { ...make(), options: [] },
              ]
            : [
                make("关于散列表处理关键字冲突，下列哪一项正确？"),
                { ...make("二叉树线索化后，如何识别线索指针？"), answer: "B" },
                make("图的拓扑排序结果存在需要满足什么条件？"),
              ],
      };
    } else if (body.messages[0].content.includes("独立求解")) {
      const blind = JSON.parse(body.messages[1].content);
      assert.equal(blind.answer, undefined);
      assert.equal(blind.explanation, undefined);
      result = { answer: "A", valid: true, reason: "独立求解测试依据" };
    } else result = { valid: true, reason: "解析匹配" };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
    );
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const app = createService({ dbPath: ":memory:", timeoutMs: 120 });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, body) => {
    const r = await fetch(base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json", Origin: base } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  const wait = async () => {
    for (let n = 0; n < 150; n++) {
      const s = (await call("status")).data;
      if (!s.current) return s;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("batch timed out");
  };
  try {
    await call("config", {
      baseUrl: "http://127.0.0.1:" + provider.address().port + "/v1",
      key: "TEST_SECRET_NEVER_PERSIST",
      model: "mock",
      auto: false,
    });
    assert.equal((await call("batches", {})).status, 202);
    let s = await wait();
    assert.equal(s.batches[0].approved, 1);
    assert.equal(s.batches[0].quarantined, 1);
    await call("batches", {});
    s = await wait();
    assert.equal(s.batches[0].approved, 1);
    assert.equal(s.batches[0].quarantined, 2);
    assert.ok(
      prompts
        .filter((p) => p.messages[0].content.includes("出题者"))[1]
        .messages[1].content.includes("散列表"),
    );
    const all = (await call("questions")).data.questions;
    const generated = all.find(
      (q) => q.id.includes("-") && !q.id.match(/^(ds|os|co|cn)-/),
    );
    await call("report", { id: generated.id });
    assert.ok(
      !(await call("questions")).data.questions.some(
        (q) => q.id === generated.id,
      ),
    );
    assert.ok(
      !JSON.stringify((await call("export")).data).includes("TEST_SECRET"),
    );
    assert.ok(!JSON.stringify(s).includes("TEST_SECRET"));
    mode = "slow";
    await call("batches", {});
    await call("cancel", {});
    s = await wait();
    assert.equal(s.batches[0].status, "cancelled");
    assert.equal((await call("batches", {})).status, 400);
    const cross = await fetch(base + "/api/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: "{}",
    });
    assert.equal(cross.status, 403);
  } finally {
    await app.close();
    await new Promise((r) => provider.close(r));
  }
});
test("provider failure stops auto mode and seed pool remains available", async () => {
  const provider = http.createServer((req, res) => {
    res.writeHead(429);
    res.end("{}");
  });
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const app = createService({ dbPath: ":memory:" });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (p, b) => {
    const r = await fetch(base + "/api/" + p, {
      method: b ? "POST" : "GET",
      headers: b ? { "Content-Type": "application/json", Origin: base } : {},
      body: b ? JSON.stringify(b) : undefined,
    });
    return r.json();
  };
  try {
    await call("config", {
      baseUrl: "http://127.0.0.1:" + provider.address().port,
      key: "fake",
      model: "fake",
      auto: true,
    });
    await call("batches", {});
    await new Promise((r) => setTimeout(r, 150));
    const s = await call("status");
    assert.equal(s.auto, false);
    assert.equal(s.batches[0].status, "failed");
    assert.equal((await call("questions")).questions.length, 24);
  } finally {
    await app.close();
    await new Promise((r) => provider.close(r));
  }
});
