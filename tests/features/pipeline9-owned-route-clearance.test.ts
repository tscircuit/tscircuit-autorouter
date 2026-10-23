import { expect, test } from "bun:test"
import { Pipeline9OwnedRouteClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9OwnedRouteClearanceSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("whole-route clearance preserves exact owned endpoints and excludes unsupported protected primitives before search", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "B" }] }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [], connections: [connection] }
  const route: HighDensityRoute = { connectionName: "ab", traceThickness: 0.1, viaDiameter: 0.3, startPcbPortId: "A", endPcbPortId: "B",
    route: [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }], vias: [] }
  const fixed = { connectionName: "foreign", rootConnectionName: "foreign", preloadedTraceIndex: 0, preloadedRouteIndex: 0,
    traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] }
  const conflict = (routes: HighDensityRoute[]): boolean => doPipeline9RoutesHaveCopperConflict({ left: routes[0]!, right: fixed, clearance: 0.1, layerCount: 2 })
  const params = { srj, routes: [route], newConnections: [connection], fixedObstacleRoutes: [fixed], syntheticConnectionNames: new Set<string>(), preloadRepairTraceIds: new Set<string>(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj), colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.2, traceWidth: 0.1, obstacleMargin: 0.1, effort: 1,
    drcEvaluator: ({ routes, hdRoutes }: { routes?: HighDensityRoute[]; hdRoutes?: HighDensityRoute[] }) => ({ errors: conflict((routes ?? hdRoutes)!) ? [{ type: "pcb_trace_error", pcb_trace_id: "ab_0", pcb_trace_error_id: "overlap_ab_0_foreign_0" }] : [] }) }
  const solver = new Pipeline9OwnedRouteClearanceSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.ownedRouteRepairAccepted).toBeGreaterThan(0)
  expect(conflict(solver.getOutput())).toBe(false)
  expect(solver.getOutput()[0]!.route[0]).toEqual(route.route[0]!)
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(route.route.at(-1)!)
  for (const protection of ["through", "pad", "jumper"] as const) {
    const protectedRoute = structuredClone(route)
    if (protection === "through") protectedRoute.route[0]!.toNextSegmentType = "through_obstacle"
    if (protection === "pad") protectedRoute.route[0]!.insideJumperPad = true
    if (protection === "jumper") protectedRoute.jumpers = [{ route_type: "jumper", start: { x: -0.1, y: 0 }, end: { x: 0.1, y: 0 }, footprint: "0603" }]
    const blocked = new Pipeline9OwnedRouteClearanceSolver({ ...params, routes: [protectedRoute] })
    blocked.solve()
    expect(blocked.stats.ownedRouteRepairTrials).toBe(0)
    expect(blocked.stats.ownedRouteRepairProtectedRoutes).toBe(1)
    expect(blocked.stats.ownedRouteRepairFinalIssues).toBe(1)
    expect(blocked.getOutput()).toEqual([protectedRoute])
  }
})
