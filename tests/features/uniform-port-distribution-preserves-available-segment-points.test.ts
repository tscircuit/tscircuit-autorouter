import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

const makeInput = () => {
  const availableSegmentPoints = [
    {
      portPointId: "slot-1",
      connectionName: "route-a",
      rootConnectionName: "root-a",
      x: 4,
      y: -3,
      z: 0,
    },
    {
      portPointId: "slot-2",
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
        portPoints: structuredClone(availableSegmentPoints),
        portPointsInPairs: [
          structuredClone(availableSegmentPoints) as [
            (typeof availableSegmentPoints)[number],
            (typeof availableSegmentPoints)[number],
          ],
        ],
      },
      {
        capacityMeshNodeId: "node-b",
        center: { x: 8, y: 0 },
        width: 8,
        height: 8,
        availableZ: [0],
        portPoints: structuredClone(availableSegmentPoints),
        portPointsInPairs: [
          structuredClone(availableSegmentPoints) as [
            (typeof availableSegmentPoints)[number],
            (typeof availableSegmentPoints)[number],
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
      portPoints: availableSegmentPoints.map((point) => ({
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

test("uniform distribution preserves available segment point positions when capacity is enforced", () => {
  const legacySolver = new UniformPortDistributionSolver(makeInput())
  legacySolver.solve()

  const capacitySolver = new UniformPortDistributionSolver({
    ...makeInput(),
    preserveAvailableSegmentPointPositions: true,
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
  expect(
    getSvgFromGraphicsObject(capacitySolver.visualize()),
  ).toMatchSvgSnapshot(import.meta.path)
})
