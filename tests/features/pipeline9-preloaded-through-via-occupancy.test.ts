import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 blocks every layer occupied by a preloaded through-via", () => {
  const connMap = new ConnectivityMap({})
  const fixedViaTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout-via-trace",
    connection_name: "fanout-net",
    route: [
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.5,
      },
    ],
  }
  const fixedRoutes = convertPreloadedTraceToHdRoutes(
    fixedViaTrace,
    0,
    4,
    0.5,
    connMap,
    false,
  )
  const portPoints = [
    { x: -1.5, y: 0, z: 3, connectionName: "bottom-signal" },
    { x: 1.5, y: 0, z: 3, connectionName: "bottom-signal" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "bottom-layer-around-through-via",
    center: { x: 0, y: 0 },
    width: 3.2,
    height: 2,
    availableZ: [3],
    portPoints,
    portPointsInPairs: [[portPoints[0]!, portPoints[1]!]],
  }

  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: fixedRoutes,
    connMap,
    colorMap: {},
    obstacles: [],
    layerCount: 4,
    viaDiameter: 0.5,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })
  solver.solve()

  expect(fixedRoutes[0]!.physicalViaSpans).toEqual([
    { center: { x: 0, y: 0 }, minZ: 0, maxZ: 3 },
  ])
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    solver.routes.some((route) =>
      doPipeline9RoutesHaveCopperConflict({
        left: route,
        right: fixedRoutes[0]!,
        clearance: 0.15,
      }),
    ),
  ).toBeFalse()
})
