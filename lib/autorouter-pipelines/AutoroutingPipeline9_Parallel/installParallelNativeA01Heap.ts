/** Exact heap kernel derived from the pinned MIT source in high-density-a01-fork/LICENSE. */
import { isWorkerNativeGridProxy } from "./workerNativeGridRuntime"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { hasNativeOwnerNumericPolicy, hasOriginalNativeOwnerNames, matchesNativeOwnerKernelContract,
  nativeOwnerDescriptor, nativeOwnerPrototype, nativeOwnerHasOwn, nativeOwnerDefine, nativeOwnerDelete,
  nativeOwnerGet, nativeOwnerApply, nativeOwnerIsArray, type NativeOwnerKernelContract } from "./nativeOwnerKernelContract"
import { hasNativeGridKernelIntrinsics, type NativeGridIntrinsicQuantum } from "./nativeGridKernelIntrinsics"
import { captureNativeGridOwnerStorage, hasNativeGridOwnerStorage, type NativeGridOwnerStorage } from "./nativeGridOwnerStorage"

type NativeHeap = {
  f: number[]; seq: number[]; id: number[]; n: number
  push(f: number, seq: number, id: number): void
  pop(): number
}
type HeapKernelState = {
  heap: NativeHeap; arrays: readonly number[][]; active: boolean; contract: NativeOwnerKernelContract; storage: NativeGridOwnerStorage
}
const nativePrototype = HighDensitySolverA01.prototype
const nativeDescriptors = Object.getOwnPropertyDescriptors(nativePrototype)
// Native A01 creates its private heap during setup. This one-cell startup probe
// creates no candidate search or callback; actual owner setup remains singular.
const probe = new HighDensitySolverA01({ nodeWithPortPoints: {
  capacityMeshNodeId: "parallel_a01_heap_identity", center: { x: 0, y: 0 },
  width: 0.1, height: 0.1, availableZ: [0], portPoints: [],
}, cellSizeMm: 0.1, viaDiameter: 0.3 })
probe.setup()
const heapPrototype: object = nativeOwnerPrototype(nativeOwnerDescriptor(probe, "heap")!.value)
const heapDescriptors = Object.getOwnPropertyDescriptors(heapPrototype)
const ownerStates = new WeakMap<HighDensitySolverA01, HeapKernelState>()
const heapStates = new WeakMap<NativeHeap, HeapKernelState>()
const heapMethodNames = Object.getOwnPropertyNames(heapPrototype)
const heapArrayNames = ["f", "seq", "id"] as const
const getOwnerState = ownerStates.get.bind(ownerStates), setOwnerState = ownerStates.set.bind(ownerStates)
const deleteOwnerState = ownerStates.delete.bind(ownerStates)
const getHeapState = heapStates.get.bind(heapStates), setHeapState = heapStates.set.bind(heapStates)
const deleteHeapState = heapStates.delete.bind(heapStates)

/** Check only the fixed private operations that the fused kernel replaces. */
function hasNativeHeapState(state: HeapKernelState): boolean {
  const heap = state.heap
  if (isWorkerNativeGridProxy(heap) || nativeOwnerPrototype(heap) !== heapPrototype) return false
  for (let index = 0; index < heapMethodNames.length; index++) {
    const name = heapMethodNames[index]!
    const descriptor = nativeOwnerDescriptor(heapPrototype, name)
    const original = heapDescriptors[name]!
    if (!descriptor || descriptor.value !== original.value || descriptor.get !== original.get || descriptor.set !== original.set) return false
    const own = nativeOwnerDescriptor(heap, name)
    const installed = name === "push" ? pushNativeOwnerHeap : name === "pop" ? popNativeOwnerHeap : undefined
    if (own && (installed === undefined || own.value !== installed || own.get || own.set)) return false
  }
  for (let index = 0; index < 3; index++) {
    const descriptor = nativeOwnerDescriptor(heap, heapArrayNames[index]!)
    if (!descriptor || descriptor.value !== state.arrays[index] || descriptor.get || descriptor.set || isWorkerNativeGridProxy(descriptor.value) ||
      nativeOwnerPrototype(descriptor.value) !== Array.prototype) return false
  }
  const size = nativeOwnerDescriptor(heap, "n")
  return size !== undefined && nativeOwnerHasOwn(size, "value") && typeof size.value === "number"
}

function pushNativeOwnerHeap(this: NativeHeap, f: number, seq: number, id: number): void {
  if (!getHeapState(this)?.active) {
    const method = nativeOwnerGet(heapPrototype, "push", this) as NativeHeap["push"]
    nativeOwnerApply(method, this, [f, seq, id])
    return
  }
  let i = this.n++
  while (i > 0) {
    const p = (i - 1) >> 1
    const parentF = this.f[p]!, parentSeq = this.seq[p]!
    if (parentF !== f ? parentF < f : parentSeq < seq) break
    this.f[i] = parentF
    this.seq[i] = parentSeq
    this.id[i] = this.id[p]!
    i = p
  }
  this.f[i] = f
  this.seq[i] = seq
  this.id[i] = id
}

function popNativeOwnerHeap(this: NativeHeap): number {
  if (!getHeapState(this)?.active) {
    const method = nativeOwnerGet(heapPrototype, "pop", this) as NativeHeap["pop"]
    return nativeOwnerApply(method, this, [])
  }
  const out = this.id[0]!
  this.n--
  if (this.n > 0) {
    const f = this.f[this.n]!, seq = this.seq[this.n]!, id = this.id[this.n]!
    let i = 0
    while (true) {
      const l = i * 2 + 1, r = l + 1
      if (l >= this.n) break
      let m = l
      if (r < this.n) {
        const leftF = this.f[l]!, rightF = this.f[r]!
        if (!(leftF !== rightF ? leftF < rightF : this.seq[l]! < this.seq[r]!)) m = r
      }
      const childF = this.f[m]!, childSeq = this.seq[m]!
      if (f !== childF ? f < childF : seq < childSeq) break
      this.f[i] = childF
      this.seq[i] = childSeq
      this.id[i] = this.id[m]!
      i = m
    }
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
  }
  return out
}

export function installParallelNativeA01Heap(owner: HighDensitySolverA01,
  contract: NativeOwnerKernelContract): void {
  deleteOwnerState(owner)
  if (owner.failed || !hasOriginalNativeOwnerNames(contract, nativePrototype, nativeDescriptors) ||
    !matchesNativeOwnerKernelContract(owner, contract, nativePrototype, nativeDescriptors)) return
  const descriptor = nativeOwnerDescriptor(owner, "heap")
  if (!descriptor || !nativeOwnerHasOwn(descriptor, "value")) return
  const heap = descriptor.value as NativeHeap
  const arrays: number[][] = []
  for (let index = 0; index < heapArrayNames.length; index++) {
    const array = nativeOwnerDescriptor(heap, heapArrayNames[index]!)?.value
    if (!nativeOwnerIsArray(array)) return
    arrays[index] = array
  }
  const state: HeapKernelState = { heap, arrays, active: false, contract, storage: captureNativeGridOwnerStorage(owner, "heap") }
  if (!hasNativeHeapState(state) || nativeOwnerHasOwn(heap, "push") || nativeOwnerHasOwn(heap, "pop")) return
  nativeOwnerDefine(heap, { push: { value: pushNativeOwnerHeap, writable: true, configurable: true },
    pop: { value: popNativeOwnerHeap, writable: true, configurable: true } })
  setOwnerState(owner, state)
  setHeapState(heap, state)
}

/** A native step has no external callbacks; late private hooks disable fusion. */
export function prepareParallelNativeA01Heap(owner: HighDensitySolverA01, quantum?: NativeGridIntrinsicQuantum): void {
  const state = getOwnerState(owner)
  if (!state) return
  if (hasNativeGridKernelIntrinsics(quantum) && hasNativeHeapState(state) && hasNativeGridOwnerStorage(owner, state.storage) &&
    hasNativeOwnerNumericPolicy(owner) &&
    matchesNativeOwnerKernelContract(owner, state.contract, nativePrototype, nativeDescriptors)) {
    state.active = true
    return
  }
  state.active = false
  for (let index = 0; index < 2; index++) {
    const name = index === 0 ? "push" : "pop"
    const method = index === 0 ? pushNativeOwnerHeap : popNativeOwnerHeap
    if (nativeOwnerDescriptor(state.heap, name)?.value === method) nativeOwnerDelete(state.heap, name)
  }
  deleteOwnerState(owner)
  deleteHeapState(state.heap)
}

export function finishParallelNativeA01Heap(owner: HighDensitySolverA01): void {
  const state = getOwnerState(owner)
  if (state) state.active = false
  // Outside the verified local step, installed methods dispatch through the
  // current native prototype, including a later getter or instrumentation.
  // No search state, array or heap identity is changed by leaving the batch.
}
