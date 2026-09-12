# Iron Orbit

A browser RTS on a procedurally generated spherical planet. One industrial robot faction, land warfare, a streaming metal-and-energy economy, fog of war, and up to four commanders in free-for-all multiplayer. Mix humans and AI in a room-code lobby; the last surviving commander wins. Solo play remains available.

**[Play Iron Orbit](https://mrbaguettefr.github.io/tonyrts/)** — desktop mouse and keyboard required.

See [the validation record](VALIDATION.md) for the specialist review loop, test results, and measured performance limitations.

## Run

Requires Node.js 22 or later.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run dev` starts both Vite and the multiplayer server on port 8787. Choose **Deploy Commander** for solo play or **Multiplayer Lobby** to create/join a room. There are no accounts.

For a shared server serving the production client and multiplayer together:

```sh
npm run build
npm start
```

Open port 8787 on the server's address. `PORT` and `HOST` configure its listener. `npm run dev:client` starts only Vite; `npm run server` starts only the backend. `npm run preview` is useful for checking the static build, but it does not launch the multiplayer server.

## Deployment

GitHub Actions tests, builds, and deploys the game to GitHub Pages on every push to `main`. You can also run the **Deploy game to GitHub Pages** workflow manually from the Actions tab. The build uses the Pages base path so assets load correctly under `/tonyrts/`.

**GitHub Pages hosts the client only.** Multiplayer needs the included Node server running somewhere reachable by all players. In the lobby, set **Game Server** to its HTTP(S) or WS(S) address; a root address automatically uses `/multiplayer`. The address is remembered on that device. A page served over HTTPS requires an HTTPS/WSS server.

To preconfigure the published client, set the public repository Actions variable `MULTIPLAYER_URL` to the server's WSS address. Local builds can use `VITE_MULTIPLAYER_URL`. The workflow passes this value into the client. No server is provisioned by the Pages workflow.

A multi-stage `Dockerfile` is included for hosting the combined app. It serves `dist/` and `/multiplayer` from one process; configure your host's HTTPS endpoint to forward WebSocket connections. The image definition has been reviewed but not built in this environment.

For a new repository, select **GitHub Actions** as the source under **Settings → Pages**. To check the repository-path build locally, run `npm run build -- --base /tonyrts/`, then `npm run preview` and open `/tonyrts/`.

## Multiplayer lobby

1. Open **Multiplayer Lobby**, enter a commander name, and create a room.
2. The host sets each of four slots to **Human**, **AI**, or **Closed**. Occupied human slots cannot be reassigned.
3. Share the page/server address and six-character room code. Guests join open human slots.
4. Every human readies up; the host starts once at least two sides are present and no human slot is empty.

Each commander is an independent side with its own resources, 100-unit cap, and fog of war. Three/four-player worlds have balanced, separated starting areas. Losing a commander removes that side's forces; the battle continues until one side remains, or ends in a draw if the final commanders die together.

Online menus and background tabs do **not** pause the shared simulation. Leaving or disconnecting transfers your surviving forces to AI. The host role passes to another human when needed. After the match, the host can return everyone to the lobby for another game. Reconnecting to an in-progress slot and late joining are not supported yet; an empty room is discarded.

The server validates commands and sends each player only their own state and visible enemies. Enemy orders, production queues, resource balances, and hidden units are not sent to other players.

## Play

Start by placing metal extractors on gold deposits and energy generators on open terrain. Build a land factory, select it, and queue scouts, tanks, constructors, or heavy walkers. Scout unexplored terrain, defend your commander, and eliminate the enemy commander.

Queued construction orders appear as numbered wireframe buildings and footprint rings on the globe, even when their builder is deselected. Selected builders also show connecting construction routes. Plans disappear when canceled, when the builder is destroyed, or when a real construction site takes over. Other players cannot see your planned orders.

Resources are spent continuously while building. A shortage slows construction; the commander supplies baseline income. Constructors and the commander can resume unfinished structures with a right click. Factory queues pause at the 100-mobile-unit limit, including the commander.

| Control                         | Action                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| Left click / drag               | Select / box select                                                   |
| Shift + selection               | Add or remove selection                                               |
| Right click                     | Move, attack visible enemy, resume construction, or set factory rally |
| Shift + command                 | Queue orders                                                          |
| WASD / arrow keys / middle drag | Rotate around the planet                                              |
| Right drag                      | Alternate camera rotation                                             |
| Scroll                          | Zoom from the surface to the whole globe                              |
| F / M / X                       | Attack move / move mode / stop                                        |
| Q / E / R / T                   | Four contextual construction or production options                    |
| Ctrl + 1–9 / 1–9                | Assign / recall control groups                                        |
| Home                            | Select and focus your commander                                       |
| Esc                             | Cancel command mode or pause/resume                                   |

The speaker control opens separate **Sound effects** and **Music** volume sliders plus master mute. Original procedural ambient music accompanies distinct selection, movement, construction, production, combat, and outcome cues. Sound unlocks after a user gesture; volume and mute preferences persist on the device. Effects respect fog of war.

The other top-right controls open help and the command menu. Solo play pauses when the window loses focus; online matches continue. Restart solo games with the same seed or return to the multiplayer lobby after a match.

## Architecture

- `src/world.ts`: seeded 2,562-cell icosphere, mountainous elevation, balanced deposits, connected walkable terrain, and A\* routes.
- `src/simulation.ts`: fixed-step gameplay, shared player/AI commands, construction, production, combat, sight, and resource flow. No rendering dependency.
- `src/scene.ts`: Three.js WebGL scene, procedural models, spherical camera, fog, selection, effects, and terrain-occluded picking.
- `src/main.ts` and `src/style.css`: command HUD, input, deployment, and match flow.
- `src/types.ts`: shared terrain, entity, command, simulation, and rendering interfaces.
- `server/server.ts`: authoritative rooms, command validation, 20 Hz simulation, 10 Hz player-filtered snapshots, disconnect handling, and static hosting.
- `src/network.ts`, `src/protocol.ts`, and `src/lobby.ts`: WebSocket client, shared protocol, and lobby interface.
- `src/build-plans.ts` and `src/audio.ts`: private construction-plan visualization data and procedural audio.

Unit costs and combat balance are centralized in `SPECS`. Seeded terrain and autonomous AI decisions are repeatable. The app uses a 20 Hz simulation with smoothed rendering. UI fonts are requested from Google Fonts, with local system fallbacks; all game geometry is generated locally.

## Validate

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:multiplayer
npm run test:browser -- --benchmark
```

The multiplayer browser suite starts an isolated authoritative server and four browser clients, exercises mixed human/AI and all-human rooms, and checks non-host commands, construction plans, audio settings, elimination, host transfer, rematches, and disconnect takeover. It also verifies that rooms clean up after everyone leaves.

The solo browser suite starts an isolated local Vite server, exercises actual pointer/HUD actions, and saves screenshots to `test-results/`. Set `BASE_URL` to test an already running development server. Set `CHROMIUM_PATH` if using an existing Chromium installation. Development-only test hooks are excluded from the production bundle.

Automated simulation tests cover terrain connectivity and repeatability, mountains and occupancy, resource stalls, construction, production caps, visibility, combat, queued orders, and complete autonomous matches across several seeds. Browser checks cover deployment, movement, construction and resumption, production, pause/help, control groups, occlusion, restart, defeat, and replay.

The optional benchmark creates 200 mobile units, selects 100, and runs combat and fog at 1920×1080. It increases both health and maximum health only in the benchmark to keep the army size stable. FPS depends on the browser’s graphics backend; software-rendered headless results are not a hardware GPU guarantee.

## Current boundaries

This is a playable prototype with up to four free-for-all sides. No alliances, in-progress reconnection, persistent rooms, saved matches, aircraft, naval units, technology tiers, or terrain deformation. Server restarts discard rooms and ongoing matches. Desktop mouse and keyboard with WebGL 2 are required. Match duration depends on scouting and play; an undefended commander can fall in roughly four minutes. Costs and AI pacing remain available for further balance tuning.
