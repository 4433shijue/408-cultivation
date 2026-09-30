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

export function freshCells(): number[] {
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
    id: crypto.randomUUID(),
    blockKinds: Object.fromEntries(
      Array.from({ length: LEVELS[level].obstacles }, (_, j) => [
        (j * 7 + level) % 36,
        j % 2 ? "stone" : "vine",
      ]),
    ),
    specials: {},
    blocks: Object.fromEntries(
      Array.from({ length: LEVELS[level].obstacles }, (_, j) => [
        (j * 7 + level) % 36,
        1 + (j % 2),
      ]),
    ),
    collected: 0,
    turns: 0,
    warning: false,
    toolUsed: false,
    notice: "",
    cells: freshCells(),
    hp: LEVELS[level].hp,
    moves: LEVELS[level].moves,
    selected: null,
    status: "playing",
    level,
    rewarded: false,
  };
}

export const TOOL_COSTS: Record<string, number> = {
  shuffle: 8,
  break: 12,
  steps: 20,
};
export function buyTool(s: import("./model").SaveData, id: string) {
  const price = TOOL_COSTS[id];
  if (!price || s.sand < price) throw Error("灵砂不足");
  s.sand -= price;
  s.tools[id]++;
}
export function useTool(s: import("./model").SaveData, id: string) {
  const b = s.battle;
  if (!b || b.status !== "playing" || b.toolUsed || !s.tools[id])
    throw Error("每局只能使用一件已有道具");
  s.tools[id]--;
  b.toolUsed = true;
  if (id === "steps") b.moves += 3;
  else if (id === "break") {
    b.blocks = {};
    b.blockKinds = {};
  } else {
    b.cells = freshCells();
    b.specials = {};
  }
  b.notice = "道具已生效";
}
function runs(cells: number[]) {
  const result: number[][] = [];
  for (let axis = 0; axis < 2; axis++)
    for (let line = 0; line < 6; line++) {
      let run: number[] = [];
      for (let k = 0; k <= 6; k++) {
        const n = axis ? k * 6 + line : line * 6 + k;
        if (k < 6 && (!run.length || cells[n] === cells[run[0]])) run.push(n);
        else {
          if (run.length >= 3) result.push(run);
          run = k < 6 ? [n] : [];
        }
      }
    }
  return result;
}
export function selectBattleTile(
  b: BattleState,
  index: number,
): "selected" | "invalid" | "matched" | "won" | "lost" {
  if (
    b.status !== "playing" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 36
  )
    return "invalid";
  if (b.selected === null || b.selected === index) {
    b.selected = b.selected === index ? null : index;
    return "selected";
  }
  const first = b.selected;
  b.selected = null;
  if (!adjacent(first, index)) {
    b.selected = index;
    return "selected";
  }
  if (
    [first, index].some(
      (n) => b.blocks[n] && ["ice", "seal"].includes(b.blockKinds[n]),
    )
  ) {
    b.notice = "冻结或封锁的灵纹不能交换，请消除相邻灵纹解除";
    return "invalid";
  }
  const cells = b.cells;
  [cells[first], cells[index]] = [cells[index], cells[first]];
  const sp = b.specials[first],
    sq = b.specials[index];
  delete b.specials[first];
  delete b.specials[index];
  if (sp) b.specials[index] = sp;
  if (sq) b.specials[first] = sq;
  let clear = matches(cells);
  if (!clear.size) {
    [cells[first], cells[index]] = [cells[index], cells[first]];
    delete b.specials[first];
    delete b.specials[index];
    if (sp) b.specials[first] = sp;
    if (sq) b.specials[index] = sq;
    return "invalid";
  }
  const level = LEVELS[b.level];
  let total = 0,
    interrupt = 0;
  for (let cascade = 0; clear.size && cascade < 12; cascade++) {
    const created: Record<number, "row" | "color"> = {};
    for (const run of runs(cells))
      if (run.length >= 4) {
        const anchor = run.includes(index) ? index : run[0];
        if (!b.specials[anchor])
          created[anchor] = run.length >= 5 ? "color" : "row";
      }
    const activated = new Set<number>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of [...clear]) {
        const kind = b.specials[n];
        if (kind && !activated.has(n)) {
          activated.add(n);
          changed = true;
          for (let j = 0; j < 36; j++)
            if (
              kind === "row"
                ? Math.floor(j / 6) === Math.floor(n / 6)
                : cells[j] === cells[n]
            )
              clear.add(j);
        }
      }
    }
    for (const n of clear) {
      if (cells[n] === level.kind) {
        b.collected++;
        interrupt++;
      }
      if (b.blocks[n]) {
        b.blocks[n]--;
        if (!b.blocks[n]) {
          delete b.blocks[n];
          delete b.blockKinds[n];
        }
      }
      for (const j of [n - 6, n + 6, n - 1, n + 1])
        if (
          j >= 0 &&
          j < 36 &&
          adjacent(n, j) &&
          b.blocks[j] &&
          b.blockKinds[j] !== "vine"
        ) {
          b.blocks[j]--;
          if (!b.blocks[j]) {
            delete b.blocks[j];
            delete b.blockKinds[j];
          }
        }
    }
    total += clear.size;
    for (const n of clear) delete b.specials[n];
    for (const [n, kind] of Object.entries(created)) {
      clear.delete(+n);
      b.specials[+n] = kind;
    }
    const nextSpecial: BattleState["specials"] = {};
    for (let col = 0; col < 6; col++) {
      const kept: { kind: number; special?: "row" | "color" }[] = [];
      for (let row = 5; row >= 0; row--) {
        const n = row * 6 + col;
        if (!clear.has(n))
          kept.push({ kind: cells[n], special: b.specials[n] });
      }
      for (let row = 5; row >= 0; row--) {
        const n = row * 6 + col,
          v = kept[5 - row];
        cells[n] = v ? v.kind : Math.floor(Math.random() * 5);
        if (v?.special) nextSpecial[n] = v.special;
      }
    }
    b.specials = nextSpecial;
    clear = matches(cells);
  }
  b.moves--;
  b.turns++;
  b.hp = Math.max(0, b.hp - total * 2);
  b.notice = `消除 ${total} 枚灵纹`;
  if (b.warning) {
    b.warning = false;
    if (interrupt >= 3) b.notice += " · 已打断蓄力";
    else {
      const kinds: ("vine" | "stone" | "seal" | "ice")[] = [
        "vine",
        "stone",
        "vine",
        "seal",
        "ice",
        "stone",
      ];
      const count = level.boss === 0 ? 2 : level.boss === 5 ? 5 : 3;
      for (let j = 0; j < count; j++) {
        const n = (b.turns * 5 + j * 7) % 36,
          kind =
            level.boss === 5
              ? (["vine", "stone", "seal", "ice"] as const)[j % 4]
              : kinds[level.boss];
        b.blockKinds[n] = kind;
        b.blocks[n] = kind === "stone" || kind === "ice" ? 2 : 1;
      }
      b.notice +=
        " · " +
        [
          "竹息结缚",
          "岩甲落石",
          "藤蔓缠绕",
          "砂印封锁",
          "霜羽冻结",
          "山川合阵",
        ][level.boss] +
        "！";
    }
  }

  if (
    b.hp === 0 &&
    b.collected >= level.collect &&
    Object.keys(b.blocks).length === 0
  )
    b.status = "won";
  else if (b.moves === 0) b.status = "lost";
  else if (level.boss >= 0 && b.hp > 0 && b.turns % 3 === 0) {
    b.warning = true;
    b.notice += " · 下回合消除3枚指定灵纹可打断！";
  }
  if (matches(cells).size || !hasBattleMove(b)) {
    for (let attempt = 0; attempt < 30; attempt++) {
      b.cells = freshCells();
      if (hasBattleMove(b)) break;
    }
    if (!hasBattleMove(b)) {
      b.blocks = {};
      b.blockKinds = {};
    }
    b.specials = {};
    b.notice += " · 棋盘自动洗牌，不扣步数";
  }
  return b.status === "playing" ? "matched" : b.status;
}

export function hasBattleMove(b: BattleState) {
  for (let i = 0; i < 36; i++)
    for (const j of [i + 1, i + 6]) {
      if (
        j >= 36 ||
        !adjacent(i, j) ||
        [i, j].some(
          (n) => b.blocks[n] && ["ice", "seal"].includes(b.blockKinds[n]),
        )
      )
        continue;
      [b.cells[i], b.cells[j]] = [b.cells[j], b.cells[i]];
      const ok = matches(b.cells).size > 0;
      [b.cells[i], b.cells[j]] = [b.cells[j], b.cells[i]];
      if (ok) return true;
    }
  return false;
}
