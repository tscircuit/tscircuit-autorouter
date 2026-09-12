import assert from "node:assert/strict"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { InMemoryCache } from "../../../lib/cache/InMemoryCache"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../../lib/types/high-density-types"
import { importReference } from "./tsReference"

const { GrowShrinkHighDensityIntraNodeSolver: ReferenceGrowth } = await importReference<{ GrowShrinkHighDensityIntraNodeSolver: typeof GrowShrinkHighDensityIntraNodeSolver }>("lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver.ts")
const node: NodeWithPortPoints = {
  capacityMeshNodeId: "validator-growth", center: { x: 1, y: 2 }, width: 4, height: 4, availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", rootConnectionName: "a", portPointId: "a1", x: -1, y: 1, z: 0 },
    { connectionName: "a", rootConnectionName: "a", portPointId: "a2", x: 3, y: 3, z: 0 },
  ],
}
function run(Solver: typeof GrowShrinkHighDensityIntraNodeSolver): unknown {
  const cache = new InMemoryCache()
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = cache
  const validations: string[] = []
  const observedStates: unknown[] = []
  const solver: GrowShrinkHighDensityIntraNodeSolver = new Solver({
    nodeWithPortPoints: structuredClone(node), maxGrowthAttempts: 2,
    growShrinkSolutionValidator(routes: HighDensityIntraNodeRoute[]): boolean {
      observedStates.push({ scale: solver.scaleFactor, attempts: solver.growthAttempts,
        active: solver.activeSubSolver?.getSolverName(), activeSolved: solver.activeSubSolver?.solved,
        iterations: solver.iterations, maxGrowthAttempts: solver.maxGrowthAttempts })
      validations.push(JSON.stringify(routes))
      solver.maxGrowthAttempts = 3
      solver.stats.validatorCalls = validations.length
      cache.cacheHits += 2
      cache.cacheMisses += 3
      return validations.length > 1
    },
  })
  solver.solve()
  assert.equal(validations.length, 2)
  assert.equal(solver.solved, true)
  assert.equal(solver.activeSubSolver, null)
  assert.equal(solver.scaleFactor, 2)
  assert.equal(solver.failedSolvers.length, 1)
  assert.equal(solver.failedSolvers[0].solved, false)
  assert.equal(solver.failedSolvers[0].failed, true)
  assert.equal(solver.failedSolvers[0].error, "High-density scale solution rejected by validator")
  assert.ok(solver.winningSolver)
  assert.notEqual(solver.solvedRoutes, solver.winningSolver.solvedRoutes, "Scaled winner uses a distinct route array")
  const snapshot = {
    validations, observedStates, stats: solver.stats, iterations: solver.iterations, progress: solver.progress, error: solver.error,
    routes: solver.solvedRoutes, growthAttempts: solver.growthAttempts,
    failed: solver.failedSolvers.map((child) => ({ iterations: child.iterations, error: child.error, routes: child.solvedRoutes })),
    winner: { iterations: solver.winningSolver.iterations, routes: solver.winningSolver.solvedRoutes },
    cacheHits: cache.cacheHits, cacheMisses: cache.cacheMisses,
  }
  return JSON.parse(JSON.stringify(snapshot))
}
assert.deepEqual(run(GrowShrinkHighDensityIntraNodeSolver), run(ReferenceGrowth))
for (const Solver of [GrowShrinkHighDensityIntraNodeSolver, ReferenceGrowth]) {
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
  const sentinel = new Error("validator sentinel")
  const solver = new Solver({ nodeWithPortPoints: structuredClone(node), growShrinkSolutionValidator(): boolean { throw sentinel } })
  assert.throws(() => solver.solve(), (error: unknown): boolean => error === sentinel)
  assert.equal(solver.failed, true)
  assert.equal(solver.error, "GrowShrinkHighDensityIntraNodeSolver error: Error: validator sentinel")
}
console.log("Grow/shrink validator parity: rejected first attempt, scaled success, retained child state and callback cache mutations")
