import type { BattleState } from "./model";
import { LEVELS } from "./content";

const SIZE = 6;
const KINDS = 5;

export function matches(cells: number[]): Set<number> {
  const found = new Set<number>();
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const index = row * SIZE + col;
      if (
        col < SIZE - 2 &&
        cells[index] === cells[index + 1] &&
        cells[index] === cells[index + 2]
      ) {
        let end = col + 3;
        while (end < SIZE && cells[row * SIZE + end] === cells[index]) end++;
        for (let c = col; c < end; c++) found.add(row * SIZE + c);
      }
      if (
        row < SIZE - 2 &&
        cells[index] === cells[index + SIZE] &&
        cells[index] === cells[index + SIZE * 2]
      ) {
        let end = row + 3;
        while (end < SIZE && cells[end * SIZE + col] === cells[index]) end++;
        for (let r = row; r < end; r++) found.add(r * SIZE + col);
      }
    }
  }
  return found;
}

function adjacent(a: number, b: number): boolean {
  const ax = a % SIZE;
  const ay = Math.floor(a / SIZE);
  const bx = b % SIZE;
  const by = Math.floor(b / SIZE);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

export function hasMove(cells: number[]): boolean {
  for (let index = 0; index < cells.length; index++) {
    for (const neighbor of [index + 1, index + SIZE]) {
      if (neighbor >= cells.length || !adjacent(index, neighbor)) continue;
      [cells[index], cells[neighbor]] = [cells[neighbor], cells[index]];
      const possible = matches(cells).size > 0;
      [cells[index], cells[neighbor]] = [cells[neighbor], cells[index]];
      if (possible) return true;
    }
  }
  return false;
}

function freshCells(): number[] {
  let cells: number[];
  do {
    cells = [];
    for (let index = 0; index < SIZE * SIZE; index++) {
      let kind: number;
      do {
        kind = Math.floor(Math.random() * KINDS);
      } while (
        (index % SIZE > 1 &&
          cells[index - 1] === kind &&
          cells[index - 2] === kind) ||
        (index >= SIZE * 2 &&
          cells[index - SIZE] === kind &&
          cells[index - SIZE * 2] === kind)
      );
      cells.push(kind);
    }
  } while (!hasMove(cells));
  return cells;
}

export function newBattle(level = 0): BattleState {
  return {
    cells: freshCells(),
    hp: LEVELS[level].hp,
    moves: LEVELS[level].moves,
    selected: null,
    status: "playing",
    level,
    rewarded: false,
  };
}

export function selectBattleTile(
  battle: BattleState,
  index: number,
): "selected" | "invalid" | "matched" | "won" | "lost" {
  if (battle.status !== "playing") return "invalid";
  if (battle.selected === null || battle.selected === index) {
    battle.selected = battle.selected === index ? null : index;
    return "selected";
  }
  const first = battle.selected;
  battle.selected = null;
  if (!adjacent(first, index)) {
    battle.selected = index;
    return "selected";
  }
  const cells = battle.cells;
  [cells[first], cells[index]] = [cells[index], cells[first]];
  let cleared = matches(cells);
  if (!cleared.size) {
    [cells[first], cells[index]] = [cells[index], cells[first]];
    return "invalid";
  }
  let total = 0;
  let cascades = 0;
  while (cleared.size && cascades < 8) {
    total += cleared.size;
    for (let col = 0; col < SIZE; col++) {
      const kept: number[] = [];
      for (let row = SIZE - 1; row >= 0; row--) {
        const cell = row * SIZE + col;
        if (!cleared.has(cell)) kept.push(cells[cell]);
      }
      for (let row = SIZE - 1; row >= 0; row--) {
        const from = SIZE - 1 - row;
        cells[row * SIZE + col] =
          from < kept.length ? kept[from] : Math.floor(Math.random() * KINDS);
      }
    }
    cleared = matches(cells);
    cascades++;
  }
  battle.hp = Math.max(0, battle.hp - total * 2);
  battle.moves -= 1;
  if (battle.hp === 0) battle.status = "won";
  else if (battle.moves === 0) battle.status = "lost";
  if (matches(cells).size || !hasMove(cells)) battle.cells = freshCells();
  return battle.status === "won"
    ? "won"
    : battle.status === "lost"
      ? "lost"
      : "matched";
}
