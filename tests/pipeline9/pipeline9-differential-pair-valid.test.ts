import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"

test("Pipeline9 accepts a valid coupled differential pair", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -25, maxX: 25, minY: -15, maxY: 15 },
    layerCount: 4,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "P",
        nominalTraceWidth: 0.15,
        pointsToConnect: [
          { x: -15, y: 0.175, layer: "top" },
          { x: 15, y: 0.175, layer: "top" },
        ],
      },
      {
        name: "N",
        nominalTraceWidth: 0.15,
        pointsToConnect: [
          { x: -15, y: -0.175, layer: "top" },
          { x: 15, y: -0.175, layer: "top" },
        ],
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["P", "N"],
        lengthTolerance: 0.1,
        traceGap: 0.2,
        maxUncoupledLength: 0.1,
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routes = solver._getOutputHdRoutes()
  expect(routes).toHaveLength(2)
  const lengths = routes.map((route): number =>
    route.route.slice(1).reduce((length, point, pointIndex): number => {
      const previous = route.route[pointIndex]!
      return length + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0),
  )
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.1)
})
