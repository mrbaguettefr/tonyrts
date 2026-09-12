import test from "node:test";
import assert from "node:assert/strict";
import { createAudio } from "../src/audio";
import { createGame } from "../src/simulation";
import { createWorld } from "../src/world";

class Param {
  value = 1;
  setTargetAtTime(v: number) {
    this.value = v;
  }
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class Node {
  gain = new Param();
  frequency = new Param();
  type = "";
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}
class Context {
  static count = 0;
  currentTime = 0;
  state = "suspended";
  destination = new Node();
  constructor() {
    Context.count++;
  }
  createGain() {
    return new Node();
  }
  createOscillator() {
    return new Node();
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
}

test("gesture unlock, fog-safe events, bounded voices, mute persistence and disposal", async () => {
  const oldContext = Object.getOwnPropertyDescriptor(
    globalThis,
    "AudioContext",
  );
  const oldStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: Context,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  const engine = createAudio();
  try {
    assert.equal(Context.count, 0);
    engine.cue("select");
    assert.equal(Context.count, 0);
    await engine.unlock();
    assert.equal(engine.diagnostics().unlocked, true);
    const game = createGame(createWorld("audio"));
    const options = { running: true, menuOpen: false };
    engine.update(game, 0, options);
    const before = engine.diagnostics().activeVoices;
    game.visible[0]!.fill(0);
    game.explosions.push({
      id: 100,
      position: game.world.cells[0]!.position,
      age: 0,
      duration: 1,
      size: 1,
    });
    engine.update(game, 0, options);
    assert.equal(
      engine.diagnostics().activeVoices,
      before,
      "hidden enemy combat stays silent",
    );
    game.visible[0]!.fill(1);
    game.explosions.push({
      id: 101,
      position: game.world.cells[0]!.position,
      age: 0,
      duration: 1,
      size: 1,
    });
    engine.update(game, 0, options);
    assert.equal(
      engine.diagnostics().activeVoices,
      before + 2,
      "visible new explosion produces sound",
    );
    engine.reset();
    const resetCount = engine.diagnostics().activeVoices;
    engine.update(game, 0, options);
    assert.equal(
      engine.diagnostics().activeVoices,
      resetCount,
      "snapshot after reset does not replay events",
    );
    for (const cue of [
      "build",
      "deploy",
      "victory",
      "defeat",
      "ready",
      "queue",
    ] as const)
      engine.cue(cue);
    assert.ok(engine.diagnostics().activeVoices <= 24);
    engine.setVolumes(2, -0.5);
    engine.setMuted(true);
    assert.deepEqual(engine.getSettings(), { sfx: 1, music: 0, muted: true });
    const persisted = createAudio();
    assert.deepEqual(persisted.getSettings(), engine.getSettings());
    persisted.dispose();
    const mutedCount = engine.diagnostics().activeVoices;
    engine.cue("move");
    assert.equal(engine.diagnostics().activeVoices, mutedCount);
    engine.dispose();
    assert.equal(engine.diagnostics().activeVoices, 0);
    assert.equal(engine.diagnostics().musicPlaying, false);
  } finally {
    engine.dispose();
    if (oldContext)
      Object.defineProperty(globalThis, "AudioContext", oldContext);
    else Reflect.deleteProperty(globalThis, "AudioContext");
    if (oldStorage)
      Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
