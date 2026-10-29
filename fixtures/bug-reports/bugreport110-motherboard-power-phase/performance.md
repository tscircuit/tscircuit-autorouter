# Power-phase routing performance

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

Run `bun fixtures/bug-reports/bugreport110-motherboard-power-phase/inspect-preload.ts` from this checkout. It disables
cache, stops after preload, and reports stage time, input/output SHA-256 hashes,
and assignment counts. To compare the reproduction revision, copy this script
to that revision and run it there with the same Bun version and lockfile.
The input hash must match before comparing output hashes. The output hash covers
the full boundary array, including geometry, ports, and fixed-copper assignments.
Hashing is outside the measured preload interval. No wall-clock thresholds are
added to CI.

## Limits

These performance changes preserve the existing routing result; they do not
fix its DRC findings or establish fabrication readiness. High-density routing
and joint DRC repair remain significant costs. The earlier
rough 66-minute observation came from cache-file timestamps during a run with
other work and frequent previews; it is not a controlled end-to-end benchmark.

## Visual regression check

The reproduction branch now includes captured input/output board SVGs and a live
preload-output SVG baseline (`b5e07e0`). Both visual tests pass on this fix
without updating snapshots (2 tests, 6 assertions). The complete output SHA-256
is also asserted. No baseline SVG or PNG changes appear in this fix's diff.
See [the reproduction images](repro.md#visual-snapshots).


## Complete end-to-end comparison

The complete 25-stage Pipeline 9 solve was profiled on an Apple M3 Pro with
36 GiB RAM, Bun 1.4.2, effort 1, no cache and no worker runtime. These are full
routing measurements for the captured **power-phase fixture**, not a reroute of
all motherboard phases or a browser click-to-paint measurement. Each process
started fresh. Fixture loading, serialization, DRC and SVG rendering are outside
the measured interval. See [the recorded results](end-to-end-results.json).

| Measurement | Original preload and expander | Preload fix only | Both fixes, final pin |
| --- | ---: | ---: | ---: |
| Complete routing | 423.81 s | 327.57 s | 109.36 s |
| Preload, including stage setup | 39.89 s | 0.23 s | 0.23 s |
| Power expansion, including stage setup | 295.16 s | 242.09 s | 28.41 s |
| Output traces | 761 | 761 | 761 |

The final run is 3.88 times faster than the original (74.2% less elapsed time).
These are individual profiling observations, not statistical benchmark medians.
Unchanged stages vary with JIT, garbage collection and machine load: an additional
preload-only run completed in 287.20 seconds. Do not attribute that variation to
an algorithm change. The earlier 66-minute timestamp estimate is not used here.

All complete runs produced the same SHA-256:
`5c90f0d5e4bd73b4aed32d62e1f4350e5df0f36a70c53d47a2a79d714d7ab974`.
The full-route regression test asserts this hash without a wall-clock threshold;
CI gives this full-board test the existing full-board timeout budget.

### Why the remainder was slow

The original profile attributed approximately 165 seconds to constructing
`SpatialObstacleIndex`, including 118 seconds in obstacle tessellation. The two
160 × 124 mm rectangular copper pours became **110,538 cells**, rebuilt repeatedly
during cleanup. Broad-phase searches also paid to traverse those cells. They
represent just two exact rectangular polygons.

[Power expander PR #62](https://github.com/tscircuit/power-trace-expander/pull/62)
indexes each rectangular pour as one exact polygon, retaining its rotation,
layer restrictions, net aliases and exact collision predicates. Other obstacle
subdivision is unchanged. It also incorporates the existing statistics-reuse
patch from PR #36: child searches do not require allocating unchanged parent
statistics on every iteration. Clearance, connectivity and immutable-copper
checks and iteration budgets remain in place. The pinned revision extends
`01ce270`, including its declared via-pad-clearance fix.

All 91 power-expander tests and the package/declaration build pass. New tests
compare compact and tiled collision/contact decisions across rotations, layers
and same-net blocking. Existing input/output SVG baselines remain unchanged.

### Remaining work and output quality

In the final run, high-density routing took 51.43 seconds and joint DRC repair
18.09 seconds. Those are the next major performance targets. Power expansion
still ends at its existing iteration budget with `resultStatus: best_effort`;
its output is unchanged, not newly DRC-clean. The final relaxed checker reports
**1,300 findings**. A separate routing-quality change would be required to
address them; it must not be hidden by this performance optimization.

### Repeating the full solve

Run from the repository root:

```sh
ROUTE_LABEL=current bun --cpu-prof --cpu-prof-dir=/tmp/motherboard-e2e \
  fixtures/bug-reports/bugreport110-motherboard-power-phase/profile-full-route.ts
```

The script writes the complete output, a DRC-annotated SVG and a summary under
`/tmp/motherboard-e2e` (override with `ROUTE_OUTPUT_DIR`). To reproduce the original,
use the same script and fixture on revision `74ae9d5`, which has the original
preload implementation and expander pin. For a same-checkout comparison, extract
that revision's `PreloadedTraceGraphSolver.ts` into this numbered fixture folder
and provide its path as `BASELINE_PRELOAD_PATH`; also restore expander `01ce270`
when comparing the original full pipeline. Remove that temporary extracted file
afterwards. No generated baseline source or top-level profiling script is needed
in the PR.
