import type {
  BuildingKind,
  Entity,
  Game,
  Kind,
  Order,
  Placement,
  PlayerSetup,
  Spec,
  Team,
  UnitKind,
  Vec3,
  World,
} from "./types";
const spec = (
  name: string,
  role: string,
  building: boolean,
  hp: number,
  speed: number,
  range: number,
  sight: number,
  damage: number,
  cooldown: number,
  metal: number,
  energy: number,
  buildTime: number,
  size: number,
): Spec => ({
  name,
  role,
  building,
  hp,
  speed,
  range,
  sight,
  damage,
  cooldown,
  metal,
  energy,
  buildTime,
  size,
});
export const SPECS: Record<Kind, Spec> = {
  commander: spec(
    "Commander",
    "Armored command & construction",
    false,
    2200,
    4,
    15,
    25,
    55,
    1,
    0,
    0,
    1,
    1.5,
  ),
  constructor: spec(
    "Constructor",
    "Mobile construction vehicle",
    false,
    320,
    5,
    0,
    19,
    0,
    1,
    100,
    160,
    12,
    1,
  ),
  scout: spec(
    "Scout",
    "Fast reconnaissance",
    false,
    160,
    8,
    10,
    28,
    9,
    0.6,
    45,
    70,
    6,
    0.7,
  ),
  tank: spec(
    "Tank",
    "Main battle vehicle",
    false,
    560,
    5,
    15,
    22,
    40,
    1.2,
    120,
    160,
    13,
    1,
  ),
  heavy: spec(
    "Heavy",
    "Heavy assault walker",
    false,
    1100,
    3.2,
    18,
    24,
    85,
    1.7,
    260,
    350,
    24,
    1.4,
  ),
  extractor: spec(
    "Metal extractor",
    "Extracts 5 metal / second",
    true,
    500,
    0,
    0,
    15,
    0,
    1,
    75,
    90,
    10,
    1.4,
  ),
  generator: spec(
    "Energy generator",
    "Generates 14 energy / second",
    true,
    420,
    0,
    0,
    15,
    0,
    1,
    60,
    80,
    9,
    1.3,
  ),
  factory: spec(
    "Land factory",
    "Produces ground forces",
    true,
    1500,
    0,
    0,
    22,
    0,
    1,
    240,
    300,
    24,
    2.3,
  ),
  turret: spec(
    "Defense turret",
    "Stationary defense",
    true,
    850,
    0,
    20,
    24,
    45,
    1,
    130,
    180,
    15,
    1.2,
  ),
};
interface Internal {
  next: number;
  fog: number;
  ai: number;
  goal: Map<number, number>;
  sight: Map<string, number[]>;
  routes: Map<string, number[]>;
  occupancy: string;
  los: Map<number, Uint8Array>;
  mobileCounts: number[];
}
const internals = new WeakMap<Game, Internal>();
const state = (g: Game) => internals.get(g)!;
const isBuilder = (e: Entity) =>
  e.kind === "commander" || e.kind === "constructor";
const mobileCount = (g: Game, t: Team) => state(g).mobileCounts[t];
function add(
  g: Game,
  team: Team,
  kind: Kind,
  cell: number,
  progress = 1,
): Entity {
  const e: Entity = {
    id: state(g).next++,
    team,
    kind,
    cell,
    position: [...g.world.cells[cell].position],
    heading: [1, 0, 0],
    hp: SPECS[kind].hp,
    progress,
    orders: [],
    path: [],
    cooldown: 0,
    queue: [],
    production: 0,
    rally: null,
  };
  g.entities.set(e.id, e);
  if (!SPECS[kind].building) state(g).mobileCounts[team]++;
  return e;
}
export function createGame(
  world: World,
  setup: PlayerSetup[] = [
    { name: "Commander", controller: "human" },
    { name: "AI Commander", controller: "ai" },
  ],
): Game {
  if (
    setup.length < 2 ||
    setup.length > 4 ||
    world.spawns.length < setup.length
  )
    throw new Error("A match requires 2–4 slots and a spawn for each slot");
  const player = (entry: PlayerSetup) => ({
    ...entry,
    eliminated: entry.controller === "closed",
    metal: 400,
    energy: 600,
    metalCap: 1200,
    energyCap: 2000,
    metalIncome: entry.controller === "closed" ? 0 : 2,
    energyIncome: entry.controller === "closed" ? 0 : 7,
    metalDrain: 0,
    energyDrain: 0,
  });
  const g: Game = {
    world,
    entities: new Map(),
    players: setup.map(player),
    visible: setup.map(() => new Uint8Array(world.cells.length)),
    explored: setup.map(() => new Uint8Array(world.cells.length)),
    time: 0,
    paused: false,
    winner: null,
    finished: false,
    shots: [],
    explosions: [],
    messages: [],
  };
  internals.set(g, {
    next: 1,
    fog: 0,
    ai: 0,
    goal: new Map(),
    sight: new Map(),
    routes: new Map(),
    occupancy: "",
    los: new Map(),
    mobileCounts: setup.map(() => 0),
  });
  setup.forEach((entry, team) => {
    if (entry.controller !== "closed")
      add(g, team as Team, "commander", world.spawns[team]);
  });
  updateFog(g);
  return g;
}
export function canPlace(
  g: Game,
  team: Team,
  kind: BuildingKind,
  cell: number,
): Placement {
  const c = g.world.cells[cell];
  let reason = "";
  if (
    g.finished ||
    g.winner !== null ||
    !g.players[team] ||
    g.players[team].eliminated
  )
    reason = "Player is inactive";
  else if (!c || !c.passable || c.slope > 0.48) reason = "Terrain is too steep";
  else if (!g.visible[team][cell]) reason = "Requires current vision";
  else if (kind === "extractor" && !c.metal)
    reason = "Requires a metal deposit";
  else if (
    [...g.entities.values()].some(
      (e) =>
        SPECS[e.kind].building &&
        g.world.distance(e.cell, cell) <
          SPECS[e.kind].size + SPECS[kind].size + 1,
    )
  )
    reason = "Building footprint occupied";
  else if (
    [...g.entities.values()].some(
      (e) =>
        !SPECS[e.kind].building &&
        Math.hypot(...e.position.map((v, k) => v - c.position[k])) <
          SPECS[e.kind].size + SPECS[kind].size + 0.5,
    )
  )
    reason = "Unit occupies building footprint";
  else if (
    kind === "factory" &&
    c.neighbors.filter((n) => g.world.cells[n].passable && !occupied(g).has(n))
      .length < 2
  )
    reason = "Factory requires clear exits";
  return { valid: !reason, reason };
}
export function issueOrder(
  g: Game,
  ids: number[],
  order: Order,
  append = false,
): void {
  if (g.finished || g.winner !== null) return;
  for (const id of ids) {
    const e = g.entities.get(id);
    if (
      !e ||
      g.players[e.team].eliminated ||
      SPECS[e.kind].building ||
      (order.type === "build" && !isBuilder(e))
    )
      continue;
    if (order.type === "attack") {
      const target = g.entities.get(order.target);
      if (!target || target.team === e.team || !g.visible[e.team][target.cell])
        continue;
    } else if (!g.world.cells[order.cell]?.passable) continue;
    if (!append) {
      e.orders = [];
      e.path = [];
      state(g).goal.delete(id);
    }
    e.orders.push({ ...order });
  }
}
export function stopUnits(g: Game, ids: number[]): void {
  for (const id of ids) {
    const e = g.entities.get(id);
    if (
      e &&
      !g.finished &&
      g.winner === null &&
      !g.players[e.team].eliminated
    ) {
      e.orders = [];
      e.path = [];
      state(g).goal.delete(id);
    }
  }
}
export function enqueueUnit(g: Game, id: number, kind: UnitKind): boolean {
  const e = g.entities.get(id);
  if (
    !e ||
    g.finished ||
    g.winner !== null ||
    g.players[e.team].eliminated ||
    e.kind !== "factory" ||
    e.progress < 1 ||
    e.queue.length >= 12 ||
    !["scout", "tank", "heavy", "constructor"].includes(kind)
  )
    return false;
  e.queue.push(kind);
  return true;
}
export function cancelProduction(g: Game, id: number): void {
  const e = g.entities.get(id);
  if (e && !g.finished && g.winner === null && !g.players[e.team].eliminated) {
    e.queue.shift();
    e.production = 0;
  }
}
export function setRally(g: Game, id: number, cell: number): void {
  const e = g.entities.get(id);
  if (
    !g.finished &&
    g.winner === null &&
    e?.kind === "factory" &&
    !g.players[e.team].eliminated &&
    g.world.cells[cell]?.passable
  )
    e.rally = cell;
}
function occupied(g: Game): Set<number> {
  return new Set(
    [...g.entities.values()]
      .filter((e) => SPECS[e.kind].building)
      .map((e) => e.cell),
  );
}
function los(g: Game, a: number, b: number): boolean {
  const cache = state(g).los;
  let row = cache.get(a);
  if (!row) {
    row = new Uint8Array(g.world.cells.length);
    cache.set(a, row);
  }
  if (row[b]) return row[b] === 2;
  const result = uncachedLos(g, a, b);
  row[b] = result ? 2 : 1;
  return result;
}
function uncachedLos(g: Game, a: number, b: number): boolean {
  const w = g.world,
    d = w.distance(a, b);
  if (d > w.radius * 0.75) return false;
  const ca = w.cells[a],
    cb = w.cells[b];
  const steps = Math.max(2, Math.ceil(d / 3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p: Vec3 = ca.position.map(
      (v, k) => v * (1 - t) + cb.position[k] * t,
    ) as Vec3;
    const ground = w.cells[w.nearest(p)];
    if (Math.hypot(...p) + 2 < Math.hypot(...ground.position)) return false;
  }
  return true;
}
function updateFog(g: Game): void {
  for (const visible of g.visible) visible.fill(0);
  const cache = state(g).sight;
  for (const e of g.entities.values()) {
    if (e.progress < 1) continue;
    const key = `${e.cell}:${SPECS[e.kind].sight}`;
    let cells = cache.get(key);
    if (!cells) {
      cells = g.world.cells
        .filter(
          (c) =>
            g.world.distance(e.cell, c.id) <= SPECS[e.kind].sight &&
            los(g, e.cell, c.id),
        )
        .map((c) => c.id);
      cache.set(key, cells);
    }
    for (const id of cells) {
      g.visible[e.team][id] = 1;
      g.explored[e.team][id] = 1;
    }
  }
}
function move(
  g: Game,
  e: Entity,
  to: number,
  dt: number,
  blocked: Set<number>,
): boolean {
  if (e.cell === to && e.path.length === 0) return true;
  if (
    state(g).goal.get(e.id) !== to ||
    !e.path.length ||
    e.path.some((c) => blocked.has(c))
  ) {
    const key = `${e.cell}:${to}:${[...blocked].join(",")}`;
    let route = state(g).routes.get(key);
    if (!route) {
      route = g.world.path(e.cell, to, blocked);
      if (!route.length) {
        const candidates = new Set<number>(g.world.cells[to].neighbors);
        for (const id of [...candidates])
          for (const neighbor of g.world.cells[id].neighbors)
            candidates.add(neighbor);
        const choices = [...candidates]
          .filter((id) => g.world.cells[id].passable && !blocked.has(id))
          .sort(
            (a, b) =>
              g.world.distance(a, to) - g.world.distance(b, to) ||
              g.world.distance(e.cell, a) - g.world.distance(e.cell, b),
          );
        for (const candidate of choices) {
          if (candidate === e.cell) {
            route = [e.cell];
            break;
          }
          const alternative = g.world.path(e.cell, candidate, blocked);
          if (alternative.length) {
            route = alternative;
            break;
          }
        }
      }
      state(g).routes.set(key, route);
    }
    e.path = [...route];
    if (e.path[0] === e.cell) e.path.shift();
    state(g).goal.set(e.id, to);
    if (
      !route.length &&
      (!g.messages.length ||
        g.time - g.messages[g.messages.length - 1].time > 2)
    )
      g.messages.push({
        text: "Destination unreachable. Order skipped.",
        time: g.time,
        team: e.team,
      });
  }
  let budget = SPECS[e.kind].speed * dt;
  while (e.path.length && budget > 0) {
    const cell = g.world.cells[e.path[0]],
      dist = Math.hypot(...cell.position.map((v, k) => v - e.position[k]));
    if (dist < budget + 0.001) {
      e.position = [...cell.position];
      e.cell = cell.id;
      e.path.shift();
      budget -= dist;
    } else {
      const t = budget / dist,
        p = e.position.map((v, k) => v + (cell.position[k] - v) * t) as Vec3,
        length = Math.hypot(...p),
        radius =
          Math.hypot(...e.position) * (1 - t) +
          Math.hypot(...cell.position) * t;
      e.heading = cell.position.map((v, k) => v - e.position[k]) as Vec3;
      e.position = p.map((v) => (v / length) * radius) as Vec3;
      budget = 0;
    }
  }
  return e.path.length === 0;
}

function finish(e: Entity, g: Game) {
  e.orders.shift();
  e.path = [];
  state(g).goal.delete(e.id);
}
function approach(
  g: Game,
  e: Entity,
  cell: number,
  range: number,
  dt: number,
  blocked: Set<number>,
  clearance = 0,
): boolean {
  if (
    g.world.distance(e.cell, cell) <= range &&
    g.world.distance(e.cell, cell) > clearance
  )
    return true;
  let target = cell;
  if (blocked.has(cell)) {
    const choices = g.world.cells
      .filter(
        (c) =>
          c.passable &&
          !blocked.has(c.id) &&
          g.world.distance(c.id, cell) < range &&
          g.world.distance(c.id, cell) > clearance,
      )
      .sort(
        (a, b) =>
          g.world.distance(e.cell, a.id) - g.world.distance(e.cell, b.id),
      );
    if (!choices.length) return false;
    target = choices[0].id;
  }
  move(g, e, target, dt, blocked);
  return false;
}
function nearestEnemy(g: Game, e: Entity): Entity | undefined {
  let target: Entity | undefined,
    best = Infinity;
  for (const candidate of g.entities.values()) {
    if (candidate.team === e.team || !g.visible[e.team][candidate.cell])
      continue;
    const distance = g.world.distance(e.cell, candidate.cell);
    if (
      distance < best &&
      distance <= SPECS[e.kind].range &&
      los(g, e.cell, candidate.cell)
    ) {
      target = candidate;
      best = distance;
    }
  }
  return target;
}

function seekFiringPosition(
  g: Game,
  e: Entity,
  target: Entity,
  dt: number,
  blocked: Set<number>,
): void {
  const range = SPECS[e.kind].range;
  const previous = state(g).goal.get(e.id);
  if (
    previous !== undefined &&
    e.path.length &&
    !blocked.has(previous) &&
    g.world.distance(previous, target.cell) <= range &&
    los(g, previous, target.cell)
  ) {
    move(g, e, previous, dt, blocked);
    return;
  }
  const choices = g.world.cells
    .filter(
      (c) =>
        c.passable &&
        !blocked.has(c.id) &&
        g.world.distance(c.id, target.cell) <= range &&
        los(g, c.id, target.cell),
    )
    .sort(
      (a, b) => g.world.distance(e.cell, a.id) - g.world.distance(e.cell, b.id),
    );
  for (const cell of choices) {
    if (cell.id === e.cell) continue;
    const route = g.world.path(e.cell, cell.id, blocked);
    if (route.length) {
      e.path = route[0] === e.cell ? route.slice(1) : route;
      state(g).goal.set(e.id, cell.id);
      move(g, e, cell.id, dt, blocked);
      return;
    }
  }
}

function ai(g: Game, team: Team): void {
  const own = [...g.entities.values()].filter((e) => e.team === team),
    commander = own.find((e) => e.kind === "commander");
  if (!commander) return;
  const builder = own.find((e) => isBuilder(e) && !e.orders.length);
  if (builder) {
    let kind: BuildingKind =
      own.filter((e) => e.kind === "extractor").length < 2
        ? "extractor"
        : own.filter((e) => e.kind === "generator").length < 3
          ? "generator"
          : !own.some((e) => e.kind === "factory")
            ? "factory"
            : own.filter((e) => e.kind === "extractor").length < 4
              ? "extractor"
              : own.filter((e) => e.kind === "generator").length < 6
                ? "generator"
                : "turret";
    if (own.filter((e) => e.kind === "turret").length >= 3 && kind === "turret")
      kind = "extractor";
    let candidates = g.world.cells
      .filter((c) => canPlace(g, team, kind, c.id).valid)
      .sort(
        (a, b) =>
          g.world.distance(builder.cell, a.id) -
          g.world.distance(builder.cell, b.id),
      );
    if (!candidates.length && kind === "extractor") {
      kind = "generator";
      candidates = g.world.cells.filter(
        (c) => canPlace(g, team, kind, c.id).valid,
      );
    }
    if (candidates.length && g.players[team].metal > 40)
      issueOrder(g, [builder.id], {
        type: "build",
        kind,
        cell: candidates[0].id,
      });
  }
  for (const f of own.filter((e) => e.kind === "factory" && e.progress === 1))
    if (f.queue.length < 2)
      enqueueUnit(
        g,
        f.id,
        own.filter((e) => e.kind === "scout").length < 2
          ? "scout"
          : own.filter((e) => e.kind === "tank").length % 4 === 3
            ? "heavy"
            : "tank",
      );
  const enemies = [...g.entities.values()].filter(
    (e) => e.team !== team && g.visible[team][e.cell],
  );
  const fighters = own.filter((e) =>
    ["scout", "tank", "heavy"].includes(e.kind),
  );
  for (const e of fighters) {
    if (e.orders.length) continue;
    const near = enemies.sort(
      (a, b) =>
        g.world.distance(e.cell, a.cell) - g.world.distance(e.cell, b.cell),
    )[0];
    if (
      near &&
      (fighters.length >= 4 || g.world.distance(near.cell, commander.cell) < 30)
    )
      issueOrder(g, [e.id], { type: "attackMove", cell: near.cell });
    else if (e.kind === "scout" || fighters.length >= 5) {
      const options = g.world.cells.filter(
        (c) => c.passable && !g.explored[team][c.id],
      );
      const c =
        options[
          (e.id * 137 + Math.floor(g.time / 8) * 31) %
            Math.max(1, options.length)
        ];
      if (c) issueOrder(g, [e.id], { type: "attackMove", cell: c.id });
    }
  }
}
// Local separation only shifts a small distance; walk the spherical mesh to
// the nearest direction rather than scan every terrain vertex for each pair.
function separationCell(g: Game, start: number, p: Vec3) {
  let current = start;
  const score = (id: number) => {
    const d = g.world.cells[id].dir;
    return d[0] * p[0] + d[1] * p[1] + d[2] * p[2];
  };
  for (let step = 0; step < 16; step++) {
    let best = current,
      bestScore = score(current);
    for (const id of g.world.cells[current].neighbors) {
      const candidate = score(id);
      if (candidate > bestScore || (candidate === bestScore && id < best)) {
        best = id;
        bestScore = candidate;
      }
    }
    if (best === current) return g.world.cells[current];
    current = best;
  }
  return g.world.cells[g.world.nearest(p)];
}

function separate(g: Game, dt: number, blocked: Set<number>): void {
  const buckets = new Map<number, Entity[]>();
  for (const e of g.entities.values())
    if (!SPECS[e.kind].building) {
      const list = buckets.get(e.cell) || [];
      list.push(e);
      buckets.set(e.cell, list);
    }
  for (const e of g.entities.values()) {
    if (SPECS[e.kind].building) continue;
    const neighbors = [e.cell, ...g.world.cells[e.cell].neighbors].flatMap(
      (id) => buckets.get(id) || [],
    );
    for (const other of neighbors) {
      if (other.id <= e.id) continue;
      const delta = e.position.map((v, k) => v - other.position[k]) as Vec3;
      let distance = Math.hypot(...delta);
      const min = (SPECS[e.kind].size + SPECS[other.kind].size) * 0.8;
      if (distance >= min) continue;
      if (distance < 0.001) {
        const d = g.world.cells[e.cell].dir;
        delta[0] = d[1] + 0.13;
        delta[1] = -d[0];
        delta[2] = 0.21;
        distance = Math.hypot(...delta);
      }
      const push = Math.min(0.15, (min - distance) * dt * 2);
      for (const [unit, sign] of [
        [e, 1],
        [other, -1],
      ] as const) {
        const p = unit.position.map(
          (v, k) => v + (delta[k] / distance) * push * sign,
        ) as Vec3;
        const cell = separationCell(g, unit.cell, p);
        if (!cell.passable || blocked.has(cell.id)) continue;
        const radius = Math.hypot(...unit.position),
          length = Math.hypot(...p);
        unit.position = p.map((v) => (v / length) * radius) as Vec3;
      }
    }
  }
}

export function tick(g: Game, dt: number): void {
  if (
    g.paused ||
    g.finished ||
    g.winner !== null ||
    !Number.isFinite(dt) ||
    dt <= 0
  )
    return;
  dt = Math.min(dt, 0.25);
  g.time += dt;
  const s = state(g);
  s.mobileCounts.fill(0);
  for (const e of g.entities.values())
    if (!SPECS[e.kind].building) s.mobileCounts[e.team]++;
  s.fog -= dt;
  s.ai -= dt;
  if (s.fog <= 0) {
    updateFog(g);
    s.fog = 0.5;
  }
  if (s.ai <= 0) {
    g.players.forEach((p, team) => {
      if (p.controller === "ai" && !p.eliminated) ai(g, team as Team);
    });
    s.ai = 2;
  }
  g.shots = g.shots.filter((x) => (x.age += dt) < x.duration);
  g.explosions = g.explosions.filter((x) => (x.age += dt) < x.duration);
  const blocked = occupied(g),
    occupancy = [...blocked].join(",");
  if (s.occupancy !== occupancy) {
    s.routes.clear();
    s.occupancy = occupancy;
  }
  const work: {
    team: Team;
    metal: number;
    energy: number;
    apply: (ratio: number) => void;
  }[] = [];
  for (const e of [...g.entities.values()]) {
    if (e.progress < 1) continue;
    e.cooldown = Math.max(0, e.cooldown - dt);
    const sp = SPECS[e.kind],
      o = e.orders[0];
    let target: Entity | undefined;
    if (o?.type === "attack") {
      target = g.entities.get(o.target);
      if (!target || !g.visible[e.team][target.cell]) {
        finish(e, g);
        target = undefined;
      }
    }
    if (!target && sp.damage && o?.type !== "move" && o?.type !== "build")
      target = nearestEnemy(g, e);
    if (
      target &&
      g.world.distance(e.cell, target.cell) <= sp.range &&
      los(g, e.cell, target.cell)
    ) {
      if (e.cooldown === 0) {
        e.cooldown = sp.cooldown;
        target.hp -= sp.damage;
        g.shots.push({
          id: s.next++,
          from: [...e.position],
          to: [...target.position],
          team: e.team,
          age: 0,
          duration: 0.25,
        });
      }
    } else if (o) {
      if (o.type === "move" || o.type === "attackMove") {
        if (move(g, e, o.cell, dt, blocked)) finish(e, g);
      } else if (o.type === "attack" && target)
        seekFiringPosition(g, e, target, dt, blocked);
      else if (o.type === "build") {
        let site = [...g.entities.values()].find(
          (b) => b.team === e.team && b.kind === o.kind && b.cell === o.cell,
        );
        if (site?.progress === 1) {
          finish(e, g);
          continue;
        }
        if (!site && !canPlace(g, e.team, o.kind, o.cell).valid) {
          finish(e, g);
          continue;
        }
        if (
          approach(
            g,
            e,
            o.cell,
            7,
            dt,
            new Set([...blocked, o.cell]),
            SPECS[o.kind].size + SPECS[e.kind].size + 0.5,
          )
        ) {
          if (!site) {
            site = add(g, e.team, o.kind, o.cell, 0);
            blocked.add(site.cell);
            s.routes.clear();
          }
          const b = site,
            bsp = SPECS[b.kind],
            amount = Math.min(dt / bsp.buildTime, 1 - b.progress);
          work.push({
            team: e.team,
            metal: bsp.metal * amount,
            energy: bsp.energy * amount,
            apply: (r) => {
              b.progress = Math.min(1, b.progress + amount * r);
            },
          });
        }
      }
    }
    if (
      e.kind === "factory" &&
      e.queue.length &&
      mobileCount(g, e.team) < 100
    ) {
      const kind = e.queue[0],
        usp = SPECS[kind],
        amount = Math.min(dt / usp.buildTime, 1 - e.production);
      work.push({
        team: e.team,
        metal: usp.metal * amount,
        energy: usp.energy * amount,
        apply: (r) => {
          e.production += amount * r;
          if (e.production >= 1 && mobileCount(g, e.team) < 100) {
            const exit = g.world.cells[e.cell].neighbors
              .filter((n) => g.world.cells[n].passable && !blocked.has(n))
              .sort(
                (a, b) =>
                  [...g.entities.values()].filter((u) => u.cell === a).length -
                  [...g.entities.values()].filter((u) => u.cell === b).length,
              )[0];
            if (exit !== undefined) {
              const unit = add(g, e.team, kind, exit);
              if (e.rally !== null)
                issueOrder(g, [unit.id], { type: "attackMove", cell: e.rally });
              e.production = 0;
              e.queue.shift();
            } else e.production = 1;
          }
        },
      });
    }
  }
  for (let index = 0; index < g.players.length; index++) {
    const team = index as Team;
    if (g.players[team].eliminated) continue;
    const p = g.players[team],
      own = [...g.entities.values()].filter(
        (e) => e.team === team && e.progress === 1,
      );
    p.metalIncome = own.reduce(
      (n, e) =>
        n + (e.kind === "commander" ? 2 : e.kind === "extractor" ? 5 : 0),
      0,
    );
    p.energyIncome = own.reduce(
      (n, e) =>
        n + (e.kind === "commander" ? 7 : e.kind === "generator" ? 14 : 0),
      0,
    );
    p.metal = Math.min(p.metalCap, p.metal + p.metalIncome * dt);
    p.energy = Math.min(p.energyCap, p.energy + p.energyIncome * dt);
    const tasks = work.filter((w) => w.team === team),
      m = tasks.reduce((n, w) => n + w.metal, 0),
      en = tasks.reduce((n, w) => n + w.energy, 0),
      r = Math.min(1, m ? p.metal / m : 1, en ? p.energy / en : 1);
    p.metal -= m * r;
    p.energy -= en * r;
    p.metalDrain = (m * r) / dt;
    p.energyDrain = (en * r) / dt;
    tasks.forEach((w) => w.apply(r));
  }
  separate(g, dt, blocked);
  const defeated = new Set<Team>();
  for (const e of g.entities.values())
    if (e.hp <= 0 && e.kind === "commander") defeated.add(e.team);
  for (const team of defeated) {
    const p = g.players[team];
    p.eliminated = true;
    p.metalIncome = p.energyIncome = p.metalDrain = p.energyDrain = 0;
    g.messages.push({ text: `${p.name} eliminated.`, time: g.time });
  }
  for (const e of [...g.entities.values()])
    if (e.hp <= 0 || defeated.has(e.team)) {
      g.entities.delete(e.id);
      s.goal.delete(e.id);
      g.explosions.push({
        id: s.next++,
        position: [...e.position],
        age: 0,
        duration: 1.2,
        size: SPECS[e.kind].size * 2,
      });
    }
  if (defeated.size) {
    for (const e of g.entities.values())
      e.orders = e.orders.filter(
        (o) => o.type !== "attack" || g.entities.has(o.target),
      );
    updateFog(g);
    const survivors = g.players.flatMap((p, team) =>
      p.eliminated ? [] : [team as Team],
    );
    if (survivors.length <= 1) {
      g.finished = true;
      g.winner = survivors[0] ?? null;
      g.messages.push({
        text:
          g.winner === null
            ? "All commanders destroyed. Draw."
            : `${g.players[g.winner].name} wins.`,
        time: g.time,
      });
    }
  }
}
