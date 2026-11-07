import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

test("numerical bridges follow active escapes across multiple gaps without opening inactive copper", () => {
  const placements: [string, number, number, boolean][] = [
    ["pad", 0, 0, true],
    ["escape", 1.0005, 0, false],
    ["outside", 2.001, 0, false],
    ["ordinary", 3.001, 0, false],
    ["inactive-pad", 10, 0, true],
    ["inactive-escape", 11.0005, 0, false],
    ["escaped-pad", 20, 0, true],
    ["escaped-corner", 20, 1, false],
    ["escaped-outside", 21, 1, false],
    ["redundant-gap", 21.0005, 0, false],
  ]
  const nodes: CapacityMeshNode[] = placements.map(([id, x, y, target]) => ({
    capacityMeshNodeId: id,
    center: { x, y },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsTarget: target,
    _containsObstacle: target,
  }))
  const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
  edges.solve()
  for (const hasActiveConnection of [false, true]) {
    const connections: SimpleRouteConnection[] = hasActiveConnection
      ? [{
          name: "active",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 3.001, y: 0, layer: "top" },
          ],
        }, {
          name: "already-escaped",
          pointsToConnect: [
            { x: 20, y: 0, layer: "top" },
            { x: 21, y: 1, layer: "top" },
          ],
        }]
      : []
    const solver = new AvailableSegmentPointSolver({
      nodes,
      edges: edges.edges,
      traceWidth: 0.1,
      shouldReturnCrampedPortPoints: true,
      connections,
    })
    solver.solve()
    expect(solver.getAvailablePortCountForEdge("pad", "escape") > 0).toBe(
      hasActiveConnection,
    )
    expect(solver.getAvailablePortCountForEdge("escape", "outside") > 0).toBe(
      hasActiveConnection,
    )
    expect(solver.getAvailablePortCountForEdge("outside", "ordinary")).toBeGreaterThan(0)
    expect(solver.getAvailablePortCountForEdge("inactive-pad", "inactive-escape")).toBe(0)
    expect(solver.getAvailablePortCountForEdge("escaped-pad", "redundant-gap")).toBe(0)
    expect(solver.getAvailablePortCountForEdge("escaped-corner", "escaped-outside")).toBeGreaterThan(0)
    const retainedPorts = solver.getOutput().flatMap((segment) => segment.portPoints)
    expect(solver.portPointMap.size).toBe(retainedPorts.length)
    expect(solver.edgeSegmentMap.size).toBe(solver.getOutput().length)
  }
})
