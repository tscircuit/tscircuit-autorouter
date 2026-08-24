# Bugreport 99: MangoPi Pipeline 9 pre-power connectivity

This reproduction records Pipeline 9 reaching power-trace expansion with
disconnected original endpoints on the six-layer MangoPi R3C recreation.

The full run used
`AutoroutingPipelineSolver9_PreloadedTraceGraph` with `effort: 1` and no cache
provider at package version `0.0.839` and revision
`9e8e897d47117c2d811030d9fbdc28099dcd7322`. It reached
`powerTraceExpansionSolver` and later reported the whole pipeline as solved.

## Captured artifacts

- `bugreport99-mangopi-r3c-pipeline9-connectivity.srj.json` is the exact,
  phase-free six-layer whole-board input. SHA-256:
  `5f4412c80e7feeaca193977bb22dabc779c8e0549154328a6e98b114a2fbf8df`.
- `bugreport99-mangopi-r3c-pipeline9-connectivity.power-expansion.constructor-args.json`
  is the exact constructor tuple captured at the transition into
  `powerTraceExpansionSolver`. SHA-256:
  `b5aebe80b7a7a80ee0c26f5aa5cd7585fcb8aae44e8f8bfb6f19420ad878ff93`.
  Its first tuple element is the authoritative pre-power SRJ.

The input contains 113 connections and 518 original endpoints. The captured
pre-power SRJ contains 405 traces and 519 via occurrences and represents every
connection name, but independent physical-copper validation finds only 107
connections and 502 endpoints connected. Six connections contain 16
disconnected endpoints: `source_net_0` (4), `source_net_1` (4),
`source_net_3` (2), `source_net_9` (1), `source_net_36` (3), and
`source_net_101` (2).

This captured output is invalid and is not fabrication-ready. This reproduction
stops at the Pipeline 9 pre-power boundary and does not test or diagnose the
power-trace-expander implementation.

## Validation

Run the captured-output test:

```sh
bun test tests/bugs/bugreport99-mangopi-r3c-pipeline9-connectivity.test.ts --timeout 9999999
```

The end-to-end solve is opt-in because the observed run took 1,122 seconds:

```sh
RUN_BUGREPORT99_MANGOPI_PIPELINE9=1 \
  bun test tests/bugs/bugreport99-mangopi-r3c-pipeline9-connectivity.manual.test.ts \
  --timeout 9999999
```
