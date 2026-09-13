import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimplifiedPcbTrace } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const createViaTrace = (
  pcbTraceId: string,
  connectionName: string,
  x: number,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: pcbTraceId,
  connection_name: connectionName,
  route: [
    {
      route_type: "via",
      x,
      y: 0,
      from_layer: "top",
      to_layer: "inner1",
      via_diameter: 0.5,
    },
  ],
})

test("Pipeline9 reroutes a preload that blocks an immutable node terminal", () => {
  const connMap = new ConnectivityMap({
    "shared-root": ["new-signal", "fixed-same-net"],
  })
  const fixedRoutes = [
    ...convertPreloadedTraceToHdRoutes(
      createViaTrace("other-via", "fixed-other-net", -1.15),
      0,
      4,
      0.5,
      connMap,
      false,
    ),
    ...convertPreloadedTraceToHdRoutes(
      createViaTrace("same-via", "fixed-same-net", 0.85),
      1,
      4,
      0.5,
      connMap,
      false,
    ),
  ]
  const portPoints = [
    {
      x: -1,
      y: 0,
      z: 3,
      connectionName: "new-signal",
      rootConnectionName: "shared-root",
    },
    {
      x: 1,
      y: 0,
      z: 0,
      connectionName: "new-signal",
      rootConnectionName: "shared-root",
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "terminal-blocked-by-preloaded-via",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1, 2, 3],
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

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.initialTerminalBlockerPromotionCount).toBe(1)
  expect([...solver.fixedRouteReplacements.keys()]).toContain(
    "fixed-other-net_fixed_0_0",
  )
  expect([...solver.fixedRouteReplacements.keys()]).not.toContain(
    "fixed-same-net_fixed_1_0",
  )
})
