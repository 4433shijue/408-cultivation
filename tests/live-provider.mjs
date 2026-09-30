// Opt-in live acceptance: uses existing environment credentials, never writes them.
import { createService } from "../server/index.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL)
  throw Error("Existing environment configuration required");
const app = createService({
  dbPath: "work/live-questions.sqlite",
  timeoutMs: 90000,
});
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + app.server.address().port;
const call = async (path, body) => {
  const r = await fetch(base + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json", Origin: base } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  return data;
};
try {
  await call("config", {
    baseUrl: process.env.OPENAI_BASE_URL,
    model: "gpt-5.4-mini",
    key: process.env.OPENAI_API_KEY,
    auto: false,
  });
  for (let n = 0; n < 2; n++) {
    await call("batches", {});
    let state;
    do {
      await new Promise((r) => setTimeout(r, 1500));
      state = await call("status");
    } while (state.current);
    console.log("Live batch", n + 1, JSON.stringify(state.batches[0]));
    if (state.batches[0].status === "failed") break;
  }
  const result = await call("export");
  mkdirSync("work/acceptance", { recursive: true });
  writeFileSync(
    "work/acceptance/live-provider.json",
    JSON.stringify(result, null, 2),
  );
  await call("config", { clear: true });
  console.log("Live acceptance saved; session key cleared.");
} finally {
  await app.close();
}
