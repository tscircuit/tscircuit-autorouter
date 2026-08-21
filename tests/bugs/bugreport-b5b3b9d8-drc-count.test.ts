import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport-b5b3b9d8/bugreport-b5b3b9d8.json" with {
  type: "json",
}

type CircuitJson = ReturnType<typeof convertToCircuitJson>

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport-b5b3b9d8 pipeline7 records current total DRC errors", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    {
      cacheProvider: null,
    },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.exactGeometryDrcForceImproveSolver?.stats
      .pipeline7AdaptiveExactDrcFastProbeAttempted,
  ).toBe(true)
  expect(
    solver.exactGeometryDrcForceImproveSolver?.stats
      .pipeline7AdaptiveExactDrcFastProbeAccepted,
  ).toBe(true)
  expect(
    solver.exactGeometryDrcForceImproveSolver?.stats
      .pipeline7AdaptiveExactDrcFastProbeDrcIssueCount,
  ).toBe(0)

  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("Pipeline7 did not produce point-pair SRJ")
  }

  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  const circuitJson: CircuitJson = convertToCircuitJson(
    srjWithPointPairs,
    simplifiedTraces,
    { minTraceWidth: srj.minTraceWidth },
  )

  const { errors } = getDrcErrors(circuitJson, {
    traceClearance: 0.1,
    viaClearance: 0.1,
  })

  expect(errors).toHaveLength(0)
})
