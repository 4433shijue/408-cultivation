import type { SaveData } from "../model";
import type {
  CompanionData,
  CourseBookmark,
  NpcId,
  StudySession,
} from "./types";
export const npcIds: NpcId[] = ["lin", "yu", "shen"];
export function compatible(s: SaveData, id: NpcId) {
  return id !== "lin" || s.gender === "female";
}
export function canRomance(s: SaveData, id: NpcId) {
  return (
    compatible(s, id) &&
    (s.affinity[id] ?? 0) >= 12 &&
    [id, id + "-2", id + "-3"].every((e) => s.events.includes(e))
  );
}
export function canDual(s: SaveData, id: NpcId) {
  return canRomance(s, id) && s.companion.romances.includes(id);
}
export function safeUrl(raw: string) {
  if (!raw.trim()) return "";
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("课程链接仅支持无账号密码的 HTTP/HTTPS 网页");
  return u.href;
}
export function courseLink(c: CourseBookmark) {
  const raw = safeUrl(c.partUrl || c.url);
  if (!raw || c.partUrl) return raw;
  const u = new URL(raw);
  if (
    (u.hostname === "bilibili.com" || u.hostname.endsWith(".bilibili.com")) &&
    u.pathname.startsWith("/video/")
  ) {
    if (c.part > 1 || u.searchParams.has("p"))
      u.searchParams.set("p", String(c.part));
    if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(c.position)) {
      const t = c.position.split(":").reduce((n, v) => n * 60 + Number(v), 0);
      u.searchParams.set("t", String(t));
    }
    return u.href;
  }
  return raw;
}
export function inferPart(raw: string) {
  try {
    const n = Number(new URL(raw).searchParams.get("p"));
    return Number.isInteger(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}
export function freshData(profileId: string): CompanionData {
  return {
    pendingDeletes: [],
    schema: 1,
    profileId,
    messages: [],
    memories: {
      lin: { text: "", updatedAt: 0 },
      yu: { text: "", updatedAt: 0 },
      shen: { text: "", updatedAt: 0 },
    },
    drafts: {},
    courses: [],
    sessions: [],
    chapters: [],
    jobs: [],
    lastCourseId: "",
  };
}
export function elapsed(s: StudySession, now = Date.now()) {
  return Math.min(
    s.durationMs,
    Math.max(
      0,
      s.elapsedMs +
        (s.status === "running" ? Math.max(0, now - s.startedAt) : 0),
    ),
  );
}
export function pause(s: StudySession, now = Date.now()) {
  if (s.status !== "running") return;
  s.elapsedMs = elapsed(s, now);
  s.status = "paused";
  s.deadline = 0;
}
export function resume(s: StudySession, now = Date.now()) {
  if (s.status !== "paused") return;
  s.startedAt = now;
  s.deadline = now + s.durationMs - s.elapsedMs;
  s.status = "running";
}
export function finish(s: StudySession, now = Date.now(), automatic = false) {
  if (s.status === "ended") return;
  s.elapsedMs = elapsed(s, now);
  s.status = "ended";
  s.endedAt = now;
  s.deadline = 0;
  s.ending = automatic ? "waiting" : "none";
}
export function correctTime(
  s: StudySession,
  minutes: number,
  now = Date.now(),
) {
  const ms = Math.round(minutes * 60000);
  if (!Number.isFinite(ms) || ms < 0 || ms > elapsed(s, now))
    throw Error("只能减少已计时的时长，不能增加");
  s.elapsedMs = ms;
  if (s.status === "running") {
    s.startedAt = now;
    s.deadline = now + s.durationMs - ms;
  }
}
export function validateData(raw: unknown): CompanionData {
  if (!raw || typeof raw !== "object") throw Error("陪伴记录格式无效");
  const d = raw as CompanionData;
  if (d.pendingDeletes === undefined) d.pendingDeletes = [];
  if (
    !Array.isArray(d.pendingDeletes) ||
    !d.pendingDeletes.every((id) => typeof id === "string" && id.length <= 100)
  )
    throw Error("删除记录无效");
  const str = (v: unknown, n = 24000) => typeof v === "string" && v.length <= n;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (
    d.schema !== 1 ||
    !str(d.profileId, 100) ||
    !d.profileId ||
    !d.memories ||
    !d.drafts ||
    typeof d.drafts !== "object" ||
    Array.isArray(d.drafts) ||
    !Object.values(d.drafts).every((v) => str(v, 3000)) ||
    !npcIds.every(
      (id) =>
        d.memories[id] &&
        str(d.memories[id].text, 4000) &&
        num(d.memories[id].updatedAt),
    ) ||
    !str(d.lastCourseId, 100)
  )
    throw Error("陪伴角色记录无效");
  for (const k of [
    "messages",
    "courses",
    "sessions",
    "chapters",
    "jobs",
  ] as const) {
    if (!Array.isArray(d[k]) || d[k].length > 5000)
      throw Error("陪伴记录过多或格式错误");
    const ids = d[k].map((x) => x.id);
    if (
      ids.some((id) => !str(id, 100) || !id) ||
      new Set(ids).size !== ids.length
    )
      throw Error("陪伴记录标识重复或无效");
  }
  if (
    !d.messages.every(
      (m) =>
        npcIds.includes(m.npcId) &&
        ["user", "assistant"].includes(m.role) &&
        str(m.text) &&
        num(m.createdAt) &&
        (!m.sessionId || str(m.sessionId, 100)),
    )
  )
    throw Error("聊天记录无效");
  for (const c of d.courses) {
    if (
      !str(c.title, 120) ||
      !c.title.trim() ||
      !str(c.subject, 30) ||
      !str(c.partTitle, 160) ||
      !str(c.position, 40) ||
      !str(c.note, 2000) ||
      !Number.isInteger(c.part) ||
      c.part < 1 ||
      c.part > 10000 ||
      !num(c.updatedAt) ||
      !str(c.url, 3000) ||
      !str(c.partUrl, 3000)
    )
      throw Error("课程记录无效");
    safeUrl(c.url);
    safeUrl(c.partUrl);
  }
  if (
    !d.sessions.every(
      (s) =>
        npcIds.includes(s.npcId) &&
        ["together", "dual"].includes(s.mode) &&
        ["静室", "泉边", "檐下"].includes(s.scene) &&
        ["short", "standard", "long"].includes(s.length) &&
        ["running", "paused", "ended"].includes(s.status) &&
        ["none", "waiting", "generating", "complete", "failed"].includes(
          s.ending,
        ) &&
        [
          s.durationMs,
          s.elapsedMs,
          s.startedAt,
          s.deadline,
          s.createdAt,
          s.endedAt,
          s.gameDay,
        ].every(num) &&
        s.durationMs >= 300000 &&
        s.durationMs <= 10800000 &&
        s.elapsedMs <= s.durationMs &&
        str(s.courseId, 100) &&
        str(s.endingJobId, 100) &&
        str(s.feedback, 2000) &&
        str(s.understanding, 40),
    )
  )
    throw Error("共修计时记录无效");
  if (d.sessions.filter((s) => s.status !== "ended").length > 1)
    throw Error("只能同时保留一场未结束的共修");
  if (
    !d.chapters.every(
      (c) =>
        npcIds.includes(c.npcId) &&
        ["together", "dual"].includes(c.mode) &&
        str(c.sessionId, 100) &&
        str(c.title, 200) &&
        str(c.text) &&
        num(c.createdAt) &&
        num(c.minutes) &&
        typeof c.favorite === "boolean" &&
        num(c.readPosition),
    )
  )
    throw Error("故事记录无效");
  if (
    !d.jobs.every(
      (j) =>
        npcIds.includes(j.npcId) &&
        ["chat", "during", "ending", "test"].includes(j.kind) &&
        ["pending", "complete", "failed", "cancelled"].includes(j.state) &&
        str(j.sessionId, 100) &&
        str(j.error, 1000) &&
        str(j.partial) &&
        typeof j.applied === "boolean" &&
        j.body &&
        typeof j.body === "object" &&
        !Array.isArray(j.body),
    )
  )
    throw Error("生成记录无效");
  return d;
}
