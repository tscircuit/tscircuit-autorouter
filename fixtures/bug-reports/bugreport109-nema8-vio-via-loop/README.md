# NEMA8 VIO via loop

Open `bug-reports/bugreport109-nema8-vio-via-loop` in React Cosmos
(`bun run start`) and solve the board. The fixture explicitly runs local
`AutoroutingPipelineSolver9_PreloadedTraceGraph` at the original 2x effort,
with caching disabled.

For a command-line reproduction with stage artifacts:

```sh
bun install
bun scripts/run-sample.ts --pipeline 9 \
  --srj-path fixtures/bug-reports/bugreport109-nema8-vio-via-loop/nema8-default-all-nets.srj.json \
  --effort 2 --ai-visuals
```

The runner prints the output directory and writes stage PNGs, SVGs, graphics
JSON, and DRC logs. Inspect the top-layer VIO route in
`stage19-mutatedPreloadedTraceSimplificationSolver.png` near
`(-3.1, 4.8)` mm. Board coordinates use millimeters, +X right and +Y up.

## Input provenance

The input is the unchanged `autorouting:start` SimpleRouteJson for
`DEFAULT_ALL_NETS` (routing stage 15, phase 16 of 17) from
[ShiboSoftwareDev/nema8-20mm-usbc-pd-controller v1.0.0](https://tscircuit.com/ShiboSoftwareDev/nema8-20mm-usbc-pd-controller?version=1.0.0#pcb).
The package release ID is `b70cb88d-a97d-4156-a85f-82c799bbea7f`.

The original source and lockfile were downloaded through the package-files API
and installed with `bun install --frozen-lockfile`. Capturing routing events did
not alter the source or solver. The installed versions were `tscircuit@0.0.2646`,
`@tscircuit/core@0.0.1971`, and `@tscircuit/capacity-autorouter@0.0.919`.
The complete capture reproduced every published PCB trace exactly.

The SRJ retains the 20 x 20 mm bounds, four layers, 54 connections, 248 obstacles,
and 22 preloaded traces. No routing, obstacles, connections, or clearance fields
were removed or changed. The input SHA-256 is
`a05cf1f20ae1747bfe0ad43302906944cdc6d62683f6acf643abcae093f8abb9`.

## Observed behavior

The preloaded VIO trace `source_net_4_mst5_0` enters the top layer at a via near
`(-3.25, 4.80)` mm and initially continues horizontally. This routing phase moves
its via and inserts a detour above it before continuing to the right. The
published output places the via at `(-3.113719517217139, 4.840020732688698)` mm
and sends the trace through `(-3.115, 5.155)` and `(-2.885, 5.155)` mm.

The captured phase also reproduces the detour with repository main `911963b`
(version 0.0.951). That run reports `solved: true`, `failed: false`; its VIO trace
has 32 route points versus 37 in the published output. The geometry differs
between versions, but the route still bends above the via and back down.
The standard replay command completes all 25 stages and reports 11
disconnected-endpoint errors under its relaxed DRC check.

This fixture records the routing defect for investigation. It does not assert
that a shorter route is feasible, that the board is DRC-clean, or that this area
has an electrical open or short.

The board source requests `autorouter.traceClearance: "0.2mm"`, but that setting
is absent from the captured SRJ. Its `minTraceToPadEdgeClearance` and
`minViaEdgeToPadEdgeClearance` are both 0.1 mm. The approximately 0.115 mm local
VIO/VREF gap therefore does not by itself establish a violation of an effective
0.2 mm router rule. Rule forwarding is a separate question from the loop.
