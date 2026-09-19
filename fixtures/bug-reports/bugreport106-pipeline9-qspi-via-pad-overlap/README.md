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

## Visual snapshot

```sh
bun test tests/bugs/bugreport106-pipeline9-qspi-board.test.ts --timeout 9999999
```

The test renders the complete board after power-trace expansion, including
preloaded copper. It snapshots the final routing candidate even if subsequent
validation rejects it, allowing the same test to show before/after geometry in
stacked fix PRs. The overlay uses benchmark relaxed DRC rules, not this board's
stricter via-to-pad rule.

Review `tests/bugs/__snapshots__/bugreport106-pipeline9-qspi-board.snap.svg`
in GitHub's rendered image diff. To intentionally update it after routing changes:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/bugs/bugreport106-pipeline9-qspi-board.test.ts --timeout 9999999
```

## Clearance repair

Pipeline9 now runs repair03 coordinate optimization inside its existing joint DRC
repair solver, before length matching and power-trace expansion.
It moves nearby vias and trace bends together while preserving fixed copper,
terminals, widths, layers, and immutable through-obstacle primitives. Already
movable preloaded sections remain repairable through the joint solver's existing
section reconstruction. Repair02 receives the board's distinct
trace-to-pad and via-to-pad rules earlier in the pipeline.

The final routed board has zero relaxed DRC errors and passes the separately
requested 0.25 mm via-to-pad and 0.16 mm trace-to-pad rules. Final validation still
reports failure if clearance violations remain; the snapshot does not hide
rejected candidates. The historical `--observed` reproduction continues to fail
on the original copper, while the local-source reproduction now passes.

No additional pipeline stage is introduced. The power expander did not change
any traces or DRC errors for this reproduction; the existing repair solver now
clears the residual violations before downstream processing.

The coordinate search is bounded and adds runtime on difficult boards.

Same-net SMT pads are included in via clearance checks in coordinate repair and
final validation. Earlier relaxed-only checks missed five via-copper overlaps
on this candidate. The independent geometry audit checks copper edges against
pad rectangles, with the DRC engine's existing 0.005 mm clearance tolerance.
No tolerance is applied when counting physical via-pad overlaps.

Repair also uses clearance-checked shortcuts and a single bounded local wire
refinement pass around residual contacts. Coordinate updates cannot increase
trace-centerline intersections. The visual test requires final solver success,
so a zero relaxed-DRC overlay alone cannot hide a rejected board.
