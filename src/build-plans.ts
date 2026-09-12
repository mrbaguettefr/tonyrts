import type { BuildingKind, Game, Team } from "./types";

export interface BuildPlan {
  builder: number;
  kind: BuildingKind;
  cell: number;
  step: number;
  active: boolean;
}

/** Own issued commands remain known even beyond current sight. */
export function gatherBuildPlans(game: Game, team: Team): BuildPlan[] {
  const occupied = new Set<number>();
  for (const entity of game.entities.values())
    if (
      (entity.team === team || game.visible[team]?.[entity.cell]) &&
      ["extractor", "generator", "factory", "turret", "wall"].includes(
        entity.kind,
      )
    )
      occupied.add(entity.cell);
  const plans = new Map<string, BuildPlan>();
  for (const entity of game.entities.values()) {
    if (
      entity.team !== team ||
      entity.hp <= 0 ||
      !["commander", "constructor"].includes(entity.kind)
    )
      continue;
    entity.orders.forEach((order, index) => {
      if (order.type !== "build" || occupied.has(order.cell)) return;
      const key = `${order.kind}:${order.cell}`;
      const plan = {
        builder: entity.id,
        kind: order.kind,
        cell: order.cell,
        step: index + 1,
        active: index === 0,
      };
      if (!plans.has(key) || (plan.active && !plans.get(key)!.active))
        plans.set(key, plan);
    });
  }
  return [...plans.values()];
}
