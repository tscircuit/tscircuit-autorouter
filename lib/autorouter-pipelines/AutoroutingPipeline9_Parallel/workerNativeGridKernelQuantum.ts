import { BaseSolver as ExternalBaseSolver } from "@tscircuit/solver-utils"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { GridHistoryDispatcher } from "./parallelGridHistoryTypes"
import { finishParallelNativeA01Heap, prepareParallelNativeA01Heap } from "./installParallelNativeA01Heap"
import { finishParallelNativeA03Geometry, prepareParallelNativeA03Geometry } from "./installParallelNativeA03Geometry"
import { nativeOwnerApply, nativeOwnerDescriptor, nativeOwnerHasOwn, nativeOwnerPrototype, nativeOwnerIs } from "./nativeOwnerKernelContract"
import { beginNativeGridIntrinsicQuantum, finishNativeGridIntrinsicQuantum,
  type NativeGridIntrinsicQuantum } from "./nativeGridKernelIntrinsics"
import { hasWorkerNativeGridRuntime, isWorkerNativeGridProxy } from "./workerNativeGridRuntime"
import { hasNativeDescriptorMetadata } from "./nativeDescriptorMetadataGuard"
import { GridHistoryReplayState } from "./GridHistoryReplayState"

type NativeGridOwner = HighDensitySolverA01 | HighDensitySolverA03
type PrototypeSnapshot = {
  prototype: object; parent: object | null; names: readonly PropertyKey[]; descriptors: readonly PropertyDescriptor[]
}
export type WorkerNativeGridPortfolioContract = { snapshots: readonly PrototypeSnapshot[] }
export type WorkerNativeGridQuantum = { owners: readonly NativeGridOwner[]; intrinsicQuantum: NativeGridIntrinsicQuantum }
const nativeNames = Object.getOwnPropertyNames, nativeSymbols = Object.getOwnPropertySymbols
const workerDispatchers = new WeakSet<GridHistoryDispatcher>()
const addWorkerDispatcher = workerDispatchers.add.bind(workerDispatchers)
const hasWorkerDispatcher = workerDispatchers.has.bind(workerDispatchers)
const ownedOwners = new WeakSet<NativeGridOwner>()
const addOwnedOwner = ownedOwners.add.bind(ownedOwners), hasOwnedOwner = ownedOwners.has.bind(ownedOwners)
const activeOwners = new WeakSet<NativeGridOwner>()
const addActiveOwner = activeOwners.add.bind(activeOwners), deleteActiveOwner = activeOwners.delete.bind(activeOwners)
const hasActiveOwner = activeOwners.has.bind(activeOwners)
const liveQuanta = new WeakSet<WorkerNativeGridQuantum>()
const addLiveQuantum = liveQuanta.add.bind(liveQuanta), deleteLiveQuantum = liveQuanta.delete.bind(liveQuanta)
const hasLiveQuantum = liveQuanta.has.bind(liveQuanta)

/** Called only by the structured-clone Pipeline9 worker request executor. */
export function registerWorkerNativeGridKernelDispatcher(dispatcher: GridHistoryDispatcher): void {
  if (!hasWorkerNativeGridRuntime()) return
  // The capability is membership in a private WeakSet, never a serialized flag
  // or an option accepted by an ordinary Replay/native solver constructor.
  // The worker owns the generated grid and receives callback-free message data.
  addWorkerDispatcher(dispatcher)
}

/** Internal membership test for the actual structured-clone worker dispatcher. */
export function isWorkerNativeGridKernelDispatcher(dispatcher?: GridHistoryDispatcher): boolean {
  // No public option, serialized field or caller-supplied predicate can mint
  // this identity. Testing it reads no dispatcher metadata or accessor.
  // Other owned kernels may maintain their own private candidate memberships.
  // The runtime gate ran before the dispatcher entered this private WeakSet.
  return dispatcher !== undefined && hasWorkerDispatcher(dispatcher)
}

export function registerWorkerNativeGridOwner(owner: NativeGridOwner, dispatcher: GridHistoryDispatcher): void {
  if (!hasWorkerDispatcher(dispatcher)) return
  // Only the private capability minted at the structured-clone worker entry
  // admits owners. Direct portfolio/replay construction is native by default.
  // Registration occurs before the candidate's one original native setup.
  addOwnedOwner(owner)
}

export function isWorkerOwnedNativeGridOwner(owner: NativeGridOwner): boolean {
  // Private WeakSet membership is carried by object identity, never by options
  // or mutable public fields on the original native owner instance.
  // A forged dispatcher/owner object cannot acquire an active native quantum.
  return hasOwnedOwner(owner)
}

/** Capture once, after the complete parallel portfolio prototype is defined. */
export function captureWorkerNativeGridPortfolioContract(prototype: object): WorkerNativeGridPortfolioContract {
  const snapshots: PrototypeSnapshot[] = []
  let current: object | null = prototype
  while (current) {
    const names: PropertyKey[] = nativeNames(current)
    const symbols = nativeSymbols(current)
    for (let index = 0; index < symbols.length; index++) names[names.length] = symbols[index]!
    const descriptors: PropertyDescriptor[] = []
    for (let index = 0; index < names.length; index++) descriptors[index] = nativeOwnerDescriptor(current, names[index]!)!
    const parent = nativeOwnerPrototype(current)
    snapshots[snapshots.length] = { prototype: current, parent, names, descriptors }
    current = parent
  }
  return { snapshots }
}

/** No accessor runs during the method, superclass or intrinsic eligibility check. */
function matchesSnapshots(contract: WorkerNativeGridPortfolioContract, owner?: object): boolean {
  const snapshots = contract.snapshots
  if (owner && nativeOwnerPrototype(owner) !== snapshots[0]!.prototype) return false
  for (let level = 0; level < snapshots.length; level++) {
    const snapshot = snapshots[level]!
    if (nativeOwnerPrototype(snapshot.prototype) !== snapshot.parent ||
      nativeNames(snapshot.prototype).length + nativeSymbols(snapshot.prototype).length !== snapshot.names.length) return false
    for (let index = 0; index < snapshot.names.length; index++) {
      const name = snapshot.names[index]!, original = snapshot.descriptors[index]!
      const current = nativeOwnerDescriptor(snapshot.prototype, name)
      if (!current || !nativeOwnerIs(current.value, original.value) || current.get !== original.get || current.set !== original.set ||
        current.writable !== original.writable || current.enumerable !== original.enumerable ||
        current.configurable !== original.configurable || (owner && name !== "constructor" && nativeOwnerHasOwn(owner, name))) return false
    }
  }
  return true
}

const externalBaseContract = captureWorkerNativeGridPortfolioContract(ExternalBaseSolver.prototype)
const replayStateContract = captureWorkerNativeGridPortfolioContract(GridHistoryReplayState.prototype)

/** A replayed history has no native grid work and may call a work observer. */
function hasCallbackFreeNativeReplay(owner: NativeGridOwner): boolean {
  if (isWorkerNativeGridProxy(owner)) return false
  const descriptor = nativeOwnerDescriptor(owner, "replay")
  if (!descriptor || !nativeOwnerHasOwn(descriptor, "value") || !descriptor.value ||
    isWorkerNativeGridProxy(descriptor.value) || !matchesSnapshots(replayStateContract, descriptor.value)) return false
  const replay = descriptor.value as object, names = nativeNames(replay)
  for (let index = 0; index < names.length; index++) {
    const current = nativeOwnerDescriptor(replay, names[index]!)!
    if (!nativeOwnerHasOwn(current, "value")) return false
    if ((names[index] === "history" || names[index] === "historyRequest") && current.value !== undefined) return false
  }
  return true
}

/** Scope only the already selected grid loop, before fitness/onSolve/output. */
export function beginWorkerNativeGridKernelQuantum(portfolio: object,
  contract: WorkerNativeGridPortfolioContract, owner: NativeGridOwner,
  dispatcher?: GridHistoryDispatcher): WorkerNativeGridQuantum | null {
  if (!dispatcher || !hasWorkerDispatcher(dispatcher) || !hasOwnedOwner(owner) ||
    isWorkerNativeGridProxy(portfolio) || isWorkerNativeGridProxy(owner) || !hasNativeDescriptorMetadata() ||
    !matchesSnapshots(contract, portfolio) ||
    !matchesSnapshots(externalBaseContract) || !hasCallbackFreeNativeReplay(owner)) return null
  const ownNames = nativeNames(portfolio)
  for (let index = 0; index < ownNames.length; index++) {
    const descriptor = nativeOwnerDescriptor(portfolio, ownNames[index]!)!
    if (!nativeOwnerHasOwn(descriptor, "value")) return null
  }
  const intrinsicQuantum = beginNativeGridIntrinsicQuantum()
  if (!intrinsicQuantum) return null
  const owners: NativeGridOwner[] = []
  const quantum: WorkerNativeGridQuantum = { owners, intrinsicQuantum }
  addLiveQuantum(quantum)
  try {
    // Original setup creates the geometry inside this structured-clone worker.
    // No proxy/callback-bearing user object can enter that ownership domain.
    if (owner instanceof HighDensitySolverA01) prepareParallelNativeA01Heap(owner, intrinsicQuantum)
    else prepareParallelNativeA03Geometry(owner, intrinsicQuantum)
    addActiveOwner(owner)
    owners[owners.length] = owner
  } catch (error: unknown) {
    finishWorkerNativeGridKernelQuantum(quantum)
    throw error
  }
  return quantum
}

export function isWorkerNativeGridKernelQuantumActive(owner: NativeGridOwner): boolean {
  // This membership cannot be enabled by a public boolean or spoofed object.
  // It is bounded by the original synchronous supervisor call, not a counter
  // inferred from iterations or an assumed selected candidate ordering.
  return hasActiveOwner(owner)
}

/** Release even when native step, fitness, output or onSolve throws. */
export function finishWorkerNativeGridKernelQuantum(quantum: WorkerNativeGridQuantum | null): void {
  if (!quantum) return
  if (!hasLiveQuantum(quantum)) throw new Error("Native grid quantum was not minted or was already released")
  deleteLiveQuantum(quantum)
  for (let index = 0; index < quantum.owners.length; index++) {
    const owner = quantum.owners[index]!
    deleteActiveOwner(owner)
    if (owner instanceof HighDensitySolverA01) finishParallelNativeA01Heap(owner)
    else finishParallelNativeA03Geometry(owner)
  }
  finishNativeGridIntrinsicQuantum(quantum.intrinsicQuantum)
}
