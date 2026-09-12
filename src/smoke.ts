import { SPECS } from "./simulation";
import type { Game, Team, Vec3 } from "./types";

export const SMOKE_LIMIT = 2048;
export const SMOKE_THRESHOLD = 0.35;
export interface SmokeParticle {
  owner: number;
  position: Vec3;
  normal: Vec3;
  age: number;
  lifetime: number;
  seed: number;
}
export class SmokePool {
  readonly particles: SmokeParticle[] = [];
  private spare: SmokeParticle[] = [];
  private emission = new Map<number, number>();
  private game?: Game;
  private team?: Team;
  private time = -1;
  private serial = 0;
  update(game: Game, team: Team): void {
    if (this.game !== game || this.team !== team || game.time < this.time)
      this.clear();
    const dt =
      this.time < 0 ? 0 : Math.max(0, Math.min(0.25, game.time - this.time));
    this.game = game;
    this.team = team;
    this.time = game.time;
    const visible = (id: number) => {
      const e = game.entities.get(id);
      return (
        !!e && e.hp > 0 && (e.team === team || !!game.visible[team][e.cell])
      );
    };
    let count = 0;
    for (const p of this.particles) {
      p.age += dt;
      if (p.age < p.lifetime && visible(p.owner)) this.particles[count++] = p;
      else this.spare.push(p);
    }
    this.particles.length = count;
    const emitting = new Set<number>();
    for (const e of game.entities.values()) {
      const spec = SPECS[e.kind],
        ratio = e.hp / spec.hp;
      if (
        !visible(e.id) ||
        spec.building ||
        e.progress < 1 ||
        ratio >= SMOKE_THRESHOLD
      )
        continue;
      emitting.add(e.id);
      let amount =
        (this.emission.get(e.id) ?? 0) +
        dt * (2 + 4 * (1 - ratio / SMOKE_THRESHOLD));
      while (amount >= 1) {
        amount--;
        if (this.particles.length >= SMOKE_LIMIT) break;
        const p = this.spare.pop() ?? {
          owner: 0,
          position: [0, 0, 0] as Vec3,
          normal: [0, 0, 0] as Vec3,
          age: 0,
          lifetime: 1.5,
          seed: 0,
        };
        const length = Math.hypot(...e.position);
        p.owner = e.id;
        p.age = 0;
        p.seed = this.serial++;
        for (let k = 0; k < 3; k++) {
          p.normal[k] = e.position[k] / length;
          p.position[k] =
            e.position[k] + p.normal[k] * (e.kind === "commander" ? 1.8 : 1.1);
        }
        this.particles.push(p);
      }
      this.emission.set(e.id, amount % 1);
    }
    for (const id of this.emission.keys())
      if (!emitting.has(id)) this.emission.delete(id);
  }
  clear(): void {
    this.particles.length = 0;
    this.spare.length = 0;
    this.emission.clear();
    this.game = undefined;
    this.time = -1;
    this.serial = 0;
  }
}
