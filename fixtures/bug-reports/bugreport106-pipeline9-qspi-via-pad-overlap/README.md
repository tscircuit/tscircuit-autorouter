# Pipeline9 QSPI via overlaps an unrelated pad

Reproduction for [tscircuit-autorouter#2654](https://github.com/tscircuit/tscircuit-autorouter/issues/2654).
The input and observed output are copied unchanged from the issue's
[standalone reproduction](https://gist.github.com/seveibar/d78acb4f2763c9897865e59624ba56d9).
The reported package version is `@tscircuit/capacity-autorouter@0.0.913`.

## Run from the repository root

```sh
bun install
bun fixtures/bug-reports/bugreport106-pipeline9-qspi-via-pad-overlap/repro.ts
```

This runs the **local repository's Pipeline9 implementation** with only the
frozen SRJ argument, calls `solve()`, and checks the returned QSPI signal vias
against the unrelated top-layer QSPI clock pad using circle-to-rectangle geometry.
It asserts that routing completes successfully before checking clearance, so a
solver failure is reported separately from the copper-overlap assertion.

To check the original output without installing dependencies or rerouting:

```sh
bun fixtures/bug-reports/bugreport106-pipeline9-qspi-via-pad-overlap/repro.ts --observed
```

The observed-output command intentionally exits nonzero: it finds one clearance
violation with an edge gap of **-0.05171897054665231 mm**, meaning actual copper
overlap. The requested gap is **0.25 mm**. The script is an opt-in reproduction,
not part of the passing test suite. It checks this specific net/pad pair, not
all design rules on the board.

For interactive inspection, run `bun run start` and select
`bugreport106-pipeline9-qspi-via-pad-overlap`. The fixture explicitly uses
`AutoroutingPipelineSolver9_PreloadedTraceGraph` with the single-argument
constructor used in the original report.

## Reported geometry

| Item | Value |
| --- | --- |
| Via connection | `source_trace_30` |
| Via center | `(-1.2216725382888756, 4.4736739554613045)` mm |
| Via copper diameter | `0.45` mm |
| Returned via span | `top` to `inner2` |
| Unrelated pad | `pcb_smtpad_87` / `pcb_port_91` / `QSPI_SCLK` |
| Pad connection | `source_trace_34` |
| Pad center | `(-1.0002500000000003, 3.92505)` mm |
| Pad size and layer | `0.2 × 0.85` mm, top |

Expected: a solved route respects the requested clearance; if it cannot do so,
the router reports failure instead of returning overlapping copper as solved.
The reported result is `solved: true`, `failed: false` with the overlap above.
The overlap check uses the shared top layer and is independent of the separate
question of the returned via's layer span.

## Input provenance

This is one frozen `core-and-debug` phase from a compact RP2040 programmer:
4 layers, 47 connections, 235 obstacles, and 5 preloaded traces from the crystal
phase. It is not a minimized layout. No board source, registry parts, credentials,
or custom solver options are required.

Input SHA-256:
`d9c800d0cac2e76bc51456de13f168f53ac4812f306c39021c99172c9f96ae76`.

The gist pins the original published package for historical reproduction;
the fixture and default command here exercise the repository source for debugging.

Validated against repository commit `a9bb99bd` using Bun 1.4.2 on macOS arm64:
both the live solve and the frozen-output check reproduce the exact coordinates
and negative gap above. The live solve returns `solved: true`, `failed: false`.

## Conservative fix

The final via-to-pad validation now reports `failed: true` when routing leaves
violations of the explicitly requested rule. It exposes the findings through
`solver.viaPadClearanceErrors` and prevents retrieving unsafe output as a solved
result. This board still needs further routing work. The historical script above
now stops at its solver-status assertion; the regression test checks the new
failure behavior:

```sh
bun test tests/bugs/bugreport106-pipeline9-qspi-via-pad-clearance.test.ts --timeout 9999999
```
