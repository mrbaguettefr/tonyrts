import type { Entity, Vec3, World } from "./types";

/** A connected graph approximation of the short great-circle arc, without terrain detours. */
export function wallCells(world: World, start: number, end: number): number[] {
  if (!world.cells[start] || !world.cells[end]) return [];
  const result = [start];
  let current = start;
  while (current !== end && result.length <= 64) {
    const next = [...world.cells[current].neighbors].sort(
      (a, b) => world.distance(a, end) - world.distance(b, end) || a - b,
    )[0];
    if (result.includes(next)) return [];
    result.push(next);
    current = next;
  }
  return result;
}

export type WallNode = Pick<Entity, "id" | "team" | "cell" | "position">;
export interface WallSpan {
  a: Vec3;
  b: Vec3;
  owner: number;
}
/** Each post owns half of its connections, including junctions. */
export function wallSpans(
  world: World,
  walls: readonly WallNode[],
): WallSpan[] {
  const cells = new Map(walls.map((w) => [w.cell, w]));
  const spans: WallSpan[] = [];
  for (const wall of walls) {
    spans.push({ a: wall.position, b: wall.position, owner: wall.id });
    for (const cell of world.cells[wall.cell].neighbors) {
      const other = cells.get(cell);
      if (!other || other.team !== wall.team) continue;
      spans.push({
        a: wall.position,
        b: wall.position.map((v, k) => (v + other.position[k]) / 2) as Vec3,
        owner: wall.id,
      });
    }
  }
  return spans;
}

// Closest points between finite segments. Surface-normal projection below makes
// barriers independent of the decorative muzzle height and ground undulations.
function segmentDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const sub = (x: Vec3, y: Vec3) => x.map((v, k) => v - y[k]) as Vec3;
  const dot = (x: Vec3, y: Vec3) => x.reduce((n, v, k) => n + v * y[k], 0);
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c);
  const A = dot(u, u),
    B = dot(u, v),
    C = dot(v, v),
    D = dot(u, w),
    E = dot(v, w);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  let s = A ? clamp(-D / A) : 0,
    t = 0;
  if (C) {
    const det = A * C - B * B;
    if (det > 1e-9) s = clamp((B * E - C * D) / det);
    t = clamp((B * s + E) / C);
    if (A) s = clamp((B * t - D) / A);
    t = clamp((B * s + E) / C);
  }
  return Math.hypot(...w.map((x, k) => x + u[k] * s - v[k] * t));
}

export function wallBlocks(
  from: Vec3,
  to: Vec3,
  span: WallSpan,
  padding = 0.6,
): boolean {
  const distance = (a: Vec3, b: Vec3) =>
    Math.hypot(...a.map((v, k) => v - b[k]));
  if (
    distance(from, span.a) >
    distance(from, to) + distance(span.a, span.b) + padding
  )
    return false;
  const length = Math.hypot(...span.a);
  const n = span.a.map((x) => x / length) as Vec3;
  const project = (p: Vec3) => {
    const h = p.reduce((sum, v, k) => sum + (v - span.a[k]) * n[k], 0);
    return p.map((v, k) => v - h * n[k]) as Vec3;
  };
  return (
    segmentDistance(
      project(from),
      project(to),
      project(span.a),
      project(span.b),
    ) < padding
  );
}
