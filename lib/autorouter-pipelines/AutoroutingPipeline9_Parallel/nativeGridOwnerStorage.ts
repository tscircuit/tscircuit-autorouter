import { isWorkerNativeGridProxy } from "./workerNativeGridRuntime"
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { nativeOwnerDescriptor, nativeOwnerHasOwn, nativeOwnerIs, nativeOwnerPrototype } from "./nativeOwnerKernelContract"

type StorageShape = { prototype: object; names: readonly PropertyKey[]; descriptors: readonly PropertyDescriptor[];
  typed: boolean; array: boolean; privateClass: boolean }
type StorageField = { name: string; shape: StorageShape; typedFields: readonly { name: string; prototype: object }[] }
export type NativeGridOwnerStorage = { fields: readonly StorageField[] }
const symbolsOf = Object.getOwnPropertySymbols
const namesOf = Object.getOwnPropertyNames, isView = ArrayBuffer.isView
const typedMethods = ["set", "fill", "subarray", "slice", "constructor", Symbol.iterator] as const
const shapes: StorageShape[] = []
// As with A01, private native storage is created only by setup. One callback-free
// one-cell startup probe captures identities; actual candidates still setup once.
const probe = new HighDensitySolverA03({ nodeWithPortPoints: {
  capacityMeshNodeId: "parallel_a03_storage_identity", center: { x: 0, y: 0 },
  width: 0.1, height: 0.1, availableZ: [0], portPoints: [],
}, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.1, highResolutionCellThickness: 1, viaDiameter: 0.3 })
probe.setup()
const prototypes: object[] = [Array.prototype, Map.prototype, Set.prototype, Float64Array.prototype,
  Int32Array.prototype, Uint32Array.prototype, Uint8Array.prototype, Float32Array.prototype]
for (const name of ["heap", "nodePool", "ripChain"]) {
  prototypes[prototypes.length] = nativeOwnerPrototype(nativeOwnerDescriptor(probe, name)!.value)
}
for (let index = 0; index < prototypes.length; index++) {
  const prototype = prototypes[index]!, names: PropertyKey[] = namesOf(prototype), descriptors: PropertyDescriptor[] = []
  const symbols = symbolsOf(prototype)
  for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex++) names[names.length] = symbols[symbolIndex]!
  for (let nameIndex = 0; nameIndex < names.length; nameIndex++) descriptors[nameIndex] = nativeOwnerDescriptor(prototype, names[nameIndex]!)!
  shapes[index] = { prototype, names, descriptors, typed: index >= 3 && index <= 7,
    array: index === 0, privateClass: index >= 8 }
}

/** Generated containers never receive callbacks from serialized worker data. */
export function captureNativeGridOwnerStorage(owner: object, excludedField?: string): NativeGridOwnerStorage {
  const fields: StorageField[] = [], names = namesOf(owner)
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!
    if (name === excludedField) continue
    const descriptor = nativeOwnerDescriptor(owner, name)!
    if (!nativeOwnerHasOwn(descriptor, "value") || !descriptor.value || typeof descriptor.value !== "object") continue
    if (isWorkerNativeGridProxy(descriptor.value)) continue
    const prototype = nativeOwnerPrototype(descriptor.value)
    for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
      const shape = shapes[shapeIndex]!
      if (prototype === shape.prototype) {
        const typedFields: { name: string; prototype: object }[] = []
        if (shape.privateClass) {
          const innerNames = namesOf(descriptor.value)
          for (let innerIndex = 0; innerIndex < innerNames.length; innerIndex++) {
            const innerName = innerNames[innerIndex]!, inner = nativeOwnerDescriptor(descriptor.value, innerName)!
            if (nativeOwnerHasOwn(inner, "value") && isView(inner.value)) {
              typedFields[typedFields.length] = { name: innerName, prototype: nativeOwnerPrototype(inner.value) }
            }
          }
        }
        fields[fields.length] = { name, shape, typedFields }
      }
    }
  }
  return { fields }
}

/** Own/prototype callbacks disqualify the whole native batch before execution. */
export function hasNativeGridOwnerStorage(owner: object, storage: NativeGridOwnerStorage): boolean {
  for (let fieldIndex = 0; fieldIndex < storage.fields.length; fieldIndex++) {
    const field = storage.fields[fieldIndex]!, descriptor = nativeOwnerDescriptor(owner, field.name)
    if (!descriptor || !nativeOwnerHasOwn(descriptor, "value") || !descriptor.value || typeof descriptor.value !== "object") return false
    const value = descriptor.value as object, shape = field.shape
    if (isWorkerNativeGridProxy(value)) return false
    if (shape.typed && !isView(value)) return false // Also rejects proxies of typed geometry.
    if (nativeOwnerPrototype(value) !== shape.prototype) return false
    for (let index = 0; index < shape.names.length; index++) {
      const name = shape.names[index]!, original = shape.descriptors[index]!
      if ((typeof original.value === "function" || original.get || original.set) && nativeOwnerHasOwn(value, name)) return false
      if (shape.privateClass) {
        const current = nativeOwnerDescriptor(shape.prototype, name)
        if (!current || !nativeOwnerIs(current.value, original.value) || current.get !== original.get || current.set !== original.set) return false
      }
    }
    if (shape.typed) {
      for (let index = 0; index < typedMethods.length; index++) if (nativeOwnerHasOwn(value, typedMethods[index]!)) return false
    }
    if (shape.privateClass) {
      for (let typedIndex = 0; typedIndex < field.typedFields.length; typedIndex++) {
        const typed = field.typedFields[typedIndex]!, current = nativeOwnerDescriptor(value, typed.name)
        if (!current || !nativeOwnerHasOwn(current, "value") || isWorkerNativeGridProxy(current.value) ||
          !isView(current.value) || nativeOwnerPrototype(current.value) !== typed.prototype) return false
      }
      const names = namesOf(value)
      for (let index = 0; index < names.length; index++) {
        const current = nativeOwnerDescriptor(value, names[index]!)!
        if (!nativeOwnerHasOwn(current, "value")) return false
        if (isWorkerNativeGridProxy(current.value)) return false
        if (isView(current.value)) {
          for (let methodIndex = 0; methodIndex < typedMethods.length; methodIndex++) {
            if (nativeOwnerHasOwn(current.value, typedMethods[methodIndex]!)) return false
          }
        }
      }
    }
  }
  return true
}
