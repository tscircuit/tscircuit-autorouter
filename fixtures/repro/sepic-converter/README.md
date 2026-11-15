# SEPIC converter clearance reproduction

Original board: https://tscircuit.com/gokul/sepic-converter (GokulPandi-M).
The board author supplied this reproduction. The SRJ is the unmodified phase-0
router input exported from the local board with `beta_pipeline9`, using tscircuit
0.0.3186 / core 0.0.2374 and parts-engine disabled. No generated routes are baked in.

Pipeline 9 finishes, but VCC (`U1.VIN–C5.1`) and GATE (`R4.2–R7.1`) have a bottom-layer
gap of 0.049 mm against the input's 0.1 mm rule. The test records the current defect;
replace the reproduction assertion with a clean-clearance assertion when fixed.
The full-board snapshot counts all relaxed DRC findings, including connection
findings; the close-up isolates this trace-clearance error using emitted copper.

Run `bun test tests/repro/sepic-converter-pipeline9-clearance.test.ts --timeout 9999999`.
The Cosmos fixture allows inspection of the routing stages.
