import "./style.css";
import { createWorld } from "./world";
import {
  createGame,
  tick,
  SPECS,
  issueOrder as simIssueOrder,
  stopUnits as simStopUnits,
  enqueueUnit as simEnqueueUnit,
  cancelProduction as simCancelProduction,
  setRally as simSetRally,
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
  Team,
  Order,
} from "./types";

import { NetworkClient } from "./network";
import { createLobby } from "./lobby";
import { resolveGameServer } from "./server-address";
import { createAudio } from "./audio";
import type { ClientMessage, LobbyRoom } from "./protocol";

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
 <aside class="mission-panel game-ui"><div class="eyebrow"><i class="cyan-dot"></i> OPERATION 01</div><h2>Take the high ground.</h2><p>Expand your foothold.<br>Find and destroy the enemy commander.</p><div class="mission-rule"></div><div class="objective"><span class="objective-dot"></span><span>Rival commanders</span><span id="opponents-status" class="hostile-label">1 ACTIVE</span></div><div class="objective"><span class="objective-dot friendly"></span><span>Your commander</span><span id="commander-status">ONLINE</span></div><div id="match-roster" class="match-roster"></div></aside>
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
 <section id="launch" class="launch-overlay"><div class="launch-copy"><div class="eyebrow"><span class="tiny-line"></span> A WORLD WITHOUT EDGES</div><h1>One planet.<br><span>Total control.</span></h1><p>Build an industrial war machine. Command your forces across a living sphere. There is no border to hide behind.</p><div class="launch-features"><span>${icon("orbit")} PROCEDURAL PLANET</span><span>${icon("tank")} LAND WARFARE</span><span>${icon("attack")} 1–4 COMMANDERS</span></div><div class="launch-card"><div class="launch-card-heading"><span class="eyebrow">NEW DEPLOYMENT</span><span class="difficulty">STANDARD AI</span></div><label for="seed-input">WORLD SEED <span>Different terrain. Same mission.</span></label><div class="seed-row"><input id="seed-input" value="KEPLER-09" maxlength="32" spellcheck="false" aria-label="World seed"/><button id="random-seed" title="Randomize seed" aria-label="Randomize seed">↻</button></div><button id="deploy" class="primary-button"><span>DEPLOY COMMANDER</span>${icon("arrow")}</button><button id="multiplayer-open" class="secondary-button">MULTIPLAYER LOBBY ↗</button><div class="launch-note">ONE FACTION <i>·</i> ALL LAND <i>·</i> LAST COMMANDER STANDING</div></div></div><div class="launch-coordinate"><span>KEPLER — 09</span><small>PROCEDURAL TERRESTRIAL WORLD</small><div>360° THEATER OF WAR</div></div><div class="launch-bottom"><span>IRON ORBIT <b>/</b> PROTOTYPE 001</span><span>DESKTOP · MOUSE + KEYBOARD</span></div></section>
 <div id="modal" class="modal-overlay" hidden><section class="modal-card"><div class="eyebrow" id="modal-eyebrow">COMMAND CENTER</div><h2 id="modal-title">Operation paused</h2><div id="modal-content"></div><div id="modal-actions"></div></section></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
app.insertAdjacentHTML(
  "beforeend",
  `<aside id="audio-panel" class="audio-controls" hidden><div class="eyebrow">AUDIO / ORIGINAL SCORE</div><label for="sfx-volume">Sound effects<input id="sfx-volume" type="range" min="0" max="100" aria-label="Sound effects volume"/></label><label for="music-volume">Music<input id="music-volume" type="range" min="0" max="100" aria-label="Music volume"/></label><button id="audio-mute" class="secondary-button">MUTE ALL</button><p>Three industrial war tracks and tactical effects. Your mix is saved on this device.</p></aside>`,
);
let game!: Game;
let scene!: SceneApi;
let running = false;
let localTeam: Team = 0;
let multiplayer = false;
let network: NetworkClient | null = null;
let networkUrl = "";
let currentRoom: LobbyRoom | null = null;
let connecting = false;
const audio = createAudio();
let state: RenderState = {
  selected: new Set(),
  hoveredCell: null,
  building: null,
  attackMode: false,
  overview: true,
};
let moveMode = false;
let lastUi = "";
const rosterRows = new Map<
  number,
  {
    row: HTMLDivElement;
    name: HTMLElement;
    status: HTMLElement;
  }
>();
$("#production-line").innerHTML =
  '<div class="production-status" hidden><i></i><span></span><b></b><button data-cancel title="Cancel current production">×</button></div><div class="build-footnote" hidden><span class="gold-dot" hidden></span><span data-footnote></span></div>';
const productionStatus = $("#production-line .production-status");
const productionBar = productionStatus.querySelector("i")!;
const productionLabel = productionStatus.querySelector("span")!;
const productionCount = productionStatus.querySelector("b")!;
const productionFootnote = $("#production-line .build-footnote");
const productionDot =
  productionFootnote.querySelector<HTMLElement>(".gold-dot")!;
const productionHint =
  productionFootnote.querySelector<HTMLElement>("[data-footnote]")!;
let lastProductionProgress = -1;
function setText(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}
let modalType = "";
let toastUntil = 0;
let lastMessage = "";
let seenElimination = false;
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

const lobby = createLobby({
  create: (name, seed, serverUrl) => {
    void connectLobby({ type: "create", name, seed }, serverUrl);
  },
  join: (name, code, serverUrl) => {
    void connectLobby({ type: "join", name, code }, serverUrl);
  },
  send: (message) => {
    void audio.unlock();
    if (message.type === "ready") audio.cue("ready");
    network?.send(message);
  },
  close: () => returnToMenu(),
});

async function connectLobby(message: ClientMessage, address: string) {
  if (connecting) return;
  connecting = true;
  void audio.unlock();
  try {
    const url = resolveGameServer(address, location.origin);
    try {
      localStorage.setItem("iron-orbit-server", url);
    } catch {
      /* Optional preference storage. */
    }
    if (network?.connected && networkUrl !== url) {
      network.disconnect();
      network = null;
    }
    if (!network?.connected) {
      network?.disconnect();
      networkUrl = url;
      network = new NetworkClient(
        {
          onLobby(room, team, clientId) {
            currentRoom = room;
            lobby.update(room, team, clientId);
            if (room.phase === "finished" && running && terminal())
              showModal("end");
            if (room.phase === "lobby") {
              multiplayer = false;
              running = false;
              game.paused = true;
              state.overview = true;
              modalType = "";
              $("#modal").hidden = true;
              $("#launch").hidden = true;
              document.body.classList.remove("playing");
              clearMode();
              lobby.open(room.seed);
            }
          },
          onMatch(next, team, room) {
            currentRoom = room;
            multiplayer = true;
            installGame(next, team, false);
            running = true;
            modalType = "";
            $("#modal").hidden = true;
            $("#launch").hidden = true;
            lobby.hide();
            document.body.classList.add("playing");
            scene.focus(game.world.spawns[team]);
            audio.cue("deploy");
            toast(`Room ${room.code} live. You command side ${team + 1}.`);
          },
          onSnapshot() {
            /* The network client applies authoritative state in place. */
          },
          onError(message) {
            lobby.status(message, true);
            toast(message);
            audio.cue("error");
          },
          onClose(reason) {
            const wasPlaying = multiplayer && running;
            returnToMenu();
            lobby.open(game.world.seed);
            lobby.status(
              reason +
                (wasPlaying
                  ? " Your surviving forces are now controlled by AI."
                  : ""),
              true,
            );
          },
        },
        url,
      );
      const client = network;
      await client.connect();
      if (network !== client) return;
    }
    network.send(message);
  } catch (error) {
    lobby.status(
      error instanceof Error ? error.message : "Cannot connect to game server.",
      true,
    );
  } finally {
    connecting = false;
  }
}
function returnToMenu() {
  const seed = game.world.seed;
  if (network?.connected) network.send({ type: "leave" });
  network?.disconnect();
  network = null;
  currentRoom = null;
  multiplayer = false;
  running = false;
  modalType = "";
  networkUrl = "";
  $("#modal").hidden = true;
  $("#launch").hidden = false;
  document.body.classList.remove("playing");
  lobby.hide();
  lobby.reset();
  init(seed);
  scene.zoom(600);
}
$("#multiplayer-open").addEventListener("click", () => {
  void audio.unlock();
  lobby.open(
    $<HTMLInputElement>("#seed-input").value.trim() || game.world.seed,
  );
});
function syncAudioUi() {
  const settings = audio.getSettings();
  $<HTMLInputElement>("#sfx-volume").value = String(
    Math.round(settings.sfx * 100),
  );
  $<HTMLInputElement>("#music-volume").value = String(
    Math.round(settings.music * 100),
  );
  $("#audio-mute").textContent = settings.muted ? "UNMUTE ALL" : "MUTE ALL";
  $("#sound").classList.toggle("active", !settings.muted);
  $("#sound").title = "Sound and music settings";
  $("#sound").setAttribute("aria-label", "Sound and music settings");
}
for (const id of ["sfx-volume", "music-volume"])
  $(`#${id}`).addEventListener("input", () => {
    void audio.unlock();
    audio.setVolumes(
      Number($<HTMLInputElement>("#sfx-volume").value) / 100,
      Number($<HTMLInputElement>("#music-volume").value) / 100,
    );
  });
$("#audio-mute").addEventListener("click", () => {
  void audio.unlock();
  audio.setMuted(!audio.getSettings().muted);
  syncAudioUi();
});
document.addEventListener("pointerdown", (event) => {
  if (!(event.target as HTMLElement).closest("#sound, #audio-panel"))
    $("#audio-panel").hidden = true;
});

function init(seed: string) {
  installGame(createGame(createWorld(seed)), 0, true);
}
function installGame(next: Game, team: Team, overview: boolean) {
  scene?.dispose();
  game = next;
  localTeam = team;
  game.paused = overview;
  scene = createScene($("#viewport"), game);
  state = {
    selected: new Set(),
    hoveredCell: null,
    building: null,
    attackMode: false,
    overview,
    localTeam,
  };
  const commander = [...game.entities.values()].find(
    (e) => e.team === localTeam && e.kind === "commander",
  );
  if (commander) state.selected.add(commander.id);
  $("#seed-label").textContent = game.world.seed;
  groups.clear();
  keys.clear();
  lastUi = "";
  rosterRows.clear();
  $("#match-roster").replaceChildren();
  lastProductionProgress = -1;
  lastMessage = "";
  seenElimination = false;
  audio.reset();
  seenWinner = false;
  accumulator = 0;
  attachPointer();
  clearMode();
  updateUi();
}

function beep(frequency = 440) {
  audio.cue(
    frequency < 200
      ? "error"
      : frequency >= 700
        ? "deploy"
        : frequency >= 600
          ? "queue"
          : frequency >= 500
            ? "move"
            : frequency <= 350
              ? "select"
              : "build",
  );
}
function terminal() {
  return game.finished || game.winner !== null;
}
function eliminated() {
  return !!game.players[localTeam]?.eliminated;
}
function canLook() {
  return running && !game.paused && !terminal() && !modalType;
}
function controllable() {
  return running && !game.paused && !terminal() && !eliminated() && !modalType;
}
function issueOrder(g: Game, ids: number[], order: Order, append = false) {
  if (multiplayer)
    network?.send({
      type: "command",
      command: { type: "order", ids, order, append },
    });
  else simIssueOrder(g, ids, order, append);
}
function stopUnits(g: Game, ids: number[]) {
  if (multiplayer)
    network?.send({ type: "command", command: { type: "stop", ids } });
  else simStopUnits(g, ids);
}
function enqueueUnit(g: Game, factoryId: number, kind: UnitKind): boolean {
  if (multiplayer) {
    const factory = g.entities.get(factoryId);
    if (
      !factory ||
      factory.team !== localTeam ||
      factory.progress < 1 ||
      factory.queue.length >= 12
    )
      return false;
    network?.send({
      type: "command",
      command: { type: "produce", factoryId, kind },
    });
    return true;
  }
  return simEnqueueUnit(g, factoryId, kind);
}
function cancelProduction(g: Game, factoryId: number) {
  if (multiplayer)
    network?.send({ type: "command", command: { type: "cancel", factoryId } });
  else simCancelProduction(g, factoryId);
}
function setRally(g: Game, factoryId: number, cell: number) {
  if (multiplayer)
    network?.send({
      type: "command",
      command: { type: "rally", factoryId, cell },
    });
  else simSetRally(g, factoryId, cell);
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
    .filter((e): e is Entity => !!e && e.team === localTeam);
}
function executeAt(x: number, y: number, append: boolean) {
  const hit = scene.pick(x, y);
  if (hit.cell === null) return;
  const selected = selectedEntities();
  const placing = !!state.building;
  if (!selected.length) {
    toast("Select a unit to issue orders.");
    return;
  }
  if (state.building) {
    const result = canPlace(game, localTeam, state.building, hit.cell);
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
      target?.team === localTeam &&
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
        audio.cue("build");
        return;
      }
    }
    const factories = selected.filter((e) => e.kind === "factory");
    factories.forEach((e) => setRally(game, e.id, hit.cell!));
    const ids = selected
      .filter((e) => !SPECS[e.kind].building)
      .map((e) => e.id);
    if (
      target &&
      target.team !== localTeam &&
      game.visible[localTeam][target.cell]
    )
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
  audio.cue(placing ? "build" : "move");
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
    if (!canLook()) return;
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
    if (controllable())
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
    if (!controllable()) return;
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
            game.entities.get(hit.entity)?.team === localTeam
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
      if (canLook()) scene.zoom(e.deltaY);
    },
    { passive: false },
  );
}

function action(name: string) {
  if (!controllable()) return;
  if (name === "stop") {
    stopUnits(game, [...state.selected]);
    clearMode();
    audio.cue("stop");
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
  if (!button || !controllable()) return;
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
  if ((e.target as HTMLElement).closest("[data-cancel]") && controllable()) {
    const f = selectedEntities().find((e) => e.kind === "factory");
    if (f) cancelProduction(game, f.id);
  }
});
function focusCommander() {
  const c = [...game.entities.values()].find(
    (e) => e.kind === "commander" && e.team === localTeam,
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
  void audio.unlock();
  $("#audio-panel").hidden = !$("#audio-panel").hidden;
  syncAudioUi();
});

function closeModal() {
  if (running && terminal()) {
    showModal("end");
    return;
  }
  $("#modal").hidden = true;
  modalType = "";
  if (running && !terminal() && !multiplayer) game.paused = false;
}
function showModal(type: "pause" | "help" | "end" | "eliminated") {
  if (!multiplayer) game.paused = true;
  keys.clear();
  modalType = type;
  $("#modal").hidden = false;
  $("#modal-eyebrow").textContent =
    type === "end"
      ? "OPERATION COMPLETE"
      : type === "eliminated"
        ? "COMMANDER ELIMINATED"
        : "COMMAND CENTER";
  $("#modal-title").textContent =
    type === "help"
      ? "Know your controls."
      : type === "end"
        ? game.winner === null
          ? "Mutual destruction."
          : game.winner === localTeam
            ? "Planet secured."
            : "Command link lost."
        : type === "eliminated"
          ? "Your commander has fallen."
          : multiplayer
            ? "Command menu."
            : "Operation paused.";
  if (type === "help")
    $("#modal-content").innerHTML =
      `<div class="controls-list"><div><span>Select / box select</span><kbd>LEFT CLICK / DRAG</kbd></div><div><span>Move / attack / rally</span><kbd>RIGHT CLICK</kbd></div><div><span>Rotate planet</span><kbd>WASD / MIDDLE DRAG</kbd></div><div><span>Zoom</span><kbd>SCROLL</kbd></div><div><span>Queue orders / add selection</span><kbd>SHIFT</kbd></div><div><span>Attack move / move / stop</span><kbd>F / M / X</kbd></div><div><span>Construction shortcuts</span><kbd>Q / E / R / T</kbd></div><div><span>Assign / select group</span><kbd>CTRL + 1–9 / 1–9</kbd></div><div><span>Focus commander / pause</span><kbd>HOME / ESC</kbd></div></div><p class="modal-description">Your commander builds and fights. Place extractors on gold deposits, generators for energy, and a factory to field an army. Both resources stream into construction. Right click an unfinished structure with a builder to resume it. Scout the dark terrain and keep your commander alive.</p>`;
  else
    $("#modal-content").innerHTML =
      `<p class="modal-description">${type === "end" ? (game.winner === null ? "No commander survived the final exchange. The operation ends in a draw." : game.winner === localTeam ? "All rival commanders have been eliminated. You control this world." : "Another commander controls this world. Regroup and prepare for your next deployment.") : type === "eliminated" ? "Your forces have been eliminated. The other commanders are still fighting. You can follow the remaining operation from your explored terrain or leave." : multiplayer ? "This is a live multiplayer battle. Your forces keep fighting while this menu is open. Leaving hands your surviving forces to AI." : "Your forces are holding position. Resume when you’re ready to command."}</p><div class="match-stats"><div><span>OPERATION TIME</span><b>${formatTime(game.time)}</b></div><div><span>FORCES REMAINING</span><b>${[...game.entities.values()].filter((e) => e.team === localTeam && !SPECS[e.kind].building).length}</b></div></div>`;
  if (multiplayer) {
    const primary =
      type !== "end"
        ? '<button class="primary-button" data-modal="resume">RETURN TO FIELD ' +
          icon("arrow") +
          "</button>"
        : currentRoom?.hostId === network?.clientId
          ? '<button class="primary-button" data-modal="lobby">RETURN TO LOBBY ' +
            icon("arrow") +
            "</button>"
          : '<p class="multiplayer-notice">Waiting for the host to return everyone to the lobby.</p>';
    $("#modal-actions").innerHTML =
      primary +
      '<button class="secondary-button" data-modal="menu">LEAVE MATCH</button>';
  } else
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
  else if (b.dataset.modal === "lobby") network?.send({ type: "returnLobby" });
  else returnToMenu();
});
$("#pause").addEventListener("click", () => {
  if (!running || terminal()) return;
  if (modalType) closeModal();
  else showModal("pause");
});
$("#help").addEventListener("click", () =>
  showModal(running && terminal() ? "end" : "help"),
);
function deploy(seed: string) {
  void audio.unlock();
  network?.disconnect();
  network = null;
  currentRoom = null;
  multiplayer = false;
  lobby.hide();
  lobby.reset();
  $("#deploy").setAttribute("disabled", "true");
  try {
    if (seed !== game.world.seed || running || game.time > 0 || terminal())
      init(seed);
    running = true;
    state.overview = false;
    game.paused = false;
    $("#launch").hidden = true;
    $("#modal").hidden = true;
    modalType = "";
    document.body.classList.add("playing");
    scene.focus(game.world.spawns[localTeam]);
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
  if (
    (e.target as HTMLElement).matches("input,textarea,select") ||
    lobby.visible
  )
    return;
  if (e.code === "Escape") {
    if (state.building || state.attackMode || moveMode) clearMode();
    else if (modalType && !terminal()) closeModal();
    else if (running && !terminal()) showModal("pause");
    return;
  }
  if (!canLook()) return;
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
  if (!controllable() || e.repeat) return;
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
  if (running && !multiplayer && !game.paused && !terminal())
    showModal("pause");
});
window.addEventListener("resize", () => scene?.resize());

function updateUi() {
  const p = game.players[localTeam];
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
    : terminal()
      ? "OPERATION COMPLETE"
      : game.paused
        ? "SIMULATION PAUSED"
        : multiplayer
          ? `ROOM ${currentRoom?.code || ""} / LIVE`
          : "OPERATION LIVE";
  const friendlies = [...game.entities.values()].filter(
    (e) => e.team === localTeam,
  );
  $("#unit-count").textContent = friendlies
    .filter((e) => !SPECS[e.kind].building)
    .length.toString()
    .padStart(2, "0");
  const activeRivals = game.players.filter(
    (p, team) =>
      team !== localTeam && p.controller !== "closed" && !p.eliminated,
  ).length;
  $("#opponents-status").textContent = `${activeRivals} ACTIVE`;
  $(".team-badge").childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE)
      node.textContent = ` ${multiplayer ? "SIDE " + (localTeam + 1) : "VANGUARD"} `;
  });
  $(".team-badge span").textContent =
    `${String(localTeam + 1).padStart(2, "0")} / YOU`;
  const roster = $("#match-roster");
  roster.hidden = !multiplayer;
  if (multiplayer) {
    const colors = ["#65e3db", "#ff7965", "#e9bb67", "#b998f5"];
    game.players.forEach((player, team) => {
      if (player.controller === "closed") return;
      let entry = rosterRows.get(team);
      if (!entry) {
        const row = document.createElement("div");
        const dot = document.createElement("i");
        dot.style.background = colors[team];
        const name = document.createElement("strong");
        const status = document.createElement("span");
        row.append(dot, name, status);
        roster.appendChild(row);
        entry = { row, name, status };
        rosterRows.set(team, entry);
      }
      if (entry.row.classList.contains("eliminated") !== player.eliminated)
        entry.row.classList.toggle("eliminated", player.eliminated);
      setText(entry.name, player.name);
      setText(
        entry.status,
        player.eliminated
          ? "OUT"
          : team === localTeam
            ? "YOU"
            : player.controller.toUpperCase(),
      );
    });
  }
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
  const producing = !!factory?.queue.length;
  if (productionStatus.hidden === producing)
    productionStatus.hidden = !producing;
  if (productionFootnote.hidden !== producing)
    productionFootnote.hidden = producing;
  if (factory && producing) {
    if (lastProductionProgress !== factory.production) {
      productionBar.style.width = `${factory.production * 100}%`;
      lastProductionProgress = factory.production;
    }
    setText(
      productionLabel,
      `PRODUCING ${SPECS[factory.queue[0]].name.toUpperCase()} · ${Math.floor(factory.production * 100)}%`,
    );
    setText(productionCount, `${factory.queue.length} QUEUED`);
  } else {
    if (productionDot.hidden === (mode === "build"))
      productionDot.hidden = mode !== "build";
    setText(
      productionHint,
      mode === "build"
        ? " Extractors require a gold deposit. Construction uses resources over time."
        : mode === "produce"
          ? "Right click the surface to set a rally point."
          : "Scout unexplored terrain to locate hostile forces.",
    );
  }
  const message = game.messages
    .filter((m) => m.team === undefined || m.team === localTeam)
    .at(-1);
  if (message && `${message.time}:${message.text}` !== lastMessage) {
    lastMessage = `${message.time}:${message.text}`;
    toast(message.text);
  }
}

try {
  syncAudioUi();
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
  if (running && !game.paused && !terminal()) {
    if (!multiplayer) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= 0.05 && steps++ < 3) {
        tick(game, 0.05);
        accumulator -= 0.05;
      }
    }
    const horizontal =
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
      Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    const vertical =
      Number(keys.has("KeyS") || keys.has("ArrowDown")) -
      Number(keys.has("KeyW") || keys.has("ArrowUp"));
    if (!modalType && (horizontal || vertical))
      scene.orbit(horizontal * dt * 220, vertical * dt * 220);
  }
  scene.render(game, state, dt);
  uiElapsed += dt;
  if (uiElapsed > 0.15) {
    updateUi();
    uiElapsed = 0;
  }
  audio.update(game, localTeam, {
    running,
    menuOpen: !!modalType || lobby.visible,
  });
  if (now > toastUntil) $("#toast").classList.remove("show");
  if (terminal() && !seenWinner && running) {
    seenWinner = true;
    showModal("end");
  } else if (
    multiplayer &&
    running &&
    eliminated() &&
    !seenElimination &&
    !terminal()
  ) {
    seenElimination = true;
    showModal("eliminated");
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
    tick: (dt: number) => {
      if (!multiplayer) tick(game, dt);
    },
    get multiplayer() {
      return multiplayer;
    },
    get localTeam() {
      return localTeam;
    },
    get network() {
      return network;
    },
    audio,
  };
