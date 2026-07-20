import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline7 always includes post-DRC simplification", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    obstacles: [],
    connections: [],
  } as SimpleRouteJson
  const oneX = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    effort: 1,
    cacheProvider: null,
  })
  const higherEffort = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    effort: 2,
    cacheProvider: null,
  })
  const oneXStage = oneX.pipelineDef.find(
    (entry) => entry.solverName === "postDrcTraceSimplificationSolver",
  )
  const higherEffortStage = higherEffort.pipelineDef.find(
    (entry) => entry.solverName === "postDrcTraceSimplificationSolver",
  )

  expect(oneXStage?.solverClass).toBe(higherEffortStage?.solverClass)
  expect(oneXStage?.solverClass).toBe(TraceSimplificationSolver)
  expect(oneX.pipelineDef.map((stage) => stage.solverName)).toEqual(
    higherEffort.pipelineDef.map((stage) => stage.solverName),
  )

  for (const solver of [oneX, higherEffort]) {
    const exactDrcStage = solver.pipelineDef.find(
      (stage) => stage.solverName === "exactGeometryDrcForceImproveSolver",
    )!
    const [params] = exactDrcStage.getConstructorParams({
      ...solver,
      srjWithPointPairs: solver.srj,
      globalDrcForceImproveSolver: { getOutput: () => [] },
      traceWidthSolver: { getHdRoutesWithWidths: () => [] },
      netToPointPairsSolver: { newConnections: [] },
    } as any)
    expect((params as any).additionalCandidateHdRoutes).toEqual([[]])
  }
})
