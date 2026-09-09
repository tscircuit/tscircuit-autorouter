import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("physical uniform placement preserves the shared midpoint of overlapping owners", (): void => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    const horizontal = orientation === "horizontal"
    const input = createUniformPhysicalClearanceInput({
      orientation,
      axisStart: 10,
      axisEnd: 14,
      sharedCoordinate: 20,
      portPoints: [
        {
          x: horizontal ? 10.25 : 20,
          y: horizontal ? 20 : 10.25,
          z: 0,
          portPointId: "shared-midpoint",
          connectionName: "route",
        },
      ],
      rectangles: [
        {
          kind: "fixed-rectangle",
          center: { x: horizontal ? 12 : 20, y: horizontal ? 20 : 12 },
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
    for (const node of [
      ...input.nodeWithPortPoints,
      ...input.inputNodesWithPortPoints,
    ]) {
      if (horizontal) node.height += 0.0000004
      else node.width += 0.0000004
    }
    const originalNodes = structuredClone(input.nodeWithPortPoints)
    const solver = new UniformPortDistributionSolver(input)
    const reconstructedEdge = [...solver.mapOfOwnerPairToSharedEdge.values()][0]
    expect(horizontal ? reconstructedEdge.y1 : reconstructedEdge.x1).not.toBe(
      20,
    )
    solver.solve()
    expect(solver.solved).toBe(true)
    for (const node of solver.getOutput()) {
      expect(node.portPoints).toEqual([
        {
          ...originalNodes[0].portPoints[0],
          x: horizontal ? 11 : 20,
          y: horizontal ? 20 : 11,
        },
      ])
      expect(
        input.physicalClearanceContext.traceClearanceIndex.isPointClear({
          point: node.portPoints[0],
          canonicalNetId: "route-net",
          copperDiameter: 0.5,
        }),
      ).toBe(true)
    }
    expect(input.nodeWithPortPoints).toEqual(originalNodes)
  }
})
