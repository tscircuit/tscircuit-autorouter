import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_ApproximateHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/AutoroutingPipelineSolver10_ApproximateHypergraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline10 replaces exact topology stages and keeps exact post-processing", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "source_trace_1",
        pointsToConnect: [
          { x: 1, y: 1, layer: "top" },
          { x: 9, y: 9, layer: "top" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver10_ApproximateHypergraph(srj, {
    approximateCellSize: 4,
    approximateMaxPortsPerLayerPerEdge: 3,
  })
  const stageNames = solver.pipelineDef.map((stage) => stage.solverName)

  expect(stageNames).toContain("approximateHypergraphTopologySolver")
  expect(stageNames).toContain("approximateLayerTransitionSolver")
  expect(stageNames).toContain("exactGeometryDrcForceImproveSolver")
  expect(stageNames).not.toContain("topologyPlanningSolver")
  expect(stageNames).not.toContain("topologyMergingSolver")
  expect(stageNames).not.toContain("nodeDimensionSubdivisionSolver")
  expect(stageNames.indexOf("approximateLayerTransitionSolver")).toBe(
    stageNames.indexOf("highDensityStitchSolver") + 1,
  )
})
