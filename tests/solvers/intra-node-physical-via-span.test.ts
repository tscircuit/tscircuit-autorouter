import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("same-point intra-node transition checks intermediate fixed copper layers", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [1],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 3,
    minClearance: 0.05,
  })
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "inner-pad-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 2],
    portPoints: [
      { x: 0, y: 0, z: 0, connectionName: "route" },
      { x: 0, y: 0, z: 2, connectionName: "route" },
    ],
  }

  for (const canonicalNetId of ["foreign-net", "pad-net"]) {
    const solver = new IntraNodeRouteSolver({
      nodeWithPortPoints: node,
      layerCount: 3,
      traceWidth: 0.1,
      viaDiameter: 0.3,
      physicalClearanceContext: {
        traceClearanceIndex: index,
        viaClearanceIndex: index,
        traceToTraceClearance: 0.1,
        viaToTraceClearance: 0.1,
        canonicalNetIdByConnectionName: new Map([["route", canonicalNetId]]),
        solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
      },
    })
    solver.step()
    if (canonicalNetId === "pad-net") {
      expect(solver.solvedRoutes).toHaveLength(1)
      expect(solver.solvedRoutes[0]!.route).toEqual([
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
      ])
      expect(solver.solvedRoutes[0]!.vias).toEqual([{ x: 0, y: 0 }])
    } else {
      expect(solver.solvedRoutes).toHaveLength(0)
      expect(solver.activeSubSolver).not.toBeNull()
      expect(solver.activeSubSolver!.layerCount).toBe(3)
      expect(solver.activeSubSolver!.solvedPath).toBeNull()
    }
  }
})
