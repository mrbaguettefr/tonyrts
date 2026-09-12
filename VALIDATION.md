# Implementation and review record

Validated on 12 September 2026.

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
