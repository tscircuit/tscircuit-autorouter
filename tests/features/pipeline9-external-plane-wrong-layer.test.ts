import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { getH616PlaneContinuityFixture } from "tests/fixtures/getH616PlaneContinuityFixture"

test("an escape via must physically span the declared plane layer", (): void => {
  const fixture = getH616PlaneContinuityFixture()
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    ...fixture,
    inputSrj: { ...fixture.inputSrj, allowBlindAndBuriedVias: true },
  })
  const traces = fixture.routedTraces.map((trace) => ({
    ...trace,
    route: trace.route.map((point) =>
      point.route_type === "via" && point.from_layer === "top"
        ? { ...point, to_layer: "inner1" }
        : point,
    ),
  }))
  expect(
    evaluate(traces).errors.some((error) => error.type === "pcb_trace_error"),
  ).toBeTrue()
})
