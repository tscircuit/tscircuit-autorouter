import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { getH616PlaneContinuityFixture } from "tests/fixtures/getH616PlaneContinuityFixture"

test("same-net escapes into separate plane islands remain disconnected", (): void => {
  const fixture = getH616PlaneContinuityFixture()
  const anchors =
    fixture.srjWithPointPairs.connections[0]!.externallyConnectedPointIds![0]!
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    ...fixture,
    srjWithPointPairs: {
      ...fixture.srjWithPointPairs,
      connections: fixture.srjWithPointPairs.connections.map((connection) => ({
        ...connection,
        externallyConnectedPointIds: [anchors.slice(0, 2), anchors.slice(2)],
      })),
    },
  })
  expect(
    evaluate(fixture.routedTraces).errors.some(
      (error) => error.type === "pcb_trace_error",
    ),
  ).toBeTrue()
})
