import profiles from "../../shared/npcs.json";
import { buildPrompt } from "../../shared/companion-prompt.mjs";
import { get, put, remove, digest } from "./storage";
import {
  completion,
  emptyConfig,
  parseConfig,
  publicError,
  type Config,
} from "./provider";
let config = emptyConfig(),
  calls = 0;
const active = new Map<string, AbortController>();
const channel = new BroadcastChannel("lingtian-web-generation");
const lockName = (id: string) => "lingtian-web-job-" + id;
const pending = (s: string) => ["running", "queued"].includes(s);
channel.onmessage = (e) => {
  if (typeof e.data?.cancel === "string") active.get(e.data.cancel)?.abort();
};
const publicJob = (j: any) => ({
  id: j.id,
  npcId: j.npcId,
  kind: j.kind,
  status: j.status,
  text: j.text,
  error: j.error,
});
async function lookup(id: string, profileId: string) {
  const j = await get("jobs", id);
  if (!j || j.profileId !== profileId) throw Error("未找到该存档的任务");
  if (pending(j.status) && Date.now() - j.updatedAt > 3000) {
    const state = await navigator.locks.query();
    if (
      ![...(state.held ?? []), ...(state.pending ?? [])].some(
        (l) => l.name === lockName(id),
      )
    ) {
      j.status = "interrupted";
      j.text = "";
      j.error =
        "生成页面已关闭或刷新，请手动重试；此前请求可能已由提供方处理。";
      await put("jobs", j);
    }
  }
  return j;
}
async function run(
  id: string,
  messages: any[],
  snapshot: Config,
  kind: string,
) {
  const controller = new AbortController();
  active.set(id, controller);
  try {
    await navigator.locks.request(
      lockName(id),
      { signal: controller.signal },
      () =>
        navigator.locks.request(
          "lingtian-web-companion-generation",
          { signal: controller.signal },
          async () => {
            let j = await get("jobs", id);
            if (!j || !pending(j.status)) return;
            j.status = "running";
            j.updatedAt = Date.now();
            await put("jobs", j);
            calls++;
            const text = await completion(
              snapshot,
              messages,
              controller.signal,
              {
                maxTokens: kind === "chat" ? 1800 : 10000,
                onPartial: async (text) => {
                  j = await get("jobs", id);
                  if (j?.status === "running") {
                    j.text = text;
                    j.updatedAt = Date.now();
                    await put("jobs", j);
                  }
                },
              },
            );
            j = await get("jobs", id);
            if (j && j.status !== "cancelled") {
              j.status = "complete";
              j.text = text;
              j.error = "";
              j.updatedAt = Date.now();
              await put("jobs", j);
            }
          },
        ),
    );
  } catch (error) {
    const j = await get("jobs", id);
    if (j) {
      j.status = controller.signal.aborted ? "cancelled" : "failed";
      j.text = "";
      j.error = controller.signal.aborted
        ? "已取消，残缺剧情未保存"
        : publicError(error);
      j.updatedAt = Date.now();
      await put("jobs", j);
    }
  } finally {
    active.delete(id);
  }
}
export async function companionApi(
  path: string,
  body: any,
  questionConfig: () => Config,
): Promise<any> {
  const url = new URL(path, "https://local.invalid/"),
    p = url.pathname;
  const status = () => ({
    configured: !!config.key,
    baseUrl: config.baseUrl,
    model: config.model,
    calls,
    running: [...active.keys()][0] ?? null,
  });
  if (p === "/status") return status();
  if (p === "/config") {
    if (active.size) throw Error("请等待当前生成结束或取消");
    config = parseConfig(body.copyQuestion ? questionConfig() : body);
    return status();
  }
  if (p === "/jobs" || p === "/test") {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(body.id) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(body.profileId)
    )
      throw Error("任务标识无效");
    const hash = await digest(JSON.stringify(body));
    return navigator.locks.request(
      "lingtian-web-submit-" + body.id,
      async () => {
        const old = await get("jobs", body.id);
        if (old) {
          if (old.profileId !== body.profileId || old.hash !== hash)
            throw Error("任务标识与原请求不一致");
          return publicJob(await lookup(body.id, body.profileId));
        }
        if (!config.key) throw Error("请先在道友设置填写自己的文本接口");
        if (active.size >= 10) throw Error("待生成任务过多");
        const input =
          p === "/test"
            ? {
                ...body,
                kind: "test",
                npcId: "lin",
                player: { gender: "female", name: "访客" },
                text: "请用一句话招呼来访的朋友。",
              }
            : body;
        const messages = buildPrompt(input, profiles),
          job = {
            id: body.id,
            profileId: body.profileId,
            hash,
            npcId: input.npcId,
            kind: input.kind,
            status: "queued",
            text: "",
            error: "",
            updatedAt: Date.now(),
          };
        await put("jobs", job);
        void run(job.id, messages, { ...config }, job.kind);
        return publicJob(job);
      },
    );
  }
  if (p.startsWith("/jobs/"))
    return publicJob(
      await lookup(p.slice(6), url.searchParams.get("profileId") ?? ""),
    );
  if (p === "/cancel") {
    const j = await lookup(body.id, body.profileId);
    if (pending(j.status)) {
      j.status = "cancelled";
      j.text = "";
      j.error = "已取消";
      await put("jobs", j);
      active.get(j.id)?.abort();
      channel.postMessage({ cancel: j.id });
    }
    return { ok: true };
  }
  if (p === "/forget") {
    if (!Array.isArray(body.ids) || body.ids.length > 100)
      throw Error("删除请求无效");
    for (const id of body.ids) {
      const j = await get("jobs", id);
      if (j?.profileId === body.profileId && !pending(j.status))
        await remove("jobs", id);
    }
    return { ok: true };
  }
  throw Error("道友接口不存在");
}
