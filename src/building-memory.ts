import { SPECS } from "./simulation";
import type {
  BuildingKind,
  BuildingObservation,
  Game,
  Team,
  Vec3,
} from "./types";

/** Private visual history. Never use hidden live entities to reconcile memories. */
export class BuildingMemory {
  readonly buildings = new Map<number, BuildingObservation>();
  private game?: Game;
  private team?: Team;
  private time = -1;
  update(game: Game, team: Team): void {
    if (this.game !== game || this.team !== team || game.time < this.time)
      this.buildings.clear();
    this.game = game;
    this.team = team;
    this.time = game.time;
    const visible = game.visible[team];
    const observed = [...game.entities.values()].filter(
      (e) =>
        e.team !== team &&
        e.hp > 0 &&
        SPECS[e.kind].building &&
        visible[e.cell],
    );
    const ids = new Set(observed.map((e) => e.id));
    for (const [id, memory] of this.buildings)
      if (visible[memory.cell] && !ids.has(id)) this.buildings.delete(id);
    const walls = new Map(
      observed.filter((e) => e.kind === "wall").map((e) => [e.cell, e]),
    );
    for (const e of observed) {
      const connections: Vec3[] = [];
      if (e.kind === "wall")
        for (const cell of game.world.cells[e.cell].neighbors) {
          const neighbor = walls.get(cell);
          if (neighbor?.team === e.team)
            connections.push(
              e.position.map((v, k) => (v + neighbor.position[k]) / 2) as Vec3,
            );
        }
      this.buildings.set(e.id, {
        id: e.id,
        kind: e.kind as BuildingKind,
        team: e.team,
        cell: e.cell,
        position: [...e.position],
        heading: [...e.heading],
        progress: e.progress,
        connections,
      });
    }
  }
  clear(): void {
    this.buildings.clear();
    this.game = undefined;
    this.team = undefined;
    this.time = -1;
  }
}
