const test = require("node:test"),
  assert = require("node:assert/strict");
const m = require("../work/rules/model.js"),
  r = require("../work/rules/companion/rules.js");
const session = (now = 1000) => ({
  id: "s",
  npcId: "lin",
  mode: "together",
  scene: "静室",
  courseId: "",
  length: "standard",
  durationMs: 1500000,
  elapsedMs: 0,
  startedAt: now,
  deadline: now + 1500000,
  status: "running",
  createdAt: now,
  endedAt: 0,
  gameDay: 1,
  ending: "none",
  endingJobId: "",
  feedback: "",
  understanding: "",
});
test("orientation, friendship gates and explicit romance all enforced", () => {
  for (const gender of ["male", "female"])
    for (const npc of r.npcIds) {
      const s = m.newSave(gender, "禾");
      assert.equal(r.canDual(s, npc), false);
      s.affinity[npc] = 12;
      s.events.push(npc, npc + "-2", npc + "-3");
      assert.equal(r.canRomance(s, npc), npc !== "lin" || gender === "female");
      assert.equal(r.canDual(s, npc), false);
      s.companion.romances.push(npc);
      assert.equal(r.canDual(s, npc), npc !== "lin" || gender === "female");
    }
});
test("timer pause, refresh, deadline, correction and repeated finish preserve effective time", () => {
  let s = session();
  r.pause(s, 61000);
  assert.equal(s.elapsedMs, 60000);
  assert.equal(r.elapsed(s, 3600000), 60000);
  s = JSON.parse(JSON.stringify(s));
  r.resume(s, 3600000);
  assert.equal(s.deadline, 5040000);
  r.correctTime(s, 0.5, 3600000);
  assert.equal(r.elapsed(s, 3600000), 30000);
  assert.throws(() => r.correctTime(s, 2, 3600000));
  r.finish(s, 9999999, true);
  assert.equal(s.elapsedMs, 1500000);
  assert.equal(s.ending, "waiting");
  const end = s.endedAt;
  r.finish(s, 19999999);
  assert.equal(s.endedAt, end);
  r.correctTime(s, 10);
  assert.equal(s.elapsedMs, 600000);
});
test("course URLs keep exact part and timestamp, credentials and executable URLs rejected", () => {
  const url = "https://www.bilibili.com/video/BVtest?p=12&t=1122";
  assert.equal(r.safeUrl(url), url);
  assert.equal(r.inferPart(url), 12);
  assert.throws(() => r.safeUrl("javascript:alert(1)"));
  assert.throws(() => r.safeUrl("https://a:b@example.com"));
  assert.equal(
    r.courseLink({ url, partUrl: "https://example.com/lecture#t=38" }),
    "https://example.com/lecture#t=38",
  );
});
test("v2 migration retains game, home, answers and orientations by stable person id", () => {
  const old = m.newSave("male", "旧友");
  old.version = 2;
  delete old.companion;
  old.affinity = { lin: 20, yu: 15, shen: 8 };
  const before = JSON.stringify(old);
  const next = m.migrate(old);
  assert.equal(next.version, 3);
  assert.deepEqual(next.affinity, old.affinity);
  assert.equal(next.companion.romances.length, 0);
  assert.equal(JSON.stringify(old), before);
  assert.ok(next.companion.profileId);
});
test("companion import rejects duplicate sessions, broken fields and unsafe course URLs", () => {
  const d = r.freshData("p");
  d.sessions.push(session());
  assert.ok(r.validateData(d));
  d.sessions.push({ ...session(), id: "s2" });
  assert.throws(() => r.validateData(d));
  d.sessions = [];
  d.courses.push({
    id: "c",
    title: "课程",
    subject: "408",
    url: "javascript:x",
    part: 1,
    partTitle: "",
    partUrl: "",
    position: "",
    note: "",
    updatedAt: 0,
  });
  assert.throws(() => r.validateData(d));
});
