const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  newSave,
  migrate,
  validateSave,
  rewardBattle,
} = require("../work/rules/model.js");
const { syncTime } = require("../work/rules/realtime.js");
const {
  syncStamina,
  changeStamina,
  settleFailure,
} = require("../work/rules/stamina.js");
const { startTrial } = require("../work/rules/trials.js");
const { randomName, validateName } = require("../work/rules/identity.js");
test("stamina: hourly offline recovery, cap, residual time and clock rollback", () => {
  const s = newSave("female", "测试");
  const t = s.lastSeen;
  changeStamina(s, -2);
  syncTime(s, t + 3599999);
  assert.equal(s.stamina.value, 3);
  syncTime(s, t + 3600000);
  assert.equal(s.stamina.value, 4);
  syncTime(s, t + 3700000);
  changeStamina(s, -1);
  assert.equal(s.stamina.at, t + 3600000);
  syncTime(s, t + 7200000);
  assert.equal(s.stamina.value, 4);
  syncTime(s, t + 999999999);
  assert.equal(s.stamina.value, 5);
  changeStamina(s, -1);
  const at = s.stamina.at;
  syncTime(s, t);
  assert.equal(s.stamina.value, 4);
  assert.equal(s.stamina.at, at);
});
test("first clear rewards stamina once, replay does not; losses settle once across reload", () => {
  let s = newSave("female", "测试");
  changeStamina(s, -3);
  startTrial(s, 0);
  s.battle.status = "won";
  assert.equal(rewardBattle(s), true);
  assert.equal(s.stamina.value, 3);
  assert.equal(rewardBattle(s), false);
  startTrial(s, 0);
  s.battle.status = "won";
  rewardBattle(s);
  assert.equal(s.stamina.value, 3);
  startTrial(s, 1);
  s.battle.status = "lost";
  assert.equal(settleFailure(s), true);
  s = migrate(s);
  assert.equal(settleFailure(s), false);
  assert.equal(s.stamina.value, 2);
});
test("resume preserves attempt, explicit abandon only, empty stamina prevents entry", () => {
  const s = newSave("male", "测试");
  s.cleared = [0];
  startTrial(s, 0);
  const id = s.battle.id;
  startTrial(s, 0);
  assert.equal(s.battle.id, id);
  assert.throws(() => startTrial(s, 1));
  changeStamina(s, -4);
  assert.equal(startTrial(s, 1, id), false);
  assert.equal(s.stamina.value, 0);
  assert.equal(s.battle.status, "lost");
  assert.equal(startTrial(s, 1), false);
  assert.equal(settleFailure(s), false);
});
test("legacy v4 preserves full name and progress without retroactive loss; malformed extensions rejected", () => {
  const s = newSave("female", "欧阳知微");
  startTrial(s, 0);
  s.battle.status = "lost";
  delete s.revision;
  delete s.stamina;
  delete s.nameParts;
  const m = migrate(s);
  assert.equal(m.name, "欧阳知微");
  assert.equal(m.nameParts, null);
  assert.equal(m.stamina.value, 5);
  assert.equal(settleFailure(m), false);
  m.stamina.value = 6;
  assert.throws(() => migrate(m));
});
test("surname, given name and random names; identity must match full name", () => {
  const parts = validateName("欧阳", "知微");
  assert.equal(parts.surname + parts.givenName, "欧阳知微");
  for (let i = 0; i < 100; i++) {
    const n = randomName("欧阳");
    assert.equal(n.surname, "欧阳");
    validateName(n.surname, n.givenName);
  }
  assert.throws(() => validateName("沈", ""));
  assert.throws(() => validateName("沈", "<hi>"));
  const s = newSave("female", "欧阳知微");
  s.nameParts = parts;
  validateSave(s);
  s.name = "旧名";
  assert.throws(() => validateSave(s));
});
