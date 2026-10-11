import { MultiSimplifiedPathSolver, type SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { PathSimplificationGeometryIndex } from "../../../node_modules/@tscircuit/trace-simplification-solver/lib/data-structures/PathSimplificationGeometryIndex"
import { pathLifecycleAll, pathLifecycleAllSettled, pathLifecycleRace, pathLifecycleThen, pathLifecycleFailure } from "./parallelPathLookaheadPromises"
import { rehydrateNativeSourceAliases } from "./nativeSourceAliasProvenance"
import { assertParallelPathLookaheadResult } from "./ParallelPathLookaheadExecutor"
import { ParallelPathQueryCertifier } from "./ParallelPathQueryCertifier"
import { isNativeParallelPathAwaitStateCheck, isOrdinaryParallelPathRoute, type ParallelPathLookaheadEligibility } from "./createParallelPathLookaheadEligibility"
import { canUseNativePathLookaheadPool } from "./Pipeline9LocalWorkerPool"
import type { ParallelPathLookaheadJob, ParallelPathLookaheadResult } from "./parallelPathLookaheadTypes"
import type { ParallelPathWaveContext, ParallelStageWorkerPool } from "./parallelStageWorkerTypes"

type GeometryIndex = NonNullable<ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]["geometryQuery"]>["index"]
type PendingRoute = { job: ParallelPathLookaheadJob; promise: Promise<ParallelPathLookaheadResult>; ready?: ParallelPathLookaheadResult }
type Params = {
  original: MultiSimplifiedPathSolver
  contextId: number
  workerCount: number
  run: (job: ParallelPathLookaheadJob) => Promise<ParallelPathLookaheadResult>
  /** A private adapter gateway still calls the actual owner's Base.step(). */
  nativeStep?: () => void
  enclosingNativeStep?: boolean
  isEligible: () => boolean
  captureAwaitState?: () => (() => boolean) | undefined
  nativeEligibility?: ParallelPathLookaheadEligibility
  nativeWorkerPool?: ParallelStageWorkerPool
}
const NativeInt32Array = Int32Array
const sharedArrayDescriptor = Object.getOwnPropertyDescriptor(globalThis, "SharedArrayBuffer")
const NativeSharedArrayBuffer = sharedArrayDescriptor && Object.hasOwn(sharedArrayDescriptor, "value")
  ? sharedArrayDescriptor.value as typeof SharedArrayBuffer | undefined : undefined
const exchange = Atomics.exchange
const getOwnDescriptor = Object.getOwnPropertyDescriptor
const hasOwn = Object.hasOwn
const nativeMapForEach = Map.prototype.forEach
const nativeMapClear = Map.prototype.clear
const nativeApply = Reflect.apply
const nativeBind = Function.prototype.bind
const nativeGetDescriptors = Object.getOwnPropertyDescriptors
const nativeOwnKeys = Reflect.ownKeys
const nativeGetPrototype = Object.getPrototypeOf
const nativeObjectIs = Object.is

function ownNumber(source: object, key: string): number | undefined {
  const descriptor = getOwnDescriptor(source, key)
  return descriptor && hasOwn(descriptor, "value") && typeof descriptor.value === "number" ? descriptor.value : undefined
}

/** Four bounded speculative routes; the original native instance owns publication. */
export class ParallelPathLookaheadCoordinator {
  readonly native: MultiSimplifiedPathSolver
  readonly stats = {
    speculativeJobs: 0, speculativeNativeSteps: 0, speculativeNativeQueries: 0,
    speculativeObstacleWitnessTests: 0, certifiedRoutes: 0, orderedReruns: 0,
    orderedRerunNativeSteps: 0, cancelledJobs: 0, cancellationSignals: 0,
    nativeFilterConstructors: 0, nativeFilterSegments: 0, nativeFilterVias: 0,
    lineBucketTests: 0, lineDistanceTests: 0, viaDistanceTests: 0,
    certificateNativeQueryErrors: 0, eligibilityNativeRoutes: 0, maximumLookahead: 0,
    eligibilityChecks: 0, awaitStateChecks: 0, awaitStateDeclines: 0,
    physicalOwnerNativeStepCalls: 0, certifiedNativeParentStepCalls: 0, finalNativeStepCalls: 0,
  }
  private readonly context: ParallelPathWaveContext
  private readonly certifier: ParallelPathQueryCertifier
  private readonly pending = new Map<number, PendingRoute>()
  private readonly allCompletions: Promise<void>[] = []
  private nextIndex = 0
  private stopped = false
  private infrastructureError: unknown
  private hasInfrastructureError = false
  private readonly infrastructureFailure: Promise<never>
  private rejectInfrastructure!: (error: unknown) => void

  constructor(private readonly params: Params) {
    if (!NativeSharedArrayBuffer) throw new Error("Lookahead requires shared atomic cancellation")
    if (!Number.isInteger(params.workerCount) || params.workerCount < 2 || params.workerCount > 4 ||
      params.original.currentUnsimplifiedHdRouteIndex !== 0 || params.original.simplifiedHdRoutes.length !== 0 ||
      params.original.activeSubSolver) throw new Error("Lookahead requires a fresh native phase and two to four workers")
    // Control remains private native code when a late class patch withdraws
    // speculation. Only the original solver hooks are dynamic on continuation.
    this.stopPhysicalJobs = nativeApply(nativeBind, this.stopPhysicalJobs, [this])
    this.continueNative = nativeApply(nativeBind, this.continueNative, [this])
    this.stepNative = nativeApply(nativeBind, this.stepNative, [this])
    this.stats.physicalOwnerNativeStepCalls = params.enclosingNativeStep ? 1 : 0
    this.native = params.original
    const original = this.native
    this.context = { connectivityNetMap: original.connMap.netMap,
      connectivityIdToNetMap: original.connMap.idToNetMap,
      params: { unsimplifiedHdRoutes: original.unsimplifiedHdRoutes, otherHdRoutes: original.otherHdRoutes,
        obstacles: original.obstacles, colorMap: original.colorMap, outline: original.outline,
        minBoardEdgeClearance: original.minBoardEdgeClearance, defaultViaDiameter: original.defaultViaDiameter,
        useTraceWidthAwareClearance: original.useTraceWidthAwareClearance, enableVertexShortcuts: original.enableVertexShortcuts } }
    // The owner's index is mutated by real native publication. A separate index
    // preserves the exact original copper used by the speculative certificate.
    const initialIndex = new PathSimplificationGeometryIndex(original.unsimplifiedHdRoutes,
      original.otherHdRoutes, original.obstacles)
    this.certifier = new ParallelPathQueryCertifier(original, original, initialIndex)
    this.infrastructureFailure = pathLifecycleFailure((reject): void => { this.rejectInfrastructure = reject })
    void pathLifecycleThen(this.infrastructureFailure, (): void => {}, (): void => {})
  }

  async solve(initialAwaitState?: () => boolean): Promise<void> {
    let eligibleSpan: boolean | undefined
    let expectedAwaitState: (() => boolean) | undefined = initialAwaitState
    const isEligible = (): boolean => {
      if (eligibleSpan === undefined) {
        this.stats.eligibilityChecks++
        const nativeCheck = expectedAwaitState && this.params.nativeEligibility && this.params.nativeWorkerPool &&
          isNativeParallelPathAwaitStateCheck(expectedAwaitState, this.native, this.params.nativeEligibility)
        if (nativeCheck) {
          this.stats.awaitStateChecks++
          // Only the exact private owner/helper checker has this contract: it
          // performs full input eligibility itself before disjoint controls.
          eligibleSpan = canUseNativePathLookaheadPool(this.params.nativeWorkerPool!) &&
            hasNativeParallelPathLookaheadCoordinator() && expectedAwaitState!()
          if (!eligibleSpan) this.stats.awaitStateDeclines++
        } else {
          eligibleSpan = this.params.isEligible()
          if (eligibleSpan && expectedAwaitState) {
            this.stats.awaitStateChecks++
            eligibleSpan = expectedAwaitState()
            if (!eligibleSpan) this.stats.awaitStateDeclines++
          }
        }
        expectedAwaitState = undefined
      }
      return eligibleSpan
    }
    try {
      while (true) {
        // Purity is checked before reading any live native control/source field.
        // Once withdrawn, only the actual native continuation reads those fields.
        if (!isEligible()) {
          this.stopPhysicalJobs()
          this.continueNative()
          break
        }
        if (this.native.solved || this.native.failed) break
        const index = this.native.simplifiedHdRoutes.length
        if (index === this.native.unsimplifiedHdRoutes.length) {
          this.stats.finalNativeStepCalls++
          this.stepNative()
          break
        }
        this.dispatchWindow(index)
        const pending = this.pending.get(index)
        if (!pending) throw new Error(`Missing lookahead job for route ${index}`)
        let candidate = pending.ready
        if (!candidate) {
          expectedAwaitState = this.params.captureAwaitState?.()
          if (this.params.captureAwaitState && !expectedAwaitState) {
            eligibleSpan = false
            continue
          }
          await pathLifecycleRace([pathLifecycleAll([...this.pending.values()].map((entry) => entry.promise)), this.infrastructureFailure])
          eligibleSpan = undefined
          if (this.hasInfrastructureError) throw this.infrastructureError
          if (!isEligible()) continue
          candidate = pending.ready
          if (!candidate) throw new Error(`Completed lookahead window omitted route ${index}`)
        }
        if (this.hasInfrastructureError) throw this.infrastructureError
        this.pending.delete(index)
        if (candidate.status === "cancelled") throw new Error(`Ordered path route ${index} was unexpectedly cancelled`)
        const hadExposedChild = Boolean(this.native.activeSubSolver)
        let certified = false
        if (!hadExposedChild && candidate.status === "prepared" && isOrdinaryParallelPathRoute(candidate.route) &&
          this.native.iterations + candidate.nativeSteps <= this.native.MAX_ITERATIONS) {
          const certificate = this.certifier.certify(index, candidate.committedPrefix, candidate.footprint)
          for (const key of Object.keys(certificate.stats) as Array<keyof typeof certificate.stats>) this.stats[key] += certificate.stats[key]
          if (certificate.nativeQueryError) this.stats.certificateNativeQueryErrors++
          certified = certificate.certified
        }
        if (certified && candidate.status === "prepared") {
          this.publishCertifiedRoute(candidate)
          this.stats.certifiedRoutes++
        } else {
          // An exposed first child retains its actual final state and aliases.
          // Rejected certificates/errors execute at their original native place.
          this.stats.orderedReruns++
          this.runNativeRoute()
        }
      }
      const failed = getOwnDescriptor(this.native, "failed")
      if (failed && hasOwn(failed, "value") && failed.value === true) {
        const error = getOwnDescriptor(this.native, "error")
        throw new Error(`Ordered native path failed: ${error && hasOwn(error, "value") ? error.value : "native failure"}`)
      }
    } catch (error: unknown) {
      this.stopPhysicalJobs()
      await pathLifecycleAllSettled(this.allCompletions)
      nativeApply(nativeMapClear, this.pending, [])
      throw this.hasInfrastructureError ? this.infrastructureError : error
    }
    this.stopPhysicalJobs()
    await pathLifecycleAll(this.allCompletions)
    nativeApply(nativeMapClear, this.pending, [])
  }

  private publishCertifiedRoute(candidate: Extract<ParallelPathLookaheadResult, { status: "prepared" }>): void {
    // Native construction and publication run synchronously in the same checked
    // span. This child is never exposed across await or a caller callback.
    this.stats.certifiedNativeParentStepCalls++
    this.stepNative()
    if (this.native.failed) return
    const child = this.native.activeSubSolver
    if (!child || candidate.nativeSteps < 2) throw new Error("Certified path omitted its native child")
    const alreadySolved = child.solved
    const route = rehydrateNativeSourceAliases(candidate.route, child.inputRoute, candidate.sourceAliases)
    child.newRoute = route.route
    child.newVias = route.vias
    child.iterations = alreadySolved ? 0 : candidate.nativeSteps - 1
    child.solved = true
    this.native.iterations += candidate.nativeSteps - 2
    // The original native getter, geometry index replacement, output push and
    // active-child clearing retain their exact ownership and operation order.
    this.stats.certifiedNativeParentStepCalls++
    this.stepNative()
  }

  private dispatchWindow(prefix: number): void {
    const end = Math.min(this.native.unsimplifiedHdRoutes.length, prefix + this.params.workerCount)
    while (!this.stopped && this.nextIndex < end) {
      const index = this.nextIndex++
      const job: ParallelPathLookaheadJob = { kind: "simplifyPathLookahead", contextId: this.params.contextId,
        context: this.context, index, committedPrefix: prefix,
        updates: this.native.simplifiedHdRoutes.map((route, peer) => ({ index: peer, route })),
        cancellationBuffer: new NativeSharedArrayBuffer!(NativeInt32Array.BYTES_PER_ELEMENT),
        nativePhaseStepLimit: Math.max(0, Math.floor(this.native.MAX_ITERATIONS - this.native.iterations)) }
      this.stats.speculativeJobs++
      this.stats.maximumLookahead = Math.max(this.stats.maximumLookahead, index - prefix + 1)
      const prepared = pathLifecycleThen(this.params.run(job), (result): ParallelPathLookaheadResult => {
        assertParallelPathLookaheadResult(result, job)
        this.stats.speculativeNativeSteps += result.nativeSteps
        this.stats.speculativeNativeQueries += result.nativeQueryCount
        this.stats.speculativeObstacleWitnessTests += result.obstacleWitnessTests
        if (result.status === "cancelled") this.stats.cancelledJobs++
        const pending = this.pending.get(index)
        if (pending) pending.ready = result
        return result
      })
      const promise = pathLifecycleThen(prepared, (result): ParallelPathLookaheadResult => result, (error: unknown): never => {
        if (!this.hasInfrastructureError) {
          this.hasInfrastructureError = true
          this.infrastructureError = error
          this.stopPhysicalJobs()
          this.rejectInfrastructure(error)
        }
        throw error
      })
      this.pending.set(index, { job, promise })
      const completion = pathLifecycleThen(promise, (): void => {})
      this.allCompletions.push(completion)
      void pathLifecycleThen(completion, (): void => {}, (): void => {})
      void pathLifecycleThen(promise, (): void => {}, (): void => {})
    }
  }

  private stepNative(): void {
    this.stats.physicalOwnerNativeStepCalls++
    if (this.params.nativeStep) this.params.nativeStep()
    else this.native.step()
  }

  private runNativeRoute(): void {
    const before = this.native.iterations
    try {
      this.stepNative()
      while (this.native.activeSubSolver && !this.native.failed) this.stepNative()
    } finally { this.stats.orderedRerunNativeSteps += this.native.iterations - before }
    if (!this.native.failed && !this.native.solved &&
      this.native.simplifiedHdRoutes.length !== this.native.currentUnsimplifiedHdRouteIndex) throw new Error("Ordered native path omitted its route")
  }

  private continueNative(): void {
    const before = ownNumber(this.native, "iterations")
    const routeBefore = ownNumber(this.native, "currentUnsimplifiedHdRouteIndex")
    // Identical to the native solve loop, with the actual instance and hooks.
    // No route/source diagnostic reads are allowed after purity is withdrawn.
    while (!this.native.solved && !this.native.failed) this.stepNative()
    const after = ownNumber(this.native, "iterations")
    const routeAfter = ownNumber(this.native, "currentUnsimplifiedHdRouteIndex")
    if (routeBefore !== undefined && routeAfter !== undefined) this.stats.eligibilityNativeRoutes += routeAfter - routeBefore
    if (before !== undefined && after !== undefined) this.stats.orderedRerunNativeSteps += after - before
  }

  private stopPhysicalJobs(): void {
    this.stopped = true
    nativeApply(nativeMapForEach, this.pending, [(entry: PendingRoute): void => {
      if (exchange(new NativeInt32Array(entry.job.cancellationBuffer), 0, 1) === 0) this.stats.cancellationSignals++
    }])
  }
}

const nativeCoordinatorPrototype = ParallelPathLookaheadCoordinator.prototype
const nativeCoordinatorDescriptors = nativeGetDescriptors(nativeCoordinatorPrototype)
const nativeCoordinatorKeys = nativeOwnKeys(nativeCoordinatorDescriptors)
const nativeCoordinatorParent = nativeGetPrototype(nativeCoordinatorPrototype)

/** Default private coordinator methods only; arbitrary hooks retain native work. */
export function hasNativeParallelPathLookaheadCoordinator(): boolean {
  if (nativeGetPrototype(nativeCoordinatorPrototype) !== nativeCoordinatorParent) return false
  const descriptors = nativeGetDescriptors(nativeCoordinatorPrototype)
  const keys = nativeOwnKeys(descriptors)
  if (keys.length !== nativeCoordinatorKeys.length) return false
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    if (key !== nativeCoordinatorKeys[index]) return false
    const actual = descriptors[key as keyof typeof descriptors]!
    const expected = nativeCoordinatorDescriptors[key as keyof typeof nativeCoordinatorDescriptors]!
    for (let field = 0; field < coordinatorDescriptorFields.length; field++) {
      const name = coordinatorDescriptorFields[field]!
      const actualOwn = hasOwn(actual, name)
      const expectedOwn = hasOwn(expected, name)
      if (actualOwn !== expectedOwn || (actualOwn && !nativeObjectIs(actual[name], expected[name]))) return false
    }
  }
  return true
}
const coordinatorDescriptorFields: Array<keyof PropertyDescriptor> = ["value", "get", "set", "writable", "enumerable", "configurable"]
