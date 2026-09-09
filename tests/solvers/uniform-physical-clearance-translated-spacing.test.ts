import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("absolute translated coordinates preserve physical spacing after uniform placement", (): void => {
  const input = createUniformPhysicalClearanceInput({
    orientation: "horizontal",
    axisStart: 10.5,
    axisEnd: 10.6875,
    sharedCoordinate: 20,
    portPoints: [
      {
        portPointId: "first-port",
        connectionName: "first-route",
        x: 10.515625,
        y: 20,
        z: 0,
      },
      {
        portPointId: "second-port",
        connectionName: "second-route",
        x: 10.648,
        y: 20,
        z: 0,
      },
    ],
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 10.71, y: 20 },
        width: 0.02,
        height: 0.02,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    canonicalNetIdByConnectionName: new Map([
      ["first-route", "first-net"],
      ["second-route", "second-net"],
    ]),
    traceWidth: 0.1,
    traceToPadClearance: 0,
    traceToTraceClearance: 0,
  })
  const originalNodes = structuredClone(input.nodeWithPortPoints)
  const solver = new UniformPortDistributionSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toHaveLength(2)
  for (const node of solver.getOutput()) {
    const first = node.portPoints[0]
    const second = node.portPoints[1]
    expect(first.x).toBe(10.546875)
    expect(second.x).toBe(10.646875000000001)
    expect(second.x - first.x).toBeGreaterThanOrEqual(0.1)
    expect(first.y).toBe(20)
    expect(second.y).toBe(20)
    expect(first.z).toBe(0)
    expect(second.z).toBe(0)
  }
  expect(input.nodeWithPortPoints).toEqual(originalNodes)
})
