# Pilot experiment, 2026-09-28

The reports in this directory are a bounded integration comparison, not a production solve-rate or signal-integrity claim. Both runs use the 14-case pilot and scoring implementation at autorouter commit `43bf51debd074910672ea52b964e2ee45f9161e1`, Pipeline 7, effort 1, and a 30,000 ms per-sample wall-clock budget. The scorer preserves available routes even when later work times out.

The baseline uses `length-matching-solver` commit `e36fe8c225799855ae43ba54e7378ac1b5d16e61`; the candidate changes only that dependency to `db10d1c1ef2ca6bc48327bd444549a4bdd215680` (terminal-spacing fix, PR 73). No search-retention prototype is included. The dependency-lock difference was explicitly allowed, and all dataset/configuration/measurement hashes matched.

Both ran sequentially on Blacksmith testbox `tbx_01m3kxk1vy4kavh5st0y7dky46` (4-vCPU Ubuntu 24.04 ARM runner), Bun 1.4.2. The runtime API returned an unknown CPU model; the shared testbox identity establishes machine continuity for this experiment. Single-run timing differences are descriptive, not performance evidence.

The source core and Pico fixtures do not declare gap/uncoupled constraints. Their compliance result covers only declared constraints; it cannot establish coupling compliance. The Pico pilot sample is smoke coverage, not an untouched held-out evaluation. Known-infeasible barrier cases are reported separately from controls and unknown stress cases.

Later PR revisions format the same implementation and regenerate provenance metadata. That changes input/source/implementation byte hashes. To reproduce these historical reports, use commit `43bf51debd074910672ea52b964e2ee45f9161e1`; to compare a current checkout, create a fresh baseline with its current pilot and scorer. Do not bypass metric or dataset hash checks.

## Observed results

| Metric | Baseline | Terminal fix |
| --- | ---: | ---: |
| Available output | 11/14 | 11/14 |
| Solver completed | 9/14 | 9/14 |
| Timed out | 5/14 | 5/14 |
| Controls completed | 3/3 | 3/3 |
| Control segment pairs passing | 12/12 | 12/12 |
| Pair segments measured | 30/50 | 30/50 |
| Declared checks passing | 20/50 | 20/50 |
| Declared checks failing | 10/50 | 10/50 |
| Pair segments without metrics | 20/50 | 20/50 |
| P50 wall time | 9.095 s | 8.765 s |
| P95 wall time | 30.029 s | 30.028 s |

All 11 emitted output JSON files were byte-identical across the two runs. This pilot shows no quality or availability improvement from the terminal-only change; it does not negate the specific regression the solver PR fixes. Timing differences from these single runs do not support a speedup claim.

Both two-pair stress cases (`usb_c_series_template_p2_s1352840_00001` and `usb_c_series_template_p2_s1352840_00006`) retained pre-power copper checkpoints when they timed out. The three intentionally infeasible cases timed out without output. The other nine cases completed evaluation. No relaxed DRC errors were reported for measured outputs, while five timed-out cases had unknown DRC status; this is not a statement that all 14 cases passed clearance.

The machine was stopped after artifacts were downloaded. Reports here retain complete per-pair metrics, runtime settings, source/dataset/lock/scorer hashes and matched comparison rows. Full local artifacts were saved under `/tmp/pair-pilot-final-baseline-artifacts/pair-pilot-final-baseline` and `/tmp/pair-pilot-terminal-candidate-artifacts/pair-pilot-terminal-candidate`.
