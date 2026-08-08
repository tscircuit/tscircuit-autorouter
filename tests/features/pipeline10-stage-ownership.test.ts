import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_ApproximateHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/AutoroutingPipelineSolver10_ApproximateHypergraph"
import { ApproximateMultiGraphTopologyPlannerSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateMultiGraphTopologyPlannerSolver"
import { TinyHypergraphRegionPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/TinyHypergraphRegionPathingSolver"
import { ApproximateHighDensityRouteSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateHighDensityRouteSolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline10 approximates global topology and keeps exact local topology and post-processing", () => {
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

  expect(stageNames).toContain("componentDetectionSolver")
  expect(stageNames).toContain("topologyPlanningSolver")
  expect(stageNames).toContain("topologyMergingSolver")
  expect(stageNames).toContain("nodeDimensionSubdivisionSolver")
  expect(stageNames).toContain("approximateLayerTransitionSolver")
  expect(stageNames).toContain("approximatePortPointLimiterSolver")
  expect(stageNames).toContain("exactGeometryDrcForceImproveSolver")
  expect(
    solver.pipelineDef.find(
      (stage) => stage.solverName === "topologyPlanningSolver",
    )?.solverClass,
  ).toBe(ApproximateMultiGraphTopologyPlannerSolver)
  expect(
    solver.pipelineDef.find(
      (stage) => stage.solverName === "portPointPathingSolver",
    )?.solverClass.name,
  ).toBe(TinyHypergraphRegionPathingSolver.name)
  expect(
    solver.pipelineDef.find(
      (stage) => stage.solverName === "highDensityRouteSolver",
    )?.solverClass.name,
  ).toBe(ApproximateHighDensityRouteSolver.name)
  expect(stageNames.indexOf("approximateLayerTransitionSolver")).toBe(
    stageNames.indexOf("highDensityStitchSolver") + 1,
  )
  expect(stageNames.indexOf("approximatePortPointLimiterSolver")).toBe(
    stageNames.indexOf("necessaryCrampedPortPointSolver") + 1,
  )
})
