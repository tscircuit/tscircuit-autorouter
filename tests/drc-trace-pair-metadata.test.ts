import { expect, test } from "bun:test"
import { createPipeline7ExactGeometryDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/createPipeline7ExactGeometryDrcEvaluator"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline7 DRC errors expose both colliding trace ids", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "trace_a",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "a_start" },
          { x: 1, y: 0, layer: "top", pointId: "a_end" },
        ],
      },
      {
        name: "trace_b",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pointId: "b_start" },
          { x: 0, y: 1, layer: "top", pointId: "b_end" },
        ],
      },
    ],
  } as any
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const routes: HighDensityRoute[] = [
    {
      connectionName: "trace_a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
    {
      connectionName: "trace_b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
    },
  ]
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

  const result = evaluator({ traces: [], routes })
  const errors = Array.isArray(result) ? result : result.errors
  const traceError = errors.find((error) => error.type === "pcb_trace_error")

  expect(traceError).toBeDefined()
  expect(new Set(traceError?.pcb_trace_ids as string[])).toEqual(
    new Set(["trace_a_0", "trace_b_0"]),
  )
})

