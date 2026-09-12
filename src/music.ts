/** Original industrial RTS score. Each track has a 64-bar arrangement in 4/4. */
export const MUSIC_TRACKS = [
  {
    title: "Iron Mobilization",
    bpm: 132,
    root: 36,
    progression: [0, 0, -1, 3, 0, -1, 5, -2],
    bass: [0, 0, null, 12, 0, null, 7, 0, 0, null, 12, 0, 3, 0, 7, -1],
    lead: [12, null, 12, 19, null, 18, 15, null, 12, null, 10, 12, 15, null, 11, null],
    kicks: [0, 6, 8, 11, 14],
  },
  {
    title: "Continental Siege",
    bpm: 144,
    root: 33,
    progression: [0, 3, 0, 6, 0, -2, 1, -2],
    bass: [0, null, 0, 0, 6, null, 0, 12, 0, 0, null, 7, 0, 6, 3, null],
    lead: [19, null, 18, null, 12, 12, null, 15, 18, null, 19, 24, null, 18, 13, 12],
    kicks: [0, 3, 8, 10, 14],
  },
  {
    title: "Global War Machine",
    bpm: 126,
    root: 38,
    progression: [0, -2, -5, -1, 0, 3, -2, -1],
    bass: [0, 0, 12, null, 0, 7, null, 0, 0, 12, 0, null, 6, 7, 0, -1],
    lead: [12, null, 7, 12, null, 13, 12, null, 19, 18, null, 15, 13, null, 12, 11],
    kicks: [0, 2, 7, 8, 12, 15],
  },
] as const;

export const TRACK_STEPS = 64 * 16;
export type MusicNote = {
  hz: number;
  duration: number;
  amplitude: number;
  type: OscillatorType;
  targetHz: number;
};
const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** Pure score rendering keeps arrangement and playlist behavior testable. */
export function musicStep(trackIndex: number, stepIndex: number): MusicNote[] {
  const track = MUSIC_TRACKS[trackIndex]!;
  const step = 60 / track.bpm / 4;
  const bar = Math.floor(stepIndex / 16);
  const tick = stepIndex % 16;
  // Intro, march, assault, breakdown, rebuild, final offensive, turnaround.
  const section = bar < 8 ? 0 : bar < 24 ? 1 : bar < 40 ? 2 : bar < 48 ? 3 : bar < 56 ? 4 : bar < 62 ? 5 : 6;
  const full = section === 2 || section === 5;
  const sparse = section === 0 || section === 3 || section === 6;
  const root = track.root + track.progression[Math.floor(bar / 2) % 8]!;
  const notes: MusicNote[] = [];
  function hit(hz: number, duration: number, amplitude: number, type: OscillatorType, targetHz = hz) {
    notes.push({ hz, duration, amplitude, type, targetHz });
  }
  if (tick === 0 && bar % 2 === 0) {
    // Low alarm-like brass fifths, with a semitone tension in the breakdown.
    for (const interval of [12, section === 3 ? 13 : 19])
      hit(frequency(root + interval), step * (sparse ? 12 : 6), 0.022, "sawtooth");
  }
  const bass = track.bass[tick];
  if (bass !== null && (!sparse || tick % 4 === 0)) {
    hit(frequency(root + bass), step * 0.85, 0.065, "sawtooth");
    hit(frequency(root - 12), step * 0.8, 0.095, "sine");
  }
  if ((sparse ? tick === 0 || tick === 8 : (track.kicks as readonly number[]).includes(tick))) {
    hit(155, 0.19, 0.32, "sine", 36);
    hit(950, 0.018, 0.045, "triangle", 80);
  }
  if (section !== 0 && (tick === 4 || tick === 12)) {
    hit(185, 0.14, 0.11, "triangle", 65);
    // Inharmonic sweeps create the clang of struck sheet metal.
    hit(1643, 0.065, 0.033, "square", 431);
    hit(2371, 0.085, 0.025, "square", 719);
  }
  if (!sparse && (tick % 2 === 0 || full))
    hit(tick % 4 === 2 ? 6173 : 4319, tick % 4 === 2 ? 0.055 : 0.022, tick % 2 === 0 ? 0.018 : 0.009, "square", 2813);
  if (full || (section === 4 && bar >= 52)) {
    const lead = track.lead[(tick + (bar % 2) * 4) % 16];
    if (lead !== null && lead !== undefined)
      hit(frequency(root + lead), step * 1.3, 0.033, "sawtooth");
  }
  if (!sparse && bar % 8 === 7 && tick >= 12)
    hit(180 - (tick - 12) * 23, step * 0.8, 0.13, "triangle", 42);
  if (tick === 0 && (bar === 8 || bar === 24 || bar === 48 || bar === 56)) {
    hit(73, 0.9, 0.16, "sawtooth", 25);
    hit(3271, 0.65, 0.024, "square", 313);
  }
  return notes;
}
