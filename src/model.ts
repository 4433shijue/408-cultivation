import {
  syncTime,
  dayKey,
  upgradeTime,
  waterPlot,
  readyPlot,
  plantPlot,
} from "./realtime";
import {
  freshHomestead,
  remember,
  checkRecipe,
  finishRecipe,
  friendEvent,
  personLine,
} from "./progression";
import type { Homestead } from "./progression";
import { CROPS, ITEMS, LEVELS, ORDERS, PEOPLE, RECIPES } from "./content";
import type { Crop, Gender, Item } from "./content";
export type { Gender, Item, Tab } from "./content";
export type Plot = {
  crop: Crop | null;
  stage: number;
  watered: boolean;
  plantedAt?: number;
  readyAt?: number;
  fertilized?: boolean;
};
export type BattleState = {
  id: string;
  specials: Record<number, "row" | "color">;
  blocks: Record<number, number>;
  blockKinds: Record<number, "vine" | "stone" | "seal" | "ice">;
  collected: number;
  turns: number;
  warning: boolean;
  toolUsed: boolean;
  notice: string;
  cells: number[];
  hp: number;
  moves: number;
  selected: number | null;
  status: "playing" | "won" | "lost";
  level: number;
  rewarded: boolean;
};
export type Question = {
  id: string;
  subject: string;
  topic_id: string;
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  knowledge_point: string;
  version: number;
};
export type Answer = {
  id: string;
  selected: number | null;
  correct: boolean | null;
  legacyDay?: number;
  day: number;
  question?: Question;
};
export type SaveData = {
  version: 4;
  lastSeen: number;
  seedStock: Record<Crop, number>;
  sand: number;
  cleared: number[];
  settled: string[];
  tools: Record<string, number>;
  companion: {
    profileId: string;
    romances: string[];
    rewards: Record<string, { day: number; npcId: string; applied: boolean }>;
  };
  home: Homestead;
  name: string;
  gender: Gender;
  day: number;
  qi: number;
  coins: number;
  seeds: number;
  inventory: Record<Item, number>;
  plots: Plot[];
  board: (Item | null)[];
  selectedItem: Item;
  selectedCrop: Crop;
  battle: BattleState | null;
  answered: string[];
  answers: Answer[];
  pending: string[];
  reported: string[];
  reportQueue: string[];
  cultivatedOn: number;
  chattedOn: Record<string, number>;
  giftedOn: Record<string, number>;
  affinity: Record<string, number>;
  tutorial: {
    harvested: boolean;
    crafted: boolean;
    fought: boolean;
    answered: boolean;
    chatted: boolean;
  };
  locked: Item[];
  events: string[];
  breakthrough: boolean;
  orders: number;
  orderIndex: number;
  reducedMotion: boolean;
};
export const SAVE_KEY = "lingtian-408-save-v4";
const OLD_KEY = "lingtian-408-save-v1";
export function newSave(gender: Gender, name: string): SaveData {
  return {
    version: 4,
    lastSeen: Date.now(),
    seedStock: { herb: 6, lotus: 0, rice: 0, mint: 0, berry: 0, chrys: 0 },
    sand: 0,
    cleared: [],
    settled: [],
    tools: { shuffle: 0, break: 0, steps: 0 },
    companion: { profileId: crypto.randomUUID(), romances: [], rewards: {} },
    home: freshHomestead(),
    name,
    gender,
    day: dayKey(),
    qi: 0,
    coins: 20,
    seeds: 0,
    inventory: {
      mint: 0,
      berry: 0,
      chrys: 0,
      dried: 0,
      jam: 0,
      sachet: 0,
      tonic: 0,
      herb: 2,
      lotus: 0,
      rice: 0,
      ore: 0,
      tea: 0,
      elixir: 0,
      fertilizer: 0,
      cake: 0,
    },
    plots: Array.from({ length: 9 }, (_, i) => ({
      crop: i < 3 ? "herb" : null,
      stage: i < 3 ? 2 : 0,
      watered: i < 3,
      plantedAt: 0,
      readyAt: 0,
      fertilized: false,
    })),
    board: Array(9).fill(null),
    selectedItem: "herb",
    selectedCrop: "herb",
    battle: null,
    answered: [],
    answers: [],
    pending: [],
    reported: [],
    reportQueue: [],
    cultivatedOn: 0,
    chattedOn: {},
    giftedOn: {},
    affinity: {},
    tutorial: {
      harvested: false,
      crafted: false,
      fought: false,
      answered: false,
      chatted: false,
    },
    locked: [],
    events: [],
    breakthrough: false,
    orders: 0,
    orderIndex: 0,
    reducedMotion: false,
  };
}
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export function validateSave(value: unknown): SaveData {
  if (!value || typeof value !== "object") throw Error("存档格式无法识别");
  const s = value as SaveData;
  if (
    !s.companion ||
    typeof s.companion.profileId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(s.companion.profileId) ||
    !Array.isArray(s.companion.romances) ||
    !s.companion.romances.every((id) => ["lin", "yu", "shen"].includes(id)) ||
    !s.companion.rewards ||
    typeof s.companion.rewards !== "object" ||
    !Object.values(s.companion.rewards).every(
      (r) =>
        r &&
        integer(r.day) &&
        ["lin", "yu", "shen"].includes(r.npcId) &&
        typeof r.applied === "boolean",
    )
  )
    throw Error("道友关系记录无效");
  if (
    !integer(s.lastSeen) ||
    !integer(s.sand) ||
    !s.seedStock ||
    !Object.keys(CROPS).every((k) => integer(s.seedStock[k as Crop])) ||
    !Array.isArray(s.cleared) ||
    !s.cleared.every((n) => integer(n) && n < 60) ||
    !Array.isArray(s.settled) ||
    !s.settled.every((n) => typeof n === "string") ||
    !s.tools ||
    !["shuffle", "break", "steps"].every((k) => integer(s.tools[k]))
  )
    throw Error("实时进度无效");
  if (
    !s.plots?.every(
      (p) =>
        integer(p.readyAt) &&
        integer(p.plantedAt) &&
        typeof p.fertilized === "boolean",
    )
  )
    throw Error("田地计时无效");
  const h = s.home;
  if (
    !h ||
    !integer(h.chapter) ||
    h.chapter > 6 ||
    !integer(h.startedOn) ||
    h.startedOn < 1 ||
    h.startedOn > s.day ||
    !h.facilities ||
    !["spring", "workshop", "rack"].every(
      (k) => typeof h.facilities[k as keyof typeof h.facilities] === "boolean",
    ) ||
    typeof h.sound !== "boolean" ||
    !Array.isArray(h.drying) ||
    h.drying.length > 3 ||
    !h.drying.every(
      (d) =>
        d &&
        integer(d.readyOn) &&
        d.readyOn > 0 &&
        integer(d.count) &&
        d.count > 0 &&
        d.count <= 3,
    ) ||
    h.drying.reduce((n, d) => n + d.count, 0) > 3 ||
    ![h.harvested, h.crafted, h.visits].every(
      (a) => Array.isArray(a) && a.every((x) => typeof x === "string"),
    ) ||
    h.harvested.some((id) => !(id in CROPS)) ||
    h.crafted.some((id) => !(id in ITEMS))
  )
    throw Error("家园记录无效");
  if (
    s.version !== 4 ||
    !["female", "male"].includes(s.gender) ||
    typeof s.name !== "string" ||
    s.name.trim().length < 1 ||
    s.name.length > 12
  )
    throw Error("存档角色或版本无效");
  if (
    ![
      "day",
      "qi",
      "coins",
      "seeds",
      "orders",
      "orderIndex",
      "cultivatedOn",
    ].every((k) => integer(s[k as keyof SaveData])) ||
    s.day < 1 ||
    s.orderIndex > 2
  )
    throw Error("存档数值无效");
  if (
    !s.inventory ||
    !Object.keys(ITEMS).every((k) => integer(s.inventory[k as Item]))
  )
    throw Error("背包数据无效");
  if (
    !Array.isArray(s.plots) ||
    s.plots.length !== 9 ||
    !s.plots.every(
      (p) =>
        p &&
        (p.crop === null || p.crop in CROPS) &&
        integer(p.stage) &&
        p.stage <= 3 &&
        typeof p.watered === "boolean",
    )
  )
    throw Error("田地数据无效");
  if (
    !Array.isArray(s.board) ||
    s.board.length !== 9 ||
    !s.board.every((i) => i === null || i in ITEMS)
  )
    throw Error("制作盘数据无效");
  if (s.reportQueue === undefined) s.reportQueue = [];
  for (const key of [
    "answered",
    "pending",
    "reported",
    "reportQueue",
    "events",
    "locked",
  ] as const)
    if (!Array.isArray(s[key]) || !s[key].every((x) => typeof x === "string"))
      throw Error("存档记录无效");
  if (
    s.pending.length > 3 ||
    s.locked.some((i) => !(i in ITEMS)) ||
    !Array.isArray(s.answers) ||
    !s.answers.every(
      (a) =>
        a &&
        typeof a.id === "string" &&
        (a.correct === null || typeof a.correct === "boolean") &&
        (a.selected === null || (integer(a.selected) && a.selected < 4)) &&
        integer(a.day),
    )
  )
    throw Error("作答记录无效");
  if (
    !(s.selectedCrop in CROPS) ||
    !(s.selectedItem in ITEMS) ||
    typeof s.breakthrough !== "boolean" ||
    typeof s.reducedMotion !== "boolean" ||
    !s.tutorial ||
    !["harvested", "crafted", "fought", "answered", "chatted"].every(
      (k) => typeof s.tutorial[k as keyof typeof s.tutorial] === "boolean",
    )
  )
    throw Error("存档进度无效");
  for (const key of ["affinity", "giftedOn", "chattedOn"] as const)
    if (
      !s[key] ||
      typeof s[key] !== "object" ||
      !Object.values(s[key]).every(integer)
    )
      throw Error("人物记录无效");
  if (
    s.battle &&
    (!Array.isArray(s.battle.cells) ||
      s.battle.cells.length !== 36 ||
      !s.battle.cells.every((n) => integer(n) && n < 5) ||
      !integer(s.battle.hp) ||
      !integer(s.battle.moves) ||
      !integer(s.battle.level) ||
      s.battle.level > 59 ||
      !["playing", "won", "lost"].includes(s.battle.status) ||
      typeof s.battle.rewarded !== "boolean" ||
      !(
        s.battle.selected === null ||
        (integer(s.battle.selected) && s.battle.selected < 36)
      ))
  )
    throw Error("战斗记录无效");
  if (s.battle) {
    const b = s.battle;
    if (
      typeof b.id !== "string" ||
      !b.id ||
      !integer(b.turns) ||
      !integer(b.collected) ||
      typeof b.warning !== "boolean" ||
      typeof b.toolUsed !== "boolean" ||
      typeof b.notice !== "string" ||
      !b.specials ||
      !b.blocks ||
      !b.blockKinds ||
      !Object.entries(b.blockKinds).every(
        ([k, v]) =>
          integer(+k) &&
          +k < 36 &&
          ["vine", "stone", "seal", "ice"].includes(v),
      ) ||
      !Object.entries(b.specials).every(
        ([k, v]) => integer(+k) && +k < 36 && ["row", "color"].includes(v),
      ) ||
      !Object.entries(b.blocks).every(
        ([k, v]) => integer(+k) && +k < 36 && integer(v) && v > 0 && v <= 2,
      )
    )
      throw Error("关卡数据无效");
  }
  return s;
}
export function migrate(value: unknown): SaveData {
  const old = structuredClone(value) as Record<string, any>;
  if (!old || typeof old !== "object") throw Error("存档格式无效");
  if (old.version === 4) {
    const s = validateSave(old);
    syncTime(s);
    return s;
  }
  if (old.version === 3) return validateSave(upgradeTime(structuredClone(old)));
  if (old.version === 2) {
    const next = {
      ...old,
      version: 3,
      companion: { profileId: crypto.randomUUID(), romances: [], rewards: {} },
    } as unknown as SaveData;
    if (next.home === undefined) {
      next.home = freshHomestead(old.day);
      next.inventory = { ...old.inventory };
      for (const id of [
        "mint",
        "berry",
        "chrys",
        "dried",
        "jam",
        "sachet",
        "tonic",
      ] as Item[])
        if (next.inventory[id] === undefined) next.inventory[id] = 0;
    }
    return validateSave(upgradeTime(next));
  }
  if (old.version !== 1) throw Error("不支持此存档版本");
  const s = newSave(old.gender, old.name);
  for (const key of [
    "day",
    "qi",
    "coins",
    "seeds",
    "plots",
    "board",
    "selectedItem",
    "answered",
    "cultivatedOn",
    "chattedOn",
    "affinity",
  ] as const)
    if (old[key] !== undefined) (s as any)[key] = old[key];
  s.home.startedOn = s.day;
  s.inventory = { ...s.inventory, ...old.inventory };
  s.tutorial = { ...s.tutorial, ...old.tutorial };
  s.answers = s.answered.map((id) => ({
    id,
    selected: null,
    correct: null,
    day: 0,
  }));
  s.battle = old.battle
    ? { ...old.battle, level: 0, rewarded: old.battle.status === "won" }
    : null;
  return validateSave(upgradeTime(s));
}
export function loadSave(): { save: SaveData | null; error: string | null } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const value = JSON.parse(raw);
      if (value.home === undefined)
        localStorage.setItem(`${SAVE_KEY}-before-homestead`, raw);
      const save = migrate(value);
      persist(save);
      return { save, error: null };
    }
    for (const key of [
      "lingtian-408-save-v3",
      "lingtian-408-save-v2",
      OLD_KEY,
    ]) {
      const old = localStorage.getItem(key);
      if (!old) continue;
      localStorage.setItem(`${key}-backup`, old);
      const save = migrate(JSON.parse(old));
      persist(save);
      return { save, error: null };
    }
    return { save: null, error: null };
  } catch {
    return {
      save: null,
      error:
        "存档读取失败，原始数据仍保留。请先导出备份，再选择导入或重新开始。",
    };
  }
}
export function persist(s: SaveData) {
  validateSave(s);
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}
export function onPlot(s: SaveData, index: number): string {
  syncTime(s);
  const p = s.plots[index];
  if (!p) return "";
  if (!p.crop) return plantPlot(s, index);
  if (readyPlot(s, p)) {
    const n = s.breakthrough ? 3 : 2;
    s.inventory[p.crop] += n;
    remember(s.home.harvested, p.crop);
    s.tutorial.harvested = true;
    Object.assign(p, {
      crop: null,
      stage: 0,
      watered: false,
      plantedAt: 0,
      readyAt: 0,
      fertilized: false,
    });
    return `收获 ${n} 份作物`;
  }
  return waterPlot(s, p)
    ? "清水入土，生长时间缩短10%。"
    : "这轮已经浇水，草木正慢慢长大。";
}
export function craftPreview(s: SaveData) {
  const counts: Partial<Record<Item, number>> = {};
  s.board.forEach((i) => {
    if (i) counts[i] = (counts[i] ?? 0) + 1;
  });
  return RECIPES.find((r) =>
    Object.keys(ITEMS).every(
      (k) => (counts[k as Item] ?? 0) === (r.inputs[k as Item] ?? 0),
    ),
  );
}
export function craft(s: SaveData) {
  const r = craftPreview(s);
  if (!r) throw Error("材料与配方不符，材料没有消耗。");
  if (s.board.some((i) => i && s.locked.includes(i)))
    throw Error("请先解锁制作盘中的材料。");
  checkRecipe(s, r.id);
  s.board.fill(null);
  finishRecipe(s, r.output);
  return r.output;
}
export function deliver(s: SaveData) {
  const o = ORDERS[s.orderIndex];
  if (s.locked.includes(o.item) || s.inventory[o.item] < o.count)
    throw Error("材料不足或物品已锁定");
  s.inventory[o.item] -= o.count;
  s.coins += o.coins + o.seeds * 2;
  s.orders++;
  s.orderIndex = (s.orderIndex + 1) % ORDERS.length;
}
export function answer(
  s: SaveData,
  q: Question,
  selected: number,
  review = false,
) {
  if (!Number.isInteger(selected) || selected < 0 || selected > 3)
    throw Error("请先选择答案");
  syncTime(s);
  const eligible = s.answers.filter((a) => a.day === s.day).length < 5;
  const correct = selected === q.answer;
  if (!review && !s.answered.includes(q.id)) {
    s.answered.push(q.id);
    s.answers.push({ id: q.id, selected, correct, day: s.day, question: q });
    s.pending = s.pending.filter((id) => id !== q.id);
    s.cultivatedOn = s.day;
    s.tutorial.answered = true;
    if (correct && eligible) s.qi += 10;
  }
  return correct;
}
export function breakthrough(s: SaveData) {
  if (
    !s.breakthrough &&
    s.qi >= 50 &&
    Object.values(s.tutorial).every(Boolean)
  ) {
    s.breakthrough = true;
    s.events.push("breakthrough");
    return true;
  }
  return false;
}
export function chat(s: SaveData, id: string, gift = false) {
  syncTime(s);
  const p = PEOPLE.find((p) => p.id === id);
  if (!p) throw Error("未找到道友");
  const days = gift ? s.giftedOn : s.chattedOn;
  if (days[id] === s.day) throw Error("今日已经相处过了");
  if (gift) {
    if (s.locked.includes(p.gift) || s.inventory[p.gift] < 1)
      throw Error("礼物不足或已锁定");
    s.inventory[p.gift]--;
  }
  days[id] = s.day;
  s.affinity[id] = (s.affinity[id] ?? 0) + (gift ? 2 : 1);
  s.tutorial.chatted = true;
  if (s.affinity[id] >= 3 && !s.events.includes(id)) {
    s.events.push(id);
    s.seeds += 3;
    return p.event + "（获得 3 粒种子）";
  }
  return (
    friendEvent(s, id) ??
    (gift ? "这份礼物被郑重收下，笑意停在对方眼底。" : personLine(s, id))
  );
}
export function rewardBattle(s: SaveData) {
  const b = s.battle;
  if (!b || b.status !== "won" || b.rewarded || s.settled.includes(b.id))
    return false;
  b.rewarded = true;
  s.settled.push(b.id);
  const l = LEVELS[b.level],
    first = !s.cleared.includes(b.level);
  s.sand += first ? l.sand : l.repeat;
  s.inventory.ore += l.reward;
  if (first) s.cleared.push(b.level);
  s.tutorial.fought = true;
  return true;
}
