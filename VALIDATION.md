# Implementation and review record

Validated on 12 September 2026.

## Targeted runtime optimization pass

Implemented an exact spatial index for nearest-cell queries, active-range instance-matrix uploads, reusable rendering scratch objects, explicit detached snapshot copies, reusable client entity/fog storage, and persistent roster/production controls. Gameplay rules, graphics settings, dependencies, protocol fields, 20 Hz simulation, and 10 Hz snapshots are unchanged.

- **52 automated tests pass.** The nearest-cell regression checks 45,616 queries against the original linear scan, including every cell position, neighboring boundaries and nearby perturbations, random directions, poles, and degenerate vectors. Snapshot tests cover nested-copy isolation, enemy orders/resources/messages/effects, entity removal, fog clearing, storage reuse, and fresh rematch state.
- TypeScript and the production build pass.
- Solo browser acceptance passes, including focus retention on the production cancel control and instance-buffer growth, shrinkage, zero counts, repopulation, and construction-plan reuse.
- Four-client multiplayer acceptance passes, including persistent roster nodes, private construction plans, authority, elimination, host transfer, rematches, disconnect takeover, and cleanup. Battlefield and construction-order screenshots were visually checked.

### CPU comparison

Baseline runtime sources match commit `9a778d9`. The final comparison ran both implementations in one Node.js v22.15.0 process, alternating their order across three repetitions, without another test or benchmark running alongside it. Separate-process measurements varied substantially with machine load; the paired measurements below are the comparison used here.

Reproduce with `npm run benchmark -- /path/to/compatible-baseline-checkout`, or run `npm run benchmark` for the current implementation alone. The baseline checkout needs its dependencies available. Each stationary fixture uses seed `perf-review`, two or four human commanders plus 99 tanks per side on passable cells within 45 units of their spawn, and 80 fixed 0.05-second ticks. Setup is timed separately. "Cold" is the first tick after inserting tanks; commander sight was already initialized by `createGame`. The remaining 79 ticks measure cached stationary simulation.

The snapshot fixture has 400 entities, full visibility, eight orders, 32 path cells and two queue entries per entity, 64 shots, and 16 explosions. Each sample constructs and serializes all four player snapshots; ten warmups precede 80 measured samples. The combined payload remains **600,672 bytes** in both implementations.

All timings are milliseconds. Ranges span the three repetitions; "worst maximum" is the largest observed sample across those repetitions.

| Measurement | Before | After |
| --- | --- | --- |
| 200-unit cold tick, median (range) | 1,268.595 (946.748–1,287.411) | 553.794 (533.498–586.117) |
| 400-unit cold tick, median (range) | 2,443.948 (2,125.576–2,960.250) | 1,075.842 (983.933–1,093.575) |
| 200-unit warm tick, median range | 1.174–1.217 | 0.919–1.305 |
| 200-unit warm tick, p95 range | 3.769–4.387 | 2.606–4.556 |
| 200-unit warm tick, worst maximum | 6.133 | 6.855 |
| 400-unit warm tick, median range | 3.553–4.562 | 4.098–5.031 |
| 400-unit warm tick, p95 range | 6.069–9.320 | 8.497–9.953 |
| 400-unit warm tick, worst maximum | 14.633 | 13.869 |
| Four snapshots + JSON, median range | 38.325–42.641 | 10.549–10.749 |
| Four snapshots + JSON, p95 range | 45.803–52.375 | 15.806–17.033 |
| Four snapshots + JSON, worst maximum | 59.921 | 24.395 |

Cold-tick medians improve by about **56%** and the median snapshot batch by about **74%**. Warm timings overlap; the 400-unit warm median is slightly higher in this comparison, so no steady-state simulation speedup is claimed. Large synthetic cold-fog updates still exceed the 50 ms tick budget on this machine.

### Browser comparison

Two runs per implementation used Chromium 139.0.7258.5 at 1920×1080 with **ANGLE Vulkan / SwiftShader**, a software renderer. The concurrent music implementation was held equal in both versions. Each run used the existing 200-unit combat fixture with 100 selected units, two seconds of warmup and 180 sampled frames. Live combat means end-frame projectile counts vary between runs.

`npm run test:browser -- --benchmark` now instruments actual WebGL `bufferData` and `bufferSubData` calls inside the test browser only. Transfer totals include terrain/fog attributes as well as instance matrices; production code contains no upload instrumentation.

| Measurement | Before, two runs | After, two runs |
| --- | --- | --- |
| FPS | 5.3 / 5.3 | 5.3 / 5.4 |
| Median frame time, ms | 183.3 / 183.3 | 183.4 / 183.3 |
| p95 frame time, ms | 216.7 / 233.4 | 233.3 / 233.4 |
| Mean `bufferSubData` bytes/frame | 4,794,746 / 4,794,746 | 102,742 / 103,234 |
| Mean `bufferData` bytes/frame after warmup | 0 / 0 | 0 / 0 |

Steady-state buffer transfers drop by about **98%**. Initial buffer capacity is unchanged. FPS remains constrained by software rendering; these results do not establish a hardware GPU frame-rate improvement or a 60 FPS target.

## Multiplayer, construction orders, and audio update

The lead coordinated separate simulation/world, multiplayer server/client, globe visualization, and audio specialists. An independent reviewer checked the core implementation, returned findings for repair, and rechecked the integrated lobby, match lifecycle, audio privacy, and configurable server address.

- **47 automated tests pass**, including real WebSocket room/authority tests, four-player map and simulation cases, audio lifecycle/privacy, construction-plan lifecycle, and server-address validation.
- The existing solo browser gameplay suite passes after integration.
- Four real browser clients joined and started a four-human match. A separate two-human/two-AI match verified mixed slots, readiness, guest pointer commands, server ownership enforcement, own construction ghosts after deselection, cancellation cleanup, music/effects sliders and mute persistence, online menus continuing the simulation, elimination, host transfer, rematches, disconnect AI takeover, and empty-room cleanup.
- Browser validation exercised both a same-origin proxy and an explicitly selected remote server URL.
- Review caught stale rematch controls when a finished match's host left. Refreshing the remaining host's end screen fixed it; the browser regression passes.
- Visual inspection caught overly dark non-host hemispheres. Camera-relative lighting fixed readability without changing fog behavior; updated screenshots were checked.
- TypeScript and production build pass. A browser check of the built client served by Node successfully created a room, readied/started a match, advanced gameplay, and left; development hooks were absent. The GitHub Pages workflow supports a public `MULTIPLAYER_URL` setting; the lobby also accepts a server address. GitHub Pages itself does not run the multiplayer backend.
- Docker packaging was reviewed statically; the image was not built. No external multiplayer hosting was provisioned.

Current screenshots: `test-results/multiplayer-lobby.png` and `test-results/construction-orders.png`. Reproduce the multiplayer browser checks with `npm run test:multiplayer`.

The following sections preserve the original two-player prototype's baseline and performance measurements; they are not a new four-player GPU benchmark.

## Specialist workflow

The lead established shared interfaces and implemented the application shell, controls, HUD, and browser acceptance tests. Separate agents implemented terrain/navigation, simulation/AI, and rendering. An independent reviewer inspected the integrated changes and returned findings to the owning specialist. Review repeated after repairs and again after performance changes.

Resolved findings included camera/command shortcut conflicts, stale command modes on restart, blocked attack positions, mobile/building overlap, distant builder clearance, occupied movement destinations blocking queued orders, construction resumption, per-frame geometry churn, and invalid benchmark/occlusion fixtures. The final independent review found no remaining actionable defects in the reviewed implementation.

## Functional evidence

- Production build and TypeScript checks pass.
- All 23 automated terrain, simulation, and acceptance tests pass.
- Autonomous AI constructs an economy and factory, scouts, fields tanks, discovers the player, and wins complete matches across three seeds. Identical seeds and fixed steps reproduce complete outcomes.
- Actual browser pointer/HUD tests pass for deployment, movement, construction, interrupted construction resumption, factory selection and production, pause, help, control groups, far-side friendly selection rejection, hidden-enemy picking rejection, new-seed restart, defeat, and replay.
- Browser acceptance reports no uncaught runtime errors.
- Screenshots are generated at `test-results/launch.png`, `test-results/battlefield.png`, and `test-results/benchmark.png`.

## Performance evidence and limitation

The headless Chromium backend is **ANGLE Vulkan / SwiftShader**, a software renderer rather than a hardware GPU.

| Measurement | Result |
| --- | --- |
| Profiled 200-unit simulation before optimization | 142 ms/tick |
| Same simulation after LOS caching, local separation search, and target selection optimization | 3.1 ms/tick |
| 200-unit battle, 100 selected, 1920×1080 before batching | 691 draw calls; 3.8 FPS |
| Same browser stress scenario after optimization | 16 draw calls; 9.3 FPS |
| Optimized stress frame time | 100.1 ms median; 116.8 ms 95th percentile |
| Ordinary opening scene on the same software backend | 11.6 FPS; 10 draw calls |

The 60 FPS target is **not established** by this environment. Hardware-accelerated browser performance remains to be measured. The benchmark retains all 200 units by increasing their health and matching maximum health; combat, movement orders, fog, projectiles, and 100 selection overlays remain active.

Run `npm run test:browser -- --benchmark` on a machine with hardware graphics to obtain a representative local result. Set `CHROMIUM_PATH` to select an existing browser executable if needed.
