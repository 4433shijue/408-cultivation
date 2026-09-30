const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../work/rules/model.js"),
  b = require("../work/rules/battle.js"),
  c = require("../work/rules/content.js");
const seeds = require("../shared/seeds.json");
test("new game has harvest and free-start resources", () => {
  const s = m.newSave("female", "阿禾");
  assert.equal(s.plots.filter((p) => p.stage === 2).length, 3);
  m.onPlot(s, 0);
  assert.equal(s.inventory.herb, 4);
  assert.ok(s.tutorial.harvested);
});
test("watering advances only at next day; mature crops persist", () => {
  const s = m.newSave("male", "阿禾");
  m.onPlot(s, 3);
  m.nextDay(s);
  assert.equal(s.plots[3].stage, 0);
  m.onPlot(s, 3);
  m.nextDay(s);
  assert.equal(s.plots[3].stage, 1);
  assert.equal(s.plots[0].stage, 2);
});
test("recipes require exact inputs and locked ingredients are preserved", () => {
  const s = m.newSave("female", "禾");
  s.board[0] = "herb";
  assert.throws(() => m.craft(s));
  assert.equal(s.board[0], "herb");
  s.board[1] = "herb";
  s.locked = ["herb"];
  assert.throws(() => m.craft(s));
  s.locked = [];
  assert.equal(m.craft(s), "tea");
  assert.equal(s.inventory.tea, 1);
  assert.ok(s.board.every((x) => !x));
});
test("orders pay once per actual inventory and cycle", () => {
  const s = m.newSave("female", "禾");
  s.inventory.tea = 1;
  m.deliver(s);
  assert.equal(s.coins, 34);
  assert.equal(s.orderIndex, 1);
  assert.throws(() => m.deliver(s));
});
test("answers are idempotent, wrong and reviews never grant qi", () => {
  const s = m.newSave("female", "禾");
  m.answer(s, seeds[0], 0);
  m.answer(s, seeds[0], 0);
  assert.equal(s.qi, 10);
  m.answer(s, seeds[1], 0);
  assert.equal(s.qi, 10);
  m.answer(s, seeds[1], 1, true);
  assert.equal(s.qi, 10);
  assert.equal(s.answers.length, 2);
});
test("all six crops and all eight recipes usable", () => {
  for (const crop of Object.keys(c.CROPS)) {
    const s = m.newSave("female", "禾");
    s.tutorial.crafted = true;
    s.selectedCrop = crop;
    m.onPlot(s, 3);
    for (let i = 0; i < c.CROPS[crop].days; i++) {
      m.onPlot(s, 3);
      m.nextDay(s);
    }
    m.onPlot(s, 3);
    assert.ok(s.inventory[crop] >= 2);
  }
  for (const r of c.RECIPES) {
    const s = m.newSave("male", "禾");
    s.home.facilities = { spring: true, workshop: true, rack: true };
    let n = 0;
    for (const [i, count] of Object.entries(r.inputs))
      for (let j = 0; j < count; j++) s.board[n++] = i;
    assert.equal(m.craft(s), r.output);
  }
});
test("battle boards have moves, valid result and one reward", () => {
  for (let level = 0; level < 3; level++) {
    const s = m.newSave("male", "禾");
    s.battle = b.newBattle(level);
    assert.equal(b.matches(s.battle.cells).size, 0);
    assert.ok(b.hasMove(s.battle.cells));
    s.battle.status = "won";
    assert.ok(m.rewardBattle(s));
    assert.equal(m.rewardBattle(s), false);
    assert.equal(s.inventory.ore, c.LEVELS[level].reward);
  }
});
test("invalid exchange does not consume move", () => {
  const state = b.newBattle();
  let found = false;
  for (let i = 0; i < 35 && !found; i++) {
    if (i % 6 === 5) continue;
    const copy = structuredClone(state);
    b.selectBattleTile(copy, i);
    if (b.selectBattleTile(copy, i + 1) === "invalid") {
      assert.equal(copy.moves, state.moves);
      assert.deepEqual(copy.cells, state.cells);
      found = true;
    }
  }
  assert.ok(found);
});
test("all NPC events trigger once, gifting respects locks", () => {
  for (const p of c.PEOPLE) {
    const s = m.newSave("female", "禾");
    s.inventory[p.gift] = 1;
    s.locked = [p.gift];
    assert.throws(() => m.chat(s, p.id, true));
    s.locked = [];
    m.chat(s, p.id);
    m.chat(s, p.id, true);
    assert.ok(s.events.includes(p.id));
    const seeds = s.seeds;
    m.nextDay(s);
    m.chat(s, p.id);
    assert.equal(s.seeds, seeds);
  }
});
test("breakthrough requires all tutorials and is one-time", () => {
  const s = m.newSave("male", "禾");
  s.qi = 50;
  assert.equal(m.breakthrough(s), false);
  Object.keys(s.tutorial).forEach((k) => (s.tutorial[k] = true));
  assert.equal(m.breakthrough(s), true);
  assert.equal(m.breakthrough(s), false);
  m.onPlot(s, 0);
  assert.equal(s.inventory.herb, 5);
});
test("old save migration preserves facts without inventing answers", () => {
  const s = m.newSave("female", "旧禾");
  const old = { ...s, version: 1, answered: ["ds-01"], qi: 10 };
  delete old.answers;
  const migrated = m.migrate(old);
  assert.equal(migrated.name, "旧禾");
  assert.equal(migrated.answers[0].correct, null);
  assert.equal(migrated.qi, 10);
  assert.equal(m.validateSave(migrated).version, 3);
});
test("corrupt and malicious save payloads rejected", () => {
  assert.throws(() => m.migrate({ version: 99 }));
  const s = m.newSave("female", "禾");
  s.inventory.herb = -1;
  assert.throws(() => m.validateSave(s));
  s.inventory.herb = 1;
  s.plots = [];
  assert.throws(() => m.validateSave(s));
});
test("24 seed questions have valid answers and four balanced subjects", () => {
  assert.equal(seeds.length, 24);
  assert.equal(new Set(seeds.map((q) => q.id)).size, 24);
  for (const subject of new Set(seeds.map((q) => q.subject)))
    assert.equal(seeds.filter((q) => q.subject === subject).length, 6);
  for (const q of seeds) {
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.equal(q.options.length, 4);
    assert.ok(q.explanation.length > 10);
  }
});
