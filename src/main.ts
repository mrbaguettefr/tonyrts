import "./style.css";
import { createWorld } from "./world";
import {
  createGame,
  tick,
  SPECS,
  issueOrder,
  stopUnits,
  enqueueUnit,
  cancelProduction,
  setRally,
  canPlace,
} from "./simulation";
import { createScene } from "./scene";
import type {
  BuildingKind,
  Entity,
  Game,
  Kind,
  RenderState,
  SceneApi,
  UnitKind,
} from "./types";

const icons: Record<string, string> = {
  orbit:
    '<circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-40 12 12)"/>',
  metal:
    '<path d="m12 2 8 5v10l-8 5-8-5V7Z"/><path d="m4 7 8 5 8-5M12 12v10"/>',
  energy: '<path d="m14 2-9 12h6l-1 8 9-12h-6Z"/>',
  commander:
    '<path d="M8 3h8v6H8zM6 11h12v7H6zM3 11v7m18-7v7M8 18v4m8-4v4M10 6h4"/>',
  constructor: '<path d="M4 16h15v5H4zM7 16V9h7l4 4M12 9V4h8v4M7 19h9"/>',
  scout: '<path d="m12 3 8 13-8-3-8 3ZM6 19h12M9 22h6"/>',
  tank: '<path d="M3 14h18v7H3zM7 14V8h10v6M12 8V2M6 18h12"/>',
  heavy:
    '<path d="M8 2h8v6H8zM5 10h14v8H5zM2 10v8m20-8v8M7 18v4m10-4v4M9 13h6"/>',
  extractor: '<path d="M4 21h16M6 21V9l6-6 6 6v12M8 9h8M12 9v7m-3-3 3 3 3-3"/>',
  generator:
    '<path d="M4 21V7l5-4v18m6 0V3l5 4v14M2 21h20M11 8h2m-2 5h2m-2 5h2"/>',
  factory: '<path d="M3 21V10l6 3V8l6 4V3h5v18ZM7 17v4m5-4v4m5-4v4"/>',
  turret: '<path d="M4 22h16l-3-8H7ZM8 14V8h8v6M12 8V2m-4 2h8"/>',
  move: '<path d="M12 3v18M3 12h18m-5-5 5 5-5 5M7 7l-4 5 4 5m5-14-5 5m5-5 5 5m-5 13-5-5m5 5 5-5"/>',
  attack:
    '<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  home: '<path d="m3 10 9-7 9 7M6 9v12h12V9M10 21v-7h4v7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  sound: '<path d="m3 9 5 0 5-5v16l-5-5H3ZM17 8q5 4 0 8m3-11q8 7 0 14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  flag: '<path d="M5 22V3h14l-3 5 3 5H5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
};
const icon = (name: string, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.commander}</svg>`;
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
 <div id="viewport" aria-label="3D planetary battlefield"></div>
 <div class="vignette"></div>
 <header class="topbar">
  <a class="brand" href="#" aria-label="Iron Orbit home">${icon("orbit")}<span>IRON<span class="brand-light">ORBIT</span><small>PLANETARY COMMAND</small></span></a>
  <div class="resource-group">
   <div class="resource metal">${icon("metal")}<div><div class="resource-label">METAL <span id="metal-flow">+0 /s</span></div><div class="resource-value"><span id="metal">0</span><small>/ <span id="metal-cap">1000</span></small></div><div class="resource-track"><i id="metal-bar"></i></div></div></div>
   <div class="resource energy">${icon("energy")}<div><div class="resource-label">ENERGY <span id="energy-flow">+0 /s</span></div><div class="resource-value"><span id="energy">0</span><small>/ <span id="energy-cap">2000</span></small></div><div class="resource-track"><i id="energy-bar"></i></div></div></div>
   <div class="army-count">${icon("commander")}<div><span id="unit-count">01</span><small>/ 100 UNITS</small></div></div>
  </div>
  <div class="top-actions"><div class="live"><i></i><span id="status-label">AWAITING DEPLOYMENT</span></div><span id="clock">00:00</span><button class="icon-button" id="sound" title="Enable sound" aria-label="Enable sound">${icon("sound")}</button><button class="icon-button" id="help" title="Controls" aria-label="Controls">${icon("help")}</button><button class="icon-button" id="pause" title="Pause · Esc" aria-label="Pause">${icon("pause")}</button></div>
 </header>
 <aside class="mission-panel game-ui"><div class="eyebrow"><i class="cyan-dot"></i> OPERATION 01</div><h2>Take the high ground.</h2><p>Expand your foothold.<br>Find and destroy the enemy commander.</p><div class="mission-rule"></div><div class="objective"><span class="objective-dot"></span><span>Enemy commander</span><span class="hostile-label">ACTIVE</span></div><div class="objective"><span class="objective-dot friendly"></span><span>Your commander</span><span id="commander-status">ONLINE</span></div></aside>
 <aside class="planet-panel game-ui"><div class="eyebrow">THEATER OF OPERATIONS</div><h3>KEPLER <span>— 09</span></h3><div class="planet-data"><span>CLASS</span><b>TERRESTRIAL</b><span>TOPOLOGY</span><b>SPHERICAL / NO BOUNDARY</b><span>SEED</span><b id="seed-label"></b></div><div class="signal"><i></i><i></i><i></i><i></i><i></i><span>SURFACE LINK ESTABLISHED</span></div></aside>
 <div class="view-label game-ui"><span class="bracket">┌</span><span>SURFACE COMMAND <b>LIVE</b></span><span class="bracket">┐</span></div>
 <div id="toast" role="status"></div>
 <div id="mode-hint" class="mode-hint" hidden></div>
 <div id="selection-box"></div>
 <footer class="command-dock game-ui">
  <section class="selection-panel"><div class="eyebrow">SELECTED <span id="selection-count">01</span></div><div class="selected-unit"><div class="unit-portrait" id="unit-portrait">${icon("commander")}</div><div><h3 id="selection-name">Commander</h3><p id="selection-role">FIELD CONSTRUCTION / COMBAT</p><div class="health-track"><i id="health-bar"></i></div><div class="health-caption"><span id="health-text"></span><span id="selection-state">STANDING BY</span></div></div></div><div class="unit-actions"><button data-action="move" title="Move · M">${icon("move")}<span>MOVE</span><kbd>M</kbd></button><button data-action="attack" title="Attack move · F">${icon("attack")}<span>ATTACK</span><kbd>F</kbd></button><button data-action="stop" title="Stop · X">${icon("stop")}<span>STOP</span><kbd>X</kbd></button></div></section>
  <section class="build-panel"><div class="build-heading"><div class="eyebrow" id="build-title">CONSTRUCTION</div><span id="build-subtitle">ESTABLISH YOUR FOOTHOLD</span></div><div id="build-options"></div><div id="production-line"></div></section>
  <section class="command-info"><div class="eyebrow">COMMAND UPLINK</div><button id="focus-commander">${icon("home")}<span>Focus commander</span><kbd>HOME</kbd></button><p><span class="mouse-mark"></span> RIGHT CLICK TO COMMAND</p><p>SHIFT <span>QUEUE ORDERS</span></p><div class="team-badge"><i></i> VANGUARD <span>01 / YOU</span></div></section>
 </footer>
 <div class="bottom-strip game-ui"><span><i class="cyan-dot"></i> VANGUARD SYSTEMS <b>//</b> TACTICAL INTERFACE v0.1</span><span>WASD / MIDDLE DRAG <b>ROTATE</b> <em>·</em> SCROLL <b>ZOOM</b></span></div>
 <section id="launch" class="launch-overlay"><div class="launch-copy"><div class="eyebrow"><span class="tiny-line"></span> A WORLD WITHOUT EDGES</div><h1>One planet.<br><span>Total control.</span></h1><p>Build an industrial war machine. Command your forces across a living sphere. There is no border to hide behind.</p><div class="launch-features"><span>${icon("orbit")} PROCEDURAL PLANET</span><span>${icon("tank")} LAND WARFARE</span><span>${icon("attack")} 1 VS 1 SKIRMISH</span></div><div class="launch-card"><div class="launch-card-heading"><span class="eyebrow">NEW DEPLOYMENT</span><span class="difficulty">STANDARD AI</span></div><label for="seed-input">WORLD SEED <span>Different terrain. Same mission.</span></label><div class="seed-row"><input id="seed-input" value="KEPLER-09" maxlength="32" spellcheck="false" aria-label="World seed"/><button id="random-seed" title="Randomize seed" aria-label="Randomize seed">↻</button></div><button id="deploy" class="primary-button"><span>DEPLOY COMMANDER</span>${icon("arrow")}</button><div class="launch-note">ONE FACTION <i>·</i> ALL LAND <i>·</i> COMMANDER ELIMINATION</div></div></div><div class="launch-coordinate"><span>KEPLER — 09</span><small>PROCEDURAL TERRESTRIAL WORLD</small><div>360° THEATER OF WAR</div></div><div class="launch-bottom"><span>IRON ORBIT <b>/</b> PROTOTYPE 001</span><span>DESKTOP · MOUSE + KEYBOARD</span></div></section>
 <div id="modal" class="modal-overlay" hidden><section class="modal-card"><div class="eyebrow" id="modal-eyebrow">COMMAND CENTER</div><h2 id="modal-title">Operation paused</h2><div id="modal-content"></div><div id="modal-actions"></div></section></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
let game!: Game;
let scene!: SceneApi;
let running = false;
let sound = false;
let audio: AudioContext | null = null;
let state: RenderState = {
  selected: new Set(),
  hoveredCell: null,
  building: null,
  attackMode: false,
  overview: true,
};
let moveMode = false;
let lastUi = "";
let modalType = "";
let toastUntil = 0;
let lastMessage = "";
let lastShot = 0;
let seenWinner = false;
let accumulator = 0;
const keys = new Set<string>();
const groups = new Map<string, number[]>();
const buildings: BuildingKind[] = [
  "extractor",
  "generator",
  "factory",
  "turret",
];
const units: UnitKind[] = ["constructor", "scout", "tank", "heavy"];

function init(seed: string) {
  scene?.dispose();
  game = createGame(createWorld(seed));
  game.paused = true;
  scene = createScene($("#viewport"), game);
  state = {
    selected: new Set(),
    hoveredCell: null,
    building: null,
    attackMode: false,
    overview: true,
  };
  const commander = [...game.entities.values()].find(
    (e) => e.team === 0 && e.kind === "commander",
  );
  if (commander) state.selected.add(commander.id);
  $("#seed-label").textContent = seed;
  groups.clear();
  keys.clear();
  lastUi = "";
  lastMessage = "";
  lastShot = 0;
  seenWinner = false;
  accumulator = 0;
  attachPointer();
  clearMode();
  updateUi();
}

function beep(frequency = 440, duration = 0.06) {
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.025, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  } catch {
    /* Audio is optional if unavailable in this browser. */
  }
}
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastUntil = performance.now() + 3400;
}
function clearMode() {
  state.building = null;
  state.attackMode = false;
  moveMode = false;
  updateMode();
}
function updateMode() {
  const message = state.building
    ? `PLACE ${SPECS[state.building].name.toUpperCase()} · CLICK SURFACE · ESC TO CANCEL`
    : state.attackMode
      ? "ATTACK MOVE · CLICK DESTINATION · ESC TO CANCEL"
      : moveMode
        ? "MOVE · CLICK DESTINATION · ESC TO CANCEL"
        : "";
  $("#mode-hint").hidden = !message;
  $("#mode-hint").textContent = message;
  scene.canvas.style.cursor = message ? "crosshair" : "default";
  lastUi = "";
}
function selectedEntities(): Entity[] {
  return [...state.selected]
    .map((id) => game.entities.get(id))
    .filter((e): e is Entity => !!e && e.team === 0);
}
function executeAt(x: number, y: number, append: boolean) {
  const hit = scene.pick(x, y);
  if (hit.cell === null) return;
  const selected = selectedEntities();
  if (!selected.length) {
    toast("Select a unit to issue orders.");
    return;
  }
  if (state.building) {
    const result = canPlace(game, 0, state.building, hit.cell);
    if (!result.valid) {
      toast(result.reason);
      beep(150);
      return;
    }
    const builders = selected.filter(
      (e) => e.kind === "commander" || e.kind === "constructor",
    );
    if (!builders.length) {
      toast("Select a commander or construction vehicle.");
      return;
    }
    issueOrder(
      game,
      [builders[0].id],
      { type: "build", kind: state.building, cell: hit.cell },
      append,
    );
    toast(`${SPECS[state.building].name} construction ordered`);
    if (!append) clearMode();
  } else {
    const target =
      hit.entity !== null ? game.entities.get(hit.entity) : undefined;
    if (
      target?.team === 0 &&
      SPECS[target.kind].building &&
      target.progress < 1
    ) {
      const builders = selected.filter(
        (e) => e.kind === "commander" || e.kind === "constructor",
      );
      if (builders.length) {
        issueOrder(
          game,
          builders.map((e) => e.id),
          {
            type: "build",
            kind: target.kind as BuildingKind,
            cell: target.cell,
          },
          append,
        );
        toast(`Resuming ${SPECS[target.kind].name.toLowerCase()} construction`);
        clearMode();
        beep(540);
        return;
      }
    }
    const factories = selected.filter((e) => e.kind === "factory");
    factories.forEach((e) => setRally(game, e.id, hit.cell!));
    const ids = selected
      .filter((e) => !SPECS[e.kind].building)
      .map((e) => e.id);
    if (target && target.team !== 0 && game.visible[0][target.cell])
      issueOrder(game, ids, { type: "attack", target: target.id }, append);
    else
      issueOrder(
        game,
        ids,
        { type: state.attackMode ? "attackMove" : "move", cell: hit.cell },
        append,
      );
    if (factories.length) toast("Factory rally point updated");
    clearMode();
  }
  beep(540);
}

function attachPointer() {
  const canvas = scene.canvas;
  let pointer: {
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    button: number;
    moved: boolean;
  } | null = null;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (!running || game.paused || game.winner !== null) return;
    pointer = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      button: e.button,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (running && !game.paused)
      state.hoveredCell = scene.pick(e.clientX, e.clientY).cell;
    if (!pointer) return;
    const dx = e.clientX - pointer.lastX,
      dy = e.clientY - pointer.lastY;
    if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 5)
      pointer.moved = true;
    if (pointer.button === 1 || (pointer.button === 2 && pointer.moved))
      scene.orbit(dx, dy);
    else if (
      pointer.button === 0 &&
      pointer.moved &&
      !state.building &&
      !state.attackMode &&
      !moveMode
    ) {
      const box = $("#selection-box");
      box.style.display = "block";
      Object.assign(box.style, {
        left: `${Math.min(e.clientX, pointer.x)}px`,
        top: `${Math.min(e.clientY, pointer.y)}px`,
        width: `${Math.abs(e.clientX - pointer.x)}px`,
        height: `${Math.abs(e.clientY - pointer.y)}px`,
      });
    }
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!pointer) return;
    const p = pointer;
    pointer = null;
    $("#selection-box").style.display = "none";
    if (game.paused || !running) return;
    if (p.button === 0) {
      if (state.building || state.attackMode || moveMode)
        executeAt(e.clientX, e.clientY, e.shiftKey);
      else {
        if (!e.shiftKey) state.selected.clear();
        if (p.moved)
          scene
            .selectRect(p.x, p.y, e.clientX, e.clientY)
            .forEach((id) => state.selected.add(id));
        else {
          const hit = scene.pick(e.clientX, e.clientY);
          if (
            hit.entity !== null &&
            game.entities.get(hit.entity)?.team === 0
          ) {
            if (e.shiftKey && state.selected.has(hit.entity))
              state.selected.delete(hit.entity);
            else state.selected.add(hit.entity);
          }
        }
        lastUi = "";
        beep(340);
      }
    } else if (p.button === 2 && !p.moved) {
      if (state.building) clearMode();
      else executeAt(e.clientX, e.clientY, e.shiftKey);
    }
  });
  canvas.addEventListener("pointercancel", () => {
    pointer = null;
    $("#selection-box").style.display = "none";
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (running && !game.paused) scene.zoom(e.deltaY);
    },
    { passive: false },
  );
}

function action(name: string) {
  if (!running || game.paused || game.winner !== null) return;
  if (name === "stop") {
    stopUnits(game, [...state.selected]);
    clearMode();
    beep();
  }
  if (name === "attack") {
    clearMode();
    state.attackMode = true;
    updateMode();
  }
  if (name === "move") {
    clearMode();
    moveMode = true;
    updateMode();
  }
}
document
  .querySelectorAll<HTMLButtonElement>("[data-action]")
  .forEach((b) => b.addEventListener("click", () => action(b.dataset.action!)));
$("#build-options").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-kind]",
  );
  if (!button || !running || game.paused || game.winner !== null) return;
  const kind = button.dataset.kind as Kind;
  if (SPECS[kind].building) {
    const prior = state.building;
    clearMode();
    if (prior !== kind) state.building = kind as BuildingKind;
    updateMode();
    beep();
  } else {
    const factory = selectedEntities().find((e) => e.kind === "factory");
    if (factory && enqueueUnit(game, factory.id, kind as UnitKind)) {
      beep(650);
      toast(`${SPECS[kind].name} added to production`);
    } else toast("Production unavailable. Check unit cap and factory status.");
  }
});
$("#production-line").addEventListener("click", (e) => {
  if (
    (e.target as HTMLElement).closest("[data-cancel]") &&
    !game.paused &&
    game.winner === null
  ) {
    const f = selectedEntities().find((e) => e.kind === "factory");
    if (f) cancelProduction(game, f.id);
  }
});
function focusCommander() {
  const c = [...game.entities.values()].find(
    (e) => e.kind === "commander" && e.team === 0,
  );
  if (c) {
    scene.focus(c.cell);
    state.selected = new Set([c.id]);
    clearMode();
  }
}
$("#focus-commander").addEventListener("click", focusCommander);
$(".brand").addEventListener("click", (e) => {
  e.preventDefault();
  if (running) focusCommander();
});
$("#sound").addEventListener("click", () => {
  sound = !sound;
  $("#sound").classList.toggle("active", sound);
  $("#sound").setAttribute("aria-label", sound ? "Mute sound" : "Enable sound");
  $("#sound").title = sound ? "Mute sound" : "Enable sound";
  beep();
  toast(sound ? "Command audio enabled" : "Command audio muted");
});

function closeModal() {
  $("#modal").hidden = true;
  modalType = "";
  if (running && game.winner === null) game.paused = false;
}
function showModal(type: "pause" | "help" | "end") {
  game.paused = true;
  keys.clear();
  modalType = type;
  $("#modal").hidden = false;
  $("#modal-eyebrow").textContent =
    type === "end" ? "OPERATION COMPLETE" : "COMMAND CENTER";
  $("#modal-title").textContent =
    type === "help"
      ? "Know your controls."
      : type === "end"
        ? game.winner === 0
          ? "Planet secured."
          : "Command link lost."
        : "Operation paused.";
  if (type === "help")
    $("#modal-content").innerHTML =
      `<div class="controls-list"><div><span>Select / box select</span><kbd>LEFT CLICK / DRAG</kbd></div><div><span>Move / attack / rally</span><kbd>RIGHT CLICK</kbd></div><div><span>Rotate planet</span><kbd>WASD / MIDDLE DRAG</kbd></div><div><span>Zoom</span><kbd>SCROLL</kbd></div><div><span>Queue orders / add selection</span><kbd>SHIFT</kbd></div><div><span>Attack move / move / stop</span><kbd>F / M / X</kbd></div><div><span>Construction shortcuts</span><kbd>Q / E / R / T</kbd></div><div><span>Assign / select group</span><kbd>CTRL + 1–9 / 1–9</kbd></div><div><span>Focus commander / pause</span><kbd>HOME / ESC</kbd></div></div><p class="modal-description">Your commander builds and fights. Place extractors on gold deposits, generators for energy, and a factory to field an army. Both resources stream into construction. Right click an unfinished structure with a builder to resume it. Scout the dark terrain and keep your commander alive.</p>`;
  else
    $("#modal-content").innerHTML =
      `<p class="modal-description">${type === "end" ? (game.winner === 0 ? "The hostile commander has been eliminated. Vanguard controls this world." : "Your commander has been destroyed. Regroup, rebuild, and reclaim the planet.") : "Your forces are holding position. Resume when you’re ready to command."}</p><div class="match-stats"><div><span>OPERATION TIME</span><b>${formatTime(game.time)}</b></div><div><span>FORCES REMAINING</span><b>${[...game.entities.values()].filter((e) => e.team === 0 && !SPECS[e.kind].building).length}</b></div></div>`;
  $("#modal-actions").innerHTML =
    `${type !== "end" ? '<button class="primary-button" data-modal="resume">RETURN TO COMMAND ' + icon("arrow") + "</button>" : '<button class="primary-button" data-modal="replay">REPLAY THIS WORLD ' + icon("arrow") + "</button>"}<button class="secondary-button" data-modal="menu">NEW DEPLOYMENT</button>`;
}
$("#modal-actions").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-modal]",
  );
  if (!b) return;
  if (b.dataset.modal === "resume") closeModal();
  else if (b.dataset.modal === "replay") deploy(game.world.seed);
  else {
    $("#modal").hidden = true;
    modalType = "";
    running = false;
    game.paused = true;
    $("#launch").hidden = false;
    document.body.classList.remove("playing");
    state.overview = true;
    clearMode();
    scene.zoom(900);
    updateUi();
  }
});
$("#pause").addEventListener("click", () => {
  if (!running || game.winner !== null) return;
  if (modalType) closeModal();
  else showModal("pause");
});
$("#help").addEventListener("click", () => showModal("help"));
function deploy(seed: string) {
  $("#deploy").setAttribute("disabled", "true");
  try {
    if (
      seed !== game.world.seed ||
      running ||
      game.time > 0 ||
      game.winner !== null
    )
      init(seed);
    running = true;
    state.overview = false;
    game.paused = false;
    $("#launch").hidden = true;
    $("#modal").hidden = true;
    modalType = "";
    document.body.classList.add("playing");
    scene.focus(game.world.spawns[0]);
    beep(700);
    toast("Commander deployed. Establish metal and energy production.");
  } catch (e) {
    console.error(e);
    toast("Deployment failed. Please reload and try another seed.");
  } finally {
    $("#deploy").removeAttribute("disabled");
  }
}
$("#deploy").addEventListener("click", () =>
  deploy($<HTMLInputElement>("#seed-input").value.trim() || "KEPLER-09"),
);
$("#random-seed").addEventListener("click", () => {
  const seed = `KEPLER-${Math.floor(Math.random() * 9000 + 1000)}`;
  $<HTMLInputElement>("#seed-input").value = seed;
  init(seed);
  scene.zoom(600);
  beep();
});
function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input,textarea")) return;
  if (e.code === "Escape") {
    if (state.building || state.attackMode || moveMode) clearMode();
    else if (modalType && game.winner === null) closeModal();
    else if (running && game.winner === null) showModal("pause");
    return;
  }
  if (!running || game.paused || game.winner !== null) return;
  if (
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(e.code)
  ) {
    keys.add(e.code);
    e.preventDefault();
  }
  if (e.repeat) return;
  if (e.code === "Home") {
    e.preventDefault();
    focusCommander();
  }
  if (e.code === "KeyM") action("move");
  if (e.code === "KeyF") action("attack");
  if (e.code === "KeyX") action("stop");
  if (["KeyQ", "KeyE", "KeyR", "KeyT"].includes(e.code)) {
    const index = ["KeyQ", "KeyE", "KeyR", "KeyT"].indexOf(e.code);
    const button =
      $("#build-options").querySelectorAll<HTMLButtonElement>("button")[index];
    button?.click();
  }
  if (/^Digit[1-9]$/.test(e.code)) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      groups.set(e.code, [...state.selected]);
      toast(`Control group ${e.code.slice(-1)} assigned`);
    } else if (groups.has(e.code)) {
      state.selected = new Set(
        groups.get(e.code)!.filter((id) => game.entities.has(id)),
      );
      clearMode();
    }
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  if (running && !game.paused && game.winner === null) showModal("pause");
});
window.addEventListener("resize", () => scene?.resize());

function updateUi() {
  const p = game.players[0];
  for (const resource of ["metal", "energy"] as const) {
    $(`#${resource}`).textContent = Math.floor(p[resource]).toLocaleString();
    $(`#${resource}-cap`).textContent = p[`${resource}Cap`].toLocaleString();
    const net = p[`${resource}Income`] - p[`${resource}Drain`];
    $(`#${resource}-flow`).textContent =
      `${net >= 0 ? "+" : ""}${net.toFixed(1)} /s`;
    $(`#${resource}-flow`).classList.toggle("negative", net < 0);
    $(`#${resource}-bar`).style.width =
      `${Math.max(0, Math.min(100, (p[resource] / p[`${resource}Cap`]) * 100))}%`;
  }
  $("#clock").textContent = formatTime(game.time);
  $("#status-label").textContent = !running
    ? "AWAITING DEPLOYMENT"
    : game.winner !== null
      ? "OPERATION COMPLETE"
      : game.paused
        ? "SIMULATION PAUSED"
        : "OPERATION LIVE";
  const friendlies = [...game.entities.values()].filter((e) => e.team === 0);
  $("#unit-count").textContent = friendlies
    .filter((e) => !SPECS[e.kind].building)
    .length.toString()
    .padStart(2, "0");
  const commander = friendlies.find((e) => e.kind === "commander");
  $("#commander-status").textContent = commander
    ? commander.hp < SPECS.commander.hp * 0.35
      ? "CRITICAL"
      : "ONLINE"
    : "LOST";
  for (const id of state.selected)
    if (!game.entities.has(id)) state.selected.delete(id);
  const selected = selectedEntities(),
    first = selected[0];
  $("#selection-count").textContent = selected.length
    .toString()
    .padStart(2, "0");
  $("#selection-name").textContent =
    selected.length > 1
      ? `${selected.length} units selected`
      : first
        ? SPECS[first.kind].name
        : "No selection";
  $("#selection-role").textContent =
    selected.length > 1
      ? "VANGUARD / COMBAT GROUP"
      : first
        ? SPECS[first.kind].role.toUpperCase()
        : "SELECT A UNIT TO COMMAND";
  const health = selected.reduce((sum, e) => sum + e.hp, 0),
    max = selected.reduce((sum, e) => sum + SPECS[e.kind].hp, 0);
  $("#health-bar").style.width =
    `${max ? Math.max(0, Math.min(100, (health / max) * 100)) : 0}%`;
  $("#health-text").textContent = max
    ? `${Math.ceil(health)} / ${max} HP`
    : "—";
  $("#selection-state").textContent = first
    ? first.progress < 1
      ? `BUILDING ${Math.floor(first.progress * 100)}%`
      : first.orders.length
        ? first.orders[0].type === "build"
          ? "CONSTRUCTING"
          : "EXECUTING ORDER"
        : "STANDING BY"
    : "UPLINK READY";
  const builder = selected.some(
    (e) => e.kind === "commander" || e.kind === "constructor",
  );
  const factory = selected.find((e) => e.kind === "factory");
  const mode = builder ? "build" : factory ? "produce" : "none";
  const signature = `${mode}:${first?.kind}:${state.building}:${factory?.progress === 1}`;
  if (signature !== lastUi) {
    lastUi = signature;
    $("#unit-portrait").innerHTML = icon(first?.kind || "orbit");
    $("#build-title").textContent =
      mode === "build"
        ? "CONSTRUCTION"
        : mode === "produce"
          ? "UNIT PRODUCTION"
          : "FIELD OPERATIONS";
    $("#build-subtitle").textContent =
      mode === "build"
        ? "ESTABLISH YOUR FOOTHOLD"
        : mode === "produce"
          ? "ASSEMBLE YOUR FORCES"
          : "EVERY DIRECTION IS A FRONT";
    const list = mode === "build" ? buildings : mode === "produce" ? units : [];
    $("#build-options").innerHTML = list.length
      ? list
          .map((kind, i) => {
            const spec = SPECS[kind];
            return `<button class="build-card ${state.building === kind ? "chosen" : ""}" data-kind="${kind}" title="${spec.role}. ${spec.buildTime}s build time." ${factory && factory.progress < 1 ? "disabled" : ""}><kbd>${["Q", "E", "R", "T"][i]}</kbd><span class="building-icon">${icon(kind)}</span><strong>${spec.name}</strong><span class="build-cost"><span>${icon("metal")}${spec.metal}</span><span>${icon("energy")}${spec.energy}</span></span></button>`;
          })
          .join("")
      : `<div class="idle-message">${icon("orbit")}<div><strong>${first ? "Ready for your command." : "The world is yours to command."}</strong><p>${first ? "Right click to move. Attack move to engage along a route." : "Select your commander to build your first base."}</p></div></div>`;
  }
  $("#production-line").innerHTML =
    factory && factory.queue.length
      ? `<div class="production-status"><i style="width:${factory.production * 100}%"></i><span>PRODUCING ${SPECS[factory.queue[0]].name.toUpperCase()} · ${Math.floor(factory.production * 100)}%</span><b>${factory.queue.length} QUEUED</b><button data-cancel title="Cancel current production">×</button></div>`
      : `<div class="build-footnote">${mode === "build" ? '<span class="gold-dot"></span> Extractors require a gold deposit. Construction uses resources over time.' : mode === "produce" ? "Right click the surface to set a rally point." : "Scout unexplored terrain to locate hostile forces."}</div>`;
  const message = game.messages[game.messages.length - 1];
  if (message && `${message.time}:${message.text}` !== lastMessage) {
    lastMessage = `${message.time}:${message.text}`;
    toast(message.text);
  }
}

try {
  init("KEPLER-09");
  scene.zoom(600);
} catch (error) {
  console.error(error);
  $("#viewport").innerHTML =
    '<div class="webgl-error">Unable to initialize the battlefield. Please use a browser with WebGL 2 enabled and reload.</div>';
  throw error;
}
let previous = performance.now(),
  uiElapsed = 0;
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  if (running && !game.paused && game.winner === null) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= 0.05 && steps++ < 3) {
      tick(game, 0.05);
      accumulator -= 0.05;
    }
    const horizontal =
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
      Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    const vertical =
      Number(keys.has("KeyS") || keys.has("ArrowDown")) -
      Number(keys.has("KeyW") || keys.has("ArrowUp"));
    if (horizontal || vertical)
      scene.orbit(horizontal * dt * 220, vertical * dt * 220);
  }
  scene.render(game, state, dt);
  uiElapsed += dt;
  if (uiElapsed > 0.15) {
    updateUi();
    uiElapsed = 0;
  }
  if (game.shots.length && game.shots[game.shots.length - 1].id !== lastShot) {
    lastShot = game.shots[game.shots.length - 1].id;
    beep(90 + Math.random() * 70, 0.05);
  }
  if (now > toastUntil) $("#toast").classList.remove("show");
  if (game.winner !== null && !seenWinner) {
    seenWinner = true;
    showModal("end");
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Development-only hooks for reproducible browser validation and profiling.
if (import.meta.env.DEV)
  (window as unknown as { __IRON_ORBIT__: unknown }).__IRON_ORBIT__ = {
    get game() {
      return game;
    },
    get scene() {
      return scene;
    },
    get state() {
      return state;
    },
    deploy,
    tick: (dt: number) => tick(game, dt),
  };
