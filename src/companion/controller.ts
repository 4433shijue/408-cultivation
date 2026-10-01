import { dayKey } from "../realtime";
import { WEB_MODE, KEY_LOCATION } from "../runtime";
import profiles from "../../shared/npcs.json";
import { PEOPLE } from "../content";
import { FRIEND_STORIES } from "../progression";
import type { SaveData } from "../model";
import { api } from "../api";
import { readData, mutateData, putData } from "./store";
import {
  canDual,
  canRomance,
  compatible,
  courseLink,
  correctTime,
  elapsed,
  finish,
  freshData,
  inferPart,
  pause,
  resume,
  safeUrl,
  validateData,
} from "./rules";
import type { CompanionData, Generation, NpcId, StudySession } from "./types";
import "./style.css";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const button = (text: string, id: string, disabled = false) =>
  `<button type="button" data-cp="${id}" ${disabled ? "disabled" : ""}>${text}</button>`;
const paragraphs = (text: string) =>
  text
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
const uid = () => crypto.randomUUID();
const minutes = (ms: number) => (ms / 60000).toFixed(1);
type Hooks = {
  getSave: () => SaveData | null;
  updateGame: (fn: (s: SaveData) => void) => Promise<void>;
  notify: (text: string) => void;
  closeGameModal: () => void;
  onClose: () => void;
};
export class Companion {
  private root: HTMLDivElement;
  private data: CompanionData | null = null;
  private npc: NpcId = "lin";
  private view = "chat";
  private sessionId = "";
  private courseId = "";
  private chapterId = "";
  private visible = false;
  private working = false;
  private ticking = false;
  private profile = "";
  private config: {
    configured: boolean;
    model?: string;
    baseUrl?: string;
    calls?: number;
  } = { configured: false };
  private draftTimer = 0;
  private channel = new BroadcastChannel("lingtian-companion");
  constructor(private hooks: Hooks) {
    this.root = document.createElement("div");
    this.root.id = "companion-root";
    document.body.append(this.root);
    this.root.addEventListener("click", (e) => {
      const courseLink = (e.target as HTMLElement).closest<HTMLAnchorElement>(
        "[data-course-id]",
      );
      if (courseLink)
        void this.change((d) => {
          d.lastCourseId = courseLink.dataset.courseId!;
        }).catch((err) => hooks.notify(err.message));
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-cp]",
      );
      if (!b || b.disabled) return;
      e.stopPropagation();
      if (this.root.dataset.busy === "true") return;
      this.root.dataset.busy = "true";
      void this.action(b.dataset.cp!)
        .catch((err) => hooks.notify(err.message))
        .finally(() => {
          this.root.dataset.busy = "false";
        });
    });
    this.root.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.root.dataset.busy === "true") return;
      this.root.dataset.busy = "true";
      void this.submit(e.target as HTMLFormElement)
        .catch((err) => hooks.notify(err.message))
        .finally(() => {
          this.root.dataset.busy = "false";
        });
    });
    this.root.addEventListener("input", (e) => {
      const t = e.target as HTMLTextAreaElement;
      if (t.name !== "message") return;
      clearTimeout(this.draftTimer);
      const key = this.draftKey(),
        value = t.value,
        profile = this.profile;
      this.draftTimer = window.setTimeout(
        () =>
          void mutateData(profile, (d) => {
            d.drafts[key] = value;
          }).catch((err) => hooks.notify(err.message)),
        180,
      );
    });
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        void this.action("close");
        return;
      }
      if (e.key === "Tab") {
        const els = [
          ...this.root.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,textarea,select,a[href]",
          ),
        ].filter((el) => el.getClientRects().length);
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    });
    this.channel.onmessage = () => void this.refresh();
    window.addEventListener("pagehide", () => {
      this.persistDraft();
    });
    setInterval(() => void this.tick(), 1000);
  }
  private draftKey() {
    return this.view === "room"
      ? "session:" + this.sessionId
      : "chat:" + this.npc;
  }
  private persistDraft() {
    const input =
      this.root.querySelector<HTMLTextAreaElement>('[name="message"]');
    if (!input || !this.profile) return;
    const value = input.value,
      key = this.draftKey();
    clearTimeout(this.draftTimer);
    void mutateData(this.profile, (d) => {
      d.drafts[key] = value;
    });
  }
  private async ensure() {
    const s = this.hooks.getSave();
    if (!s) throw Error("请先创建角色");
    if (this.profile !== s.companion.profileId || !this.data) {
      this.profile = s.companion.profileId;
      this.data = await readData(this.profile);
      this.sessionId =
        this.data.sessions.find((x) => x.status !== "ended")?.id ??
        this.data.sessions.at(-1)?.id ??
        "";
    }
    return s;
  }
  private async change<T>(fn: (d: CompanionData) => T | Promise<T>) {
    const id = this.profile;
    const r = await mutateData(id, fn);
    if (id === this.profile) this.data = r.data;
    this.channel.postMessage(id);
    return r.result;
  }
  private async refresh() {
    if (!this.profile) return;
    const id = this.profile;
    const d = await readData(id);
    if (id === this.profile) {
      this.data = d;
      this.patch();
    }
  }
  async open(id?: NpcId, view = "chat") {
    await this.ensure();
    this.hooks.closeGameModal();
    this.persistDraft();
    if (id) this.npc = id;
    this.view = view;
    this.visible = true;
    try {
      this.config = await api("companion/status");
    } catch {
      this.config = { configured: false };
    }
    this.render();
    this.root.querySelector<HTMLElement>("button")?.focus();
  }
  private session() {
    return this.data?.sessions.find((s) => s.id === this.sessionId);
  }
  private busyJob() {
    return this.data?.jobs.find((j) => j.state === "pending");
  }
  private render() {
    if (!this.visible || !this.data) {
      this.root.innerHTML = "";
      return;
    }
    const p = profiles.find((p) => p.id === this.npc)!,
      s = this.hooks.getSave()!,
      index = profiles.indexOf(p);
    const tabs = [
      ["chat", "自由交谈"],
      ["setup", "一起修炼"],
      ["courses", "课程书签"],
      ["book", "共修故事"],
      ["memory", "人物记忆"],
      ["config", "道友设置"],
    ];
    this.root.innerHTML = `<section class="companion-shell" role="dialog" aria-modal="true" aria-label="道友相伴"><header class="cp-header"><div><small>青禾故人 · 有人与你同坐</small><h2>${p.name}</h2></div><div class="cp-person-tabs">${profiles.map((n) => button(n.name, "npc:" + n.id)).join("")}</div>${button("回到山居", "close")}</header><nav class="cp-nav">${tabs.map(([v, t]) => `<button type="button" data-cp="view:${v}" class="${this.view === v ? "active" : ""}">${t}</button>`).join("")}${this.data.sessions.length ? button("本次共修", "view:room") : ""}</nav><div class="cp-layout"><aside class="cp-portrait"><img src="assets/v2/person-${index}-1.webp" alt="${p.name}"><div><strong>${p.role} · ${p.age}岁</strong><p>${p.id === "lin" ? "细心而有主见，温柔里藏着一点俏皮。" : p.id === "yu" ? "山路上的热闹归人，也有认真得说不出口的时候。" : "书页与茶香之间，慢慢说清楚的心意。"}</p><small>熟络 ${s.affinity[this.npc] ?? 0} · ${s.companion.romances.includes(this.npc) ? "已确认恋爱" : "相识相伴"}</small>${button(s.companion.romances.includes(this.npc) ? "查看关系" : "关于我们的关系", "relationship")}</div></aside><main class="cp-main">${this.content()}</main></div><footer class="cp-foot">${this.config.configured ? "文本接口已配置 · " + esc(this.config.model) : "未连接文本接口 · 计时、课程与已有故事仍可使用"}<span>静默时不调用 AI，也不催你回话</span></footer></section>`;
    this.restoreReader();
  }
  private content(): string {
    const d = this.data!,
      s = this.hooks.getSave()!;
    if (this.view === "chat")
      return `<div class="cp-title"><h3>与${profiles.find((p) => p.id === this.npc)!.name}说说话</h3>${button("清空此人聊天", "delete-chat")}</div><div id="cp-messages" class="cp-messages">${this.messages()}</div>${this.compose()}`;
    if (this.view === "setup") {
      const active = d.sessions.find((x) => x.status !== "ended");
      return `<h3>今天想怎样相伴</h3><p>一起修炼与双修的学习收益相同。你安静学习，对方也安静做自己的事。</p>${active ? `<div class="cp-note">尚有一场未结束的共修。${button("回到这场共修", "active-session")}</div>` : ""}<form data-cp-form="setup" class="cp-form"><label>相伴方式<select name="mode"><option value="together">一起修炼 · 友情相伴</option>${canDual(s, this.npc) ? '<option value="dual">双修 · 心意相通</option>' : ""}</select></label><label>场景<select name="scene"><option>静室</option><option>泉边</option><option>檐下</option></select></label><label>学习课程<select name="course"><option value="">暂不选择课程</option>${d.courses.map((c) => `<option value="${c.id}" ${c.id === d.lastCourseId ? "selected" : ""}>${esc(c.title)} · P${c.part}</option>`).join("")}</select></label><label>时长 · 分钟<input name="duration" type="number" min="5" max="180" value="25" required></label><div class="cp-row">${button("25分钟", "preset:25")}${button("50分钟", "preset:50")}</div><label>剧情篇幅<select name="length"><option value="short">短篇</option><option value="standard" selected>标准 · 中途600—1200字 / 结束1500—3000字</option><option value="long">长篇</option></select></label><button class="cp-primary" ${active ? "disabled" : ""}>开始相伴 · 安静计时</button></form><small>课程链接会在新标签页打开；分P和时间位置需自行更新，不读取外部视频进度。</small>`;
    }
    if (this.view === "room") {
      const session = this.session();
      if (!session)
        return (
          "<h3>还没有共修记录</h3>" + button("开始第一次相伴", "view:setup")
        );
      const course = d.courses.find((c) => c.id === session.courseId),
        npc = profiles.find((p) => p.id === session.npcId)!;
      return `<div class="cp-room scene-${session.scene === "静室" ? "quiet" : session.scene === "泉边" ? "spring" : "eaves"}"><div><small>${npc.name} · ${session.mode === "dual" ? "双修" : "一起修炼"} · ${session.scene}</small><strong id="cp-timer">${this.timerText(session)}</strong><span id="cp-state">${session.status === "running" ? "你读你的书，我留一盏灯。" : session.status === "paused" ? "歇一歇，等你回来。" : "这一段相伴已记下。"}</span></div></div><div class="cp-row">${session.status === "running" ? button("暂停", "pause") : session.status === "paused" ? button("继续", "resume") : ""}${session.status !== "ended" ? button("结束本次", "finish") : ""}${button("修正已计时长", "correct-time")}${button("收起 / 展开故事", "toggle-reading")}</div>${course ? `<div class="cp-course-current"><strong>${esc(course.title)} · P${course.part}</strong><small>${esc(course.partTitle)} ${esc(course.position)}</small>${this.link(courseLink(course), "继续课程", course.id)}${button("更新分P / 进度", "course:" + course.id)}</div>` : button("打开课程书签", "view:courses")}<div id="cp-room-reading"><div id="cp-messages" class="cp-messages room-messages">${this.messages(session.id)}</div>${session.status !== "ended" ? this.compose() : `<div class="cp-note" id="cp-ending-state">${this.endingText(session)}</div><div class="cp-row">${session.ending === "complete" ? button("阅读结束章节", "read-session:" + session.id) : button(session.ending === "failed" ? "补写结束章节" : "生成结束章节", "request-ending", session.ending === "waiting" || session.ending === "generating")}${button("记下学习心得", "feedback")}</div>`}</div>`;
    }
    if (this.view === "courses")
      return `<div class="cp-title"><h3>课程书签</h3>${button("添加课程", "new-course")}${d.courses.find((c) => c.id === d.lastCourseId) ? this.link(courseLink(d.courses.find((c) => c.id === d.lastCourseId)!), "继续上次课程", d.lastCourseId) : ""}</div><p>换一位道友陪伴，课程进度仍然保留。这里只保存书签，不缓存视频。</p><div class="cp-cards">${d.courses.map((c) => `<article><small>${esc(c.subject)}</small><h4>${esc(c.title)}</h4><p>P${c.part} · ${esc(c.partTitle)} · ${esc(c.position) || "未记时间位置"}</p><p>${esc(c.note)}</p><div class="cp-row">${this.link(courseLink(c), "继续观看", c.id)}${button("编辑进度", "course:" + c.id)}${button("本P已学完", "next-part:" + c.id)}${button("删除", "delete-course:" + c.id)}</div></article>`).join("") || '<p class="cp-empty">把正在学的课程放在这里，下次不必再找。</p>'}</div>`;
    if (this.view === "course-edit") {
      const c = d.courses.find((c) => c.id === this.courseId);
      return `<h3>${c ? "更新课程进度" : "添加课程"}</h3><form data-cp-form="course" class="cp-form"><label>课程名称<input name="title" maxlength="120" required value="${esc(c?.title)}"></label><label>科目<select name="subject">${["数据结构", "计算机组成原理", "操作系统", "计算机网络", "其他"].map((v) => `<option ${v === c?.subject ? "selected" : ""}>${v}</option>`).join("")}</select></label><label class="cp-wide">课程原始链接<input name="url" type="url" maxlength="3000" required value="${esc(c?.url)}" placeholder="https://..."></label><label>当前分P<input name="part" type="number" min="1" max="10000" value="${c?.part ?? 1}" required></label><label>当前P标题<input name="partTitle" maxlength="160" value="${esc(c?.partTitle)}"></label><label class="cp-wide">当前P独立链接 · 可空<input name="partUrl" type="url" maxlength="3000" value="${esc(c?.partUrl)}"></label><label>时间位置<input name="position" maxlength="40" value="${esc(c?.position)}" placeholder="18:42"></label><label class="cp-wide">进度备注<textarea name="note" maxlength="2000">${esc(c?.note)}</textarea></label><button class="cp-primary">保存书签</button>${button("返回课程", "view:courses")}</form>`;
    }
    if (this.view === "book")
      return `<h3>共修故事书</h3><details><summary>历次共修 · 计时、心得与待补写章节</summary><div class="cp-cards">${
        d.sessions
          .slice()
          .reverse()
          .map(
            (se) =>
              `<article><h4>${profiles.find((p) => p.id === se.npcId)!.name} · ${new Date(se.createdAt).toLocaleString()}</h4><p>${se.mode === "dual" ? "双修" : "一起修炼"} · ${minutes(elapsed(se))}分钟 · ${this.endingText(se)}</p>${button("查看共修记录", "session:" + se.id)}</article>`,
          )
          .join("") || "<p>还没有共修记录。</p>"
      }</div></details><div class="cp-row">${button("所有人物", "filter:all")}${profiles.map((p) => button(p.name, "filter:" + p.id)).join("")}</div><div class="cp-cards">${
        d.chapters
          .filter(
            (c) =>
              !this.root.dataset.filter ||
              this.root.dataset.filter === "all" ||
              c.npcId === this.root.dataset.filter,
          )
          .slice()
          .reverse()
          .map(
            (c) =>
              `<article><small>${new Date(c.createdAt).toLocaleString()} · ${c.minutes.toFixed(1)}分钟</small><h4>${esc(c.title)}</h4><p>${esc(c.text.slice(0, 100))}…</p><div class="cp-row">${button("接着读", "read:" + c.id)}${button(c.favorite ? "已收藏" : "收藏", "favorite:" + c.id)}${button("导出TXT", "export-story:" + c.id)}${button("删除", "delete-story:" + c.id)}</div></article>`,
          )
          .join("") ||
        '<p class="cp-empty">结束章节会留在这里。你们的故事，可以慢慢读。</p>'
      }</div>`;
    if (this.view === "reader") {
      const c = d.chapters.find((c) => c.id === this.chapterId);
      return c
        ? `<div class="cp-title"><h3>${esc(c.title)}</h3>${button("回到故事书", "view:book")}</div><article class="cp-reader" id="cp-reader">${paragraphs(c.text)}</article>`
        : "<p>这一章已被删除。</p>" + button("返回", "view:book");
    }
    if (this.view === "memory")
      return `<h3>留给${profiles.find((p) => p.id === this.npc)!.name}的记忆</h3><p>这份记忆只属于这个人。勾选“记住这句话”会保存你输入的原话；你也可以修正或删除。不会把模型猜测当成你的心意。</p><form data-cp-form="memory" class="cp-form"><label class="cp-wide">人物记忆<textarea name="memory" maxlength="4000" rows="9">${esc(d.memories[this.npc].text)}</textarea></label><button class="cp-primary">保存记忆</button>${button("清空记忆", "delete-memory")}</form>`;
    if (this.view === "relationship") {
      const confirmed = s.companion.romances.includes(this.npc),
        eligible = canRomance(s, this.npc);
      return `<h3>关于我们的关系</h3><p>${confirmed ? "你们已经明确确认了恋爱关系。仍然可以选择普通的一起修炼。" : !compatible(s, this.npc) ? "疏月只对女性产生恋爱情感。你们仍然可以拥有深厚的友情，一起修炼的故事与收益完整保留。" : eligible ? "相处的日子里，心意已经有了落脚处。你愿意明确与对方建立恋爱关系吗？" : "先慢慢相识。熟络达到12，并完成三段友情事件后，可以在这里明确彼此的心意。"}</p><p>熟络 ${s.affinity[this.npc] ?? 0}/12 · 友情事件 ${[this.npc, this.npc + "-2", this.npc + "-3"].filter((id) => s.events.includes(id)).length}/3</p>${button("我愿意，确认恋爱关系", "confirm-romance", confirmed || !eligible)}${button("先一起修炼", "view:setup")}`;
    }
    if (this.view === "feedback") {
      const session = this.session()!;
      return `<h3>留一句给下次的自己</h3><p>心得只保存在学习记录，不会作为NPC知晓的课程内容。</p><form data-cp-form="feedback" class="cp-form"><label>这次感觉<select name="understanding">${["尚未填写", "听懂了", "需要再看", "今天先到这里"].map((t) => `<option ${t === session.understanding ? "selected" : ""}>${t}</option>`).join("")}</select></label><label class="cp-wide">心得<textarea name="feedback" maxlength="2000">${esc(session.feedback)}</textarea></label><button>保存心得</button>${button("暂不填写", "view:room")}</form>`;
    }
    if (this.view === "correct")
      return `<h3>修正误计时</h3><p>当前记录 ${minutes(elapsed(this.session()!))} 分钟。只允许减少误计时；少于25分钟会撤回本场的熟络奖励，故事正文保留。</p><form data-cp-form="correct" class="cp-form"><label>实际分钟<input name="minutes" type="number" min="0" step="0.1" max="${minutes(elapsed(this.session()!))}" required></label><button>保存修正</button>${button("返回", "view:room")}</form>`;
    return `<h3>道友文本接口</h3><p>与题库配置独立。密钥只保存在${KEY_LOCATION}，${WEB_MODE ? "刷新页面" : "服务重启"}后需重新填写。${WEB_MODE ? "浏览器直接请求你填写的HTTPS接口，提供方需支持跨域（CORS）。关闭生成页面会中断任务，已完成内容保存在此浏览器。" : ""}主动聊天和结束剧情会调用接口，可能产生费用。</p><form data-cp-form="config" class="cp-form"><label class="cp-wide">兼容接口地址<input name="baseUrl" type="url" required value="${esc(this.config.baseUrl)}" placeholder="https://你的接口/v1"></label><label>文本模型<input name="model" maxlength="120" required value="${esc(this.config.model)}"></label><label>密钥<input name="key" type="password" required autocomplete="off"></label><button class="cp-primary">保存本次${WEB_MODE ? "页面" : "服务"}配置</button></form><div class="cp-row">${button("复制题库接口配置", "copy-config")}${button("连接测试", "test-config", !!this.busyJob())}${button("清除密钥", "clear-config", !!this.busyJob())}</div><div id="cp-job-status">${this.jobStatus()}</div><p>无静默轮询生成、无失败自动重试。你可以随时取消正在生成的回复。</p>`;
  }
  private link(url: string, label: string, courseId = "") {
    return url
      ? `<a class="cp-link" data-course-id="${esc(courseId)}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : "";
  }
  private timerText(s: StudySession) {
    const ms = Math.max(0, s.durationMs - elapsed(s));
    return s.status === "ended"
      ? `相伴 ${minutes(s.elapsedMs)} 分钟`
      : `${Math.floor(ms / 60000)
          .toString()
          .padStart(2, "0")}:${Math.floor((ms % 60000) / 1000)
          .toString()
          .padStart(2, "0")}`;
  }
  private endingText(s: StudySession) {
    return {
      none: "相伴已保存，可以写下这一回的结束章节。",
      waiting:
        "正在等待已发出的片段结束，再续写收尾。若连接中断，请到道友设置手动重试以核对原任务。",
      generating: "正在写结束章节，你可以继续做别的事。",
      complete: "结束章节已收进故事书。",
      failed: "结束章节尚未完成，计时和学习记录都还在。可手动补写。",
    }[s.ending];
  }
  private messages(sessionId?: string) {
    const rows = this.data!.messages.filter((m) =>
      sessionId
        ? m.sessionId === sessionId
        : m.npcId === this.npc && !m.sessionId,
    );
    const job = this.data!.jobs.find(
      (j) =>
        j.state === "pending" &&
        (sessionId
          ? j.sessionId === sessionId
          : j.npcId === this.npc && !j.sessionId),
    );
    return (
      rows
        .map(
          (m) =>
            `<article class="cp-message ${m.role}"><small>${m.role === "user" ? "你" : profiles.find((p) => p.id === m.npcId)!.name}</small>${paragraphs(m.text)}</article>`,
        )
        .join("") +
      (job
        ? `<article class="cp-message assistant pending"><small>正在写 · 尚未记入故事</small>${paragraphs(job.partial) || "<p>灯下的字句正在慢慢成形…</p>"}${button("取消生成", "cancel:" + job.id)}</article>`
        : "") +
      (!rows.length && !job
        ? '<p class="cp-empty">你可以说点什么，也可以安静坐一会儿。</p>'
        : "")
    );
  }
  private jobStatus() {
    const j = this.data!.jobs.at(-1);
    if (!j) return "";
    return `<div class="cp-note">${j.state === "pending" ? "生成中" : j.state === "complete" ? "上一条已完成" : esc(j.error || "已取消")}${j.state === "pending" ? button("取消", "cancel:" + j.id) : j.state === "failed" || j.state === "cancelled" ? button("手动重试", "retry:" + j.id, !!this.busyJob()) : ""}</div>`;
  }
  private compose() {
    return `<form data-cp-form="chat" class="cp-compose"><textarea name="message" maxlength="3000" rows="3" placeholder="想说的时候，再说给对方听…">${esc(this.data!.drafts[this.draftKey()] ?? "")}</textarea><div class="cp-row"><label><input type="checkbox" name="remember">记住这句话</label><button class="cp-primary" ${this.busyJob() ? "disabled" : ""}>${this.busyJob() ? "等待当前回复" : "发送"}</button></div></form><div id="cp-job-status">${this.jobStatus()}</div>`;
  }
  private restoreReader() {
    const reader = this.root.querySelector<HTMLElement>("#cp-reader"),
      chapter = this.data?.chapters.find((c) => c.id === this.chapterId);
    if (!reader || !chapter) return;
    reader.scrollTop = chapter.readPosition;
    let timer = 0;
    reader.addEventListener("scroll", () => {
      clearTimeout(timer);
      const id = chapter.id,
        position = reader.scrollTop;
      timer = window.setTimeout(
        () =>
          void this.change((d) => {
            const c = d.chapters.find((x) => x.id === id);
            if (c) c.readPosition = position;
          }),
        150,
      );
    });
  }
  private patch() {
    if (!this.visible || !this.data) return;
    const session = this.session(),
      timer = this.root.querySelector("#cp-timer");
    if (timer && session) timer.textContent = this.timerText(session);
    const messages = this.root.querySelector("#cp-messages");
    if (messages) {
      const html = this.messages(
        this.view === "room" ? session?.id : undefined,
      );
      if (messages.innerHTML !== html) {
        const nearEnd =
          messages.scrollHeight - messages.scrollTop - messages.clientHeight <
          100;
        messages.innerHTML = html;
        if (nearEnd) messages.scrollTop = messages.scrollHeight;
      }
    }
    const status = this.root.querySelector("#cp-job-status");
    if (status) status.innerHTML = this.jobStatus();
    const submit = this.root.querySelector<HTMLButtonElement>(
      '[data-cp-form="chat"] button:not([type="button"])',
    );
    if (submit) {
      submit.disabled = !!this.busyJob();
      submit.textContent = this.busyJob() ? "等待当前回复" : "发送";
    }
    const end = this.root.querySelector("#cp-ending-state");
    if (end && session) end.textContent = this.endingText(session);
  }
  private async action(id: string) {
    if (this.working) return;
    await this.ensure();
    this.persistDraft();
    if (id === "close") {
      this.visible = false;
      this.hooks.onClose();
      this.render();
      return;
    }
    if (id.startsWith("npc:")) {
      this.npc = id.slice(4) as NpcId;
      this.view = "chat";
      this.render();
      return;
    }
    if (id.startsWith("view:")) {
      this.view = id.slice(5);
      if (this.view === "room" && !this.sessionId)
        this.sessionId = this.data!.sessions.at(-1)?.id ?? "";
      if (this.view === "room" && this.session())
        this.npc = this.session()!.npcId;
      if (this.view === "config") {
        try {
          this.config = await api("companion/status");
        } catch {
          this.hooks.notify("本机服务未连接");
        }
      }
      this.render();
      return;
    }
    if (id === "relationship") {
      this.view = "relationship";
      this.render();
      return;
    }
    if (id === "confirm-romance") {
      const npc = this.npc;
      await this.hooks.updateGame((s) => {
        if (!canRomance(s, npc)) throw Error("尚未满足关系条件");
        if (!s.companion.romances.includes(npc)) s.companion.romances.push(npc);
      });
      this.render();
      return;
    }
    if (id.startsWith("preset:")) {
      this.root.querySelector<HTMLInputElement>('[name="duration"]')!.value =
        id.slice(7);
      return;
    }
    if (id === "active-session") {
      this.sessionId = this.data!.sessions.find(
        (s) => s.status !== "ended",
      )!.id;
      this.npc = this.session()!.npcId;
      this.view = "room";
      this.render();
      return;
    }
    if (id === "toggle-reading") {
      this.root
        .querySelector("#cp-room-reading")
        ?.classList.toggle("collapsed");
      return;
    }
    if (id === "new-course" || id.startsWith("course:")) {
      this.courseId = id === "new-course" ? "" : id.slice(7);
      this.view = "course-edit";
      this.render();
      return;
    }
    if (id.startsWith("next-part:")) {
      this.courseId = id.slice(10);
      await this.change((d) => {
        const c = d.courses.find((c) => c.id === this.courseId)!;
        c.part = Math.min(10000, c.part + 1);
        c.partTitle = "";
        c.position = "00:00";
        c.partUrl = "";
        c.updatedAt = Date.now();
      });
      this.view = "course-edit";
      this.render();
      this.hooks.notify("已标记学完，请粘贴下一P链接后保存。");
      return;
    }
    if (id.startsWith("delete-course:")) {
      await this.change((d) => {
        d.courses = d.courses.filter((c) => c.id !== id.slice(14));
      });
      this.render();
      return;
    }
    if (id === "delete-memory") {
      await this.change((d) => {
        d.memories[this.npc] = { text: "", updatedAt: Date.now() };
        for (const j of d.jobs) if (j.npcId === this.npc) j.body.memory = "";
      });
      this.render();
      return;
    }
    if (id === "delete-chat") {
      if (this.busyJob()) throw Error("请先等待或取消当前回复");
      this.view = "confirm-delete-chat";
      this.root.querySelector(".cp-main")!.innerHTML =
        `<h3>清空这位道友的聊天？</h3><p>人物记忆和已收藏的共修故事会保留。</p>${button("确认清空", "confirm-delete-chat")}${button("返回", "view:chat")}`;
      return;
    }
    if (id === "confirm-delete-chat") {
      await this.change((d) => {
        d.messages = d.messages.filter(
          (m) => m.npcId !== this.npc || !!m.sessionId,
        );
        d.pendingDeletes.push(
          ...d.jobs
            .filter((j) => j.npcId === this.npc && !j.sessionId)
            .map((j) => j.id),
        );
        d.jobs = d.jobs.filter((j) => j.npcId !== this.npc || !!j.sessionId);
      });
      this.view = "chat";
      this.render();
      return;
    }
    if (
      id === "pause" ||
      id === "resume" ||
      id === "finish" ||
      id === "request-ending"
    ) {
      await this.change((d) => {
        const se = d.sessions.find((x) => x.id === this.sessionId);
        if (!se) throw Error("共修记录不存在");
        if (id === "pause") pause(se);
        if (id === "resume") resume(se);
        if (id === "finish") finish(se);
        if (
          id === "request-ending" &&
          se.status === "ended" &&
          se.ending !== "complete"
        )
          se.ending = "waiting";
      });
      await this.reward(this.session()!);
      this.render();
      void this.tick();
      return;
    }
    if (id === "correct-time" || id === "feedback") {
      this.view = id === "feedback" ? "feedback" : "correct";
      this.render();
      return;
    }
    if (id.startsWith("cancel:")) {
      await api("companion/cancel", {
        id: id.slice(7),
        profileId: this.profile,
      });
      await this.poll();
      return;
    }
    if (id.startsWith("retry:")) {
      if (this.busyJob()) throw Error("请等待当前回复");
      const old = this.data!.jobs.find((j) => j.id === id.slice(6));
      if (!old || !["failed", "cancelled"].includes(old.state)) return;
      if (old.state === "failed") {
        let known: { status: string } | undefined;
        try {
          known = await api(
            `companion/jobs/${old.id}?profileId=${encodeURIComponent(this.profile)}`,
          );
        } catch (e) {
          if (!(e as Error).message.includes("未找到"))
            throw Error("服务尚未恢复，未发起新的模型请求。");
        }
        if (known && ["complete", "queued", "running"].includes(known.status)) {
          await this.change((d) => {
            const j = d.jobs.find((x) => x.id === old.id)!;
            j.state = "pending";
            j.applied = false;
            j.uncertain = false;
            j.error = "";
          });
          await this.poll();
          this.patch();
          return;
        }
      }
      const j = {
        ...structuredClone(old),
        id: uid(),
        state: "pending" as const,
        error: "",
        partial: "",
        applied: false,
        uncertain: false,
      };
      j.body = {
        ...j.body,
        id: j.id,
        memory: this.data!.memories[j.npcId].text,
      };
      await this.change((d) => {
        if (d.jobs.some((j) => j.state === "pending"))
          throw Error("请等待当前回复");
        const original = d.jobs.find((x) => x.id === old.id);
        if (original) original.uncertain = false;
        d.jobs.push(j);
        const se = d.sessions.find((s) => s.id === j.sessionId);
        if (se && j.kind === "ending") {
          se.ending = "generating";
          se.endingJobId = j.id;
        }
      });
      await this.dispatch(j);
      this.patch();
      return;
    }
    if (id === "copy-config" || id === "clear-config") {
      this.config = await api(
        "companion/config",
        id === "copy-config" ? { copyQuestion: true } : { clear: true },
      );
      this.render();
      return;
    }
    if (id === "test-config") {
      await this.createJob("test", "");
      this.render();
      return;
    }
    if (id.startsWith("filter:")) {
      this.root.dataset.filter = id.slice(7);
      this.render();
      return;
    }
    if (id.startsWith("session:")) {
      this.sessionId = id.slice(8);
      this.npc = this.session()!.npcId;
      this.view = "room";
      this.render();
      return;
    }
    if (id.startsWith("read-session:")) {
      const c = this.data!.chapters.find((c) => c.sessionId === id.slice(13));
      if (!c) throw Error("章节尚未完成");
      this.chapterId = c.id;
      this.npc = c.npcId;
      this.view = "reader";
      this.render();
      return;
    }
    if (id.startsWith("read:")) {
      this.chapterId = id.slice(5);
      this.npc = this.data!.chapters.find(
        (c) => c.id === this.chapterId,
      )!.npcId;
      this.view = "reader";
      this.render();
      return;
    }
    if (id.startsWith("favorite:")) {
      await this.change((d) => {
        const c = d.chapters.find((c) => c.id === id.slice(9))!;
        c.favorite = !c.favorite;
      });
      this.render();
      return;
    }
    if (id.startsWith("delete-story:")) {
      const chapter = id.slice(13);
      await this.change((d) => {
        d.chapters = d.chapters.filter((c) => c.id !== chapter);
        d.jobs = d.jobs.filter((j) => j.id !== chapter);
        d.pendingDeletes.push(chapter);
      });
      this.render();
      return;
    }
    if (id.startsWith("export-story:")) {
      const c = this.data!.chapters.find((c) => c.id === id.slice(13))!;
      this.download(c.title + ".txt", c.title + "\n\n" + c.text, "text/plain");
    }
  }
  private async submit(form: HTMLFormElement) {
    if (this.working) return;
    this.working = true;
    try {
      await this.ensure();
      const values = new FormData(form),
        v = (key: string) => String(values.get(key) ?? "");
      const kind = form.dataset.cpForm;
      if (kind === "chat") {
        const text = v("message").trim();
        if (!text) throw Error("先写下一句话吧");
        const isRoom = this.view === "room";
        if (isRoom && this.session()?.status === "ended")
          throw Error("本次共修已经结束");
        await this.createJob(
          isRoom ? "during" : "chat",
          text,
          values.get("remember") === "on",
        );
        this.render();
      } else if (kind === "setup") {
        const duration = Number(v("duration"));
        if (!Number.isFinite(duration) || duration < 5 || duration > 180)
          throw Error("时长应为5—180分钟");
        const s = this.hooks.getSave()!,
          mode = v("mode") === "dual" ? "dual" : "together";
        if (mode === "dual" && !canDual(s, this.npc))
          throw Error("尚未开放双修");
        const now = Date.now(),
          id = uid();
        await this.change((d) => {
          if (d.sessions.some((x) => x.status !== "ended"))
            throw Error("请先结束当前共修");
          d.sessions.push({
            id,
            npcId: this.npc,
            mode,
            scene: v("scene") as StudySession["scene"],
            courseId: v("course"),
            length: v("length") as StudySession["length"],
            durationMs: Math.round(duration * 60000),
            elapsedMs: 0,
            startedAt: now,
            deadline: now + duration * 60000,
            status: "running",
            createdAt: now,
            endedAt: 0,
            gameDay: dayKey(),
            ending: "none",
            endingJobId: "",
            feedback: "",
            understanding: "",
          });
          d.lastCourseId = v("course");
        });
        this.sessionId = id;
        this.view = "room";
        this.render();
      } else if (kind === "course") {
        const url = safeUrl(v("url")),
          partUrl = safeUrl(v("partUrl"));
        if (!v("title").trim() || !url) throw Error("请填写课程名和链接");
        const part = Number(v("part"));
        if (!Number.isInteger(part) || part < 1 || part > 10000)
          throw Error("分P序号无效");
        const id = this.courseId || uid();
        await this.change((d) => {
          const c = {
            id,
            title: v("title").trim(),
            subject: v("subject"),
            url,
            part: this.courseId
              ? part
              : part === 1
                ? inferPart(partUrl || url)
                : part,
            partTitle: v("partTitle"),
            partUrl,
            position: v("position"),
            note: v("note"),
            updatedAt: Date.now(),
          };
          const index = d.courses.findIndex((c) => c.id === id);
          if (index >= 0) d.courses[index] = c;
          else d.courses.push(c);
          d.lastCourseId = id;
        });
        this.view = "courses";
        this.render();
      } else if (kind === "memory") {
        await this.change((d) => {
          d.memories[this.npc] = { text: v("memory"), updatedAt: Date.now() };
        });
        this.hooks.notify("这份记忆已保存。");
      } else if (kind === "config") {
        this.config = await api("companion/config", {
          baseUrl: v("baseUrl"),
          model: v("model"),
          key: v("key"),
        });
        (form.elements.namedItem("key") as HTMLInputElement).value = "";
        this.render();
      } else if (kind === "feedback") {
        await this.change((d) => {
          const s = d.sessions.find((s) => s.id === this.sessionId)!;
          s.feedback = v("feedback");
          s.understanding = v("understanding");
        });
        this.view = "room";
        this.render();
      } else if (kind === "correct") {
        await this.change((d) => {
          correctTime(
            d.sessions.find((s) => s.id === this.sessionId)!,
            Number(v("minutes")),
          );
        });
        await this.reward(this.session()!);
        this.view = "room";
        this.render();
      }
    } finally {
      this.working = false;
    }
  }
  private async reward(session: StudySession) {
    if (session.status !== "ended") return;
    await navigator.locks.request("lingtian-game-rewards", () =>
      this.hooks.updateGame((s) => {
        const records = s.companion.rewards,
          existing = records[session.id],
          eligible = session.elapsedMs >= 1500000;
        if (existing?.applied && !eligible) {
          s.affinity[session.npcId] = Math.max(
            0,
            (s.affinity[session.npcId] ?? 0) - 1,
          );
          existing.applied = false;
        }
        if (
          eligible &&
          !existing?.applied &&
          !Object.entries(records).some(
            ([id, r]) =>
              id !== session.id &&
              r.day === dayKey(session.startedAt) &&
              r.npcId === session.npcId &&
              r.applied,
          )
        ) {
          s.affinity[session.npcId] = (s.affinity[session.npcId] ?? 0) + 1;
          records[session.id] = {
            day: dayKey(session.startedAt),
            npcId: session.npcId,
            applied: true,
          };
        }
      }),
    );
  }
  private async createJob(
    kind: Generation["kind"],
    text: string,
    remember = false,
  ) {
    const s = await this.ensure(),
      session =
        kind === "during" || kind === "ending" ? this.session() : undefined,
      npc = session?.npcId ?? this.npc,
      id = uid(),
      key = this.draftKey();
    const job = await this.change((d) => {
      if (d.jobs.some((j) => j.state === "pending"))
        throw Error("请等待当前回复或先取消");
      if (kind === "ending") {
        const se = d.sessions.find((x) => x.id === session?.id);
        if (!se || se.status !== "ended" || se.ending !== "waiting")
          throw Error("结束章节状态已改变");
      }
      const completed = new Set(
        d.jobs.filter((j) => j.state === "complete").map((j) => j.id),
      );
      const history = d.messages
        .filter(
          (m) =>
            m.npcId === npc &&
            (session ? m.sessionId === session.id : !m.sessionId) &&
            (!m.jobId || completed.has(m.jobId)),
        )
        .slice(-16)
        .map((m) => ({ role: m.role, text: m.text }));
      const body = {
        id,
        profileId: this.profile,
        npcId: npc,
        kind,
        text,
        mode: session?.mode ?? "together",
        scene: session?.scene ?? "静室",
        length: session?.length ?? "standard",
        minutes: session ? Number(minutes(elapsed(session))) : 0,
        player: {
          name: s.name,
          surname: s.nameParts?.surname,
          givenName: s.nameParts?.givenName,
          gender: s.gender,
          affinity: s.affinity[npc] ?? 0,
          romance: s.companion.romances.includes(npc),
          events: s.events.filter(
            (e) =>
              e === npc || e.startsWith(npc + "-") || e.startsWith("chapter-"),
          ),
        },
        completedEvents: [
          PEOPLE.find((p) => p.id === npc)!.event,
          ...FRIEND_STORIES[npc],
        ].filter((_, i) =>
          s.events.includes(i === 0 ? npc : npc + "-" + (i + 1)),
        ),
        memory: d.memories[npc].text,
        previousStory: d.chapters
          .filter((c) => c.npcId === npc && c.sessionId !== session?.id)
          .slice(-1)
          .map((c) => c.text.slice(-4000))
          .join(""),
        history,
      };
      const j: Generation = {
        id,
        npcId: npc,
        kind,
        sessionId: session?.id ?? "",
        state: "pending",
        error: "",
        partial: "",
        body,
        applied: false,
      };
      d.jobs.push(j);
      if (text && kind !== "test") {
        d.messages.push({
          id: uid(),
          npcId: npc,
          role: "user",
          text,
          createdAt: Date.now(),
          sessionId: session?.id,
          jobId: id,
        });
        d.drafts[key] = "";
        if (remember)
          d.memories[npc] = {
            text: (d.memories[npc].text + "\n玩家原话：" + text).slice(-4000),
            updatedAt: Date.now(),
          };
      }
      if (session && kind === "ending") {
        const se = d.sessions.find((x) => x.id === session.id)!;
        se.ending = "generating";
        se.endingJobId = id;
      }
      return j;
    });
    clearTimeout(this.draftTimer);
    await this.dispatch(job);
  }
  private async dispatch(j: Generation) {
    try {
      await api("companion/" + (j.kind === "test" ? "test" : "jobs"), j.body);
    } catch (e) {
      await this.change((d) => {
        const job = d.jobs.find((x) => x.id === j.id)!;
        job.error = "请求尚未确认，正在检查任务状态。" + (e as Error).message;
      });
    }
    this.patch();
  }
  private async poll() {
    const job = this.data?.jobs.find((j) => j.state === "pending");
    if (!job) return;
    const id = this.profile;
    let result: { status: string; text?: string; error?: string };
    let uncertain = false;
    try {
      result = await api(
        `companion/jobs/${job.id}?profileId=${encodeURIComponent(id)}`,
      );
    } catch (e) {
      uncertain = !(e as Error).message.includes("未找到");
      result = {
        status: "failed",
        error:
          "无法恢复任务。请检查服务后手动重试；未确认的请求可能已被提供方处理。" +
          (e as Error).message,
      };
    }
    if (id !== this.profile) return;
    let structural = false;
    await this.change((d) => {
      const j = d.jobs.find((x) => x.id === job.id);
      if (!j || j.applied) return;
      if (["queued", "running"].includes(result.status)) {
        j.partial = result.text ?? "";
        return;
      }
      structural = j.kind === "ending";
      j.state =
        result.status === "complete"
          ? "complete"
          : result.status === "cancelled"
            ? "cancelled"
            : "failed";
      j.error = result.error ?? "";
      j.partial = "";
      j.applied = true;
      j.uncertain = uncertain;
      const session = d.sessions.find((s) => s.id === j.sessionId);
      if (j.state === "complete") {
        if (j.kind === "ending" && session) {
          session.ending = "complete";
          d.chapters.push({
            id: j.id,
            sessionId: session.id,
            npcId: j.npcId,
            mode: session.mode,
            title: `${profiles.find((p) => p.id === j.npcId)!.name} · ${session.scene}相伴 · ${new Date(session.createdAt).toLocaleDateString()}`,
            text: result.text ?? "",
            createdAt: Date.now(),
            minutes: Number(minutes(session.elapsedMs)),
            favorite: false,
            readPosition: 0,
          });
        } else if (j.kind !== "test")
          d.messages.push({
            id: j.id,
            npcId: j.npcId,
            role: "assistant",
            text: result.text ?? "",
            createdAt: Date.now(),
            sessionId: j.sessionId || undefined,
            jobId: j.id,
          });
      } else if (j.kind === "ending" && session) session.ending = "failed";
    });
    if (structural && this.visible && this.view === "room") this.render();
    else this.patch();
  }
  private async tick() {
    if (this.ticking || this.working || !this.hooks.getSave()) return;
    this.ticking = true;
    try {
      await this.ensure();
      await this.refresh();
      if (this.data!.pendingDeletes.length) {
        const ids = this.data!.pendingDeletes.slice(0, 100);
        try {
          await api("companion/forget", { profileId: this.profile, ids });
          await this.change((d) => {
            d.pendingDeletes = d.pendingDeletes.filter(
              (id) => !ids.includes(id),
            );
          });
        } catch {
          /* Keep local deletion receipts until the service is available. */
        }
      }
      const session = this.data!.sessions.find(
        (s) => s.status === "running" && elapsed(s) >= s.durationMs,
      );
      if (session) {
        await this.change((d) => {
          const se = d.sessions.find((s) => s.id === session.id)!;
          if (se.status === "running" && elapsed(se) >= se.durationMs)
            finish(se, Date.now(), true);
        });
        await this.reward(
          this.data!.sessions.find((s) => s.id === session.id)!,
        );
        if (this.visible && this.view === "room") this.render();
      }
      const game = this.hooks.getSave()!;
      for (const ended of this.data!.sessions.filter(
        (s) =>
          s.status === "ended" &&
          s.elapsedMs >= 1500000 &&
          !game.companion.rewards[s.id] &&
          !Object.values(game.companion.rewards).some(
            (r) =>
              r.day === dayKey(s.startedAt) && r.npcId === s.npcId && r.applied,
          ),
      ))
        await this.reward(ended);
      await this.poll();
      if (!this.busyJob()) {
        const waiting = this.data!.sessions.find(
          (s) =>
            s.ending === "waiting" &&
            !this.data!.jobs.some((j) => j.sessionId === s.id && j.uncertain),
        );
        if (waiting) {
          const previous = this.sessionId;
          this.sessionId = waiting.id;
          try {
            await this.createJob("ending", "");
          } finally {
            this.sessionId = previous;
          }
        }
      }
    } catch (e) {
      if (this.visible) this.hooks.notify((e as Error).message);
    } finally {
      this.ticking = false;
    }
  }
  async exportBundle(s: SaveData) {
    const data = await readData(s.companion.profileId);
    return {
      format: "lingtian-complete",
      version: 1,
      game: s,
      companion: data,
    };
  }
  async prepareImport(raw: unknown, game: SaveData) {
    const bundle = raw as { format?: string; companion?: unknown };
    const data =
      bundle.format === "lingtian-complete"
        ? structuredClone(validateData(bundle.companion))
        : freshData(game.companion.profileId);
    // Write to a new namespace first. Only then may the caller switch the game save.
    const id = uid();
    game.companion.profileId = id;
    data.profileId = id;
    data.pendingDeletes = [];
    for (const j of data.jobs)
      if (j.state === "pending") {
        j.state = "failed";
        j.partial = "";
        j.error = "导入的生成任务未继续调用，可手动重试。";
        j.applied = true;
      }
    for (const j of data.jobs) j.uncertain = false;
    for (const j of data.jobs) j.body = { ...j.body, profileId: id };
    for (const s of data.sessions)
      if (["waiting", "generating"].includes(s.ending)) s.ending = "failed";
    await putData(data);
    return game;
  }
  private download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(
        new Blob([text], { type: type + ";charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
