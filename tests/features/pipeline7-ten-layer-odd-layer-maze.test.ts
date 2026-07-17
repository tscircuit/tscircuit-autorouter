import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { createTenLayerLayerMaze } from "../fixtures/ten-layer-layer-maze"

test("pipeline 7 routes an odd-layer maze through inner7 and bottom", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    createTenLayerLayerMaze([1, 3, 5, 7, 9]),
    { cacheProvider: null, effort: 0.2 },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const routedLayers = new Set(
    solver
      .getOutputSimplifiedPcbTraces()
      .flatMap((trace) => trace.route)
      .filter((routePoint) => routePoint.route_type === "wire")
      .map((routePoint) => routePoint.layer),
  )
  expect(routedLayers.has("inner5")).toBe(true)
  expect(routedLayers.has("inner7")).toBe(true)
  expect(routedLayers.has("bottom")).toBe(true)

  expect(solver.visualizeFinalOutput()).toMatchGraphicsSvg(import.meta.path)
})
