import { issueWallLine } from "../src/simulation";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { createWorld } from "../src/world";
import {
  createGame,
  tick,
  issueOrder,
  stopUnits,
  enqueueUnit,
  cancelProduction,
  setRally,
} from "../src/simulation";
import type { Game, Team } from "../src/types";
import type {
  ClientMessage,
  GameCommand,
  GameSnapshot,
  LobbyRoom,
  ServerMessage,
} from "../src/protocol";

interface Peer {
  id: string;
  ws: WebSocket;
  room?: Room;
  team: Team;
  alive: boolean;
  rateAt: number;
  rate: number;
}
interface Room {
  lobby: LobbyRoom;
  game?: Game;
  peers: Map<string, Peer>;
  frames: number;
}
const units = ["constructor", "scout", "tank", "heavy"];
const buildings = ["extractor", "generator", "factory", "turret", "wall"];
const int = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const label = (value: unknown, fallback: string, max: number): string =>
  typeof value === "string"
    ? value
        .replace(/[<>\x00-\x1f\x7f]/g, "")
        .trim()
        .slice(0, max) || fallback
    : fallback;
export function snapshotFor(game: Game, team: Team): GameSnapshot {
  const visible = game.visible[team];
  const seen = (position: [number, number, number]) =>
    !!visible[game.world.nearest(position)];
  const entities: GameSnapshot["entities"] = [];
  for (const e of game.entities.values()) {
    const own = e.team === team;
    if (!own && !visible[e.cell]) continue;
    entities.push({
      id: e.id,
      team: e.team,
      kind: e.kind,
      cell: e.cell,
      position: [...e.position],
      heading: [...e.heading],
      hp: e.hp,
      progress: e.progress,
      cooldown: e.cooldown,
      orders: own ? e.orders.map((order) => ({ ...order })) : [],
      path: own ? [...e.path] : [],
      queue: own ? [...e.queue] : [],
      production: own ? e.production : 0,
      rally: own ? e.rally : null,
    });
  }
  return {
    time: game.time,
    entities,
    players: game.players.map((player, i) =>
      i === team
        ? { ...player }
        : {
            ...player,
            metal: 0,
            energy: 0,
            metalCap: 0,
            energyCap: 0,
            metalIncome: 0,
            energyIncome: 0,
            metalDrain: 0,
            energyDrain: 0,
          },
    ),
    visible: Array.from(visible),
    explored: Array.from(game.explored[team]),
    winner: game.winner,
    finished: game.finished,
    shots: game.shots
      .filter((shot) => seen(shot.from) && seen(shot.to))
      .map((shot) => ({ ...shot, from: [...shot.from], to: [...shot.to] })),
    explosions: game.explosions
      .filter((effect) => seen(effect.position))
      .map((effect) => ({ ...effect, position: [...effect.position] })),
    messages: game.messages
      .filter((message) => message.team === undefined || message.team === team)
      .map((message) => ({ ...message })),
  };
}
function validCommand(value: unknown, game: Game): value is GameCommand {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, any>;
  const cell = (v: unknown) => int(v) && v < game.world.cells.length;
  if (c.type === "wallLine")
    return (
      int(c.builderId) &&
      cell(c.startCell) &&
      cell(c.endCell) &&
      (c.append === undefined || typeof c.append === "boolean")
    );
  if (c.type === "order" || c.type === "stop") {
    if (
      !Array.isArray(c.ids) ||
      !c.ids.length ||
      c.ids.length > 100 ||
      !c.ids.every(int)
    )
      return false;
    if (c.type === "stop") return true;
    if (c.append !== undefined && typeof c.append !== "boolean") return false;
    const o = c.order;
    return (
      !!o &&
      typeof o === "object" &&
      ((["move", "attackMove"].includes(o.type) && cell(o.cell)) ||
        (o.type === "attack" && int(o.target)) ||
        (o.type === "build" && buildings.includes(o.kind) && cell(o.cell)))
    );
  }
  if (!int(c.factoryId)) return false;
  return (
    c.type === "cancel" ||
    (c.type === "produce" && units.includes(c.kind)) ||
    (c.type === "rally" && cell(c.cell))
  );
}
export async function startServer(
  options: { port?: number; host?: string; staticDir?: string } = {},
) {
  const rooms = new Map<string, Room>();
  const peers = new Set<Peer>();
  const staticRoot = resolve(options.staticDir ?? "dist");
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      const path = resolve(
        staticRoot,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!path.startsWith(staticRoot + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const contents = await readFile(path);
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  const wss = new WebSocketServer({
    server,
    path: "/multiplayer",
    maxPayload: 32768,
  });
  const send = (peer: Peer, message: ServerMessage) => {
    if (peer.ws.readyState === WebSocket.OPEN)
      peer.ws.send(JSON.stringify(message));
  };
  const error = (peer: Peer, message: string) =>
    send(peer, { type: "error", message });
  const broadcast = (room: Room) => {
    for (const peer of room.peers.values())
      send(peer, { type: "lobby", room: room.lobby, team: peer.team });
  };
  const resetReady = (room: Room) =>
    room.lobby.slots.forEach((slot) => {
      slot.ready = false;
    });
  const leave = (peer: Peer) => {
    const room = peer.room;
    if (!room) return;
    room.peers.delete(peer.id);
    peer.room = undefined;
    const slot = room.lobby.slots[peer.team];
    slot.clientId = null;
    slot.connected = false;
    slot.ready = false;
    if (room.lobby.phase !== "lobby") {
      slot.controller = "ai";
      slot.name = `${slot.name} (AI)`;
      if (room.game) room.game.players[peer.team].controller = "ai";
    } else resetReady(room);
    if (!room.peers.size) {
      rooms.delete(room.lobby.code);
      return;
    }
    if (room.lobby.hostId === peer.id)
      room.lobby.hostId = room.peers.keys().next().value!;
    broadcast(room);
  };
  function handle(peer: Peer, message: ClientMessage) {
    if (
      !message ||
      typeof message !== "object" ||
      typeof message.type !== "string"
    ) {
      error(peer, "Invalid message");
      return;
    }
    if (message.type === "leave") {
      leave(peer);
      send(peer, { type: "left" });
      return;
    }
    if (message.type === "create" || message.type === "join") {
      if (peer.room) {
        error(peer, "Leave your current room first");
        return;
      }
      let room: Room;
      if (message.type === "create") {
        if (rooms.size >= 100) {
          error(peer, "Server is full");
          return;
        }
        let code: string;
        do {
          code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
        } while (rooms.has(code));
        room = {
          lobby: {
            code,
            hostId: peer.id,
            seed: label(message.seed, "iron-orbit", 64),
            phase: "lobby",
            slots: [0, 1, 2, 3].map((i) => ({
              team: i as Team,
              controller: i === 0 ? "human" : i === 1 ? "ai" : "closed",
              name: i === 1 ? "AI 2" : "",
              clientId: null,
              connected: false,
              ready: false,
            })),
          },
          peers: new Map(),
          frames: 0,
        };
        rooms.set(code, room);
      } else {
        if (
          typeof message.code !== "string" ||
          !/^[A-Z0-9]{6}$/i.test(message.code)
        ) {
          error(peer, "Invalid room code");
          return;
        }
        const found = rooms.get(message.code.toUpperCase());
        if (!found) {
          error(peer, "Room not found");
          return;
        }
        room = found;
      }
      if (room.lobby.phase !== "lobby") {
        error(peer, "Match already in progress");
        return;
      }
      const slot = room.lobby.slots.find(
        (slot) => slot.controller === "human" && !slot.clientId,
      );
      if (!slot) {
        error(peer, "Room is full; host must open a human slot");
        return;
      }
      peer.room = room;
      peer.team = slot.team;
      room.peers.set(peer.id, peer);
      Object.assign(slot, {
        name: label(message.name, "Commander", 24),
        clientId: peer.id,
        connected: true,
        ready: false,
      });
      resetReady(room);
      broadcast(room);
      return;
    }
    const room = peer.room;
    if (!room) {
      error(peer, "Join a room first");
      return;
    }
    const host = room.lobby.hostId === peer.id;
    if (message.type === "ready") {
      if (room.lobby.phase !== "lobby" || typeof message.ready !== "boolean") {
        error(peer, "Cannot change readiness");
        return;
      }
      room.lobby.slots[peer.team].ready = message.ready;
      broadcast(room);
      return;
    }
    if (message.type === "command") {
      const game = room.game;
      if (
        room.lobby.phase !== "playing" ||
        !game ||
        game.finished ||
        game.players[peer.team].eliminated
      ) {
        error(peer, "Cannot issue commands now");
        return;
      }
      if (!validCommand(message.command, game)) {
        error(peer, "Invalid command");
        return;
      }
      const c = message.command;
      const ids =
        "ids" in c
          ? c.ids
          : [c.type === "wallLine" ? c.builderId : c.factoryId];
      if (
        ids.some((id) => {
          const entity = game.entities.get(id);
          return !entity || entity.team !== peer.team || entity.hp <= 0;
        })
      ) {
        error(peer, "You can only command your own units");
        return;
      }
      if (c.type === "wallLine") {
        const result = issueWallLine(
          game,
          c.builderId,
          c.startCell,
          c.endCell,
          c.append,
        );
        if (!result.valid) error(peer, result.reason);
      } else if (c.type === "order") {
        if (c.order.type === "attack") {
          const target = game.entities.get(c.order.target);
          if (
            !target ||
            target.hp <= 0 ||
            target.team === peer.team ||
            !game.visible[peer.team][target.cell]
          ) {
            error(peer, "Target is unavailable");
            return;
          }
        }
        if (
          c.append &&
          ids.some((id) => game.entities.get(id)!.orders.length >= 64)
        ) {
          error(peer, "Order queue is full");
          return;
        }
        issueOrder(game, ids, c.order, c.append);
      } else if (c.type === "stop") stopUnits(game, ids);
      else if (c.type === "produce") enqueueUnit(game, c.factoryId, c.kind);
      else if (c.type === "cancel") cancelProduction(game, c.factoryId);
      else setRally(game, c.factoryId, c.cell);
      return;
    }
    if (!host) {
      error(peer, "Only the host can do that");
      return;
    }
    if (message.type === "returnLobby") {
      if (room.lobby.phase !== "finished") {
        error(peer, "The match has not ended");
        return;
      }
      room.game = undefined;
      room.lobby.phase = "lobby";
      resetReady(room);
      broadcast(room);
      return;
    }
    if (room.lobby.phase !== "lobby") {
      error(peer, "Match already in progress");
      return;
    }
    if (message.type === "configure") {
      if (
        !int(message.slot) ||
        message.slot > 3 ||
        !["human", "ai", "closed"].includes(message.controller)
      ) {
        error(peer, "Invalid slot configuration");
        return;
      }
      const slot = room.lobby.slots[message.slot];
      if (slot.clientId) {
        error(peer, "Cannot replace an occupied human slot");
        return;
      }
      slot.controller = message.controller;
      slot.name = message.controller === "ai" ? `AI ${message.slot + 1}` : "";
      resetReady(room);
      broadcast(room);
    } else if (message.type === "seed") {
      room.lobby.seed = label(message.seed, "iron-orbit", 64);
      resetReady(room);
      broadcast(room);
    } else if (message.type === "start") {
      const active = room.lobby.slots.filter(
        (slot) => slot.controller !== "closed",
      );
      if (
        active.length < 2 ||
        active.some(
          (slot) =>
            slot.controller === "human" &&
            (!slot.clientId || !slot.connected || !slot.ready),
        )
      ) {
        error(
          peer,
          "Need at least two sides and every human slot filled and ready",
        );
        return;
      }
      room.game = createGame(
        createWorld(room.lobby.seed, 4),
        room.lobby.slots.map((slot) => ({
          name: slot.name,
          controller: slot.controller,
        })),
      );
      room.lobby.phase = "playing";
      room.frames = 0;
      for (const member of room.peers.values())
        send(member, {
          type: "match",
          room: room.lobby,
          team: member.team,
          snapshot: snapshotFor(room.game, member.team),
        });
    } else error(peer, "Unknown message");
  }
  wss.on("connection", (ws) => {
    const peer: Peer = {
      id: randomUUID(),
      ws,
      team: 0,
      alive: true,
      rateAt: Date.now(),
      rate: 0,
    };
    peers.add(peer);
    ws.on("pong", () => {
      peer.alive = true;
    });
    ws.on("message", (data, binary) => {
      if (Date.now() - peer.rateAt >= 1000) {
        peer.rate = 0;
        peer.rateAt = Date.now();
      }
      if (++peer.rate > 60) {
        if (peer.rate === 61) error(peer, "Too many commands; slow down");
        return;
      }
      if (binary) {
        error(peer, "Text messages required");
        return;
      }
      try {
        handle(peer, JSON.parse(data.toString()));
      } catch {
        error(peer, "Invalid message");
      }
    });
    ws.on("close", () => {
      leave(peer);
      peers.delete(peer);
    });
    ws.on("error", () => {});
    send(peer, { type: "welcome", clientId: peer.id });
  });
  const timer = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.lobby.phase !== "playing" || !room.game) continue;
      tick(room.game, 0.05);
      room.frames++;
      if (room.game.finished) room.lobby.phase = "finished";
      if (room.frames % 2 === 0 || room.game.finished)
        for (const peer of room.peers.values()) {
          if (peer.ws.bufferedAmount < 256000)
            send(peer, {
              type: "snapshot",
              snapshot: snapshotFor(room.game, peer.team),
            });
        }
      if (room.game.finished) broadcast(room);
    }
  }, 50);
  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) peer.ws.terminate();
      else {
        peer.alive = false;
        peer.ws.ping();
      }
    }
  }, 30000);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 8787, options.host ?? "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    clearInterval(timer);
    clearInterval(heartbeat);
    wss.close();
    throw error;
  }
  return {
    port: (server.address() as { port: number }).port,
    inspectRoom: (code: string) => rooms.get(code),
    roomCount: () => rooms.size,
    async close() {
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const peer of peers) peer.ws.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
      await new Promise<void>((done) => server.close(() => done()));
      rooms.clear();
    },
  };
}
