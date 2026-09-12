import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/world";

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
    assert.ok(w.distance(...w.spawns) > 120);
    for (const start of w.spawns) {
      assert.ok(w.cells[start]!.height < 1);
      assert.ok(
        w.cells.filter((c) => c.metal && w.distance(start, c.id) < 18).length >=
          3,
      );
    }
    const path = w.path(...w.spawns);
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
