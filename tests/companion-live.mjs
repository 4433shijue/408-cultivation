import { createCompanion } from "../server/companion.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "docs/evidence/v4";
mkdirSync(out, { recursive: true });
mkdirSync("work/companion-live", { recursive: true });
const report = {
  model: process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini",
  cases: [],
  limitations: [],
};
if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL) {
  report.limitations.push("Missing provider configuration");
  writeFileSync(out + "/live-report.json", JSON.stringify(report, null, 2));
  process.exit(0);
}
const svc = createCompanion({
  dbPath: `work/companion-live/${Date.now()}.sqlite`,
});
try {
  await svc.route("POST", "/config", {
    baseUrl: process.env.OPENAI_BASE_URL,
    model: report.model,
    key: process.env.OPENAI_API_KEY,
  });
  const history = [];
  for (const [npcId, kind, text] of [
    ["lin", "chat", "今天有点累，想在这里安静坐一会儿。"],
    ["yu", "chat", "今天有点累，想在这里安静坐一会儿。"],
    ["shen", "chat", "今天有点累，想在这里安静坐一会儿。"],
    ["lin", "during", "我把茶杯往灯边挪了一点，问你今天药圃里有什么新鲜事。"],
    ["lin", "ending", ""],
  ]) {
    const id = crypto.randomUUID(),
      body = {
        id,
        profileId: "live-acceptance",
        npcId,
        kind,
        text,
        mode: "together",
        scene: "檐下",
        length: "standard",
        minutes: 25,
        player: {
          name: "青禾",
          gender: "female",
          affinity: 8,
          romance: false,
          events: [npcId, npcId + "-2"],
        },
        history: kind === "ending" ? history : [],
      };
    const start = Date.now();
    await svc.route("POST", "/jobs", body);
    let r;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      r = await svc.route(
        "GET",
        "/jobs/" + id,
        {},
        new URLSearchParams({ profileId: "live-acceptance" }),
      );
    } while (["running", "queued"].includes(r.status));
    report.cases.push({
      npcId,
      kind,
      status: r.status,
      seconds: Math.round((Date.now() - start) / 1000),
      characters: r.text?.length ?? 0,
      error: r.error,
    });
    console.log(JSON.stringify(report.cases.at(-1)));
    if (r.status !== "complete") {
      report.limitations.push(
        "Stopped after first provider failure; remaining real cases not verified. No model substitution or automatic retry.",
      );
      break;
    }
    writeFileSync(`${out}/live-${npcId}-${kind}.txt`, r.text);
    if (kind === "during")
      history.push({ role: "user", text }, { role: "assistant", text: r.text });
  }
} catch (e) {
  report.limitations.push(
    "Configuration or provider connection failed; no retries.",
  );
  console.log("Live acceptance unavailable.");
} finally {
  writeFileSync(out + "/live-report.json", JSON.stringify(report, null, 2));
  await svc.close();
}
