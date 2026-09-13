# Native full-board Game Boy Advance shorts

This is the unchanged input of a real TSCI build, not a selected region or
manually authored failing route. It has 137 connections, 452 obstacles, no
preloaded traces, two layers, and `allowBlindAndBuriedVias: false`.

## Capture provenance

- Captured on 2026-09-13 by `tsci build` in an isolated Game Boy Advance project.
- Published runtime: `tscircuit@0.0.2543`, `@tscircuit/cli@0.1.2071`,
  `@tscircuit/capacity-autorouter@0.0.900`; selected `beta_pipeline9`.
- Input SHA-256: `c643943210372a8c4e047a75846d8c5b42747cc2562d3f5c54f0a277084de5d4`.
- Original capture: `routing-dvdd3-outward-global-complete/phase-0.input.simple-route.json`.
- Source candidate differs from the preceding flat board only by moving
  `C_DVDD3` to world `(7.6, 13.9)`. U1, crystal, buttons, and connectors retain
  their preceding placements. No solver implementation or DRC rule was changed.
- This PR is based on upstream `61caa467faf2c488c168905f7fa332a3cd0e65e6`
  (`v0.0.905`). The test reroutes the capture with repository code; it does not
  import the captured output or install the earlier local fixes.

## Confirmed native-output faults in the published capture

The original native run completed with zero autorouting errors and 311 traces.
Core reported 333 errors; the independent all-layer Gerber check reported 53
short regions. Two of those regions were independently verified as real shorts:

1. `source_trace_254_0` (GPIO5 / RIGHT button) is a two-point TOP 0.1mm line
   from `(-52.599942, 2.249932)` to `(3.452845101, 15.417347686)`. It crosses
   U1's ground exposed pad for approximately 3.493mm. The input already has the
   correct TOP ground obstacle at `(0.2, 15.400127)`, size 3.3999932mm square;
   its ground aliases do not contain this GPIO connection.
2. QSPI clock `source_trace_55__source_trace_151_mst1_0` and QSPI data0
   `source_trace_51__source_trace_147_mst1_0` intersect on TOP at approximately
   `(3.412053775, 8.544569216)`. They are different electrical nets.

There is no via at either crossing. Blind-via layer interpretation therefore
does not explain these two shorts. Core retained the native route geometry;
the first solver stage that introduced it has not been identified. The other
51 reported short regions have not each been independently qualified.

## Reproduction and snapshot

One test solves the complete untouched SRJ with Pipeline9 and generates one
real `getBugReportSnapshotSvg` output snapshot. Its count is evaluated from the
fresh routes; no DRC count, failed geometry, or routed copper is hard-coded.
It uses the board's declared 0.13mm trace clearance. The remaining helper rules
are benchmark rules, not every Core, Gerber, electrical, or manufacturing check.

The fixture opens the same input in the native Pipeline9 debugger. Expensive
replays and snapshot generation are delegated to PR CI, not the local machine.
The first latest-main replay in CI returned solved, nonempty routes and wrote
the real snapshot, with **95 relaxed DRC errors**. The job then failed only
its 900,000ms test budget (actual test runtime about 910 seconds). The generated
SVG is copied unchanged from that CI artifact into the repo snapshot folder.
The dedicated CI-owned budget is now 1,200,000ms; ordinary tests and snapshot
comparisons are unchanged. A passing comparison on the new head is still pending.
The two original published-output crossings are not automatically assumed to
persist on latest main; the snapshot count is not a complete Core/Gerber gate.
This is a reproduction-only PR: no Core, Pipeline9, Repair03, Repair04, or
checks code fix.
