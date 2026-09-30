import { WEB_MODE } from "./runtime";
import seeds from "../shared/seeds.json";
import type { Question, SaveData } from "./model";
export let questions: Question[] = seeds;
export let online = false;
export async function api(path: string, body?: unknown) {
  if (WEB_MODE) return (await import("./web/api")).webApi(path, body);
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? "本机服务不可用");
  return data;
}
export async function refreshQuestions(s?: SaveData | null) {
  try {
    if (s)
      for (const id of [...s.reportQueue]) {
        await api("report", { id });
        s.reportQueue = s.reportQueue.filter((q) => q !== id);
      }
    const data = await api("questions");
    questions = data.questions;
    if (s) {
      s.reported = s.reported.filter(
        (id) => !questions.some((q) => q.id === id),
      );
    }
    localStorage.setItem("lingtian-approved-cache", JSON.stringify(data));
    online = true;
  } catch {
    online = false;
    try {
      const cached = JSON.parse(
        localStorage.getItem("lingtian-approved-cache") ?? "null",
      );
      if (cached?.questions) questions = cached.questions;
    } catch {
      questions = seeds;
    }
  }
  if (s) questions = questions.filter((q) => !s.reported.includes(q.id));
}
export function available(s: SaveData) {
  return questions.filter(
    (q) => !s.answered.includes(q.id) && !s.reported.includes(q.id),
  );
}
