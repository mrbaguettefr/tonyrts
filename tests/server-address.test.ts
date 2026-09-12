import test from "node:test";
import assert from "node:assert/strict";
import { resolveGameServer } from "../src/server-address";

test("same-origin play and remote multiplayer addresses resolve to WebSockets", () => {
  assert.equal(
    resolveGameServer("", "http://localhost:5173"),
    "ws://localhost:5173/multiplayer",
  );
  assert.equal(
    resolveGameServer("https://game.example", "https://name.github.io"),
    "wss://game.example/multiplayer",
  );
  assert.equal(
    resolveGameServer(
      "wss://game.example/multiplayer",
      "https://name.github.io",
    ),
    "wss://game.example/multiplayer",
  );
});
test("static hosting requires a real server, and unsafe or mixed-content addresses reject", () => {
  assert.throws(
    () => resolveGameServer("", "https://name.github.io"),
    /client only/,
  );
  assert.throws(
    () => resolveGameServer("ws://game.example", "https://name.github.io"),
    /secure page/,
  );
  assert.throws(
    () => resolveGameServer("javascript:alert(1)", "http://localhost"),
    /game server address/,
  );
  assert.throws(
    () =>
      resolveGameServer(
        "https://name:password@game.example",
        "https://name.github.io",
      ),
    /username or password/,
  );
});
