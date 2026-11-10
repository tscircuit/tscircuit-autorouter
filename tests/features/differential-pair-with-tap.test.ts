import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 pairs a declared trunk while routing its separate test point tap", () => {
  const positiveStart = { x: -4, y: 0, layer: "top", pointId: "P.A" }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -6, maxX: 6, minY: -4, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "P",
        pointsToConnect: [
          positiveStart,
          { x: 4, y: 0, layer: "top", pointId: "P.C" },
        ],
      },
      {
        name: "N",
        pointsToConnect: [
          { x: -4, y: 0.4, layer: "top", pointId: "N.A" },
          { x: 4, y: 0.4, layer: "top", pointId: "N.C" },
        ],
      },
      {
        name: "TEST_POINT",
        pointsToConnect: [
          positiveStart,
          { x: -4, y: -2, layer: "top", pointId: "TP" },
        ],
      },
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.25, lengthTolerance: 0.05 },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const routes = solver._getOutputHdRoutes()
  expect(routes).toHaveLength(3)
  const getEndpoints = (route: (typeof routes)[number]): string[] => {
    return [route.route[0]!, route.route.at(-1)!]
      .map(({ x, y }) => `${x},${y}`)
      .sort()
  }
  expect(routes.map(getEndpoints).sort()).toEqual([
    ["-4,-2", "-4,0"],
    ["-4,0", "4,0"],
    ["-4,0.4", "4,0.4"],
  ])
})
