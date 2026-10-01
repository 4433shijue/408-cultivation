import type { SaveData } from "./model";
export const STAMINA_MAX = 5;
export const STAMINA_HOUR = 3600000;
export function syncStamina(s: SaveData, now = s.lastSeen) {
  if (!s.stamina) return;
  const t = s.stamina;
  now = Math.max(now, t.at);
  if (t.value >= STAMINA_MAX) {
    t.at = now;
    return;
  }
  const recovered = Math.floor((now - t.at) / STAMINA_HOUR);
  t.value = Math.min(STAMINA_MAX, t.value + recovered);
  t.at = t.value === STAMINA_MAX ? now : t.at + recovered * STAMINA_HOUR;
}
export function changeStamina(s: SaveData, amount: number) {
  syncStamina(s);
  const wasFull = s.stamina.value === STAMINA_MAX;
  s.stamina.value = Math.max(
    0,
    Math.min(STAMINA_MAX, s.stamina.value + amount),
  );
  if (wasFull || s.stamina.value === STAMINA_MAX) s.stamina.at = s.lastSeen;
}
export function settleFailure(s: SaveData) {
  const b = s.battle;
  if (!b || b.status !== "lost" || s.settled.includes(b.id)) return false;
  changeStamina(s, -1);
  s.settled.push(b.id);
  return true;
}
export function staminaLabel(s: SaveData) {
  if (s.stamina.value === STAMINA_MAX) return "体力 5/5 · 已回满";
  const seconds = Math.max(
    0,
    Math.ceil((s.stamina.at + STAMINA_HOUR - s.lastSeen) / 1000),
  );
  return `体力 ${s.stamina.value}/5 · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} 后恢复`;
}
