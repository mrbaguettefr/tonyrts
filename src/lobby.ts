import "./lobby.css";
import type { ClientMessage, LobbyRoom } from "./protocol";
import type { Controller, Team } from "./types";

interface LobbyActions {
  create(name: string, seed: string, serverUrl: string): void;
  join(name: string, code: string, serverUrl: string): void;
  send(message: ClientMessage): void;
  close(): void;
}
export function createLobby(actions: LobbyActions) {
  const element = document.createElement("section");
  element.id = "lobby";
  element.hidden = true;
  element.className = "lobby-overlay";
  element.innerHTML = `<div class="lobby-card"><div class="lobby-top"><span class="eyebrow">MULTIPLAYER / FREE-FOR-ALL</span><button id="lobby-close" class="icon-button" aria-label="Close lobby">×</button></div><h2>Four commanders.<br><span>One world.</span></h2><p class="lobby-description">Up to four sides. Human rivals, AI opponents, or both.</p><div id="lobby-entry"><label class="lobby-label" for="game-server">GAME SERVER</label><input id="game-server" type="url" placeholder="https://your-game-server" spellcheck="false"/><p class="server-hint">Use this server for local play, or enter a shared server address.</p><label class="lobby-label" for="player-name">COMMANDER NAME</label><input id="player-name" maxlength="24" value="Commander" autocomplete="nickname"/><div class="lobby-entry-grid"><section><div class="eyebrow">ESTABLISH A ROOM</div><label class="lobby-label" for="lobby-create-seed">WORLD SEED</label><input id="lobby-create-seed" maxlength="32" value="KEPLER-09"/><button id="room-create" class="primary-button">CREATE ROOM <span>→</span></button></section><section><div class="eyebrow">JOIN YOUR RIVALS</div><label class="lobby-label" for="room-code-input">ROOM CODE</label><input id="room-code-input" maxlength="6" placeholder="ABC123" autocomplete="off" spellcheck="false"/><button id="room-join" class="secondary-button">JOIN ROOM <span>→</span></button></section></div><p class="lobby-footnote">Players must connect to the same game server. Share this page’s address and your room code.</p></div><div id="lobby-room" hidden><div class="room-heading"><div><span class="lobby-label">ROOM CODE</span><button id="room-copy" title="Copy room code"><strong id="room-code"></strong><span>COPY ↗</span></button></div><div class="room-seed-field"><label class="lobby-label" for="room-seed">WORLD SEED</label><input id="room-seed" maxlength="32"/></div></div><div id="room-slots"></div><div class="room-settings-note">Each commander is a separate side. Losing your commander eliminates you. The last surviving commander wins.</div><div class="room-actions"><button id="room-ready" class="secondary-button">READY UP</button><button id="room-start" class="primary-button">START BATTLE <span>→</span></button></div><p id="room-requirement"></p></div><div id="lobby-status" role="status"><i></i><span>READY TO CONNECT</span></div></div>`;
  document.body.appendChild(element);
  const q = <T extends HTMLElement = HTMLElement>(s: string) =>
    element.querySelector<T>(s)!;
  let room: LobbyRoom | null = null,
    team: Team = 0,
    clientId = "";
  const serverInput = q<HTMLInputElement>("#game-server");
  try {
    serverInput.value =
      localStorage.getItem("iron-orbit-server") ||
      import.meta.env.VITE_MULTIPLAYER_URL ||
      (location.hostname.endsWith(".github.io") ? "" : location.origin);
  } catch {
    serverInput.value =
      import.meta.env.VITE_MULTIPLAYER_URL ||
      (location.hostname.endsWith(".github.io") ? "" : location.origin);
  }
  const colors = ["#65e3db", "#ff7965", "#e9bb67", "#b998f5"];
  function status(text: string, error = false) {
    q("#lobby-status span").textContent = text;
    q("#lobby-status").classList.toggle("error", error);
  }
  q("#lobby-close").addEventListener("click", () => actions.close());
  q("#room-create").addEventListener("click", () => {
    status("CONNECTING TO COMMAND SERVER…");
    actions.create(
      q<HTMLInputElement>("#player-name").value.trim() || "Commander",
      q<HTMLInputElement>("#lobby-create-seed").value.trim() || "KEPLER-09",
      serverInput.value.trim(),
    );
  });
  q("#room-join").addEventListener("click", () => {
    const code = q<HTMLInputElement>("#room-code-input")
      .value.trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      status("Enter the six-character room code.", true);
      return;
    }
    status("CONNECTING TO ROOM…");
    actions.join(
      q<HTMLInputElement>("#player-name").value.trim() || "Commander",
      code,
      serverInput.value.trim(),
    );
  });
  q("#room-ready").addEventListener("click", () => {
    if (room) actions.send({ type: "ready", ready: !room.slots[team].ready });
  });
  q("#room-start").addEventListener("click", () =>
    actions.send({ type: "start" }),
  );
  q("#room-seed").addEventListener("change", () =>
    actions.send({
      type: "seed",
      seed: q<HTMLInputElement>("#room-seed").value.trim() || "KEPLER-09",
    }),
  );
  q("#room-slots").addEventListener("change", (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>(
      "select[data-slot]",
    );
    if (select)
      actions.send({
        type: "configure",
        slot: Number(select.dataset.slot) as Team,
        controller: select.value as Controller,
      });
  });
  q("#room-copy").addEventListener("click", async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      status("Room code copied. Share it with your rivals.");
    } catch {
      status(`Room code: ${room.code} — share it with your rivals.`);
    }
  });
  function update(next: LobbyRoom, myTeam: Team, myId: string) {
    room = next;
    team = myTeam;
    clientId = myId;
    const host = next.hostId === myId;
    q("#lobby-entry").hidden = true;
    q("#lobby-room").hidden = false;
    q("#room-code").textContent = next.code;
    const seed = q<HTMLInputElement>("#room-seed");
    seed.disabled = !host;
    if (document.activeElement !== seed) seed.value = next.seed;
    const slots = q("#room-slots");
    slots.replaceChildren();
    for (const slot of next.slots) {
      const row = document.createElement("div");
      row.className = "room-slot";
      row.dataset.team = String(slot.team);
      row.style.setProperty("--slot-color", colors[slot.team]);
      const badge = document.createElement("div");
      badge.className = "slot-badge";
      badge.textContent = String(slot.team + 1).padStart(2, "0");
      const identity = document.createElement("div");
      identity.className = "slot-identity";
      const name = document.createElement("strong");
      name.textContent =
        slot.controller === "closed"
          ? "Closed slot"
          : slot.controller === "ai"
            ? slot.name || "AI commander"
            : slot.clientId
              ? slot.name
              : "Waiting for a human…";
      const detail = document.createElement("span");
      detail.textContent =
        slot.clientId === myId
          ? "YOU" + (host ? " / HOST" : "")
          : slot.clientId === next.hostId
            ? "HOST"
            : slot.controller === "ai"
              ? "AUTONOMOUS OPPONENT"
              : slot.controller === "closed"
                ? "NOT IN THIS BATTLE"
                : slot.clientId
                  ? "CONNECTED"
                  : "SHARE THE ROOM CODE";
      identity.append(name, detail);
      const select = document.createElement("select");
      select.dataset.slot = String(slot.team);
      select.setAttribute("aria-label", `Slot ${slot.team + 1} controller`);
      for (const [value, label] of [
        ["human", "Human"],
        ["ai", "AI"],
        ["closed", "Closed"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
      select.value = slot.controller;
      select.disabled = !host || !!slot.clientId;
      const readiness = document.createElement("span");
      readiness.className = "slot-readiness";
      readiness.textContent =
        slot.controller === "closed"
          ? "—"
          : slot.controller === "ai" || slot.ready
            ? "READY"
            : slot.clientId
              ? "NOT READY"
              : "OPEN";
      readiness.classList.toggle(
        "ready",
        slot.controller === "ai" || slot.ready,
      );
      row.append(badge, identity, select, readiness);
      slots.appendChild(row);
    }
    const ready = next.slots[team]?.ready ?? false;
    q("#room-ready").textContent = ready ? "✓ READY / CANCEL" : "READY UP";
    q("#room-ready").classList.toggle("is-ready", ready);
    const active = next.slots.filter((s) => s.controller !== "closed");
    const open = active.some((s) => s.controller === "human" && !s.clientId);
    const waiting = active.some(
      (s) => s.controller === "human" && (!s.ready || !s.connected),
    );
    q<HTMLButtonElement>("#room-start").disabled =
      !host || active.length < 2 || open || waiting;
    q("#room-start").hidden = !host;
    q("#room-requirement").textContent =
      active.length < 2
        ? "Add at least one opponent."
        : open
          ? "Waiting for humans to fill the open slots. Change unused slots to AI or Closed."
          : waiting
            ? "All human commanders must ready up."
            : host
              ? "All commanders ready. Start when you’re ready."
              : "All commanders ready. Waiting for the host.";
    status(
      `CONNECTED / ${active.length} SIDES / ${next.slots.filter((s) => !!s.clientId).length} HUMANS`,
    );
  }
  return {
    open(seed: string) {
      element.hidden = false;
      if (!room) {
        q("#lobby-entry").hidden = false;
        q("#lobby-room").hidden = true;
        q<HTMLInputElement>("#lobby-create-seed").value = seed;
        status("READY TO CONNECT");
      }
    },
    hide() {
      element.hidden = true;
    },
    reset() {
      room = null;
      clientId = "";
      q("#lobby-entry").hidden = false;
      q("#lobby-room").hidden = true;
    },
    update,
    status,
    get visible() {
      return !element.hidden;
    },
  };
}
