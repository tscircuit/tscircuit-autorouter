import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver, type SegmentPortPoint, type SharedEdgeSegment } from "../../lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "../../lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "../../lib/types"

test("free-passage retention preserves escape filtering, existing metadata and generated layers", () => {
  for (const scenario of ["free", "target", "obstacle", "multilayer-target", "narrow-qfp", "ordinary", "empty"] as const) {
    const nodes: CapacityMeshNode[] = [
      { capacityMeshNodeId: "a", center: { x: -0.5, y: 0 }, width: 1, height: 0.1, availableZ: scenario === "multilayer-target" ? [0, 1] : [0], _containsTarget: scenario === "target" || scenario === "multilayer-target", _containsObstacle: scenario === "obstacle" || scenario === "multilayer-target", _isNarrowQfpPadGap: scenario === "narrow-qfp" },
      { capacityMeshNodeId: "b", center: { x: 0.5, y: 0 }, width: 1, height: 0.1, availableZ: [0] },
    ]
    const point: SegmentPortPoint = {
      segmentPortPointId: "existing-port", x: 0, y: 0, availableZ: [0], nodeIds: ["a", "b"], edgeId: "edge",
      connectionName: null, distToCentermostPortOnZ: 0, cramped: scenario !== "ordinary",
      _preloadedFixedNetIds: ["fixed-net"],
      _preloadedTracePortAssignments: [{ traceId: "fixed", fixedNetId: "fixed-net", routePosition: 2, tracePoint: { x: 0, y: 0 }, z: 0 }],
    }
    const input: SharedEdgeSegment[] = [{ edgeId: "edge", nodeIds: ["a", "b"], start: { x: 0, y: -0.05 }, end: { x: 0, y: 0.05 }, availableZ: [0], portPoints: scenario === "empty" ? [] : [point] }]
    const original = structuredClone({ nodes, input })
    const srj = { layerCount: 8, minTraceWidth: 0.1, obstacles: [], connections: [], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } } as SimpleRouteJson
    const necessary = new MultiTargetNecessaryCrampedPortPointSolver({ capacityMeshNodes: nodes, sharedEdgeSegments: input, simpleRouteJson: srj })
    necessary.solve()
    const output = necessary.getOutput()
    const expectedCount = scenario === "target" || scenario === "obstacle" || scenario === "empty" ? 0 : 1
    expect(output[0].portPoints).toHaveLength(expectedCount)
    if (expectedCount) {
      const retained = output[0].portPoints[0]
      expect(retained).toEqual(scenario === "ordinary" ? point : { ...point, tinyHypergraphPortPenalty: 1000 })
      expect(retained.availableZ).toEqual([0])
      if (scenario === "ordinary") expect(retained).toBe(point)
      if (scenario === "narrow-qfp") expect(nodes[0]._isNarrowQfpPadGap).toBe(true)
    }
    expect({ nodes, input }).toEqual(original)
    expect(necessary.getOutput()).toBe(output)
  }

  const nodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "a", center: { x: -0.5, y: 0 }, width: 1, height: 0.1, availableZ: [0] },
    { capacityMeshNodeId: "b", center: { x: 0.5, y: 0 }, width: 1, height: 0.1, availableZ: [7] },
  ]
  const available = new AvailableSegmentPointSolver({ nodes, edges: [{ capacityMeshEdgeId: "edge", nodeIds: ["a", "b"] }], traceWidth: 0.1, shouldReturnCrampedPortPoints: true })
  available.solve()
  expect(available.getOutput()).toEqual([])
})
