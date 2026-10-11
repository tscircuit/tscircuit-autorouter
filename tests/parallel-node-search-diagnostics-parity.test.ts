import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"

test("worker grid searches omit retained diagnostics without changing original routing steps", () => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "diagnostic-parity",
      center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
      portPoints: [
        { x: -1.5, y: -1, z: 0, connectionName: "a" },
        { x: 1.5, y: 1, z: 0, connectionName: "a" },
        { x: -1.5, y: 1, z: 1, connectionName: "b" },
        { x: 1.5, y: -1, z: 1, connectionName: "b" },
      ],
    },
    traceWidth: 0.15, viaDiameter: 0.3, cacheProvider: null,
  }
  const original = new PortfolioSingleIntraNodeSolver(structuredClone(params))
  const worker = new ParallelPortfolioSingleIntraNodeSolver(structuredClone(params), async () => new Map())
  const a = original.generateSolver({ SHUFFLE_SEED: 0 })
  const b = worker.generateSolver({ SHUFFLE_SEED: 0 })
  expect(a).toBeInstanceOf(IntraNodeRouteSolver)
  expect(b).toBeInstanceOf(IntraNodeRouteSolver)
  expect(a.captureSearchDebug).toBe(true)
  expect(b.captureSearchDebug).toBe(false)
  let originalCaptured = 0
  while (!a.solved && !a.failed) {
    a.step()
    b.step()
    expect({ solved: b.solved, failed: b.failed, error: b.error, iterations: b.iterations,
      progress: b.progress, MAX_ITERATIONS: b.MAX_ITERATIONS, stats: b.stats, routes: b.solvedRoutes })
      .toEqual({ solved: a.solved, failed: a.failed, error: a.error, iterations: a.iterations,
        progress: a.progress, MAX_ITERATIONS: a.MAX_ITERATIONS, stats: a.stats, routes: a.solvedRoutes })
    if (a.activeSubSolver && b.activeSubSolver) {
      originalCaptured += a.activeSubSolver.debug_exploredNodesOrdered.length
      expect(b.activeSubSolver.debug_exploredNodesOrdered).toHaveLength(0)
    }
  }
  expect(a.solved).toBe(true)
  expect(originalCaptured).toBeGreaterThan(0)
})
