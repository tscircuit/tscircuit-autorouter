import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("a closed free-space pocket does not replace a numerical terminal escape", (): void => {
  const placements: [string, number, boolean][] = [
    ["source", 0, true],
    ["pocket", -1, false],
    ["pocket-end", -2, false],
    ["escape", 1.000254, false],
    ["destination", 2.000254, true],
  ]
  const nodes: CapacityMeshNode[] = placements.map(([id, x, target]) => ({
    capacityMeshNodeId: id,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: target,
    _containsTarget: target,
    _connectedTo: target ? ["GND"] : undefined,
  }))
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "GND",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 2.000254, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
  edges.solve()
  const available = new AvailableSegmentPointSolver({
    nodes,
    edges: edges.edges,
    traceWidth: input.minTraceWidth,
    shouldReturnCrampedPortPoints: true,
    connections: input.connections,
  })
  available.solve()
  const bridge = available
    .getOutput()
    .find(
      (segment) =>
        segment.nodeIds.includes("source") &&
        segment.nodeIds.includes("escape"),
    )
  expect(bridge?.crossesNumericalGap).toBe(true)
  expect(bridge!.portPoints.length).toBeGreaterThan(0)
  const necessary = new MultiTargetNecessaryCrampedPortPointSolver({
    sharedEdgeSegments: available.getOutput(),
    capacityMeshNodes: nodes,
    simpleRouteJson: input,
  })
  necessary.solve()
  const retained = necessary
    .getOutput()
    .find((segment) => segment.edgeId === bridge!.edgeId)
  expect(retained!.portPoints.length).toBeGreaterThan(0)
})
