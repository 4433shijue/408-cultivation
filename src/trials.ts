import type { SaveData } from "./model";
import { newBattle } from "./battle";
import { syncTime } from "./realtime";
import { settleFailure } from "./stamina";
export function startTrial(s: SaveData, level: number, abandonId?: string) {
  syncTime(s);
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level >= 60 ||
    (level > 0 && !s.cleared.includes(level - 1))
  )
    throw Error("请先通过前一关");
  if (s.battle?.status === "playing") {
    if (!abandonId && s.battle.level === level) return;
    if (abandonId !== s.battle.id) throw Error("请先继续或明确放弃当前试炼");
    s.battle.status = "lost";
    settleFailure(s);
  }
  if (s.stamina.value < 1) return false;
  s.battle = newBattle(level);
  return true;
}
