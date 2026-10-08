# STM32 SRAM bus allowedLayers is ignored

Real input captured from the control-bus autorouting phase of an STM32F407 +
IS61WV51216BLL board. This is the five-control-net phase, not the full routed
memory bus. The four-layer stack reserves the inner layers for planes; the
CONTROL bus requests `allowedLayers: ["top", "bottom"]` (exported from
`pcbAllowedLayers` in tscircuit). Existing supply/fanout copper is included.

## Reproduce

```sh
bun install --frozen-lockfile
bun test --timeout 9999999 tests/bugs/stm32-sram-bus-allowed-layers.test.ts
```

On main commit `9336cd949fb478669628d74620bfc4135c9ff087`, Pipeline9 reports
success, but emits **24 nonzero lateral wire segments** on
`inner1`/`inner2`. Changing allowedLayers to all four layers produces the same
output. The restriction is present in SRJ after point pairing, but never
reaches the path planner's traversal rules. This is a P1 silent constraint
violation: signal copper occupies the intended dedicated plane layers.

The repro test asserts that forbidden copper is present so CI passes while
the bug is reproducible. The stacked fix retains an expected-failure test
for the desired zero-violation behavior and separately tests explicit rejection.

The checked-in SVG is generated from this exact input and the solver's newly
routed traces using `getBugReportSnapshotSvg`. Existing copper is included,
the relaxed DRC count is computed, and no soldermask is rendered. The overlay
does not check allowedLayers; the test checks that constraint separately.

Local reproduction: 3.85 seconds for the test body (timing varies by machine).
This report concerns layer enforcement only, not SRAM timing or length matching.

## Minimal guard

The stacked fix checks routed bus copper before reporting success and throws
if a wire occupies a forbidden layer. Valid restricted routes remain accepted.
It does not implement constrained routing. The desired-routing regression remains
`test.failing`; a separate test checks the exact rejection and accepts absent
restrictions or an explicit list containing every board layer. The snapshot
above remains the original failing routing, not a fabricated corrected board.
