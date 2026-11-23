import { expect, test } from "bun:test"
import { TwoCrossingRoutesHighDensitySolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("routes the crossing on the next permitted physical layer", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "crossing",
    center: { x: 0, y: 0 },
    width: 6,
    height: 6,
    availableZ: [0, 3],
    portPoints: [
      { connectionName: "A", x: -2.5, y: -2.5, z: 0 },
      { connectionName: "A", x: 2.5, y: 2.5, z: 0 },
      { connectionName: "B", x: -2.5, y: 2.5, z: 0 },
      { connectionName: "B", x: 2.5, y: -2.5, z: 0 },
    ],
  }
  const solver = new TwoCrossingRoutesHighDensitySolver({
    nodeWithPortPoints: node,
    layerCount: 4,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(
    new Set(
      solver.solvedRoutes.flatMap((route) => route.route.map((p) => p.z)),
    ),
  ).toEqual(new Set([0, 3]))
  const singleLayer = new TwoCrossingRoutesHighDensitySolver({
    nodeWithPortPoints: { ...node, availableZ: [0] },
    layerCount: 4,
  })
  singleLayer.solve()
  expect(singleLayer.failed).toBe(true)
})
