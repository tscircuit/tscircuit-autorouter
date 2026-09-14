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
  const legacyTopPort = segment.portPoints.find(
    (point) => point.segmentPortPointId === "shared_edge_pp0_z0",
  )!
  const safeTopPort = segment.portPoints.find(
    (point) =>
      point.segmentPortPointId === "shared_edge_start_clearance_z0",
  )!
  const legacyInnerPort = segment.portPoints.find(
    (point) => point.segmentPortPointId === "shared_edge_pp0_z1",
  )!

  expect(legacyTopPort.x).toBeCloseTo(-1.0 + 0.1875, 10)
  expect(legacyTopPort._clearanceObstacleConnectionIdGroups).toEqual([
    ["net_a"],
  ])
  expect(safeTopPort.x).toBeCloseTo(-1 + requiredCornerClearance, 10)
  expect(safeTopPort._clearanceObstacleConnectionIdGroups).toBeUndefined()
  expect(legacyInnerPort.x).toBe(legacyTopPort.x)
  expect(legacyInnerPort._clearanceObstacleConnectionIdGroups).toBeUndefined()

  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: traceWidth,
    defaultObstacleMargin: obstacleMargin,
    obstacles: [obstacle],
    connections: [],
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 3 },
  }
  const { graph } = buildHyperGraph({
    simpleRouteJsonConnections: [],
    capacityMeshNodes: nodes,
    segmentPortPoints: segment.portPoints,
    layerCount: 2,
    connectivityMap: getConnectivityMapFromSimpleRouteJson(inputSrj),
  })
  const graphLegacyTopPort = graph.ports.find(
    (port) => port.d.portId === "shared_edge_pp0_z0::0",
  )!
  const graphSafeTopPort = graph.ports.find(
    (port) => port.d.portId === "shared_edge_start_clearance_z0::0",
  )!

  expect(graphLegacyTopPort.d._clearanceObstacleNetIds).toHaveLength(1)
  const obstacleNetId = graphLegacyTopPort.d._clearanceObstacleNetIds![0]!
  expect(isPortClearForNet(graphLegacyTopPort, obstacleNetId)).toBe(true)
  expect(isPortClearForNet(graphLegacyTopPort, "foreign_net")).toBe(false)
  expect(isPortClearForNet(graphSafeTopPort, "foreign_net")).toBe(true)
})
