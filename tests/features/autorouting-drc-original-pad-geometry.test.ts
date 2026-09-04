import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("exact DRC uses original pads instead of routing approximations", (): void => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: 1.25, y: 0.9, layer: "top" },
          { x: 0.9, y: 1.25, layer: "top" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        ccwRotationDegrees: 270,
        layers: ["top", "bottom"],
        connectedTo: ["pcb_plated_hole_pad"],
      },
    ],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...originalSrj,
    obstacles: originalSrj.obstacles.map((obstacle) => ({
      ...obstacle,
      ccwRotationDegrees: undefined,
    })),
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 1.25, y: 0.9, z: 0 },
        { x: 0.9, y: 1.25, z: 0 },
      ],
    },
  ]
  const evaluator = createPipeline7AutoroutingDrcEvaluator({
    originalSrj,
    srjWithPointPairs,
    originalConnections: originalSrj.connections,
    connections: srjWithPointPairs.connections,
    obstacles: srjWithPointPairs.obstacles,
    layerCount: 2,
    defaultViaHoleDiameter: 0.15,
    connMap: getConnectivityMapFromSimpleRouteJson(originalSrj),
  })
  const result = evaluator({ traces: [], routes })
  const errors = Array.isArray(result) ? result : result.errors
  expect(errors).toHaveLength(1)
  expect(errors[0]?.actual_clearance).toBeCloseTo(
    0.15 / Math.SQRT2 - 0.05,
    6,
  )
})
