import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { runForceDirectedImprovement } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import {
  createSparseForceStats,
  runSparseForceDirectedImprovement,
} from "lib/solvers/SparseForceImproveSolver/SparseHighDensityForceImproveSolver"
import { createSparseForceDifferentialCases } from "tests/fixtures/createSparseForceDifferentialCases"

test("sparse kernel preserves the frozen native numerical result and vectors", () => {
  expect(createHash("sha256").update(readFileSync(require.resolve("high-density-repair01/lib/HighDensityForceImproveSolver"), "utf8")).digest("hex"))
    .toBe("3e1465801470c5f0bfb3160f97a2547dccd0e437af6c8c74dc1d4708e64a2201")
  const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
  const cases = createSparseForceDifferentialCases()
  for (const item of cases) {
    for (const steps of [0, 1, 12, 20, 1.5, -1]) {
      for (const includeForceVectors of [true, false]) {
        const before = structuredClone(item.routes)
        const native = runForceDirectedImprovement(bounds, item.routes, steps, { includeForceVectors })
        const stats = createSparseForceStats()
        const sparse = runSparseForceDirectedImprovement(bounds, item.routes, steps, { includeForceVectors, stats })
        expect(sparse, `${item.name}/${steps}/${includeForceVectors}`).toEqual(native)
        expect(item.routes).toEqual(before)
        expect(stats.activated).toBe(true)
        expect(stats.kernelCalls).toBe(1)
      }
    }
  }
  const fixed = createSparseForceStats()
  runSparseForceDirectedImprovement(bounds, cases[1]!.routes, 20, { stats: fixed })
  expect(fixed.allFixedCalls).toBe(1)
  expect(fixed.executedForceSteps).toBe(0)
  expect(fixed.skippedForceSteps).toBe(20)
  expect(fixed.projectionPassesSkipped).toBe(68)
  expect(fixed.spatialIndexBuilds).toBe(0)
  const clean = createSparseForceStats()
  runSparseForceDirectedImprovement(bounds, cases[5]!.routes, 20, { stats: clean })
  expect(clean.allFixedCalls).toBe(0)
  expect(clean.executedForceSteps).toBe(20)
  expect(clean.inactiveProjectionExits).toBe(21)
  expect(clean.projectionPassesSkipped).toBe(47)
  expect(clean.spatialIndexBuilds).toBe(21)
  const overlap = createSparseForceStats()
  runSparseForceDirectedImprovement(bounds, cases[7]!.routes, 0, { stats: overlap })
  expect(overlap.inactiveProjectionExits).toBe(0)
  expect(overlap.projectionPassesExecuted).toBe(8)
  const mixed = createSparseForceStats()
  runSparseForceDirectedImprovement(bounds, cases[8]!.routes, 20, { stats: mixed })
  expect(mixed.noWritePairsSkipped).toBeGreaterThan(0)
  expect(mixed.fixedClampVisitsSkipped).toBeGreaterThan(0)
  expect(mixed.mutableNodeCount).toBeGreaterThan(0)
})
