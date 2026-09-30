export type Item =
  | "herb"
  | "lotus"
  | "rice"
  | "ore"
  | "tea"
  | "elixir"
  | "fertilizer"
  | "cake"
  | "mint"
  | "berry"
  | "chrys"
  | "dried"
  | "jam"
  | "sachet"
  | "tonic";
export type Crop = "herb" | "lotus" | "rice" | "mint" | "berry" | "chrys";
export type Gender = "female" | "male";
export type Tab = "farm" | "craft" | "battle" | "cultivate" | "people";
export const ITEMS: Record<
  Item,
  { name: string; icon: number; price: number }
> = {
  herb: { name: "青灵草", icon: 13, price: 2 },
  lotus: { name: "月露莲", icon: 14, price: 4 },
  rice: { name: "云粳稻", icon: 15, price: 3 },
  ore: { name: "星砂", icon: 16, price: 8 },
  tea: { name: "灵茶", icon: 17, price: 12 },
  elixir: { name: "凝神露", icon: 18, price: 20 },
  fertilizer: { name: "灵壤", icon: 19, price: 10 },
  cake: { name: "云米糕", icon: 20, price: 16 },
  mint: { name: "青息薄荷", icon: 45, price: 3 },
  berry: { name: "赤霞果", icon: 46, price: 5 },
  chrys: { name: "金露菊", icon: 47, price: 5 },
  dried: { name: "静心干草", icon: 48, price: 12 },
  jam: { name: "霞果酱", icon: 49, price: 18 },
  sachet: { name: "安神香囊", icon: 50, price: 24 },
  tonic: { name: "清泉灵饮", icon: 51, price: 22 },
};
export const CROPS: Record<Crop, { name: string; days: number; icon: number }> =
  {
    mint: { name: "青息薄荷", days: 2, icon: 36 },
    berry: { name: "赤霞果", days: 3, icon: 39 },
    chrys: { name: "金露菊", days: 3, icon: 42 },
    herb: { name: "青灵草", days: 2, icon: 0 },
    lotus: { name: "月露莲", days: 3, icon: 3 },
    rice: { name: "云粳稻", days: 2, icon: 6 },
  };
export const RECIPES: {
  id: string;
  name: string;
  inputs: Partial<Record<Item, number>>;
  output: Item;
  facility?: "rack" | "workshop";
}[] = [
  { id: "tea", name: "煨一盏灵茶", inputs: { herb: 2 }, output: "tea" },
  {
    id: "elixir",
    name: "调制凝神露",
    inputs: { tea: 1, ore: 1 },
    output: "elixir",
  },
  {
    id: "fertilizer",
    name: "拌制灵壤",
    inputs: { herb: 1, lotus: 1 },
    output: "fertilizer",
  },
  {
    id: "cake",
    name: "蒸云米糕",
    inputs: { rice: 2, lotus: 1 },
    output: "cake",
  },
  {
    id: "dried",
    name: "晾静心干草",
    inputs: { herb: 1, mint: 1 },
    output: "dried",
    facility: "rack",
  },
  { id: "jam", name: "熬霞果酱", inputs: { berry: 2, rice: 1 }, output: "jam" },
  {
    id: "sachet",
    name: "缝安神香囊",
    inputs: { chrys: 1, dried: 1 },
    output: "sachet",
    facility: "workshop",
  },
  {
    id: "tonic",
    name: "调清泉灵饮",
    inputs: { lotus: 1, mint: 1, ore: 1 },
    output: "tonic",
    facility: "workshop",
  },
];
export const ORDERS: {
  id: string;
  name: string;
  item: Item;
  count: number;
  coins: number;
  seeds: number;
}[] = [
  { id: "tea", name: "邻里的晚茶", item: "tea", count: 1, coins: 14, seeds: 3 },
  {
    id: "cake",
    name: "巡山人的干粮",
    item: "cake",
    count: 1,
    coins: 22,
    seeds: 4,
  },
  {
    id: "elixir",
    name: "书铺的清心露",
    item: "elixir",
    count: 1,
    coins: 30,
    seeds: 5,
  },
];
export const PEOPLE = [
  {
    id: "lin",
    name: "林疏月",
    role: "药圃邻居",
    gender: "female",
    orientation: "lesbian",
    gift: "tea" as Item,
    line: "新翻的土还有些潮，午后再浇也来得及。",
    event:
      "你与疏月一起把倒伏的药草扶正。她从袖中取出一小包种子，认真教你辨认叶尖上的露色。“以后拿不准，就来隔壁问我。”",
  },
  {
    id: "yu",
    name: "俞照",
    role: "巡山修士",
    gender: "male",
    orientation: "bisexual",
    gift: "cake" as Item,
    line: "山路今日放晴了。你若去采星砂，沿石灯走便是。",
    event:
      "俞照领你走过一段隐蔽的山道，在岔口系上一条布带。“看到这条布，便知道回家的方向。”归途不长，你却第一次觉得自己在这里有了牵挂。",
  },
  {
    id: "shen",
    name: "沈砚",
    role: "书铺主人",
    gender: "male",
    orientation: "bisexual",
    gift: "elixir" as Item,
    line: "窗边的位置空着。田里忙完了，可以来坐坐。",
    event:
      "你替沈砚整理旧书，从夹页里找到一张手绘的村落地图。他没有收回去。“你初来时总在问路，留着吧。”你在地图的一角，添上了自己的小院。",
  },
];
export const BOSSES = [
  "竹魈",
  "岩甲山魈",
  "缠枝妖藤",
  "赤砂灵蝎",
  "霜羽玄鹤",
  "镇岭石灵",
];
export const LEVELS = Array.from({ length: 60 }, (_, i) => {
  const chapter = Math.floor(i / 20),
    boss = (i + 1) % 10 === 0;
  return {
    name: `第${i + 1}关 · ${boss ? BOSSES[Math.floor(i / 10)] : ["竹径", "溪谷", "云岭"][chapter]}`,
    hp: 36 + chapter * 24 + (i % 20) * 2 + (boss ? 24 : 0),
    moves: 16 + chapter * 2,
    reward: boss ? (chapter + 1) * 2 : 0,
    sand: boss ? [30, 45, 60][chapter] : [10, 15, 20][chapter],
    repeat: boss ? [8, 10, 12][chapter] : [3, 4, 5][chapter],
    boss: boss ? Math.floor(i / 10) : -1,
    obstacles: chapter === 0 ? 0 : chapter === 1 ? 4 + (i % 3) : 7 + (i % 3),
    collect: chapter === 2 ? 12 + (i % 8) : 0,
    kind: i % 5,
  };
});
