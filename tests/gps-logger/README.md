# GPS logger routing reproduction

The complete board TSX and one test live in
`pipeline9-gps-logger-xin-ground-contact.test.tsx`. The test runs local Pipeline9,
checks for one physical XIN–ground short, and saves one full-board bug-report SVG.
The bug-report SVG shows routed copper and the measured relaxed DRC count.
Imported component footprints retain
the original board geometry; this is a full-board reproduction, not a reduced circuit.

```sh
bun install
bun install --cwd tests/gps-logger --frozen-lockfile
bun test tests/gps-logger/pipeline9-gps-logger-xin-ground-contact.test.tsx --timeout 9999999
bunx tsc --noEmit -p tests/gps-logger/tsconfig.check.json
```

The separate dependency package and TypeScript project preserve the board’s
core/common versions without replacing the repository’s older core dependency.
The test invokes this repository’s Pipeline9 source, not the published router.
It retains the RP2040 library’s crystal phase and core’s remaining-net phase.
Zero-clearance checking distinguishes a physical short from a spacing violation.

To regenerate the snapshot, prefix the test command with `BUN_UPDATE_SNAPSHOTS=1`.
