import type { WorkerNativeGridPortfolioContract } from "./workerNativeGridKernelQuantum"
import { isWorkerNativeGridKernelDispatcher } from "./workerNativeGridKernelQuantum"
import { hasWorkerNativeGridRuntime, isWorkerNativeGridProxy } from "./workerNativeGridRuntime"
import { hasNativeGridKernelIntrinsics } from "./nativeGridKernelIntrinsics"
import { getNativeDescriptorMap, nativeDescriptorMapKeys } from "./nativeDescriptorMetadataGuard"
import { ReplayMultiHeadPolyLineSolver } from "./ReplayMultiHeadPolyLineSolver"
import { ReplayHighDensityA01Solver } from "./ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "./ReplayHighDensityA03Solver"
import { GridHistoryReplayState } from "./GridHistoryReplayState"
import type { GridHistoryDispatcher } from "./parallelGridHistoryTypes"

const descriptorOf = Object.getOwnPropertyDescriptor
const prototypeOf = Object.getPrototypeOf
const hasOwn = Object.hasOwn
const is = Object.is
const arrayPrototype = Array.prototype
const objectPrototype = Object.prototype
type Snapshot = { object: object; parent: object | null; keys: readonly PropertyKey[];
  descriptors: readonly PropertyDescriptor[] }
const snapshots: Snapshot[] = []

function capture(object: object): void {
  let current: object | null = object
  while (current) {
    let seen = false
    for (let index = 0; index < snapshots.length; index++) if (snapshots[index]!.object === current) seen = true
    if (seen) return
    const descriptors = Object.getOwnPropertyDescriptors(current), keys = Reflect.ownKeys(descriptors)
    const values: PropertyDescriptor[] = []
    for (let index = 0; index < keys.length; index++) values[index] = descriptors[keys[index]! as keyof typeof descriptors]!
    const parent = prototypeOf(current)
    snapshots[snapshots.length] = { object: current, parent, keys, descriptors: values }
    current = parent
  }
}

// Original preparation uses instanceof. Capturing the constructor chains as
// well as prototypes retains its Symbol.hasInstance observer boundary.
capture(ReplayMultiHeadPolyLineSolver)
capture(ReplayMultiHeadPolyLineSolver.prototype)
capture(ReplayHighDensityA01Solver)
capture(ReplayHighDensityA01Solver.prototype)
capture(ReplayHighDensityA03Solver)
capture(ReplayHighDensityA03Solver.prototype)
capture(GridHistoryReplayState)
capture(GridHistoryReplayState.prototype)

function equalDescriptor(current: PropertyDescriptor | undefined, original: PropertyDescriptor): boolean {
  return current !== undefined && is(current.value, original.value) && current.get === original.get &&
    current.set === original.set && current.writable === original.writable &&
    current.enumerable === original.enumerable && current.configurable === original.configurable
}

function matchesSnapshots(): boolean {
  for (let index = 0; index < snapshots.length; index++) {
    const snapshot = snapshots[index]!
    if (prototypeOf(snapshot.object) !== snapshot.parent) return false
    const descriptors = getNativeDescriptorMap(snapshot.object)
    if (nativeDescriptorMapKeys(descriptors).length !== snapshot.keys.length) return false
    for (let keyIndex = 0; keyIndex < snapshot.keys.length; keyIndex++) {
      if (!equalDescriptor(descriptors[snapshot.keys[keyIndex]!], snapshot.descriptors[keyIndex]!)) return false
    }
  }
  return true
}

function dataDescriptors(object: unknown): Record<PropertyKey, PropertyDescriptor> | undefined {
  if (!object || typeof object !== "object" || isWorkerNativeGridProxy(object)) return undefined
  const descriptors = getNativeDescriptorMap(object), keys = nativeDescriptorMapKeys(descriptors)
  for (let index = 0; index < keys.length; index++) if (!hasOwn(descriptors[keys[index]!]!, "value")) return undefined
  return descriptors
}

function matchesPortfolio(owner: object, contract: WorkerNativeGridPortfolioContract): boolean {
  if (prototypeOf(owner) !== contract.snapshots[0]!.prototype) return false
  for (let level = 0; level < contract.snapshots.length; level++) {
    const snapshot = contract.snapshots[level]!
    if (prototypeOf(snapshot.prototype) !== snapshot.parent) return false
    const descriptors = getNativeDescriptorMap(snapshot.prototype)
    if (nativeDescriptorMapKeys(descriptors).length !== snapshot.names.length) return false
    for (let index = 0; index < snapshot.names.length; index++) {
      const name = snapshot.names[index]!
      if (!equalDescriptor(descriptors[name], snapshot.descriptors[index]!) ||
        (name !== "constructor" && hasOwn(owner, name))) return false
    }
  }
  return true
}

function hasNoOwnMethodShadow(owner: object): boolean {
  let current: object | null = prototypeOf(owner)
  while (current) {
    for (let index = 0; index < snapshots.length; index++) {
      const snapshot = snapshots[index]!
      if (snapshot.object !== current) continue
      for (let keyIndex = 0; keyIndex < snapshot.keys.length; keyIndex++) {
        const name = snapshot.keys[keyIndex]!
        if (name !== "constructor" && hasOwn(owner, name)) return false
      }
    }
    current = prototypeOf(current)
  }
  return true
}

function replayIsPrepared(owner: object, isGrid: boolean): boolean {
  const descriptors = dataDescriptors(owner)
  if (!descriptors || !hasNoOwnMethodShadow(owner)) return false
  if (isGrid && descriptors.initialPenaltyFn?.value !== undefined) return false
  const state = isGrid ? descriptors.replay?.value : owner
  if (!state || isWorkerNativeGridProxy(state)) return false
  if (isGrid && (prototypeOf(state) !== GridHistoryReplayState.prototype || !hasNoOwnMethodShadow(state))) return false
  const replay = isGrid ? dataDescriptors(state) : descriptors
  // Installed grid replay may invoke a work observer during the next quantum.
  // Its default private callback closure needs a separate scheduling proof.
  if (isGrid && replay?.recordReplayWork?.value !== undefined) return false
  // A fulfilled but uninstalled request is still a real await: installation
  // validates the consumed native prefix and may throw its original error.
  return replay !== undefined && (!replay.historyRequest?.value || !!replay.history?.value)
}

/**
 * Private worker readiness only. This does not install a history, mint an
 * intrinsic lease, initialize candidates, or change public async preparation.
 */
export function canPrepareWorkerPortfolioSynchronously(owner: object,
  contract: WorkerNativeGridPortfolioContract): boolean {
  if (!hasWorkerNativeGridRuntime() || isWorkerNativeGridProxy(owner)) return false
  // The full original intrinsic gate is retained for this isolated scheduling
  // prototype. Any future backend-specific inventory is a separate proof.
  if (!hasNativeGridKernelIntrinsics() || !matchesSnapshots() || !matchesPortfolio(owner, contract)) return false
  const fields = dataDescriptors(owner)
  if (!fields || !isWorkerNativeGridKernelDispatcher(fields.gridDispatcher?.value as GridHistoryDispatcher | undefined) ||
    fields.policy?.value !== "ordered" || !fields.supervisedSolvers?.value) return false
  if (fields.solved?.value || fields.failed?.value) return true
  const supervised = fields.supervisedSolvers.value as object
  if (isWorkerNativeGridProxy(supervised) || prototypeOf(supervised) !== arrayPrototype) return false
  const rows = dataDescriptors(supervised)
  if (!rows || !rows.length || !Number.isSafeInteger(rows.length.value) || rows.length.value < 0) return false
  let best: object | undefined, bestFitness = Infinity
  for (let index = 0; index < rows.length.value; index++) {
    const row = rows[index]?.value
    if (!row || isWorkerNativeGridProxy(row) || prototypeOf(row) !== objectPrototype) return false
    const record = dataDescriptors(row), solver = record?.solver?.value
    if (!record || !solver || isWorkerNativeGridProxy(solver)) return false
    const solverFields = dataDescriptors(solver)
    if (!solverFields || typeof solverFields.solved?.value !== "boolean" || typeof solverFields.failed?.value !== "boolean" ||
      !record.f || typeof record.f.value !== "number") return false
    if (solverFields.solved?.value) { best = solver; break }
    if (solverFields.failed?.value) continue
    if (record.f.value < bestFitness) { best = solver; bestFitness = record.f.value }
  }
  const selectedPrototype = best ? prototypeOf(best) : undefined
  if (fields.adaptiveSearchExpanded?.value && !fields.requestedAtExpansion?.value) return false
  if (selectedPrototype === ReplayMultiHeadPolyLineSolver.prototype) {
    if (!fields.requestedAtSelection?.value) return false
    return replayIsPrepared(best!, false)
  }
  if (selectedPrototype === ReplayHighDensityA01Solver.prototype || selectedPrototype === ReplayHighDensityA03Solver.prototype) {
    const selected = dataDescriptors(best!)!
    if (typeof selected.iterations?.value !== "number" || typeof fields.iterations?.value !== "number" ||
      typeof fields.lastGridRequestIteration?.value !== "number") return false
    if (selected.iterations.value >= 1_000 && fields.iterations.value - fields.lastGridRequestIteration.value >= 16) return false
    return replayIsPrepared(best!, true)
  }
  // Other candidate backends retain the original await. This isolated proof is
  // confined to exact replay classes, not arbitrary children or cached kernels.
  return false
}
