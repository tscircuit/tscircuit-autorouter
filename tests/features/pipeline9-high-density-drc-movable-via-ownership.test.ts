import { expect, test } from "bun:test"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 assigns a fixed-trace overlap to the movable via's route", (): void => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "new",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "bottom" },
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
  const newViaRoute: HighDensityRoute = {
    connectionName: "new",
    rootConnectionName: "new",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const fixedHdRoutes = convertPreloadedTraceToHdRoutes(
    originalSrj.traces![0]!,
    0,
    2,
    0.3,
    connMap,
  )
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [originalSrj.connections[0]!],
    originalConnections: originalSrj.connections,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj,
    srjWithPointPairs: originalSrj,
    originalFixedHdRoutes: fixedHdRoutes,
    fixedHdRoutes,
    changedPreloadedTraceSections: [],
    hdRoutes: [newViaRoute],
  })

  const errors = getPipeline9DrcErrors(evaluator, [newViaRoute])
  expect(errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_trace_error",
      pcb_trace_id: "new_0",
      pcb_trace_ids: expect.arrayContaining(["new_0", "fixed_trace"]),
      pcb_via_id: expect.any(String),
      __via_owner_trace_ids: ["new_0"],
      __trace_segment_owner_trace_id: "fixed_trace",
    }),
  )
})
