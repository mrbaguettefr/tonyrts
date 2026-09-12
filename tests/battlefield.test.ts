import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/world";
import {
  createGame,
  SPECS,
  planWallLine,
  issueWallLine,
  tick,
  issueOrder,
  weaponLos,
  canPlace,
} from "../src/simulation";
import { wallCells, wallBlocks } from "../src/walls";
import { BuildingMemory } from "../src/building-memory";
import { SmokePool, SMOKE_LIMIT } from "../src/smoke";
import { snapshotFor } from "../server/server";
import type { Entity, Game, Kind, Team } from "../src/types";
const world = createWorld("battlefield");
function fixture() {
  return createGame(world, [
    { name: "A", controller: "human" },
    { name: "B", controller: "human" },
  ]);
}
function add(
  g: Game,
  kind: Kind,
  team: Team,
  cell: number,
  id = 1000 + g.entities.size,
): Entity {
  const entity: Entity = {
    id,
    kind,
    team,
    cell,
    position: [...world.cells[cell].position],
    heading: [1, 0, 0],
    hp: SPECS[kind].hp,
    progress: 1,
    orders: [],
    path: [],
    cooldown: 0,
    queue: [],
    production: 0,
    rally: null,
  };
  g.entities.set(id, entity);
  return entity;
}
function advance(g: Game, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) tick(g, 0.05);
}
function line(g: Game) {
  const builder = [...g.entities.values()][0];
  for (const a of world.cells)
    for (const b of world.cells) {
      if (
        world.distance(builder.cell, a.id) > 10 ||
        world.distance(a.id, b.id) < 9 ||
        world.distance(a.id, b.id) > 16
      )
        continue;
      const plan = planWallLine(g, builder.id, a.id, b.id);
      if (plan.valid && plan.cells.length >= 3 && plan.cells.length <= 5)
        return { builder, start: a.id, end: b.id, plan };
    }
  throw new Error("No fixture wall line");
}

test("wall lines are connected and deterministic, validate atomically, and respect queue limits", () => {
  const g = fixture(),
    { builder, start, end, plan } = line(g);
  assert.deepEqual(wallCells(world, start, end), plan.cells);
  plan.cells
    .slice(1)
    .forEach((cell, i) =>
      assert.ok(world.cells[plan.cells[i]].neighbors.includes(cell)),
    );
  assert.equal(plan.metal, plan.cells.length * 25);
  assert.equal(plan.energy, plan.cells.length * 10);
  const hidden = plan.cells[1];
  g.visible[0][hidden] = 0;
  assert.equal(issueWallLine(g, builder.id, start, end).valid, false);
  assert.equal(builder.orders.length, 0);
  g.visible[0][hidden] = 1;
  builder.orders = Array.from({ length: 63 }, () => ({
    type: "move",
    cell: builder.cell,
  }));
  assert.equal(issueWallLine(g, builder.id, start, end, true).valid, false);
  assert.equal(builder.orders.length, 63);
  assert.equal(issueWallLine(g, builder.id, start, end).valid, true);
  assert.equal(builder.orders.length, plan.cells.length);
  assert.equal(issueWallLine(g, builder.id, start, end, true).valid, true);
  assert.equal(
    builder.orders.length,
    plan.cells.length,
    "append deduplicates queued segments",
  );
  assert.equal(planWallLine(g, 999999, start, end).valid, false);
});

test("wall lines build sequentially, join existing segments, and resume stalled sites", () => {
  const g = fixture(),
    { builder, start, end, plan } = line(g);
  const existing = add(g, "wall", 0, start);
  const partial = add(g, "wall", 0, plan.cells[1]);
  partial.progress = 0.2;
  g.players[0].metal = 0;
  g.players[0].energy = 0;
  const result = issueWallLine(g, builder.id, start, end);
  assert.equal(result.valid, true);
  assert.equal(result.metal, (plan.cells.length - 2) * 25 + 20);
  assert.equal(result.energy, (plan.cells.length - 2) * 10 + 8);
  advance(g, 1);
  assert.ok(partial.progress < 1, "income shortage slows work");
  g.players[0].metal = 1000;
  g.players[0].energy = 2000;
  advance(g, 50);
  for (const cell of plan.cells) {
    const walls = [...g.entities.values()].filter(
      (e) => e.kind === "wall" && e.cell === cell,
    );
    assert.equal(walls.length, 1);
    assert.equal(walls[0].progress, 1);
  }
  assert.equal(g.entities.get(existing.id), existing);
});

test("walls block both teams' ordinary fire, turret fire crosses, and terrain still occludes", () => {
  const g = fixture();
  g.entities.clear();
  const center = world.spawns[0],
    neighbors = world.cells[center].neighbors;
  const a = neighbors[0],
    b = [...neighbors].sort(
      (x, y) => world.distance(y, a) - world.distance(x, a),
    )[0];
  const shooter = add(g, "tank", 0, a),
    target = add(g, "generator", 1, b);
  assert.equal(weaponLos(g, shooter, target), true);
  const wall = add(g, "wall", 0, center);
  wall.progress = 0;
  assert.equal(weaponLos(g, shooter, target), false);
  wall.team = 1;
  assert.equal(weaponLos(g, shooter, target), false);
  assert.equal(
    weaponLos(g, shooter, wall),
    true,
    "a wall can itself be targeted",
  );
  shooter.kind = "turret";
  assert.equal(weaponLos(g, shooter, target), true);
  target.cell = world.spawns[1];
  target.position = [...world.cells[target.cell].position];
  assert.equal(
    weaponLos(g, shooter, target),
    false,
    "turrets still respect terrain",
  );
  target.cell = b;
  target.position = [...world.cells[b].position];
  shooter.kind = "tank";
  wall.hp = 0;
  assert.equal(
    weaponLos(g, shooter, target),
    true,
    "destroyed walls stop obstructing immediately",
  );
});

test("wall connections intercept shots between posts and remote walls do not project into local combat", () => {
  const g = fixture();
  g.entities.clear();
  const a = world.spawns[0],
    b = world.cells[a].neighbors[0];
  const opposite = world.cells[a].neighbors.filter((c) =>
    world.cells[b].neighbors.includes(c),
  );
  const shooter = add(g, "tank", 0, opposite[0]),
    target = add(g, "generator", 1, opposite[1]);
  assert.equal(weaponLos(g, shooter, target), true);
  add(g, "wall", 1, a);
  add(g, "wall", 1, b);
  assert.equal(weaponLos(g, shooter, target), false);
  assert.equal(
    wallBlocks(shooter.position, target.position, {
      a: world.cells[world.spawns[1]].position,
      b: world.cells[world.spawns[1]].position,
      owner: 1,
    }),
    false,
  );
});

test("movement cannot cross wall enclosures, destruction opens routes, and walls grant no sight", () => {
  const g = fixture();
  g.entities.clear();
  const center = world.spawns[0],
    tank = add(g, "tank", 0, center);
  const ring = world.cells[center].neighbors.map((cell) =>
    add(g, "wall", 1, cell),
  );
  const destination = world.cells.find(
    (c) =>
      c.passable &&
      world.distance(center, c.id) > 18 &&
      world.distance(center, c.id) < 22,
  )!;
  issueOrder(g, [tank.id], { type: "move", cell: destination.id });
  advance(g, 3);
  assert.equal(tank.cell, center);
  assert.equal(g.visible[1].some(Boolean), false);
  assert.ok(
    ring.every((w) => g.visible[0][w.cell]),
    "walls do not block sight",
  );
  ring.forEach((w) => (w.hp = 0));
  advance(g, 0.1);
  issueOrder(g, [tank.id], { type: "move", cell: destination.id });
  advance(g, 8);
  assert.notEqual(tank.cell, center);
});

test("attack orders breach enclosing enemy walls and retain the original target", () => {
  const g = fixture();
  g.entities.clear();
  const center = world.spawns[0],
    tank = add(g, "heavy", 0, center);
  const ring = world.cells[center].neighbors.map((cell) =>
    add(g, "wall", 1, cell),
  );
  ring.forEach((w) => (w.hp = 85));
  const cell = world.cells.find(
    (c) =>
      c.passable &&
      world.distance(center, c.id) > 10 &&
      world.distance(center, c.id) < 13,
  )!;
  const target = add(g, "generator", 1, cell.id);
  target.hp = 10000;
  tick(g, 0.05);
  issueOrder(g, [tank.id], { type: "attack", target: target.id });
  advance(g, 8);
  assert.ok(
    ring.some((w) => !g.entities.has(w.id)),
    "at least one barrier is breached",
  );
  assert.ok(
    target.hp < 10000 ||
      tank.orders.some((o) => o.type === "attack" && o.target === target.id),
  );
  assert.ok(tank.orders.length <= 64);
});

test("heavy twin-barrel visuals remain one damage event and snapshots preserve the marker", () => {
  const g = fixture();
  g.entities.clear();
  const heavy = add(g, "heavy", 0, world.spawns[0]);
  const target = add(g, "generator", 1, world.cells[heavy.cell].neighbors[0]);
  tick(g, 0.05);
  assert.equal(target.hp, SPECS.generator.hp - SPECS.heavy.damage);
  assert.equal(g.shots.length, 1);
  assert.equal(g.shots[0].heavy, true);
  assert.equal(snapshotFor(g, 0).shots[0].heavy, true);
});

test("building observations freeze hidden construction, connections and destruction until rescouting", () => {
  const g = fixture(),
    memory = new BuildingMemory();
  const cell = world.spawns[1],
    enemy = add(g, "wall", 1, cell),
    adjacent = add(g, "wall", 1, world.cells[cell].neighbors[0]);
  enemy.progress = 0.3;
  g.visible[0].fill(0);
  memory.update(g, 0);
  assert.equal(memory.buildings.size, 0);
  g.visible[0][cell] = g.visible[0][adjacent.cell] = 1;
  memory.update(g, 0);
  const copy = structuredClone(memory.buildings.get(enemy.id));
  assert.ok(copy);
  assert.equal(copy.connections.length, 1);
  g.visible[0].fill(0);
  enemy.progress = 1;
  enemy.position[0] += 1;
  g.entities.delete(adjacent.id);
  memory.update(g, 0);
  assert.deepEqual(memory.buildings.get(enemy.id), copy);
  assert.equal(
    snapshotFor(g, 0).entities.some((e) => e.id === enemy.id),
    false,
  );
  g.entities.delete(enemy.id);
  g.players[1].eliminated = true;
  memory.update(g, 0);
  assert.deepEqual(
    memory.buildings.get(enemy.id),
    copy,
    "hidden elimination does not change memory",
  );
  g.visible[0][cell] = 1;
  memory.update(g, 0);
  assert.equal(memory.buildings.has(enemy.id), false);
  memory.update(fixture(), 0);
  assert.equal(memory.buildings.size, 0);
});

test("observations reconcile visible replacements and never remember mobile units or private orders", () => {
  const g = fixture(),
    memory = new BuildingMemory(),
    cell = world.spawns[1];
  g.visible[0][cell] = 1;
  const building = add(g, "factory", 1, cell);
  building.orders = [{ type: "build", kind: "wall", cell: 0 }];
  memory.update(g, 0);
  assert.equal(memory.buildings.size, 1);
  assert.equal("orders" in memory.buildings.get(building.id)!, false);
  g.entities.delete(building.id);
  const replacement = add(g, "generator", 1, cell, 2000);
  memory.update(g, 0);
  assert.equal(memory.buildings.has(building.id), false);
  assert.equal(memory.buildings.has(replacement.id), true);
  memory.update(g, 1);
  assert.equal(
    memory.buildings.size,
    0,
    "viewer change resets private history",
  );
});

test("smoke respects health, completion, visibility, paused time, death, resets and bounded capacity", () => {
  const g = fixture();
  g.entities.clear();
  const pool = new SmokePool();
  const tank = add(g, "tank", 0, world.spawns[0]);
  tank.hp = SPECS.tank.hp * 0.35;
  const enemy = add(g, "heavy", 1, world.spawns[1]);
  enemy.hp = 1;
  const site = add(g, "constructor", 0, tank.cell);
  site.hp = 1;
  site.progress = 0.5;
  g.visible[0].fill(0);
  pool.update(g, 0);
  for (let i = 0; i < 10; i++) {
    g.time += 0.1;
    pool.update(g, 0);
  }
  assert.equal(pool.particles.length, 0);
  tank.hp -= 1;
  g.visible[0][enemy.cell] = 1;
  for (let i = 0; i < 10; i++) {
    g.time += 0.1;
    pool.update(g, 0);
  }
  assert.ok(pool.particles.some((p) => p.owner === tank.id));
  assert.ok(pool.particles.some((p) => p.owner === enemy.id));
  const paused = structuredClone(pool.particles);
  pool.update(g, 0);
  assert.deepEqual(pool.particles, paused);
  g.visible[0][enemy.cell] = 0;
  g.entities.delete(tank.id);
  pool.update(g, 0);
  assert.equal(pool.particles.length, 0);
  for (let i = 0; i < 400; i++) {
    const e = add(g, "tank", 0, world.spawns[0], 3000 + i);
    e.hp = 1;
  }
  for (let i = 0; i < 40; i++) {
    g.time += 0.1;
    pool.update(g, 0);
    assert.ok(pool.particles.length <= SMOKE_LIMIT);
  }
  assert.equal(pool.particles.length, SMOKE_LIMIT);
  pool.update(fixture(), 0);
  assert.equal(pool.particles.length, 0);
});
