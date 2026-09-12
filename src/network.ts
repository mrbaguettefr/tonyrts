import { createGame } from "./simulation";
import { createWorld } from "./world";
import type { Game, Team } from "./types";
import type {
  ClientMessage,
  GameSnapshot,
  LobbyRoom,
  ServerMessage,
} from "./protocol";

interface Callbacks {
  onLobby(room: LobbyRoom, team: Team, clientId: string): void;
  onMatch(game: Game, team: Team, room: LobbyRoom): void;
  onSnapshot?(game: Game): void;
  onError(message: string): void;
  onClose(reason: string): void;
}
export class NetworkClient {
  clientId = "";
  room: LobbyRoom | null = null;
  team: Team = 0;
  private socket: WebSocket | null = null;
  private game: Game | null = null;
  constructor(
    private callbacks: Callbacks,
    private url?: string,
  ) {}
  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url =
        this.url ??
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/multiplayer`;
      const socket = (this.socket = new WebSocket(url));
      let welcomed = false;
      const timeout = setTimeout(() => {
        reject(new Error("Connection timed out"));
        socket.close();
      }, 10000);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "welcome") {
          welcomed = true;
          clearTimeout(timeout);
          this.clientId = message.clientId;
          resolve();
        } else if (message.type === "lobby") {
          this.room = message.room;
          this.team = message.team;
          this.callbacks.onLobby(message.room, message.team, this.clientId);
        } else if (message.type === "match") {
          this.room = message.room;
          this.team = message.team;
          this.game = createGame(
            createWorld(message.room.seed, 4),
            message.room.slots.map((slot) => ({
              name: slot.name,
              controller: slot.controller,
            })),
          );
          this.apply(message.snapshot);
          this.callbacks.onMatch(this.game, this.team, message.room);
        } else if (message.type === "snapshot") {
          this.apply(message.snapshot);
          if (this.game) this.callbacks.onSnapshot?.(this.game);
        } else if (message.type === "error")
          this.callbacks.onError(message.message);
        else if (message.type === "left") {
          this.room = null;
          this.game = null;
        }
      };
      socket.onerror = () => {
        if (!welcomed)
          reject(new Error("Cannot connect to multiplayer server"));
      };
      socket.onclose = (event) => {
        clearTimeout(timeout);
        if (!welcomed) reject(new Error("Connection closed before joining"));
        if (this.socket === socket) {
          this.socket = null;
          this.room = null;
          this.game = null;
          this.callbacks.onClose(
            event.reason || "Disconnected. Rejoin a lobby to play again.",
          );
        }
      };
    });
  }
  private apply(snapshot: GameSnapshot): void {
    if (!this.game) return;
    Object.assign(this.game, {
      time: snapshot.time,
      entities: new Map(snapshot.entities.map((e) => [e.id, e])),
      players: snapshot.players,
      winner: snapshot.winner,
      finished: snapshot.finished,
      shots: snapshot.shots,
      explosions: snapshot.explosions,
      messages: snapshot.messages,
    });
    this.game.visible = this.game.players.map((_, i) =>
      i === this.team
        ? Uint8Array.from(snapshot.visible)
        : new Uint8Array(this.game!.world.cells.length),
    );
    this.game.explored = this.game.players.map((_, i) =>
      i === this.team
        ? Uint8Array.from(snapshot.explored)
        : new Uint8Array(this.game!.world.cells.length),
    );
  }
  send(message: ClientMessage): void {
    if (this.connected) this.socket!.send(JSON.stringify(message));
    else this.callbacks.onError("Not connected to multiplayer server");
  }
  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.room = null;
    this.game = null;
    socket?.close();
  }
}
