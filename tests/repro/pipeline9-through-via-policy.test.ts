import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { getPipeline9FixedRouteObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 routes a bottom trace around a physical through-via", (): void => {
  const topToInner2Via: PreloadedHighDensityRoute = {
    connectionName: "top-to-inner2-transition",
    rootConnectionName: "top-to-inner2-transition",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.1,
    viaDiameter: 0.45,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const fixedObstacles = getPipeline9FixedRouteObstacles({
    fixedObstacleRoutes: [topToInner2Via],
    layerCount: 4,
  })
  expect(fixedObstacles).toContainEqual(
    expect.objectContaining({
      center: { x: 0, y: 0 },
      layers: ["top", "inner1", "inner2", "bottom"],
      width: 0.45,
      height: 0.45,
    }),
  )

  const inputSrj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.25,
    bounds: { minX: -4, maxX: 4, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "bottom-trace",
        pointsToConnect: [
          { x: -3, y: 0, layer: "bottom", pointId: "left" },
          { x: 3, y: 0, layer: "bottom", pointId: "right" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "top-to-inner2-transition",
        connection_name: "top-to-inner2-transition",
        route: [
          { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "inner2",
            via_diameter: 0.45,
            via_hole_diameter: 0.3,
          },
          {
            route_type: "wire",
            x: 0,
            y: 1,
            width: 0.1,
            layer: "inner2",
          },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const drc = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
    drcOptions: { includeTraceContinuity: false },
  })
  expect(drc.errors).toEqual([])
})
