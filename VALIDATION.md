# Implementation and review record

Validated on 12 September 2026.

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
