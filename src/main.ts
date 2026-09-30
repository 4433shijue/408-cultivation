import { WEB_MODE, KEY_LOCATION } from "./runtime";
import { Companion } from "./companion/controller";
import type { NpcId } from "./companion/types";
import {
  FACILITIES,
  CHAPTER,
  weather,
  upgrade,
  waterAll,
  collectDrying,
  batchCraft,
  claimChapter,
  canPay,
  costText,
  visitor,
  welcomeVisitor,
  personLine,
} from "./progression";
import type { Facility } from "./progression";
import { sound } from "./audio";
import Phaser from "phaser";
import { Playfield } from "./playfield";
import { newBattle, selectBattleTile } from "./battle";
import { CROPS, ITEMS, LEVELS, ORDERS, PEOPLE, RECIPES } from "./content";
import type { Crop, Gender, Item, Tab } from "./content";
import {
  answer,
  breakthrough,
  chat,
  craft,
  craftPreview,
  deliver,
  loadSave,
  migrate,
  newSave,
  nextDay,
  onPlot,
  persist,
  rewardBattle,
  SAVE_KEY,
} from "./model";
import type { Question } from "./model";
import { api, available, online, questions, refreshQuestions } from "./api";
import "./style.css";
const loaded = loadSave();
let save = loaded.save;
let tab: Tab = "farm";
let busy = false;
let scene: Playfield | null = null;
let selectedGender: Gender = "female";
let selectedAnswer = -1;
let activeQuestion: Question | null = null;
let review = false;
let answeredResult: boolean | null = null;
let dialogKind = loaded.error ? "recovery" : save ? "" : "intro";
let sideClosed = false;
let toastTimer = 0;
let breakthroughPending = false;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (i: number, cls = "") =>
  `<img class="icon ${cls}" src="assets/${i < 36 ? "v2" : "v3"}/icon-${i}.png" alt="" draggable="false">`;
const btn = (text: string, action: string, cls = "", disabled = false) =>
  `<button class="${cls}" data-action="${action}" ${disabled ? "disabled" : ""}>${text}</button>`;
const tabs: { id: Tab; name: string; sub: string; icon: number }[] = [
  { id: "farm", name: "家园灵田", sub: "一方烟火", icon: 26 },
  { id: "craft", name: "百草作坊", sub: "草木成器", icon: 27 },
  { id: "battle", name: "山路历练", sub: "入山寻珍", icon: 28 },
  { id: "cultivate", name: "静室修炼", sub: "问道于心", icon: 29 },
  { id: "people", name: "青禾故人", sub: "此间相逢", icon: 30 },
];
$("#app").innerHTML =
  `<div class="game-shell"><header id="header"></header><div class="workspace"><section id="scene" class="scene farm"><div class="scene-shade"></div><div id="scene-heading"></div><div id="canvas"></div><div id="scene-content"></div><div id="scene-footer"></div><button id="side-toggle" data-action="toggle-side" title="收起或展开行程">行程</button></section><aside id="sidebar"></aside></div><nav id="nav"></nav></div><div id="modal-root"></div><div id="toast" role="status"></div><div class="rotate-note">横过屏幕，走进青禾村</div><input id="import-file" type="file" accept="application/json,.json" hidden>`;
const companion = new Companion({
  getSave: () => save,
  updateGame: (fn) => {
    if (!save) return;
    const latest = localStorage.getItem(SAVE_KEY);
    if (latest) save = migrate(JSON.parse(latest));
    fn(save);
    persist(save);
    render();
  },
  notify: message,
  closeGameModal: () => {
    closeModal();
    dialogKind = "companion";
  },
  onClose: () => {
    dialogKind = "";
  },
});
window.addEventListener("storage", (e) => {
  if (e.key === SAVE_KEY && e.newValue && !busy) {
    try {
      save = migrate(JSON.parse(e.newValue));
      render();
    } catch {
      message("另一窗口的存档无法读取，请导出当前进度。");
    }
  }
});
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1000,
  height: 650,
  parent: "canvas",
  transparent: true,
  scene: [Playfield],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
});
new ResizeObserver(() => game.scale.refresh()).observe($("#canvas"));
game.events.once("world-ready", () => {
  scene = game.scene.getScene("world") as Playfield;
  $("#canvas").dataset.ready = "true";
  render();
});
async function syncQuestions() {
  const snapshot = save;
  await refreshQuestions(snapshot);
  if (snapshot === save && save) persist(save);
}
function message(text: string) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => $("#toast").classList.remove("show"),
    3500,
  );
}
function commit() {
  if (save) {
    const grew = breakthrough(save);
    try {
      persist(save);
    } catch {
      message("自动保存失败，请立即导出存档。");
    }
    if (grew && dialogKind === "question") {
      breakthroughPending = true;
    } else if (grew) {
      dialogKind = "";
      showStory(
        "破境 · 灵息渐长",
        "五次领悟，一日日耕耘。灵气终于在经脉中连成一线。今后每块灵田的收获增加为 3 份。",
      );
    }
  }
  render();
}
function goal() {
  if (!save) return "在青禾村安顿下来";
  const t = save.tutorial;
  return !t.harvested
    ? "收获一块成熟灵草"
    : !t.crafted
      ? "制作一份灵茶"
      : !t.fought
        ? "去竹径取得星砂"
        : !t.answered
          ? "静心回答一道题"
          : !t.chatted
            ? "与一位道友交谈"
            : !save.breakthrough
              ? "积累 50 修为，完成首次突破"
              : (CHAPTER[save.home.chapter]?.hint ?? "泉暖青禾 · 首章已完成");
}
function render() {
  const s = save;
  document.body.classList.toggle("reduced-motion", s?.reducedMotion ?? false);
  $(".workspace").classList.toggle("side-closed", sideClosed);
  $("#header").innerHTML =
    `<div class="brand"><span class="seal">灵</span><div><small>青禾村 · 山居岁月</small><h1>灵田异闻</h1></div></div>${s ? `<div class="profile"><img src="assets/v2/hero-${s.gender}.png" alt="主角"><div><strong>${esc(s.name)}</strong><small>${s.breakthrough ? "炼气中境" : "炼气初境"} · 第 ${s.day} 日 · ${weather(s)}</small></div></div><div class="resources"><span>${icon(31)}${s.coins}<small>灵石</small></span><span>${icon(32)}${s.seeds}<small>种子</small></span><div class="qi"><small>修为 ${s.qi} / ${s.breakthrough ? 100 : 50}</small><div><i style="width:${Math.min(100, (s.qi / (s.breakthrough ? 100 : 50)) * 100)}%"></i></div></div></div>` : '<p class="tagline">栽一畦灵草，问一程仙途</p>'}${btn(icon(35) + "<span>设置</span>", "settings", "settings-button")}`;
  $("#nav").innerHTML = tabs
    .map(
      (t) =>
        `<button data-tab="${t.id}" class="${tab === t.id ? "active" : ""}" ${!s || busy ? "disabled" : ""}>${icon(t.icon)}<span>${t.name}<small>${t.sub}</small></span></button>`,
    )
    .join("");
  $("#scene").className =
    "scene " +
    tab +
    (s && weather(s) === "雨" && ["farm", "people", "battle"].includes(tab)
      ? " rainy"
      : "");
  if (s) sound.weather(weather(s) === "雨");
  const t = tabs.find((t) => t.id === tab)!;
  $("#scene-heading").innerHTML =
    `<small>青禾村 / ${t.name}</small><h2>${t.name}</h2><p>${tab === "farm" ? (s && weather(s) === "雨" ? "雨落檐前，九畦同润。" : "晨露未晞，草木正好。") : tab === "battle" ? "循着山风，去寻一捧星砂。" : tab === "craft" ? "把田间的收获，做成日子的滋味。" : tab === "cultivate" ? "世人听风，你听见另一种答案。" : "山水之间，总有人记得你。"}</p>`;
  $("#canvas").classList.toggle(
    "inactive",
    !s || !["farm", "battle"].includes(tab),
  );
  if (s)
    scene?.show(tab, s, (i) => {
      void handleTile(i);
    });
  $("#scene-content").innerHTML = s ? sceneHTML() : "";
  $("#scene-footer").innerHTML = s ? footerHTML() : "";
  $("#sidebar").innerHTML = s
    ? sidebarHTML()
    : `<div class="side-title">山居手记</div><p>一段新的故事，即将在这里开始。</p>`;
  requestAnimationFrame(() => game.scale.refresh());
}
function sceneHTML() {
  const s = save!;
  if (tab === "farm")
    return `<img class="cloud-layer" src="assets/v2/fx-0.png" alt=""><div class="rain-layer"></div><div class="farm-caption">${weather(s) === "雨" ? "雨水润田 · 新播种也无需浇水" : "点田块播种、浇水或收获"}</div><div class="home-props">${Object.entries(
      FACILITIES,
    )
      .map(
        ([id, f]) =>
          `<button class="home-prop prop-${id}" data-action="home"><img src="assets/v3/facility-${f.art + (s.home.facilities[id as Facility] ? 1 : 0)}.png" alt="${f.name}"><span>${f.name}${s.home.facilities[id as Facility] ? " · 已修缮" : " · 待修缮"}</span></button>`,
      )
      .join(
        "",
      )}</div>${s.events.includes("yu-3") || s.home.chapter === 6 ? '<img class="garden-lantern" src="assets/v3/facility-6.png" alt="泉边石灯">' : ""}${s.events.includes("shen-3") || s.home.chapter === 6 ? '<img class="garden-table" src="assets/v3/facility-7.png" alt="故人茶桌">' : ""}${visitor(s) && !s.home.visits.includes(`visit-${s.day}`) ? btn(`${visitor(s)!.name} 来访`, "visit", "visitor-button") : ""}`;
  if (tab === "battle")
    return `<img class="enemy ${s.battle?.status === "won" ? "defeated" : ""}" src="assets/v2/beast.png" alt="山魈"><div class="enemy-card"><strong>守山山魈</strong><span>${s.battle ? `气血 ${s.battle.hp} · 余 ${s.battle.moves} 步` : "胜利取得星砂；失败可重试"}</span></div>${!s.battle ? `<div class="battle-start paper"><h3>沿山路而行</h3><p>交换相邻灵纹，三枚相连即可攻击。每消除一枚造成 2 点伤害；用尽步数前击退山魈。</p>${LEVELS.map((l, i) => btn(`${l.name} · ${l.reward} 星砂`, "battle-" + i, "primary", i > 0 && !s.tutorial.fought)).join("")}</div>` : s.battle.status !== "playing" ? `<div class="battle-result paper"><h3>${s.battle.status === "won" ? "山风送归人" : "暂且歇一歇"}</h3><p>${s.battle.status === "won" ? `收获 ${LEVELS[s.battle.level].reward} 星砂，已放入背包。` : "本局以外的进度都还在。"}</p>${btn("再入山路", "battle-menu", "primary")}</div>` : ""}`;
  if (tab === "craft")
    return `<div class="craft-surface"><div class="craft-grid">${s.board.map((i, n) => `<button class="craft-cell" data-cell="${n}" aria-label="制作格 ${n + 1}${i ? " " + ITEMS[i].name : ""}">${i ? icon(ITEMS[i].icon) + `<small>${ITEMS[i].name}</small>` : '<span class="slot-dot"></span>'}</button>`).join("")}</div><div class="craft-result paper"><small>合成预览</small>${craftPreview(s) ? icon(ITEMS[craftPreview(s)!.output].icon) + `<h3>${ITEMS[craftPreview(s)!.output].name}</h3>` : "<h3>等待草木相逢</h3><p>从背包拖入材料，也可选中后点击空格。</p>"}${btn("合成成品", "craft", "primary", !craftPreview(s))}${btn("收回材料", "clear-board", "text-button")}${s.home.facilities.workshop ? btn("批量制作 · 三份", "batch-menu") : ""}${s.home.drying.length ? btn("查看晾晒架", "home") : ""}</div></div>`;
  if (tab === "cultivate")
    return `<img class="meditating" src="assets/v2/meditate-${s.gender}.png" alt="主角静坐"><img class="aura" src="assets/v2/fx-3.png" alt=""><div class="cultivation-card paper"><small>仅你可见的系统</small><h3>识海问道</h3><p>答对，修为增长。答错，读过解析后再继续今天的生活。</p><div class="cultivation-count"><b>${s.qi}</b><span>修为 · ${available(s).length} 道待学新题</span></div>${btn(s.cultivatedOn === s.day ? "今日已修炼" : "开始修炼", "question", "primary", s.cultivatedOn === s.day || !available(s).length)}<div class="button-row">${btn(`待答 ${s.pending.length}`, "pending")}${btn("作答与复习", "history")}</div><small>${online ? "题库已就绪" : "离线题库可用"} · 每题只结算一次</small></div>`;
  return `<div class="people-stage">${PEOPLE.map((p, i) => `<button class="person-card" data-person="${p.id}"><img src="assets/v2/person-${i}-${(s.affinity[p.id] ?? 0) >= 3 ? 1 : 0}.webp" alt="${p.name}"><div><small>${p.role}</small><h3>${p.name}</h3><span>熟络 ${s.affinity[p.id] ?? 0} · ${s.events.includes(p.id + "-3") ? "知交" : s.events.includes(p.id + "-2") ? "相知" : s.events.includes(p.id) ? "已结缘" : "初相识"}</span></div></button>`).join("")}</div>`;
}
function footerHTML() {
  const s = save!;
  if (tab === "farm")
    return `<div class="farm-tools">${btn(icon(CROPS[s.selectedCrop].icon + 2) + CROPS[s.selectedCrop].name + " · 换种", "crops", "chosen")}${btn("家园修缮", "home")}${btn("引泉浇田", "water-all", "", !s.home.facilities.spring)}${btn("施灵壤", "fertilize", "", s.inventory.fertilizer === 0)}${btn("歇息 · 下一日", "sleep", "primary")}</div>`;
  if (tab === "battle")
    return '<div class="scene-hint">点选相邻两枚灵纹交换 · 无消除会退回 · 胜利奖励只发放一次</div>';
  return "";
}
function sidebarHTML() {
  const s = save!,
    order = ORDERS[s.orderIndex];
  return `<div class="side-title"><small>今日行程</small><h3>山居手记</h3></div><div class="goal"><span class="gold-dot"></span><div><small>当前目标</small><strong>${goal()}</strong></div></div>${btn("首章 · " + (CHAPTER[s.home.chapter]?.title ?? "泉暖青禾"), "chapter", "chapter-button")}${btn("草木图鉴 / 配方记录", "journal", "text-button")}<div class="side-section"><div class="section-label"><h4>随身行囊</h4><small>点选 · 锁定</small></div><div class="inventory">${Object.entries(
    ITEMS,
  )
    .map(
      ([id, it]) =>
        `<div class="inventory-item"><button draggable="${s.inventory[id as Item] > 0 && !s.locked.includes(id as Item)}" data-item="${id}" class="${s.selectedItem === id ? "selected" : ""}" title="${it.name}">${icon(it.icon)}<span>${it.name}</span><b>${s.inventory[id as Item]}</b></button><button data-lock="${id}" class="lock" aria-label="${s.locked.includes(id as Item) ? "解锁" : "锁定"}${it.name}">${s.locked.includes(id as Item) ? "已锁" : "锁定"}</button></div>`,
    )
    .join("")}</div></div>${
    tab === "craft"
      ? `<div class="side-section"><h4>配方册</h4>${RECIPES.map(
          (r) =>
            `<button class="recipe" data-recipe="${r.id}">${icon(ITEMS[r.output].icon)}<span><strong>${ITEMS[r.output].name}${r.facility && !s.home.facilities[r.facility] ? " · 待修缮" : ""}</strong><small>${Object.entries(
              r.inputs,
            )
              .map(
                ([k, v]) =>
                  `${ITEMS[k as Item].name} ${s.inventory[k as Item]}/${v}`,
              )
              .join(" · ")}</small></span></button>`,
        ).join("")}</div>`
      : `<div class="side-section order"><small>村中委托 · 可反复交付</small><h4>${order.name}</h4><p>${ITEMS[order.item].name} × ${order.count} <span>→ ${order.coins} 灵石</span></p><div class="button-row">${btn("交付", "order", "primary", s.inventory[order.item] < order.count || s.locked.includes(order.item))}${btn("换一份", "next-order")}</div></div>`
  }<div class="side-section"><h4>补给小铺</h4><div class="button-row">${btn("免费种子", "seed-gift", "", s.seeds > 0)}${btn("兑换星砂 · 8灵石", "buy-ore", "", s.coins < 8)}</div>${btn("出售选中物品", "sell", "text-button", s.inventory[s.selectedItem] === 0 || s.locked.includes(s.selectedItem))}</div><p class="side-note">所有草木按游戏日生长。<br>离开多久，也不会枯萎。</p>`;
}
function cropPicker() {
  const s = save!;
  dialogKind = "crops";
  modal(
    `<div class="modal-head"><h2>今日种些什么</h2>${btn("返回", "close")}</div><p>共用基础种子，每畦消耗一粒；雨天无需另行浇水。</p><div class="collection-grid">${Object.entries(
      CROPS,
    )
      .map(
        ([id, c]) =>
          `<button data-crop="${id}" ${id !== "herb" && !s.tutorial.crafted ? "disabled" : ""}>${icon(c.icon + 2)}<strong>${c.name}</strong><small>${c.days}个浇水日成熟 · ${s.home.harvested.includes(id) ? "已收获" : "尚待相识"}</small></button>`,
      )
      .join("")}</div><p>完成第一份灵茶后，六种作物全部开放。</p>`,
  );
}
function homeModal() {
  const s = save!;
  dialogKind = "home";
  modal(
    `<div class="modal-head"><div><small>让小院慢慢长成家</small><h2>家园修缮</h2></div>${btn("返回", "close")}</div><div class="facility-grid">${Object.entries(
      FACILITIES,
    )
      .map(
        ([id, f]) =>
          `<article><img src="assets/v3/facility-${f.art + (s.home.facilities[id as Facility] ? 1 : 0)}.png" alt="${f.name}"><h3>${f.name}</h3><p>${f.description}</p><small>${s.home.facilities[id as Facility] ? "修缮完成" : `${costText(f.cost)} · ${f.coins}灵石`}</small>${btn(s.home.facilities[id as Facility] ? "已修缮" : "动手修缮", "upgrade:" + id, "primary", s.home.facilities[id as Facility] || !canPay(s, f.cost, f.coins))}</article>`,
      )
      .join(
        "",
      )}</div><div class="drying-status"><h3>檐下晾晒 · ${s.home.drying.reduce((n, d) => n + d.count, 0)} / 3</h3><p>${s.home.drying.length ? s.home.drying.map((d) => `${d.count}份静心干草 · ${d.readyOn <= s.day ? "已晾好" : `第${d.readyOn}日可收`}`).join("；") : "修好晾晒架后，在作坊用青灵草与薄荷配制。"}</p>${btn("收取干草", "collect-drying", "", !s.home.drying.some((d) => d.readyOn <= s.day))}</div>`,
    true,
  );
}
function chapterModal() {
  const s = save!,
    c = CHAPTER[s.home.chapter];
  dialogKind = "chapter";
  modal(
    `<div class="modal-head"><small>第一章 · 旧泉新声 · ${Math.min(s.home.chapter + 1, 6)} / 6</small>${btn("返回", "close")}</div>${
      c
        ? `<h2>${c.title}</h2><p class="story-text">${c.text}</p><div class="chapter-task"><strong>${c.hint}</strong><p>${Object.entries(
            c.cost,
          )
            .map(
              ([id, n]) =>
                `${ITEMS[id as Item].name} ${s.inventory[id as Item]}/${n}`,
            )
            .join(
              " · ",
            )}</p><small>完成奖励 ${c.reward} 灵石、3 粒种子 · 无期限</small></div>${btn("完成这一段行程", "claim-chapter", "primary", !c.ready(s) || !canPay(s, c.cost))}`
        : `<h2>泉暖青禾</h2><img class="chapter-ending" src="assets/v3/ending.webp" alt="三位故人在复苏的灵泉旁相聚"><p class="story-text">旧泉重新流过院角。有人来借一盏茶，有人顺路放下一包种子。你终于不再只是经过这里的人。</p><p>首章完成。石灯与茶桌已安放在院中，种田、委托、修炼与友情故事仍可继续。</p>`
    }<div class="chapter-road">${CHAPTER.map((step, i) => `<span class="${i < s.home.chapter ? "done" : ""}">${i < s.home.chapter ? "已记下" : i === s.home.chapter ? "正在写" : "待续"} · ${step.title}</span>`).join("")}</div>`,
    !c,
  );
}
function journalModal() {
  const s = save!;
  dialogKind = "journal";
  modal(
    `<div class="modal-head"><h2>草木与烟火</h2>${btn("返回", "close")}</div><h3>收获图鉴 · ${s.home.harvested.length} / 6</h3><div class="collection-grid">${Object.entries(
      CROPS,
    )
      .map(
        ([id, c]) =>
          `<article>${icon(c.icon + 2)}<strong>${c.name}</strong><small>${c.days}个浇水日 · ${s.home.harvested.includes(id) ? "已收获" : "未记录"}</small></article>`,
      )
      .join(
        "",
      )}</div><h3>制作记录 · ${s.home.crafted.length} / 8</h3><div class="collection-grid">${RECIPES.map((r) => `<article>${icon(ITEMS[r.output].icon)}<strong>${ITEMS[r.output].name}</strong><small>${s.home.crafted.includes(r.output) ? "已制成" : "尚待尝试"}</small><small>${costText(r.inputs)}</small></article>`).join("")}</div><p>旧档未记录的收获与制作不作推测，下一次操作会记入手册。</p>`,
    true,
  );
}
function batchModal() {
  const s = save!;
  dialogKind = "batch";
  modal(
    `<div class="modal-head"><h2>三份同制</h2>${btn("返回", "close")}</div><p>使用背包里的材料，制作盘里的材料可先收回。</p><div class="collection-grid">${RECIPES.map(
      (r) => {
        const cost = Object.fromEntries(
          Object.entries(r.inputs).map(([k, n]) => [k, n! * 3]),
        );
        return `<article>${icon(ITEMS[r.output].icon)}<strong>${ITEMS[r.output].name} ×3</strong><small>${costText(cost)}</small>${btn(r.output === "dried" ? "挂上晾晒架" : "制作三份", "batch:" + r.id, "", !canPay(s, cost) || (!!r.facility && !s.home.facilities[r.facility]) || (r.output === "dried" && s.home.drying.length > 0))}</article>`;
      },
    ).join("")}</div>`,
  );
}
function modal(html: string, wide = false) {
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</section></div>`;
  requestAnimationFrame(() =>
    $("#modal-root").querySelector<HTMLElement>("input,button")?.focus(),
  );
}
function closeModal() {
  dialogKind = "";
  $("#modal-root").innerHTML = "";
  activeQuestion = null;
}
function showStory(title: string, text: string, portrait?: string) {
  dialogKind = "story";
  modal(
    `${portrait ? `<img class="dialog-portrait" src="${portrait}" alt="道友">` : ""}<small>灵田异闻 · 此间相逢</small><h2>${esc(title)}</h2><p class="story-text">${esc(text)}</p>${btn("记在心里", "close", "primary")}`,
  );
}
function onboarding() {
  if (dialogKind === "intro")
    modal(
      `<small>序章 / 那道不该出现的题</small><h2>一梦入青禾</h2><img class="opening-comic" src="assets/v2/comic.webp" alt="深夜读书、书页发光、触碰穿越、醒在灵田四格漫画"><p>书页间忽然亮起陌生的光。再睁眼时，山风已吹过指尖。</p>${btn("继续", "gender", "primary")}`,
      true,
    );
  else if (dialogKind === "gender")
    modal(
      `<small>异世来客</small><h2>以谁的模样醒来？</h2><div class="gender-options"><button data-gender="female"><img src="assets/v2/hero-female.png" alt="女主角"><strong>女主角</strong></button><button data-gender="male"><img src="assets/v2/hero-male.png" alt="男主角"><strong>男主角</strong></button></div><p>形象决定外观与称谓，不限制你对谁心动。</p>`,
      true,
    );
  else if (dialogKind === "name")
    modal(
      `<small>此界的新名字</small><h2>村人该如何称呼你？</h2><form id="name-form"><label for="player-name">名字 · 1 至 12 字</label><input id="player-name" maxlength="12" required autocomplete="off" placeholder="写下你的名字"><button class="primary" type="submit">走进青禾村</button></form>${btn("返回选角", "gender", "text-button")}`,
    );
  else if (dialogKind === "recovery")
    modal(
      `<h2>先把回忆收好</h2><p>${esc(loaded.error)}</p>${btn("导出原始存档", "export-raw")}${btn("导入备份", "import")}${btn("重新开始", "reset", "danger")}`,
    );
}
function openQuestion(id?: string, isReview = false) {
  if (!save) return;
  review = isReview;
  activeQuestion = id
    ? (questions.find((q) => q.id === id) ??
      save.answers.find((a) => a.id === id)?.question ??
      null)
    : (available(save).find((q) => !save!.pending.includes(q.id)) ??
      available(save)[0] ??
      null);
  if (!activeQuestion) {
    message("暂无可用题目，可以继续经营或补充题库。");
    return;
  }
  if (!review && save.cultivatedOn === save.day) {
    message("今日修炼已完成，明日再来。");
    return;
  }
  selectedAnswer = -1;
  answeredResult = null;
  dialogKind = "question";
  questionModal();
}
function questionModal() {
  const q = activeQuestion!;
  modal(
    `<div class="modal-head"><small>${esc(q.subject)} · ${review ? "温故知新" : "识海问答"}</small>${btn("稍后", "defer", "text-button", answeredResult !== null)}</div><h2>${review ? "再读一遍，亦有所得" : "静心一问"}</h2><p class="question-stem">${esc(q.stem)}</p><div class="answer-list">${q.options.map((o, i) => `<button class="answer-choice ${selectedAnswer === i ? "selected" : ""} ${answeredResult !== null && i === q.answer ? "correct" : ""}" data-answer="${i}" ${answeredResult !== null ? "disabled" : ""}><b>${"ABCD"[i]}</b>${esc(o)}</button>`).join("")}</div>${answeredResult === null ? btn("确认答案", "submit-answer", "primary", selectedAnswer < 0) : `<div class="explanation"><strong>${answeredResult ? "回答正确" : "本次未答对"} · ${review ? "复习不重复发放修为" : answeredResult ? "修为 +10" : "修为不变"}</strong><p>正确答案 ${"ABCD"[q.answer]}。${esc(q.explanation)}</p></div>${btn("继续今日行程", "close-result", "primary")}${btn("题目有误 · 暂停投放", "report", "text-button")}`}`,
  );
}
function showHistory(pending = false) {
  const s = save!;
  dialogKind = "history";
  modal(
    `<div class="modal-head"><h2>${pending ? "留待细想" : "修习手记"}</h2>${btn("返回", "close", "text-button")}</div><div class="history-list">${
      pending
        ? s.pending
            .map((id) => {
              const q = questions.find((q) => q.id === id);
              return `<div class="pending-row"><button data-question="${esc(id)}">${esc(q?.stem ?? "该题暂不可用")}${!q ? "（已退库或离线缺失）" : ""}</button><button data-remove-pending="${esc(id)}">移出待答</button></div>`;
            })
            .join("")
        : s.answers
            .map(
              (a) =>
                `<button data-review="${esc(a.id)}"><strong>${a.correct === null ? "旧档 · 答案未记录" : a.correct ? "已掌握" : "待复习"}</strong><span>${esc(a.question?.stem ?? questions.find((q) => q.id === a.id)?.stem ?? a.id)}</span></button>`,
            )
            .join("") || "<p>尚无作答记录。</p>"
    }</div>`,
  );
}
async function settings() {
  dialogKind = "settings";
  modal(
    `<div class="modal-head"><h2>山居设置</h2>${btn("返回", "close", "text-button")}</div><div class="settings-grid"><section><h3>进度与体验</h3><p>进度保存在当前浏览器。更换浏览器前请导出。</p><div class="button-row">${btn("导出存档", "export")}${btn("导入存档", "import")}</div>${btn(save?.reducedMotion ? "恢复动态效果" : "减少动态效果", "motion")}${btn(save?.home.sound ? "关闭环境音效" : "开启环境音效", "sound")}${btn("AI 道友设置", "companion-config")}${btn("课程与共修", "companion-setup")}${btn("删除存档并重开", "reset", "danger")}<hr><h3>题库与批次</h3><div id="service-status">${WEB_MODE ? "正在读取浏览器题库…" : "正在连接本机服务…"}</div><div class="button-row">${btn("生成一批", "generate")}${btn("停止生成", "cancel-generation")}</div><div class="button-row">${btn("导出题库", "export-questions")}${btn("人工抽检", "review-questions")}</div></section><section><h3>AI 题库接口</h3><p>未配置也能使用 24 道基础题。每批最多 10 道，每次${WEB_MODE ? "页面" : "服务"}会话最多 3 批；调用可能产生费用。${WEB_MODE ? "网页版由你的浏览器直连所填接口，需支持HTTPS和跨域；刷新后重新填写密钥。" : ""}</p><form id="api-form"><label>兼容接口地址<input name="baseUrl" type="url" required placeholder="https://你的服务/v1"></label><label>文本模型<input name="model" required placeholder="填写文本模型标识"></label><label>密钥 · 只在${KEY_LOCATION}保存<input name="key" type="password" required autocomplete="off"></label><label class="checkbox"><input name="auto" type="checkbox"> 可用新题少于 10 道时自动补充</label><button class="primary" type="submit">保存本次会话配置</button></form><div class="button-row">${btn("测试连接", "test-api")}${btn("清除密钥", "clear-key")}</div></section></div>`,
    true,
  );
  await status();
}
async function status() {
  try {
    const d = await api("status");
    const el = document.querySelector("#service-status");
    if (el)
      el.innerHTML = `<p>${d.configured ? "接口已配置" : "未配置接口"} · 可用 ${d.available} 道 · 隔离 ${d.quarantined} 道</p><p>批次 ${d.used}/${d.limit} · 请求 ${d.calls} 次</p>${d.batches.map((b: any) => `<div class="batch">${esc(({ queued: "排队", generating: "生成中", validating: "校验中", completed: "完成", partial: "部分通过", failed: "失败", cancelled: "已取消" } as Record<string, string>)[b.status] ?? b.status)} · 通过 ${b.approved} / 隔离 ${b.quarantined}${b.error ? `<small>${esc(b.error)}</small>` : ""}</div>`).join("")}`;
    if (dialogKind === "settings") {
      const f = $<HTMLFormElement>("#api-form");
      if (
        f &&
        !(f.elements.namedItem("baseUrl") as HTMLInputElement)?.getAttribute(
          "data-filled",
        )
      ) {
        const input = f.elements.namedItem("baseUrl") as HTMLInputElement;
        input.value = d.baseUrl;
        input.dataset.filled = "true";
        (f.elements.namedItem("model") as HTMLInputElement).value = d.model;
        (f.elements.namedItem("auto") as HTMLInputElement).checked = d.auto;
      }
    }
  } catch {
    const el = document.querySelector("#service-status");
    if (el) el.textContent = "本机服务未连接；离线玩法仍可使用。";
  }
}
async function showReviews() {
  const data = await api("review");
  dialogKind = "audit";
  modal(
    `<div class="modal-head"><h2>题目抽检与纠错</h2>${btn("返回设置", "settings", "text-button")}</div><p>自动通过不保证正确性。核对答案和解析后填写依据，记录会保存在${WEB_MODE ? "当前浏览器" : "本机题库"}。</p><div class="history-list">${data.questions.map((r: any) => `<article class="audit"><small>${esc(r.status)} · ${esc(r.reason)}</small><h4>${esc(r.question.stem ?? "格式异常")}</h4><p>${esc(JSON.stringify(r.question.options))}</p><p>答案 ${esc(r.question.answer)} · ${esc(r.question.explanation)}</p><form data-audit="${esc(r.id)}"><input name="note" required placeholder="填写核查依据与结论"><select name="status"><option value="retired">废弃</option><option value="approved">确认通过</option></select><button type="submit">保存复核</button></form></article>`).join("") || "<p>尚无 AI 生成题目。</p>"}</div>`,
    true,
  );
}
function download(name: string, data: string) {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function handleTile(index: number) {
  if (!save || busy || dialogKind) return;
  if (tab === "farm") {
    const p = save.plots[index],
      harvest = !!p.crop && p.stage >= CROPS[p.crop].days;
    message(onPlot(save, index));
    scene?.pulse(index, harvest);
    sound.effect(harvest ? "harvest" : "water");
    commit();
  } else if (tab === "battle" && save.battle) {
    const b = save.battle,
      first = b.selected;
    const result = selectBattleTile(b, index);
    busy = true;
    try {
      if (first !== null && first !== index && result !== "selected")
        await scene?.exchange(first, index, result !== "invalid");
      if (rewardBattle(save))
        message(`历练有得，${LEVELS[b.level].reward} 星砂已入行囊。`);
      else if (result === "invalid") message("未连成三枚，交换已退回。");
      commit();
      if (result === "matched" || result === "won") scene?.drop();
    } finally {
      busy = false;
      render();
    }
  }
}
function addMaterial(item: Item, index: number) {
  const s = save!;
  if (s.board[index] || s.inventory[item] < 1 || s.locked.includes(item))
    return;
  s.inventory[item]--;
  s.board[index] = item;
  commit();
}
async function action(id: string) {
  if (busy) return;
  if (id.startsWith("companion-")) {
    await companion.open(undefined, id.slice(10));
    return;
  }
  if (id === "settings") {
    await settings();
    return;
  }
  if (id === "close") {
    if (!save) {
      dialogKind = loaded.error ? "recovery" : "intro";
      onboarding();
      return;
    }
    closeModal();
    return;
  }
  if (id === "gender") {
    dialogKind = "gender";
    onboarding();
    return;
  }
  if (id === "import") {
    $<HTMLInputElement>("#import-file").click();
    return;
  }
  if (id === "export-raw") {
    download(
      "灵田异闻-原始备份.json",
      localStorage.getItem(SAVE_KEY) ??
        localStorage.getItem("lingtian-408-save-v2") ??
        localStorage.getItem("lingtian-408-save-v1") ??
        "{}",
    );
    return;
  }
  if (id === "reset") {
    dialogKind = "reset";
    modal(
      `<h2>离开这段山居岁月？</h2><p>建议先导出存档。删除后将重新观看开场并创建角色。</p>${btn("导出原始存档", "export-raw")}${btn("确认删除并重新开始", "confirm-reset", "danger")}${btn("返回", "close")}`,
    );
    return;
  }
  if (id === "confirm-reset") {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem("lingtian-408-save-v1");
    localStorage.removeItem("lingtian-408-save-v2");
    save = null;
    void sound.set(false);
    tab = "farm";
    dialogKind = "intro";
    render();
    onboarding();
    return;
  }
  if (id === "generate") {
    await api("batches", {});
    await status();
    return;
  }
  if (id === "cancel-generation") {
    await api("cancel", {});
    await status();
    return;
  }
  if (id === "clear-key") {
    await api("config", { clear: true });
    await status();
    return;
  }
  if (id === "test-api") {
    const d = await api("test", {});
    message(d.ok ? "连接与 JSON 响应正常" : "接口响应不符合预期");
    return;
  }
  if (id === "export-questions") {
    download(
      "灵田异闻-题库.json",
      JSON.stringify(await api("export"), null, 2),
    );
    return;
  }
  if (id === "review-questions") {
    await showReviews();
    return;
  }
  if (!save) return;
  if (id.startsWith("open-npc:")) {
    await companion.open(id.slice(9) as NpcId);
    return;
  }
  if (id.startsWith("study-npc:")) {
    await companion.open(id.slice(10) as NpcId, "setup");
    return;
  }
  const s = save;
  if (id === "crops") {
    cropPicker();
    return;
  }
  if (id === "home") {
    homeModal();
    return;
  }
  if (id === "chapter") {
    chapterModal();
    return;
  }
  if (id === "journal") {
    journalModal();
    return;
  }
  if (id === "batch-menu") {
    batchModal();
    return;
  }
  if (id.startsWith("batch:")) {
    const item = batchCraft(s, id.slice(6));
    commit();
    batchModal();
    sound.effect("craft");
    message(
      item === "dried"
        ? "三份干草已挂上晾晒架，明日收取。"
        : `制成 ${ITEMS[item].name} ×3`,
    );
    return;
  }
  if (id.startsWith("upgrade:")) {
    upgrade(s, id.slice(8) as Facility);
    commit();
    homeModal();
    sound.effect("craft");
    return;
  }
  if (id === "collect-drying") {
    const n = collectDrying(s);
    commit();
    homeModal();
    message(`收好 ${n} 份静心干草。`);
    return;
  }
  if (id === "claim-chapter") {
    const c = claimChapter(s);
    commit();
    chapterModal();
    sound.effect("harvest");
    message(`已完成${c.title}，获得${c.reward}灵石、3粒种子。`);
    return;
  }
  if (id === "visit") {
    const text = welcomeVisitor(s);
    commit();
    showStory("故人叩门", text);
    return;
  }
  if (id === "water-all") {
    waterAll(s);
    commit();
    sound.effect("water");
    message("泉水沿沟渠入田，九畦草木都已浇好。");
    return;
  }
  if (id === "sound") {
    s.home.sound = !s.home.sound;
    await sound.set(s.home.sound, weather(s) === "雨");
    commit();
    await settings();
    return;
  }
  if (id === "export") {
    download(
      `灵田异闻-${s.name}-第${s.day}日.json`,
      JSON.stringify(await companion.exportBundle(s), null, 2),
    );
    return;
  }
  if (id === "motion") {
    s.reducedMotion = !s.reducedMotion;
    commit();
    await settings();
    return;
  }
  if (id === "toggle-side") {
    sideClosed = !sideClosed;
    render();
    return;
  }
  if (id === "sleep") {
    nextDay(s);
    message(
      `第 ${s.day} 日 · ${weather(s)}。${weather(s) === "雨" ? "雨水已经浇透灵田。" : "山间又是一场好晨光。"}${s.home.drying.some((d) => d.readyOn <= s.day) ? "檐下干草可以收了。" : ""}${visitor(s) ? visitor(s)!.name + "今日会来串门。" : ""}`,
    );
  } else if (id === "seed-gift") {
    if (s.seeds === 0) {
      s.seeds = 3;
      message("领到 3 粒基础种子，随时可以重新耕种。");
    }
  } else if (id === "buy-ore") {
    if (s.coins >= 8) {
      s.coins -= 8;
      s.inventory.ore++;
    }
  } else if (id === "sell") {
    const i = s.selectedItem;
    if (s.inventory[i] && !s.locked.includes(i)) {
      s.inventory[i]--;
      s.coins += ITEMS[i].price;
    }
  } else if (id === "fertilize") {
    if (!s.inventory.fertilizer || s.locked.includes("fertilizer"))
      throw Error("灵壤不足或已锁定");
    const p = s.plots.find((p) => p.crop && p.stage < CROPS[p.crop].days);
    if (!p) throw Error("没有需要施肥的作物");
    s.inventory.fertilizer--;
    p.stage++;
    message("灵壤融入田间，作物长大了一些。");
  } else if (id === "craft") {
    const item = craft(s);
    message(
      item === "dried"
        ? "已挂上晾晒架，明日收取。"
        : `制成 ${ITEMS[item].name}`,
    );
    sound.effect("craft");
    requestAnimationFrame(() => $("#scene").classList.add("crafted"));
    setTimeout(() => $("#scene").classList.remove("crafted"), 650);
  } else if (id === "clear-board") {
    s.board.forEach((i) => {
      if (i) s.inventory[i]++;
    });
    s.board.fill(null);
  } else if (id === "order") {
    deliver(s);
    message("委托已完成，灵石与种子已入囊。");
  } else if (id === "next-order") {
    s.orderIndex = (s.orderIndex + 1) % 3;
  } else if (id === "battle-menu") {
    s.battle = null;
  } else if (id.startsWith("battle-")) {
    const n = Number(id.slice(7));
    if (n > 0 && !s.tutorial.fought) return;
    s.battle = newBattle(n);
  } else if (id === "question") {
    await syncQuestions();
    openQuestion();
    return;
  } else if (id === "pending") {
    showHistory(true);
    return;
  } else if (id === "history") {
    showHistory();
    return;
  } else if (id === "defer") {
    if (
      activeQuestion &&
      !review &&
      !s.answered.includes(activeQuestion.id) &&
      !s.pending.includes(activeQuestion.id)
    ) {
      if (s.pending.length >= 3) throw Error("待答已满，请先处理已有题目");
      s.pending.push(activeQuestion.id);
    }
    closeModal();
  } else if (id === "submit-answer" && activeQuestion) {
    answeredResult = answer(s, activeQuestion, selectedAnswer, review);
    commit();
    questionModal();
    return;
  } else if (id === "close-result") {
    closeModal();
    if (breakthroughPending) {
      breakthroughPending = false;
      showStory(
        "破境 · 灵息渐长",
        "修为已达 50，耕耘与领悟终于汇作一处。今后每块灵田收获增加为 3 份。",
      );
    } else if (!s.events.includes("first-question")) {
      s.events.push("first-question");
      showStory(
        "无人知晓的修炼",
        "林疏月站在田埂旁，望了望你的气息。“只坐了半炷香，怎么像从藏书楼走了一遭？”你笑着摇头。脑海里的那道题，仍只有你能看见。",
        "assets/v2/person-0-2.webp",
      );
    }
  } else if (id === "report" && activeQuestion) {
    const qid = activeQuestion.id;
    if (!s.reported.includes(qid)) s.reported.push(qid);
    if (!s.reportQueue.includes(qid)) s.reportQueue.push(qid);
    persist(s);
    try {
      await api("report", { id: qid });
      s.reportQueue = s.reportQueue.filter((id) => id !== qid);
      if (save === s) persist(s);
    } catch {
      message("已在本地停用此题，联网后会同步举报。");
    }
    await syncQuestions();
    closeModal();
    message("此题已暂停投放，历史作答仍保留。");
  }
  commit();
}
document.addEventListener(
  "pointerdown",
  () => {
    if (save?.home.sound) void sound.set(true, weather(save) === "雨");
  },
  { once: true },
);
document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!el || (el as HTMLButtonElement).disabled || busy) return;
  void (async () => {
    try {
      if (el.dataset.action) {
        if (
          el.dataset.action.startsWith("chat-") ||
          el.dataset.action.startsWith("gift-")
        )
          return;
        await action(el.dataset.action);
        return;
      }
      if (el.dataset.tab) {
        tab = el.dataset.tab as Tab;
        render();
        return;
      }
      if (el.dataset.gender) {
        selectedGender = el.dataset.gender as Gender;
        dialogKind = "name";
        onboarding();
        return;
      }
      if (!save) return;
      if (el.dataset.removePending) {
        save.pending = save.pending.filter(
          (id) => id !== el.dataset.removePending,
        );
        commit();
        showHistory(true);
        return;
      }
      if (el.dataset.crop) {
        save.selectedCrop = el.dataset.crop as Crop;
        closeModal();
        commit();
      } else if (el.dataset.item) {
        save.selectedItem = el.dataset.item as Item;
        commit();
      } else if (el.dataset.lock) {
        const i = el.dataset.lock as Item;
        save.locked = save.locked.includes(i)
          ? save.locked.filter((x) => x !== i)
          : [...save.locked, i];
        commit();
      } else if (el.dataset.cell) {
        const n = Number(el.dataset.cell),
          i = save.board[n];
        if (i) {
          save.inventory[i]++;
          save.board[n] = null;
          commit();
        } else addMaterial(save.selectedItem, n);
      } else if (el.dataset.recipe) {
        const r = RECIPES.find((r) => r.id === el.dataset.recipe)!;
        save.board.forEach((i) => {
          if (i) save!.inventory[i]++;
        });
        save.board.fill(null);
        if (
          Object.entries(r.inputs).some(
            ([i, n]) =>
              save!.inventory[i as Item] < n! ||
              save!.locked.includes(i as Item),
          )
        ) {
          commit();
          throw Error("材料不足或已锁定，原制作盘材料已收回");
        }
        let n = 0;
        for (const [i, count] of Object.entries(r.inputs))
          for (let j = 0; j < count!; j++) {
            save.inventory[i as Item]--;
            save.board[n++] = i as Item;
          }
        commit();
      } else if (el.dataset.answer) {
        selectedAnswer = Number(el.dataset.answer);
        questionModal();
      } else if (el.dataset.question) {
        openQuestion(el.dataset.question);
      } else if (el.dataset.review) {
        openQuestion(el.dataset.review, true);
      } else if (el.dataset.person) {
        const p = PEOPLE.find((p) => p.id === el.dataset.person)!,
          i = PEOPLE.indexOf(p);
        dialogKind = "person";
        modal(
          `<img class="dialog-portrait" src="assets/v2/person-${i}-1.webp" alt="${p.name}"><small>${p.role}</small><h2>${p.name}</h2><p class="story-text">${personLine(save, p.id)}</p><p>喜欢 ${ITEMS[p.gift].name} · 熟络 ${save.affinity[p.id] ?? 0}</p>${btn("聊一聊", "chat-" + p.id, "primary", save.chattedOn[p.id] === save.day)}${btn("赠送" + ITEMS[p.gift].name, "gift-" + p.id, "", save.giftedOn[p.id] === save.day || save.inventory[p.gift] < 1)}${btn("自由聊天 · AI", "open-npc:" + p.id)}${btn("一起修炼 / 双修", "study-npc:" + p.id)}${btn("告别", "close", "text-button")}`,
        );
      }
    } catch (error) {
      message(error instanceof Error ? error.message : "操作失败");
    }
  })();
});
// Conversation actions are handled separately to keep the dialogue state stable.
document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!el || el.disabled || !save || busy) return;
  const id = el.dataset.action!;
  if (!id.startsWith("chat-") && !id.startsWith("gift-")) return;
  try {
    const personId = id.slice(5),
      p = PEOPLE.find((p) => p.id === personId)!;
    const text = chat(save, personId, id.startsWith("gift-"));
    commit();
    showStory(p.name, text, `assets/v2/person-${PEOPLE.indexOf(p)}-1.webp`);
  } catch (error) {
    message((error as Error).message);
  }
});
document.addEventListener("submit", (e) => {
  const f = e.target as HTMLFormElement;
  e.preventDefault();
  void (async () => {
    try {
      if (f.id === "name-form") {
        const name = $<HTMLInputElement>("#player-name").value.trim();
        if (!name || name.length > 12) throw Error("名字需要 1 至 12 字");
        save = newSave(selectedGender, name);
        closeModal();
        commit();
        await syncQuestions();
        render();
      } else if (f.id === "api-form") {
        const d = new FormData(f);
        await api("config", {
          baseUrl: d.get("baseUrl"),
          model: d.get("model"),
          key: d.get("key"),
          auto: d.get("auto") === "on",
        });
        (f.elements.namedItem("key") as HTMLInputElement).value = "";
        message(`配置仅保存在${KEY_LOCATION}。`);
        await status();
      } else if (f.dataset.audit) {
        const d = new FormData(f);
        await api("review", {
          id: f.dataset.audit,
          note: d.get("note"),
          status: d.get("status"),
        });
        await syncQuestions();
        await showReviews();
      }
    } catch (error) {
      message((error as Error).message);
    }
  })();
});
document.addEventListener("dragstart", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-item]");
  if (el) e.dataTransfer?.setData("text/plain", el.dataset.item!);
});
document.addEventListener("dragover", (e) => {
  if ((e.target as HTMLElement).closest("[data-cell]")) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
  if (!el || !save) return;
  e.preventDefault();
  const item = e.dataTransfer?.getData("text/plain") as Item;
  if (item in ITEMS) addMaterial(item, Number(el.dataset.cell));
});
$<HTMLInputElement>("#import-file").addEventListener("change", async (e) => {
  try {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 20000000) throw Error("存档文件过大");
    const raw = JSON.parse(await file.text());
    const imported = await companion.prepareImport(
      raw,
      migrate(raw.format === "lingtian-complete" ? raw.game : raw),
    );
    if (save) localStorage.setItem(SAVE_KEY + "-backup", JSON.stringify(save));
    persist(imported);
    save = imported;
    void sound.set(save.home.sound, weather(save) === "雨");
    tab = "farm";
    closeModal();
    commit();
    message("存档已导入，原进度已备份。");
  } catch (error) {
    message((error as Error).message);
  } finally {
    (e.target as HTMLInputElement).value = "";
  }
});
render();
onboarding();
void syncQuestions().then(() => render());
setInterval(() => {
  if (dialogKind === "settings") void status();
  if (save && !busy && !dialogKind)
    void syncQuestions()
      .then(async () => {
        if (online && save) {
          await api("auto", { answered: save!.answered });
        }
      })
      .catch(() => {});
}, 10000);

document.addEventListener("keydown", (e) => {
  const container = document.querySelector<HTMLElement>(".modal");
  if (!container) return;
  if (e.key === "Escape" && save) {
    e.preventDefault();
    void action(
      dialogKind === "question"
        ? answeredResult === null
          ? "defer"
          : "close-result"
        : "close",
    ).catch((error) => message(error.message));
  }
  if (e.key === "Tab") {
    const controls = [
      ...container.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input,select",
      ),
    ].filter((el) => el.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
