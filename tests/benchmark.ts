import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorld } from "../src/world";
import { createGame, tick, SPECS } from "../src/simulation";
import { snapshotFor } from "../server/server";
import type { Team } from "../src/types";

const current = {
  label: "current",
  createWorld,
  createGame,
  tick,
  snapshotFor,
};
const implementations = [current];
// A compatible checkout allows paired comparisons under the same process/load.
// Importing server.ts defines helpers; it does not start a server.
if (process.argv[2]) {
  const root = resolve(process.argv[2]);
  const [world, simulation, server] = await Promise.all([
    import(pathToFileURL(resolve(root, "src/world.ts")).href),
    import(pathToFileURL(resolve(root, "src/simulation.ts")).href),
    import(pathToFileURL(resolve(root, "server/server.ts")).href),
  ]);
  implementations.unshift({
    label: "baseline",
    createWorld: world.createWorld,
    createGame: simulation.createGame,
    tick: simulation.tick,
    snapshotFor: server.snapshotFor,
  });
}

// Run outside the test runner so concurrent tests do not skew timings.
function fixture(count: number, implementation: typeof current) {
  const world = implementation.createWorld("perf-review", count);
  const game = implementation.createGame(
    world,
    Array.from({ length: count }, (_, i) => ({
      name: `Player ${i}`,
      controller: "human" as const,
    })),
  );
  const template = [...game.entities.values()][0];
  for (let team = 0; team < count; team++) {
    const cells = world.cells.filter(
      (c) => c.passable && world.distance(c.id, world.spawns[team]) < 45,
    );
    for (let i = 0; i < 99; i++) {
      const cell = cells[i % cells.length];
      const id = 10000 + team * 1000 + i;
      game.entities.set(id, {
        ...template,
        id,
        team: team as Team,
        kind: "tank",
        cell: cell.id,
        position: [...cell.position],
        hp: SPECS.tank.hp,
        orders: [],
        path: [],
        queue: [],
        production: 0,
      });
    }
  }
  return game;
}
function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (value: number) => +value.toFixed(3);
  return {
    medianMs: round(sorted[Math.floor(sorted.length / 2)]),
    p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]),
    maxMs: round(sorted.at(-1)!),
  };
}

console.log(
  JSON.stringify({
    node: process.version,
    seed: "perf-review",
    repetitions: 3,
    implementations: implementations.map((entry) => entry.label),
  }),
);
for (let run = 1; run <= 3; run++) {
  const order = run % 2 ? implementations : [...implementations].reverse();
  for (const count of [2, 4]) {
    for (const implementation of order) {
      const setupStart = performance.now();
      const game = fixture(count, implementation);
      const setupMs = performance.now() - setupStart;
      const samples: number[] = [];
      for (let i = 0; i < 80; i++) {
        const start = performance.now();
        implementation.tick(game, 0.05);
        samples.push(performance.now() - start);
      }
      assert.equal(game.entities.size, count * 100);
      assert.equal(game.finished, false);
      console.log(
        JSON.stringify({
          scenario: "stationary-fog",
          implementation: implementation.label,
          run,
          entities: count * 100,
          setupMs: +setupMs.toFixed(3),
          coldMs: +samples[0].toFixed(3),
          warm: stats(samples.slice(1)),
        }),
      );
    }
  }
  for (const implementation of order) {
    const game = fixture(4, implementation);
    for (const fog of [...game.visible, ...game.explored]) fog.fill(1);
    const entities = [...game.entities.values()];
    for (const entity of entities) {
      entity.orders = Array.from({ length: 8 }, (_, i) => ({
        type: "move" as const,
        cell: (entity.cell + i) % game.world.cells.length,
      }));
      entity.path = Array.from(
        { length: 32 },
        (_, i) => (entity.cell + i) % game.world.cells.length,
      );
      entity.queue = ["tank", "scout"];
    }
    game.shots = Array.from({ length: 64 }, (_, i) => ({
      id: i,
      team: entities[i].team,
      from: [...entities[i].position],
      to: [...entities[i + 1].position],
      age: 0,
      duration: 1,
    }));
    game.explosions = Array.from({ length: 16 }, (_, i) => ({
      id: i,
      position: [...entities[i].position],
      age: 0,
      duration: 1,
      size: 1,
    }));
    const samples: number[] = [];
    let payloadBytes = 0;
    for (let i = 0; i < 90; i++) {
      const start = performance.now();
      const payloads = ([0, 1, 2, 3] as Team[]).map((team) =>
        JSON.stringify({
          type: "snapshot",
          snapshot: implementation.snapshotFor(game, team),
        }),
      );
      const elapsed = performance.now() - start;
      if (i >= 10) samples.push(elapsed);
      // Byte counting is intentionally outside the measured work.
      payloadBytes = payloads.reduce(
        (sum, payload) => sum + Buffer.byteLength(payload),
        0,
      );
    }
    console.log(
      JSON.stringify({
        scenario: "four-player-snapshots-and-json",
        implementation: implementation.label,
        run,
        entities: 400,
        payloadBytes,
        ...stats(samples),
      }),
    );
  }
}
