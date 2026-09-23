# Pipeline 9 length matching ignores preloaded copper

Two new top-layer bus connections have lengths 10 mm and 12 mm and a maximum skew of 0.1 mm. An existing 8 mm wire lies beside the shorter connection. All six terminals have real pads. The fixture tests existing copper at y = 0.3 mm and y = 1 mm.

Before length matching, both boards pass the default relaxed DRC including continuity. The matcher receives ordinary obstacles but omits preloaded traces. Its meander then crosses the existing wire in the tight case and violates clearance in the roomier case. Both pipelines incorrectly report success. The snapshots below calculate their DRC counts from the actual output.

## Tight placement: crossing existing copper

![Unsafe tight placement](__snapshots__/pipeline9-length-matching-preloaded-clearance-tight-preload.snap.svg)

## Roomier placement: insufficient clearance

![Unsafe roomy placement](__snapshots__/pipeline9-length-matching-preloaded-clearance-roomy-preload.snap.svg)

## Failing safety test

`tests/features/pipeline9-length-matching-preloaded-clearance.test.ts` expresses the desired behavior and uses `test.failing` in this reproduction PR. Running it as an ordinary test fails at the tight-case assertion: `Expected substring: "exhausted all segment/tooth combinations"; Received function did not throw`. The pipeline published unsafe copper instead of reporting failure. The second case requires a successful board with zero DRC errors, preserved preloaded copper, and bus skew within 0.1 mm.

The separate snapshot test asserts the currently observed bug, so a snapshot mismatch cannot be hidden by the expected-failure marker. This PR changes no production code. The follow-up fix must remove the marker, update these snapshots, and describe the actual safe outcomes.

Run both tests with:

```sh
bun test --timeout 9999999 tests/features/pipeline9-length-matching-preloaded-clearance.test.ts tests/repro/pipeline9-length-matching-preloaded-clearance.test.ts
```

Validation: both tests pass with the expected-failure marker (10 assertions); the unmarked safety test fails as described; TypeScript checking passes. These are focused regressions, not a proof of the entire algorithm.
