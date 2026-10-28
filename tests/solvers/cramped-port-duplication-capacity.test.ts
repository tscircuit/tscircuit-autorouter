import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

test("cramped port duplication distinguishes edge margin from trace capacity", (): void => {
  for (const height of [0.05, 0.1, 0.3]) {
    const solver = new AvailableSegmentPointSolver({
      nodes: [
        { capacityMeshNodeId: "left", center: { x: 0, y: 100.1 }, width: 1, height, availableZ: [0], layer: "top" },
        { capacityMeshNodeId: "right", center: { x: 1, y: 100.1 }, width: 1, height, availableZ: [0], layer: "top" },
      ],
      edges: [{ capacityMeshEdgeId: "edge", nodeIds: ["left", "right"] }],
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      shouldReturnCrampedPortPoints: true,
    })

    solver.solve()

    const ports = solver.getOutput()[0]!.portPoints
    expect(ports).toHaveLength(1)
    expect(ports[0]!.cramped).toBe(true)
    expect(ports[0]!.allowDuplication).toBe(height >= 0.2)
  }
})
