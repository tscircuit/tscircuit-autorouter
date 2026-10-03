# Muse e-paper: solved Pipeline 9 output fails via copper clearance

Issue: https://github.com/tscircuit/tscircuit-autorouter/issues/2822

The captured SRJ is the default local main-routing input from a 55 × 46 mm,
two-layer ESP32-S3 / GDEY075T7 board after 20 saved FPC escapes. The escapes
are represented in the input's obstacles and connection endpoints. It has
32 connections and 232 obstacles. No Muse source, component imports, CLI
routing artifacts, custom routing phase, or post-routing correction is needed.

## Reproduce

From the repository root after `bun install`:

```sh
bun test tests/repro/pipeline9-muse-eink-via-copper-clearance.test.ts --timeout 9999999
```

This characterization test passes by verifying that the unmodified default
local Pipeline 9 reports `solved=true`, `failed=false`, returns 108 traces and
92 physical vias, and produces exactly one different-net copper clearance
violation. Via endpoints shared by branches of the same net are counted once.
Every emitted via has a 0.3 mm drill and 0.5 mm copper diameter.

To assert the desired DRC-clean behavior instead:

```sh
MUSE_EINK_REQUIRE_DRC_CLEAN=1 bun test tests/repro/pipeline9-muse-eink-via-copper-clearance.test.ts --timeout 9999999
```

That command fails on the captured bug because it expects no violations.
When implementing a fix, replace the characterization assertions with the
zero-violation assertion; the strict mode also checks every different-net
pair rather than only the originally reported coordinates.

## Measured violation

| Net | Captured net ID | Via center (mm) |
| --- | --- | --- |
| BOOST_SW | source_net_2 | (16.147295435728953, 11.046851707207189) |
| RESE | source_net_1 | (15.911643654309586, 10.456754126462537) |

The center distance is 0.6354108252829919 mm. Subtracting the two copper
radii gives **0.1354108252829919 mm**, below the **0.15 mm** clearance used by
the consuming tscircuit build. The build emits `pcb_via_clearance_error` for
`pcb_via_84` / `pcb_via_86` and exits 1. The test measures copper geometry
directly, independently of the solver's DRC evaluator.

The captured input declares `minTraceToPadEdgeClearance=0.15`,
`minViaHoleDiameter=0.3`, `minViaPadDiameter=0.5`, and
`minViaHoleEdgeToViaHoleEdgeClearance=0.1`. The drill-edge gap is about
0.335411 mm and satisfies the hole rule. Investigate the rule contract between
Pipeline 9's joint repair and the consuming build: satisfying drill clearance
does not establish the copper clearance checked by the build. No root-cause
fix is included in this reproduction.

The sibling `.fixture.tsx` loads this SRJ in the existing Cosmos pipeline
debugger with cache disabled and effort 1. Its relaxed DRC defaults may not
flag the consuming build's 0.15 mm copper requirement; use the test above
for that measurement.

## Provenance and validation

- Original build: tscircuit 0.0.2742, core 0.0.2056, CLI 0.1.2235,
  capacity-autorouter 0.0.953, default `auto_local`, routing cache miss.
- Independently reproduced with published capacity-autorouter 0.0.953 and
  repository source at `4fb900bb6f553b2f8e468f6aed9ee68c2841438e` (version 0.0.953).
- Main source reproduction: characterization test passes; strict mode fails
  with the measured violation; `bunx --no-install tsc --noEmit` and
  `bun run build` pass.
- As a control, removing all saved FPC escapes from the same board, without
  changing any physical placement, routes with 101 vias and zero circuit DRC
  errors. The failure is input-dependent; the saved-escape case is retained
  intact to reproduce it.
- The published Muse board includes a separate post-routing correction.
  This fixture captures the uncorrected default-router input.
