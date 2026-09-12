import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startServer, snapshotFor } from "../server/server";
import { planWallLine } from "../src/simulation";
import type { ClientMessage, ServerMessage } from "../src/protocol";

async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
  const messages: ServerMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  async function next<T extends ServerMessage["type"]>(type: T) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const index = messages.findIndex((message) => message.type === type);
      if (index >= 0)
        return messages.splice(index, 1)[0] as Extract<
          ServerMessage,
          { type: T }
        >;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type}`);
  }
  const welcome = await next("welcome");
  return {
    ws,
    id: welcome.clientId,
    next,
    send: (message: ClientMessage) => ws.send(JSON.stringify(message)),
    clear: () => {
      messages.length = 0;
    },
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check());
}

test("real websocket lobby, authority, fog, disconnect takeover and cleanup", async (t) => {
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  t.after(() => server.close());
  const host = await client(server.port),
    guest = await client(server.port);
  host.send({ type: "create", name: "Host", seed: "network-test" });
  const { room } = await host.next("lobby");
  for (const [slot, controller] of [
    [1, "human"],
    [2, "ai"],
    [3, "ai"],
  ] as const) {
    host.send({ type: "configure", slot, controller });
    await host.next("lobby");
  }
  guest.send({ type: "join", code: room.code, name: "Guest" });
  await guest.next("lobby");
  guest.send({ type: "start" });
  assert.match((await guest.next("error")).message, /host/);
  host.send({ type: "start" });
  assert.match((await host.next("error")).message, /ready/);
  host.send({ type: "ready", ready: true });
  guest.send({ type: "ready", ready: true });
  await until(() =>
    server
      .inspectRoom(room.code)!
      .lobby.slots.slice(0, 2)
      .every((slot) => slot.ready),
  );
  host.send({ type: "start" });
  const match = await host.next("match");
  await guest.next("match");
  assert.equal(
    match.room.slots.filter((slot) => slot.controller !== "closed").length,
    4,
  );
  const game = server.inspectRoom(room.code)!.game!;
  const own = [...game.entities.values()].find((e) => e.team === 0)!;
  const enemy = [...game.entities.values()].find((e) => e.team === 1)!;
  host.send({ type: "command", command: { type: "stop", ids: [enemy.id] } });
  assert.match((await host.next("error")).message, /own/);
  host.send({
    type: "command",
    command: {
      type: "order",
      ids: [own.id],
      order: { type: "attack", target: enemy.id },
    },
  });
  assert.match((await host.next("error")).message, /unavailable/);
  const destination = game.world.cells[own.cell].neighbors.find(
    (id) => game.world.cells[id].passable,
  )!;
  host.send({
    type: "command",
    command: {
      type: "order",
      ids: [own.id],
      order: { type: "move", cell: destination },
    },
  });
  await until(() => own.orders.length > 0 || own.cell === destination);
  const hidden = snapshotFor(game, 0);
  assert.ok(!hidden.entities.some((e) => e.id === enemy.id));
  assert.equal(hidden.players[1].metal, 0);
  game.visible[0][enemy.cell] = 1;
  enemy.orders = [{ type: "move", cell: destination }];
  enemy.queue = ["tank"];
  enemy.rally = destination;
  const exposed = snapshotFor(game, 0).entities.find((e) => e.id === enemy.id)!;
  assert.deepEqual(exposed.orders, []);
  assert.deepEqual(exposed.queue, []);
  assert.deepEqual(exposed.path, []);
  assert.equal(exposed.rally, null);
  host.ws.send(
    JSON.stringify({
      type: "command",
      command: {
        type: "order",
        ids: [own.id],
        order: { type: "move", cell: -1 },
      },
    }),
  );
  assert.match((await host.next("error")).message, /Invalid command/);
  host.send({
    type: "command",
    command: {
      type: "wallLine",
      builderId: enemy.id,
      startCell: destination,
      endCell: destination,
    },
  });
  assert.match((await host.next("error")).message, /own/);
  host.ws.send(
    JSON.stringify({
      type: "command",
      command: {
        type: "wallLine",
        builderId: own.id,
        startCell: -1,
        endCell: destination,
      },
    }),
  );
  assert.match((await host.next("error")).message, /Invalid command/);
  own.orders = [];
  own.path = [];
  const wallCell = game.world.cells.find(
    (c) => planWallLine(game, own.id, c.id, c.id).valid,
  )!;
  assert.ok(wallCell);
  host.send({
    type: "command",
    command: {
      type: "wallLine",
      builderId: own.id,
      startCell: wallCell.id,
      endCell: wallCell.id,
    },
  });
  await until(
    () =>
      own.orders.some((o) => o.type === "build" && o.kind === "wall") ||
      [...game.entities.values()].some(
        (e) => e.kind === "wall" && e.cell === wallCell.id,
      ),
  );
  assert.ok(
    !snapshotFor(game, 1).entities.some((e) =>
      e.orders.some((o) => o.type === "build" && o.kind === "wall"),
    ),
    "other players cannot see wall plans",
  );
  guest.ws.close();
  await until(() => game.players[1].controller === "ai");
  assert.equal(server.inspectRoom(room.code)!.lobby.slots[1].connected, false);
  host.ws.close();
  await until(() => server.roomCount() === 0);
});

test("four humans fill room, fifth rejected, occupied slots protected and readiness reset", async (t) => {
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  t.after(() => server.close());
  const clients = await Promise.all(
    Array.from({ length: 5 }, () => client(server.port)),
  );
  const host = clients[0];
  host.send({ type: "create", name: "<Host>", seed: "four" });
  const { room } = await host.next("lobby");
  assert.equal(room.slots[0].name, "Host");
  for (const slot of [1, 2, 3] as const) {
    host.send({ type: "configure", slot, controller: "human" });
    await host.next("lobby");
  }
  for (const guest of clients.slice(1, 4)) {
    guest.send({ type: "join", code: room.code, name: "Guest" });
    await guest.next("lobby");
  }
  clients[4].send({ type: "join", code: room.code, name: "Fifth" });
  assert.match((await clients[4].next("error")).message, /full/);
  host.send({ type: "configure", slot: 1, controller: "ai" });
  assert.match((await host.next("error")).message, /occupied/);
  host.send({ type: "ready", ready: true });
  await until(() => server.inspectRoom(room.code)!.lobby.slots[0].ready);
  host.send({ type: "seed", seed: "changed" });
  await until(() => !server.inspectRoom(room.code)!.lobby.slots[0].ready);
  for (const peer of clients.slice(0, 4))
    peer.send({ type: "ready", ready: true });
  await until(() =>
    server.inspectRoom(room.code)!.lobby.slots.every((slot) => slot.ready),
  );
  host.send({ type: "start" });
  const match = await host.next("match");
  assert.equal(match.snapshot.players.length, 4);
  clients[4].send({ type: "join", code: room.code, name: "Late" });
  assert.match((await clients[4].next("error")).message, /progress/);
});

test("host transfer, final result and host-only return to lobby", async (t) => {
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  t.after(() => server.close());
  const host = await client(server.port),
    guest = await client(server.port);
  host.send({ type: "create", name: "First", seed: "transfer" });
  const { room } = await host.next("lobby");
  host.send({ type: "configure", slot: 1, controller: "human" });
  await host.next("lobby");
  guest.send({ type: "join", code: room.code, name: "Next" });
  await guest.next("lobby");
  host.send({ type: "ready", ready: true });
  guest.send({ type: "ready", ready: true });
  await until(() =>
    server
      .inspectRoom(room.code)!
      .lobby.slots.slice(0, 2)
      .every((slot) => slot.ready),
  );
  host.send({ type: "start" });
  await host.next("match");
  await guest.next("match");
  host.ws.close();
  await until(() => server.inspectRoom(room.code)!.lobby.hostId === guest.id);
  const game = server.inspectRoom(room.code)!.game!;
  const commander = [...game.entities.values()].find(
    (e) => e.team === 0 && e.kind === "commander",
  )!;
  commander.hp = 0;
  await until(() => server.inspectRoom(room.code)!.lobby.phase === "finished");
  assert.equal(game.winner, 1);
  guest.send({ type: "returnLobby" });
  await until(() => server.inspectRoom(room.code)!.lobby.phase === "lobby");
  assert.equal(server.inspectRoom(room.code)!.game, undefined);
  assert.ok(
    server.inspectRoom(room.code)!.lobby.slots.every((slot) => !slot.ready),
  );
});
