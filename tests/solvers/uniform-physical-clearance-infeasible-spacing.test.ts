import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("infeasible fixed terminal spacing fails without moving either anchor", (): void => {
  const input = createUniformPhysicalClearanceInput({
    orientation: "horizontal",
    axisStart: 10,
    axisEnd: 14,
    sharedCoordinate: 20,
    portPoints: [
      {
        portPointId: "first-terminal",
        connectionName: "first-route",
        x: 10.5,
        y: 20,
        z: 0,
      },
      {
        portPointId: "second-terminal",
        connectionName: "second-route",
        x: 10.75,
        y: 20,
        z: 0,
      },
    ],
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 13.75, y: 20 },
        width: 0.5,
        height: 0.5,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    canonicalNetIdByConnectionName: new Map([
      ["first-route", "first-net"],
      ["second-route", "second-net"],
    ]),
    traceWidth: 0.5,
    traceToPadClearance: 0.25,
    traceToTraceClearance: 0.25,
  })
  input.inputNodesWithPortPoints[0]._containsTarget = true
  const originalNodes = structuredClone(input.nodeWithPortPoints)
  const solver = new UniformPortDistributionSolver(input)
  expect(solver.solve.bind(solver)).toThrow(
    "infeasible ordered placement at port 0",
  )
  expect(solver.solved).toBe(false)
  expect(solver.getOutput()).toHaveLength(0)
  expect(input.nodeWithPortPoints).toEqual(originalNodes)
})
