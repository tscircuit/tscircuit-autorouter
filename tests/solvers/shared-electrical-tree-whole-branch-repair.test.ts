import { expect, test } from "bun:test"
import { Pipeline9ElectricalTreeRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ElectricalTreeRepairSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("whole-branch repair preserves owned terminals and clears a contact against fixed copper", (): void => {
  const points = [{ x: -1, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top", pcb_port_id: "B" }]
  const connection = { name: "ab", pointsToConnect: points, electricalBranch: { netId: "ab", startVertexId: "A", endVertexId: "B", logicalConnectionNames: ["ab"] } }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [],
    connections: [connection, { name: "fixed", pointsToConnect: [{ x: 0, y: -1, layer: "top" }, { x: 0, y: 1, layer: "top" }] }] }
  const route: HighDensityRoute = { connectionName: "ab", rootConnectionName: "ab", traceThickness: 0.1, viaDiameter: 0.3, startPcbPortId: "A", endPcbPortId: "B",
    route: [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 1, y: 0, z: 0, pcb_port_id: "B" }], vias: [] }
  const fixed = { connectionName: "fixed", rootConnectionName: "fixed", preloadedTraceIndex: 0, preloadedRouteIndex: 0,
    traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] }
  srj.traces = [{ type: "pcb_trace", pcb_trace_id: "fixed_trace", connection_name: "fixed", route: fixed.route.map((point) => ({ route_type: "wire", x: point.x, y: point.y, width: fixed.traceThickness, layer: "top" })) }]
  const conflict = (routes: HighDensityRoute[]): boolean => doPipeline9RoutesHaveCopperConflict({ left: routes[0]!, right: fixed, clearance: 0.1, layerCount: 2 })
  const solver = new Pipeline9ElectricalTreeRepairSolver({ srj, preloadedTraces: srj.traces ?? [], routes: [route], newConnections: [connection], fixedObstacleRoutes: [fixed],
    syntheticConnectionNames: new Set(), preloadRepairTraceIds: new Set(), connMap: getConnectivityMapFromSimpleRouteJson(srj), colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.2, traceWidth: 0.1, obstacleMargin: 0.1, traceClearance: 0.1, viaClearance: 0.1, viaHoleClearance: 0.1, effort: 1,
    drcEvaluator: ({ routes, hdRoutes }) => ({ errors: conflict((routes ?? hdRoutes)!) ? [{ type: "pcb_trace_error", pcb_trace_id: "ab_0", pcb_trace_error_id: "overlap_ab_0_fixed_0" }] : [] }) })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.electricalTreeWholeBranchTrials).toBeGreaterThan(0)
  expect(solver.stats.electricalTreeWholeBranchAccepted).toBeGreaterThan(0)
  const output = solver.getOutput()
  expect(conflict(output)).toBe(false)
  expect(output[0]!.route[0]).toMatchObject(route.route[0]!)
  expect(output[0]!.route.at(-1)).toMatchObject(route.route.at(-1)!)
})
