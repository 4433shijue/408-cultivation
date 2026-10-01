import { remaining } from "./realtime";
import Phaser from "phaser";
import { CROPS } from "./content";
import type { SaveData, Tab } from "./model";
export class Playfield extends Phaser.Scene {
  private mode: Tab = "farm";
  private plots: Phaser.GameObjects.Container[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private tiles: Phaser.GameObjects.Image[] = [];
  private markers: Phaser.GameObjects.Text[] = [];
  private board?: Phaser.GameObjects.Image;
  private current: SaveData | null = null;
  private action: (i: number) => void = () => {};
  constructor() {
    super("world");
  }
  preload() {
    this.load.image("board", "assets/v2/ui-3.png");
    for (let i = 0; i < 52; i++)
      this.load.image(
        "icon" + i,
        `assets/${i < 36 ? "v2" : "v3"}/icon-${i}.png`,
      );
    for (let i = 0; i < 8; i++)
      this.load.image("fx" + i, `assets/v2/fx-${i}.png`);
  }
  create() {
    for (let i = 0; i < 9; i++) {
      const x = 270 + (i % 3) * 225,
        y = 285 + Math.floor(i / 3) * 110;
      const soil = this.add.image(0, 5, "icon9").setDisplaySize(200, 122);
      const crop = this.add.image(0, -28, "icon0").setDisplaySize(130, 130);
      const label = this.add
        .text(0, 54, "", {
          fontFamily: "Microsoft YaHei",
          fontSize: "15px",
          color: "#fff8de",
          backgroundColor: "#254b40db",
          padding: { x: 12, y: 5 },
        })
        .setOrigin(0.5);
      label.setPosition(x, y + 54).setDepth(10);
      this.labels.push(label);
      const c = this.add.container(x, y, [soil, crop]);
      soil
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.action(i));
      crop
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.action(i));
      this.plots.push(c);
    }
    this.board = this.add
      .image(492.5, 347.5, "board")
      .setDisplaySize(505, 505)
      .setDepth(-1);
    for (let i = 0; i < 36; i++) {
      const t = this.add
        .image(300 + (i % 6) * 77, 155 + Math.floor(i / 6) * 77, "icon21")
        .setDisplaySize(66, 66)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.action(i));
      this.tiles.push(t);
      this.markers.push(
        this.add
          .text(t.x + 20, t.y - 26, "", {
            fontSize: "15px",
            color: "#fff9d8",
            backgroundColor: "#294637",
            padding: { x: 3, y: 2 },
          })
          .setDepth(15),
      );
    }
    this.game.events.emit("world-ready");
  }
  show(tab: Tab, s: SaveData, action: (i: number) => void) {
    this.mode = tab;
    this.current = s;
    this.action = action;
    this.board?.setVisible(tab === "battle" && !!s.battle);
    this.plots.forEach((c, i) => {
      c.setVisible(tab === "farm");
      this.labels[i].setVisible(tab === "farm");
      if (tab !== "farm") return;
      const p = s.plots[i];
      const soil = c.list[0] as Phaser.GameObjects.Image,
        crop = c.list[1] as Phaser.GameObjects.Image,
        label = this.labels[i];
      soil.setTexture(p.watered ? "icon10" : "icon9").setDisplaySize(200, 122);
      crop.setVisible(!!p.crop);
      if (p.crop)
        crop.setTexture(
          "icon" +
            (CROPS[p.crop].icon +
              Math.min(2, Math.floor((p.stage * 2) / CROPS[p.crop].days))),
        );
      crop.setScale(Math.min(130 / crop.width, 130 / crop.height));
      label.setText(
        !p.crop
          ? "播种"
          : p.stage >= CROPS[p.crop].days
            ? "可收获"
            : p.watered
              ? remaining((p.readyAt ?? 0) - s.lastSeen)
              : remaining((p.readyAt ?? 0) - s.lastSeen) + " · 可浇水",
      );
    });
    this.tiles.forEach((t, i) => {
      t.setVisible(tab === "battle" && !!s.battle);
      if (t.input)
        t.input.enabled = tab === "battle" && s.battle?.status === "playing";
      const marker = this.markers[i];
      marker.setVisible(
        tab === "battle" &&
          !!s.battle &&
          !!(s.battle.blocks[i] || s.battle.specials[i]),
      );
      if (s.battle) {
        marker.setText(
          s.battle.blocks[i]
            ? `${{ vine: "藤", stone: "石", ice: "冰", seal: "封" }[s.battle.blockKinds[i]]}${s.battle.blocks[i]}`
            : s.battle.specials[i] === "row"
              ? "横扫"
              : s.battle.specials[i] === "color"
                ? "同色"
                : "",
        );
        t.setTint(
          s.battle.blocks[i]
            ? 0x829e9c
            : s.battle.specials[i]
              ? 0xffd971
              : 0xffffff,
        );
        t.setTexture("icon" + (21 + s.battle.cells[i])).setDisplaySize(66, 66);
        t.setAlpha(s.battle.selected === i ? 0.65 : 1);
      }
    });
  }
  pulse(index: number, harvest = false) {
    if (this.current?.reducedMotion) return;
    const c = this.plots[index];
    if (!c) return;
    this.tweens.add({ targets: c, y: c.y - 8, duration: 120, yoyo: true });
    const fx = this.add
      .image(c.x, c.y - 30, harvest ? "fx1" : "fx2")
      .setDisplaySize(140, 140)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: fx,
      y: harvest ? 50 : c.y,
      alpha: 0,
      x: harvest ? 930 : c.x,
      duration: 650,
      onComplete: () => fx.destroy(),
    });
  }
  async exchange(a: number, b: number, valid: boolean) {
    if (this.current?.reducedMotion || this.mode !== "battle") return;
    const x = this.tiles[a],
      y = this.tiles[b];
    const px = x.x,
      py = x.y,
      qx = y.x,
      qy = y.y;
    await new Promise<void>((done) =>
      this.tweens.add({
        targets: x,
        x: qx,
        y: qy,
        duration: 150,
        onComplete: () => done(),
      }),
    );
    y.setPosition(px, py);
    if (!valid)
      await new Promise<void>((done) =>
        this.tweens.add({
          targets: x,
          x: px,
          y: py,
          duration: 150,
          onComplete: () => done(),
        }),
      );
    else {
      const fx = this.add
        .image((px + qx) / 2, (py + qy) / 2, "fx7")
        .setDisplaySize(210, 210)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: fx,
        alpha: 0,
        duration: 350,
        onComplete: () => fx.destroy(),
      });
      await new Promise<void>((done) =>
        this.tweens.add({
          targets: this.tiles,
          alpha: 0.25,
          duration: 130,
          yoyo: true,
          onComplete: () => done(),
        }),
      );
    }
    x.setPosition(px, py);
    y.setPosition(qx, qy);
  }
  drop() {
    if (this.current?.reducedMotion) return;
    this.tiles.forEach((t, i) => {
      const y = 155 + Math.floor(i / 6) * 77;
      t.y = y - 15;
      this.tweens.add({ targets: t, y, duration: 200, delay: (i % 6) * 20 });
    });
  }
}
