import { expect, test } from "bun:test"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { retainActiveNumericalGapSegments } from "lib/solvers/AvailableSegmentPointSolver/retainActiveNumericalGapSegments"
import type { CapacityMeshNode } from "lib/types"

test("planned component crossings provide an escape without new numerical shortcuts", () => {
  for (const isComponentTopology of [false, true]) {
    const nodes: CapacityMeshNode[] = ["pad", "corridor", "outside"].map(
      (id, index) => ({
        capacityMeshNodeId: id,
        center: { x: index, y: 0 },
        width: 1,
        height: 1,
        layer: "z0",
        availableZ: [0],
        _containsTarget: index === 0,
        _containsObstacle: index === 0,
        _isComponentTopologyNode: isComponentTopology,
      }),
    )
    const edges: [string, string, boolean][] = [
      ["pad", "corridor", false],
      ["corridor", "outside", false],
      ["pad", "outside", true],
    ]
    const segments: SharedEdgeSegment[] = edges.map(([first, second, gap], index) => ({
      edgeId: `edge${index}`,
      nodeIds: [first, second],
      start: { x: index, y: 0 },
      end: { x: index, y: 1 },
      availableZ: [0],
      crossesNumericalGap: gap,
      portPoints: [{
        segmentPortPointId: `port${index}`,
        edgeId: `edge${index}`,
        nodeIds: [first, second],
        x: index,
        y: 0.5,
        availableZ: [0],
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: true,
      }],
    }))
    const retained = retainActiveNumericalGapSegments({
      nodes,
      segments,
      connections: [{
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      }],
    })
    expect(retained.filter((segment) => segment.crossesNumericalGap)).toHaveLength(
      isComponentTopology ? 0 : 1,
    )
    expect(retained.filter((segment) => !segment.crossesNumericalGap)).toHaveLength(2)
    expect(segments.every((segment) => segment.portPoints[0]!.cramped)).toBe(true)
  }
})
