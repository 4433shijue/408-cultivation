const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../work/rules/model.js");
const p = require("../work/rules/progression.js");
const c = require("../work/rules/content.js");
function make(s, id) {
  const r = c.RECIPES.find((r) => r.id === id);
  assert.ok(p.canPay(s, r.inputs));
  assert.ok(s.board.every((i) => !i));
  let n = 0;
  for (const [item, count] of Object.entries(r.inputs))
    for (let j = 0; j < count; j++) {
      s.inventory[item]--;
      s.board[n++] = item;
    }
  m.craft(s);
}
test("first chapter completes on day 10 using only earned crops, orders and free seed supply", () => {
  const s = m.newSave("female", "青禾");
  for (let i = 0; i < 3; i++) m.onPlot(s, i);
  make(s, "tea");
  m.deliver(s);
  for (const person of c.PEOPLE) m.chat(s, person.id);
  p.claimChapter(s);
  const crops = [
    "herb",
    "rice",
    "mint",
    "mint",
    "berry",
    "chrys",
    "lotus",
    "lotus",
    "rice",
  ];
  for (let i = 0; i < 9; i++) {
    if (!s.seeds) s.seeds = 3;
    s.selectedCrop = crops[i];
    m.onPlot(s, i);
    m.onPlot(s, i);
  }
  for (let day = 2; day <= 10; day++) {
    m.nextDay(s);
    for (const person of c.PEOPLE) m.chat(s, person.id);
    for (let i = 0; i < 9; i++) {
      const plot = s.plots[i];
      if (plot.crop) m.onPlot(s, i);
    }
    if (day === 3) {
      p.upgrade(s, "rack");
      p.claimChapter(s);
      make(s, "dried");
      make(s, "dried");
    }
    if (day === 4) {
      p.collectDrying(s);
      for (let i = 0; i < 4; i++) {
        assert.ok(s.coins >= 8);
        s.coins -= 8;
        s.inventory.ore++;
      }
      p.upgrade(s, "spring");
      p.claimChapter(s);
      p.upgrade(s, "workshop");
      make(s, "sachet");
      make(s, "jam");
      p.claimChapter(s);
      make(s, "tonic");
    }
    if (day < 10 && s.home.chapter === 4)
      assert.throws(() => p.claimChapter(s));
    m.validateSave(s);
  }
  p.claimChapter(s);
  p.claimChapter(s);
  assert.equal(s.home.chapter, 6);
  assert.equal(s.qi, 0);
  assert.equal(s.home.harvested.length, 6);
  assert.deepEqual(s.home.facilities, {
    spring: true,
    workshop: true,
    rack: true,
  });
  const coins = s.coins;
  assert.throws(() => p.claimChapter(s));
  assert.equal(s.coins, coins);
});
test("rain waters existing and newly planted crops, but does not retroactively grow a dry plot", () => {
  const s = m.newSave("male", "禾");
  s.day = 2;
  m.onPlot(s, 3);
  m.nextDay(s);
  assert.equal(p.weather(s), "雨");
  assert.equal(s.plots[3].stage, 0);
  assert.ok(s.plots[3].watered);
  m.onPlot(s, 4);
  assert.ok(s.plots[4].watered);
  m.nextDay(s);
  assert.equal(s.plots[4].stage, 1);
});
test("locked upgrade and locked chapter cost are atomic; duplicate upgrades do not charge", () => {
  const s = m.newSave("female", "禾");
  s.inventory.rice = 2;
  s.locked = ["herb"];
  const before = JSON.stringify(s);
  assert.throws(() => p.upgrade(s, "rack"));
  assert.equal(JSON.stringify(s), before);
  s.locked = [];
  p.upgrade(s, "rack");
  const coins = s.coins;
  assert.throws(() => p.upgrade(s, "rack"));
  assert.equal(s.coins, coins);
  s.home.chapter = 5;
  s.inventory.tonic = 1;
  s.locked = ["tonic"];
  assert.throws(() => p.claimChapter(s));
  assert.equal(s.inventory.tonic, 1);
});
test("drying capacity and unlocked facility enforced without consuming board; collection survives days and is once only", () => {
  const s = m.newSave("male", "禾");
  s.board = ["herb", "mint", null, null, null, null, null, null, null];
  assert.throws(() => m.craft(s));
  assert.equal(s.board[0], "herb");
  s.home.facilities.rack = true;
  m.craft(s);
  assert.equal(s.inventory.dried, 0);
  assert.throws(() => p.collectDrying(s));
  s.home.facilities.workshop = true;
  s.inventory.herb = 10;
  s.inventory.mint = 10;
  const inv = JSON.stringify(s.inventory);
  assert.throws(() => p.batchCraft(s, "dried"));
  assert.equal(JSON.stringify(s.inventory), inv);
  for (let i = 0; i < 20; i++) m.nextDay(s);
  assert.equal(p.collectDrying(s), 1);
  assert.throws(() => p.collectDrying(s));
  p.batchCraft(s, "dried");
  assert.equal(s.home.drying[0].count, 3);
});
test("three friendship chapters each, repeat visits guarded and persisted", () => {
  const s = m.newSave("female", "禾");
  s.home.chapter = 3;
  for (let day = 1; day <= 13; day++) {
    for (const person of c.PEOPLE) m.chat(s, person.id);
    if (day < 13) m.nextDay(s);
  }
  for (const person of c.PEOPLE)
    for (const suffix of ["", "-2", "-3"])
      assert.ok(s.events.includes(person.id + suffix));
  s.day = 15;
  p.welcomeVisitor(s);
  const seeds = s.seeds;
  assert.throws(() => p.welcomeVisitor(s));
  assert.equal(s.seeds, seeds);
  assert.equal(
    m.migrate(JSON.parse(JSON.stringify(s))).home.visits[0],
    "visit-15",
  );
});
test("v0.2 homestead migration preserves facts and malformed expansion data is rejected", () => {
  const old = m.newSave("female", "旧友");
  old.day = 80;
  old.inventory.herb = 17;
  old.version = 2;
  delete old.home;
  delete old.companion;
  for (const id of [
    "mint",
    "berry",
    "chrys",
    "dried",
    "jam",
    "sachet",
    "tonic",
  ])
    delete old.inventory[id];
  const migrated = m.migrate(old);
  assert.equal(migrated.home.startedOn, 80);
  assert.equal(migrated.inventory.herb, 17);
  assert.equal(migrated.home.harvested.length, 0);
  migrated.home.drying = [{ readyOn: 81, count: -1 }];
  assert.throws(() => m.validateSave(migrated));
});
