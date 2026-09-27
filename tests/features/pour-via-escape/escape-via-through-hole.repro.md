# Ground-plane escape vias ignore the physical through-hole span

This repro exercises `EscapeViaLocationSolver` directly. It does not run
full-board routing and makes no changes to the solver.

The input has a four-layer board with `allowBlindAndBuriedVias: false`, one
1 × 1 mm top-side GND pad, an inner1 GND pour, and one bottom-layer SIGNAL
copper rectangle representing a pre-routed 0.2 mm trace. Vias have 0.30 mm
holes and 0.60 mm copper, with a required 0.20 mm via-to-copper clearance.

From the repository root, after installing dependencies:

```sh
bun test --timeout 9999999 tests/features/pour-via-escape/escape-via-through-hole-*.test.ts
```

Expected on the affected source: **three passing tests**, including two
`test.failing` cases whose assertions reproduce the known defects. The blind-via
control uses an ordinary `test`. Once the solver is fixed, the `test.failing`
cases report unexpected passes; change them to ordinary `test` cases with the fix.

- `layers`: the generated escape-via obstacle must reserve `top`, `inner1`,
  `inner2`, `bottom`, with z-indices `[0, 1, 2, 3]`.
- `bottom-clearance`: the physical via must clear the existing bottom signal
  by at least 0.20 mm. A different valid candidate is available.
- `blind-control`: with blind/buried vias explicitly enabled, the top-to-inner1
  via may occupy the same XY position as bottom copper because it does not
  physically reach that layer.

Observed on upstream `34dc48b` (v0.0.938): the through-hole case places the
via at **(-1, 0) mm**, on the bottom signal's centreline. The escape obstacle
contains only `layers: ["top", "inner1"]` and `__zLayers: [0, 1]`.
`pointToBoxDistance(via.center, bottomSignal) - 0.30` returns **-0.30 mm**,
so the physical via overlaps the signal instead of meeting the 0.20 mm rule.
The same input with blind vias enabled passes the control.

Two decisions currently use only the logical source-to-pour layer span:
`getViaSpanLayers()` (obstacle reservation) and `getMinBlockingClearance()`
(candidate validation). Consequently, existing bottom copper is ignored,
and downstream routing also receives no bottom-layer obstacle for a via
that will physically be through-hole. The repro demonstrates the reservation
and placement errors; it does not claim to simulate a completed fabrication
export or a newly routed crossing trace.
