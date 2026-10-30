# Power-phase routing performance

**Normal runtime: 174.84 seconds originally, 135.06 seconds with the preload fix,
and 107.33 seconds with both fixes (39% less time overall).** These fresh-process
runs have no CPU profiler enabled. The earlier profiler-on ratio of 3.88x is not
representative of normal runtime: profiling disproportionately slowed the old
power-expansion stage. The updated Cosmos deployment completed in 142.934 seconds.

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


## Complete end-to-end comparison without profiling

All three runs use Bun 1.4.2 on the same M3 Pro, effort 1, no cache or workers,
and fresh processes. The baseline uses the original preload source and the
original expander at `01ce270`. Both dependency implementations were checked
against their source revisions. Every complete output has the same 761 traces
and full-output hash shown below.

| Measurement | Original | Preload fix only | Both fixes |
| --- | ---: | ---: | ---: |
| Complete routing | 174.84 s | 135.06 s | 107.33 s |
| Power expansion | 56.09 s | 55.95 s | 28.33 s |
| Output traces | 761 | 761 | 761 |

The total reduction is **38.6% (1.63x faster)**. The additional expander fix saves
20.5% over the preload-only fix. These are individual runs, not statistical
medians. Profiler-on measurements below are diagnostic observations and must not
be substituted for these normal-runtime results.

The actual updated Cosmos deployment reports **142.934 seconds** for Solve
Completely at effort 1 with no cache. Its high-density stage took 77.27 seconds,
power expansion 34.52 seconds and joint DRC repair 12.53 seconds. The old browser
attempt crashed without completing, so no before/after browser speedup is claimed.

The same-runtime regression also passes in Linux CI: both implementations produce
`33f7a588cf23a06eb7a65220f516272bdf9af243896b55f64e3fc7fff72c9a59` there. This
confirms that the Mac-versus-Linux golden-hash mismatch was platform/runtime
variation, not a difference introduced by this optimization.

## Complete CPU-profiled diagnostic comparison

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

The profiler-on run shows a 3.88x ratio (74.2% less elapsed time), but this is
not representative of normal runtime; use the unprofiled comparison above.
These are individual profiling observations, not statistical benchmark medians.
Unchanged stages vary with JIT, garbage collection and machine load: an additional
preload-only run completed in 287.20 seconds. Do not attribute that variation to
an algorithm change. The earlier 66-minute timestamp estimate is not used here.

All complete runs produced the same SHA-256:
`5c90f0d5e4bd73b4aed32d62e1f4350e5df0f36a70c53d47a2a79d714d7ab974`.
The recorded Mac runs have this exact hash. CI compares the complete fixed output
against the original pinned expander on the same runner, without a wall-clock
threshold, coordinate rounding or an accepted-hash list. This avoids assuming
that a Mac/Bun 1.4.2 golden hash is portable to Linux/Bun 1.4.3. The baseline is a
test-only dependency alias at `01ce270`; its replay uses the exact power-stage
input produced by the complete pipeline. The preload graph separately retains
its full-output golden test. CI gives the full-board comparison its existing
full-board timeout budget and retains both outputs if the comparison fails.

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

Run from the repository root without profiling for normal-runtime measurements:

```sh
ROUTE_LABEL=current bun \
  fixtures/bug-reports/bugreport110-motherboard-power-phase/profile-full-route.ts
```

Add `--cpu-prof --cpu-prof-dir=/tmp/motherboard-e2e` after `bun` only when
collecting a diagnostic profile; those timings include profiler overhead.

The script writes the complete output, a DRC-annotated SVG and a summary under
`/tmp/motherboard-e2e` (override with `ROUTE_OUTPUT_DIR`). To reproduce the original,
use the same script and fixture on revision `74ae9d5`, which has the original
preload implementation and expander pin. For a same-checkout comparison, extract
that revision's `PreloadedTraceGraphSolver.ts` into this numbered fixture folder
and provide its path as `BASELINE_PRELOAD_PATH`; also restore expander `01ce270`
when comparing the original full pipeline. Remove that temporary extracted file
afterwards. No generated baseline source or top-level profiling script is needed
in the PR.

## General rectangle indexing follow-up

The expander now constructs one bounding-box index entry with the exact rotated
polygon for every rectangular obstacle, independent of `isCopperPour`. It no
longer passes Infinity to a cell-size parameter. The existing approximation for
oval obstacles and exact circular-hole geometry remain unchanged. Exact
collision and physical-contact predicates, layers, aliases, and object identity
remain in use after the broad-phase bounds search.

The full motherboard output remains byte-identical to the original expander on
macOS (the same `5c90f0...` hash above). The dependency suite passes 92 tests,
including rotated pad/via/hole clearance-boundary comparisons against the tiled
implementation. Three dependency debug snapshots change only the spatial-index
overlay and resulting framing; their routed trace coordinates remain identical.
The motherboard input/output and preload snapshots are unchanged.

There are 21 requested connections, 638 preloaded traces, and 761 output trace
records (123 additional records). These are multi-terminal connections, not 21
simple line segments. The earlier measured 38.6% total-time reduction is proven
avoidable processing; it does not establish that most remaining high-density
routing or repair work is unnecessary. A dataset 18 paired benchmark is requested
on the updated PR head to check broader routing and performance regressions.


## DRC cache eviction follow-up

[Repair PR #185](https://github.com/tscircuit/high-density-repair03/pull/185)
keeps an advancing FIFO iterator for each bounded DRC cache. Previously each
insertion that evicted entries restarted a Map iterator at the beginning,
revisiting deleted slots in a heavily churned cache. The cursor preserves the
same eviction order, keys, retained entries, budgets, and geometry checks.
Connectivity invalidation also resets the query-cache cursor.

Fresh Bun 1.4.2 processes on the same macOS arm64 machine ran in
baseline–PR–PR–baseline order, without CPU profiling or concurrent benchmark
processes. The base repair dependency is `550e764`; the optimized implementation
is `22d82b4` (the pinned `4983cfc` changes only test layout).

| Measurement | Base mean | PR mean | Reduction |
| --- | ---: | ---: | ---: |
| Captured joint repair, including construction | 17.439 s | 11.507 s | 34.0% |
| Indexed DRC evaluation within joint repair | 9.931 s | 3.927 s | 60.5% |
| Complete motherboard power-phase routing | 103.034 s | 95.745 s | 7.1% |

Individual full-route times were 104.592 / 95.056 / 96.433 / 101.477 seconds.
All four full outputs have the same `5c90f0d5...` SHA-256 recorded above, 761
traces, 10,652,531 solver iterations, and the same 1,300 existing relaxed DRC
findings. The isolated repair runs also match new-route hashes and every
non-timing repair statistic. The isolated result attributes about six seconds
to the cache change; variation in unchanged stages also affects total time.
See [raw measurements](drc-cache-results.json).

To capture the repair input, set `JOINT_REPAIR_INPUT_PATH=/tmp/joint-input.json`
when running this directory's `profile-full-route.ts`. Then replay it with
`bun scripts/benchmarkPipeline9JointDrcInput.ts /tmp/joint-input.json` from the
repository root. Input capture and CPU profiling must be disabled when measuring
normal complete routing time. Compare the two pinned dependency revisions in
fresh processes while keeping every other dependency and option fixed.
