import { nativeOwnerDescriptor, nativeOwnerIs, nativeOwnerPrototype } from "./nativeOwnerKernelContract"
import { hasWorkerNativeGridRuntime } from "./workerNativeGridRuntime"
import { NativeA01HeapArena } from "./native-a01-heap-arena/NativeA01HeapArena"

type IntrinsicSnapshot = { object: object; parent: object | null;
  names: readonly PropertyKey[]; descriptors: readonly PropertyDescriptor[] }
export type NativeGridIntrinsicQuantum = { readonly ownedIntrinsicQuantum: unique symbol }
const namesOf = Object.getOwnPropertyNames, symbolsOf = Object.getOwnPropertySymbols
const globalNames = ["Math", "Object", "Reflect", "Array", "Map", "Set", "WeakMap", "WeakSet", "Number",
  "String", "Function", "ArrayBuffer", "Float64Array", "Float32Array", "Int32Array", "Uint32Array", "Uint8Array"] as const
const globalDescriptors: PropertyDescriptor[] = []
const snapshots: IntrinsicSnapshot[] = []
const liveScopes = new WeakSet<object>()
const hasScope = liveScopes.has.bind(liveScopes), addScope = liveScopes.add.bind(liveScopes)
const deleteScope = liveScopes.delete.bind(liveScopes)
const wasmDescriptor = nativeOwnerDescriptor(globalThis, "WebAssembly")
const wasmConstructors = ["Module", "Instance", "Memory", "Global"] as const

function captureIntrinsicObject(object: object): void {
  let current: object | null = object
  while (current) {
    let seen = false
    for (let index = 0; index < snapshots.length; index++) if (snapshots[index]!.object === current) seen = true
    if (seen) return
    const names: PropertyKey[] = namesOf(current), symbols = symbolsOf(current)
    for (let index = 0; index < symbols.length; index++) names[names.length] = symbols[index]!
    const descriptors: PropertyDescriptor[] = []
    for (let index = 0; index < names.length; index++) descriptors[index] = nativeOwnerDescriptor(current, names[index]!)!
    const parent = nativeOwnerPrototype(current)
    snapshots[snapshots.length] = { object: current, parent, names, descriptors }
    current = parent
  }
}

for (let index = 0; index < globalNames.length; index++) {
  const descriptor = nativeOwnerDescriptor(globalThis, globalNames[index]!)!
  globalDescriptors[index] = descriptor
  captureIntrinsicObject(descriptor.value)
  const prototype = nativeOwnerDescriptor(descriptor.value, "prototype")
  if (prototype?.value) captureIntrinsicObject(prototype.value)
}
captureIntrinsicObject(nativeOwnerPrototype([][Symbol.iterator]()))
captureIntrinsicObject(nativeOwnerPrototype(new Map().values()))
captureIntrinsicObject(nativeOwnerPrototype(new Set().values()))
captureIntrinsicObject(NativeA01HeapArena)
captureIntrinsicObject(NativeA01HeapArena.prototype)
if (wasmDescriptor && Object.hasOwn(wasmDescriptor, "value") && wasmDescriptor.value) {
  captureIntrinsicObject(wasmDescriptor.value)
  for (let index = 0; index < wasmConstructors.length; index++) {
    const constructor = nativeOwnerDescriptor(wasmDescriptor.value, wasmConstructors[index]!)!
    captureIntrinsicObject(constructor.value)
    const prototype = nativeOwnerDescriptor(constructor.value, "prototype")!
    captureIntrinsicObject(prototype.value)
  }
}

/** Full reachable builtin/global contracts; never evaluate a replaced getter. */
function matchesNativeGridIntrinsics(): boolean {
  const wasm = nativeOwnerDescriptor(globalThis, "WebAssembly")
  if (wasm?.value !== wasmDescriptor?.value || wasm?.get !== wasmDescriptor?.get || wasm?.set !== wasmDescriptor?.set) return false
  for (let index = 0; index < globalNames.length; index++) {
    const current = nativeOwnerDescriptor(globalThis, globalNames[index]!), original = globalDescriptors[index]!
    if (!current || !nativeOwnerIs(current.value, original.value) || current.get !== original.get || current.set !== original.set) return false
  }
  for (let objectIndex = 0; objectIndex < snapshots.length; objectIndex++) {
    const snapshot = snapshots[objectIndex]!
    if (nativeOwnerPrototype(snapshot.object) !== snapshot.parent ||
      namesOf(snapshot.object).length + symbolsOf(snapshot.object).length !== snapshot.names.length) return false
    for (let index = 0; index < snapshot.names.length; index++) {
      const current = nativeOwnerDescriptor(snapshot.object, snapshot.names[index]!), original = snapshot.descriptors[index]!
      if (!current || !nativeOwnerIs(current.value, original.value) || current.get !== original.get || current.set !== original.set ||
        current.writable !== original.writable || current.enumerable !== original.enumerable ||
        current.configurable !== original.configurable) return false
    }
  }
  return true
}

/** Arena use requires the genuine existing worker scope, not a supplied flag. */
export function canUseNativeGridHeapArena(quantum?: NativeGridIntrinsicQuantum): boolean {
  // Unsupported browser/main execution retains native direct dispatch.
  // A forged token cannot skip the complete constructor/builtin validation.
  // This capability is minted only after private worker dispatcher admission.
  return quantum !== undefined && hasScope(quantum) && wasmDescriptor?.value !== undefined
}

export function hasNativeGridKernelIntrinsics(quantum?: NativeGridIntrinsicQuantum): boolean {
  // Only an actual live, worker-minted scope can reuse its prior verification.
  // Direct/internal installer calls otherwise perform the full strict guard.
  // A caller-provided object or boolean cannot bypass descriptor eligibility.
  if (quantum && hasScope(quantum)) return true
  return matchesNativeGridIntrinsics()
}

export function beginNativeGridIntrinsicQuantum(): NativeGridIntrinsicQuantum | null {
  if (!hasWorkerNativeGridRuntime() || !matchesNativeGridIntrinsics()) return null
  const quantum = {} as NativeGridIntrinsicQuantum
  addScope(quantum)
  // The owner dispatcher capability is checked before this worker-only scope
  // is requested; no public constructor flag enables this ownership domain.
  return quantum
}

export function finishNativeGridIntrinsicQuantum(quantum: NativeGridIntrinsicQuantum): void {
  if (!hasScope(quantum)) throw new Error("Intrinsic quantum was not minted or was already released")
  deleteScope(quantum)
  // Nothing is installed globally. Releasing the scope restores strict checks
  // for every direct call and the next asynchronous/quantum entry boundary.
  // The next admission verifies the complete current intrinsic graph again.
}
