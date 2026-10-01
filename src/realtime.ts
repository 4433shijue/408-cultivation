import { syncStamina } from "./stamina";
import { CROPS } from "./content";
import type { Crop } from "./content";
import type { SaveData, Plot } from "./model";
export const HOURS: Record<Crop, number> = {
  herb: 1,
  lotus: 2,
  mint: 3,
  berry: 4,
  chrys: 6,
  rice: 8,
};
export const PRICES: Record<Crop, number> = {
  herb: 2,
  lotus: 4,
  mint: 3,
  berry: 5,
  chrys: 5,
  rice: 3,
};
export const dayKey = (now = Date.now()) =>
  Math.floor((now + 8 * 3600000) / 86400000);
export function syncTime(s: SaveData, now = Date.now()) {
  let watermark = 0;
  try {
    watermark =
      Number(globalThis.localStorage?.getItem("lingtian-clock-v4") ?? 0) || 0;
  } catch {}
  s.lastSeen = Math.max(s.lastSeen, now, watermark);
  try {
    globalThis.localStorage?.setItem("lingtian-clock-v4", String(s.lastSeen));
  } catch {}
  syncStamina(s);
  s.day = dayKey(s.lastSeen);
  for (const p of s.plots)
    if (p.crop)
      p.stage = readyPlot(s, p)
        ? CROPS[p.crop].days
        : Math.min(
            CROPS[p.crop].days - 1,
            Math.floor(
              (1 -
                ((p.readyAt ?? 0) - s.lastSeen) / (HOURS[p.crop] * 3600000)) *
                CROPS[p.crop].days,
            ),
          );
}
export const readyPlot = (s: SaveData, p: Plot) =>
  !!p.crop && (p.readyAt ?? 0) <= s.lastSeen;
export function remaining(ms: number) {
  const n = Math.max(0, Math.ceil(ms / 60000));
  return n === 0
    ? "已成熟"
    : n >= 60
      ? `${Math.floor(n / 60)}时${n % 60}分`
      : `${n}分钟`;
}
export function plantPlot(s: SaveData, index: number) {
  const crop = s.selectedCrop;
  if (crop !== "herb" && !s.tutorial.crafted) throw Error("先完成第一份灵茶");
  if (s.seedStock[crop] < 1)
    throw Error("该作物种子不足，请到种子商店购买或兑换");
  s.seedStock[crop]--;
  Object.assign(s.plots[index], {
    crop,
    stage: 0,
    watered: false,
    fertilized: false,
    plantedAt: s.lastSeen,
    readyAt: s.lastSeen + HOURS[crop] * 3600000,
  });
  return `种下${CROPS[crop].name}，${HOURS[crop]}小时后成熟`;
}
export function waterPlot(s: SaveData, p: Plot) {
  if (!p.crop || p.watered || readyPlot(s, p)) return false;
  p.watered = true;
  p.readyAt = Math.max(s.lastSeen, (p.readyAt ?? 0) - HOURS[p.crop] * 360000);
  syncTime(s);
  return true;
}
export function fertilize(s: SaveData) {
  syncTime(s);
  if (!s.inventory.fertilizer || s.locked.includes("fertilizer"))
    throw Error("灵壤不足或已锁定");
  const p = s.plots.find((p) => p.crop && !p.fertilized && !readyPlot(s, p));
  if (!p?.crop) throw Error("没有可以施肥的作物，每轮最多一次");
  s.inventory.fertilizer--;
  p.fertilized = true;
  p.readyAt = Math.max(s.lastSeen, (p.readyAt ?? 0) - HOURS[p.crop] * 720000);
  syncTime(s);
}
export function buySeeds(
  s: SaveData,
  crop: Crop,
  count: number,
  voucher = false,
) {
  if (!(crop in CROPS) || !Number.isInteger(count) || count < 1 || count > 99)
    throw Error("购买数量无效");
  if (crop !== "herb" && !s.tutorial.crafted) throw Error("先完成第一份灵茶");
  if (voucher) {
    if (s.seeds < count) throw Error("种子券不足");
    s.seeds -= count;
  } else {
    const cost = PRICES[crop] * count;
    if (s.coins < cost) throw Error("金币不足");
    s.coins -= cost;
  }
  s.seedStock[crop] += count;
}
export const canRescue = (s: SaveData) =>
  s.seeds === 0 &&
  Object.values(s.seedStock).every((n) => n === 0) &&
  s.plots.every((p) => !p.crop) &&
  s.coins < 2;
export function rescue(s: SaveData) {
  if (!canRescue(s)) throw Error("仅在没有种子、在田作物且金币不足时领取");
  s.seedStock.herb++;
}
export function upgradeTime(s: any): SaveData {
  const now = Date.now(),
    oldDay = s.day;
  s.lastSeen = now;
  s.seedStock = { herb: 0, lotus: 0, rice: 0, mint: 0, berry: 0, chrys: 0 };
  s.sand = 0;
  s.cleared = [];
  s.settled = [];
  s.tools = { shuffle: 0, break: 0, steps: 0 };
  for (const p of s.plots ?? []) {
    p.plantedAt = now;
    p.readyAt = p.crop
      ? now +
        Math.max(0, 1 - p.stage / CROPS[p.crop as Crop].days) *
          HOURS[p.crop as Crop] *
          3600000
      : 0;
    p.fertilized = false;
  }
  for (const d of s.home.drying)
    d.readyOn = d.readyOn <= oldDay ? now : now + 3600000;
  for (const key of ["chattedOn", "giftedOn"])
    for (const id of Object.keys(s[key]))
      s[key][id] = s[key][id] === oldDay ? dayKey(now) : 0;
  for (const a of s.answers) {
    a.legacyDay = a.day;
    a.day = a.day === oldDay ? dayKey(now) : 0;
  }
  for (const r of Object.values(s.companion.rewards) as any[])
    r.day = r.day === oldDay ? dayKey(now) : 0;
  if (s.battle?.status === "won" && !s.battle.rewarded) {
    s.inventory.ore += [2, 4, 6][s.battle.level ?? 0] ?? 2;
    s.coins += 6 * ((s.battle.level ?? 0) + 1);
    s.tutorial.fought = true;
  }
  s.battle = null;
  s.home.startedOn = dayKey(now);
  s.day = dayKey(now);
  s.version = 4;
  return s;
}
