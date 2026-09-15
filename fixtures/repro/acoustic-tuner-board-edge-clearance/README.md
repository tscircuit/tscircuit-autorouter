# Acoustic tuner Pipeline 9 board-edge clearance repro

A fresh Pipeline 9 route requests **0.3 mm** of copper-to-board-edge clearance,
but finishes with a **0.261160 mm** gap at the via on `source_trace_67`
(**U2.PB4 → R12.pin1**). This reproduction records the current defect without
changing router behavior.

## Input and captured board

`input.srj.json` preserves the complete `routing-cache/input.json` from
[gokul/acoustic-guitar-tuner](https://tscircuit.com/gokul/acoustic-guitar-tuner)
version **1.0.10**, release `db07d87c-f403-458a-a9ba-7c2e676651d0`.
It contains the guitar outline, two layers, a 0.3 mm board-edge rule,
0.6 mm via copper pads, and 0.3 mm via drills.

The published board uses saved traces and a custom router that requests a
0.6 mm routing margin when rerouting. This test bypasses that adapter and routes
the original input directly at its declared 0.3 mm rule. It does not report a
violation in the published saved layout.

`tests/repro/assets/acoustic-tuner-rerouted-board.circuit.json.gz` captures the
0.3 mm reroute with **71 traces and 60 vias**. It combines the published board's
component/pad/outline data with the fresh routing output. Published traces,
vias, and copper pours were removed before inserting the rerouted copper;
source and endpoint metadata were attached without changing route geometry.

## Tests and snapshot

- `acoustic-tuner-board-edge-clearance.test.ts` runs the complete pipeline with
  caching disabled, checks the before/after clearance and official board-edge
  diagnostics, and compares captured route points with fresh output. Coordinates
  and trace dimensions match to six decimal places in millimeters to tolerate
  platform rounding (less than 0.0000005 mm); other fields still match exactly.
- `acoustic-tuner-rerouted-board.test.ts` checks the captured board's one
  copper-to-board-edge violation and its full-board PCB SVG snapshot. It uses
  `convertCircuitJsonToPcbSvg` with a dark background and default PCB colors.

The tests pass when they reproduce the current defect. A future router fix
should update these assertions to require zero board-edge violations.

```sh
bun install
bun test tests/repro/acoustic-tuner-board-edge-clearance.test.ts tests/repro/acoustic-tuner-rerouted-board.test.ts --timeout 9999999
```

Run `bun run start` to open the adjacent Cosmos fixture. The affected via is
near **x = -3.94, y = 17.19 mm** on the left side of the neck.

Update only the full-board snapshot with:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/repro/acoustic-tuner-rerouted-board.test.ts --timeout 9999999
```

## Recorded result

Reproduced against `61caa467faf2c488c168905f7fa332a3cd0e65e6` (version `0.0.905`).
The change first appears in `globalDrcForceImproveSolver` and remains in the
final output. The via is physically inside the board but violates its edge rule.

| Measurement (mm) | Before global repair | Final output |
| --- | ---: | ---: |
| Via center x | -3.899999 | -3.9388401191 |
| Via center y | 17.1531975045 | 17.1943297209 |
| Copper-to-outline gap | 0.300001 | 0.2611598809 |

The nearby edge is at **x = -4.5 mm**. The final gap is
`-3.9388401191 - (-4.5) - 0.6 / 2 = 0.2611598809 mm`,
which is **0.0388401191 mm** below the required clearance.

SHA-256 of the original SRJ:
`23952a7290bd26f5d4cf098dfbc41f6a12d801822f9dde226fc3ba624adc136e`.
SHA-256 of the decompressed captured Circuit JSON:
`e99968104b44bd2128033b10bfb2758f055b93b8ba30e8fa8bdf4be7f29b8ada`.
