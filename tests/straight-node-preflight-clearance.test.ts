import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { createStraightRoutePreflightContext, getCertifiedStraightIntraNodeRoutes } from "lib/solvers/HyperHighDensitySolver/getCertifiedStraightIntraNodeRoutes"

const board = { bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 } }
const originalBounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
const makeNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "node",
  center: { x: 0, y: 0 },
  width: 4,
  height: 4,
  availableZ: [0, 1],
  portPoints: [
    { x: -2, y: -1, z: 0, connectionName: "a", rootConnectionName: "root-a", portPointId: "a0", pcb_port_id: "p0" },
    { x: 2, y: -0.8, z: 0, connectionName: "a", rootConnectionName: "root-a", portPointId: "a1", pcb_port_id: "p1" },
    { x: -2, y: 1, z: 0, connectionName: "b", rootConnectionName: "root-b", portPointId: "b0" },
    { x: 2, y: 0.8, z: 0, connectionName: "b", rootConnectionName: "root-b", portPointId: "b1" },
  ],
})
const certify = (node: NodeWithPortPoints, obstacles: Obstacle[] = [], surroundingRoutes: HighDensityIntraNodeRoute[] = [], holeClearance?: number): HighDensityIntraNodeRoute[] | null => {
  return getCertifiedStraightIntraNodeRoutes({
    nodeWithPortPoints: node,
    boardGeometry: board,
    obstacles,
    layerCount: 2,
    straightRoutePreflightContext: createStraightRoutePreflightContext(originalBounds, { surroundingRoutes, minTraceToHoleEdgeClearance: holeClearance }),
  })
}

test("certified native boundary stubs preserve full physical clearance and reject unsafe geometry", () => {
  const node = makeNode()
  node.portPointsInPairs = [[node.portPoints[0]!, node.portPoints[1]!], [node.portPoints[2]!, node.portPoints[3]!]]
  const before = JSON.stringify(node)
  const routes = certify(node)!
  expect(routes).toHaveLength(2)
  expect(routes[0]!.route).toHaveLength(4)
  expect(routes[0]!.route[1]).toEqual({ x: -1.775, y: -1, z: 0 })
  expect(routes[0]!.rootConnectionName).toBe("root-a")
  expect(routes[0]!.regionId).toBe("node")
  expect(routes[0]!.route[0]!.pcb_port_id).toBeUndefined()
  expect(routes[0]!.startPcbPortId).toBeUndefined()
  expect(JSON.stringify(node)).toBe(before)
  expect(routes[0]!.route[0]).not.toBe(node.portPoints[0])
  const srj: SimpleRouteJson = {
    bounds: board.bounds,
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: ["a", "b"].map((name) => ({ name, pointsToConnect: node.portPoints.filter((point) => point.connectionName === name).map((point) => ({ x: point.x, y: point.y, layer: "top" })) })),
  }
  const circuit = convertToCircuitJson(srj, routes.map((route, index) => ({ type: "pcb_trace", pcb_trace_id: `trace${index}`, connection_name: route.connectionName, route: convertHdRouteToSimplifiedRoute(route, 2) })))
  circuit.push(createPcbBoardElement(srj))
  expect(getDrcErrors(circuit, { traceClearance: 0.15, viaClearance: 0.15, includeTraceContinuity: false }).errors).toEqual([])

  const crossing = makeNode()
  crossing.portPoints[1]!.y = 1
  crossing.portPoints[3]!.y = -1
  expect(certify(crossing)).toBeNull()
  const closeParallel = makeNode()
  closeParallel.portPoints[2]!.y = -0.8
  closeParallel.portPoints[3]!.y = -0.6
  expect(certify(closeParallel)).toBeNull()
  const foreignTerminal = makeNode()
  foreignTerminal.portPoints.push({ x: 0, y: -0.9, z: 0, connectionName: "c" }, { x: 0, y: 2, z: 0, connectionName: "c" })
  expect(certify(foreignTerminal)).toBeNull()
  const obstacle: Obstacle = { type: "rect", center: { x: 0, y: -0.9 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: [] }
  expect(certify(makeNode(), [obstacle])).toBeNull()
  const priorTrace: HighDensityIntraNodeRoute = { connectionName: "prior", traceThickness: 0.15, viaDiameter: 0.3, route: [{ x: 0, y: -3, z: 0 }, { x: 0, y: 3, z: 0 }], vias: [] }
  expect(certify(makeNode(), [], [priorTrace])).toBeNull()
  const priorVia: HighDensityIntraNodeRoute = { connectionName: "prior", traceThickness: 0.15, viaDiameter: 0.3, route: [{ x: 0, y: -0.9, z: 0 }, { x: 0, y: -0.9, z: 1 }], vias: [{ x: 0, y: -0.9 }] }
  expect(certify(makeNode(), [], [priorVia])).toBeNull()
  const oneLine = makeNode()
  oneLine.portPoints = oneLine.portPoints.slice(0, 2)
  oneLine.portPoints[1]!.y = -1
  const hole: Obstacle = { ...obstacle, center: { x: 0, y: -0.69 }, shape: "circle", isNonPlatedHole: true }
  expect(certify(oneLine, [hole])).toBeNull()
  hole.center.y = -0.5
  expect(certify(oneLine, [hole])).not.toBeNull()
  expect(certify(oneLine, [hole], [], 0.5)).toBeNull()
  const invalidLayer = makeNode()
  invalidLayer.availableZ = [2]
  invalidLayer.portPoints.forEach((point) => { point.z = 2 })
  expect(certify(invalidLayer)).toBeNull()
  const disconnected = makeNode()
  disconnected.portPoints.forEach((point) => { point.connectionName = "a"; point.rootConnectionName = "root-a" })
  disconnected.portPoints[0]!.nextPortPointId = "a1"
  disconnected.portPoints[1]!.prevPortPointId = "a0"
  disconnected.portPoints[2]!.nextPortPointId = "b1"
  disconnected.portPoints[3]!.prevPortPointId = "b0"
  disconnected.portPointsInPairs = [[disconnected.portPoints[0]!, disconnected.portPoints[2]!], [disconnected.portPoints[1]!, disconnected.portPoints[3]!]]
  expect(certify(disconnected)).toBeNull()
  expect(getCertifiedStraightIntraNodeRoutes({ nodeWithPortPoints: makeNode(), boardGeometry: board })).toBeNull()
  expect(getCertifiedStraightIntraNodeRoutes({ nodeWithPortPoints: makeNode(), boardGeometry: board, straightRoutePreflightContext: { originalBounds, surroundingRoutes: [] } })).toBeNull()
  const scaled = makeNode()
  scaled.width = 8
  expect(certify(scaled)).toBeNull()
  let getterCalls = 0
  const accessorNode = makeNode()
  Object.defineProperty(accessorNode.portPoints[0]!, "x", { get: () => { getterCalls++; return -2 } })
  expect(certify(accessorNode)).toBeNull()
  expect(getterCalls).toBe(0)
  const sparse = makeNode()
  delete sparse.portPoints[1]
  expect(certify(sparse)).toBeNull()
  const mutable = makeNode()
  expect(certify(mutable)).not.toBeNull()
  mutable.portPoints[1]!.y = 1
  expect(certify(mutable)).toBeNull()
})
