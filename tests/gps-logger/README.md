# GPS logger XIN–ground contact reproduction

This test builds the complete 68 × 54 mm, two-layer GPS logger from TSX and runs
the repository's Pipeline9 implementation through core's `algorithmFn` API.
The board and its net connections are in the test; imported footprints and the
original `@tscircuit/common` RP2040 wrapper are in `fixtures/`.

From the repository root:

```sh
bun install
bun install --cwd tests/gps-logger --frozen-lockfile
bun test tests/gps-logger/pipeline9-gps-logger-xin-ground-contact.test.tsx --timeout 9999999
bunx tsc --noEmit -p tests/gps-logger/tsconfig.check.json
```

The isolated dependency package preserves the board's core/common versions
without changing the autorouter application's dependencies. The published
autorouter dependency satisfies core's peer imports; the test explicitly runs
the local Pipeline9 source for both phases.

The repro has a separate TypeScript project because the root project uses an
older core JSX schema. Its compiler resolves core to this package's dependency
and the autorouter to the local source under test, preventing duplicate global
JSX and solver-cache declarations from different package versions.

The RP2040 library declares the crystal-signals phase at index 0. Core then
routes the remaining connections in phase 1, carrying forward the first four
traces. This preserves the original board's phase behavior.

This is a characterization test of the existing bug: a passing test confirms
that the short is reproduced. With zero clearance, the checker finds one actual
copper contact at (-10.53400344, -5.47243052) mm. Both crossing segments are on
the top layer. After fixing the router, change the contact assertion to zero
and remove the short annotation.

Snapshots include each phase's input and output and the complete PCB. The cyan
PCB note marks the contact. It is a documentation overlay, not copper, and
does not change the electrical design. Phase output snapshots use the repo's
relaxed DRC renderer; the contact assertion uses zero clearance to distinguish
a physical short from a spacing violation. Other board DRC issues remain out
of scope for this reproduction.

To regenerate the snapshots intentionally:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/gps-logger/pipeline9-gps-logger-xin-ground-contact.test.tsx --timeout 9999999
```
