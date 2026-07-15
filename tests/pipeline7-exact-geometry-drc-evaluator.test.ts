import { expect, test } from "bun:test"
import { createPipeline7ExactGeometryDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/createPipeline7ExactGeometryDrcEvaluator"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 exact cleanup ignores rotated-pad bounds false positives", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 2,
        ccwRotationDegrees: 45,
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: 0.5, y: 0.5, layer: "top", pointId: "start" },
          { x: 0.8, y: 0.5, layer: "top", pointId: "end" },
        ],
      },
    ],
  } as any
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluator = createPipeline7ExactGeometryDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    srjWithPointPairs: srj,
    originalSrj: srj,
  })
  const clearRoute: HighDensityRoute = {
    connectionName: "trace",
    route: [
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.8, y: 0.5, z: 0 },
    ],
    vias: [],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  }
  const collidingRoute: HighDensityRoute = {
    ...clearRoute,
    route: [
      { x: -0.5, y: 0.5, z: 0 },
      { x: 0.5, y: -0.5, z: 0 },
    ],
  }

  const clearResult = evaluator({ traces: [], routes: [clearRoute] })
  const collisionResult = evaluator({ traces: [], routes: [collidingRoute] })
  const clearErrors = Array.isArray(clearResult)
    ? clearResult
    : clearResult.errors
  const collisionErrors = Array.isArray(collisionResult)
    ? collisionResult
    : collisionResult.errors

  expect(clearErrors).toHaveLength(0)
  expect(collisionErrors).toHaveLength(1)
  expect(collisionErrors[0]?.type).toBe("pcb_trace_error")
})
