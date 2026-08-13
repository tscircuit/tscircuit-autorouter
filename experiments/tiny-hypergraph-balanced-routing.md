# Tiny-hypergraph balanced routing experiments

Date: 2026-08-12

## Goal

Reduce the work handed from tiny-hypergraph to high-density and exact-geometry
routing without optimizing region cost in isolation. All local end-to-end runs
used Pipeline 7, 1x effort, one worker, and a 90 second sample cap. SRJ20
samples 22, 29, 35, 43, and 53 formed the initial canary.

The benchmark now records phase time plus completed tiny-graph topology and
downstream probability-of-failure diagnostics. This made it possible to tell
which downstream phase absorbed a global-routing change.

## Rejected trials

| Trial | Result | Decision |
| --- | --- | --- |
| Full rerip ramp 10 to 16 | DRC improved, five-case time +44% | reject |
| Full rerip ramp 10 to 12 | DRC improved, five-case time +44% | reject |
| Restore lexicographic minimum-cost state | Five-case time +66% | reject |
| Composite max/total/segment/layer selector | DRC improved, time +56% | reject |
| Automatic local section optimizer | DRC 40% to 20%, time +25% | reject |
| Direct layer-change cost 0.02 | Five-case time +47% | reject |
| Direct layer-change cost 0.005 | Five-case time +80% | reject |
| 100% downstream-aligned region score | Sample 22 high-density time -47%, exact DRC time 3.7x | reject |
| 25% downstream-aligned blend | DRC 40% to 80%, five-case time +36% | reject |
| 10% downstream-aligned blend | Samples 22/43 both more than 2x slower | reject |
| Trace-density factor 0.25 | Samples 22/35/43 all slower | reject |
| Trace-density factor 1 globally | DRC 40% to 80%, but five-case time +16% | reject as global policy |

The repeated failure was consistent: lower legacy region cost often reduced
high-density iterations, but could move work into exact-geometry repair. On
SRJ20 sample 22, the fully aligned score changed high-density routing from
5.63 s to 2.97 s while exact repair changed from 2.74 s to 10.23 s.

## Accepted strategy: guarded dual candidate portfolio

The useful missing term was capacity-normalized trace occupancy. Legacy region
cost can be zero for many parallel, non-crossing traces even though the
downstream node becomes expensive. `TRACE_DENSITY_COST_FACTOR` adds an opt-in
quadratic per-layer occupancy term while preserving the existing default.

For 30-99 route graphs, the autorouter first computes the legacy candidate. It
only computes the occupancy-aware candidate when the completed legacy layout
has:

- summed downstream failure pressure greater than 4;
- at least one node above predicted capacity (`max PF > 1`); and
- squared node port-point concentration of at least 125 per route.

The alternative is selected only when summed failure pressure stays within 3%,
squared failure pressure stays within 6%, and port concentration improves by
at least 5% for up to 40 routes or 10% above 40 routes. The losing solver is
released before detailed routing.

## Matched results

Initial five-case SRJ20 matched pair:

| Metric | Legacy | Guarded portfolio | Change |
| --- | ---: | ---: | ---: |
| Total time | 61.0 s | 57.3 s | -6.1% |
| P50 | 12.9 s | 10.1 s | -21.7% |
| Relaxed DRC | 2/5 | 3/5 | +1 pass |
| Average vias | 83.6 | 80.8 | -3.3% |

Only sample 22 selected the alternative in this canary. Its matched result was
13.1 s / DRC fail on legacy and 10.1 s / DRC pass with the portfolio.

The final same-order four-sample comparison included three selected layouts
(samples 19, 22, and 23) and a legacy-fallback control (sample 28):

| Metric | Legacy | Guarded portfolio | Change |
| --- | ---: | ---: | ---: |
| Total time | 151.1 s | 140.6 s | -7.0% |
| Relaxed DRC | 1/4 | 2/4 | +1 pass |
| Average vias | 127.5 | 122.5 | -3.9% |

The selected samples improved individually by 10.7%, 25.9%, and 12.8%. The
sample-28 control selected the primary candidate, preserving the legacy graph;
its wall-time difference is downstream runtime variance rather than a topology
change.

The phase totals show the intended trade: the portfolio spent an extra 3.27 s
in port-point pathing, then saved 7.09 s in high-density routing and 6.50 s in
global/exact DRC routing. Net end-to-end savings were 10.51 s.

| Phase total | Legacy | Guarded portfolio | Change |
| --- | ---: | ---: | ---: |
| Port-point pathing | 3.15 s | 6.42 s | +3.27 s |
| High-density routing | 74.48 s | 67.40 s | -7.09 s |
| Global/exact DRC routing | 68.99 s | 62.49 s | -6.50 s |

Final-code smoke checks confirmed both portfolio branches. Sample 22 evaluated
and selected the alternative, finishing in 11.25 s with no DRC errors and 76
vias (matched legacy: 14.01 s, 5 errors, 90 vias). Sample 28 evaluated but
rejected the alternative; its selected topology metrics exactly matched legacy
and it finished in 33.53 s (matched legacy: 33.75 s). Dataset01 sample 1 did not
evaluate an alternative and passed in 0.13 s.

Additional cases used to calibrate the guardrails:

| Sample | Legacy | Alternative | Result |
| --- | ---: | ---: | --- |
| SRJ20 23 | 76.0 s, 2 DRC errors | 67.9 s, 1 DRC error | accepted; -10.7% |
| SRJ20 19 | 37.0 s, 4 DRC errors, 130 vias | 34.2 s, 4 DRC errors, 124 vias | accepted; -7.6% |
| SRJ20 28 | 34.9 s | 66.3 s | rejected by >40-route 10% concentration rule |
| SRJ20 16 | timeout in high-density | timeout in high-density | rejected; no completion gain |
| SRJ20 37 | timeout downstream | timeout downstream | rejected; no completion gain |

Tiny-only scans covered dataset01 samples 1-10, SRJ19 controls, and SRJ20
samples 1-60. Dataset01 did not activate the alternative. The final selector
chooses SRJ20 samples 19, 22, and 23 among the calibrated set and preserves the
legacy layout for the known regressions.

## Memory safety

All routing runs used one worker and excluded bugreport88. A temporary low-RAM
condition was traced to two unrelated `tsci build --site` processes in another
workspace using about 4.7 GB and 2.7 GB RSS. Benchmarks were paused until those
processes completed. The portfolio also drops references to the losing solver
before detailed routing to avoid retaining both graph states.

## Selector tuning after aggregate benchmark

The first six-dataset same-machine run showed a 1.55% aggregate improvement:
completion increased from 490/587 to 495/587, DRC passes increased from 266 to
268, and timeouts fell from 96 to 91. All 11 selected candidates won in that
run, but 54 computed alternatives were rejected. The selected subset was 30.8%
faster in aggregate; the remaining 576 cases were effectively neutral.

To find missed wins without repeatedly running expensive detailed routing, a
tiny-stage scanner captured both candidate summaries for every evaluated
SRJ19/SRJ20 case and every current timeout. Runs were sequential, excluded
bugreport88, and stayed below 1 GB RSS. Promising candidates were then compared
end-to-end in fresh one-worker processes with equal 150 second caps.

Accepted selector changes:

- large-graph concentration improvement changes from 10% to 8%; and
- a candidate may instead qualify when it reduces PF sum by 10%, squared PF by
  15%, max PF by 15%, concentration by 2%, and segment count by 3%.

The completed-case audit covered every previously evaluated SRJ19/SRJ20
candidate. The new rules add five candidates. Known regressions (including
SRJ20 samples 6, 28, and 143) and all other rejected candidates remain on the
primary topology.

| Dataset/sample | Primary | Alternative | Outcome |
| --- | ---: | ---: | --- |
| SRJ19 48 | 150 s timeout | 77.2 s complete | timeout converted; 3 DRC errors |
| SRJ19 91 | 150 s timeout | 148.7 s complete | boundary timeout converted in isolated run |
| SRJ19 117 | 150 s timeout | 95.4 s complete | timeout converted; 5 DRC errors |
| SRJ20 132 | 65.9 s, 4 DRC errors | 58.1 s, DRC pass | 11.9% faster; 166 to 146 vias |
| SRJ20 189 | 43.2 s, 9 DRC errors | 35.0 s, DRC pass | 19.0% faster; 130 to 114 vias |

Negative controls ruled out broader policies: SRJ20 sample 6 changed an 81.1
second completion into a timeout; sample 143 slowed from 81.7 to 92.9 seconds;
SRJ19 sample 173 remained a high-density timeout; and SRJ20 sample 119 remained
an exact-repair timeout. SRJ19 sample 121 was neutral at 87.7 versus 87.9
seconds. These cases are all rejected by the final selector.

During a final combined local canary, an unrelated benchmark process grew to
8.4 GB RSS. Samples 48 and 117 still reproduced at 72.0 and 96.6 seconds;
sample 91 narrowly missed the 150 second cap after completing at 148.7 seconds
in its isolated matched run. System memory remained 79% free. The official
same-machine CI comparison is used for the final aggregate measurement.

## Stronger balancing trial: optimize the downstream A* hot loop

Increasing trace-density cost further did not produce a larger system-level
win. Factor 2 substantially reduced tiny-stage pressure on several SRJ19
timeouts, but only moved the bottleneck downstream:

- sample 31 still timed out in high-density improvement;
- sample 196 still timed out in exact-geometry DRC repair; and
- sample 189 reduced PF sum to 87.5%, squared PF to 80.6%, max PF to 65.0%,
  concentration to 90.7%, and segments to 84.8% of primary, but still timed
  out after 180 seconds in exact-geometry DRC repair.

This rejects a third tiny-hypergraph candidate: lower region pressure alone is
not sufficient once detailed routing becomes the dominant cost.

A CPU profile of the balanced pipeline instead found behavior-independent
bookkeeping in the high-density A* loop. The accepted implementation:

- replaces floating-point string cell keys with collision-free numeric grid
  ids;
- avoids cloning whole node objects for each planar and via neighbor;
- caches immutable via ancestry instead of walking the parent chain for every
  via-clearance probe;
- disables visualization-only search history in Pipeline 7 while preserving
  it by default for direct/debug solver use; and
- uses inlined hole-sifting in the candidate heap while preserving its exact
  comparison and tie behavior.

Matched one-worker dataset01 trials used eight high-density-heavy cases
(samples 32, 37, 39, 49, 58, 67, 73, and 77). All eight retained identical
high-density iteration counts, via counts, DRC messages, completion, and DRC
status.

| Metric | PR baseline | Optimized | Change |
| --- | ---: | ---: | ---: |
| High-density route time | 20.84 s | 13.68 s | -34.4% (1.52x faster) |
| End-to-end time | 43.24 s | 35.88 s | -17.0% (1.21x faster) |
| Completed / relaxed DRC | 8 / 8 | 8 / 8 | identical |

Every case improved end-to-end. A larger SRJ18 control confirmed that the gain
scales: sample 11 retained 206,760 high-density iterations, 179 vias, and zero
DRC errors while high-density time fell from 27.48 to 19.55 seconds (-28.9%)
and total time fell from 54.22 to 46.17 seconds (-14.9%).

A same-process dataset01 sample 32 memory comparison also improved: maximum
RSS fell from 858 MB to 842 MB, and macOS peak memory footprint fell from 662
MB to 625 MB.

Rejected downstream micro-optimizations were also kept out of the patch:
batching cache-stat reads was noise, two future-connection penalty rewrites
regressed the canary, and precomputing penalty constants caused a 21% runtime
regression under Bun's JIT. All trials used one local worker and excluded
bugreport88.
