import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/world";
import { createGame } from "../src/simulation";
import { gatherBuildPlans } from "../src/build-plans";
const world = createWorld("plans-tests");
test("own build commands retain queue order beyond vision and enemy plans stay private", () => {
  const game = createGame(world);
  const own = [...game.entities.values()].find((e) => e.team === 0)!;
  const enemy = [...game.entities.values()].find((e) => e.team === 1)!;
  own.orders = [
    { type: "build", kind: "generator", cell: 100 },
    { type: "move", cell: 101 },
    { type: "build", kind: "factory", cell: 102 },
  ];
  enemy.orders = [{ type: "build", kind: "turret", cell: 103 }];
  game.visible[0].fill(0);
  assert.deepEqual(
    gatherBuildPlans(game, 0).map((p) => [p.cell, p.step, p.active]),
    [
      [100, 1, true],
      [102, 3, false],
    ],
  );
  assert.deepEqual(
    gatherBuildPlans(game, 1).map((p) => p.cell),
    [103],
  );
});
test("assisting builders deduplicate and active orders take precedence", () => {
  const game = createGame(world);
  const own = [...game.entities.values()].find((e) => e.team === 0)!;
  own.orders = [
    { type: "move", cell: 101 },
    { type: "build", kind: "factory", cell: 102 },
  ];
  game.entities.set(999, {
    ...own,
    id: 999,
    orders: [{ type: "build", kind: "factory", cell: 102 }],
  });
  assert.equal(gatherBuildPlans(game, 0).length, 1);
  assert.equal(gatherBuildPlans(game, 0)[0].active, true);
});
test("cancelled, dead, removed builders and materialized sites remove ghosts", () => {
  const game = createGame(world);
  const own = [...game.entities.values()].find((e) => e.team === 0)!;
  own.orders = [{ type: "build", kind: "factory", cell: 102 }];
  own.hp = 0;
  assert.equal(gatherBuildPlans(game, 0).length, 0);
  own.hp = 100;
  game.entities.set(999, {
    ...own,
    id: 999,
    kind: "factory",
    cell: 102,
    progress: 0.1,
    orders: [],
  });
  assert.equal(gatherBuildPlans(game, 0).length, 0);
  game.entities.get(999)!.progress = 1;
  assert.equal(gatherBuildPlans(game, 0).length, 0);
  game.entities.delete(999);
  own.orders = [];
  assert.equal(gatherBuildPlans(game, 0).length, 0);
  own.orders = [{ type: "build", kind: "factory", cell: 102 }];
  game.entities.delete(own.id);
  assert.equal(gatherBuildPlans(game, 0).length, 0);
});
