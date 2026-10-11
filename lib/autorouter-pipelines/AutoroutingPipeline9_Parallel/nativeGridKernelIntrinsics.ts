import { nativeOwnerDescriptor, nativeOwnerIs, nativeOwnerPrototype } from "./nativeOwnerKernelContract"
import { hasWorkerNativeGridRuntime } from "./workerNativeGridRuntime"
import { hasNativeDescriptorMetadata, getNativeDescriptorMap, nativeDescriptorMapKeys } from "./nativeDescriptorMetadataGuard"
import { NativeA01HeapArena } from "./native-a01-heap-arena/NativeA01HeapArena"

type IntrinsicSnapshot = { object: object; parent: object | null;
  names: readonly PropertyKey[]; descriptors: readonly PropertyDescriptor[] }
export type NativeGridIntrinsicQuantum = { readonly ownedIntrinsicQuantum: unique symbol }
const namesOf = Object.getOwnPropertyNames, symbolsOf = Object.getOwnPropertySymbols
const globalNames = ["Math", "Object", "Reflect", "Array", "Map", "Set", "WeakMap", "WeakSet", "Number",
  "String", "Function", "ArrayBuffer", "Float64Array", "Float32Array", "Int32Array", "Uint32Array", "Uint8Array"] as const
const globalDescriptors: PropertyDescriptor[] = []
const snapshots: IntrinsicSnapshot[] = []
const arenaSnapshots: IntrinsicSnapshot[] = []
const liveScopes = new WeakSet<object>()
const hasScope = liveScopes.has.bind(liveScopes), addScope = liveScopes.add.bind(liveScopes)
const deleteScope = liveScopes.delete.bind(liveScopes)
const arenaScopes = new WeakSet<object>()
const hasArenaScope = arenaScopes.has.bind(arenaScopes), addArenaScope = arenaScopes.add.bind(arenaScopes)
const deleteArenaScope = arenaScopes.delete.bind(arenaScopes)
const wasmDescriptor = nativeOwnerDescriptor(globalThis, "WebAssembly")
const wasmConstructors = ["Module", "Instance", "Memory", "Global"] as const

function captureIntrinsicObject(object: object, arenaOnly = false): void {
  let current: object | null = object
  while (current) {
    let seen = false
    for (let index = 0; index < snapshots.length; index++) if (snapshots[index]!.object === current) seen = true
    for (let index = 0; index < arenaSnapshots.length; index++) if (arenaSnapshots[index]!.object === current) seen = true
    if (seen) return
    const names: PropertyKey[] = namesOf(current), symbols = symbolsOf(current)
    for (let index = 0; index < symbols.length; index++) names[names.length] = symbols[index]!
    const descriptors: PropertyDescriptor[] = []
    for (let index = 0; index < names.length; index++) descriptors[index] = nativeOwnerDescriptor(current, names[index]!)!
    const parent = nativeOwnerPrototype(current)
    const destination = arenaOnly ? arenaSnapshots : snapshots
    destination[destination.length] = { object: current, parent, names, descriptors }
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
captureIntrinsicObject(NativeA01HeapArena, true)
captureIntrinsicObject(NativeA01HeapArena.prototype, true)
if (wasmDescriptor && Object.hasOwn(wasmDescriptor, "value") && wasmDescriptor.value) {
  captureIntrinsicObject(wasmDescriptor.value, true)
  for (let index = 0; index < wasmConstructors.length; index++) {
    const constructor = nativeOwnerDescriptor(wasmDescriptor.value, wasmConstructors[index]!)!
    captureIntrinsicObject(constructor.value, true)
    const prototype = nativeOwnerDescriptor(constructor.value, "prototype")!
    captureIntrinsicObject(prototype.value, true)
  }
}

/** Full reachable builtin/global contracts; never evaluate a replaced getter. */
function matchesNativeGridIntrinsics(experimentalArena: boolean): boolean {
  if (!hasNativeDescriptorMetadata()) return false
  if (experimentalArena) {
    const wasm = nativeOwnerDescriptor(globalThis, "WebAssembly")
    if (wasm?.value !== wasmDescriptor?.value || wasm?.get !== wasmDescriptor?.get || wasm?.set !== wasmDescriptor?.set) return false
  }
  for (let index = 0; index < globalNames.length; index++) {
    const current = nativeOwnerDescriptor(globalThis, globalNames[index]!), original = globalDescriptors[index]!
    if (!current || !nativeOwnerIs(current.value, original.value) || current.get !== original.get || current.set !== original.set) return false
  }
  const snapshotCount = snapshots.length + (experimentalArena ? arenaSnapshots.length : 0)
  for (let objectIndex = 0; objectIndex < snapshotCount; objectIndex++) {
    const snapshot = objectIndex < snapshots.length ? snapshots[objectIndex]! : arenaSnapshots[objectIndex - snapshots.length]!
    if (nativeOwnerPrototype(snapshot.object) !== snapshot.parent) return false
    const descriptors = getNativeDescriptorMap(snapshot.object)
    if (nativeDescriptorMapKeys(descriptors).length !== snapshot.names.length) return false
    for (let index = 0; index < snapshot.names.length; index++) {
      const current = descriptors[snapshot.names[index]!], original = snapshot.descriptors[index]!
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
  // The experiment adds no ownership; the private enabled token also requires
  // the genuine dispatcher admission and complete optional WASM contracts.
  return quantum !== undefined && hasScope(quantum) && hasArenaScope(quantum) && wasmDescriptor?.value !== undefined
}

export function hasNativeGridKernelIntrinsics(quantum?: NativeGridIntrinsicQuantum, experimentalArena = false): boolean {
  // Only an actual live, worker-minted scope can reuse its prior verification.
  // Direct/internal installer calls otherwise perform the full strict guard.
  // A caller-provided object or boolean cannot bypass descriptor eligibility.
  if (quantum && hasScope(quantum) && (!experimentalArena || hasArenaScope(quantum))) return true
  return matchesNativeGridIntrinsics(experimentalArena)
}

export function beginNativeGridIntrinsicQuantum(experimentalArena = false): NativeGridIntrinsicQuantum | null {
  if (!hasWorkerNativeGridRuntime() || !matchesNativeGridIntrinsics(experimentalArena)) return null
  const quantum = {} as NativeGridIntrinsicQuantum
  addScope(quantum)
  if (experimentalArena) addArenaScope(quantum)
  // The owner dispatcher capability is checked before this worker-only scope
  // is requested; no public constructor flag enables this ownership domain.
  return quantum
}

export function finishNativeGridIntrinsicQuantum(quantum: NativeGridIntrinsicQuantum): void {
  if (!hasScope(quantum)) throw new Error("Intrinsic quantum was not minted or was already released")
  deleteArenaScope(quantum)
  deleteScope(quantum)
  // Nothing is installed globally. Releasing the scope restores strict checks
  // for every direct call and the next asynchronous/quantum entry boundary.
  // The next admission verifies the complete current intrinsic graph again.
}
