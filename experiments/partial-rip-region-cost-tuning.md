# Partial-rip region-cost tuning

Date: 2026-08-10

## Goal

Reduce the congestion passed from partial-rip global routing into Pipeline 7's
high-density stages without giving back the completion, relaxed-DRC, or runtime
improvements from the original outside-in integration.

The merged policy allowed complexity-aware selection to choose the
lowest-segment candidate within 20% of the first solution's maximum region cost
and 10% of its total region cost. Candidate-frontier inspection showed that
this occasionally selected a peak-cost regression, but also showed that the
lowest absolute region-cost candidate was often much denser.

All end-to-end comparisons below used the same warmed Blacksmith 4-vCPU
testbox, Pipeline 7, 1x effort, two workers, and the SRJ18 dataset.

## Trial 1: strict region-cost-first selection (rejected)

Setting `PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT` to infinity restores
the tiny-hypergraph solver's strict `(max region cost, total region cost)`
ordering. It substantially lowered costs, but downstream routing regressed:

| Sample | Baseline | Strict cost | Time change | Baseline DRC | Strict DRC |
| --- | ---: | ---: | ---: | --- | --- |
| 1 | 59.8 s | 65.6 s | +9.7% | pass | pass |
| 3 | 48.0 s | 48.9 s | +1.9% | fail | fail |
| 5 | 44.8 s | 49.9 s | +11.4% | pass | fail |
| 10 | 96.7 s | 117.4 s | +21.4% | pass | pass |
| 11 | 188.0 s | 171.0 s | -9.0% | pass | fail |

The five-sample total increased from 437.3 s to 452.8 s (+3.5%), and relaxed
DRC fell from 4/5 to 2/5. A second probe confirmed the failure mode:

- sample 7 changed from 66.4 s / DRC pass to 110.1 s / DRC fail;
- sample 9 remained a DRC failure and changed only from 110.7 s to 109.2 s;
- samples 4 and 13 both still timed out at 300 s. Sample 4 reached exact DRC;
  sample 13 remained in high-density routing.

This rejects strict cost ordering. Lower cost alone is not a sufficient proxy
for detailed-routing difficulty; regional segment concentration and topology
also matter.

## Trial 2: tighten only the peak-cost envelope (accepted)

The final policy keeps complexity-aware selection and the existing 10%
total-cost band, but reduces permitted max-region-cost growth from 20% to 5%.
This preserves the downstream-friendly segment selector while rejecting large
peak-congestion regressions.

Only one completed SRJ18 activation-window case changes candidate:

| Sample | Metric | Merged policy | Tuned policy | Change |
| --- | --- | ---: | ---: | ---: |
| 3 | Max region cost | 1.736 | 1.142 | -34.2% |
| 3 | Total region cost | 14.896 | 11.997 | -19.5% |

Across the eight completed partial-rip cases from the merged SRJ18 benchmark,
the selected average max region cost falls from 1.268 to 1.194 (-5.9%) and the
average total region cost falls from 14.015 to 13.653 (-2.6%). All other
candidate selections are unchanged, including the timeout cases with a
complete global-routing candidate.

The sample-3 end-to-end canary retains completion and the same relaxed-DRC
failure. It completed in 48.0 s on the merged policy and in 48.9 s and 52.3 s
on two runs of the tuned topology. This case remains well below the completed
SRJ18 median, so the selection change does not move the suite P50 or approach a
timeout.

The route-count activation window remains 100-350. Stored full-holdout
telemetry shows maximum completed route counts of 70 for dataset01, 64 for
SRJ19, 62 for SRJ20, 16 for SRJ21, and 10 for preloaded SRJ23, so this tuning
does not alter those datasets.

## Validation notes

`bun run build` passes. The exhaustive local test run reported 501 passing, 57
skipped, and 5 failing tests. Replaying all five failures with the exact merged
20% max / 10% total envelope reproduced them unchanged, so none is introduced
by this tuning:

- dataset18 sample10 exact-DRC visual snapshot: 29.401% difference;
- bugreport51 visual snapshot: 67.469% difference;
- bugreport58 visual snapshot: 67.121% difference (its stitch-connectivity
  assertions pass);
- bugreport88 expects 3 relaxed-DRC errors, while merged main now produces 0;
- bugreport71 visual snapshot: 1.164% difference against a 1% threshold.
