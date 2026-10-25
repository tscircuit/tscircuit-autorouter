import { expect, test } from "bun:test"
import { ReverseCostToGoCache } from "lib/solvers/HighDensitySolver/ReverseCostToGoCache"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("a node's optional preprocessing quota bounds repeated changed-context setup", () => {
  const diagnostics: Record<string, number> = {}
  const cache = new ReverseCostToGoCache(diagnostics, 512 * 1024, 100_000, 100)
  for (let context = 0; context < 20; context++) {
    const solver = new Native({
      connectionName: "budget", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.05,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      A: { x: 0, y: 0.1, z: 0 }, B: { x: 1, y: 0.9, z: 0 },
      futureConnections: [{ connectionName: "future", points: [{ x: 0.5, y: context / 100, z: 0 }] }],
      availableZ: [0], reversePotentialCache: cache, captureSearchDebug: false,
    })
    expect(solver.getReverseCostToGo({ ...solver.A, g: 0, h: 0, f: 0, parent: null })).toBe(0)
  }
  expect((diagnostics.reversePotentialCompileWork ?? 0) + (diagnostics.reversePotentialRepairWork ?? 0)).toBeLessThanOrEqual(100)
  expect(diagnostics.reversePotentialBudgetBypasses).toBe(20)
  expect(cache.memoryBytes).toBe(0)
})
