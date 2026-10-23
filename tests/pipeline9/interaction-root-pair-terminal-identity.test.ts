import { test, expect } from "bun:test"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("root-family grouping retains explicit pairs and PCB terminal identities through coupling", () => {
  const points: PortPoint[] = [
    { connectionName: "a1", rootConnectionName: "root-a", pcb_port_id: "a1-start", x: -2, y: -0.6, z: 0 },
    { connectionName: "a1", rootConnectionName: "root-a", pcb_port_id: "a1-end", x: 2, y: -0.6, z: 0 },
    { connectionName: "a2", rootConnectionName: "root-a", pcb_port_id: "a2-start", x: -2, y: 0.6, z: 0 },
    { connectionName: "a2", rootConnectionName: "root-a", pcb_port_id: "a2-end", x: 2, y: 0.6, z: 0 },
    { connectionName: "b", rootConnectionName: "root-b", pcb_port_id: "b-start", x: 0, y: -2, z: 0 },
    { connectionName: "b", rootConnectionName: "root-b", pcb_port_id: "b-end", x: 0, y: 2, z: 0 },
  ]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "identity", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1], portPoints: points, portPointsInPairs: [[points[0]!, points[1]!], [points[2]!, points[3]!], [points[4]!, points[5]!]] }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [], connections: ["a1", "a2", "b"].map(name => ({ name, rootConnectionName: name === "b" ? "root-b" : "root-a", pointsToConnect: points.filter(p => p.connectionName === name).map(p => ({ x: p.x, y: p.y, layer: "top", pcb_port_id: p.pcb_port_id })) })) }
  const solver = new Pipeline9InteractionGroupedHighDensitySolver({ nodePortPoints: [node], connMap: getConnectivityMapFromSimpleRouteJson(srj), viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.1, effort: 1, obstacles: [], layerCount: 2, useGrowShrinkHighDensityIntraNodeSolver: true, enableNegotiatedSearch: true, gridSearchSegmentWork: 500, preserveTerminalPcbPortIds: true, growShrinkFallbackToInvalidGeometryOnFailure: false })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.stats.experimentalInteractionInitialGroups).toBe(2)
  expect(solver.stats.experimentalInteractionMergeEvents).toBe(1)
  expect(areNodePortPointPairsConnectedByRoutes(solver.routes, node)).toBe(true)
  for (const route of solver.routes) {
    const terminals = points.filter(p => p.connectionName === route.connectionName)
    expect(route.regionId).toBe(node.capacityMeshNodeId)
    expect(route.rootConnectionName).toBe(terminals[0]!.rootConnectionName)
    for (const [point, id] of [[route.route[0]!, route.startPcbPortId], [route.route.at(-1)!, route.endPcbPortId]] as const) {
      expect(id).toBe(terminals.find(p => p.x === point.x && p.y === point.y && p.z === point.z)!.pcb_port_id)
    }
  }
  const missingRoot = solver.routes.map((route, i) => i === 0 ? { ...route, rootConnectionName: undefined } : route)
  const valid = (solver as unknown as { validateGroup: (routes: typeof solver.routes, node: NodeWithPortPoints) => boolean }).validateGroup(missingRoot, node)
  expect(valid).toBe(false)
})
