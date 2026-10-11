import type { SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "../../types/high-density-types"
import { ObservedMultiSimplifiedPathSolver } from "./ObservedMultiSimplifiedPathSolver"
import type { ParallelPathLookaheadJob, ParallelPathLookaheadResult } from "./parallelPathLookaheadTypes"
import { captureNativeSourceAliasProvenance, assertNativeSourceAliasOutput } from "./nativeSourceAliasProvenance"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"

const nativeIsSafeInteger = Number.isSafeInteger
const nativeIsArray = Array.isArray
const sharedArrayDescriptor = Object.getOwnPropertyDescriptor(globalThis, "SharedArrayBuffer")
const NativeSharedArrayBuffer = sharedArrayDescriptor && Object.hasOwn(sharedArrayDescriptor, "value")
  ? sharedArrayDescriptor.value as typeof SharedArrayBuffer | undefined : undefined
const cancellationBytes = Int32Array.BYTES_PER_ELEMENT
const NativeError = Error

type GeometryIndex = NonNullable<ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]["geometryQuery"]>["index"]
type Workspace = {
  contextId: number
  solver: ObservedMultiSimplifiedPathSolver
  index: GeometryIndex
  committed: Array<HighDensityRoute | undefined>
  indexed: Array<HighDensityRoute | undefined>
}

/** Speculative geometry is never retained as a committed peer in this workspace. */
export class ParallelPathLookaheadExecutor {
  private workspace: Workspace | undefined

  execute(job: ParallelPathLookaheadJob): ParallelPathLookaheadResult {
    assertParallelPathLookaheadJob(job)
    const cancellation = new Int32Array(job.cancellationBuffer)
    if (job.context) {
      if (job.context.params.useTraceWidthAwareClearance || job.context.params.enableVertexShortcuts ||
        job.context.params.preserveLeadingLayerTransitions ||
        job.context.params.unsimplifiedHdRoutes.some((route) => route.jumpers?.length) ||
        job.context.params.otherHdRoutes?.some((route) => route.jumpers?.length)) {
        throw new NativeError("Lookahead context requires the default native path policy")
      }
      const solver = new ObservedMultiSimplifiedPathSolver({ ...job.context.params,
        connMap: restoreWorkerConnectivityMap(job.context) })
      this.workspace = { contextId: job.contextId, solver,
        index: (solver as unknown as { geometryIndex: GeometryIndex }).geometryIndex,
        committed: new Array(solver.unsimplifiedHdRoutes.length), indexed: [...solver.unsimplifiedHdRoutes] }
    }
    const workspace = this.workspace
    if (!workspace || workspace.contextId !== job.contextId) throw new NativeError(`Missing lookahead context ${job.contextId}`)
    const { solver, index, committed, indexed } = workspace
    if (job.index >= committed.length) throw new NativeError("Lookahead route index exceeds its context")
    for (const update of job.updates) committed[update.index] = update.route
    for (let peer = 0; peer < indexed.length; peer++) {
      if (peer < job.committedPrefix && !committed[peer]) throw new NativeError(`Missing lookahead committed route ${peer}`)
      const desired = peer < job.committedPrefix ? committed[peer]! : solver.unsimplifiedHdRoutes[peer]!
      if (indexed[peer] !== desired) {
        index.replaceRoute(peer, desired)
        indexed[peer] = desired
      }
    }
    solver.currentUnsimplifiedHdRouteIndex = job.index
    solver.simplifiedHdRoutes = solver.unsimplifiedHdRoutes.slice(0, job.index).map((route, peer) =>
      peer < job.committedPrefix ? committed[peer]! : route)
    solver.activeSubSolver = null
    solver.iterations = 0
    solver.MAX_ITERATIONS = job.nativePhaseStepLimit
    solver.solved = false
    solver.failed = false
    solver.error = null
    solver.beginObservedRoute()
    const resultState = (): Omit<ParallelPathLookaheadResult, "status"> => ({
      kind: "simplifyPathLookahead", contextId: job.contextId, index: job.index,
      committedPrefix: job.committedPrefix, nativeSteps: solver.iterations,
      nativeQueryCount: solver.footprint.nativeQueryCount,
      obstacleWitnessTests: solver.footprint.obstacleWitnessTests,
    })
    // Payload/context errors above are fatal protocol errors. Only execution of
    // the native algorithm is deferred until its original ordered position.
    try {
      if (Atomics.load(cancellation, 0) !== 0) return { ...resultState(), status: "cancelled" }
      solver.step()
      while (solver.activeSubSolver && !solver.failed) {
        if (Atomics.load(cancellation, 0) !== 0) return { ...resultState(), status: "cancelled" }
        solver.step()
      }
    } catch (error: unknown) {
      indexed[job.index] = undefined
      const nativeError = (solver as unknown as { error: unknown }).error
      if (typeof nativeError !== "string" || nativeError.length === 0) throw new NativeError("Native path exception omitted its error state")
      return { ...resultState(), status: "algorithmError", error: nativeError }
    }
    if (solver.failed) {
      indexed[job.index] = undefined
      return { ...resultState(), status: "algorithmError", error: solver.error! }
    }
    if (solver.solved) throw new NativeError("Lookahead native route unexpectedly solved the complete phase")
    const route = solver.simplifiedHdRoutes[job.index]
    if (!route || solver.simplifiedHdRoutes.length !== job.index + 1) throw new NativeError(`Lookahead native route ${job.index} was omitted`)
    // The native child just replaced its index entry. Remember that identity so
    // the next job explicitly restores this tentative route to original copper.
    indexed[job.index] = route
    return { ...resultState(), status: "prepared", route, sourceAliases: captureNativeSourceAliasProvenance(route, solver.unsimplifiedHdRoutes[job.index]), footprint: { ...solver.footprint,
      queries: solver.footprint.queries } }
  }
}

export function assertParallelPathLookaheadJob(value: unknown): asserts value is ParallelPathLookaheadJob {
  const job = value as Partial<ParallelPathLookaheadJob> | null
  if (!job || job.kind !== "simplifyPathLookahead" || !nativeIsSafeInteger(job.contextId) ||
    !nativeIsSafeInteger(job.index) || job.index! < 0 || !nativeIsSafeInteger(job.committedPrefix) ||
    job.committedPrefix! < 0 || job.committedPrefix! > job.index! || !nativeIsArray(job.updates) ||
    !nativeIsSafeInteger(job.nativePhaseStepLimit) || job.nativePhaseStepLimit! < 0 ||
    !NativeSharedArrayBuffer || !(job.cancellationBuffer instanceof NativeSharedArrayBuffer) ||
    job.cancellationBuffer.byteLength !== cancellationBytes) throw new NativeError("Invalid lookahead path job")
  let previous = -1
  for (const update of job.updates) {
    if (!update || !nativeIsSafeInteger(update.index) || update.index <= previous ||
      update.index >= job.committedPrefix! || !update.route || !nativeIsArray(update.route.route) ||
      !nativeIsArray(update.route.vias)) throw new NativeError("Invalid lookahead committed updates")
    previous = update.index
  }
}

export function assertParallelPathLookaheadResult(value: unknown, job: ParallelPathLookaheadJob): asserts value is ParallelPathLookaheadResult {
  const result = value as Partial<ParallelPathLookaheadResult> | null
  if (!result || result.kind !== job.kind || result.contextId !== job.contextId || result.index !== job.index ||
    result.committedPrefix !== job.committedPrefix || !nativeIsSafeInteger(result.nativeSteps) ||
    result.nativeSteps! < 0 || result.nativeSteps! > job.nativePhaseStepLimit + 1 ||
    !nativeIsSafeInteger(result.nativeQueryCount) || result.nativeQueryCount! < 0 ||
    !nativeIsSafeInteger(result.obstacleWitnessTests) || result.obstacleWitnessTests! < 0) {
    throw new NativeError("Invalid lookahead path result")
  }
  if (result.status === "algorithmError") {
    if (typeof result.error !== "string" || result.error.length === 0 || "route" in result || "footprint" in result || "sourceAliases" in result) {
      throw new NativeError("Invalid lookahead algorithm error")
    }
  } else if (result.status === "prepared") {
    if ("error" in result || result.nativeSteps! < 1 || !result.route || !nativeIsArray(result.route.route) || !nativeIsArray(result.route.vias) || !nativeIsArray(result.sourceAliases) || result.sourceAliases.length > 100_000 ||
      !result.footprint || typeof result.footprint.complete !== "boolean" || !nativeIsArray(result.footprint.queries) ||
      result.footprint.nativeQueryCount !== result.nativeQueryCount || result.footprint.obstacleWitnessTests !== result.obstacleWitnessTests ||
      result.footprint.queries.length > 100_000 || result.footprint.queries.length > result.nativeQueryCount! ||
      (result.footprint.complete && result.footprint.queries.length !== result.nativeQueryCount)) {
      throw new NativeError("Invalid lookahead query footprint")
    }
    for (let index = 0; index < result.sourceAliases.length; index++) {
      const alias = result.sourceAliases[index]!
      if (!alias || !nativeIsArray(alias.outputPath) || !nativeIsArray(alias.sourcePath) ||
        alias.outputPath.length > 1024 || alias.sourcePath.length > 1024) throw new NativeError("Invalid lookahead source alias provenance")
      for (let part = 0; part < alias.outputPath.length; part++) if (typeof alias.outputPath[part] !== "string") throw new NativeError("Invalid lookahead source alias provenance")
      for (let part = 0; part < alias.sourcePath.length; part++) if (typeof alias.sourcePath[part] !== "string") throw new NativeError("Invalid lookahead source alias provenance")
    }
    assertNativeSourceAliasOutput(result.route, result.sourceAliases)
    for (let index = 0; index < result.footprint.queries.length; index++) {
      const query = result.footprint.queries[index]!
      if (!query || typeof query.valid !== "boolean" || typeof query.immutableObstacleFailure !== "boolean" ||
        (query.valid && query.immutableObstacleFailure) || !query.start || !query.end ||
        typeof query.start.x !== "number" || typeof query.start.y !== "number" || typeof query.start.z !== "number" ||
        typeof query.end.x !== "number" || typeof query.end.y !== "number" || typeof query.end.z !== "number") {
        throw new NativeError("Invalid lookahead query observation")
      }
    }
  } else if (result.status !== "cancelled" || "error" in result || "route" in result || "footprint" in result || "sourceAliases" in result) {
    throw new NativeError("Invalid lookahead path status")
  }
}
