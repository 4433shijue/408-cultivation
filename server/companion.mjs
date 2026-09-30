import { buildPrompt as buildSharedPrompt } from "../shared/companion-prompt.mjs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
const profiles = JSON.parse(
  readFileSync(new URL("../shared/npcs.json", import.meta.url), "utf8"),
);
const validId = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
export const buildPrompt = (input) => buildSharedPrompt(input, profiles);
export function createCompanion({
  dbPath,
  timeoutMs = 180000,
  fetchImpl = fetch,
  questionConfig = () => ({}),
}) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS companion_jobs(id TEXT PRIMARY KEY,profile TEXT,npc TEXT,kind TEXT,hash TEXT,status TEXT,text TEXT,error TEXT,created INTEGER); UPDATE companion_jobs SET status='interrupted',text='',error='服务重启，请手动重试；此前请求可能已由提供方处理。' WHERE status IN ('queued','running');",
  );
  let config = { baseUrl: "", model: "", key: "" },
    current = null,
    closed = false,
    calls = 0;
  const queue = [];
  const row = (id) =>
    db.prepare("SELECT * FROM companion_jobs WHERE id=?").get(id);
  const publicJob = (r) =>
    r
      ? {
          id: r.id,
          status: r.status,
          text: r.text,
          error: r.error,
          kind: r.kind,
          npcId: r.npc,
        }
      : null;
  const status = () => ({
    configured: !!config.key,
    baseUrl: config.baseUrl,
    model: config.model,
    calls,
    running: current?.id ?? null,
    queued: queue.length,
  });
  const update = (id, state, text = "", error = "") =>
    db
      .prepare("UPDATE companion_jobs SET status=?,text=?,error=? WHERE id=?")
      .run(state, text, error, id);
  async function runNext() {
    if (current || closed) return;
    const job = queue.shift();
    if (!job) return;
    if (row(job.id)?.status !== "queued") {
      void runNext();
      return;
    }
    const controller = new AbortController();
    current = { id: job.id, controller };
    update(job.id, "running");
    let text = "",
      lastWrite = 0;
    try {
      calls++;
      const response = await fetchImpl(
        job.config.baseUrl + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + job.config.key,
          },
          body: JSON.stringify({
            model: job.config.model,
            messages: job.messages,
            stream: true,
            max_completion_tokens: job.kind === "chat" ? 1800 : 10000,
          }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        },
      );
      if (!response.ok)
        throw Error(
          `提供方返回 HTTP ${response.status}，请检查配置或稍后手动重试。`,
        );
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const part = line.slice(5).trim();
            if (!part || part === "[DONE]") continue;
            const data = JSON.parse(part);
            text += data.choices?.[0]?.delta?.content ?? "";
          }
          if (text.length > 24000)
            throw Error("回复超出长度上限，本次内容未写入故事。");
          if (Date.now() - lastWrite > 350) {
            update(job.id, "running", text);
            lastWrite = Date.now();
          }
        }
      } else {
        const data = await response.json();
        text = data.choices?.[0]?.message?.content ?? "";
      }
      if (controller.signal.aborted) throw Error("cancelled");
      if (
        typeof text !== "string" ||
        text.trim().length < 5 ||
        text.length > 24000
      )
        throw Error("提供方未返回有效正文，请手动重试。");
      update(job.id, "complete", text.trim());
    } catch (e) {
      update(
        job.id,
        controller.signal.aborted ? "cancelled" : "failed",
        "",
        controller.signal.aborted
          ? "已取消，未完成的内容不会进入人物记忆。"
          : e?.name === "TimeoutError"
            ? "生成超时，请手动重试。"
            : String(e.message).startsWith("提供方") ||
                String(e.message).startsWith("回复")
              ? e.message
              : "连接或响应异常，请检查接口后手动重试。",
      );
    } finally {
      current = null;
      void runNext();
    }
  }
  async function route(method, path, body, params) {
    if (method === "GET" && path === "/status") return status();
    if (method === "POST" && path === "/config") {
      if (current || queue.length)
        throw Error("请等待生成结束或取消任务后再修改配置");
      if (body.clear) {
        config = { baseUrl: "", model: "", key: "" };
        return status();
      }
      const next = body.copyQuestion ? questionConfig() : body;
      const url = new URL(next.baseUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        typeof next.model !== "string" ||
        !next.model.trim() ||
        next.model.length > 120 ||
        typeof next.key !== "string" ||
        !next.key.trim()
      )
        throw Error("请完整填写有效接口、模型与密钥");
      config = {
        baseUrl: next.baseUrl.replace(/\/$/, ""),
        model: next.model.trim(),
        key: next.key.trim(),
      };
      return status();
    }
    if (method === "POST" && (path === "/jobs" || path === "/test")) {
      if (!validId(body.id) || !validId(body.profileId))
        throw Error("任务标识无效");
      const hash = createHash("sha256")
          .update(JSON.stringify(body))
          .digest("hex"),
        existing = row(body.id);
      if (existing) {
        if (existing.profile !== body.profileId || existing.hash !== hash)
          throw Error("任务标识与原请求不一致");
        return publicJob(existing);
      }
      if (!config.key) throw Error("请先在道友设置中配置文本接口");
      if (queue.length >= 10) throw Error("等待任务过多，请稍后再试");
      const payload =
        path === "/test"
          ? {
              ...body,
              kind: "test",
              npcId: "lin",
              player: { gender: "female", name: "访客" },
              text: "请用一句话招呼来访的朋友。",
            }
          : body;
      const messages = buildPrompt(payload);
      db.prepare("INSERT INTO companion_jobs VALUES(?,?,?,?,?,?,?,?,?)").run(
        body.id,
        body.profileId,
        payload.npcId,
        payload.kind,
        hash,
        "queued",
        "",
        "",
        Date.now(),
      );
      queue.push({
        id: body.id,
        messages,
        config: { ...config },
        kind: payload.kind,
      });
      void runNext();
      return publicJob(row(body.id));
    }
    if (method === "GET" && path.startsWith("/jobs/")) {
      const r = row(path.slice(6));
      if (!r || r.profile !== params.get("profileId"))
        throw Error("未找到该存档的任务");
      return publicJob(r);
    }
    if (method === "POST" && path === "/cancel") {
      const r = row(body.id);
      if (!r || r.profile !== body.profileId) throw Error("任务不存在");
      if (current?.id === body.id) current.controller.abort();
      else if (r.status === "queued")
        update(body.id, "cancelled", "", "已取消");
      return { ok: true };
    }
    if (method === "POST" && path === "/forget") {
      if (
        !validId(body.profileId) ||
        !Array.isArray(body.ids) ||
        body.ids.length > 100 ||
        !body.ids.every(validId)
      )
        throw Error("删除请求无效");
      for (const id of body.ids) {
        const r = row(id);
        if (
          r &&
          r.profile === body.profileId &&
          !["queued", "running"].includes(r.status)
        )
          db.prepare("DELETE FROM companion_jobs WHERE id=? AND profile=?").run(
            id,
            body.profileId,
          );
      }
      return { ok: true };
    }
    throw Error("道友接口不存在");
  }
  return {
    route,
    status,
    close: async () => {
      closed = true;
      current?.controller.abort();
      while (current) await new Promise((r) => setTimeout(r, 10));
      db.close();
    },
  };
}
