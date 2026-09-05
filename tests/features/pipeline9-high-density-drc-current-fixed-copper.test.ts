import { expect, test } from "bun:test"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 high-density DRC evaluates moved fixed copper at its current location", (): void => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "new",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
      {
        name: "fixed",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_trace",
        connection_name: "fixed",
        route: [
          { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const newRoute: HighDensityRoute = {
    connectionName: "new",
    rootConnectionName: "new",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const originalFixedRoutes = convertPreloadedTraceToHdRoutes(
    originalSrj.traces![0]!,
    0,
    2,
    0.3,
    connMap,
  )
  const movedFixedRoutes = originalFixedRoutes.map((route) => ({
    ...route,
    route: route.route.map((point) => ({ ...point, y: 2 })),
  }))
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [originalSrj.connections[0]!],
    originalConnections: originalSrj.connections,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj,
    srjWithPointPairs: originalSrj,
    originalFixedHdRoutes: originalFixedRoutes,
    fixedHdRoutes: movedFixedRoutes,
    hdRoutes: [newRoute],
  })

  expect(getPipeline9DrcErrors(evaluator, [newRoute])).toHaveLength(0)
  const currentLocationErrors = getPipeline9DrcErrors(evaluator, [
    {
      ...newRoute,
      route: newRoute.route.map((point) => ({ ...point, y: 2 })),
    },
  ])
  expect(currentLocationErrors.length).toBeGreaterThan(0)
  expect(
    currentLocationErrors.some((error) => error.pcb_trace_id === "new_0"),
  ).toBe(true)
})
