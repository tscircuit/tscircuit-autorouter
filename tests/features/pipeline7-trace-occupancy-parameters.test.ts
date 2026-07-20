import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type TinyRoutingDimensions = {
  minTraceWidth?: number
  minTraceClearance?: number
}

type InspectableTinyPipelineSolver = {
  tinyPipelineSolver: {
    inputProblem: {
      solveGraphOptions?: TinyRoutingDimensions
      sectionSolverOptions?: TinyRoutingDimensions
    }
  }
}

const getPortPointPathingParams = (): HgPortPointPathingSolverParams => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    defaultObstacleMargin: 0.22,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  })
  const portPointPathingStep = solver.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  )
  if (!portPointPathingStep) {
    throw new Error("Pipeline 7 is missing the port-point pathing stage")
  }

  const solverContext = Object.assign(solver, {
    capacityNodes: [],
    srjWithPointPairs: solver.srj,
    availableSegmentPointSolver: { getOutput: () => [] },
  })
  const [params] = portPointPathingStep.getConstructorParams(solverContext)
  return params as HgPortPointPathingSolverParams
}

test("Pipeline 7 passes physical trace dimensions to occupancy scoring", () => {
  const params = getPortPointPathingParams()
  expect(params.minTraceWidth).toBe(0.15)
  expect(params.minTraceClearance).toBe(0.22)

  const tinySolver = new TinyHypergraphPortPointPathingSolver(
    params,
  ) as unknown as InspectableTinyPipelineSolver
  const { solveGraphOptions, sectionSolverOptions } =
    tinySolver.tinyPipelineSolver.inputProblem
  expect(solveGraphOptions?.minTraceWidth).toBe(0.15)
  expect(solveGraphOptions?.minTraceClearance).toBe(0.22)
  expect(sectionSolverOptions?.minTraceWidth).toBe(0.15)
  expect(sectionSolverOptions?.minTraceClearance).toBe(0.22)
})
