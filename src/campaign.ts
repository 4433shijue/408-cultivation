import type { SaveData } from "./model";
import { LEVELS } from "./content";
import { staminaLabel } from "./stamina";
export function currentLevel(s: SaveData) {
  return Math.min(
    59,
    LEVELS.findIndex((_, i) => !s.cleared.includes(i)) < 0
      ? 59
      : LEVELS.findIndex((_, i) => !s.cleared.includes(i)),
  );
}
function trail(ch: number) {
  let y = 90;
  const points = Array.from({ length: 20 }, (_, j) => {
    const i = ch * 20 + 19 - j,
      boss = LEVELS[i].boss >= 0;
    const point = [
      500 + [0, -23, -31, -12, 20, 30, 12, -12, -26, -12][i % 10] * 10,
      y + (boss ? 59 : 44),
    ];
    y += boss ? 190 : 145;
    return point;
  });
  const d = points
    .map(([x, y], i) =>
      i === 0
        ? `M ${x} ${y}`
        : `C ${points[i - 1][0]} ${(points[i - 1][1] + y) / 2}, ${x} ${(points[i - 1][1] + y) / 2}, ${x} ${y}`,
    )
    .join(" ");
  return `<svg class="tower-trail" viewBox="0 0 1000 ${y + 35}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" class="trail-shadow"/><path d="${d}" class="trail-stones"/></svg>`;
}
export function campaignHTML(s: SaveData) {
  const current = currentLevel(s);
  return `<section class="tower-map"><header class="tower-header"><div><small>循山而上 · 六十重试炼</small><h3>山行长卷 <span>${s.cleared.length}/60</span></h3><p data-stamina>${staminaLabel(s)}</p></div><div><button data-action="tool-shop">灵砂商店</button><button data-action="toggle-side">行程</button><button data-action="tower-focus">回到当前关</button><button class="primary" data-action="battle-${s.battle?.status === "playing" ? s.battle.level : current}" ${s.stamina.value === 0 && s.battle?.status !== "playing" ? "disabled" : ""}>${s.battle?.status === "playing" ? "继续本局" : s.cleared.length === 60 ? "重游山巅" : "挑战第" + (current + 1) + "关"}</button></div></header><div class="tower-scroll" tabindex="0" aria-label="山行关卡地图，上下滚动浏览"><div class="tower-route">${[
    2, 1, 0,
  ]
    .map(
      (ch) =>
        `<section class="tower-chapter chapter-${ch}">${trail(ch)}<h4>第${ch + 1}章 · ${["竹径初探", "溪谷寻砂", "云岭试锋"][ch]}</h4>${Array.from(
          { length: 20 },
          (_, j) => ch * 20 + 19 - j,
        )
          .map((i) => {
            const l = LEVELS[i],
              done = s.cleared.includes(i),
              locked = i > 0 && !s.cleared.includes(i - 1),
              boss = l.boss >= 0;
            return `<div class="tower-stop ${boss ? "boss-stop" : ""}" style="--offset:${[0, -23, -31, -12, 20, 30, 12, -12, -26, -12][i % 10]}%"><button class="tower-node ${done ? "cleared" : ""} ${i === current ? "current" : ""} ${boss ? "boss-node" : ""}" data-action="battle-${i}" data-level="${i}" aria-label="第${i + 1}关 ${l.name} ${done ? "已通关" : locked ? "未解锁" : "可挑战"}" ${locked ? "disabled" : ""}>${boss ? `<img src="assets/v5/boss-${l.boss + 1}.webp" alt="${l.name}" loading="lazy">` : `<img src="assets/v2/icon-${21 + (i % 5)}.png" alt="" loading="lazy">`}<b>${i + 1}</b><span>${boss ? l.name : done ? "已通过" : locked ? "未抵达" : "可挑战"}</span></button></div>`;
          })
          .join("")}</section>`,
    )
    .join(
      "",
    )}<p class="tower-foot">青禾村 · 由此入山<br>向上滚动，循路而行</p></div></div><footer>首通 +1 体力 · 失败 −1 · 每小时恢复 1 点 · 首领每十关守候</footer></section>`;
}
