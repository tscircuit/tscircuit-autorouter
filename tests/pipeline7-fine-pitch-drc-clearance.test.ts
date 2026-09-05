import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 seeks relaxed trace spacing while honoring declared via/pad clearance", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        obstacleId: "pcb_smtpad_1",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_1", "foreign-net"],
      },
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1, y: 0.225, layer: "top" },
          { x: 1, y: 0.325, layer: "bottom" },
        ],
      },
    ],
  }
  // Both the top-layer trace and the via have 0.075 mm pad clearance.
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0.325 }],
      route: [
        { x: -1, y: 0.225, z: 0 },
        { x: 1, y: 0.225, z: 0 },
        { x: 1, y: 0.325, z: 0 },
        { x: 0, y: 0.325, z: 0 },
        { x: 0, y: 0.325, z: 1 },
        { x: 1, y: 0.325, z: 1 },
      ],
    },
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  for (const clearance of [undefined, 0.05, 0.1]) {
    const originalSrj = {
      ...srj,
      minTraceToPadEdgeClearance: clearance,
      minViaEdgeToPadEdgeClearance: clearance,
    }
    const result = createPipeline7AutoroutingDrcEvaluator({
      connections: srj.connections,
      originalConnections: srj.connections,
      layerCount: srj.layerCount,
      obstacles: srj.obstacles,
      defaultViaHoleDiameter: 0.15,
      connMap,
      srjWithPointPairs: srj,
      originalSrj,
    })({ hdRoutes: routes, traces: [] })
    const errors = Array.isArray(result) ? result : result.errors
    expect(errors.some((error) => error.type === "pcb_trace_error")).toBe(
      true,
    )
    expect(
      errors.some((error) => error.type === "pcb_pad_pad_clearance_error"),
    ).toBe(clearance !== 0.05)
  }
})
