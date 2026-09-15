import { expect, test } from "bun:test"
import {
  AvailableSegmentPointSolver,
  type SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshEdge, CapacityMeshNode, SimpleRouteJson } from "lib/types"

const nodes: CapacityMeshNode[] = [0, 1].flatMap((z) =>
  [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 0.2, y: 0 },
    { id: "c", x: 0.2, y: 0.5 },
    { id: "d", x: 0, y: 0.5 },
  ].map((node) => ({
    capacityMeshNodeId: `${node.id}${z}`,
    center: { x: node.x, y: node.y },
    width: 0.2,
    height: 0.5,
    layer: `z${z}`,
    availableZ: [z],
  })),
)

const edges: CapacityMeshEdge[] = [0, 1].flatMap((z) =>
  [
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["d", "a"],
  ].map((nodeIds, index) => ({
    capacityMeshEdgeId: `edge-${index}-z${z}`,
    nodeIds: nodeIds.map((nodeId) => `${nodeId}${z}`) as [string, string],
  })),
)

function getReachableNodes(
  segments: ReturnType<AvailableSegmentPointSolver["getOutput"]>,
  z: number,
): string[] {
  const reachable = new Set([`a${z}`])
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    for (const portPoint of segments.flatMap((segment) => segment.portPoints)) {
      if (!portPoint.availableZ.includes(z)) continue
      if (!portPoint.nodeIds.some((nodeId) => reachable.has(nodeId))) continue
      for (const nodeId of portPoint.nodeIds) reachable.add(nodeId)
    }
  }
  return [...reachable].map((nodeId) => nodeId[0]).sort()
}

function getFilteredSegments(): SharedEdgeSegment[] {
  const generator = new AvailableSegmentPointSolver({
    nodes,
    edges,
    traceWidth: 0.1,
    shouldReturnCrampedPortPoints: true,
  })
  generator.solve()
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "top-signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 0.2, y: 0.5, layer: "top" },
        ],
      },
    ],
  }
  const pruner = new MultiTargetNecessaryCrampedPortPointSolver({
    capacityMeshNodes: nodes,
    sharedEdgeSegments: generator.getOutput(),
    simpleRouteJson,
  })
  pruner.solve()
  return pruner.getOutput()
}

test("keeps only cramped ports required by terminal connectivity", (): void => {
  const clearSegments = getFilteredSegments()
  const clearPorts = clearSegments.flatMap((segment) => segment.portPoints)
  expect(getReachableNodes(clearSegments, 0)).toEqual(["a", "b", "c", "d"])
  expect(getReachableNodes(clearSegments, 1)).toEqual(["a", "b"])
  expect(clearPorts).toHaveLength(5)
  expect(
    clearPorts
      .filter((portPoint) => portPoint.cramped)
      .every((portPoint) => portPoint.tinyHypergraphPortPenalty === 1_000),
  ).toBeTrue()
})
