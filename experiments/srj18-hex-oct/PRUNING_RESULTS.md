# SRJ18 safe layer-change pruning results

480 fresh-process runs on one Blacksmith ARM runner: all five existing pitches, control/cached/pruned modes, 16 boards, two counterbalanced repetitions, fixed CPU per lane and 60-second solve caps. **All 480 outputs pass the independent SRJ geometry checks.**

[Workflow and provenance](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/38563554569). Control is the original search with diagnostic counters; cached keeps the same graph; pruned adds certified-region layer gateways. This remains an independent experimental router, rather than a modified FreeRouting implementation.

The main result is **faster geometry checking, not a consistent via reduction**. Cached mode preserves identical traces and expanded-state counts on all 90 uncapped control comparisons with identical physical request coverage. On coarse grids it is 23–27% faster in those comparisons. Adding region pruning costs 2–6% versus cached-only across the five pitches, using directly paired uncapped runs with identical coverage.

Region pruning changes later greedy routing choices: coarse hex completes 6 clean boards versus 4 for control or cached, and equal-density coarse oct completes 5 versus 3, in both repetitions. Equal-pitch oct remains at 5. Fine equal-density oct loses one clean board versus cached-only. The region proof is per fixed-board search; it does not guarantee whole-board completion under the cap. Pruning stays opt-in.

## Completion, vias, expanded states and runtime

Connections, clean boards, vias and states show **r1 / r2**. Median wall time uses all 32 runs per row and includes startup/export and certificate work. Increased states/vias can reflect additional completed requests under the same cap.

| Grid (mm) | Mode | Connected / 2,194 (r1 / r2) | Clean boards / 16 | Vias | Expanded states (millions) | Median wall (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Hex 0.200 | control | 2105 / 2108 | 4 / 4 | 1,979 / 1,983 | 27.67 / 27.97 | 22.84 |
| Hex 0.200 | cached | 2134 / 2134 | 4 / 4 | 2,078 / 2,078 | 31.33 / 31.27 | 15.63 |
| Hex 0.200 | pruned | 2130 / 2132 | 6 / 6 | 2,071 / 2,056 | 30.84 / 30.81 | 16.71 |
| Oct 0.200 | control | 2088 / 2092 | 5 / 5 | 1,781 / 1,789 | 23.81 / 24.05 | 18.72 |
| Oct 0.200 | cached | 2109 / 2109 | 5 / 5 | 1,824 / 1,824 | 25.86 / 25.84 | 13.68 |
| Oct 0.200 | pruned | 2109 / 2109 | 5 / 5 | 1,816 / 1,816 | 25.26 / 25.30 | 14.32 |
| Oct 0.186 (equal density) | control | 2079 / 2081 | 3 / 3 | 1,831 / 1,836 | 25.01 / 25.33 | 20.24 |
| Oct 0.186 (equal density) | cached | 2108 / 2108 | 3 / 3 | 1,908 / 1,908 | 28.13 / 28.17 | 15.12 |
| Oct 0.186 (equal density) | pruned | 2109 / 2111 | 5 / 5 | 1,949 / 1,954 | 27.58 / 27.69 | 15.21 |
| Hex 0.100 | control | 1879 / 1883 | 1 / 1 | 1,078 / 1,104 | 42.10 / 42.73 | 60.12 |
| Hex 0.100 | cached | 1957 / 1956 | 2 / 2 | 1,398 / 1,394 | 56.30 / 56.00 | 60.12 |
| Hex 0.100 | pruned | 1951 / 1951 | 2 / 2 | 1,362 / 1,377 | 54.72 / 54.65 | 60.12 |
| Oct 0.093 (equal density) | control | 1897 / 1899 | 1 / 1 | 1,083 / 1,062 | 39.02 / 38.94 | 60.11 |
| Oct 0.093 (equal density) | cached | 1965 / 1964 | 2 / 2 | 1,369 / 1,369 | 50.75 / 50.14 | 60.11 |
| Oct 0.093 (equal density) | pruned | 1962 / 1962 | 1 / 1 | 1,347 / 1,354 | 49.96 / 50.40 | 60.11 |

## Quality on common completed electrical nets

These counts sum net comparisons across both repetitions, so they are not counts of distinct nets across the dataset. Only nets physically complete in both outputs and free of shorts are included. Length is summed polyline length and can include redundant same-net copper.

| Grid | Net comparisons, control/pruned | Control vias | Pruned vias | Via change | Length change | Uncapped time, pruned/control | Pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Hex 0.200 | 2083 | 3,600 | 3,594 | -0.17% | +0.38% | 0.730× | 20 |
| Oct 0.200 | 2062 | 3,282 | 3,311 | +0.88% | +0.50% | 0.852× | 18 |
| Oct 0.186 (equal density) | 2051 | 3,339 | 3,341 | +0.06% | -0.59% | 0.792× | 20 |
| Hex 0.100 | 1792 | 1,954 | 1,954 | +0.00% | +0.43% | 0.845× | 6 |
| Oct 0.093 (equal density) | 1809 | 1,986 | 1,945 | -2.06% | +1.35% | 0.867× | 6 |

## Region pruning versus caching alone

Timing and state counts use the same uncapped pairs with identical physical request coverage. Via comparisons use common completed electrical nets across both repeats.

| Grid | Pruned/cached time | Pairs | State change | Cached/pruned matched vias |
| --- | ---: | ---: | ---: | ---: |
| Hex 0.200 | 1.022× | 22 | -0.64% | 3,711 / 3,707 |
| Oct 0.200 | 1.059× | 20 | -0.25% | 3,340 / 3,388 |
| Oct 0.186 (equal density) | 1.025× | 22 | -1.09% | 3,443 / 3,447 |
| Hex 0.100 | 1.047× | 10 | -1.12% | 2,323 / 2,329 |
| Oct 0.093 (equal density) | 1.049× | 11 | +2.59% | 2,340 / 2,297 |

The gallery shows the predetermined first repetition: 24 configurations in each horizontal board row (15 new Blacksmith configurations plus 9 historical ones). Historical timings are from a different host and are not paired speed comparisons. All images use actual raw copper. Expanded states are unavailable for the historical tscircuit/FreeRouting recordings.

[Proof and limitations](PRUNING.md) · [Reproduce/import commands](REPRODUCE.txt) · [Per-run CSV](recorded/pruning/runs.csv) · [Full 480-run recording](recorded/pruning-results.json.gz).
