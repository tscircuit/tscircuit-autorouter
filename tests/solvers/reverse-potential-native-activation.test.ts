import { expect, test } from "bun:test"
import { ReverseCostToGoCache } from "lib/solvers/HighDensitySolver/ReverseCostToGoCache"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("real native solves use stronger reverse guidance, share a repeated query and repair a moved future context", () => {
  const diagnostics: Record<string, number> = {}
  const cache = new ReverseCostToGoCache(diagnostics)
  let charged = 0
  for (let query = 0; query < 3; query++) {
    const compiledBefore = diagnostics.reversePotentialCompiledCells
    const repairedBefore = diagnostics.reversePotentialRepairWork
    const solver = new Native({
      connectionName: "dense", regionId: "tiny", obstacleRoutes: [],
      minDistBetweenEnteringPoints: 0.05,
      bounds: { minX: 0, minY: 0, maxX: 1.2, maxY: 0.5 },
      A: { x: 0, y: 0.25, z: 0 }, B: { x: 1.2, y: 0.25, z: 0 },
      availableZ: [0], layerCount: 1, viaDiameter: 0.08,
      traceThickness: 0.02, obstacleMargin: 0.01,
      captureSearchDebug: false, reversePotentialCache: cache,
      reversePotentialWorkCharge: (units): void => { charged += units },
      futureConnections: [{ connectionName: "future", points: Array.from({ length: 8 }, (_, index) => ({
        x: 0.1 + index * 0.1, y: 0.25 + (query === 2 ? 0.05 : 0), z: 0,
      })) }],
    })
    solver.solve()
    if (query === 1) {
      expect(diagnostics.reversePotentialCompiledCells).toBe(compiledBefore)
      expect(diagnostics.reversePotentialRepairWork).toBe(repairedBefore)
    }
    expect(solver.solved).toBe(true)
    expect(solver.error).toBeNull()
    expect(solver.solvedPath!.route[0]).toMatchObject(solver.A)
    expect(solver.solvedPath!.route.at(-1)).toMatchObject(solver.B)
    for (const point of solver.solvedPath!.route) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(1.2)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(0.5)
      expect(point.z).toBe(0)
    }
  }
  expect(diagnostics.reversePotentialStrengthenedQueries).toBeGreaterThan(700)
  expect(diagnostics.reversePotentialCacheHits).toBe(1)
  expect(diagnostics.reversePotentialRepairs).toBe(1)
  expect(diagnostics.reversePotentialChangedCells).toBeGreaterThan(55)
  expect(charged).toBe(diagnostics.reversePotentialChargedWorkUnits)
  expect(diagnostics.reversePotentialRepairWork).toBeLessThan(3 * 100_000)
})
