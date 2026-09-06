# Bug report 106: nRF52810 battery-pad short

This is the complete normal-phase autorouter input captured from core's
`nRF52810 tracker routes with implicit copper pours` test: 26 connections,
117 obstacles, and 6 preloaded traces. The SRJ preserves the original pads,
net identities, geometry, and preloaded copper. It is not a reduced node,
the original TSX design, or a board with post-routing copper pours applied.

## Inspect in Cosmos

Run `bun run start`, then open this bug-report folder in Cosmos. There are
three fixtures:

- `bugreport106-nrf52810-battery-pad-short-before`: the frozen Pipeline9
  0.0.885 output, including the SWDCLK via inside the bottom battery GND pad.
- `bugreport106-nrf52810-battery-pad-short-after`: the frozen output after
  overlap-only, layer-aware port distribution. This removes that battery-pad
  short, but it does not resolve every DRC error on the board.
- `bugreport106-nrf52810-battery-pad-short`: the live Pipeline9 debugger. Use
  its existing step, run, stage, and DRC controls to inspect the current code.
  Pipeline9 is explicitly constructed and its cache is disabled.

The frozen views are immediately available without rerouting. Use their native
graphics controls to zoom, pan, and inspect the top and bottom layers. Both
views combine the full input's preloaded traces with the captured routed
traces, respecting explicit replacement metadata, and display the relaxed DRC
count computed by the current checkout. Remaining errors are intentionally
visible; neither capture should be interpreted as a DRC-clean board.

The baseline has 3 relaxed DRC errors and the spacing fix has 1. These counts
exclude the separate via-to-pad clearance checker; other smaller clearance
violations remain. The focused regression checks the SWDCLK-to-battery-pad
physical short independently of that relaxed DRC count.

## Captured data

- `bugreport106-nrf52810-battery-pad-short.srj.json`: immutable full input.
- `before.json`: frozen baseline output and diagnostics.
- `after.json`: frozen spacing-fix output and diagnostics.

Each output capture records its source commit and input SHA-256, plus the
point-paired SRJ and newly routed traces. Compare the input hashes before
comparing outputs. The live debugger can differ from these frozen captures
as the autorouter evolves.

## Reproduce from the command line

Validated with Bun 1.3.8, matching CI. Run the full-board regression and its
before/after SVG snapshots:

```sh
bun test tests/bugs/bugreport106-nrf52810-battery-pad-short.test.ts --timeout 9999999
```

To route the same complete input through the current Pipeline9 and export
its native visual artifacts:

```sh
bun scripts/run-sample.ts \
  --pipeline 9 \
  --srj-path fixtures/bug-reports/bugreport106-nrf52810-battery-pad-short/bugreport106-nrf52810-battery-pad-short.srj.json \
  --ai-visuals \
  --out-dir /tmp/bugreport106-live
```

This reruns the current solver; it does not replace either frozen capture.

The underlying issue was a bottom-layer pad boundary suppressing redistribution
of top-layer ports. Two foreign-net ports were left only 0.025 mm apart,
forcing an invalid regional routing problem. The fix preserves existing ports
along obstacle boundaries unless different-net traces overlap on a layer where
the boundary obstacle is absent. It uses the minimum trace width already passed
into the solver and the existing uniform redistribution. On this board, only
one shared edge needs correction; safe ports and same-net overlaps stay fixed.
The small independent regression is
`tests/features/uniform-port-distribution-opposite-layer-pad.test.ts`.
