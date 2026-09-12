import assert from "node:assert/strict";

async function hitPoint(page, id) {
  const point = await page.evaluate((id) => {
    const { game, scene } = window.__IRON_ORBIT__,
      e = game.entities.get(id),
      p = scene.project(e.cell);
    for (let y = -35; y <= 10; y += 3)
      for (let x = -25; x <= 25; x += 3)
        if (scene.pick(p.x + x, p.y + y).entity === id)
          return { x: p.x + x, y: p.y + y };
    return null;
  }, id);
  assert.ok(point, `Unit ${id} has a terrain-safe pointer hit`);
  return point;
}
export async function runBattlefieldChecks(page) {
  await page.evaluate(() =>
    window.__IRON_ORBIT__.deploy("BATTLEFIELD-BROWSER"),
  );
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".mission-panel, .planet-panel").count(), 0);
  const fixture = await page.evaluate(async () => {
    const { SPECS } = await import("/src/simulation.ts");
    const { game, scene, state } = window.__IRON_ORBIT__;
    game.players.forEach((p) => (p.controller = "human"));
    const commander = [...game.entities.values()].find((e) => e.team === 0);
    game.entities.clear();
    game.entities.set(commander.id, commander);
    const cells = game.world.cells.filter((c) => {
      const p = scene.project(c.id),
        d = game.world.distance(c.id, commander.cell);
      return (
        c.passable &&
        d > 5 &&
        d < 18 &&
        p.visible &&
        p.x > 340 &&
        p.x < 1050 &&
        p.y > 180 &&
        p.y < 600
      );
    });
    const used = [];
    function add(id, kind, team, cell) {
      const e = {
        ...commander,
        id,
        kind,
        team,
        cell,
        position: [...game.world.cells[cell].position],
        hp: SPECS[kind].hp,
        orders: [],
        path: [],
        queue: [],
        cooldown: 100000,
      };
      game.entities.set(id, e);
      return e;
    }
    const local = cells
      .filter((c) => {
        if (used.every((n) => game.world.distance(c.id, n) > 5)) {
          used.push(c.id);
          return true;
        }
        return false;
      })
      .slice(0, 5);
    if (local.length < 5)
      throw new Error("Need five separated on-screen fixture cells");
    add(81001, "tank", 0, local[0].id);
    add(81002, "tank", 0, local[1].id);
    add(81003, "heavy", 0, local[2].id);
    add(81004, "generator", 0, local[3].id);
    add(81005, "generator", 0, local[4].id);
    add(81006, "tank", 0, game.world.spawns[1]);
    const enemyCell = cells.find((c) =>
      used.every((n) => game.world.distance(c.id, n) > 3),
    );
    if (enemyCell) add(81008, "tank", 1, enemyCell.id);
    const outside = game.world.cells.find(
      (c) =>
        c.passable &&
        !scene.project(c.id).visible &&
        game.world.distance(c.id, commander.cell) < 60,
    );
    if (outside) add(81007, "tank", 0, outside.id);
    state.selected = new Set([commander.id]);
    scene.render(game, state, 0);
    return {
      commander: commander.id,
      tanks: [81001, 81002],
      heavy: 81003,
      building: 81004,
    };
  });
  await page.waitForTimeout(200);
  const p = await hitPoint(page, fixture.tanks[0]);
  await page.mouse.dblclick(p.x, p.y, { delay: 70 });
  assert.deepEqual(
    await page.evaluate(() => [...window.__IRON_ORBIT__.state.selected].sort()),
    fixture.tanks,
  );
  await page.waitForTimeout(350);
  await page.evaluate(
    (id) => (window.__IRON_ORBIT__.state.selected = new Set([id])),
    fixture.commander,
  );
  await page.keyboard.down("Shift");
  await page.mouse.dblclick(p.x, p.y, { delay: 70 });
  await page.keyboard.up("Shift");
  assert.deepEqual(
    await page.evaluate(() =>
      [...window.__IRON_ORBIT__.state.selected].sort((a, b) => a - b),
    ),
    [fixture.commander, ...fixture.tanks].sort((a, b) => a - b),
  );
  const building = await hitPoint(page, fixture.building);
  await page.mouse.dblclick(building.x, building.y, { delay: 70 });
  assert.deepEqual(
    await page.evaluate(() => [...window.__IRON_ORBIT__.state.selected]),
    [fixture.building],
  );
  await page.evaluate(
    (id) => (window.__IRON_ORBIT__.state.selected = new Set([id])),
    fixture.commander,
  );
  await page.keyboard.press("m");
  await page.mouse.dblclick(p.x, p.y, { delay: 70 });
  assert.ok(
    (await page.evaluate(() => window.__IRON_ORBIT__.state.selected.size)) < 2,
    "command mode does not mass-select",
  );
  await page.keyboard.press("Escape");
  if (await page.locator('[data-modal="resume"]').isVisible())
    await page.click('[data-modal="resume"]');
  await page.evaluate(() => {
    const api = window.__IRON_ORBIT__,
      { game, state, scene } = api;
    game.entities.get(81003).hp = 150;
    game.entities.get(81001).hp = 100;
    [...game.entities.values()].forEach((e) => {
      e.orders = [];
      e.path = [];
    });
    game.paused = true;
    state.selected = new Set([81001, 81002, 81003]);
    for (let i = 0; i < 25; i++) {
      game.time += 0.05;
      scene.render(game, state, 0);
    }
  });
  assert.ok(
    await page.evaluate(
      () => window.__IRON_ORBIT__.scene.diagnostics().smoke > 0,
    ),
  );
  await page.screenshot({ path: "test-results/heavy-tank-and-smoke.png" });

  // Real pointer drag submits one shared wall command and a private construction queue.
  await page.evaluate(() => window.__IRON_ORBIT__.deploy("BATTLEFIELD-WALLS"));
  await page.waitForTimeout(200);
  const line = await page.evaluate(async () => {
    const { planWallLine } = await import("/src/simulation.ts");
    const { game, scene } = window.__IRON_ORBIT__;
    game.players.forEach((p) => (p.controller = "human"));
    const builder = [...game.entities.values()].find((e) => e.team === 0);
    const cells = game.world.cells.filter((c) => {
      const p = scene.project(c.id);
      return (
        game.visible[0][c.id] &&
        p.visible &&
        p.x > 320 &&
        p.x < 1100 &&
        p.y > 150 &&
        p.y < 590
      );
    });
    for (const a of cells)
      for (const b of cells) {
        const plan = planWallLine(game, builder.id, a.id, b.id);
        if (plan.valid && plan.cells.length === 3)
          return {
            start: scene.project(a.id),
            end: scene.project(b.id),
            cells: plan.cells,
            builder: builder.id,
          };
      }
    throw new Error("No visible wall line fixture");
  });
  await page.keyboard.press("y");
  await page.mouse.move(line.start.x, line.start.y);
  await page.mouse.down();
  await page.mouse.move(line.end.x, line.end.y, { steps: 8 });
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.state.wallPreview?.valid),
    true,
  );
  assert.match(
    await page.locator("#mode-hint").textContent(),
    /75 METAL \/ 30 ENERGY/,
  );
  await page.screenshot({ path: "test-results/wall-line-preview.png" });
  await page.mouse.up();
  await page.waitForFunction(({ cells, builder }) => {
    const { game } = window.__IRON_ORBIT__,
      e = game.entities.get(builder);
    return cells.every(
      (cell) =>
        e.orders.some(
          (o) => o.type === "build" && o.kind === "wall" && o.cell === cell,
        ) ||
        [...game.entities.values()].some(
          (e) => e.kind === "wall" && e.cell === cell,
        ),
    );
  }, line);
  await page.evaluate(() => {
    const api = window.__IRON_ORBIT__;
    for (let i = 0; i < 1000; i++) api.tick(0.05);
  });
  assert.equal(
    await page.evaluate(
      (cells) =>
        [...window.__IRON_ORBIT__.game.entities.values()].filter(
          (e) =>
            e.kind === "wall" && e.progress === 1 && cells.includes(e.cell),
        ).length,
      line.cells,
    ),
    3,
  );
  await page.screenshot({ path: "test-results/walls-built.png" });
  // An invalid drag changes neither the current queue nor existing structures.
  const own = await page.evaluate(
    (id) =>
      window.__IRON_ORBIT__.scene.project(
        window.__IRON_ORBIT__.game.entities.get(id).cell,
      ),
    line.builder,
  );
  await page.keyboard.press("y");
  await page.mouse.move(own.x, own.y);
  await page.mouse.down();
  await page.mouse.move(line.end.x, line.end.y, { steps: 5 });
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.state.wallPreview.valid),
    false,
  );
  const before = await page.evaluate(
    (id) => JSON.stringify(window.__IRON_ORBIT__.game.entities.get(id).orders),
    line.builder,
  );
  await page.mouse.up();
  assert.equal(
    await page.evaluate(
      (id) =>
        JSON.stringify(window.__IRON_ORBIT__.game.entities.get(id).orders),
      line.builder,
    ),
    before,
  );
  await page.keyboard.press("Escape");
  const selectionBeforeCancel = await page.evaluate(() => [
    ...window.__IRON_ORBIT__.state.selected,
  ]);
  await page.keyboard.press("y");
  await page.mouse.move(line.start.x, line.start.y);
  await page.mouse.down();
  await page.mouse.move(line.end.x, line.end.y, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(
    await page.evaluate(() => [...window.__IRON_ORBIT__.state.selected]),
    selectionBeforeCancel,
  );
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.state.wallPreview),
    null,
  );
  // Ghosts remain visual-only, even after their hidden live entity is destroyed.
  const ghost = await page.evaluate(async () => {
    const { SPECS } = await import("/src/simulation.ts");
    const api = window.__IRON_ORBIT__,
      { game, scene, state } = api;
    game.paused = true;
    const template = [...game.entities.values()].find(
      (e) => e.team === 0 && e.kind === "commander",
    );
    const cell = game.world.cells.find((c) => {
      const p = scene.project(c.id);
      return (
        c.passable &&
        p.visible &&
        game.world.distance(template.cell, c.id) > 9 &&
        game.world.distance(template.cell, c.id) < 17 &&
        ![...game.entities.values()].some((e) => e.cell === c.id)
      );
    });
    const enemy = {
      ...template,
      id: 82001,
      kind: "factory",
      team: 1,
      cell: cell.id,
      position: [...cell.position],
      hp: SPECS.factory.hp,
      orders: [],
      path: [],
      queue: [],
      progress: 0.6,
    };
    game.entities.set(enemy.id, enemy);
    game.visible[0][cell.id] = 1;
    game.explored[0][cell.id] = 1;
    api.tick(0.05);
    game.visible[0][cell.id] = 0;
    api.tick(0.05);
    scene.render(game, state, 0);
    return { id: enemy.id, cell: cell.id };
  });
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.scene.diagnostics().ghosts),
    1,
  );
  assert.equal(
    await page.evaluate(({ id, cell }) => {
      const { scene } = window.__IRON_ORBIT__,
        p = scene.project(cell);
      for (let y = -35; y < 10; y += 3)
        for (let x = -25; x < 25; x += 3)
          if (scene.pick(p.x + x, p.y + y).entity === id) return true;
      return false;
    }, ghost),
    false,
  );
  await page.screenshot({ path: "test-results/enemy-building-memory.png" });
  await page.evaluate(({ id }) => {
    const api = window.__IRON_ORBIT__;
    api.game.entities.delete(id);
    api.tick(0.05);
    api.scene.render(api.game, api.state, 0);
  }, ghost);
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.scene.diagnostics().ghosts),
    1,
  );
  await page.evaluate(({ cell }) => {
    const api = window.__IRON_ORBIT__;
    api.game.visible[0][cell] = 1;
    api.tick(0.05);
    api.scene.render(api.game, api.state, 0);
  }, ghost);
  assert.equal(
    await page.evaluate(() => window.__IRON_ORBIT__.scene.diagnostics().ghosts),
    0,
  );
  const stress = await page.evaluate(async () => {
    const { SPECS } = await import("/src/simulation.ts");
    const { game, scene, state } = window.__IRON_ORBIT__,
      sample = [...game.entities.values()].find((e) => e.kind === "commander");
    const cells = game.world.cells.filter(
      (c) => c.passable && game.world.distance(sample.cell, c.id) < 30,
    );
    state.selected.clear();
    game.paused = true;
    for (let i = 0; i < 400; i++) {
      const cell = cells[i % cells.length];
      game.entities.set(90000 + i, {
        ...sample,
        id: 90000 + i,
        kind: i % 2 ? "heavy" : "tank",
        cell: cell.id,
        position: [...cell.position],
        hp: 1,
        orders: [],
        path: [],
        queue: [],
      });
    }
    scene.render(game, state, 0);
    const initial = scene.diagnostics().drawCalls;
    let max = 0;
    for (let i = 0; i < 50; i++) {
      game.time += 0.05;
      scene.render(game, state, 0);
      max = Math.max(max, scene.diagnostics().smoke);
    }
    const final = scene.diagnostics();
    return { initial, final, max };
  });
  assert.ok(stress.max <= 2048 && stress.max > 1000);
  assert.ok(
    stress.final.drawCalls <= stress.initial + 8,
    "smoke uses bounded draw calls for 400 units",
  );
  console.log(
    "Battlefield browser checks passed; 400-unit smoke/wall fixture:",
    JSON.stringify(stress),
  );
  await page.evaluate(() => window.__IRON_ORBIT__.deploy("BATTLEFIELD-RESET"));
  assert.equal(
    await page.evaluate(
      () => window.__IRON_ORBIT__.state.rememberedBuildings.size,
    ),
    0,
  );
  await page.click("#sound");
  assert.equal(await page.locator("#audio-panel input[type=range]").count(), 3);
  for (const [id, value] of [
    ["ui-sfx-volume", 27],
    ["world-sfx-volume", 61],
    ["music-volume", 13],
  ])
    await page.locator(`#${id}`).evaluate((el, value) => {
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  await page.screenshot({ path: "test-results/audio-three-sliders.png" });
  await page.reload();
  await page.waitForFunction(() => !!window.__IRON_ORBIT__);
  assert.deepEqual(
    await page.evaluate(() => window.__IRON_ORBIT__.audio.getSettings()),
    { uiSfx: 0.27, worldSfx: 0.61, music: 0.13 },
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "iron-orbit-audio",
      JSON.stringify({ sfx: 0.8, music: 0.3, muted: true }),
    ),
  );
  await page.reload();
  await page.waitForFunction(() => !!window.__IRON_ORBIT__);
  assert.deepEqual(
    await page.evaluate(() => window.__IRON_ORBIT__.audio.getSettings()),
    { uiSfx: 0, worldSfx: 0, music: 0 },
  );
  console.log(
    "Verified slider persistence, muted legacy migration, and wall-drag cancellation.",
  );
}
