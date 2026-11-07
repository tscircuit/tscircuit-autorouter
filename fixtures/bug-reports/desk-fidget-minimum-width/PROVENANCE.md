# Desk fidget counter: connection minimum widths

`input.srj.json` is the complete, unmodified Pipeline9 request saved while
routing [rushabhcodes/desk-fidget-counter](https://github.com/rushabhcodes/desk-fidget-counter),
revision D, on 2026-11-04. It comes from
`dist/autorouter-debug/native1/phase-0.input.simple-route.json` in that project's
local debug output. The capture predates this minimum-width implementation.

- Input SHA-256: `708157dcfe01a080e89ca5648510b9924fe2bebdb7fa466aa3a0c40ec8d75ea5`.
- 2 layers, 44 connection directives, 260 obstacles, no preloaded traces.
- Original board minimum: 0.10 mm; nominal connection widths: 0.10, 0.15,
  and 0.25 mm.
- Original capture: core 0.0.2265, `beta_pipeline9`, effort 1, no cache hit.

The reproduction retains the board outline, holes, component pads, every
connection, and all manufacturing clearances. It does not crop the board or
substitute a hand-built channel. The opt-in variant adds `minTraceWidth: 0.15`
to the four existing 0.15 mm local connections (`source_trace_79`,
`source_trace_81`, `source_trace_83`, and `source_trace_84`). All existing nominal
widths remain unchanged. The 0.25 mm nominal requests remain advisory.

Connected directives merge before point pairing, so the 0.15 mm hard minimum
also applies to the associated merged net and its branches. This is intentional
and is the public contract, rather than a constraint on only the four short
segments. The original input remains available separately from that opt-in
adaptation so both policies can be reproduced against the same physical board.

`before.traces.json` is the unmodified native output saved with the full-board
request (127 traces). Its SHA-256 is
`64f58cb261575a434363ae12e460d8bc1e65d3163f0a1448d9fc4078afa9fa6d`.
Both ends of the VSSA connection are on 0.10 mm copper in that capture. The
historical snapshot renders all of this copper and reports its relaxed DRC
count; it is not a claim of manufacturing readiness.

## Exact VSSA routing phase

`vssa-phase.input.srj.json` is a second unmodified capture, from
`dist/autorouter-debug/native3/phase-3.input.simple-route.json`, also on
2026-11-04. It is the original `Decoupling 4` request, not a synthetic fixture:
261 obstacles, three existing native traces, two layers, and the
`source_trace_79` connection from the VSSA pad at (25.95, -4.15) to the
capacitor pad at (25.375, -6.4). Its SHA-256 is
`3378a95a789c3770aa7ffe48f4e540a6be122f6aed3ee501f2d3f45b466e30bb`.
The opt-in factory adds only `connection.minTraceWidth: 0.15`.

## Results and limits

- The VSSA phase succeeds with every newly emitted wire at least 0.15 mm,
  connected terminals, unchanged preloaded copper, and zero relaxed DRC errors.
  Its native snapshot shows the complete board. This is a successful scoped
  routing phase, not a successful reroute of all 44 full-board directives.
- The complete board with all four hard minima reaches detailed routing but
  fails in `TraceWidthSolver`: a merged ground-net branch cannot meet 0.15 mm
  with the required clearance. The regression requires that failure and verifies
  that the output API refuses to return a successful result. No failure or
  clearance is suppressed to obtain a passing full-board result.
- The historical full-board output is evidence of the original symptom. It
  comes from a different routing request than the successful VSSA-only phase;
  the two images must not be described as a whole-board before/after fix.

Both requests have interactive `*.fixture.tsx` debugger entries in this folder.
Run the regressions with:

```sh
bun test --timeout 9999999 \
  tests/repro/pipeline9-desk-fidget-vssa-minimum-width.test.ts \
  tests/repro/pipeline9-desk-fidget-minimum-width-rejection.test.ts
```

The full-board request exposed expensive repeated obstacle scans in the opt-in
planner. The implementation indexes rotated obstacle envelopes plus their
declared pad/hole clearance, then applies the same exact shape, layer, and
connectivity checks to nearby obstacles. The rotated-obstacle regression checks
that the index retains geometry extending beyond an obstacle's stored width.
