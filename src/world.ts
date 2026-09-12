import type { Cell, Vec3, World } from "./types";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const arc = (a: Vec3, b: Vec3) =>
  Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

interface DirectionNode {
  min: Vec3;
  max: Vec3;
  ids: number[];
  children?: [DirectionNode, DirectionNode];
}

/** Exact maximum-dot search over the planet's immutable cell directions. */
function indexDirections(cells: Cell[]): (point: Vec3) => number {
  function build(ids: number[]): DirectionNode {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const id of ids)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], cells[id].dir[axis]);
        max[axis] = Math.max(max[axis], cells[id].dir[axis]);
      }
    if (ids.length <= 8) return { min, max, ids };
    let axis = 0;
    for (let candidate = 1; candidate < 3; candidate++)
      if (max[candidate] - min[candidate] > max[axis] - min[axis])
        axis = candidate;
    ids.sort((a, b) => cells[a].dir[axis] - cells[b].dir[axis] || a - b);
    const middle = ids.length >> 1;
    return {
      min,
      max,
      ids: [],
      children: [build(ids.slice(0, middle)), build(ids.slice(middle))],
    };
  }
  const root = build(cells.map((cell) => cell.id));
  // Use the same operation order as dot(). Each corner component maximizes
  // its product, so the bound remains conservative even at floating-point ties.
  const bound = (node: DirectionNode, dir: Vec3) =>
    (dir[0] >= 0 ? node.max[0] : node.min[0]) * dir[0] +
    (dir[1] >= 0 ? node.max[1] : node.min[1]) * dir[1] +
    (dir[2] >= 0 ? node.max[2] : node.min[2]) * dir[2];
  return (point) => {
    const dir = normalize(point);
    // The original scan returns cell zero when normalization produces NaN.
    if (dir.some(Number.isNaN)) return 0;
    let best = -Infinity,
      id = 0;
    function search(node: DirectionNode, upper: number) {
      if (upper < best) return;
      if (!node.children) {
        for (const candidate of node.ids) {
          const score = dot(cells[candidate].dir, dir);
          if (score > best || (score === best && candidate < id)) {
            best = score;
            id = candidate;
          }
        }
        return;
      }
      const [left, right] = node.children;
      const a = bound(left, dir),
        b = bound(right, dir);
      if (a >= b) {
        search(left, a);
        search(right, b);
      } else {
        search(right, b);
        search(left, a);
      }
    }
    search(root, bound(root, dir));
    return id;
  };
}

function random(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seam-free navigation mesh: terrain and adjacency share the same icosphere. */
export function createWorld(seed: string, playerCount = 2): World {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4)
    throw new Error("Planet supports 2–4 player slots");
  const radius = 60,
    phi = (1 + Math.sqrt(5)) / 2;
  const dirs: Vec3[] = [
    -1,
    phi,
    0,
    1,
    phi,
    0,
    -1,
    -phi,
    0,
    1,
    -phi,
    0,
    0,
    -1,
    phi,
    0,
    1,
    phi,
    0,
    -1,
    -phi,
    0,
    1,
    -phi,
    phi,
    0,
    -1,
    phi,
    0,
    1,
    -phi,
    0,
    -1,
    -phi,
    0,
    1,
  ].reduce<Vec3[]>((out, _, i, a) => {
    if (i % 3 === 0) out.push(normalize([a[i]!, a[i + 1]!, a[i + 2]!]));
    return out;
  }, []);
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10,
    2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5,
    2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  for (let level = 0; level < 4; level++) {
    const cache = new Map<string, number>(),
      next: number[] = [];
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const existing = cache.get(key);
      if (existing !== undefined) return existing;
      const av = dirs[a]!,
        bv = dirs[b]!;
      const id = dirs.length;
      dirs.push(normalize([av[0] + bv[0], av[1] + bv[1], av[2] + bv[2]]));
      cache.set(key, id);
      return id;
    };
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i]!,
        b = faces[i + 1]!,
        c = faces[i + 2]!,
        ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  const rng = random(seed),
    phase = Array.from({ length: 9 }, () => rng() * Math.PI * 2);
  let starts: Vec3[] = [normalize([1, 0.25, 0.8]), normalize([-1, -0.1, -0.8])];
  if (playerCount > 2) {
    const raw: Vec3[] =
      playerCount === 4
        ? [
            [1, 1, 1],
            [1, -1, -1],
            [-1, 1, -1],
            [-1, -1, 1],
          ]
        : [0, 1, 2].map(
            (i) =>
              [
                Math.cos((i * Math.PI * 2) / 3),
                0,
                Math.sin((i * Math.PI * 2) / 3),
              ] as Vec3,
          );
    const yaw = phase[6],
      tilt = phase[7];
    starts = raw.map(normalize).map(([x, y, z]) => {
      const a = x * Math.cos(yaw) - z * Math.sin(yaw);
      const b = x * Math.sin(yaw) + z * Math.cos(yaw);
      return [
        a,
        y * Math.cos(tilt) - b * Math.sin(tilt),
        y * Math.sin(tilt) + b * Math.cos(tilt),
      ];
    });
  }
  const cells: Cell[] = dirs.map((dir, id) => {
    const [x, y, z] = dir;
    const broad =
      Math.sin(x * 4 + phase[0]!) * Math.cos(y * 4 + phase[1]!) +
      Math.sin(z * 4 + phase[2]!) * 0.6;
    const ridge = Math.pow(Math.max(0, broad - 0.15), 1.65) * 4.5;
    const detail =
      (Math.sin(x * 15 + phase[3]!) *
        Math.sin(y * 13 + phase[4]!) *
        Math.cos(z * 14 + phase[5]!) +
        1) *
      0.2;
    let height = Math.min(9, ridge + detail);
    const startDistance = Math.min(...starts.map((start) => arc(dir, start)));
    const t = Math.max(0, Math.min(1, (startDistance - 0.24) / 0.18));
    height = 0.15 + (height - 0.15) * t * t * (3 - 2 * t);
    return {
      id,
      dir,
      position: dir.map((v) => v * (radius + height)) as Vec3,
      height,
      slope: 0,
      neighbors: [],
      passable: true,
      metal: false,
    };
  });
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i]!,
      b = faces[i + 1]!,
      c = faces[i + 2]!;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (!cells[u!]!.neighbors.includes(v!)) cells[u!]!.neighbors.push(v!);
      if (!cells[v!]!.neighbors.includes(u!)) cells[v!]!.neighbors.push(u!);
    }
  }
  for (const cell of cells) {
    cell.slope = Math.max(
      ...cell.neighbors.map(
        (n) =>
          Math.abs(cells[n]!.height - cell.height) /
          (arc(cell.dir, cells[n]!.dir) * radius),
      ),
    );
    cell.passable = cell.height < 3.8 && cell.slope < 0.7;
  }
  // Remove isolated pockets, so every legal destination is reachable on this planet.
  const visited = new Set<number>();
  let largest: number[] = [];
  for (const cell of cells) {
    if (!cell.passable || visited.has(cell.id)) continue;
    const component = [cell.id];
    visited.add(cell.id);
    for (let i = 0; i < component.length; i++)
      for (const n of cells[component[i]!]!.neighbors)
        if (cells[n]!.passable && !visited.has(n)) {
          visited.add(n);
          component.push(n);
        }
    if (component.length > largest.length) largest = component;
  }
  const connected = new Set(largest);
  for (const c of cells) c.passable = connected.has(c.id);
  const closest = (point: Vec3, legal = false) => {
    const dir = normalize(point);
    let best = -Infinity,
      id = 0;
    for (const c of cells) {
      if (legal && !c.passable) continue;
      const score = dot(c.dir, dir);
      if (score > best) {
        best = score;
        id = c.id;
      }
    }
    return id;
  };
  const spawns = starts.map((start) => closest(start, true));
  const distance = (a: number, b: number) =>
    arc(cells[a]!.dir, cells[b]!.dir) * radius;
  // Three guaranteed deposits around each start; deposits never occupy the commander cell.
  const deposits: number[] = [];
  for (const spawn of spawns) {
    const nearby = cells
      .filter(
        (c) =>
          c.passable &&
          c.slope < 0.3 &&
          distance(spawn, c.id) > 7 &&
          distance(spawn, c.id) < 17,
      )
      .sort((a, b) => distance(spawn, a.id) - distance(spawn, b.id));
    let count = 0;
    for (const c of nearby)
      if (deposits.every((id) => distance(id, c.id) > 7)) {
        c.metal = true;
        deposits.push(c.id);
        if (++count === 3) break;
      }
  }
  for (let attempt = 0; attempt < 500 && deposits.length < 36; attempt++) {
    const c = cells[Math.floor(rng() * cells.length)]!;
    if (
      c.passable &&
      c.slope < 0.3 &&
      spawns.every((s) => distance(s, c.id) > 22) &&
      deposits.every((id) => distance(id, c.id) > 13)
    ) {
      c.metal = true;
      deposits.push(c.id);
    }
  }
  function path(
    from: number,
    to: number,
    blocked = new Set<number>(),
  ): number[] {
    if (from === to || !cells[from] || !cells[to]?.passable || blocked.has(to))
      return [];
    const costs = new Float64Array(cells.length).fill(Infinity),
      parents = new Int32Array(cells.length).fill(-1),
      closed = new Uint8Array(cells.length);
    // Binary heap keeps path queries bounded even for distant destinations.
    const heap: { id: number; f: number }[] = [];
    const push = (id: number, f: number) => {
      let i = heap.length;
      heap.push({ id, f });
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]!.f <= f) break;
        heap[i] = heap[p]!;
        i = p;
      }
      heap[i] = { id, f };
    };
    const pop = () => {
      const result = heap[0]!,
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1]!.f < heap[child]!.f)
            child++;
          if (last.f <= heap[child]!.f) break;
          heap[i] = heap[child]!;
          i = child;
        }
        heap[i] = last;
      }
      return result.id;
    };
    costs[from] = 0;
    push(from, distance(from, to));
    while (heap.length) {
      const current = pop();
      if (closed[current]) continue;
      if (current === to) {
        const route: number[] = [];
        let cursor = to;
        while (cursor !== from) {
          route.push(cursor);
          cursor = parents[cursor]!;
        }
        return route.reverse();
      }
      closed[current] = 1;
      for (const next of cells[current]!.neighbors) {
        if (closed[next] || !cells[next]!.passable || blocked.has(next))
          continue;
        const cost =
          costs[current]! + distance(current, next) * (1 + cells[next]!.slope);
        if (cost < costs[next]!) {
          costs[next] = cost;
          parents[next] = current;
          push(next, cost + distance(next, to));
        }
      }
    }
    return [];
  }
  return {
    seed,
    radius,
    cells,
    triangles: faces,
    spawns,
    nearest: indexDirections(cells),
    path,
    distance,
  };
}
