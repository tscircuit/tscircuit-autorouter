import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("translated pad boundaries select the nearest representable clear point in the same channel", (): void => {
  const input = createUniformPhysicalClearanceInput({
    orientation: "horizontal",
    axisStart: 10,
    axisEnd: 11,
    sharedCoordinate: 20,
    portPoints: [
      {
        portPointId: "shared-port",
        connectionName: "route",
        x: 10.9,
        y: 20,
        z: 0,
      },
    ],
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 10.4, y: 20 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    canonicalNetIdByConnectionName: new Map([["route", "route-net"]]),
    traceWidth: 0.2,
    traceToPadClearance: 0.1,
    traceToTraceClearance: 0.1,
  })
  const originalNodes = structuredClone(input.nodeWithPortPoints)
  const index = input.physicalClearanceContext.traceClearanceIndex
  expect(
    index.isPointClear({
      point: { x: 10.7, y: 20, z: 0 },
      canonicalNetId: "route-net",
      copperDiameter: 0.2,
    }),
  ).toBe(false)
  const solver = new UniformPortDistributionSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toHaveLength(2)
  for (const node of solver.getOutput()) {
    expect(node.portPoints[0]).toEqual({
      ...originalNodes[0].portPoints[0],
      x: 10.700000000000001,
    })
    expect(
      index.isPointClear({
        point: node.portPoints[0],
        canonicalNetId: "route-net",
        copperDiameter: 0.2,
      }),
    ).toBe(true)
  }
  expect(input.nodeWithPortPoints).toEqual(originalNodes)
})
