import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { getParallelPathBatches } from "./getParallelPathBatches"
import { preserveLeadingPathLayerTransitions } from "./preserveLeadingPathLayerTransitions"
import { getParallelPathDependencies, type ParallelPathDependencies } from "./getParallelPathDependencies"
import type { ParallelPathWaveContext, ParallelPathWaveResult } from "./parallelStageWorkerTypes"
import { takeParallelPathReadyBatch } from "./takeParallelPathReadyBatch"
import { canUseNativePathLookaheadPool } from "./Pipeline9LocalWorkerPool"
import { pathLifecycleResolve, pathLifecycleThen } from "./parallelPathLookaheadPromises"
import { ParallelPathLookaheadCoordinator, hasNativeParallelPathLookaheadCoordinator } from "./ParallelPathLookaheadCoordinator"
import { captureParallelPathPrototypeContract, createParallelPathLookaheadEligibility } from "./createParallelPathLookaheadEligibility"
import type { ParallelPathLookaheadEligibility } from "./createParallelPathLookaheadEligibility"
import type { ParallelPathLookaheadResult } from "./parallelPathLookaheadTypes"

type Params = ConstructorParameters<typeof MultiSimplifiedPathSolver>[0] & {
  workerPool: ParallelStageWorkerPool
  workerCount: number
  preserveLeadingLayerTransitions?: boolean
  useCertifiedLookahead?: boolean
}

let customPathContextId = 0
const nativeStepOwners = new WeakSet<ParallelMultiSimplifiedPathSolver>()
const nativeWeakSetHas = WeakSet.prototype.has
const nativeWeakSetAdd = WeakSet.prototype.add
const nativeWeakSetDelete = WeakSet.prototype.delete
const nativeWeakMapGet = WeakMap.prototype.get
const nativeWeakMapSet = WeakMap.prototype.set
const nativeLookaheadFactories = new WeakMap<ParallelMultiSimplifiedPathSolver, {
  captureScope: ParallelPathLookaheadEligibility["captureScope"]
  captureAwaitState: ParallelPathLookaheadEligibility["captureAwaitState"]
}>()
const nativeApply = Reflect.apply
const NativePromise = Promise
const nativeGetDescriptor = Object.getOwnPropertyDescriptor
const nativeHasOwn = Object.hasOwn
const nativeGetDescriptors = Object.getOwnPropertyDescriptors
const nativeOwnKeys = Reflect.ownKeys
const nativeDefineProperty = Object.defineProperty
const nativeIsExtensible = Object.isExtensible
const nativeUpperCase = String.prototype.toUpperCase
const nativeSlice = String.prototype.slice
const NativeString = String

/** Preserve ordered geometry dependencies without serializing an entire component. */
export class ParallelMultiSimplifiedPathSolver extends MultiSimplifiedPathSolver {
  readonly workerPool: ParallelStageWorkerPool
  readonly batches: number[][]
  private launched = false
  private nativeOnly = false
  readonly preserveLeadingLayerTransitions: boolean
  readonly hasParallelWork: boolean
  readonly dependencies: ParallelPathDependencies
  private readonly workerCount: number
  private readonly contextId: number
  private readonly lookaheadEligibility?: ParallelPathLookaheadEligibility

  constructor({ workerPool, workerCount, preserveLeadingLayerTransitions, useCertifiedLookahead, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.workerCount = workerCount
    this.contextId = workerPool.createContextId?.() ?? --customPathContextId
    this.preserveLeadingLayerTransitions = preserveLeadingLayerTransitions ?? false
    const groups = getParallelPathBatches(params.unsimplifiedHdRoutes, this.useTraceWidthAwareClearance, workerCount)
    this.batches = groups.batches
    this.dependencies = getParallelPathDependencies(params.unsimplifiedHdRoutes, this.useTraceWidthAwareClearance, this.connMap)
    if (useCertifiedLookahead && workerCount > 1 && !this.preserveLeadingLayerTransitions &&
      this.unsimplifiedHdRoutes.length > 1 && canUseNativePathLookaheadPool(workerPool)) {
      this.lookaheadEligibility = createParallelPathLookaheadEligibility(this, nativeParallelPathContract)
      // These are freshly constructed private closures. Save them before the
      // caller can install an observable property on the returned function.
      if (this.lookaheadEligibility) nativeApply(nativeWeakMapSet, nativeLookaheadFactories, [this, {
        captureScope: this.lookaheadEligibility.captureScope,
        captureAwaitState: this.lookaheadEligibility.captureAwaitState,
      }])
      // An input outside the owned-clone domain retains native object aliases;
      // sending it through the older DAG would still lose those clone fields.
      if (!this.lookaheadEligibility) this.nativeOnly = true
    }
    this.hasParallelWork = workerCount > 1 && (this.dependencies.maximumReadyCount > 1 || Boolean(this.lookaheadEligibility))
    this.stats = { interactionComponentCount: groups.interactionComponentCount, parallelBatchCount: this.batches.length }
    this.pendingEffects = []
    if (this.preserveLeadingLayerTransitions) preserveLeadingPathLayerTransitions(this)
  }

  override getSolverName(): string {
    return "ParallelMultiSimplifiedPathSolver"
  }

  override solve(): void {
    if (this.hasParallelWork && !this.nativeOnly) throw new Error("Parallel path simplification requires awaiting pendingEffects or solveAsync()")
    super.solve()
  }

  async solveAsync(): Promise<void> {
    while (!this.solved && !this.failed) {
      this.step()
      await Promise.all(this.pendingEffects!.map((effect) => effect.promise))
    }
    if (this.failed) throw new Error(`Parallel path simplification failed: ${this.error}`)
  }

  override _step(): void {
    if (nativeApply(nativeWeakSetHas, nativeStepOwners, [this])) {
      super._step()
      return
    }
    if (!this.hasParallelWork || this.nativeOnly) {
      super._step()
      return
    }
    if (this.launched) return
    if (this.lookaheadEligibility) {
      if (canUseNativePathLookaheadPool(this.workerPool) && this.lookaheadEligibility() && hasNativeParallelPathLookaheadCoordinator()) {
        this.launchCertifiedLookahead()
        return
      }
      // Upfront capability withdrawal retains the actual owner and hooks.
      // The legacy DAG has independent native children and cannot observe an
      // overridden method on this original index or current native instance.
      this.nativeOnly = true
      super._step()
      return
    }
    this.launched = true
    const context: ParallelPathWaveContext = {
        connectivityNetMap: this.connMap.netMap,
        connectivityIdToNetMap: this.connMap.idToNetMap,
        params: {
          unsimplifiedHdRoutes: this.unsimplifiedHdRoutes,
          otherHdRoutes: this.otherHdRoutes,
          obstacles: this.obstacles,
          colorMap: this.colorMap,
          outline: this.outline,
          minBoardEdgeClearance: this.minBoardEdgeClearance,
          defaultViaDiameter: this.defaultViaDiameter,
          useTraceWidthAwareClearance: this.useTraceWidthAwareClearance,
          enableVertexShortcuts: this.enableVertexShortcuts,
          preserveLeadingLayerTransitions: this.preserveLeadingLayerTransitions,
        },
    }
    const remaining = this.dependencies.predecessors.map((indexes) => indexes.length)
    const ready = remaining.flatMap((count, index) => count === 0 ? [index] : [])
    const routesByIndex = new Map<number, (typeof this.simplifiedHdRoutes)[number]>()
    const stepsByIndex = new Array<number>(this.unsimplifiedHdRoutes.length)
    let activeJobs = 0
    let failed = false
    const promise = new Promise<void>((resolve, reject) => {
      const dispatch = (): void => {
        while (!failed && activeJobs < this.workerCount && ready.length > 0) {
          // Heavy ready routes start first. Completion order never chooses geometry.
          ready.sort((left, right) => this.unsimplifiedHdRoutes[right]!.route.length - this.unsimplifiedHdRoutes[left]!.route.length || left - right)
          const routeIndexes = takeParallelPathReadyBatch(ready, this.unsimplifiedHdRoutes,
            this.workerCount - activeJobs)
          activeJobs++
          const updates = [...routesByIndex].sort(([left], [right]) => left - right).map(([index, route]) => ({ index, route }))
          void this.workerPool.run<ParallelPathWaveResult>({ kind: "simplifyPathWave", contextId: this.contextId,
            context, indexes: routeIndexes, updates }).then((result): void => {
            if (failed) return
            if (result.kind !== "simplifyPathWave" || result.contextId !== this.contextId || result.results.length !== routeIndexes.length) {
              throw new Error(`Invalid path simplification result for routes ${routeIndexes.join(",")}`)
            }
            for (const [position, routeIndex] of routeIndexes.entries()) {
              const output = result.results[position]!
              if (!output || output.index !== routeIndex || !output.route ||
                !Number.isSafeInteger(output.nativeSteps) || output.nativeSteps < 1) {
                throw new Error(`Invalid path simplification result for route ${routeIndex}`)
              }
            }
            activeJobs--
            // Publish the complete successful batch before releasing successors.
            for (const output of result.results) {
              routesByIndex.set(output.index, output.route)
              stepsByIndex[output.index] = output.nativeSteps
              for (const successor of this.dependencies.successors[output.index]!) {
                remaining[successor]!--
                if (remaining[successor] === 0) ready.push(successor)
              }
            }
            if (routesByIndex.size === this.unsimplifiedHdRoutes.length) resolve()
            else dispatch()
          }).catch((error: unknown): void => {
            failed = true
            reject(error)
          })
        }
      }
      dispatch()
    }).then(() => {
      let nativeSteps = 1
      for (const count of stepsByIndex) nativeSteps += count
      if (nativeSteps > this.MAX_ITERATIONS + 1) throw new Error("Parallel path simplification exceeded the native phase iteration budget")
      this.simplifiedHdRoutes = this.unsimplifiedHdRoutes.map((_, index) => {
        const route = routesByIndex.get(index)
        if (!route) throw new Error(`Parallel path simplification omitted route ${index}`)
        return route
      })
      this.currentUnsimplifiedHdRouteIndex = this.unsimplifiedHdRoutes.length
      this.stats.nativePathSteps = nativeSteps
      this.solved = true
      this.pendingEffects = []
    }).catch((error: unknown) => {
      this.failed = true
      this.error = NativeString(error)
      throw error
    })
    this.pendingEffects = [{ name: "parallel-path-simplification", promise }]
  }

  private launchCertifiedLookahead(): void {
    this.launched = true
    const stats = this.stats
    const eligibility = this.lookaheadEligibility!
    const factories = nativeApply(nativeWeakMapGet, nativeLookaheadFactories, [this]) as {
      captureScope: ParallelPathLookaheadEligibility["captureScope"]
      captureAwaitState: ParallelPathLookaheadEligibility["captureAwaitState"]
    } | undefined
    if (!factories) throw new Error("Native lookahead owner is missing its private factories")
    const workerPool = this.workerPool
    const coordinator = new ParallelPathLookaheadCoordinator({ original: this, contextId: this.contextId,
      workerCount: this.workerCount, enclosingNativeStep: true,
      run: (job): Promise<ParallelPathLookaheadResult> => workerPool.run<ParallelPathLookaheadResult>(job),
      isEligible: (): boolean => canUseNativePathLookaheadPool(workerPool) && eligibility() && hasNativeParallelPathLookaheadCoordinator(),
      captureScope: factories.captureScope,
      captureAwaitState: factories.captureAwaitState,
      nativeEligibility: eligibility, nativeWorkerPool: workerPool,
      nativeStep: (): void => {
        nativeApply(nativeWeakSetAdd, nativeStepOwners, [this])
        try { this.step() }
        finally { nativeApply(nativeWeakSetDelete, nativeStepOwners, [this]) }
      },
    })
    const coordinatorStats = coordinator.stats
    const guardStats = eligibility.stats
    const coordinatorStatKeys = nativeOwnKeys(coordinatorStats)
    const guardStatKeys = nativeOwnKeys(guardStats)
    // This is the original _step of the already-entered Base.step: construction
    // happens before that enclosing step checks caps/progress or yields. Retain
    // its actual child and finish it natively after the first worker window.
    super._step()
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new NativePromise<void>((onResolve, onReject): void => { resolve = onResolve; reject = onReject })
    this.pendingEffects = [{ name: "parallel-certified-path-lookahead", promise }]
    const publishDiagnostics = (): void => {
      const values: Array<[string, unknown]> = []
      const append = (key: string, value: unknown): void => {
        nativeDefineProperty(values, values.length, { value: [key, value], writable: true, configurable: true, enumerable: true })
      }
      const iterations = nativeGetDescriptor(this, "iterations")
      if (iterations && nativeHasOwn(iterations, "value")) append("nativePathSteps", iterations.value)
      const collect = (prefix: string, source: object, expectedKeys: PropertyKey[]): boolean => {
        const descriptors = nativeGetDescriptors(source)
        const keys = nativeOwnKeys(descriptors)
        if (keys.length !== expectedKeys.length) return false
        for (let index = 0; index < keys.length; index++) {
          const name = keys[index]!
          if (name !== expectedKeys[index] || typeof name !== "string") return false
          const descriptor = descriptors[name]!
          if (!nativeHasOwn(descriptor, "value") || typeof descriptor.value !== "number" ||
            !descriptor.writable || !descriptor.configurable || !descriptor.enumerable) return false
          const key = prefix + nativeApply(nativeUpperCase, name[0]!, []) + nativeApply(nativeSlice, name, [1])
          append(key, descriptor.value)
        }
        return true
      }
      const diagnostics = values
      const trustedDiagnostics = collect("lookahead", coordinatorStats, coordinatorStatKeys) &&
        collect("lookaheadGuard", guardStats, guardStatKeys)
      // The stats object is native-owned plain data at admission, but callers
      // may freeze it while workers run. Diagnostics never make a successful
      // original continuation fail or invoke newly installed accessors.
      let writable = trustedDiagnostics
      const extensible = nativeIsExtensible(stats)
      for (let index = 0; index < diagnostics.length; index++) {
        const descriptor = nativeGetDescriptor(stats, diagnostics[index]![0])
        // These keys were absent from the original adapter stats. A caller's
        // new field (including writable data) remains theirs on withdrawal.
        if (descriptor || !extensible) { writable = false; break }
      }
      if (writable) for (let index = 0; index < diagnostics.length; index++) {
        const entry = diagnostics[index]!
        nativeDefineProperty(stats, entry[0], { value: entry[1], writable: true, configurable: true, enumerable: true })
      }
      const pending = nativeGetDescriptor(this, "pendingEffects")
      if (pending && nativeHasOwn(pending, "value") && pending.writable) this.pendingEffects = []
    }
    const initialAwaitState = factories.captureAwaitState() ?? ((): boolean => false)
    // Finish the enclosing original Base.step cap/progress boundary before any
    // coordinator continuation, even when an initial custom state declines.
    const continuation = pathLifecycleThen(pathLifecycleResolve(), (): Promise<void> => {
      const native = coordinator.solve(initialAwaitState)
      return pathLifecycleThen(native, (): void => {})
    })
    const settle = (error?: { value: unknown }): void => {
      let failure = error
      try { publishDiagnostics() }
      catch (value: unknown) { if (!failure) failure = { value } }
      if (!failure) { resolve(); return }
      // Settlement must survive a late caller control descriptor as well. The
      // actual rejection preserves the routing/protocol error even if a public
      // status property has become readonly or accessor-backed.
      try {
        const failed = nativeGetDescriptor(this, "failed")
        if (failed && nativeHasOwn(failed, "value") && failed.value === false && failed.writable) {
          this.failed = true
          const errorDescriptor = nativeGetDescriptor(this, "error")
          if (errorDescriptor && nativeHasOwn(errorDescriptor, "value") && errorDescriptor.writable) this.error = NativeString(failure.value)
        }
      } catch { /* A withdrawn public status contract cannot replace the original rejection. */ }
      finally { reject(failure.value) }
    }
    void pathLifecycleThen(continuation, (): void => { settle() }, (error: unknown): void => { settle({ value: error }) })
  }

}

const nativeParallelPathContract = captureParallelPathPrototypeContract(ParallelMultiSimplifiedPathSolver.prototype)
