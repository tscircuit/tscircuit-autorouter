import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 dataset01 circuit143 clears every routed trace", () => {
  const circuit143 = (dataset01 as Record<string, unknown>)
    .circuit143 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit143),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.srjWithPointPairs).toBeDefined()
  expect(
    solver.exactGeometryDrcForceImproveSolver?.stats.finalDrcIssueCount,
  ).toBe(0)
  expect(
    solver.exactGeometryDrcForceImproveSolver?.stats
      .drcBranchPortfolioBroadInitialDrcIssueCount,
  ).toBeUndefined()
  expect(
    solver.exactGeometryDrcForceImproveSolver?.stats
      .drcBranchPortfolioBroadBranchAttempted,
  ).toBe(false)

  const { errors } = evaluateRelaxedDrc({
    inputSrj: circuit143,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(errors).toHaveLength(0)
})
