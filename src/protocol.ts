import type {
  Controller,
  Entity,
  Explosion,
  Order,
  Player,
  Shot,
  Team,
  UnitKind,
} from "./types";

export interface LobbySlot {
  team: Team;
  controller: Controller;
  name: string;
  clientId: string | null;
  ready: boolean;
  connected: boolean;
}
export interface LobbyRoom {
  code: string;
  hostId: string;
  seed: string;
  phase: "lobby" | "playing" | "finished";
  slots: LobbySlot[];
}
export type GameCommand =
  | {
      type: "wallLine";
      builderId: number;
      startCell: number;
      endCell: number;
      append?: boolean;
    }
  | { type: "order"; ids: number[]; order: Order; append?: boolean }
  | { type: "stop"; ids: number[] }
  | { type: "produce"; factoryId: number; kind: UnitKind }
  | { type: "cancel"; factoryId: number }
  | { type: "rally"; factoryId: number; cell: number };
export interface GameSnapshot {
  time: number;
  entities: Entity[];
  players: Player[];
  visible: number[];
  explored: number[];
  winner: Team | null;
  finished: boolean;
  shots: Shot[];
  explosions: Explosion[];
  messages: { text: string; time: number; team?: Team }[];
}
export type ClientMessage =
  | { type: "create"; name: string; seed: string }
  | { type: "join"; name: string; code: string }
  | { type: "configure"; slot: Team; controller: Controller }
  | { type: "seed"; seed: string }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "command"; command: GameCommand }
  | { type: "returnLobby" }
  | { type: "leave" };
export type ServerMessage =
  | { type: "welcome"; clientId: string }
  | { type: "lobby"; room: LobbyRoom; team: Team }
  | { type: "match"; room: LobbyRoom; team: Team; snapshot: GameSnapshot }
  | { type: "snapshot"; snapshot: GameSnapshot }
  | { type: "error"; message: string }
  | { type: "left" };
