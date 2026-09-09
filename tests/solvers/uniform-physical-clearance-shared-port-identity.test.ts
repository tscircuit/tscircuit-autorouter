import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("shared IDs coalesce across both owners and pair aliases without losing later names", (): void => {
  const input = createUniformPhysicalClearanceInput({
    orientation: "horizontal",
    axisStart: 10,
    axisEnd: 14,
    sharedCoordinate: 20,
    portPoints: [
      {
        portPointId: "shared-first",
        connectionName: "first-branch",
        rootConnectionName: "first-root",
        x: 10.5,
        y: 20,
        z: 0,
      },
      {
        portPointId: "shared-second",
        connectionName: "second-branch",
        x: 13.5,
        y: 20,
        z: 0,
      },
    ],
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 9.5, y: 20 },
        width: 0.5,
        height: 0.5,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    canonicalNetIdByConnectionName: new Map([
      ["first-branch", "first-net"],
      ["first-owner-alias", "first-net"],
      ["first-pair-alias", "first-net"],
      ["second-branch", "second-net"],
      ["second-pair-alias", "second-net"],
    ]),
    traceWidth: 0.5,
    traceToPadClearance: 0.25,
    traceToTraceClearance: 0.25,
  })
  input.nodeWithPortPoints[1].portPoints[0].connectionName = "first-owner-alias"
  for (const node of input.nodeWithPortPoints) {
    node.portPointsInPairs = [
      [
        { ...node.portPoints[0], connectionName: "first-pair-alias" },
        { ...node.portPoints[1], connectionName: "second-pair-alias" },
      ],
    ]
  }
  for (const point of input.inputNodesWithPortPoints[1].portPoints) {
    point.connectionNodeIds = ["second-owner", "first-owner"]
  }
  const originalNodes = structuredClone(input.nodeWithPortPoints)
  const solver = new UniformPortDistributionSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.mapOfOwnerPairToPortPoints.size).toBe(1)
  const family = [...solver.mapOfOwnerPairToPortPoints.values()][0]
  expect(family).toHaveLength(2)
  const output = solver.getOutput()
  expect(output).toHaveLength(2)
  for (let index = 0; index < output.length; index++) {
    const node = output[index]
    expect(node.portPoints).toEqual([
      { ...originalNodes[index].portPoints[0], x: 11 },
      { ...originalNodes[index].portPoints[1], x: 13 },
    ])
    expect(node.portPointsInPairs).toEqual([
      [
        { ...originalNodes[index].portPointsInPairs![0][0], x: 11 },
        { ...originalNodes[index].portPointsInPairs![0][1], x: 13 },
      ],
    ])
  }
  expect(input.nodeWithPortPoints).toEqual(originalNodes)
})
