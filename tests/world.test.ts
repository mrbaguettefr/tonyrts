import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/world";
import type { Vec3 } from "../src/types";

test("nearest matches the original scan at cells, boundaries and arbitrary directions", () => {
  const world = createWorld("nearest-differential", 4);
  const scan = (point: Vec3) => {
    const length = Math.hypot(...point);
    const dir = point.map((value) => value / length);
    let best = -Infinity,
      id = 0;
    for (const cell of world.cells) {
      const score =
        cell.dir[0] * dir[0] + cell.dir[1] * dir[1] + cell.dir[2] * dir[2];
      if (score > best) {
        best = score;
        id = cell.id;
      }
    }
    return id;
  };
  const check = (point: Vec3) =>
    assert.equal(world.nearest(point), scan(point), String(point));
  for (const cell of world.cells) {
    check(cell.position);
    for (const neighbor of cell.neighbors) {
      if (neighbor < cell.id) continue;
      const other = world.cells[neighbor];
      const midpoint = cell.dir.map((v, axis) => v + other.dir[axis]) as Vec3;
      check(midpoint);
      // Probe both sides of each boundary as well as its midpoint.
      for (const epsilon of [-1e-12, 1e-12])
        check(
          midpoint.map(
            (v, axis) => v + epsilon * (cell.dir[axis] - other.dir[axis]),
          ) as Vec3,
        );
    }
  }
  let seed = 123456789;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0x100000000) * 2 - 1;
  };
  for (let i = 0; i < 20000; i++) check([random(), random(), random()]);
  for (const point of [
    [0, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [NaN, 1, 0],
    [Infinity, 0, 0],
    [-Infinity, Infinity, 0],
    [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
    [Number.MIN_VALUE, 0, 0],
    [1e-300, -1e-300, 1e-300],
    [1e300, -1e300, 1e300],
  ] as Vec3[])
    check(point);
});

test("terrain is deterministic and seeds change its shape", () => {
  const a = createWorld("forge"),
    b = createWorld("forge"),
    c = createWorld("different");
  assert.deepEqual(a.cells, b.cells);
  assert.deepEqual(a.spawns, b.spawns);
  assert.notDeepEqual(
    a.cells.map((c) => c.height),
    c.cells.map((c) => c.height),
  );
  assert.equal(a.cells.length, 2562);
  assert.equal(a.triangles.length, 5120 * 3);
});
for (const seed of ["forge", "glacier", "123", "planet-zero", "peaks"])
  test(`connected terrain, clear starts and balanced metal: ${seed}`, () => {
    const w = createWorld(seed),
      legal = w.cells.filter((c) => c.passable),
      seen = new Set([legal[0]!.id]),
      queue = [legal[0]!.id];
    for (let i = 0; i < queue.length; i++)
      for (const n of w.cells[queue[i]!]!.neighbors)
        if (w.cells[n]!.passable && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    assert.equal(seen.size, legal.length);
    assert.ok(legal.length > 1500);
    assert.ok(legal.length < 2500);
    assert.ok(w.distance(w.spawns[0], w.spawns[1]) > 120);
    for (const start of w.spawns) {
      assert.ok(w.cells[start]!.height < 1);
      assert.ok(
        w.cells.filter((c) => c.metal && w.distance(start, c.id) < 18).length >=
          3,
      );
    }
    const path = w.path(w.spawns[0], w.spawns[1]);
    assert.ok(path.length > 0);
    assert.equal(path.at(-1), w.spawns[1]);
    let previous = w.spawns[0];
    for (const id of path) {
      assert.ok(w.cells[previous]!.neighbors.includes(id));
      assert.ok(w.cells[id]!.passable);
      previous = id;
    }
  });
test("routes span poles and respect dynamic occupancy", () => {
  const w = createWorld("forge");
  const near = (y: number) =>
    w.cells
      .filter((c) => c.passable)
      .sort((a, b) => b.dir[1] * y - a.dir[1] * y)[0]!.id;
  const north = near(1),
    south = near(-1),
    route = w.path(north, south);
  assert.ok(route.length > 0);
  const blocked = new Set([route[Math.floor(route.length / 2)]!]);
  const detour = w.path(north, south, blocked);
  assert.ok(detour.length > 0);
  assert.ok(detour.every((id) => !blocked.has(id)));
  assert.deepEqual(w.path(north, south, new Set([south])), []);
  assert.deepEqual(
    w.path(north, south, new Set(w.cells[north]!.neighbors)),
    [],
  );
  assert.equal(w.nearest(w.cells[north]!.position), north);
});

for (const count of [3, 4])
  for (const seed of ["forge", "glacier", "123", "planet-zero", "peaks"]) {
    test(`${count} equally separated flat connected starts: ${seed}`, () => {
      const w = createWorld(seed, count);
      assert.equal(w.spawns.length, count);
      assert.equal(new Set(w.spawns).size, count);
      assert.deepEqual(w.spawns, createWorld(seed, count).spawns);
      const distances: number[] = [];
      for (let a = 0; a < count; a++) {
        const start = w.spawns[a];
        assert.ok(w.cells[start].height < 1);
        assert.ok(
          w.cells.filter((c) => c.metal && w.distance(start, c.id) < 18)
            .length >= 3,
        );
        for (let b = a + 1; b < count; b++) {
          distances.push(w.distance(start, w.spawns[b]));
          assert.ok(w.path(start, w.spawns[b]).length > 0);
        }
      }
      assert.ok(Math.max(...distances) - Math.min(...distances) < 8);
      assert.ok(Math.min(...distances) > 100);
    });
  }
