import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startServer } from "../server/server.ts";

const server = await startServer({ port: 0, host: "127.0.0.1" });
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5175",
    "--strictPort",
  ],
  {
    stdio: "ignore",
    env: { ...process.env, GAME_SERVER_PORT: String(server.port) },
  },
);
const base = "http://127.0.0.1:5175";
let browser;
const errors = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
    ],
  });
  async function player(name, viewport = { width: 1280, height: 900 }) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => !!window.__IRON_ORBIT__);
    await page.click("#multiplayer-open");
    await page.fill("#player-name", name);
    return page;
  }
  async function waitFor(page, fn, arg) {
    await page.waitForFunction(fn, arg, { timeout: 45000 });
  }
  const host = await player("Atlas");
  await host.click("#room-create");
  await host.waitForSelector("#room-code");
  const code = await host.locator("#room-code").textContent();
  assert.equal(code.length, 6);
  await host.selectOption('select[data-slot="1"]', "human");
  await host.selectOption('select[data-slot="2"]', "ai");
  await host.selectOption('select[data-slot="3"]', "ai");
  const guest = await player("Nova");
  await guest.fill("#game-server", `http://127.0.0.1:${server.port}`);
  await guest.fill("#room-code-input", code);
  await guest.click("#room-join");
  await guest.waitForSelector("#room-ready");
  assert.equal(
    await guest.locator("#room-start").isVisible(),
    false,
    "Only host can start",
  );
  assert.equal(
    await host.locator("#room-start").isEnabled(),
    false,
    "All humans must ready first",
  );
  await host.click("#room-ready");
  await guest.click("#room-ready");
  await host.waitForFunction(
    () => !document.querySelector("#room-start").disabled,
  );
  await host.screenshot({ path: "test-results/multiplayer-lobby.png" });
  await host.click("#room-start");
  await waitFor(
    host,
    () =>
      window.__IRON_ORBIT__.multiplayer &&
      window.__IRON_ORBIT__.game.time > 0.2,
  );
  await waitFor(
    guest,
    () =>
      window.__IRON_ORBIT__.multiplayer &&
      window.__IRON_ORBIT__.localTeam === 1,
  );
  assert.equal(
    server.inspectRoom(code).game.players.filter((p) => p.controller === "ai")
      .length,
    2,
  );
  const guestId = await guest.evaluate(
    () =>
      [...window.__IRON_ORBIT__.game.entities.values()].find(
        (e) => e.team === 1 && e.kind === "commander",
      ).id,
  );
  assert.equal(
    await guest.evaluate(
      (id) => window.__IRON_ORBIT__.state.selected.has(id),
      guestId,
    ),
    true,
    "Guest commander initially selected",
  );
  await guest.waitForSelector("#match-roster strong");
  await guest.evaluate(() => {
    window.__rosterRows = [...document.querySelector("#match-roster").children];
  });
  await guest.waitForTimeout(400);
  assert.equal(
    await guest.evaluate(() =>
      [...document.querySelector("#match-roster").children].every(
        (row, i) => row === window.__rosterRows[i],
      ),
    ),
    true,
    "Snapshot and HUD updates retain existing roster rows",
  );

  // A non-host human issues a real pointer movement command, applied by the server.
  const target = await guest.evaluate(() => {
    const { game, scene, localTeam } = window.__IRON_ORBIT__;
    const commander = [...game.entities.values()].find(
      (e) => e.team === localTeam && e.kind === "commander",
    );
    for (const cell of game.world.cells) {
      const p = scene.project(cell.id),
        d = game.world.distance(commander.cell, cell.id);
      if (
        cell.passable &&
        d > 8 &&
        d < 14 &&
        p.visible &&
        p.x > 310 &&
        p.x < 970 &&
        p.y > 180 &&
        p.y < 560 &&
        scene.pick(p.x, p.y).cell === cell.id
      )
        return { ...p, cell: cell.id, from: commander.cell };
    }
  });
  assert.ok(target, "Guest has a selectable movement destination");
  await guest.mouse.click(target.x, target.y, { button: "right" });
  await waitFor(
    guest,
    (from) =>
      [...window.__IRON_ORBIT__.game.entities.values()].find(
        (e) => e.team === 1 && e.kind === "commander",
      ).cell !== from,
    target.from,
  );
  assert.notEqual(
    server.inspectRoom(code).game.entities.get(guestId).cell,
    target.from,
    "Movement happened on authority",
  );
  // Explicit forged ownership stays rejected even if a client guesses an enemy id.
  const hostCommander = [
    ...server.inspectRoom(code).game.entities.values(),
  ].find((e) => e.team === 0 && e.kind === "commander");
  const beforeOrders = structuredClone(hostCommander.orders);
  await guest.evaluate(
    ({ id, cell }) =>
      window.__IRON_ORBIT__.network.send({
        type: "command",
        command: { type: "order", ids: [id], order: { type: "move", cell } },
      }),
    { id: hostCommander.id, cell: target.cell },
  );
  await guest.waitForTimeout(250);
  assert.deepEqual(hostCommander.orders, beforeOrders);

  // Queue two distant construction orders, deselect, and verify ghosts survive.
  await guest.click("#focus-commander");
  const plans = await guest.evaluate(async () => {
    const { canPlace } = await import("/src/simulation.ts");
    const { game, scene, localTeam } = window.__IRON_ORBIT__;
    const commander = [...game.entities.values()].find(
      (e) => e.team === localTeam && e.kind === "commander",
    );
    return game.world.cells
      .filter(
        (c) =>
          canPlace(game, localTeam, "generator", c.id).valid &&
          game.world.distance(commander.cell, c.id) > 14,
      )
      .map((c) => ({ ...scene.project(c.id), cell: c.id }))
      .filter(
        (p) => p.visible && p.x > 310 && p.x < 970 && p.y > 180 && p.y < 565,
      )
      .slice(0, 2);
  });
  assert.equal(plans.length, 2);
  await guest.click('[data-kind="generator"]');
  await guest.keyboard.down("Shift");
  for (const p of plans) {
    await guest.mouse.move(p.x, p.y);
    await guest.mouse.click(p.x, p.y);
  }
  await guest.keyboard.up("Shift");
  await guest.keyboard.press("Escape");
  await waitFor(
    guest,
    () => window.__IRON_ORBIT__.scene.diagnostics().buildPlans >= 1,
  );
  await guest.mouse.click(1020, 580);
  await waitFor(
    guest,
    () =>
      window.__IRON_ORBIT__.state.selected.size === 0 &&
      window.__IRON_ORBIT__.scene.diagnostics().buildPlans >= 1,
  );
  await guest.screenshot({ path: "test-results/construction-orders.png" });
  await guest.click("#focus-commander");
  await guest.keyboard.press("x");
  await waitFor(
    guest,
    () => window.__IRON_ORBIT__.scene.diagnostics().buildPlans === 0,
  );

  console.log(
    "Verified mixed room, guest authority, persistent construction plans.",
  );
  // Music is gesture-unlocked; separate volumes and master mute persist.
  await guest.click("#sound");
  await guest.waitForSelector("#audio-panel");
  await guest.locator("#music-volume").evaluate((el) => {
    el.value = "37";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await guest.locator("#sfx-volume").evaluate((el) => {
    el.value = "58";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await waitFor(
    guest,
    () => window.__IRON_ORBIT__.audio.diagnostics().musicPlaying,
  );
  assert.equal(
    await guest.evaluate(() => window.__IRON_ORBIT__.audio.getSettings().music),
    0.37,
  );
  await guest.click("#audio-mute");
  assert.equal(
    await guest.evaluate(() => window.__IRON_ORBIT__.audio.diagnostics().muted),
    true,
  );
  assert.equal(
    await guest.evaluate(
      () => JSON.parse(localStorage.getItem("iron-orbit-audio")).sfx,
    ),
    0.58,
  );
  await guest.click("#audio-mute");
  await guest.click("#sound");
  await guest.click("#pause");
  const time = await guest.evaluate(() => window.__IRON_ORBIT__.game.time);
  await waitFor(
    guest,
    (before) => window.__IRON_ORBIT__.game.time > before + 0.2,
    time,
  );
  assert.equal(
    await guest.evaluate(() => window.__IRON_ORBIT__.game.paused),
    false,
    "Online menu never pauses the shared game",
  );
  await guest.click('[data-modal="resume"]');

  console.log("Verified music controls and online menu.");
  // Elimination does not end a four-side battle; final outcome synchronizes.
  for (const entity of server.inspectRoom(code).game.entities.values())
    if (entity.team === 2 && entity.kind === "commander") entity.hp = 0;
  await waitFor(host, () => window.__IRON_ORBIT__.game.players[2].eliminated);
  assert.equal(server.inspectRoom(code).game.finished, false);
  for (const entity of server.inspectRoom(code).game.entities.values())
    if ((entity.team === 0 || entity.team === 3) && entity.kind === "commander")
      entity.hp = 0;
  await waitFor(
    guest,
    () =>
      window.__IRON_ORBIT__.game.finished &&
      window.__IRON_ORBIT__.game.winner === 1,
  );
  await host.waitForSelector('[data-modal="lobby"]');
  // Regression: finished-room host departure refreshes the new host's action.
  await host.click('[data-modal="menu"]');
  await guest.waitForSelector('[data-modal="lobby"]');
  await guest.click('[data-modal="lobby"]');
  await guest.waitForSelector("#room-ready");
  assert.equal(await guest.locator("#room-start").isVisible(), true);
  await guest.click("#lobby-close");

  console.log("Verified elimination, finished host transfer, and rematch.");
  // Four real browser clients can occupy and start all four human slots.
  await host.setViewportSize({ width: 960, height: 720 });
  await guest.setViewportSize({ width: 960, height: 720 });
  await host.click("#multiplayer-open");
  await host.click("#room-create");
  await host.waitForSelector("#room-code");
  const allHumanCode = await host.locator("#room-code").textContent();
  for (const slot of [1, 2, 3])
    await host.selectOption(`select[data-slot="${slot}"]`, "human");
  await guest.click("#multiplayer-open");
  await guest.fill("#room-code-input", allHumanCode);
  await guest.click("#room-join");
  await guest.waitForSelector("#room-ready");
  console.log("Joined first two humans in fresh room.");
  const third = await player("Orion", { width: 800, height: 650 }),
    fourth = await player("Vega", { width: 800, height: 650 });
  for (const page of [third, fourth]) {
    await page.fill("#room-code-input", allHumanCode);
    await page.click("#room-join");
    await page.waitForSelector("#room-ready");
  }
  console.log("Four humans joined.");
  for (const page of [host, guest, third, fourth])
    await page.click("#room-ready");
  await host.waitForFunction(
    () => !document.querySelector("#room-start").disabled,
  );
  await host.click("#room-start");
  for (const [team, page] of [host, guest, third, fourth].entries()) {
    await waitFor(
      page,
      (expected) =>
        window.__IRON_ORBIT__.multiplayer &&
        window.__IRON_ORBIT__.localTeam === expected &&
        window.__IRON_ORBIT__.game.players.filter(
          (p) => p.controller === "human",
        ).length === 4,
      team,
    );
  }
  console.log("Four human match started.");
  await fourth.close();
  await waitFor(
    host,
    () => window.__IRON_ORBIT__.game.players[3].controller === "ai",
  );
  assert.equal(
    server.inspectRoom(allHumanCode).game.players[3].controller,
    "ai",
  );
  for (const page of [host, guest, third]) await page.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    server.roomCount(),
    0,
    "Rooms clean up after their last human leaves",
  );
  assert.deepEqual(errors, [], "No client runtime errors");
  console.log(
    "Multiplayer browser acceptance passed: mixed lobby, four human clients, guest movement, authority, persistent build plans, music/volume/mute, online menu, elimination, host transfer/rematch, AI takeover, cleanup.",
  );
} catch (error) {
  console.error("MULTIPLAYER BROWSER FAILURE", error);
  throw error;
} finally {
  console.log("Closing browser test resources");
  await browser?.close();
  vite.kill();
  await server.close();
}
