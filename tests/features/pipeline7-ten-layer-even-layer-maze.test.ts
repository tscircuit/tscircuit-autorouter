import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createTenLayerLayerMaze } from "../fixtures/ten-layer-layer-maze"

test("pipeline 7 routes a layer maze that requires more than four layers", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    createTenLayerLayerMaze([0, 2, 4, 6, 8]),
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
  expect(routedLayers.has("inner4")).toBe(true)
  expect(routedLayers.has("inner6")).toBe(true)
  expect(routedLayers.has("inner8")).toBe(true)

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    solver.getOutputSimplifiedPcbTraces(),
    { originalSrj: solver.originalSrj },
  )
  expect(
    circuitJson.some(
      (element) =>
        element.type === "pcb_trace" &&
        element.route.some(
          (routePoint) =>
            routePoint.route_type === "wire" &&
            routePoint.layer === "inner8",
        ),
    ),
  ).toBe(true)

  expect(solver.visualizeFinalOutput()).toMatchGraphicsSvg(import.meta.path)
})
