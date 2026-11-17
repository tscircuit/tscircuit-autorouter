import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { getH616PlaneContinuityFixture } from "tests/fixtures/getH616PlaneContinuityFixture"

test("external plane connectivity requires every emitted escape via", (): void => {
  const fixture = getH616PlaneContinuityFixture()
  const evaluate = createPipeline9AutoroutingDrcEvaluator(fixture)
  expect(evaluate(fixture.routedTraces).errors).toEqual([])
  for (const omitted of fixture.routedTraces) {
    const traces = fixture.routedTraces.map((trace) =>
      trace === omitted
        ? {
            ...trace,
            route: trace.route.filter((point) => point.route_type !== "via"),
          }
        : trace,
    )
    expect(
      evaluate(traces).errors.some((error) => error.type === "pcb_trace_error"),
    ).toBeTrue()
  }
})
