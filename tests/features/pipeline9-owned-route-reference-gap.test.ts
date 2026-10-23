import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import { Pipeline9OwnedRouteClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9OwnedRouteClearanceSolver"
import { createPipeline9ClearanceSearchOwnershipContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9ClearanceSearchOwnershipContext"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("owned repair uses the reference gap inside a legal narrow corridor instead of the larger planning margin", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: -0.8, y: 0, layer: "top", pcb_port_id: "A" }, { x: 0.8, y: 0, layer: "top", pcb_port_id: "B" }] }
  const srj: SimpleRouteJson = { layerCount: 1, minTraceWidth: 0.1, defaultObstacleMargin: 0.15,
    bounds: { minX: -1, maxX: 1, minY: -0.25, maxY: 0.25 }, obstacles: [],
    connections: [connection, ...["upper", "lower"].map((name, index) => ({ name, pointsToConnect: [
      { x: -1, y: index === 0 ? 0.225 : -0.225, layer: "top", pcb_port_id: `${name}_A` },
      { x: 1, y: index === 0 ? 0.225 : -0.225, layer: "top", pcb_port_id: `${name}_B` },
    ] }))] }
  const route: HighDensityRoute = { connectionName: "ab", traceThickness: 0.1, viaDiameter: 0.3, startPcbPortId: "A", endPcbPortId: "B",
    route: [{ x: -0.8, y: 0, z: 0, pcb_port_id: "A" }, { x: 0, y: 0.15, z: 0 }, { x: 0.8, y: 0, z: 0, pcb_port_id: "B" }], vias: [] }
  const fixed = [0.225, -0.225].map((y, index): PreloadedHighDensityRoute => ({ connectionName: index === 0 ? "upper" : "lower", preloadedTraceIndex: index, preloadedRouteIndex: 0, traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y, z: 0 }, { x: 1, y, z: 0 }], vias: [] }))
  const originalSrj: SimpleRouteJson = { ...srj, traces: fixed.map((item) => ({ type: "pcb_trace", pcb_trace_id: `${item.connectionName}_preload`, connection_name: item.connectionName,
    route: item.route.map((point) => ({ route_type: "wire", x: point.x, y: point.y, layer: "top", width: item.traceThickness })) })) }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const context = createPipeline9ClearanceSearchOwnershipContext({ srj, routes: [route], fixedObstacleRoutes: fixed, preloadedTraces: originalSrj.traces!, connMap })
  const planningSearch = new FindClearancePathSolver({ ...context, routeIndex: 0, start: route.route[0]!, end: route.route.at(-1)!, bounds: srj.bounds,
    traceThickness: 0.1, traceClearance: 0.15, viaClearance: 0.1, viaHoleDiameter: 0.2, gridSize: 0.05, allowLayerChanges: false })
  planningSearch.solve()
  expect(planningSearch.getOutput()).toBeNull()
  const conflicts = (routes: HighDensityRoute[]): boolean => fixed.some((right) => doPipeline9RoutesHaveCopperConflict({ left: routes[0]!, right, clearance: 0.1, layerCount: 1 }))
  expect(conflicts([route])).toBe(true)
  const params = { srj, preloadedTraces: originalSrj.traces!, routes: [route], newConnections: [connection], fixedObstacleRoutes: fixed,
    syntheticConnectionNames: new Set<string>(), preloadRepairTraceIds: new Set<string>(), connMap, colorMap: {}, viaDiameter: 0.3,
    viaHoleDiameter: 0.2, traceClearance: 0.1, viaClearance: 0.1, viaHoleClearance: 0.1, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    drcEvaluator: ({ hdRoutes, routes }: { hdRoutes?: HighDensityRoute[]; routes?: HighDensityRoute[] }) => ({ errors: conflicts((routes ?? hdRoutes)!) ? [{ type: "pcb_trace_error", pcb_trace_id: "ab_0", pcb_trace_error_id: "overlap_ab_0_upper_0" }] : [] }) }
  const solver = new Pipeline9OwnedRouteClearanceSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.ownedRouteRepairAccepted).toBeGreaterThan(0)
  expect(conflicts(solver.getOutput())).toBe(false)
  expect(solver.getOutput()[0]!.route[0]).toEqual(route.route[0]!)
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(route.route.at(-1)!)
  expect(solver.stats.ownedRouteSearchConservativeCoupledViaGap).toBe(0)
  expect(new Pipeline9OwnedRouteClearanceSolver({ ...params, viaHoleClearance: 0.2 }).stats.ownedRouteSearchConservativeCoupledViaGap).toBe(1)
  expect(() => new Pipeline9OwnedRouteClearanceSolver({ ...params, traceClearance: Number.NaN })).toThrow("reference clearances")
})
