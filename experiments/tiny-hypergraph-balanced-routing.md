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
