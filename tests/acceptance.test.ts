import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createWorld } from "../src/world";
import { createGame, tick, SPECS, enqueueUnit } from "../src/simulation";
import type { Entity, Kind, Team } from "../src/types";

const outcomes = new Map<
  string,
  { time: number; winner: Team | null; entities: number }
>();

for (const seed of ["forge", "glacier", "peaks"])
  test(`AI completes an unassisted match on ${seed}`, () => {
    const started = performance.now(),
      game = createGame(createWorld(seed)),
      observed = new Set<Kind>();
    let discovered = false;
    while (game.time < 900 && game.winner === null) {
      tick(game, 0.25);
      for (const entity of game.entities.values())
        if (entity.team === 1 && entity.progress === 1)
          observed.add(entity.kind);
      const player = [...game.entities.values()].find(
        (e) => e.team === 0 && e.kind === "commander",
      );
      if (player && game.visible[1][player.cell]) discovered = true;
    }
    for (const kind of [
      "extractor",
      "generator",
      "factory",
      "scout",
      "tank",
    ] as Kind[])
      assert.ok(observed.has(kind), `AI never completed ${kind}`);
    assert.ok(discovered, "AI never discovered the player");
    assert.equal(
      game.winner,
      1,
      `AI did not beat an idle player within 900 seconds (${game.entities.size} survivors)`,
    );
    outcomes.set(seed, {
      time: game.time,
      winner: game.winner,
      entities: game.entities.size,
    });
    console.log(
      `${seed}: victory at ${game.time.toFixed(2)} simulated seconds; ${(performance.now() - started).toFixed(0)} ms wall time`,
    );
  });

test("the same seed and fixed tick reproduce the complete match outcome", () => {
  const game = createGame(createWorld("forge"));
  while (game.time < 900 && game.winner === null) tick(game, 0.25);
  assert.deepEqual(
    { time: game.time, winner: game.winner, entities: game.entities.size },
    outcomes.get("forge"),
  );
});

test("factory production respects the 100 mobile units per team cap", () => {
  const game = createGame(createWorld("unit-cap"));
  const template = [...game.entities.values()][0]!;
  const copy = (id: number, team: Team, kind: Kind, cell: number): Entity => ({
    ...template,
    id,
    team,
    kind,
    cell,
    position: [...game.world.cells[cell]!.position],
    hp: SPECS[kind].hp,
    orders: [],
    path: [],
    queue: [],
    production: 0,
  });
  for (const team of [0, 1] as Team[]) {
    const cells = game.world.cells.filter(
      (c) =>
        c.passable && game.world.distance(c.id, game.world.spawns[team]) < 45,
    );
    for (let i = 0; i < 99; i++) {
      const id = 10000 + team * 1000 + i;
      game.entities.set(
        id,
        copy(id, team, "tank", cells[i % cells.length]!.id),
      );
    }
  }
  const factoryCell = game.world.cells.find(
    (c) =>
      c.passable &&
      game.world.distance(c.id, game.world.spawns[0]) < 12 &&
      c.id !== game.world.spawns[0],
  )!.id;
  const factory = copy(9000, 0, "factory", factoryCell);
  game.entities.set(factory.id, factory);
  enqueueUnit(game, factory.id, "scout");
  const started = performance.now();
  for (let i = 0; i < 40; i++) tick(game, 0.05);
  assert.equal(
    [...game.entities.values()].filter(
      (e) => e.team === 0 && !SPECS[e.kind].building,
    ).length,
    100,
  );
  assert.equal(factory.queue.length, 1);
  assert.equal(factory.production, 0);
  console.log(
    `200 mobile units: 40 simulation ticks in ${(performance.now() - started).toFixed(0)} ms (headless; excludes rendering)`,
  );
});
