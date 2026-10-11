import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver, type SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

function params(): ConstructorParameters<typeof MultiSimplifiedPathSolver>[0] {
  return { obstacles: [], unsimplifiedHdRoutes: Array.from({ length: 4 }, (_, index) => ({ connectionName: `route-${index}`,
    traceThickness: 0.15, viaDiameter: 0.3, vias: [], route: [{ x: -2, y: index * 0.8, z: 0 },
      { x: 0, y: index * 0.8 + 0.3, z: 0 }, { x: 2, y: index * 0.8, z: 0 }] })) }
}
type Index = NonNullable<ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]["geometryQuery"]>["index"]

test("initial native Base.step finishes caps/progress before continuation and private cleanup never invokes late Promise callbacks", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  for (const cap of [0, 1]) {
    const native = new MultiSimplifiedPathSolver(params())
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
    const parallel = new ParallelMultiSimplifiedPathSolver({ ...params(), workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
    const nativeEvents: unknown[] = []
    const parallelEvents: unknown[] = []
    const addHook = (solver: MultiSimplifiedPathSolver, events: unknown[]): void => {
      const index = (solver as unknown as { geometryIndex: Index }).geometryIndex
      const query = index.getCandidateRoutes
      index.getCandidateRoutes = (...args): ReturnType<typeof query> => {
        events.push(["query", solver.iterations, solver.currentUnsimplifiedHdRouteIndex])
        solver.MAX_ITERATIONS = cap
        Object.defineProperty(solver, "computeProgress", { configurable: true, get(): () => number {
          events.push(["progress-get", solver.iterations, solver.failed])
          return (): number => { events.push(["progress-call", solver.iterations, solver.failed]); return solver.iterations / 10 }
        } })
        return query.apply(index, args)
      }
    }
    try {
      addHook(native, nativeEvents)
      addHook(parallel, parallelEvents)
      native.step()
      parallel.step()
      expect(parallelEvents).toEqual(nativeEvents)
      expect(parallel.iterations).toBe(1)
      expect(parallel.currentUnsimplifiedHdRouteIndex).toBe(native.currentUnsimplifiedHdRouteIndex)
      expect(parallel.failed).toBe(native.failed)
      const effect = parallel.pendingEffects![0]!.promise
      native.solve()
      try { await effect } catch { expect(native.failed).toBe(true) }
      expect(parallelEvents).toEqual(nativeEvents)
      expect(parallel.iterations).toBe(native.iterations)
      expect(parallel.progress).toBe(native.progress)
      expect(parallel.activeSubSolver?.iterations).toBe(native.activeSubSolver?.iterations)
      expect(parallel.stats.lookaheadSpeculativeJobs).toBe(0)
    } finally { pool.dispose() }
  }
  for (const [owner, key] of [[Promise, "resolve"], [Promise.prototype, "then"], [Promise.prototype, "catch"]] as const) {
    const native = new MultiSimplifiedPathSolver(params())
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
    const parallel = new ParallelMultiSimplifiedPathSolver({ ...params(), workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)!
    let calls = 0
    let nativeCalls = 0
    let failure: unknown
    try {
      native.step()
      parallel.step()
      const effect = parallel.pendingEffects![0]!.promise
      await Promise.resolve()
      Object.defineProperty(owner, key, { configurable: true, get(): never { calls++; throw new RangeError(`late Promise.${key}`) } })
      native.solve()
      nativeCalls = calls
      try { await effect } catch (error: unknown) { failure = error }
    } finally { Object.defineProperty(owner, key, descriptor); pool.dispose() }
    expect(failure).toBeUndefined()
    expect(nativeCalls).toBe(0)
    expect(calls).toBe(0)
    expect(parallel.solved).toBe(true)
    expect(parallel.failed).toBe(false)
    expect(parallel.iterations).toBe(native.iterations)
    expect(parallel.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
  }
  for (const mutation of ["frozen", "readonly", "accessor", "writable", "private-accessor"] as const) {
    const native = new MultiSimplifiedPathSolver(params())
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
    const parallel = new ParallelMultiSimplifiedPathSolver({ ...params(), workerPool: pool, workerCount: 4, useCertifiedLookahead: true })
    try {
      native.step()
      parallel.step()
      const effect = parallel.pendingEffects![0]!.promise
      await Promise.resolve()
      let reads = 0
      const sentinel = { caller: "diagnostic" }
      const mutate = (stats: object): void => {
        if (mutation === "frozen") Object.freeze(stats)
        else if (mutation === "accessor") Object.defineProperty(stats, "nativePathSteps", {
          configurable: true, get(): unknown { reads++; return sentinel },
        })
        else Object.defineProperty(stats, "nativePathSteps", { value: sentinel, configurable: true, writable: mutation === "writable" })
      }
      if (mutation === "private-accessor") {
        const privateStats = (parallel as unknown as { lookaheadEligibility: { stats: object } }).lookaheadEligibility.stats
        Object.defineProperty(privateStats, "injectedObserver", { enumerable: true, get(): never { reads++; throw new RangeError("private diagnostics observer") } })
      } else { mutate(native.stats); mutate(parallel.stats) }
      const originalStats = Object.getOwnPropertyDescriptors(parallel.stats)
      native.solve()
      await effect
      expect(parallel.solved).toBe(true)
      expect(parallel.failed).toBe(false)
      expect(parallel.iterations).toBe(native.iterations)
      expect(parallel.simplifiedHdRoutes).toEqual(native.simplifiedHdRoutes)
      expect(Object.getOwnPropertyDescriptors(parallel.stats)).toEqual(originalStats)
      expect(reads).toBe(0)
      expect(parallel.pendingEffects).toEqual([])
    } finally { pool.dispose() }
  }
})
