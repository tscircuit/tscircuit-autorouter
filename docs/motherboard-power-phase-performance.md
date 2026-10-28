# Power-phase preload performance

Follow-up to #3342 and the standalone reproduction in #3343.

The captured motherboard phase has 638 preloaded traces and 21 new connections.
Before pathfinding, `PreloadedTraceGraphSolver` projects the existing copper onto
capacity-graph boundary ports. Previously it called
`minimumDistanceBetweenSegments` for every primitive/boundary pair, even when
those objects were far apart. This is O(primitives × boundaries) exact geometry
work. Each rejected pair can require four point-to-segment distance calculations.

A local Bun 1.4.2 CPU profile on macOS arm64, with no preview or cache, found
55.28 seconds in that stage. The prefix through uniform port distribution took
about 74 seconds; port-point pathfinding accounted for another 14.29 seconds.
The hottest sampled functions were point-to-segment distance, on-segment, and
orientation checks. This identifies a specific synchronous bottleneck, not a
measurement of complete routing time.

The fix builds a Flatbush index over boundary bounding boxes. Each copper
primitive queries its bounding box expanded by the existing 1e-6 tolerance,
then runs the unchanged exact distance and layer checks on candidates. Candidate
indices are sorted into original boundary order to preserve assignment behavior.
Empty boundary arrays are supported without constructing an invalid empty index.
The new `boundaryDistanceCheckCount` statistic exposes the actual geometry work.

## Captured-input comparison

A direct local comparison used separately cloned, identical constructor inputs
for the original and indexed solvers (including construction in the timings):

| Measurement | Original | Indexed |
| --- | ---: | ---: |
| Copper primitives | 6,525 | 6,525 |
| Boundaries | 46,410 | 46,410 |
| Exact distance checks | 302,825,250 | 27,058 |
| Elapsed stage time | 93,787.95 ms | 575.35 ms |
| Preloaded ports | 3,347 | 3,347 |
| Trace-port assignments | 3,626 | 3,626 |

The entire serialized output was identical (SHA-256
`5b7c4a1206548fcd6fc0874726a1065cbc63b1da23c7c3f8490bb01a6a8ba713`).
A separate indexed inspection run took 375.46 ms and produced the same hash.
Local timings vary with machine contention and JIT state; these are focused
profiling observations, not controlled benchmark results or total-route speedups.
The deterministic reduction in geometry checks is over 99.99%.

Validation: the new sparse-boundary test checks tolerance, exact endpoint contact,
layer exclusion, empty input, and only two distance checks among 1,000 boundaries.
Existing preload, partial-rip, materialization, splicing, and minimal Pipeline 9
checks pass, as does reproduction input validation (7 tests, 64 assertions).
The package build, including worker bundles and TypeScript declarations, passes.

## Repeatable inspection

Run `bun scripts/inspect-motherboard-preload.ts` from this checkout. It disables
cache, stops after preload, and reports stage time, input/output SHA-256 hashes,
and assignment counts. To compare the reproduction revision, copy this script
to that revision and run it there with the same Bun version and lockfile.
The input hash must match before comparing output hashes. The output hash covers
the full boundary array, including geometry, ports, and fixed-copper assignments.
Hashing is outside the measured preload interval. No wall-clock thresholds are
added to CI.

## Limits

This change does not fix all board DRC errors or establish fabrication readiness.
It does not optimize later pathfinding or high-density repair stages. The earlier
rough 66-minute observation came from cache-file timestamps during a run with
other work and frequent previews; it is not a controlled end-to-end benchmark.

## Visual regression check

The reproduction branch now includes captured input/output board SVGs and a live
preload-output SVG baseline (`b5e07e0`). Both visual tests pass on this fix
without updating snapshots (2 tests, 6 assertions). The complete output SHA-256
is also asserted. No baseline SVG or PNG changes appear in this fix's diff.
See [the reproduction images](motherboard-power-phase-repro.md#visual-snapshots).
