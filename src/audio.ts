// Gentle local Web Audio synthesis. Starts only after an explicit user gesture.
class Soundscape {
  private context?: AudioContext;
  private master?: GainNode;
  private wind?: BiquadFilterNode;
  private timer = 0;
  private enabled = false;
  async set(enabled: boolean, rainy = false) {
    this.enabled = enabled;
    if (!enabled) {
      if (this.context) await this.context.suspend();
      window.clearInterval(this.timer);
      this.timer = 0;
      return;
    }
    if (!this.context) {
      this.context = new AudioContext();
      const c = this.context;
      this.master = c.createGain();
      this.master.gain.value = 0.12;
      this.master.connect(c.destination);
      const buffer = c.createBuffer(1, c.sampleRate * 3, c.sampleRate),
        data = buffer.getChannelData(0);
      let value = 0;
      for (let i = 0; i < data.length; i++) {
        value = (value + (Math.random() * 2 - 1) * 0.03) / 1.02;
        data[i] = value;
      }
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      this.wind = c.createBiquadFilter();
      this.wind.type = "lowpass";
      source.connect(this.wind);
      this.wind.connect(this.master);
      source.start();
    }
    if (!document.hidden) await this.context.resume();
    this.weather(rainy);
    if (!this.timer)
      this.timer = window.setInterval(() => {
        if (!document.hidden) this.effect("bird");
      }, 11000);
  }
  weather(rainy: boolean) {
    if (this.wind && this.context && this.master) {
      this.wind.frequency.setTargetAtTime(
        rainy ? 2200 : 500,
        this.context.currentTime,
        0.5,
      );
      this.master.gain.setTargetAtTime(
        rainy ? 0.22 : 0.12,
        this.context.currentTime,
        0.5,
      );
    }
  }
  effect(kind: "water" | "harvest" | "craft" | "bird") {
    const c = this.context;
    if (!this.enabled || !c || c.state !== "running") return;
    const o = c.createOscillator(),
      g = c.createGain(),
      t = c.currentTime;
    const hz = { water: 340, harvest: 660, craft: 520, bird: 1400 }[kind];
    o.type = "sine";
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(
      hz * (kind === "water" ? 0.5 : 1.5),
      t + 0.2,
    );
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.5);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  visibility() {
    if (this.context) {
      if (document.hidden) void this.context.suspend();
      else if (this.enabled) void this.context.resume();
    }
  }
}
export const sound = new Soundscape();
document.addEventListener("visibilitychange", () => sound.visibility());
