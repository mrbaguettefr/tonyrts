import { SPECS } from "./simulation";
import type { Game, Team } from "./types";

export type AudioCue =
  | "select"
  | "move"
  | "build"
  | "error"
  | "queue"
  | "stop"
  | "deploy"
  | "ready"
  | "victory"
  | "defeat";
export interface AudioEngine {
  unlock(): Promise<void>;
  cue(name: AudioCue): void;
  update(
    game: Game,
    team: Team,
    options: { running: boolean; menuOpen: boolean },
  ): void;
  reset(): void;
  setVolumes(sfx: number, music: number): void;
  setMuted(muted: boolean): void;
  getSettings(): { sfx: number; music: number; muted: boolean };
  diagnostics(): {
    unlocked: boolean;
    musicPlaying: boolean;
    activeVoices: number;
    muted: boolean;
  };
  dispose(): void;
}
const KEY = "iron-orbit-audio";
const clamp = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

/** Original synthesized score and effects. No audio assets or autoplay before a gesture. */
export function createAudio(): AudioEngine {
  let settings = { sfx: 0.65, music: 0.24, muted: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved)
      settings = {
        sfx: clamp(saved.sfx, 0.65),
        music: clamp(saved.music, 0.24),
        muted: saved.muted === true,
      };
  } catch {
    /* Storage can be unavailable in private/embedded browsing. */
  }
  let context: AudioContext | undefined;
  let master: GainNode, effects: GainNode, music: GainNode;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false,
    ducked = false,
    nextBeat = 0,
    beat = 0;
  const voices = new Map<OscillatorNode, GainNode>();
  const lastCue = new Map<string, number>();
  let previous = new Map<number, { hp: number; progress: number }>();
  let shotIds = new Set<number>(),
    explosionIds = new Set<number>();
  let initialized = false,
    lastGameTime = -1,
    priorTeam: Team | undefined;
  let ended = false;

  function apply() {
    if (!context) return;
    master.gain.setTargetAtTime(
      settings.muted ? 0 : 0.7,
      context.currentTime,
      0.015,
    );
    effects.gain.setTargetAtTime(settings.sfx, context.currentTime, 0.015);
    music.gain.setTargetAtTime(
      settings.music * (ducked ? 0.38 : 1),
      context.currentTime,
      0.12,
    );
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* Optional persistence. */
    }
    apply();
  }
  function tone(
    hz: number,
    duration: number,
    amplitude: number,
    type: OscillatorType = "sine",
    delay = 0,
    targetHz = hz,
    musical = false,
  ) {
    if (
      !context ||
      context.state !== "running" ||
      settings.muted ||
      voices.size >= 24
    )
      return;
    const start = context.currentTime + Math.max(0, delay);
    const oscillator = context.createOscillator(),
      envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, targetHz),
      start + duration,
    );
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(
      amplitude,
      start + Math.min(0.035, duration / 5),
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(musical ? music : effects);
    voices.set(oscillator, envelope);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      voices.delete(oscillator);
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
  }
  function allowed(key: string, interval: number) {
    if (!context || settings.muted || context.state !== "running") return false;
    const time = context.currentTime;
    if (time - (lastCue.get(key) ?? -Infinity) < interval) return false;
    lastCue.set(key, time);
    return true;
  }
  function cue(name: AudioCue) {
    if (!allowed(name, 0.07)) return;
    const notes: Record<AudioCue, number[]> = {
      select: [540],
      move: [330, 495],
      build: [220, 330, 440],
      error: [130, 100],
      queue: [440, 550],
      stop: [300, 180],
      deploy: [220, 440, 660],
      ready: [392, 523, 659],
      victory: [262, 330, 392, 523, 659],
      defeat: [294, 262, 220, 147],
    };
    const finale = name === "victory" || name === "defeat";
    notes[name].forEach((hz, index) =>
      tone(
        hz,
        finale ? 0.65 : 0.16,
        0.12,
        "triangle",
        index * (finale ? 0.17 : 0.065),
      ),
    );
  }
  function schedule() {
    if (!context || context.state !== "running" || disposed) return;
    // Rebase after background throttling; never play a backlog of missed notes.
    if (nextBeat < context.currentTime - 0.2)
      nextBeat = context.currentTime + 0.03;
    const step = 60 / 84 / 2;
    while (nextBeat < context.currentTime + 0.18) {
      const delay = Math.max(0, nextBeat - context.currentTime);
      const roots = [110, 87.307, 130.813, 97.999];
      const root = roots[Math.floor(beat / 16) % roots.length]!;
      if (beat % 16 === 0) {
        [1, 1.189207, 1.498307].forEach((ratio) =>
          tone(
            root * 2 * ratio,
            step * 17,
            0.028,
            "sine",
            delay,
            root * 2 * ratio,
            true,
          ),
        );
      }
      if (beat % 4 === 0)
        tone(root / 2, step * 3.7, 0.12, "triangle", delay, root / 2, true);
      const intervals = [
        1, 1.498307, 2, 2.378414, 2, 1.498307, 1.189207, 1.498307,
      ];
      tone(
        root * 2 * intervals[beat % 8]!,
        step * 0.75,
        0.032,
        "triangle",
        delay,
        root * 2 * intervals[beat % 8]!,
        true,
      );
      if (beat % 4 === 0) tone(95, 0.15, 0.15, "sine", delay, 35, true);
      if (beat % 4 === 2) tone(740, 0.045, 0.024, "square", delay, 130, true);
      nextBeat += step;
      beat++;
    }
  }
  function reset() {
    previous.clear();
    shotIds.clear();
    explosionIds.clear();
    initialized = false;
    ended = false;
    lastGameTime = -1;
    priorTeam = undefined;
    lastCue.clear();
  }
  return {
    async unlock() {
      if (disposed) return;
      if (!context) {
        const Constructor = globalThis.AudioContext;
        if (!Constructor) return;
        context = new Constructor();
        master = context.createGain();
        effects = context.createGain();
        music = context.createGain();
        effects.connect(master);
        music.connect(master);
        master.connect(context.destination);
        // Initialize gain before connecting any source, including a muted first launch.
        master.gain.value = settings.muted ? 0 : 0.7;
        effects.gain.value = settings.sfx;
        music.gain.value = settings.music;
        apply();
      }
      try {
        await context.resume();
      } catch {
        return;
      }
      if (disposed || context.state !== "running") return;
      if (!timer) {
        nextBeat = context.currentTime + 0.03;
        timer = setInterval(schedule, 50);
        schedule();
      }
    },
    cue,
    update(game, team, options) {
      if (ducked !== (options.menuOpen || !options.running || game.paused)) {
        ducked = options.menuOpen || !options.running || game.paused;
        apply();
      }
      if (game.time < lastGameTime || priorTeam !== team) reset();
      priorTeam = team;
      lastGameTime = game.time;
      const active =
        initialized && options.running && !game.paused && !options.menuOpen;
      const current = new Map<number, { hp: number; progress: number }>();
      for (const entity of game.entities.values()) {
        if (entity.team !== team) continue;
        current.set(entity.id, { hp: entity.hp, progress: entity.progress });
        const prior = previous.get(entity.id);
        if (!active) continue;
        if (prior && prior.progress < 1 && entity.progress >= 1) cue("ready");
        else if (
          !prior &&
          entity.progress >= 1 &&
          !SPECS[entity.kind].building &&
          entity.kind !== "commander"
        )
          cue("deploy");
        if (prior && entity.hp < prior.hp && allowed("under-attack", 4)) {
          tone(220, 0.2, 0.12, "square");
          tone(294, 0.24, 0.1, "triangle", 0.22);
        }
      }
      const visible = (point: [number, number, number]) =>
        !!game.visible[team]?.[game.world.nearest(point)];
      if (active) {
        for (const shot of game.shots) {
          if (
            !shotIds.has(shot.id) &&
            (visible(shot.from) || visible(shot.to)) &&
            allowed("shot", 0.12)
          )
            tone(190, 0.11, 0.1, "sawtooth", 0, 55);
        }
        for (const explosion of game.explosions) {
          if (
            !explosionIds.has(explosion.id) &&
            visible(explosion.position) &&
            allowed("explosion", 0.2)
          ) {
            tone(85, 0.5, 0.22, "sawtooth", 0, 20);
            tone(47, 0.7, 0.18, "sine", 0, 17);
          }
        }
        if (!ended && (game.finished || game.players[team]?.eliminated)) {
          cue(game.finished && game.winner === team ? "victory" : "defeat");
          ended = true;
        }
      }
      previous = current;
      shotIds = new Set(game.shots.map((shot) => shot.id));
      explosionIds = new Set(game.explosions.map((explosion) => explosion.id));
      initialized = true;
    },
    reset,
    setVolumes(sfx, musicVolume) {
      settings.sfx = clamp(sfx, settings.sfx);
      settings.music = clamp(musicVolume, settings.music);
      save();
    },
    setMuted(muted) {
      settings.muted = muted;
      save();
    },
    getSettings: () => ({ ...settings }),
    diagnostics: () => ({
      unlocked: context?.state === "running",
      musicPlaying:
        !!timer &&
        context?.state === "running" &&
        !settings.muted &&
        settings.music > 0,
      activeVoices: voices.size,
      muted: settings.muted,
    }),
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      for (const [source, envelope] of voices) {
        source.onended = null;
        source.stop();
        source.disconnect();
        envelope.disconnect();
      }
      voices.clear();
      reset();
      if (context) {
        master.disconnect();
        effects.disconnect();
        music.disconnect();
        void context.close().catch(() => {});
      }
    },
  };
}
