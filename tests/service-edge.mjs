import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createService } from "../server/index.mjs";
async function fixture(handler, timeoutMs = 50) {
  const provider = http.createServer(handler);
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  const app = createService({ dbPath: ":memory:", timeoutMs });
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
  await call("config", {
    baseUrl: "http://127.0.0.1:" + provider.address().port,
    model: "mock",
    key: "test",
    auto: true,
  });
  return {
    app,
    provider,
    call,
    close: async () => {
      await app.close();
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
    },
  };
}
test("timeout fails visibly and keeps seeds intact", async () => {
  const f = await fixture(() => {});
  try {
    await f.call("batches", {});
    await new Promise((r) => setTimeout(r, 180));
    const s = await f.call("status");
    assert.equal(s.batches[0].status, "failed");
    assert.equal(s.auto, false);
    assert.equal(s.available, 24);
    assert.match(s.batches[0].error, /超时/);
  } finally {
    await f.close();
  }
});
test("malformed JSON never creates approved questions", async () => {
  const f = await fixture((req, res) => res.end("{not json"));
  try {
    await f.call("batches", {});
    await new Promise((r) => setTimeout(r, 100));
    const s = await f.call("status");
    assert.equal(s.batches[0].status, "failed");
    assert.equal(s.available, 24);
  } finally {
    await f.close();
  }
});
test("auto generation does not run above low-stock threshold", async () => {
  let calls = 0;
  const f = await fixture((req, res) => {
    calls++;
    res.end("{}");
  });
  try {
    await f.call("auto", { answered: [] });
    assert.equal(calls, 0);
    assert.equal((await f.call("status")).used, 0);
  } finally {
    await f.close();
  }
});
