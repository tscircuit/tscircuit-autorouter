import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("uniform placement stays in its selected legal channel when the midpoint hits a pad", (): void => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    const selected = {
      x: orientation === "horizontal" ? 10.25 : 20,
      y: orientation === "horizontal" ? 20 : 10.25,
      z: 0,
    }
    const midpoint = {
      x: orientation === "horizontal" ? 12 : 20,
      y: orientation === "horizontal" ? 20 : 12,
      z: 0,
    }
    const input = createUniformPhysicalClearanceInput({
      orientation,
      axisStart: 10,
      axisEnd: 14,
      sharedCoordinate: 20,
      portPoints: [
        { ...selected, portPointId: "shared-port", connectionName: "route" },
      ],
      rectangles: [
        {
          kind: "fixed-rectangle",
          center: { x: midpoint.x, y: midpoint.y },
          width: 1,
          height: 1,
          zLayers: [0],
          ownerNetIds: new Set(["pad-net"]),
        },
      ],
      canonicalNetIdByConnectionName: new Map([["route", "route-net"]]),
      traceWidth: 0.5,
      traceToPadClearance: 0.25,
      traceToTraceClearance: 0.25,
    })
    const originalNodes = structuredClone(input.nodeWithPortPoints)
    const index = input.physicalClearanceContext.traceClearanceIndex
    expect(
      index.isPointClear({
        point: midpoint,
        canonicalNetId: "route-net",
        copperDiameter: 0.5,
      }),
    ).toBe(false)
    const solver = new UniformPortDistributionSolver(input)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.getOutput()).toHaveLength(2)
    for (const node of solver.getOutput()) {
      expect(node.portPoints).toEqual([
        {
          ...originalNodes[0].portPoints[0],
          x: orientation === "horizontal" ? 11 : 20,
          y: orientation === "horizontal" ? 20 : 11,
        },
      ])
      expect(
        index.isPointClear({
          point: node.portPoints[0],
          canonicalNetId: "route-net",
          copperDiameter: 0.5,
        }),
      ).toBe(true)
    }
    expect(input.nodeWithPortPoints).toEqual(originalNodes)
  }
})
