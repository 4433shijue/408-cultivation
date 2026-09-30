export type Config = {
  baseUrl: string;
  model: string;
  key: string;
  auto: boolean;
};
export const emptyConfig = (): Config => ({
  baseUrl: "",
  model: "",
  key: "",
  auto: false,
});
export function parseConfig(input: any): Config {
  if (input.clear) return emptyConfig();
  const u = new URL(input.baseUrl);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw Error("网页版接口需使用无账号密码、查询参数的 HTTPS 地址");
  if (
    typeof input.model !== "string" ||
    !input.model.trim() ||
    input.model.length > 120 ||
    typeof input.key !== "string" ||
    !input.key.trim()
  )
    throw Error("请完整填写模型和密钥");
  return {
    baseUrl: u.href.replace(/\/$/, ""),
    model: input.model.trim(),
    key: input.key.trim(),
    auto: input.auto === true,
  };
}
export async function completion(
  config: Config,
  messages: any[],
  signal: AbortSignal,
  {
    json = false,
    maxTokens = 10000,
    onPartial,
  }: {
    json?: boolean;
    maxTokens?: number;
    onPartial?: (s: string) => Promise<void>;
  } = {},
) {
  if (!config.key) throw Error("请先填写自己的文本接口与密钥");
  const response = await fetch(config.baseUrl + "/chat/completions", {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.key,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_completion_tokens: maxTokens,
      stream: !json,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
  });
  if (!response.ok)
    throw Error("提供方返回 HTTP " + response.status + "，请稍后手动重试");
  let text = "";
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      last = 0,
      finished = false;
    const line = (s: string) => {
      if (!s.startsWith("data:")) return;
      const value = s.slice(5).trim();
      if (value === "[DONE]") {
        finished = true;
        return;
      }
      if (!value) return;
      const data = JSON.parse(value);
      if (data.error) throw Error("提供方响应异常");
      const choice = data.choices?.[0];
      if (choice?.finish_reason) finished = true;
      text += choice?.delta?.content ?? "";
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) line(buffer.trim());
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const s of lines) line(s);
      if (text.length > 24000) throw Error("回复超出长度限制");
      if (onPartial && Date.now() - last > 350) {
        await onPartial(text);
        last = Date.now();
      }
    }
    if (!finished) throw Error("回复传输未完整结束，残缺内容未保存");
  } else {
    const raw = await response.text();
    if (raw.length > 500000) throw Error("回复超出长度限制");
    const data = JSON.parse(raw);
    text = data.choices?.[0]?.message?.content ?? "";
  }
  signal.throwIfAborted();
  if (
    typeof text !== "string" ||
    text.trim().length < 2 ||
    text.length > (json ? 100000 : 24000)
  )
    throw Error("提供方未返回有效正文");
  return json ? JSON.parse(text) : text.trim();
}
export function publicError(error: any) {
  return /^(提供方|回复|请先)/.test(String(error?.message))
    ? String(error.message)
    : error?.name === "TimeoutError"
      ? "生成超时，请手动重试"
      : "连接或响应失败，请检查网络和接口的跨域（CORS）支持；未自动重试。";
}
