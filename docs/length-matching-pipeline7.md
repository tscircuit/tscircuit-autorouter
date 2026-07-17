# Pipeline 7 length matching

Pipeline 7 owns the integration boundary; the standalone algorithm lives in
`@tscircuit/length-matching-solver`.

The stage order is:

1. `highDensityStitchSolver` produces routed point samples.
2. `traceSimplificationSolver` removes redundant route samples and preserves
   route geometry.
3. `lengthMatchingSolver` receives `simplifiedHdRoutes` and emits matched
   routes.
4. `traceWidthSolver` consumes `matchedHdRoutes`.

The integration is defined in
`lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph.ts`
around the `lengthMatchingSolver` pipeline step. Differential-pair input is
typed by `lib/types/srj-types.ts` and uses a numeric `lengthTolerance` in mm.

For solver internals, use the standalone package’s
`lib/length-matching/README.md` and `straight-route-spans.ts` code map. A
debug JSON exported as `{ input, options }` must be unwrapped to `.input` before
passing it to `scripts/run-sample.ts`; the runner accepts SimpleRouteJson, not
the outer API request envelope.
