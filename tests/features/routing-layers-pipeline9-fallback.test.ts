import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 regional fallback cannot add an excluded layer", () => {
  const input = {
    layerCount: 2,
    routingLayers: ["top"],
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    bounds: { minX: -1.05, maxX: 1.05, minY: -1.05, maxY: 1.05 },
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
  } satisfies SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 0.1,
    maxNodeDimension: 10,
  })
  solver.solve()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.highDensityRouteSolver?.allowedZ).toEqual([0])
  expect(
    solver.highDensityRouteSolver?.routes.every((route) =>
      route.route.every((point) => point.z === 0),
    ),
  ).toBeTrue()
})
