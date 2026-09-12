# Iron Orbit

A browser RTS on a procedurally generated spherical planet. One industrial robot faction, land warfare, a streaming metal-and-energy economy, fog of war, and one AI opponent. Destroy the opposing commander to win.

See [the validation record](VALIDATION.md) for the specialist review loop, test results, and measured performance limitations.

## Run

Requires Node.js 22 or later.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Choose a world seed and deploy. `npm run build` creates a static site in `dist/`; `npm run preview` serves that build locally. There is no backend or account requirement.

## Play

Start by placing metal extractors on gold deposits and energy generators on open terrain. Build a land factory, select it, and queue scouts, tanks, constructors, or heavy walkers. Scout unexplored terrain, defend your commander, and eliminate the enemy commander.

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

The top-right controls toggle optional synthesized command audio, open help, and pause. The game pauses when the window loses focus. Restart with the same seed or choose a new deployment from the pause or match-end screen.

## Architecture

- `src/world.ts`: seeded 2,562-cell icosphere, mountainous elevation, balanced deposits, connected walkable terrain, and A\* routes.
- `src/simulation.ts`: fixed-step gameplay, shared player/AI commands, construction, production, combat, sight, and resource flow. No rendering dependency.
- `src/scene.ts`: Three.js WebGL scene, procedural models, spherical camera, fog, selection, effects, and terrain-occluded picking.
- `src/main.ts` and `src/style.css`: command HUD, input, deployment, and match flow.
- `src/types.ts`: shared terrain, entity, command, simulation, and rendering interfaces.

Unit costs and combat balance are centralized in `SPECS`. Seeded terrain and autonomous AI decisions are repeatable. The app uses a 20 Hz simulation with smoothed rendering. UI fonts are requested from Google Fonts, with local system fallbacks; all game geometry is generated locally.

## Validate

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:browser -- --benchmark
```

The browser suite starts an isolated local Vite server, exercises actual pointer/HUD actions, and saves screenshots to `test-results/`. Set `BASE_URL` to test an already running development server. Set `CHROMIUM_PATH` if using an existing Chromium installation. Development-only test hooks are excluded from the production bundle.

Automated simulation tests cover terrain connectivity and repeatability, mountains and occupancy, resource stalls, construction, production caps, visibility, combat, queued orders, and complete autonomous matches across several seeds. Browser checks cover deployment, movement, construction and resumption, production, pause/help, control groups, occlusion, restart, defeat, and replay.

The optional benchmark creates 200 mobile units, selects 100, and runs combat and fog at 1920×1080. It increases both health and maximum health only in the benchmark to keep the army size stable. FPS depends on the browser’s graphics backend; software-rendered headless results are not a hardware GPU guarantee.

## Current boundaries

This is a playable first version. No multiplayer, saved matches, aircraft, naval units, technology tiers, or terrain deformation. Desktop mouse and keyboard with WebGL 2 are required. Match duration depends on scouting and play; an undefended commander can fall in roughly four minutes. Costs and AI pacing remain available for further balance tuning.
