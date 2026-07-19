import { expect, test } from "bun:test"
import { createPipeline7RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/createPipeline7ExactGeometryDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 checkpoint validation includes relaxed typed clearance errors", () => {
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
        height: 0.2,
        connectedTo: ["pcb_smtpad_foreign"],
      },
    ],
    connections: [
      {
        name: "trace",
        pointsToConnect: [
          { x: -1, y: 0.2, layer: "top", pointId: "start" },
          { x: 1, y: 0.2, layer: "top", pointId: "end" },
        ],
      },
    ],
  } as SimpleRouteJson
  const evaluator = createPipeline7RelaxedDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    srjWithPointPairs: srj,
    originalSrj: srj,
  })
  const result = evaluator({
    traces: [],
    routes: [
      {
        connectionName: "trace",
        route: [
          { x: -1, y: 0.2, z: 0 },
          { x: 1, y: 0.2, z: 0 },
        ],
        vias: [],
        traceThickness: 0.1,
        viaDiameter: 0.3,
      },
    ],
  })
  const errors = Array.isArray(result) ? result : result.errors

  expect(
    errors.some((error) => error.type === "pcb_pad_trace_clearance_error"),
  ).toBe(true)
})
