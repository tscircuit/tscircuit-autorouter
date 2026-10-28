import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { ViaPlacement } from "lib/types/high-density-types"

test("grown native via searches check restored world coordinates and retain original endpoints", () => {
  const observed: ViaPlacement[] = []
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: { capacityMeshNodeId: "tiny-world-node", center: { x: 10, y: 5 },
      width: 0.2, height: 0.2, availableZ: [1, 3],
      portPoints: [{ x: 9.9, y: 5, z: 1, connectionName: "signal" },
        { x: 10.1, y: 5, z: 3, connectionName: "signal" }] },
    layerCount: 4, viaDiameter: 0.3, traceWidth: 0.15,
    viaPlacementValidator: (placement): boolean => {
      observed.push({ ...placement })
      return placement.x > 10.03 && Math.abs(placement.x - 10) <= 0.101 && Math.abs(placement.y - 5) <= 0.101
    },
  })
  // Resume an existing grown attempt and require an off-center world-space via.
  solver.scaleFactor = 2
  solver.growthAttempts = 1
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.growthAttempts).toBeGreaterThan(0)
  expect(observed.length).toBeGreaterThan(0)
  expect(observed.every((placement) => Math.abs(placement.x - 10) <= 0.101 &&
    Math.abs(placement.y - 5) <= 0.101)).toBe(true)
  expect(solver.solvedRoutes[0]!.route[0]).toMatchObject({ x: 9.9, y: 5, z: 1 })
  expect(solver.solvedRoutes[0]!.route.at(-1)).toMatchObject({ x: 10.1, y: 5, z: 3 })
})
