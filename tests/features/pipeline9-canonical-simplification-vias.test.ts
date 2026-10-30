import { expect, test } from "bun:test"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 passes exactly colocated via points to simplification", (): void => {
  const pipeline = new Pipeline9({
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: -2, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "bottom" },
      ],
    }],
  }, { cacheProvider: null })
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0.0000002, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  pipeline.highDensityStitchSolver = {
    mergedHdRoutes: [route],
  } as MultipleHighDensityRouteStitchSolver3
  const stage = pipeline.pipelineDef.find(
    (step): boolean => step.solverName === "traceSimplificationSolver",
  )!
  const [params] = stage.getConstructorParams(pipeline) as ConstructorParameters<
    typeof TraceSimplificationSolver
  >
  const points = params.hdRoutes[0]!.route
  const transitions = points.slice(1).flatMap((point, index): HighDensityRoute["route"][] =>
    point.z !== points[index]!.z ? [[points[index]!, point]] : [],
  )
  expect(transitions).toHaveLength(1)
  for (const [start, end] of transitions) {
    expect({ x: start!.x, y: start!.y }).toEqual({ x: end!.x, y: end!.y })
  }
  expect(route.route).toHaveLength(4)
  const solver = new TraceSimplificationSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
})
