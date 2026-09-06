# repair04: corrected sample006 and benchmark revalidation

The corrected sample006 final output has **one DRC error before repair and zero afterward**, including dedicated via-in-pad and via-to-pad checks. **Only one trace changes, and all ten vias are identical** in position, layers, copper diameter, drill, and ownership. Trace endpoints, widths, and non-trace geometry are unchanged.

![Corrected sample006 trace-only repair](repair04-sample006-corrected.svg)

The figure compares the complete baseline and V10 candidate outputs. The trace-only bounded pass accepts one region, then the normal downstream joint stage finishes the repair. The advanced pass skips the clean input. The adjacent metrics file binds this illustration to the actual frozen V10 output and its independent geometry audit; it is a one-board example, not a dataset improvement claim.

Repair04 defaults to same-layer trace movements with all vias fixed. Pipeline9 runs that pass immediately after repair03, then normal joint repair, followed by a bounded fallback only if expanded DRC still finds errors. The fallback explicitly allows relocation of identified offending existing vias and clear layer bridges. New or moved vias must clear every pad, including pads on the same net. Local and parent guards protect endpoints, boundary collars, widths, connectivity, and fixed copper.

## Withdrawn claim and complete rerun

The original V8 checker omitted `checkViasInPads` and `checkViaPadClearance`; its **5/15 and 8/37 passing totals are withdrawn**. The corrected V9 trace-only run completed with **0/15 → 1/15** passing on the current dataset and **0/37 → 1/37** on the older revision, including eight 30-minute candidate timeouts. That result does not meet the requested improvement.

A complete V10 run is underway on both unchanged dataset memberships. Every candidate must first reproduce its disabled baseline exactly. All failures and 30-minute timeouts remain in the denominator. Selected successes do not establish the requested target. Historical CSV/JSON and archives carrying V8 identities remain evidence of the incomplete checker only.

## Source and validation

- Frozen V10 solver: `fc78a05d4c65cb41dc38214bbeed5f4d5657055d` in [tscircuit/repair04](https://github.com/tscircuit/repair04).
- Frozen V10 integration: `0e9cd6f8f4d31a09439948fed6e7f0155290ad8c` in [PR #2420](https://github.com/tscircuit/tscircuit-autorouter/pull/2420), which remains draft.
- Replay bundle SHA-256: `87327ab808627d4635513fb8b5b3268f11451da8d01fb73f98293fd5371ad4cc`.
- Sample006 candidate SHA-256: `5759feedac35c8d677d4a5139f51be0541b4916d6c3b9649c50356c9529c2801`.
- Solver: 44 tests / 430 assertions and TypeScript checking pass. Autorouter: 18 focused tests / 165 assertions, TypeScript checking, and build pass.
- The dependency transport change pins the same repair03 source through its immutable codeload URL. The rebuilt benchmark executable remains byte-for-byte identical to the frozen V10 bundle.
- Linux CI's large bugreport94 fixture completed routing in 571.97 seconds and passed its four existing correctness assertions, including its limit of five default DRC errors; its changed SVG required review and updating. The local macOS run completed in 255.28 seconds with those assertions passing and snapshot update mode enabled. Neither result asserts zero expanded DRC errors. CI controls its 1,200-second per-test limit, with no timeout embedded in test code. Complete CI for the delivery commit is pending.
