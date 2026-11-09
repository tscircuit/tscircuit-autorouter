# Desk-fidget counter: complete-board minimum-width reproduction

`input.srj.json` is the complete Pipeline9 request captured while routing
[rushabhcodes/desk-fidget-counter](https://github.com/rushabhcodes/desk-fidget-counter),
revision D, on 2026-11-04. The source is
`dist/autorouter-debug/native1/phase-0.input.simple-route.json` from that project's
local output (core 0.0.2265, `beta_pipeline9`, effort 1, no cache hit).

The committed JSON uses one obstacle or connection per line for review. Every
JSON value is retained, including all 44 connection directives, 260 obstacles,
two layers, board outline, holes, pad identities, and manufacturing clearances.

- Original capture SHA-256:
  `708157dcfe01a080e89ca5648510b9924fe2bebdb7fa466aa3a0c40ec8d75ea5`.
- Committed layout SHA-256:
  `3eb36b73c20c7410a80a788e48bb277198a7c4dc8e34c93afc62037125881bf5`.

The `minimum` factory adds only `connection.minTraceWidth: 0.15` to the four
existing 0.15 mm requests: `source_trace_79`, `source_trace_81`,
`source_trace_83`, and `source_trace_84`. Nominal preferences stay unchanged.
The proposed minimum uses a test-local type until the implementation supports it.

The full solver runs in the regression. Before the implementation, it completes
all routing with zero relaxed DRC errors while emitting 0.10 mm at both VSSA
terminals despite the explicit 0.15 mm minimum. The snapshot is live solver output
from this complete request, rather than historical copper or a scoped routing
phase. The implementation updates the same regression and snapshot.

```sh
bun test --timeout 9999999 tests/repro/pipeline9-desk-fidget-minimum-width.test.ts
```

The adjacent `*.fixture.tsx` opens the same request in the interactive debugger.
