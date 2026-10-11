import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { captureParallelPathPrototypeContract, createParallelPathLookaheadEligibility,
  getNativeParallelPathLookaheadWindowCapacity } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { createNativeParallelPathLookaheadRun, ParallelPathLookaheadCoordinator } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator"
import { ParallelPathLookaheadExecutor } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { ParallelPathLookaheadResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelPathLookaheadTypes"
import type { HighDensityRoute } from "lib/types/high-density-types"

const ownerContract = captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype)

function makeOwner(): MultiSimplifiedPathSolver {
  const routes: HighDensityRoute[] = []
  for (let index = 0; index < 128; index++) {
    const y = index * 0.37
    routes.push({ connectionName: `window-${index}`, traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -2, y, z: index % 2 }, { x: -1, y: y + 0.4, z: index % 2 },
        { x: 1, y: y + 0.4, z: index % 2 }, { x: 2, y, z: index % 2 }], vias: [] })
  }
  return new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: routes, obstacles: [], connMap: new ConnectivityMap({}) })
}

function state(owner: MultiSimplifiedPathSolver): unknown {
  return { routes: owner.simplifiedHdRoutes, iterations: owner.iterations, cap: owner.MAX_ITERATIONS,
    index: owner.currentUnsimplifiedHdRouteIndex, solved: owner.solved, failed: owner.failed,
    error: owner.error, progress: owner.progress, active: owner.activeSubSolver }
}

test("only exact native owner, helper, worker pool and minted run widen pending work beyond four physical workers", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const owner = makeOwner(), helper = createParallelPathLookaheadEligibility(owner, ownerContract)!
  expect(helper()).toBe(true)
  expect(getNativeParallelPathLookaheadWindowCapacity(owner, helper)).toBe(64)
  expect(getNativeParallelPathLookaheadWindowCapacity(makeOwner(), helper)).toBeUndefined()
  expect(getNativeParallelPathLookaheadWindowCapacity(owner, Object.assign((): boolean => true, helper))).toBeUndefined()
  const indexes = Array.from({ length: 64 }, (_, index) => index)
  const scope = helper.captureScope(indexes)!
  const check = helper.captureAwaitState(scope)!
  expect(check()).toBe(true)
  expect(helper.captureScope([...indexes, 64])).toBeUndefined()
  const point = owner.unsimplifiedHdRoutes[63]!.route[0]!
  const descriptor = Object.getOwnPropertyDescriptor(point, "x")!
  let reads = 0
  Object.defineProperty(point, "x", { configurable: true, enumerable: true, get: (): never => {
    reads++
    throw new RangeError("last pending source observer")
  } })
  expect(check()).toBe(false)
  expect(reads).toBe(0)
  Object.defineProperty(point, "x", descriptor)
  expect(check()).toBe(true)

  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport: "bun-shared" })
  try {
    const fakeHelper = Object.assign((): boolean => true, helper)
    expect(createNativeParallelPathLookaheadRun(owner, fakeHelper, pool)).toBeUndefined()
    expect(createNativeParallelPathLookaheadRun(makeOwner(), helper, pool)).toBeUndefined()
    expect(createNativeParallelPathLookaheadRun(owner, helper, { run: async (): Promise<never> => {
      throw new Error("unowned worker executor")
    } })).toBeUndefined()

    // Real helper/pool fields alone cannot turn a caller callback into a native run.
    const customOwner = makeOwner(), customHelper = createParallelPathLookaheadEligibility(customOwner, ownerContract)!
    const executors = Array.from({ length: 4 }, () => new ParallelPathLookaheadExecutor())
    let customCalls = 0
    const custom = new ParallelPathLookaheadCoordinator({ original: customOwner, contextId: 7001, workerCount: 4,
      isEligible: customHelper, nativeEligibility: customHelper, nativeWorkerPool: pool,
      captureScope: customHelper.captureScope, captureAwaitState: customHelper.captureAwaitState,
      run: async (job): Promise<ParallelPathLookaheadResult> => {
        customCalls++
        await Promise.resolve()
        return executors[job.index % 4]!.execute({ ...structuredClone({ ...job, cancellationBuffer: undefined }), cancellationBuffer: job.cancellationBuffer })
      } })
    const customSolve = custom.solve()
    expect(customCalls).toBe(4)
    await customSolve
    const expectedCustom = makeOwner()
    expectedCustom.solve()
    expect(state(customOwner)).toEqual(state(expectedCustom))
    expect(custom.stats.maximumLookahead).toBe(4)

    const expected = makeOwner()
    expected.solve()
    const nativeOwner = makeOwner(), nativeHelper = createParallelPathLookaheadEligibility(nativeOwner, ownerContract)!
    const run = createNativeParallelPathLookaheadRun(nativeOwner, nativeHelper, pool)!
    const native = new ParallelPathLookaheadCoordinator({ original: nativeOwner, contextId: pool.createContextId(), workerCount: 4,
      run, isEligible: nativeHelper, nativeEligibility: nativeHelper, nativeWorkerPool: pool,
      captureScope: nativeHelper.captureScope, captureAwaitState: nativeHelper.captureAwaitState })
    await native.solve()
    expect(state(nativeOwner)).toEqual(state(expected))
    expect(native.stats.maximumLookahead).toBe(64)
    expect(native.stats.certifiedRoutes + native.stats.orderedReruns).toBe(128)
    expect(native.stats.speculativeJobs).toBe(128)
    expect(pool.stats.maxActiveWorkers).toBe(4)

    // A pending-source mutation withdraws the entire window before publication.
    const changed = makeOwner(), expectedChanged = makeOwner()
    const changedHelper = createParallelPathLookaheadEligibility(changed, ownerContract)!
    const changedCoordinator = new ParallelPathLookaheadCoordinator({ original: changed,
      contextId: pool.createContextId(), workerCount: 4,
      run: createNativeParallelPathLookaheadRun(changed, changedHelper, pool)!,
      isEligible: changedHelper, nativeEligibility: changedHelper, nativeWorkerPool: pool,
      captureScope: changedHelper.captureScope, captureAwaitState: changedHelper.captureAwaitState })
    const changedSolve = changedCoordinator.solve()
    changed.unsimplifiedHdRoutes[63]!.route[0]!.x += 0.2
    expectedChanged.unsimplifiedHdRoutes[63]!.route[0]!.x += 0.2
    expectedChanged.solve()
    await changedSolve
    expect(state(changed)).toEqual(state(expectedChanged))
    expect(changedCoordinator.stats.maximumLookahead).toBe(64)
    expect(changedCoordinator.stats.certifiedRoutes).toBe(0)
    expect(changedCoordinator.stats.awaitStateDeclines).toBe(1)
    expect(changedCoordinator.stats.cancellationSignals).toBe(64)

    const capped = makeOwner(), expectedCapped = makeOwner()
    const cappedHelper = createParallelPathLookaheadEligibility(capped, ownerContract)!
    const cappedCoordinator = new ParallelPathLookaheadCoordinator({ original: capped,
      contextId: pool.createContextId(), workerCount: 4,
      run: createNativeParallelPathLookaheadRun(capped, cappedHelper, pool)!,
      isEligible: cappedHelper, nativeEligibility: cappedHelper, nativeWorkerPool: pool,
      captureScope: cappedHelper.captureScope, captureAwaitState: cappedHelper.captureAwaitState })
    const cappedSolve = cappedCoordinator.solve()
    capped.MAX_ITERATIONS = 2
    expectedCapped.MAX_ITERATIONS = 2
    expectedCapped.solve()
    await expect(cappedSolve).rejects.toThrow("Ordered native path failed")
    expect(state(capped)).toEqual(state(expectedCapped))
    expect(cappedCoordinator.stats.certifiedRoutes).toBe(0)
    expect(cappedCoordinator.stats.cancellationSignals).toBe(64)
    expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
  } finally { pool.dispose() }
})
