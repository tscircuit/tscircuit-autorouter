import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "@tscircuit/repair04"
import { Pipeline9ElectricalTreeRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ElectricalTreeRepairSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("whole-branch search uses reference wire and drill gaps while retaining a larger planning crop margin", (): void => {
  const connection = { name: "ab", pointsToConnect: [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "B" }],
    electricalBranch: { netId: "ab", startVertexId: "A", endVertexId: "B", logicalConnectionNames: ["ab"] } }
  const srj: SimpleRouteJson = { layerCount: 1, minTraceWidth: 0.1, defaultObstacleMargin: 0.15,
    bounds: { minX: -1.1, maxX: 1.1, minY: -0.3, maxY: 0.3 }, obstacles: [], connections: [connection] }
  const route: HighDensityRoute = { connectionName: "ab", rootConnectionName: "ab", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 0, y: 0.2, z: 0 }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }], vias: [] }
  const walls: PreloadedHighDensityRoute[] = [-0.29, 0.29].map((y, index) => ({ connectionName: `wall${index}`, rootConnectionName: `wall${index}`, preloadedTraceIndex: index, preloadedRouteIndex: 0,
    traceThickness: 0.2, viaDiameter: 0.3, route: [{ x: -2, y, z: 0 }, { x: 2, y, z: 0 }], vias: [] }))
  srj.connections.push(...walls.map((wall) => ({ name: wall.connectionName, __rootConnectionNames: [wall.connectionName], pointsToConnect: [] })))
  srj.traces = walls.map((wall) => ({ type: "pcb_trace", pcb_trace_id: `${wall.connectionName}_trace`, connection_name: wall.connectionName, route: wall.route.map((point) => ({ route_type: "wire", x: point.x, y: point.y, width: wall.traceThickness, layer: "top" })) }))
  const conflict = (routes: HighDensityRoute[]): boolean => walls.some((wall) =>
    doPipeline9RoutesHaveCopperConflict({ left: routes[0]!, right: wall, clearance: 0.1, layerCount: 1 }))
  const overconstrained = new FindClearancePathSolver({ srj: { ...srj, traces: undefined }, routes: [route, ...walls], routeIndex: 0,
    start: route.route[0]!, end: route.route.at(-1)!, bounds: srj.bounds, traceThickness: 0.1,
    traceClearance: 0.15, viaClearance: 0.15, gridSize: 0.05, viaHoleDiameter: 0.2 })
  overconstrained.solve()
  expect(overconstrained.getOutput()).toBeNull()
  const solver = new Pipeline9ElectricalTreeRepairSolver({ srj, preloadedTraces: srj.traces ?? [], routes: [route], newConnections: [connection], fixedObstacleRoutes: walls,
    syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(), connMap: getConnectivityMapFromSimpleRouteJson(srj), colorMap: {},
    viaDiameter: 0.3, viaHoleDiameter: 0.2, traceWidth: 0.1, obstacleMargin: 0.15, traceClearance: 0.1, viaClearance: 0.1, viaHoleClearance: 0.1, effort: 1,
    drcEvaluator: ({ hdRoutes }) => ({ errors: conflict(hdRoutes!) ? [{ type: "pcb_trace_error", pcb_trace_id: "ab_0", pcb_trace_error_id: "overlap_ab_0_wall0_0" }] : [] }) })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.electricalTreeWholeBranchAccepted, JSON.stringify(solver.stats)).toBeGreaterThan(0)
  expect(conflict(solver.getOutput())).toBe(false)
  expect(solver.getOutput()[0]!.route[0]).toEqual(route.route[0]!)
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(route.route.at(-1)!)
  expect(srj.defaultObstacleMargin).toBe(0.15)
})
