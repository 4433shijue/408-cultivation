import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createCompanion, buildPrompt } from "../server/companion.mjs";
const body = (id = "job") => ({
  id,
  profileId: "profile",
  npcId: "lin",
  kind: "chat",
  text: "今天想安静坐一会儿。",
  mode: "together",
  length: "standard",
  player: {
    name: "禾",
    gender: "female",
    affinity: 3,
    events: [],
    romance: false,
  },
  history: [],
});
const config = {
  baseUrl: "https://example.test/v1",
  model: "mock",
  key: "private-test-only",
};
const wait = async (service, id = "job") => {
  for (let i = 0; i < 200; i++) {
    const r = await service.route(
      "GET",
      "/jobs/" + id,
      {},
      new URLSearchParams({ profileId: "profile" }),
    );
    if (!["running", "queued"].includes(r.status)) return r;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("timeout");
};
test("server persona boundaries, course exclusion, same-id dedupe and successful SSE", async () => {
  let calls = 0,
    payload;
  const svc = createCompanion({
    dbPath: ":memory:",
    fetchImpl: async (_u, options) => {
      calls++;
      payload = JSON.parse(options.body);
      return new Response(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: "疏月把茶盏放到桌角。\n“坐吧，药册我自己看就好。”",
                },
              },
            ],
          }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  try {
    await svc.route("POST", "/config", config);
    const input = {
      ...body(),
      courseUrl: "https://private-course.test",
      feedback: "PRIVATE_FEEDBACK",
    };
    await svc.route("POST", "/jobs", input);
    await svc.route("POST", "/jobs", input);
    assert.equal((await wait(svc)).status, "complete");
    assert.equal(calls, 1);
    const prompt = JSON.stringify(payload.messages);
    assert.ok(prompt.includes("lesbian"));
    assert.ok(!prompt.includes("PRIVATE_FEEDBACK"));
    assert.ok(!prompt.includes("private-course"));
    assert.ok(!JSON.stringify(svc.status()).includes(config.key));
    await assert.rejects(() =>
      svc.route("POST", "/jobs", { ...input, text: "different" }),
    );
    await assert.rejects(() =>
      svc.route(
        "GET",
        "/jobs/job",
        {},
        new URLSearchParams({ profileId: "other" }),
      ),
    );
  } finally {
    await svc.close();
  }
});
test("all three personas differ and dual requires eligible relationship", () => {
  const prompts = ["lin", "yu", "shen"].map(
    (npcId) => buildPrompt({ ...body(), npcId })[0].content,
  );
  assert.ok(prompts[0].includes("外柔内硬"));
  assert.ok(prompts[1].includes("外向爽快"));
  assert.ok(prompts[2].includes("克制慢热"));
  assert.throws(() => buildPrompt({ ...body(), mode: "dual" }));
  assert.throws(() =>
    buildPrompt({
      ...body(),
      mode: "dual",
      player: {
        gender: "male",
        affinity: 15,
        romance: true,
        events: ["lin", "lin-2", "lin-3"],
      },
    }),
  );
  assert.ok(
    buildPrompt({
      ...body(),
      npcId: "yu",
      mode: "dual",
      player: {
        gender: "male",
        affinity: 15,
        romance: true,
        events: ["yu", "yu-2", "yu-3"],
      },
    }),
  );
});
test("provider HTTP429 and malformed content fail once without retry or secret echo", async () => {
  for (const response of [
    new Response("PRIVATE PROVIDER BODY", { status: 429 }),
    Response.json({ unexpected: "private-test-only" }),
  ]) {
    let calls = 0;
    const svc = createCompanion({
      dbPath: ":memory:",
      fetchImpl: async () => {
        calls++;
        return response;
      },
    });
    try {
      await svc.route("POST", "/config", config);
      await svc.route("POST", "/jobs", body());
      const result = await wait(svc);
      assert.equal(result.status, "failed");
      assert.equal(calls, 1);
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
      assert.ok(!JSON.stringify(result).includes(config.key));
    } finally {
      await svc.close();
    }
  }
});
test("one provider job at a time; queued cancellation and active cancellation discard partial text", async () => {
  let calls = 0;
  const svc = createCompanion({
    dbPath: ":memory:",
    fetchImpl: async (_u, { signal }) => {
      calls++;
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Error("aborted")), {
          once: true,
        }),
      );
    },
  });
  try {
    await svc.route("POST", "/config", config);
    await svc.route("POST", "/jobs", body("a"));
    await svc.route("POST", "/jobs", body("b"));
    assert.equal(calls, 1);
    await svc.route("POST", "/cancel", { id: "b", profileId: "profile" });
    await svc.route("POST", "/cancel", { id: "a", profileId: "profile" });
    assert.equal((await wait(svc, "a")).status, "cancelled");
    assert.equal((await wait(svc, "b")).text, "");
    assert.equal(calls, 1);
  } finally {
    await svc.close();
  }
});
test("timeout releases generation slot without automatic retry", async () => {
  const svc = createCompanion({
    dbPath: ":memory:",
    timeoutMs: 30,
    fetchImpl: async (_u, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
  });
  try {
    await svc.route("POST", "/config", config);
    await svc.route("POST", "/jobs", body());
    assert.equal((await wait(svc)).status, "failed");
    assert.equal(svc.status().running, null);
  } finally {
    await svc.close();
  }
});
test("completed jobs persist across service restart and never call provider again", async () => {
  mkdirSync("work/companion-tests", { recursive: true });
  const path = `work/companion-tests/${crypto.randomUUID()}.sqlite`;
  let calls = 0;
  let svc = createCompanion({
    dbPath: path,
    fetchImpl: async () => {
      calls++;
      return Response.json({
        choices: [{ message: { content: "这段相伴的故事已经写好。" } }],
      });
    },
  });
  await svc.route("POST", "/config", config);
  await svc.route("POST", "/jobs", body());
  await wait(svc);
  await svc.close();
  svc = createCompanion({
    dbPath: path,
    fetchImpl: async () => {
      throw Error("must not call");
    },
  });
  try {
    assert.equal((await svc.route("POST", "/jobs", body())).status, "complete");
    assert.equal(calls, 1);
    assert.equal(svc.status().configured, false);
  } finally {
    await svc.close();
  }
});

test("forget only removes terminal jobs belonging to the requested profile", async () => {
  const svc = createCompanion({
    dbPath: ":memory:",
    fetchImpl: async () =>
      Response.json({
        choices: [{ message: { content: "已完成且可以删除的故事。" } }],
      }),
  });
  try {
    await svc.route("POST", "/config", config);
    await svc.route("POST", "/jobs", body());
    await wait(svc);
    await svc.route("POST", "/forget", { profileId: "other", ids: ["job"] });
    assert.equal((await wait(svc)).status, "complete");
    await svc.route("POST", "/forget", { profileId: "profile", ids: ["job"] });
    await assert.rejects(() =>
      svc.route(
        "GET",
        "/jobs/job",
        {},
        new URLSearchParams({ profileId: "profile" }),
      ),
    );
  } finally {
    await svc.close();
  }
});
