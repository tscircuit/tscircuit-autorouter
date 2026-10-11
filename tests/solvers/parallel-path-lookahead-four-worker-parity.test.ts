import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { canUseNativePathLookaheadPool, Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("four native workers publish exact ordered route geometry and counters under both transports", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const routes: HighDensityRoute[] = []
  for (let index = 0; index < 24; index++) {
    const y = index * 0.34
    routes.push({ connectionName: `route-${index}`, traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -2, y, z: index % 3 }, { x: -1, y: y + 0.43, z: index % 3 },
        { x: 1, y: y + 0.43, z: index % 3 }, { x: 2, y, z: index % 3 }],
      vias: index % 4 === 0 ? [{ x: 0.1, y: y + 0.43 }] : [] })
  }
  for (const contextTransport of ["structured-clone", "bun-shared"] as const) {
    const config = { unsimplifiedHdRoutes: structuredClone(routes), obstacles: [], connMap: new ConnectivityMap({}) }
    const native = new MultiSimplifiedPathSolver(config)
    native.solve()
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport })
    try {
      expect(canUseNativePathLookaheadPool(pool)).toBe(true)
      const parallel = new ParallelMultiSimplifiedPathSolver({ ...config, workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
      await parallel.solveAsync()
      expect(parallel.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
      expect(parallel.iterations).toBe(native.iterations)
      expect(parallel.stats.nativePathSteps).toBe(native.iterations)
      expect(parallel.solved).toBe(true)
      expect(parallel.failed).toBe(false)
      expect(parallel.stats.lookaheadSpeculativeJobs).toBe(24)
      expect(parallel.stats.lookaheadCertifiedRoutes).toBeGreaterThan(0)
      expect(parallel.stats.lookaheadMaximumLookahead).toBe(Math.min(64, routes.length))
      expect(parallel.stats.lookaheadSpeculativeNativeSteps + parallel.stats.lookaheadOrderedRerunNativeSteps).toBeGreaterThanOrEqual(native.iterations - 1)
      expect(pool.stats.maxActiveWorkers).toBe(4)
      expect(pool.stats.tasksCompleted).toBe(24)
      if (contextTransport === "bun-shared") expect(pool.stats.sharedContextMessages).toBeGreaterThan(0)
    } finally { pool.dispose() }
  }
  const custom = new Pipeline9LocalWorkerPool({ workerFactory: (): Worker => { throw new Error("custom worker must remain unused") } })
  try { expect(canUseNativePathLookaheadPool(custom)).toBe(false) }
  finally { custom.dispose() }
  const pool = new Pipeline9LocalWorkerPool()
  try {
    let calls = 0
    Object.defineProperty(pool, "run", { get: (): never => { calls++; throw new Error("observable getter") } })
    expect(canUseNativePathLookaheadPool(pool)).toBe(false)
    expect(calls).toBe(0)
    const urlDescriptor = Object.getOwnPropertyDescriptor(globalThis, "URL")!
    try {
      Object.defineProperty(globalThis, "URL", { configurable: true, get: (): never => { calls++; throw new Error("observable URL getter") } })
      expect(canUseNativePathLookaheadPool(pool)).toBe(false)
      expect(calls).toBe(0)
    } finally { Object.defineProperty(globalThis, "URL", urlDescriptor) }
  } finally { pool.dispose() }
})
