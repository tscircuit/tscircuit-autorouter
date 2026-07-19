import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 reserves effort above one for post-processing", () => {
  const simpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any
  const lowEffortSolver = new AutoroutingPipelineSolver7_MultiGraph(
    simpleRouteJson,
    { effort: 0.1 },
  )
  const highEffortSolver = new AutoroutingPipelineSolver7_MultiGraph(
    simpleRouteJson,
    { effort: 100 },
  )

  for (const [solver, expectedRoutingEffort, expectedForceSteps] of [
    [lowEffortSolver, 0.1, 12],
    [highEffortSolver, 1, 20],
  ] as const) {
    const highDensityStep = solver.pipelineDef.find(
      (step) => step.solverName === "highDensityForceImproveSolver",
    )!
    const [highDensityParams] = highDensityStep.getConstructorParams({
      ...solver,
      highDensityNodePortPoints: [],
      highDensityRouteSolver: { routes: [] },
    } as any)
    expect((highDensityParams as any).totalStepsPerNode).toBe(
      expectedForceSteps,
    )

    const traceSimplificationStep = solver.pipelineDef.find(
      (step) => step.solverName === "traceSimplificationSolver",
    )!
    const [traceSimplificationParams] =
      traceSimplificationStep.getConstructorParams({
        ...solver,
        srjWithPointPairs: solver.srj,
        highDensityStitchSolver: { mergedHdRoutes: [] },
      } as any)
    expect((traceSimplificationParams as any).effort).toBe(
      expectedRoutingEffort,
    )

    const globalDrcStep = solver.pipelineDef.find(
      (step) => step.solverName === "globalDrcForceImproveSolver",
    )!
    const [globalDrcParams] = globalDrcStep.getConstructorParams({
      ...solver,
      srjWithPointPairs: solver.srj,
      traceWidthSolver: { getHdRoutesWithWidths: () => [] },
      highDensityStitchSolver: { mergedHdRoutes: [] },
      netToPointPairsSolver: { newConnections: [] },
    } as any)
    expect((globalDrcParams as any).effort).toBe(expectedRoutingEffort)
    expect((globalDrcParams as any).maxIterations).toBe(16)
  }
})
