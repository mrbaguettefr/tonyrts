import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/simulation";
import { createWorld } from "../src/world";
import { snapshotFor } from "../server/server";
import { NetworkClient } from "../src/network";
import type { Game } from "../src/types";
import type { LobbyRoom, ServerMessage } from "../src/protocol";

const room: LobbyRoom = {
  code: "TEST42",
  hostId: "host",
  seed: "snapshot-test",
  phase: "playing",
  slots: ([0, 1, 2, 3] as const).map((team) => ({
    team,
    name: `Player ${team}`,
    controller: "human",
    clientId: `peer-${team}`,
    ready: true,
    connected: true,
  })),
};
const fixture = () => createGame(createWorld(room.seed, 4), room.slots);

test("snapshots detach nested state and redact private enemy data and effects", () => {
  const game = fixture();
  const [own, enemy, hidden] = [...game.entities.values()];
  own.orders = [{ type: "move", cell: 123 }];
  own.path = [123];
  own.queue = ["tank"];
  enemy.orders = [{ type: "build", cell: 456, kind: "factory" }];
  enemy.path = [456];
  enemy.queue = ["heavy"];
  enemy.production = 0.5;
  enemy.rally = 456;
  game.visible[0].fill(0);
  game.visible[0][own.cell] = game.visible[0][enemy.cell] = 1;
  game.shots = [
    {
      id: 1,
      team: 0,
      from: [...own.position],
      to: [...enemy.position],
      age: 0,
      duration: 1,
    },
    {
      id: 2,
      team: 0,
      from: [...own.position],
      to: [...hidden.position],
      age: 0,
      duration: 1,
    },
    {
      id: 3,
      team: 1,
      from: [...hidden.position],
      to: [...own.position],
      age: 0,
      duration: 1,
    },
  ];
  game.explosions = [own, hidden].map((e, i) => ({
    id: i,
    position: [...e.position],
    age: 0,
    duration: 1,
    size: 1,
  }));
  game.messages = [
    { text: "public", time: 0 },
    { text: "own", team: 0, time: 0 },
    { text: "private", team: 1, time: 0 },
  ];
  const snapshot = snapshotFor(game, 0);
  assert.deepEqual(
    snapshot.entities.map((e) => e.id),
    [own.id, enemy.id],
  );
  assert.deepEqual(snapshot.entities[0], own);
  assert.deepEqual(snapshot.entities[1], {
    ...enemy,
    orders: [],
    path: [],
    queue: [],
    production: 0,
    rally: null,
  });
  assert.deepEqual(
    snapshot.shots.map((e) => e.id),
    [1],
  );
  assert.deepEqual(
    snapshot.explosions.map((e) => e.id),
    [0],
  );
  assert.deepEqual(
    snapshot.messages.map((e) => e.text),
    ["public", "own"],
  );
  for (const player of snapshot.players.slice(1)) {
    for (const resource of ["metal", "energy"] as const)
      for (const suffix of ["", "Cap", "Income", "Drain"] as const)
        assert.equal(player[`${resource}${suffix}`], 0);
  }
  const detached = structuredClone(snapshot);
  own.position[0] += 1;
  own.heading[0] += 1;
  if ("cell" in own.orders[0]) own.orders[0].cell++;
  own.orders[0] = { type: "attack", target: enemy.id };
  own.path.push(999);
  own.queue.push("scout");
  enemy.position[1] += 1;
  game.players[0].metal++;
  game.visible[0].fill(0);
  game.explored[0].fill(0);
  game.shots[0].from[0] += 1;
  game.explosions[0].position[0] += 1;
  game.messages[0].text = "changed";
  assert.deepEqual(snapshot, detached);
  snapshot.entities[0].position[0] += 5;
  snapshot.entities[0].orders[0].type = "attackMove";
  assert.equal(own.orders[0].type, "attack");
  assert.notEqual(snapshot.entities[0].position[0], own.position[0]);
});

class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { reason: string }) => void;
  onerror?: () => void;
  constructor() {
    Socket.latest = this;
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.({ reason: "closed" });
  }
}

test("client reuses snapshot storage, removes hidden entities and resets each match", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: Socket,
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "WebSocket", original);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  });
  const games: Game[] = [];
  let updates = 0,
    closes = 0;
  const client = new NetworkClient(
    {
      onLobby() {},
      onError(message) {
        assert.fail(message);
      },
      onClose() {
        closes++;
      },
      onMatch(game) {
        for (const [team, fog] of game.visible.entries())
          if (team !== 1) {
            assert.ok(fog.every((value) => value === 0));
            assert.ok(game.explored[team].every((value) => value === 0));
          }
        games.push(game);
      },
      onSnapshot() {
        updates++;
      },
    },
    "ws://test/multiplayer",
  );
  t.after(() => client.disconnect());
  const connected = client.connect();
  const socket = Socket.latest;
  socket.receive({ type: "welcome", clientId: "peer-1" });
  await connected;
  const source = fixture();
  source.visible[1].fill(1);
  source.explored[1].fill(1);
  const match = () =>
    socket.receive({
      type: "match",
      room,
      team: 1,
      snapshot: snapshotFor(source, 1),
    });
  match();
  const game = games[0],
    entities = game.entities,
    visible = [...game.visible],
    explored = [...game.explored];
  const own = [...source.entities.values()].find((e) => e.team === 1)!;
  source.visible[1].fill(0);
  own.hp -= 100;
  socket.receive({ type: "snapshot", snapshot: snapshotFor(source, 1) });
  assert.equal(updates, 1);
  assert.equal(game.entities, entities);
  assert.deepEqual([...game.entities.keys()], [own.id]);
  assert.equal(game.entities.get(own.id)!.hp, own.hp);
  for (let team = 0; team < 4; team++) {
    assert.equal(game.visible[team], visible[team]);
    assert.equal(game.explored[team], explored[team]);
    assert.ok(game.visible[team].every((value) => value === 0));
  }
  assert.ok(game.explored[1].every((value) => value === 1));
  source.explored[1].fill(0);
  match();
  assert.notEqual(games[1], game);
  assert.notEqual(games[1].entities, entities);
  assert.notEqual(games[1].visible[1], visible[1]);
  assert.ok(games[1].explored[1].every((value) => value === 0));
  socket.receive({ type: "left" });
  socket.receive({ type: "snapshot", snapshot: snapshotFor(source, 1) });
  assert.equal(updates, 1, "Left matches no longer receive snapshot callbacks");
  match();
  socket.close();
  assert.equal(closes, 1);
  assert.equal(client.connected, false);
  assert.equal(client.room, null);
});
