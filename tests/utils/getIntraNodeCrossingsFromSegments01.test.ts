import { expect, test } from "bun:test"
import { getIntraNodeCrossingsFromSegments } from "../../lib/utils/getIntraNodeCrossingsFromSegments"
import type { SegmentWithAssignedPoints } from "../../lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"

test("ignores coincident assigned points instead of counting a phantom crossing", () => {
  // netA is assigned to the same coordinate on two adjacent segments, so its
  // two assigned points are distinct objects with identical coordinates.
  // netB has a real pair that passes through that coordinate.
  const segments: SegmentWithAssignedPoints[] = [
    {
      capacityMeshNodeId: "cmn1",
      nodePortSegmentId: "seg1",
      start: { x: -2, y: 0 },
      end: { x: 0, y: 0 },
      availableZ: [0, 1],
      connectionNames: ["netA", "netB"],
      assignedPoints: [
        { connectionName: "netA", point: { x: 0, y: 0, z: 0 } },
        { connectionName: "netB", point: { x: -1, y: 0, z: 0 } },
      ],
    },
    {
      capacityMeshNodeId: "cmn1",
      nodePortSegmentId: "seg2",
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
      availableZ: [0, 1],
      connectionNames: ["netA", "netB"],
      assignedPoints: [
        { connectionName: "netA", point: { x: 0, y: 0, z: 0 } },
        { connectionName: "netB", point: { x: 1, y: 0, z: 0 } },
      ],
    },
  ]

  const { numSameLayerCrossings, numTransitionCrossings } =
    getIntraNodeCrossingsFromSegments(segments)

  expect(numSameLayerCrossings).toBe(0)
  expect(numTransitionCrossings).toBe(0)
})
