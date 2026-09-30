import { syncTime, waterPlot } from "./realtime";
import { ITEMS, PEOPLE, RECIPES } from "./content";
import type { Item } from "./content";
import type { SaveData } from "./model";

export type Facility = "spring" | "workshop" | "rack";
export type Homestead = {
  chapter: number;
  startedOn: number;
  facilities: Record<Facility, boolean>;
  drying: { readyOn: number; count: number }[];
  harvested: string[];
  crafted: string[];
  visits: string[];
  sound: boolean;
};
export const freshHomestead = (day = 1): Homestead => ({
  chapter: 0,
  startedOn: day,
  facilities: { spring: false, workshop: false, rack: false },
  drying: [],
  harvested: [],
  crafted: [],
  visits: [],
  sound: false,
});
export const FACILITIES: Record<
  Facility,
  {
    name: string;
    description: string;
    cost: Partial<Record<Item, number>>;
    coins: number;
    art: number;
  }
> = {
  spring: {
    name: "旧灵泉",
    description: "清理泉眼后，一次引水浇透九块田。",
    cost: { ore: 2, lotus: 2 },
    coins: 16,
    art: 0,
  },
  workshop: {
    name: "制药台",
    description: "解锁安神香囊、清泉灵饮，以及三份批量制作。",
    cost: { herb: 4, ore: 1 },
    coins: 12,
    art: 2,
  },
  rack: {
    name: "晾晒架",
    description: "可挂三份静心干草，1小时后收取；雨天移到檐下，不会损失。",
    cost: { rice: 2, herb: 2 },
    coins: 8,
    art: 4,
  },
};
export const weather = (s: SaveData) =>
  [3, 5].includes(s.day % 6) ? "雨" : "晴";
export function canPay(
  s: SaveData,
  cost: Partial<Record<Item, number>>,
  coins = 0,
) {
  return (
    s.coins >= coins &&
    Object.entries(cost).every(
      ([id, n]) =>
        !s.locked.includes(id as Item) && s.inventory[id as Item] >= n!,
    )
  );
}
function pay(s: SaveData, cost: Partial<Record<Item, number>>, coins = 0) {
  if (!canPay(s, cost, coins))
    throw Error("材料或金币不足，请检查锁定的物品。");
  s.coins -= coins;
  for (const [id, n] of Object.entries(cost)) s.inventory[id as Item] -= n!;
}
export function upgrade(s: SaveData, id: Facility) {
  if (!(id in FACILITIES)) throw Error("设施不存在");
  if (s.home.facilities[id]) throw Error("已完成修缮");
  const f = FACILITIES[id];
  pay(s, f.cost, f.coins);
  s.home.facilities[id] = true;
}
export function waterAll(s: SaveData) {
  if (!s.home.facilities.spring) throw Error("先修好旧灵泉，才能引水入田。");
  s.plots.forEach((p) => {
    waterPlot(s, p);
  });
}
export function collectDrying(s: SaveData) {
  syncTime(s);
  const n = s.home.drying
    .filter((d) => d.readyOn <= s.lastSeen)
    .reduce((a, d) => a + d.count, 0);
  if (!n) throw Error("干草还未晾好，稍后再来。");
  s.home.drying = s.home.drying.filter((d) => d.readyOn > s.lastSeen);
  s.inventory.dried += n;
  remember(s.home.crafted, "dried");
  return n;
}
export function remember(list: string[], id: string) {
  if (!list.includes(id)) list.push(id);
}
export function checkRecipe(s: SaveData, id: string, count = 1) {
  const r = RECIPES.find((r) => r.id === id);
  if (!r) throw Error("配方不存在");
  if (r.facility && !s.home.facilities[r.facility])
    throw Error(`请先修缮${FACILITIES[r.facility].name}`);
  if (
    r.output === "dried" &&
    s.home.drying.reduce((n, d) => n + d.count, 0) + count > 3
  )
    throw Error("晾晒架已满，最多放三份，请先收取。");
  return r;
}
export function finishRecipe(s: SaveData, output: Item, count = 1) {
  if (output === "dried")
    s.home.drying.push({
      readyOn: Math.max(s.lastSeen, Date.now()) + 3600000,
      count,
    });
  else {
    s.inventory[output] += count;
    remember(s.home.crafted, output);
  }
  s.tutorial.crafted = true;
}
export function batchCraft(s: SaveData, id: string) {
  if (!s.home.facilities.workshop) throw Error("请先修缮制药台");
  const r = checkRecipe(s, id, 3);
  const cost = Object.fromEntries(
    Object.entries(r.inputs).map(([k, n]) => [k, n! * 3]),
  );
  pay(s, cost);
  finishRecipe(s, r.output, 3);
  return r.output;
}
export const CHAPTER = [
  {
    title: "一 · 听见泉声",
    text: "院角的旧泉早已干涸。先收一回灵草，煨一盏茶，再向三位邻居问问旧事。",
    hint: "完成收获与制作，与三位道友各交谈一次",
    ready: (s: SaveData) =>
      s.tutorial.harvested &&
      s.tutorial.crafted &&
      PEOPLE.every((p) => (s.affinity[p.id] ?? 0) > 0),
    cost: {},
    reward: 12,
  },
  {
    title: "二 · 檐下草木",
    text: "疏月说，旧泉边曾长满薄荷。修好晾晒架，再种回一畦青息薄荷。",
    hint: "修缮晾晒架，收获青息薄荷",
    ready: (s: SaveData) =>
      s.home.facilities.rack && s.home.harvested.includes("mint"),
    cost: {},
    reward: 16,
  },
  {
    title: "三 · 一线清流",
    text: "俞照替你找到泉脉的走向。用星砂稳住泉眼，以月露莲养回水息。",
    hint: "修缮旧灵泉，交付静心干草 ×1",
    ready: (s: SaveData) => s.home.facilities.spring,
    cost: { dried: 1 },
    reward: 18,
  },
  {
    title: "四 · 故纸新香",
    text: "沈砚翻出一页旧方。请修整制药台，缝一枚香囊，做一罐果酱，请大家来坐坐。",
    hint: "修缮制药台，交付安神香囊 ×1、霞果酱 ×1",
    ready: (s: SaveData) => s.home.facilities.workshop,
    cost: { sachet: 1, jam: 1 },
    reward: 20,
  },
  {
    title: "五 · 来日有约",
    text: "泉边终于有了笑声。再听听三位朋友的故事，给这座小院留出慢慢熟悉彼此的日子。",
    hint: "三位道友熟络各达到7",
    ready: (s: SaveData) => PEOPLE.every((p) => (s.affinity[p.id] ?? 0) >= 7),
    cost: {},
    reward: 24,
  },
  {
    title: "终 · 泉暖青禾",
    text: "一盏清泉灵饮放上茶桌，泉水映出庭前灯火。你在村落地图的一角写下：此处是家。",
    hint: "交付清泉灵饮 ×1，即可完成首章；修炼进度不会阻挡结局",
    ready: (_s: SaveData) => true,
    cost: { tonic: 1 },
    reward: 30,
  },
] satisfies {
  title: string;
  text: string;
  hint: string;
  ready: (s: SaveData) => boolean;
  cost: Partial<Record<Item, number>>;
  reward: number;
}[];
export function claimChapter(s: SaveData) {
  const c = CHAPTER[s.home.chapter];
  if (!c || !c.ready(s))
    throw Error("这一段行程还未完成。没有期限，慢慢来就好。");
  pay(s, c.cost);
  s.coins += c.reward;
  s.seeds += 3;
  s.home.chapter++;
  remember(s.events, `chapter-${s.home.chapter}`);
  return c;
}
export const FRIEND_STORIES: Record<string, string[]> = {
  lin: [
    "你们在雨檐下分拣薄荷。疏月说，刚来村里时，她也分不清每一条田埂。她把靠窗的半张竹席推给你。“慢慢认，草木会等人。”",
    "疏月带来一株金露菊，与你一同种在泉边。她没有再叮嘱如何照料，只说：“明年开花时，我来讨一盏茶。”",
  ],
  yu: [
    "巡山归来，俞照把一枚圆润的石子放在桌上。他说小时候常在旧泉洗去满脚的泥。“水若再流起来，这条回家的路就更好认了。”",
    "俞照提着石灯来敲门。灯放在泉边，暖光恰好照亮夜归的路。他退后两步看了看，笑着说：“以后路过，就知道你在家。”",
  ],
  shen: [
    "沈砚翻出村志里一页褪色的泉图。边角写着许多不同笔迹的名字。他给你留下一支笔。“修好以后，也添上你的吧。”",
    "沈砚抱来一张旧茶桌，说书铺用不上了。桌脚早已仔细修平，桌面还留着新擦过的木香。你们坐在泉边，一起听完了半场雨。",
  ],
};
export function friendEvent(s: SaveData, id: string) {
  const affinity = s.affinity[id] ?? 0;
  for (let i = 0; i < 2; i++) {
    const key = `${id}-${i + 2}`;
    if (
      affinity >= [7, 12][i] &&
      s.home.chapter >= [1, 3][i] &&
      !s.events.includes(key)
    ) {
      remember(s.events, key);
      s.seeds += 2;
      return FRIEND_STORIES[id][i] + "（获得2张种子券）";
    }
  }
  return null;
}
export function personLine(s: SaveData, id: string) {
  if (s.home.chapter >= CHAPTER.length)
    return "泉水又响起来了。改日无事，就来你院里喝茶。";
  if (weather(s) === "雨")
    return (
      {
        lin: "雨声正好，檐下的药草也快晾好了。",
        yu: "山石湿滑，今天慢些走。你的院子有泉声，隔着雨也听得见。",
        shen: "下雨的日子，窗边听书刚好。旧泉那页图，我替你留着。",
      }[id] ?? "雨声正好。"
    );
  return PEOPLE.find((p) => p.id === id)!.line;
}
export function visitor(s: SaveData) {
  return s.day % 3 === 0 ? PEOPLE[Math.floor(s.day / 3 - 1) % 3] : null;
}
export function welcomeVisitor(s: SaveData) {
  const p = visitor(s),
    key = `visit-${s.day}`;
  if (!p || s.home.visits.includes(key))
    throw Error("今日没有尚未招呼的访客。");
  remember(s.home.visits, key);
  s.seeds += 2;
  s.affinity[p.id] = (s.affinity[p.id] ?? 0) + 1;
  return `${p.name}顺路带来两张种子券，与你坐着听了一会儿${weather(s) === "雨" ? "雨" : "风"}。`;
}
export const costText = (cost: Partial<Record<Item, number>>) =>
  Object.entries(cost)
    .map(([k, n]) => `${ITEMS[k as Item].name} ×${n}`)
    .join("、");
