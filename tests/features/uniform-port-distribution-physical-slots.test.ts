import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

const makeInput = () => {
  const physicalPoints = [
    {
      portPointId: "slot-1",
      physicalPortalGroupId: "edge-a-b",
      physicalPortalSlotId: "edge-a-b::slot-1::0",
      connectionName: "route-a",
      rootConnectionName: "root-a",
      x: 4,
      y: -3,
      z: 0,
    },
    {
      portPointId: "slot-2",
      physicalPortalGroupId: "edge-a-b",
      physicalPortalSlotId: "edge-a-b::slot-2::0",
      connectionName: "route-b",
      rootConnectionName: "root-b",
      x: 4,
      y: -2,
      z: 0,
    },
  ]

  return {
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "node-a",
        center: { x: 0, y: 0 },
        width: 8,
        height: 8,
        availableZ: [0],
        portPoints: structuredClone(physicalPoints),
        portPointsInPairs: [
          structuredClone(physicalPoints) as [
            (typeof physicalPoints)[number],
            (typeof physicalPoints)[number],
          ],
        ],
      },
      {
        capacityMeshNodeId: "node-b",
        center: { x: 8, y: 0 },
        width: 8,
        height: 8,
        availableZ: [0],
        portPoints: structuredClone(physicalPoints),
        portPointsInPairs: [
          structuredClone(physicalPoints) as [
            (typeof physicalPoints)[number],
            (typeof physicalPoints)[number],
          ],
        ],
      },
    ],
    inputNodesWithPortPoints: ["node-a", "node-b"].map((nodeId) => ({
      capacityMeshNodeId: nodeId,
      center: { x: nodeId === "node-a" ? 0 : 8, y: 0 },
      width: 8,
      height: 8,
      availableZ: [0],
      portPoints: physicalPoints.map((point) => ({
        portPointId: point.portPointId,
        x: point.x,
        y: point.y,
        z: point.z,
        connectionNodeIds: ["node-a", "node-b"] as [string, string],
        distToCentermostPortOnZ: 0,
      })),
    })),
    obstacles: [],
  }
}

test("physical capacity mode preserves authoritative portal slots", () => {
  const legacySolver = new UniformPortDistributionSolver(makeInput())
  legacySolver.solve()

  const capacitySolver = new UniformPortDistributionSolver({
    ...makeInput(),
    preservePhysicalPortalSlots: true,
  })
  capacitySolver.solve()

  const legacyPoints = legacySolver.getOutput()[0].portPoints
  const capacityPoints = capacitySolver.getOutput()[0].portPoints

  expect(legacyPoints.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
    { x: 4, y: -2, z: 0 },
    { x: 4, y: 2, z: 0 },
  ])
  expect(capacityPoints).toEqual(makeInput().nodeWithPortPoints[0].portPoints)
  expect(capacitySolver.getOutput()[0].portPointsInPairs?.flat()).toEqual(
    capacityPoints,
  )
})
