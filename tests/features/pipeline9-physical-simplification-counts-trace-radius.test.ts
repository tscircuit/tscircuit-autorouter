import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("physical simplification checks the routed trace radius", (): void => {
  for (const allowViaInPad of [false, true]) {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      {
        layerCount: 2,
        minTraceWidth: 0.1524,
        allowViaInPad,
        allowBlindAndBuriedVias: true,
        bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
        obstacles: [],
        connections: [
          {
            name: "signal",
            pointsToConnect: [
              { x: -1, y: 0, layer: "top" },
              { x: 1, y: 0, layer: "bottom" },
            ],
          },
        ],
      },
      { cacheProvider: null },
    )
    pipeline.solveUntilPhase("topologyPlanningSolver")
    const stitcher = new MultipleHighDensityRouteStitchSolver3({
      connections: [],
      hdRoutes: [],
      layerCount: 2,
    })
    pipeline.highDensityStitchSolver = stitcher
    for (const name of [
      "traceSimplificationSolver",
      "mutatedPreloadedTraceSimplificationSolver",
    ]) {
      const step = pipeline.pipelineDef.find(
        (candidate) => candidate.solverName === name,
      )!
      const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<
        typeof TraceSimplificationSolver
      >
      expect(params.useTraceWidthAwareClearance).toBe(allowViaInPad)
      expect(params.allowBlindAndBuriedVias).toBeTrue()
      if (name === "traceSimplificationSolver") {
        const simplifier = new TraceSimplificationSolver(params)
        pipeline.traceSimplificationSolver = simplifier
      }
    }
  }
})
