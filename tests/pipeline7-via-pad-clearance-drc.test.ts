import { expect, test } from "bun:test"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 autorouting DRC detects a via too close to a different-net pad", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: 0, maxX: 2, maxY: 2 },
    connections: [
      {
        name: "via_net",
        pointsToConnect: [
          { x: -1, y: 1, layer: "top", pointId: "via_net_start" },
          { x: 1, y: 1, layer: "bottom", pointId: "via_net_end" },
        ],
      },
      {
        name: "foreign_net",
        pointsToConnect: [],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.4, y: 1 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_foreign", "foreign_net"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.1,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "via_net",
      route: [
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 },
      ],
      vias: [{ x: 0, y: 1 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const evaluator = createPipeline7AutoroutingDrcEvaluator({
    connections: srj.connections.filter(
      (connection) => connection.name === "via_net",
    ),
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    srjWithPointPairs: srj,
    originalSrj: srj,
  })

  const result = evaluator({ traces: [], routes })

  if (Array.isArray(result)) {
    throw new Error("Autorouting DRC evaluator returned errors without centers")
  }
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_pad_ids: ["via_0", "pcb_smtpad_foreign"],
    pcb_via_ids: ["via_0"],
    minimum_clearance: 0.1,
  })
  expect(result.errors[0]?.actual_clearance).toBeCloseTo(0.05)
})
