import { expect, test } from "bun:test"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

const makeNode = (
  capacityMeshNodeId: string,
  center: { x: number; y: number },
  width = 1,
): CapacityMeshNode => ({
  capacityMeshNodeId,
  center,
  width,
  height: 1,
  layer: "top",
  availableZ: [0],
})

test("keeps complete paths for at most five distinct cramped escape branches", () => {
  const targetNode = makeNode("target", { x: 0, y: 0 })
  targetNode._containsObstacle = true
  const capacityMeshNodes: CapacityMeshNode[] = [targetNode]
  const sharedEdgeSegments: SharedEdgeSegment[] = []

  for (let branchNumber = 1; branchNumber <= 7; branchNumber++) {
    const middleNode = makeNode(`middle-${branchNumber}`, {
      x: branchNumber,
      y: 0,
    })
    const exitEdgeNode = makeNode(`exit-edge-${branchNumber}`, {
      x: branchNumber,
      y: 1,
    })
    const exitNode = makeNode(
      `exit-${branchNumber}`,
      { x: branchNumber, y: 2 },
      branchNumber,
    )
    capacityMeshNodes.push(middleNode, exitEdgeNode, exitNode)

    const branchPorts: SegmentPortPoint[] = [
      {
        segmentPortPointId: `root-${branchNumber}`,
        x: branchNumber,
        y: 0,
        availableZ: [0],
        nodeIds: [targetNode.capacityMeshNodeId, middleNode.capacityMeshNodeId],
        edgeId: `root-edge-${branchNumber}`,
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: true,
      },
      {
        segmentPortPointId: `parent-${branchNumber}`,
        x: branchNumber,
        y: 1,
        availableZ: [0],
        nodeIds: [
          middleNode.capacityMeshNodeId,
          exitEdgeNode.capacityMeshNodeId,
        ],
        edgeId: `parent-edge-${branchNumber}`,
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: true,
      },
      {
        segmentPortPointId: `candidate-${branchNumber}`,
        x: branchNumber,
        y: 2,
        availableZ: [0],
        nodeIds: [exitEdgeNode.capacityMeshNodeId, exitNode.capacityMeshNodeId],
        edgeId: `candidate-edge-${branchNumber}`,
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: true,
      },
    ]

    for (const portPoint of branchPorts) {
      sharedEdgeSegments.push({
        edgeId: portPoint.edgeId,
        nodeIds: portPoint.nodeIds,
        start: { x: portPoint.x, y: portPoint.y },
        end: { x: portPoint.x, y: portPoint.y },
        availableZ: [0],
        portPoints: [portPoint],
      })
    }
  }

  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "test-connection",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 10, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 11 },
  }
  const solver = new MultiTargetNecessaryCrampedPortPointSolver({
    capacityMeshNodes,
    sharedEdgeSegments,
    simpleRouteJson,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const retainedPortIds = new Set(
    solver
      .getOutput()
      .flatMap((segment) => segment.portPoints)
      .map((portPoint) => portPoint.segmentPortPointId),
  )
  const retainedBranchNumbers = Array.from(
    { length: 7 },
    (_, index) => index + 1,
  ).filter((branchNumber) =>
    retainedPortIds.has(`candidate-${branchNumber}`),
  )

  expect(retainedBranchNumbers).toEqual([3, 4, 5, 6, 7])
  for (const branchNumber of retainedBranchNumbers) {
    expect(retainedPortIds.has(`parent-${branchNumber}`)).toBe(true)
    expect(retainedPortIds.has(`root-${branchNumber}`)).toBe(true)
  }
})
