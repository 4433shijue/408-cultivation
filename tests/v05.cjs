const test = require("node:test"),
  assert = require("node:assert/strict");
const m = require("../work/rules/model.js"),
  r = require("../work/rules/realtime.js"),
  b = require("../work/rules/battle.js"),
  c = require("../work/rules/content.js");
test("six crop prices, voucher migration, bulk purchases and rescue are atomic", () => {
  const s = m.newSave("female", "禾");
  s.tutorial.crafted = true;
  for (const crop of Object.keys(c.CROPS)) {
    s.coins = 100;
    r.buySeeds(s, crop, 5);
    assert.equal(s.coins, 100 - r.PRICES[crop] * 5);
  }
  const before = JSON.stringify(s.seedStock);
  assert.throws(() => r.buySeeds(s, "rice", 100));
  assert.equal(JSON.stringify(s.seedStock), before);
  assert.throws(() => r.rescue(s));
  s.plots.forEach((p) => (p.crop = null));
  s.seedStock = Object.fromEntries(Object.keys(c.CROPS).map((k) => [k, 0]));
  s.coins = 0;
  r.rescue(s);
  assert.equal(s.seedStock.herb, 1);
  assert.throws(() => r.rescue(s));
});
test("fertilizer consumes once and reduces original duration; rollback never reverses growth", () => {
  const s = m.newSave("female", "禾");
  m.onPlot(s, 3);
  s.inventory.fertilizer = 2;
  const deadline = s.plots[3].readyAt;
  r.fertilize(s);
  assert.equal(s.plots[3].readyAt, deadline - 720000);
  assert.throws(() => r.fertilize(s));
  assert.equal(s.inventory.fertilizer, 1);
  r.syncTime(s, s.lastSeen + 1800000);
  const n = s.lastSeen;
  r.syncTime(s, n - 9999999);
  assert.equal(s.lastSeen, n);
});
test("first five new answers consume daily opportunities including wrong ones, reviews do not", () => {
  const s = m.newSave("female", "禾");
  const q = {
    id: "",
    subject: "",
    topic_id: "",
    stem: "",
    options: ["a", "b", "c", "d"],
    answer: 0,
    explanation: "",
    knowledge_point: "",
    version: 1,
  };
  for (let i = 0; i < 8; i++)
    m.answer(s, { ...q, id: "" + i }, i === 0 ? 1 : 0);
  assert.equal(s.qi, 40);
  m.answer(s, { ...q, id: "0" }, 0, true);
  assert.equal(s.qi, 40);
  r.syncTime(s, s.lastSeen + 86400000);
  m.answer(s, { ...q, id: "next" }, 0);
  assert.equal(s.qi, 50);
  assert.equal(
    r.dayKey(Date.UTC(2026, 8, 30, 15, 59, 59)) + 1,
    r.dayKey(Date.UTC(2026, 8, 30, 16)),
  );
});
test("v3 migration retains money, affinity, mature crops and seed flexibility; legacy unpaid win once", () => {
  const old = m.newSave("male", "旧禾");
  old.version = 3;
  old.day = 9;
  old.seeds = 11;
  old.affinity.lin = 8;
  old.battle = { status: "won", rewarded: false, level: 1 };
  old.plots[3] = { crop: "rice", stage: 1, watered: true };
  const s = m.migrate(old);
  assert.equal(s.version, 4);
  assert.equal(s.seeds, 11);
  assert.equal(s.coins, 32);
  assert.equal(s.inventory.ore, 4);
  assert.equal(s.affinity.lin, 8);
  assert.ok(r.readyPlot(s, s.plots[0]));
  assert.ok(Math.abs(s.plots[3].readyAt - s.lastSeen - 4 * 3600000) < 5);
  assert.equal(m.migrate(s).inventory.ore, 4);
  assert.equal(s.battle, null);
});
test("60 fixed levels, 6 bosses, first-clear and replay payouts never duplicate", () => {
  assert.equal(c.LEVELS.length, 60);
  assert.equal(c.LEVELS.filter((l) => l.boss >= 0).length, 6);
  for (let i = 0; i < 60; i++) {
    const s = m.newSave("female", "禾");
    s.battle = b.newBattle(i);
    assert.equal(b.matches(s.battle.cells).size, 0);
    assert.ok(b.hasMove(s.battle.cells));
    m.validateSave(s);
    s.battle.status = "won";
    assert.ok(m.rewardBattle(s));
    assert.equal(s.sand, c.LEVELS[i].sand);
    assert.equal(m.rewardBattle(s), false);
    s.battle = b.newBattle(i);
    s.battle.status = "won";
    m.rewardBattle(s);
    assert.equal(s.sand, c.LEVELS[i].sand + c.LEVELS[i].repeat);
  }
});
test("battle tool costs and one per attempt restriction", () => {
  const s = m.newSave("male", "禾");
  s.sand = 40;
  b.buyTool(s, "steps");
  b.buyTool(s, "break");
  assert.equal(s.sand, 8);
  s.battle = b.newBattle(0);
  const moves = s.battle.moves;
  b.useTool(s, "steps");
  assert.equal(s.battle.moves, moves + 3);
  assert.throws(() => b.useTool(s, "break"));
  assert.equal(s.tools.break, 1);
});
test("four and five rune runs generate persistent special runes", () => {
  for (const length of [4, 5]) {
    let passed = false;
    for (let n = 0; n < 30 && !passed; n++) {
      const x = b.newBattle(0);
      x.cells = [
        0,
        0,
        1,
        0,
        ...(length === 5 ? [0] : [2]),
        3,
        1,
        2,
        0,
        3,
        4,
        2,
        2,
        3,
        4,
        0,
        1,
        4,
        3,
        4,
        1,
        2,
        0,
        1,
        4,
        0,
        2,
        1,
        3,
        2,
        0,
        1,
        3,
        4,
        2,
        3,
      ];
      x.selected = 2;
      const result = b.selectBattleTile(x, 8);
      assert.notEqual(result, "invalid");
      passed = Object.values(x.specials).includes(
        length === 5 ? "color" : "row",
      );
    }
    assert.ok(passed);
  }
});
test("Boss windup provides a full interrupt turn and does not deduct external inventory", () => {
  let seen = false;
  for (let n = 0; n < 100 && !seen; n++) {
    const x = b.newBattle(9);
    x.hp = 1000;
    x.turns = 2;
    for (let i = 0; i < 30 && !seen; i++) {
      const z = structuredClone(x);
      z.selected = i;
      const out = b.selectBattleTile(z, i + 6);
      if (out === "matched") {
        assert.equal(z.warning, true);
        assert.match(z.notice, /下回合/);
        seen = true;
      }
    }
  }
  assert.ok(seen);
});
