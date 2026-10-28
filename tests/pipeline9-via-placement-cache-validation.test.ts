import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a cached via cannot bypass new placement constraints or poison unconstrained failure entries", () => {
  const solver = new CachedIntraNodeRouteSolver({
    nodeWithPortPoints: { capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 6, height: 4,
      availableZ: [1, 3], portPoints: [{ x: -2, y: 0, z: 1, connectionName: "signal" },
        { x: 2, y: 0, z: 3, connectionName: "signal" }] },
    layerCount: 4, cacheProvider: null,
    viaPlacementValidator: (placement): boolean => Math.abs(placement.x) > 0.6,
  })
  const unsafe: HighDensityIntraNodeRoute = { connectionName: "signal", traceThickness: 0.15,
    viaDiameter: 0.3, route: [{ x: -2, y: 0, z: 1 }, { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 3 }, { x: 2, y: 0, z: 3 }], vias: [{ x: 0, y: 0 }] }
  solver.applyCachedSolution({ success: true, solvedRoutes: [unsafe] })
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.cacheHit).toBe(false)
  solver.applyCachedSolution({ success: false, error: "failure from another original context" })
  expect(solver.failed).toBe(false)
  expect(solver.cacheHit).toBe(false)
  const safe = structuredClone(unsafe)
  safe.vias = [{ x: 1, y: 0 }]
  safe.route[1]!.x = 1
  safe.route[2]!.x = 1
  solver.applyCachedSolution({ success: true, solvedRoutes: [safe] })
  expect(solver.solved).toBe(true)
  expect(solver.cacheHit).toBe(true)
  expect(solver.solvedRoutes).toEqual([safe])
})
