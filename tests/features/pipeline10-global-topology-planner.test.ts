import { expect, test } from "bun:test"
import { ApproximateMultiGraphTopologyPlannerSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateMultiGraphTopologyPlannerSolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline10 bounds the global topology without constructing discarded grid edges", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [],
  }
  const solver = new ApproximateMultiGraphTopologyPlannerSolver({
    inputSrj: srj,
    componentDetectionOutput: [],
    targetCellSize: 5,
  })

  solver.solve()
  const output = solver.getOutput()
  const approximateOutput =
    solver.approximateGlobalTopologySolver?.getOutput()

  expect(solver.pipelineDef.map((stage) => stage.solverName)).toEqual([
    "approximateGlobalTopologySolver",
    "componentTopologyBatchSolver",
  ])
  expect(output.globalMeshNodes).toHaveLength(4)
  expect(output.componentMeshNodes).toEqual([])
  expect(approximateOutput?.capacityMeshEdges).toEqual([])
  expect(approximateOutput?.sharedEdgeSegments).toEqual([])
})
