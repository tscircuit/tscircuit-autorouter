import { expect, test } from "bun:test"
import { createPipeline7RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-relaxed-drc-evaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

test("Pipeline7 regional errors identify both owners of overlapping drill spans", () => {
  const routes: HighDensityRoute[] = [0, 1].map((side) => ({
    connectionName: `signal${side}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: side, z: side * 2 },
      { x: side * 0.21, y: 0, z: side * 2 },
      { x: side * 0.21, y: 0, z: side * 2 + 1 },
      { x: 1, y: side, z: side * 2 + 1 },
    ],
    vias: [{ x: side * 0.21, y: 0 }],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: mapZToLayerName(point.z, 4),
      })),
    })),
  }
  const evaluate = createPipeline7RelaxedDrcEvaluator({
    originalSrj: srj,
    srjWithPointPairs: srj,
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
  const result = evaluate({ traces: [], routes })
  const errors = Array.isArray(result) ? result : result.errors
  const drillContact = errors.find(
    (error) => error.error_type === "pcb_via_clearance_error",
  )
  expect(drillContact).toBeDefined()
  expect(drillContact!.pcb_trace_ids).toEqual(["signal0_0", "signal1_0"])
  expect(drillContact!.pcb_via_ids).toHaveLength(2)
})
