import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import availableSegmentPointSolver_input from "./assets/availableSegmentPointSolver_input-113.json"
import { expect, test } from "bun:test"

test("repro02: impossible to reach obstacle with availableSegmentPointSolver", () => {
  // Setup
  const solver = new AvailableSegmentPointSolver({
    ...availableSegmentPointSolver_input[0],
  } as any)
  solver.solve()

  const { nodes } = availableSegmentPointSolver_input[0]
  const sharedEdgeSegments = solver.sharedEdgeSegments
  const nodeById = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))

  // Graph index: nodeId -> connected shared edge segments
  const segmentsByNodeId: Record<string, typeof sharedEdgeSegments> = {}
  for (const segment of sharedEdgeSegments) {
    for (const nodeId of segment.nodeIds) {
      if (!segmentsByNodeId[nodeId]) {
        segmentsByNodeId[nodeId] = []
      }
      segmentsByNodeId[nodeId].push(segment)
    }
  }

  // BFS (up to depth 2) across segments with at least one free port point
  const startNodeId = "cmn_126"
  const targetDepth = 2
  const visited = new Map<string, number>([[startNodeId, 0]])
  let frontier = [startNodeId]

  for (let currentDepth = 0; currentDepth < targetDepth; currentDepth++) {
    const nextFrontier: string[] = []
    for (const nodeId of frontier) {
      const segments = segmentsByNodeId[nodeId] ?? []
      for (const segment of segments) {
        const hasFreePortPoint = segment.portPoints.some(
          (portPoint) => portPoint.connectionName === null,
        )
        if (!hasFreePortPoint) continue

        for (const neighborId of segment.nodeIds) {
          if (neighborId === nodeId || visited.has(neighborId)) continue
          visited.set(neighborId, currentDepth + 1)
          nextFrontier.push(neighborId)
        }
      }
    }
    frontier = nextFrontier
    if (frontier.length === 0) break
  }

  // Depth-2 available port points
  const depth2Nodes = [...visited.entries()]
    .filter(([, depth]) => depth === targetDepth)
    .map(([nodeId]) => nodeId)

  const depth2PortPoints = depth2Nodes.flatMap((nodeId) =>
    (segmentsByNodeId[nodeId] ?? []).flatMap((segment) =>
      segment.portPoints.filter(
        (portPoint) => portPoint.connectionName === null,
      ),
    ),
  )

  // Repro expectation: every available depth-2 port point is adjacent to an obstacle node.
  const allDepth2PortPointsShareWithObstacle =
    depth2PortPoints.length > 0 &&
    depth2PortPoints.every((portPoint) =>
      portPoint.nodeIds.some(
        (nodeId) => nodeById.get(nodeId)?._containsObstacle,
      ),
    )

  // Assertions
  expect(allDepth2PortPointsShareWithObstacle).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
