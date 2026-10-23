import { expect, test } from "bun:test"
import { Pipeline9OwnedRouteClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9OwnedRouteClearanceSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("owned-path clearance joins canonical fixed-copper roots to their actual original net", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "B" }] }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [], connections: [connection] }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const route: HighDensityRoute = { connectionName: "ab", traceThickness: 0.2, viaDiameter: 0.3, startPcbPortId: "A", endPcbPortId: "B", route: [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }], vias: [] }
  const foreign = { connectionName: "foreign", rootConnectionName: "foreign", preloadedTraceIndex: 0, preloadedRouteIndex: 0, traceThickness: 0.15, viaDiameter: 0.3, route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] }
  const own = { ...foreign, connectionName: "original-fixed", rootConnectionName: connMap.getNetConnectedToId("ab")!, preloadedRouteIndex: 1, route: [{ x: -1, y: -1, z: 0 }, { x: -1, y: 1, z: 0 }] }
  expect(own.rootConnectionName).not.toBe("ab")
  const originalFixed = structuredClone([foreign, own])
  const conflicts = (routes: HighDensityRoute[]): boolean => doPipeline9RoutesHaveCopperConflict({ left: routes[0]!, right: foreign, clearance: 0.1, layerCount: 2 })
  const solver = new Pipeline9OwnedRouteClearanceSolver({ srj, routes: [route], newConnections: [connection], fixedObstacleRoutes: [foreign, own], syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(), connMap, colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.2, traceWidth: 0.2, obstacleMargin: 0.1, effort: 1,
    drcEvaluator: ({ hdRoutes, routes }: { hdRoutes?: HighDensityRoute[]; routes?: HighDensityRoute[] }) => ({ errors: conflicts((routes ?? hdRoutes)!) ? [{ type: "pcb_trace_error", pcb_trace_id: "ab_0", pcb_trace_error_id: "overlap_ab_0_foreign_0" }] : [] }) })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.ownedRouteRepairAccepted).toBeGreaterThan(0)
  expect(solver.stats.ownedRouteRepairFinalIssues).toBe(0)
  expect(conflicts(solver.getOutput())).toBe(false)
  expect(solver.getOutput()[0]!.route[0]).toEqual(route.route[0])
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(route.route.at(-1))
  expect([foreign, own]).toEqual(originalFixed)
})
