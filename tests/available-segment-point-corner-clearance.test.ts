import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import { isPortClearForNet } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/HgPortPointPathingSolverClass"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  Obstacle,
  SimpleRouteJson,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const nodes: CapacityMeshNode[] = [
  {
    capacityMeshNodeId: "lower",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0, 1],
  },
  {
    capacityMeshNodeId: "upper",
    center: { x: 0, y: 2 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0, 1],
  },
]

const edges: CapacityMeshEdge[] = [
  {
    capacityMeshEdgeId: "shared_edge",
    nodeIds: ["lower", "upper"],
  },
]

test("boundary ports preserve detailed-router corner clearance", () => {
  const traceWidth = 0.1
  const obstacleMargin = 0.15
  const requiredCornerClearance = traceWidth / 2 + obstacleMargin
  const obstacle: Obstacle = {
    obstacleId: "left_pad",
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x: -1.1, y: 1 },
    width: 0.2,
    height: 0.2,
    connectedTo: ["net_a"],
  }
  const solver = new AvailableSegmentPointSolver({
    nodes,
    edges,
    traceWidth,
    obstacleMargin,
    obstacles: [obstacle],
    shouldReturnCrampedPortPoints: false,
  })
  solver.solve()

  const segment = solver.getOutput()[0]!
  const safeTopPort = segment.portPoints.find(
    (point) => point.segmentPortPointId === "shared_edge_pp0_z0",
  )!
  const legacyInnerPort = segment.portPoints.find(
    (point) => point.segmentPortPointId === "shared_edge_pp0_z1",
  )!

  expect(safeTopPort.x).toBeCloseTo(-1 + requiredCornerClearance, 10)
  expect(safeTopPort._clearanceObstacleConnectionIdGroups).toBeUndefined()
  expect(safeTopPort._sameNetAlternativePosition).toEqual({
    x: -1 + 0.1875,
    y: 1,
    obstacleConnectionIdGroups: [["net_a"]],
  })
  expect(legacyInnerPort.x).toBe(-1 + 0.1875)
  expect(legacyInnerPort._clearanceObstacleConnectionIdGroups).toBeUndefined()

  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: traceWidth,
    defaultObstacleMargin: obstacleMargin,
    obstacles: [obstacle],
    connections: [],
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 3 },
  }
  const connectivityMap = getConnectivityMapFromSimpleRouteJson(inputSrj)
  const { graph } = buildHyperGraph({
    simpleRouteJsonConnections: [],
    capacityMeshNodes: nodes,
    segmentPortPoints: segment.portPoints,
    layerCount: 2,
    connectivityMap,
  })
  const obstacleNetId = connectivityMap.getNetConnectedToId("net_a")!
  const graphSafeTopPort = graph.ports.find(
    (port) => port.d.portId === "shared_edge_pp0_z0::0",
  )!

  expect(graph.ports).toHaveLength(segment.portPoints.length)
  expect(isPortClearForNet(graphSafeTopPort, "foreign_net")).toBe(true)
  expect(graphSafeTopPort.d._sameNetAlternativePosition).toEqual({
    x: -1 + 0.1875,
    y: 1,
    obstacleNetIds: [obstacleNetId],
  })
})
