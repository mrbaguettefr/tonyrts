export type Vec3 = [number, number, number];
export type Team = 0 | 1;
export type Kind =
  | "commander"
  | "constructor"
  | "scout"
  | "tank"
  | "heavy"
  | "extractor"
  | "generator"
  | "factory"
  | "turret";
export type UnitKind = "constructor" | "scout" | "tank" | "heavy";
export type BuildingKind = "extractor" | "generator" | "factory" | "turret";
export interface Cell {
  id: number;
  dir: Vec3;
  position: Vec3;
  height: number;
  slope: number;
  neighbors: number[];
  passable: boolean;
  metal: boolean;
}
export interface World {
  seed: string;
  radius: number;
  cells: Cell[];
  triangles: number[];
  spawns: [number, number];
  nearest(point: Vec3): number;
  path(from: number, to: number, blocked?: Set<number>): number[];
  distance(a: number, b: number): number;
}
export interface Spec {
  name: string;
  role: string;
  building: boolean;
  hp: number;
  speed: number;
  range: number;
  sight: number;
  damage: number;
  cooldown: number;
  metal: number;
  energy: number;
  buildTime: number;
  size: number;
}
export type Order =
  | { type: "move" | "attackMove"; cell: number }
  | { type: "attack"; target: number }
  | { type: "build"; kind: BuildingKind; cell: number };
export interface Entity {
  id: number;
  team: Team;
  kind: Kind;
  cell: number;
  position: Vec3;
  heading: Vec3;
  hp: number;
  progress: number;
  orders: Order[];
  path: number[];
  cooldown: number;
  queue: UnitKind[];
  production: number;
  rally: number | null;
}
export interface Player {
  metal: number;
  energy: number;
  metalCap: number;
  energyCap: number;
  metalIncome: number;
  energyIncome: number;
  metalDrain: number;
  energyDrain: number;
}
export interface Shot {
  id: number;
  from: Vec3;
  to: Vec3;
  team: Team;
  age: number;
  duration: number;
}
export interface Explosion {
  id: number;
  position: Vec3;
  age: number;
  duration: number;
  size: number;
}
export interface Game {
  world: World;
  entities: Map<number, Entity>;
  players: [Player, Player];
  visible: [Uint8Array, Uint8Array];
  explored: [Uint8Array, Uint8Array];
  time: number;
  paused: boolean;
  winner: Team | null;
  shots: Shot[];
  explosions: Explosion[];
  messages: { text: string; time: number }[];
}
export interface Placement {
  valid: boolean;
  reason: string;
}
export interface RenderState {
  selected: Set<number>;
  hoveredCell: number | null;
  building: BuildingKind | null;
  attackMode: boolean;
  overview?: boolean;
}
export interface SceneApi {
  canvas: HTMLCanvasElement;
  render(game: Game, state: RenderState, dt: number): void;
  pick(
    clientX: number,
    clientY: number,
  ): { cell: number | null; entity: number | null };
  selectRect(x1: number, y1: number, x2: number, y2: number): number[];
  orbit(dx: number, dy: number): void;
  zoom(delta: number): void;
  focus(cell: number): void;
  project(cell: number): { x: number; y: number; visible: boolean };
  diagnostics(): { drawCalls: number; triangles: number };
  resize(): void;
  dispose(): void;
}
