# Real DDR memory reproductions

## Runnable real-circuit reproductions

All fixtures and captured inputs live in repro PR #3331. Memory fix #3332 and
force-improvement pin #3341 inherit the same repros for branch comparisons.

Run `bun start` and open these Cosmos fixtures under
`fixtures/bug-reports/ddr-memory`:

- `h3-real-board`: the complete original H3 DDR signal input, 53 nets / two layers.
  Click the play button beside `uniformPortDistributionSolver`, then **Solve Sub**
  to finish that stage and inspect the cmn_21 / cmn_9 edge.
- `a64-real-board`: the complete original OLIMEX A64 input, 75 nets / six layers.
- `h3-port-checkpoint`: step the real distribution solver using this revision's
  Pipeline9 policy. Compare branches and zoom to the lower-left shared edge.
- `a64-region`: the original cmn_142 checkpoint, with all 38 terminals, 19 requests
  and original obstacles/ownership. Step into its portfolio or press **Solve
  Completely** to route the region.

Both complete inputs come directly from the immutable SRJ36 dataset pin. No pads,
net endpoints, layers or routing rules are changed for the fixtures. The local
checkpoints are shortcuts to the reported bugs; they are not replacement boards.

The full H3 regression starts at the original board input and runs the actual
pipeline to port distribution. On the repro branch, its snapshot records the
missing shared edge before the desired-edge assertion fails. The A64 regression
snapshots the first oversized uniform-grid allocation before its allocation
assertion fails. Both are marked `test.failing`, alongside the original H3 local
checkpoint regression, so the repro PR retains green CI with known failures.

Fix #3332 enables those three tests and updates the same native snapshots. It
finds the 0.4 mm H3 edge and spaces all five crossings, while the A64 test reaches
all 19 local routes and checks terminal identity and physical copper dimensions.

```sh
bun test tests/repro/pipeline9-h3-ddr-shared-edge-from-board.test.ts --timeout 9999999
bun test tests/repro/pipeline9-a64-ddr-resized-search-allocation.test.ts --timeout 9999999
```

These tests snapshot `solver.visualize()` through `graphics-debug`; there are no
hand-composed SVGs. Updating snapshots uses `BUN_UPDATE_SNAPSHOTS=1` with the same
commands. The interactive debugger uses the same solver-native renderer.

[H3 full-board stage snapshot](__snapshots__/pipeline9-h3-ddr-shared-edge-from-board.snap.svg) ·
[A64 current checkpoint state](__snapshots__/pipeline9-a64-ddr-resized-search-allocation.snap.svg)

Local checkpoint success does not establish full-board completion, DRC or DDR
timing. The paired full-board benchmark records those outcomes separately.

## H3 force-stage checkpoint

Open `fixtures/bug-reports/ddr-force/h3-force-checkpoint.fixture.tsx` in Cosmos.
This loads the actual H3 cmn_9 input into `Pipeline9HighDensityForceImproveSolver`:
23 local routes, 2,459 original points and all 20 force steps. Press **Solve
Completely** to run it and inspect the solver-native routes and elapsed time.
The inherited `ddr-memory/h3-real-board` fixture starts from the original circuit
input; the checkpoint skips its earlier routing stages.

```sh
bun test tests/repro/pipeline9-h3-ddr-force-output.test.ts --timeout 9999999
```

The test snapshots the actual force solver's completed visualization through
`graphics-debug`. It also checks all 110,746 output bytes against the original
SHA-256, `201156bd7ea690f5719ddfd845020d8d92e036f4bbc50c1ed0ac969054a781cb`.
The original dependency and pin #3341 run this same test. The fix changes work
performed, so final geometry remains identical. No manually composed SVG or
timing chart is used.

[Native output snapshot](__snapshots__/pipeline9-h3-ddr-force-output-output.snap.svg)

The [paired H3 benchmark](https://github.com/tscircuit/tscircuit-autorouter/pull/3341#issuecomment-6481646739)
records force completion in 168.4 seconds; the baseline remains in that stage
for 223.0 seconds without finishing. Both full boards time out at 360 seconds;
DRC is not reached and candidate peak RSS rises 3.0%. The local checkpoint's
elapsed time does not replace this same-machine full-board comparison.

## Original board inputs

![The five captured real DDR input boards](../fixtures/assets/ddr-real-board-samples.png)

These are the five original captured input boards with straight ratsnest lines,
not completed routes. The two local constructor checkpoints retain their source
attribution alongside the fixture data.

The [SRJ36 dataset](https://github.com/ShiboSoftwareDev/dataset-srj36-real-ddr)
contains all five captured inputs, source provenance and individual SVG/PNG previews.

| Sample | Board | Layers | DDR signal nets |
| --- | --- | ---: | ---: |
| 1 | [Allwinner H3 DDR3](https://github.com/hvwyl/allwinner-h3-ddr3-16x1-kicad) | 2 | 53 |
| 2 | [OLIMEX A64-OLinuXino rev H](https://github.com/OLIMEX/OLINUXINO) | 6 | 75 |
| 3 | [OLIMEX STMP157-OLinuXino-LIME2 rev B1](https://github.com/OLIMEX/OLINUXINO) | 8 | 72 |
| 4 | [OrangeCrab rev 0.2.1](https://github.com/orangecrab-fpga/orangecrab-hardware) | 6 | 50 |
| 5 | [Allwinner A13 SBC](https://github.com/vd-rd/sbc_allwinner_a13) | 4 | 96 |

The first two inputs exposed the displaced H3 port-boundary bug and the A64
enlarged-grid allocation bug. Multi-terminal nets and passive endpoints are
preserved. No extra layers, component spacing or invented DDR timing constraints
are added.

```sh
timeout 120s bun scripts/repro-ddr-resized-search.ts --report /tmp/ddr-memory.json
bun test tests/repro/pipeline9-a64-ddr-resized-search-allocation.test.ts --timeout 9999999
bun test tests/repro/pipeline9-h3-ddr-displaced-port-geometry.test.ts --timeout 9999999
./benchmark.sh --pipeline 9 --dataset 36 --concurrency 1 --sample-timeout 360s --max-rss-mib 12288
```

The local checkpoint regressions are expected-failing in the reproduction PR and
ordinary passing tests in the stacked fix. The guarded CLI exits 2 on resource
limits; it never counts a limit stop as solved.

For comparisons, run the same dataset on both revisions with identical runtime,
rules and limits. Record high-density-stage completion separately from full-board
completion, DRC and timing validation. The benchmark parent samples Linux process
peak RSS independently of the routing loop, including on time/RSS stops. Each raw
sample result records the first completed high-density stage's elapsed time and
cumulative process peak in `highDensityStage`. Full-board completion and DRC are
reported separately; hitting a resource limit is a failed sample.
