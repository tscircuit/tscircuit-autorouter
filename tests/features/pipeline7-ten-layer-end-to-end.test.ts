import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { LayerName } from "lib/utils/mapZToLayerName"

test("pipeline 7 routes, visualizes, and exports a trace on inner8", () => {
  const srj: SimpleRouteJson = {
    layerCount: 10,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "inner8-net",
        pointsToConnect: [
          { x: -2, y: 0, layer: "inner8", pointId: "start" },
          { x: 2, y: 0, layer: "inner8", pointId: "end" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    cacheProvider: null,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const output = solver.getOutputSimpleRouteJson()
  expect(
    output.traces?.some((trace) =>
      trace.route.some(
        (routePoint) =>
          routePoint.route_type === "wire" &&
          (routePoint.layer as LayerName) === "inner8",
      ),
    ),
  ).toBe(true)

  const graphics = solver.visualizeFinalOutput()
  expect(graphics.lines?.some((line) => line.layer === "z8")).toBe(true)

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    output.traces ?? [],
    { originalSrj: solver.originalSrj },
  )
  const exportedTrace = circuitJson.find(
    (element) => element.type === "pcb_trace",
  )

  expect(exportedTrace?.type).toBe("pcb_trace")
  expect(
    exportedTrace?.type === "pcb_trace" &&
      exportedTrace.route.some(
        (routePoint) =>
          routePoint.route_type === "wire" &&
          (routePoint.layer as LayerName) === "inner8",
      ),
  ).toBe(true)
})
