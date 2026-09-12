import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/world";
import {
  createGame,
  tick,
  issueOrder,
  canPlace,
  enqueueUnit,
  SPECS,
} from "../src/simulation";
const world = createWorld("simulation-tests");
function advance(g: ReturnType<typeof createGame>, seconds: number) {
  for (let i = 0; i < seconds * 4; i++) tick(g, 0.25);
}
test("commander baseline restores income, pause and terminal state freeze", () => {
  const g = createGame(world);
  g.players[0].metal = 0;
  g.players[0].energy = 0;
  tick(g, 0.25);
  assert.equal(g.players[0].metal, 0.5);
  assert.equal(g.players[0].energy, 1.75);
  g.paused = true;
  tick(g, 0.25);
  assert.equal(g.time, 0.25);
  g.paused = false;
  g.winner = 0;
  tick(g, 0.25);
  assert.equal(g.time, 0.25);
});
test("construction finishes and factory produces through shared economy", () => {
  const g = createGame(world);
  const commander = [...g.entities.values()].find((e) => e.team === 0)!;
  const cell = world.cells.find(
    (c) =>
      canPlace(g, 0, "factory", c.id).valid &&
      world.distance(c.id, commander.cell) < 7,
  )!;
  assert.ok(cell);
  issueOrder(g, [commander.id], {
    type: "build",
    kind: "factory",
    cell: cell.id,
  });
  advance(g, 26);
  const factory = [...g.entities.values()].find(
    (e) => e.team === 0 && e.kind === "factory",
  )!;
  assert.ok(factory);
  assert.equal(factory.progress, 1);
  assert.ok(enqueueUnit(g, factory.id, "scout"));
  advance(g, 8);
  assert.ok(
    [...g.entities.values()].some((e) => e.team === 0 && e.kind === "scout"),
  );
});
test("construction stalls proportionally and recovers with commander income", () => {
  const g = createGame(world);
  const commander = [...g.entities.values()].find((e) => e.team === 0)!;
  const cell = world.cells.find(
    (c) =>
      canPlace(g, 0, "generator", c.id).valid &&
      world.distance(c.id, commander.cell) < 7,
  )!;
  g.players[0].metal = 0;
  g.players[0].energy = 0;
  issueOrder(g, [commander.id], {
    type: "build",
    kind: "generator",
    cell: cell.id,
  });
  advance(g, 10);
  const building = [...g.entities.values()].find(
    (e) => e.team === 0 && e.kind === "generator",
  )!;
  assert.ok(building.progress > 0 && building.progress < 1);
  assert.ok(g.players[0].metal >= 0 && g.players[0].energy >= 0);
  advance(g, 25);
  assert.equal(building.progress, 1);
  assert.ok(g.players[0].energyIncome > SPECS.commander.energy);
});
test("movement stays above spherical surface and exploration persists", () => {
  const g = createGame(world),
    commander = [...g.entities.values()].find((e) => e.team === 0)!;
  const initial = commander.cell;
  const target = world.cells.find(
    (c) =>
      c.passable &&
      world.distance(initial, c.id) > 12 &&
      world.distance(initial, c.id) < 16,
  )!;
  issueOrder(g, [commander.id], { type: "move", cell: target.id });
  for (let i = 0; i < 50; i++) {
    tick(g, 0.25);
    assert.ok(Math.hypot(...commander.position) >= world.radius);
  }
  assert.equal(commander.cell, target.id);
  assert.equal(g.explored[0][initial], 1);
});
test("hidden attacks are rejected and commander destruction ends match", () => {
  const g = createGame(world);
  const entities = [...g.entities.values()],
    a = entities[0],
    b = entities[1];
  issueOrder(g, [a.id], { type: "attack", target: b.id });
  assert.equal(a.orders.length, 0);
  b.hp = 0;
  tick(g, 0.25);
  assert.equal(g.winner, 0);
});
test("building placement rejects a mobile footprint without preventing nearby construction", () => {
  const g = createGame(world),
    commander = [...g.entities.values()].find((e) => e.team === 0)!;
  const blocked = canPlace(g, 0, "generator", commander.cell);
  assert.equal(blocked.valid, false);
  assert.match(blocked.reason, /Unit/);
  const cell = world.cells.find(
    (c) =>
      canPlace(g, 0, "generator", c.id).valid &&
      world.distance(c.id, commander.cell) < 7,
  )!;
  assert.ok(cell);
  issueOrder(g, [commander.id], {
    type: "build",
    kind: "generator",
    cell: cell.id,
  });
  advance(g, 12);
  assert.equal(
    [...g.entities.values()].find((e) => e.team === 0 && e.kind === "generator")
      ?.progress,
    1,
  );
});
test("explicit attack seeks a firing position when nearby target is occluded", () => {
  const point = (angle: number, radius = 60): [number, number, number] => [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    0,
  ];
  const angles = [0, 0.15, 0.075, 0.2],
    cells = angles.map((angle, id) => ({
      id,
      dir: point(angle, 1),
      position: point(angle, id === 2 ? 70 : 60),
      height: id === 2 ? 10 : 0,
      slope: 0,
      neighbors: [0, 1, 3].filter((n) => n !== id),
      passable: id !== 2,
      metal: false,
    }));
  const mock: typeof world = {
    seed: "ridge",
    radius: 60,
    cells,
    triangles: [],
    spawns: [0, 1],
    nearest: (p) => {
      const angle = Math.atan2(p[1], p[0]);
      if (angle > 0.025 && angle < 0.12) return 2;
      return angle > 0.175 ? 3 : angle > 0.12 ? 1 : 0;
    },
    distance: (a, b) => Math.abs(angles[a] - angles[b]) * 60,
    path: (a, b, blocked) => (blocked?.has(b) ? [] : [a, b]),
  };
  const g = createGame(mock),
    commander = [...g.entities.values()].find((e) => e.team === 0)!,
    target = [...g.entities.values()].find((e) => e.team === 1)!;
  g.entities.set(100, {
    ...commander,
    id: 100,
    kind: "constructor",
    cell: 3,
    position: [...cells[3].position],
    orders: [],
    path: [],
  });
  tick(g, 0.05);
  assert.equal(g.visible[0][target.cell], 1);
  target.cooldown = 1000;
  issueOrder(g, [commander.id], { type: "attack", target: target.id });
  const start = [...commander.position];
  tick(g, 0.05);
  assert.notDeepEqual(commander.position, start);
  advance(g, 5);
  assert.ok(
    target.hp < SPECS.commander.hp,
    "commander moved into line of sight and fired",
  );
});
test("distant factory order stops builder outside its footprint and completes", () => {
  const g = createGame(world),
    commander = [...g.entities.values()].find((e) => e.team === 0)!;
  const cell = world.cells.find(
    (c) =>
      canPlace(g, 0, "factory", c.id).valid &&
      world.distance(c.id, commander.cell) > 12 &&
      world.distance(c.id, commander.cell) < 18,
  )!;
  assert.ok(cell);
  issueOrder(g, [commander.id], {
    type: "build",
    kind: "factory",
    cell: cell.id,
  });
  advance(g, 36);
  assert.equal(
    [...g.entities.values()].find((e) => e.team === 0 && e.kind === "factory")
      ?.progress,
    1,
  );
});
test("move onto friendly building resolves nearby and advances queued orders", () => {
  const g = createGame(world),
    commander = [...g.entities.values()].find((e) => e.team === 0)!;
  const cell = world.cells.find(
    (c) =>
      canPlace(g, 0, "generator", c.id).valid &&
      world.distance(c.id, commander.cell) < 7,
  )!;
  issueOrder(g, [commander.id], {
    type: "build",
    kind: "generator",
    cell: cell.id,
  });
  advance(g, 12);
  assert.ok(
    [...g.entities.values()].some(
      (e) => e.kind === "generator" && e.team === 0,
    ),
  );
  const destination = world.cells.find(
    (c) =>
      c.passable &&
      world.distance(c.id, cell.id) > 12 &&
      world.distance(c.id, cell.id) < 16,
  )!;
  issueOrder(g, [commander.id], { type: "move", cell: cell.id });
  issueOrder(g, [commander.id], { type: "move", cell: destination.id }, true);
  advance(g, 15);
  assert.equal(commander.cell, destination.id);
  assert.equal(commander.orders.length, 0);
});
test("new occupied destination replans active route and completes next order", () => {
  const g = createGame(world),
    commander = [...g.entities.values()].find((e) => e.team === 0)!;
  const origin = commander.cell,
    destination = world.cells.find(
      (c) =>
        c.passable &&
        world.distance(c.id, origin) > 12 &&
        world.distance(c.id, origin) < 16,
    )!;
  issueOrder(g, [commander.id], { type: "attackMove", cell: destination.id });
  issueOrder(g, [commander.id], { type: "move", cell: origin }, true);
  tick(g, 0.25);
  g.entities.set(900, {
    ...commander,
    id: 900,
    kind: "generator",
    cell: destination.id,
    position: [...destination.position],
    orders: [],
    path: [],
    progress: 1,
  });
  advance(g, 20);
  assert.equal(commander.cell, origin);
  assert.equal(commander.orders.length, 0);
});
test("simultaneous factories respect 100 mobile units including commander", () => {
  const g = createGame(world),
    commander = [...g.entities.values()].find((e) => e.team === 0)!;
  for (let i = 0; i < 98; i++) {
    const cell = world.cells[(commander.cell + i) % world.cells.length];
    g.entities.set(100 + i, {
      ...commander,
      id: 100 + i,
      kind: "scout",
      cell: cell.id,
      position: [...cell.position],
      orders: [],
      path: [],
    });
  }
  for (let i = 0; i < 2; i++) {
    const cell = world.cells[commander.cell].neighbors[i];
    g.entities.set(300 + i, {
      ...commander,
      id: 300 + i,
      kind: "factory",
      cell,
      position: [...world.cells[cell].position],
      orders: [],
      path: [],
      queue: ["scout"],
      production: 0.999,
    });
  }
  tick(g, 0.25);
  assert.equal(
    [...g.entities.values()].filter(
      (e) => e.team === 0 && !SPECS[e.kind].building,
    ).length,
    100,
  );
});
