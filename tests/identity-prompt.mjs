import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPrompt } from "../shared/companion-prompt.mjs";
const profiles = JSON.parse(
  readFileSync(new URL("../shared/npcs.json", import.meta.url)),
);
test("prompt uses current explicit given name, romance boundary and does not infer legacy split", () => {
  for (const npcId of ["lin", "yu", "shen"]) {
    const base = {
      npcId,
      kind: "chat",
      player: {
        name: "欧阳知微",
        surname: "欧阳",
        givenName: "知微",
        gender: "female",
        romance: true,
      },
    };
    let p = buildPrompt(base, profiles);
    assert.match(p[0].content, /仅在romance为true/);
    assert.match(p[1].content, /"givenName":"知微"/);
    p = buildPrompt(
      { ...base, player: { name: "欧阳知微", gender: "female" } },
      profiles,
    );
    assert.match(p[1].content, /"givenName":""/);
    p = buildPrompt(
      { ...base, player: { ...base.player, givenName: "旧名" } },
      profiles,
    );
    assert.match(p[1].content, /"givenName":""/);
  }
});
