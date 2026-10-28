# Real DDR memory reproductions

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
