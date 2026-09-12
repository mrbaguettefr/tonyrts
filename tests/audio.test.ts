import test from "node:test";
import assert from "node:assert/strict";
import { MUSIC_TRACKS, TRACK_STEPS, musicStep } from "../src/music";
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


test("three distinct arranged scores have finite, bounded notes", () => {
  assert.equal(MUSIC_TRACKS.length, 3);
  const signatures = new Set<string>();
  for (let track = 0; track < MUSIC_TRACKS.length; track++) {
    const score = Array.from({ length: TRACK_STEPS }, (_, step) => musicStep(track, step));
    signatures.add(JSON.stringify(score));
    for (const notes of score) {
      assert.ok(notes.length <= 14);
      for (const note of notes) {
        assert.ok(Number.isFinite(note.hz) && note.hz > 0);
        assert.ok(note.targetHz > 0 && note.duration > 0);
        assert.ok(note.amplitude > 0 && note.amplitude <= 0.32);
      }
    }
    const count = (from: number, to: number) => score.slice(from * 16, to * 16).reduce((sum, notes) => sum + notes.length, 0);
    assert.ok(count(24, 32) > count(40, 48), "assault is denser than breakdown");
  }
  assert.equal(signatures.size, 3);
});

test("random first track, sequential transitions, wraparound and no reroll on unlock/reset", async (t) => {
  let context: Context;
  class ClockContext extends Context {
    constructor() {
      super();
      context = this;
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: ClockContext });
  let schedule: () => void = () => {};
  t.mock.method(globalThis, "setInterval", (callback: () => void) => {
    schedule = callback;
    return 123;
  });
  t.mock.method(globalThis, "clearInterval", () => {});
  try {
    for (const first of [0, 1, 2]) {
      const random = t.mock.method(Math, "random", () => (first + 0.5) / 3);
      const engine = createAudio();
      try {
        assert.equal(engine.diagnostics().musicTrack, null);
        await engine.unlock();
        assert.equal(engine.diagnostics().musicTrack, MUSIC_TRACKS[first]!.title);
        engine.reset();
        await engine.unlock();
        assert.equal(random.mock.callCount(), 1);
        let elapsed = 0.03;
        for (let offset = 0; offset < 4; offset++) {
          const index = (first + offset) % 3;
          const step = 60 / MUSIC_TRACKS[index]!.bpm / 4;
          // Advance close enough to each event to exercise lookahead without rebasing.
          for (let tick = offset === 0 ? 2 : 0; tick < TRACK_STEPS; tick++) {
            context!.currentTime = elapsed + tick * step - 0.01;
            schedule();
          }
          elapsed += TRACK_STEPS * step;
          assert.equal(engine.diagnostics().musicTrack, MUSIC_TRACKS[(index + 1) % 3]!.title);
        }
      } finally {
        engine.dispose();
        random.mock.restore();
      }
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "AudioContext", descriptor);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});
