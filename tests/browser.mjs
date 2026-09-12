import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:5174";
const server = process.env.BASE_URL
  ? null
  : spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        "5174",
      ],
      { stdio: "ignore" },
    );
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => !!window.__IRON_ORBIT__);
  await page.screenshot({ path: "test-results/launch.png" });
  await page.click("#deploy");
  await page.waitForFunction(() => window.__IRON_ORBIT__.game.time > 0.2);
  assert.equal(await page.locator("#launch").isVisible(), false);
  assert.equal(await page.locator(".build-card").count(), 4);

  // Pointer-driven movement, with camera keys preserving the order.
  const moveTarget = await page.evaluate(() => {
    const { game, scene } = window.__IRON_ORBIT__;
    const c = [...game.entities.values()].find(
      (e) => e.team === 0 && e.kind === "commander",
    );
    for (const cell of game.world.cells) {
      const p = scene.project(cell.id);
      if (
        cell.passable &&
        game.world.distance(c.cell, cell.id) > 9 &&
        game.world.distance(c.cell, cell.id) < 15 &&
        p.visible &&
        p.x > 320 &&
        p.x < 1080 &&
        p.y > 200 &&
        p.y < 570
      )
        return { ...p, cell: cell.id, from: c.cell };
    }
  });
  assert.ok(moveTarget, "A reachable on-screen movement target exists");
  await page.mouse.click(moveTarget.x, moveTarget.y, { button: "right" });
  await page.keyboard.press("s");
  assert.ok(
    await page.evaluate(
      () =>
        [...window.__IRON_ORBIT__.game.entities.values()].find(
          (e) => e.team === 0 && e.kind === "commander",
        ).orders.length,
    ),
    "Camera S does not stop units",
  );
  await page.evaluate(() => {
    for (let i = 0; i < 160; i++) window.__IRON_ORBIT__.tick(0.05);
  });
  assert.notEqual(
    await page.evaluate(
      () =>
        [...window.__IRON_ORBIT__.game.entities.values()].find(
          (e) => e.team === 0 && e.kind === "commander",
        ).cell,
    ),
    moveTarget.from,
  );
  await page.click("#focus-commander");

  // Build the complete economic chain through the actual HUD and terrain picker.
  for (const kind of ["extractor", "generator", "factory"]) {
    const target = await page.evaluate(async (kind) => {
      const { canPlace } = await import("/src/simulation.ts");
      const { game, scene } = window.__IRON_ORBIT__;
      const c = [...game.entities.values()].find(
        (e) => e.team === 0 && e.kind === "commander",
      );
      const candidates = game.world.cells
        .filter((cell) => canPlace(game, 0, kind, cell.id).valid)
        .sort(
          (a, b) =>
            game.world.distance(c.cell, a.id) -
            game.world.distance(c.cell, b.id),
        );
      for (const cell of candidates) {
        const p = scene.project(cell.id);
        if (
          p.visible &&
          p.x > 300 &&
          p.x < 1130 &&
          p.y > 185 &&
          p.y < 585 &&
          scene.pick(p.x, p.y).cell === cell.id
        )
          return { ...p, cell: cell.id };
      }
    }, kind);
    assert.ok(target, `Valid on-screen ${kind} location exists`);
    await page.click(`[data-kind="${kind}"]`);
    await page.mouse.move(target.x, target.y);
    await page.mouse.click(target.x, target.y);
    if (kind === "generator") {
      await page.evaluate(() => {
        for (let i = 0; i < 40; i++) window.__IRON_ORBIT__.tick(0.05);
      });
      await page.keyboard.press("x");
      await page.waitForTimeout(100);
      const unfinished = await page.evaluate(() => {
        const { game, scene } = window.__IRON_ORBIT__;
        const e = [...game.entities.values()].find(
          (e) => e.team === 0 && e.kind === "generator",
        );
        if (!e || e.progress >= 1) return null;
        const p = scene.project(e.cell);
        for (let dy = -25; dy <= 20; dy += 2)
          for (let dx = -20; dx <= 20; dx += 2)
            if (scene.pick(p.x + dx, p.y + dy).entity === e.id)
              return { x: p.x + dx, y: p.y + dy };
      });
      assert.ok(unfinished, "Interrupted construction remains selectable");
      await page.mouse.click(unfinished.x, unfinished.y, { button: "right" });
      assert.ok(
        await page.evaluate(() =>
          [...window.__IRON_ORBIT__.game.entities.values()]
            .find((e) => e.kind === "commander" && e.team === 0)
            .orders.some((o) => o.type === "build"),
        ),
        "Right click resumes unfinished construction",
      );
    }
    await page.evaluate(() => {
      for (let i = 0; i < 700; i++) window.__IRON_ORBIT__.tick(0.05);
    });
    assert.ok(
      await page.evaluate(
        (kind) =>
          [...window.__IRON_ORBIT__.game.entities.values()].some(
            (e) => e.team === 0 && e.kind === kind && e.progress === 1,
          ),
        kind,
      ),
      `${kind} completes`,
    );
  }
  const factory = await page.evaluate(() => {
    const { game, scene } = window.__IRON_ORBIT__;
    const e = [...game.entities.values()].find(
      (e) => e.team === 0 && e.kind === "factory",
    );
    scene.focus(e.cell);
    return { id: e.id, cell: e.cell };
  });
  await page.waitForTimeout(120);
  const factoryPoint = await page.evaluate(
    (cell) => window.__IRON_ORBIT__.scene.project(cell),
    factory.cell,
  );
  // Click the model above its terrain anchor, searching its visible footprint.
  const factoryHit = await page.evaluate(
    ({ x, y, id }) => {
      for (let dy = -32; dy <= 20; dy += 2)
        for (let dx = -25; dx <= 25; dx += 2)
          if (window.__IRON_ORBIT__.scene.pick(x + dx, y + dy).entity === id)
            return { x: x + dx, y: y + dy };
    },
    { ...factoryPoint, id: factory.id },
  );
  assert.ok(factoryHit, "Factory can be selected through terrain-safe picking");
  await page.mouse.click(factoryHit.x, factoryHit.y);
  await page.waitForSelector('[data-kind="tank"]');
  await page.click('[data-kind="tank"]');
  await page.evaluate(() => {
    for (let i = 0; i < 400; i++) window.__IRON_ORBIT__.tick(0.05);
  });
  assert.ok(
    await page.evaluate(() =>
      [...window.__IRON_ORBIT__.game.entities.values()].some(
        (e) => e.team === 0 && e.kind === "tank",
      ),
    ),
    "Factory produces a tank",
  );
  await page.screenshot({ path: "test-results/battlefield.png" });

  // Pause, help, control groups, fog occlusion, and a clean restart.
  await page.click("#pause");
  const pausedTime = await page.evaluate(() => window.__IRON_ORBIT__.game.time);
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.game.time),
    pausedTime,
  );
  await page.click('[data-modal="resume"]');
  await page.click("#help");
  assert.equal(await page.locator(".controls-list").isVisible(), true);
  await page.click('[data-modal="resume"]');
  await page.click("#focus-commander");
  await page.keyboard.press("Control+1");
  await page.keyboard.press("1");
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.state.selected.size),
    1,
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const { game, scene } = window.__IRON_ORBIT__;
      const enemy = [...game.entities.values()].find(
        (e) => e.team === 1 && e.kind === "commander",
      );
      const probe = { ...enemy, id: 90000, team: 0 };
      game.entities.set(probe.id, probe);
      const throughPlanet = scene
        .selectRect(0, 0, innerWidth, innerHeight)
        .includes(probe.id);
      game.entities.delete(probe.id);
      return { throughPlanet, hidden: !game.visible[0][enemy.cell] };
    }),
    { throughPlanet: false, hidden: true },
    "A friendly unit behind the planet cannot be box-selected",
  );
  await page.evaluate(() => {
    const { game, scene } = window.__IRON_ORBIT__;
    const enemy = [...game.entities.values()].find(
      (e) => e.team === 1 && e.kind === "commander",
    );
    scene.focus(enemy.cell);
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => {
      const { game, scene } = window.__IRON_ORBIT__;
      const enemy = [...game.entities.values()].find(
        (e) => e.team === 1 && e.kind === "commander",
      );
      const p = scene.project(enemy.cell);
      for (let y = -30; y <= 30; y += 5)
        for (let x = -30; x <= 30; x += 5)
          if (scene.pick(p.x + x, p.y + y).entity === enemy.id) return true;
      return false;
    }),
    false,
    "Hidden enemy cannot be picked even when its hemisphere faces the camera",
  );
  await page.click("#focus-commander");
  await page.keyboard.press("m");
  await page.click("#pause");
  await page.click('[data-modal="menu"]');
  await page.fill("#seed-input", "BROWSER-RESTART");
  await page.click("#deploy");
  assert.equal(await page.locator("#mode-hint").isVisible(), false);
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.game.world.seed),
    "BROWSER-RESTART",
  );
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.state.building),
    null,
  );

  // Advance a real autonomous match to defeat and exercise the replay flow.
  const ending = await page.evaluate(() => {
    const api = window.__IRON_ORBIT__;
    for (let i = 0; i < 18000 && api.game.winner === null; i++) api.tick(0.05);
    return { winner: api.game.winner, time: api.game.time };
  });
  assert.equal(ending.winner, 1, "AI can finish a real match");
  await page.waitForSelector('[data-modal="replay"]');
  await page.click('[data-modal="replay"]');
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.game.winner),
    null,
  );
  assert.ok((await page.evaluate(() => window.__IRON_ORBIT__.game.time)) < 2);
  console.log(
    "Browser acceptance passed: launch, movement, construction, production, pause, help, groups, occlusion, restart, defeat, replay.",
    ending,
  );

  if (process.argv.includes("--benchmark")) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(async () => {
      const { SPECS, issueOrder } = await import("/src/simulation.ts");
      const { game, scene, state } = window.__IRON_ORBIT__;
      const sample = [...game.entities.values()][0];
      // Keep the stress battle alive without invalid health-to-maximum ratios.
      for (const kind of ["commander", "heavy", "tank"]) SPECS[kind].hp = 1e9;
      game.entities.clear();
      const origin = game.world.spawns[0];
      const cells = game.world.cells
        .filter((c) => c.passable && game.world.distance(origin, c.id) < 65)
        .sort(
          (a, b) =>
            game.world.distance(origin, a.id) -
            game.world.distance(origin, b.id),
        );
      for (let i = 0; i < 200; i++) {
        const cell = cells[i].id,
          team = i % 2;
        const kind = i < 2 ? "commander" : i % 5 === 0 ? "heavy" : "tank";
        const e = {
          ...sample,
          id: 10000 + i,
          team,
          kind,
          hp: 1e9,
          position: [...game.world.cells[cell].position],
          cell,
          heading: [1, 0, 0],
          orders: [],
          path: [],
          queue: [],
          cooldown: 0,
        };
        game.entities.set(e.id, e);
        if (team === 0) state.selected.add(e.id);
        const to = cells[(i + 100) % cells.length].id;
        issueOrder(game, [e.id], { type: "attackMove", cell: to });
      }
      for (const id of state.selected)
        if (!game.entities.has(id)) state.selected.delete(id);
      scene.focus(origin);
      scene.zoom(260);
      game.paused = false;
    });
    await page.waitForTimeout(2000);
    const stats = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const frames = [];
          let previous = performance.now();
          function sample(now) {
            frames.push(now - previous);
            previous = now;
            if (frames.length < 180) requestAnimationFrame(sample);
            else {
              frames.sort((a, b) => a - b);
              const { game, scene, state } = window.__IRON_ORBIT__;
              resolve({
                fps: +(
                  1000 /
                  (frames.reduce((a, b) => a + b, 0) / frames.length)
                ).toFixed(1),
                medianMs: +frames[90].toFixed(1),
                p95Ms: +frames[171].toFixed(1),
                ...scene.diagnostics(),
                entities: game.entities.size,
                selected: state.selected.size,
                shots: game.shots.length,
                resolution: `${innerWidth}x${innerHeight}`,
                renderer: "Headless Chromium / environment GPU backend",
              });
            }
          }
          requestAnimationFrame(sample);
        }),
    );
    await page.screenshot({ path: "test-results/benchmark.png" });
    console.log("200-unit benchmark:", JSON.stringify(stats));
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
} finally {
  await browser?.close();
  server?.kill();
}
