import { expect, test } from "bun:test"
import { Pipeline9ElectricalTreeRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ElectricalTreeRepairSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

test("a blocked shared junction is moved and its branch rerouted as one validated electrical transaction", (): void => {
  const pads = [{ x: -1, y: 0, z: 0, pcb_port_id: "A" }, { x: 1, y: 1, z: 0, pcb_port_id: "B" }]
  const connections: SimpleRouteConnection[] = pads.map((point, index) => ({ name: `branch${index}`, __rootConnectionNames: ["bus"],
    pointsToConnect: [{ x: point.x, y: point.y, layer: "top", pcb_port_id: point.pcb_port_id }, { x: 0, y: 0, layer: "top", pointId: "J" }],
    electricalBranch: { netId: "bus", startVertexId: point.pcb_port_id, endVertexId: "J", logicalConnectionNames: ["bus"] } }))
  const routes: HighDensityRoute[] = pads.map((point, index) => ({ connectionName: `branch${index}`, rootConnectionName: "bus", startPcbPortId: point.pcb_port_id,
    traceThickness: 0.1, viaDiameter: 0.3, route: [point, { x: 0, y: 0, z: 0 }], vias: [] }))
  const fixed = { connectionName: "wall", rootConnectionName: "wall", preloadedTraceIndex: 0, preloadedRouteIndex: 0,
    traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -0.15, y: -2, z: 0 }, { x: -0.15, y: 2, z: 0 }], vias: [] }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [], connections }
  const errors = (candidate: HighDensityRoute[]): Array<Record<string, unknown>> => candidate.flatMap((route) =>
    doPipeline9RoutesHaveCopperConflict({ left: route, right: fixed, clearance: 0.1, layerCount: 2 })
      ? [{ type: "pcb_trace_error", pcb_trace_id: `${route.connectionName}_0`, pcb_trace_error_id: `overlap_${route.connectionName}_0_wall_0`, center: { x: -0.15, y: 0 } }] : [])
  const solver = new Pipeline9ElectricalTreeRepairSolver({ srj, routes, newConnections: connections, fixedObstacleRoutes: [fixed], syntheticConnectionNames: new Set(),
    preloadRepairTraceIds: new Set(), connMap: getConnectivityMapFromSimpleRouteJson(srj), colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.2, traceWidth: 0.1, obstacleMargin: 0.1, effort: 1,
    drcEvaluator: ({ routes, hdRoutes }) => ({ errors: errors((routes ?? hdRoutes)!) }) })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.electricalTreeJunctionRouteTrials).toBeGreaterThan(0)
  expect(solver.stats.electricalTreeJunctionRouteAccepted).toBeGreaterThan(0)
  const output = solver.getOutput()
  expect(errors(output)).toEqual([])
  expect(output[0]!.route.at(-1)).toEqual(output[1]!.route.at(-1)!)
  expect(output[0]!.route.at(-1)!.x).toBeGreaterThan(0.1)
  expect(output.map((route) => route.route[0])).toEqual(pads)
})
