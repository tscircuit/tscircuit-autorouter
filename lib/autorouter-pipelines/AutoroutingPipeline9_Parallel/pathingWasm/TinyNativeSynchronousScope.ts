// Internal capability for the verified solveGraph interval of one synchronous
// native stage.solve() invocation. Unverified completion/optimization stages
// pause it before their constructor or any callback can run.
// No token survives an await or an externally driven step; public inputs and
// altered methods retain the original per-expansion eligibility checks.
import { getReferenceDrcProxyInspector, type ReferenceDrcProxyInspector } from "../authoritative-drc-fork/initializeReferenceDrcRuntime"
const descriptor = Object.getOwnPropertyDescriptor
const prototype = Object.getPrototypeOf
const ownKeys = Reflect.ownKeys
const apply = Reflect.apply
const sameValue = Object.is
const weakGet = WeakMap.prototype.get
const weakSet = WeakMap.prototype.set
const weakDelete = WeakMap.prototype.delete
const weakHas = WeakSet.prototype.has
const weakAdd = WeakSet.prototype.add
const mapForEach = Map.prototype.forEach
const setForEach = Set.prototype.forEach
const isView = ArrayBuffer.isView
const objectPrototype = Object.prototype
const arrayPrototype = Array.prototype
const mapPrototype = Map.prototype
const setPrototype = Set.prototype
const weakMapPrototype = WeakMap.prototype
const weakSetPrototype = WeakSet.prototype
const arrayBufferPrototype = ArrayBuffer.prototype
const typedArrayPrototype = prototype(Uint8Array.prototype)
const typedBuffer = descriptor(typedArrayPrototype, "buffer")!.get!
const typedLength = descriptor(typedArrayPrototype, "length")!.get!
const typedPrototypes = [Int8Array.prototype, Uint8Array.prototype, Uint8ClampedArray.prototype,
  Int16Array.prototype, Uint16Array.prototype, Int32Array.prototype, Uint32Array.prototype,
  Float32Array.prototype, Float64Array.prototype, BigInt64Array.prototype, BigUint64Array.prototype]

type Field = { name: PropertyKey; original: PropertyDescriptor }
type Level = { object: object; fields: readonly Field[]; parent: object | null }
export type TinyNativePrototypeContract = { root: object; levels: readonly Level[] }

function captureLevel(object: object): Level {
  const keys = ownKeys(object), fields: Field[] = []
  for (let index = 0; index < keys.length; index++) {
    const name = keys[index]!
    fields[index] = { name, original: descriptor(object, name)! }
  }
  return { object, fields, parent: prototype(object) }
}

export function captureTinyNativePrototypeContract(root: object): TinyNativePrototypeContract {
  const levels: Level[] = []
  for (let current: object | null = root; current; current = prototype(current))
    levels[levels.length] = captureLevel(current)
  return { root, levels }
}

function sameDescriptor(left: PropertyDescriptor | undefined, right: PropertyDescriptor): boolean {
  return left !== undefined && sameValue(left.value, right.value) && left.get === right.get && left.set === right.set &&
    left.writable === right.writable && left.enumerable === right.enumerable && left.configurable === right.configurable
}

function matchesLevel(level: Level): boolean {
  if (prototype(level.object) !== level.parent || ownKeys(level.object).length !== level.fields.length) return false
  for (let index = 0; index < level.fields.length; index++) {
    const field = level.fields[index]!
    if (!sameDescriptor(descriptor(level.object, field.name), field.original)) return false
  }
  return true
}

function matchesContract(owner: object, contract: TinyNativePrototypeContract): boolean {
  if (prototype(owner) !== contract.root) return false
  for (let index = 0; index < contract.levels.length; index++)
    if (!matchesLevel(contract.levels[index]!)) return false
  return true
}

// Parent routing, future constructors, progress and error propagation can use
// more intrinsics than a single scoring batch. Inspect the full fixed tables
// once per synchronous scope, without evaluating a getter or an iterator.
const builtinLevels: Level[] = []
const builtinBindings: Field[] = []
const seenBuiltinObjects = new WeakSet<object>()
function captureBuiltin(object: object): void {
  for (let current: object | null = object; current && !apply(weakHas, seenBuiltinObjects, [current]); current = prototype(current)) {
    apply(weakAdd, seenBuiltinObjects, [current])
    builtinLevels[builtinLevels.length] = captureLevel(current)
  }
}
const globalNames = ["Math", "Number", "Object", "Array", "Map", "Set", "WeakMap", "WeakSet", "Date", "JSON",
  "Reflect", "String", "Boolean", "BigInt", "Symbol", "Function", "Error", "TypeError", "RangeError",
  "ArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "SharedArrayBuffer", "WebAssembly", "WeakRef", "console", "performance"]
for (let index = 0; index < globalNames.length; index++) {
  const name = globalNames[index]!, original = descriptor(globalThis, name)
  if (!original) continue
  builtinBindings[builtinBindings.length] = { name, original }
  const value = original.value
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    captureBuiltin(value)
    const instancePrototype = descriptor(value, "prototype")?.value
    if (instancePrototype && typeof instancePrototype === "object") captureBuiltin(instancePrototype)
  }
}
captureBuiltin(Math); captureBuiltin(performance); captureBuiltin(console)
captureBuiltin(prototype([][Symbol.iterator]()))
captureBuiltin(prototype(new Map()[Symbol.iterator]()))
captureBuiltin(prototype(new Set()[Symbol.iterator]()))
captureBuiltin(prototype(""[Symbol.iterator]()))

function nativeBuiltins(): boolean {
  for (let index = 0; index < builtinBindings.length; index++) {
    const field = builtinBindings[index]!
    if (!sameDescriptor(descriptor(globalThis, field.name), field.original)) return false
  }
  for (let index = 0; index < builtinLevels.length; index++) if (!matchesLevel(builtinLevels[index]!)) return false
  return true
}

type AllowedFields = WeakMap<object, readonly Field[]>
type RootRecord = {
  contract: TinyNativePrototypeContract
  pipelineContract: TinyNativePrototypeContract
  childContracts: readonly TinyNativePrototypeContract[]
  dataContracts: readonly TinyNativePrototypeContract[]
  kernelContract: TinyNativePrototypeContract
  allowed: AllowedFields
  pipelines: object[]
}
export type TinyNativeSynchronousScope = {
  open: boolean
  active: boolean
  paused: boolean
  finished: boolean
  readonly record: RootRecord
  readonly diagnostics: { childChecks: number; trustedBatches: number }
  readonly children: WeakRef<object>[]
}
const roots = new WeakMap<object, RootRecord>()
const scopes = new WeakMap<object, TinyNativeSynchronousScope>()
const runExclusions = new WeakMap<object, boolean>()
let fallbackRunDepth = 0
const nativeFunctionFields: AllowedFields = new WeakMap()
const scopedChildren = new WeakMap<object, TinyNativeSynchronousScope>()

function allowFields(allowed: AllowedFields, object: object, names: readonly PropertyKey[]): void {
  const fields: Field[] = []
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!, original = descriptor(object, name)
    if (original) fields[fields.length] = { name, original }
  }
  apply(weakSet, allowed, [object, fields])
}

/** The original Packed constructor records its own newly bound native cost. */
export function registerTinyNativeCostBinding(memo: object): void {
  allowFields(nativeFunctionFields, memo, ["nativeCost"])
}

export function registerTinyNativeScopeRoot(root: object, contract: TinyNativePrototypeContract,
  pipelineContract: TinyNativePrototypeContract, childContracts: readonly TinyNativePrototypeContract[],
  dataContracts: readonly TinyNativePrototypeContract[], kernelContract: TinyNativePrototypeContract): void {
  const record: RootRecord = { contract, pipelineContract, childContracts, dataContracts, kernelContract, allowed: new WeakMap(), pipelines: [] }
  // This descriptor is created unconditionally by the native parent constructor.
  allowFields(record.allowed, root, ["stats"])
  apply(weakSet, roots, [root, record])
}

/** Only the native create/configure pipeline factory records these closures. */
export function registerTinyNativeScopePipeline(root: object, pipeline: object): void {
  const record = apply(weakGet, roots, [root]) as RootRecord | undefined
  const isProxy = getReferenceDrcProxyInspector()
  if (!record || !isProxy || isProxy(pipeline)) return
  record.pipelines[record.pipelines.length] = pipeline
  const definition = descriptor(pipeline, "pipelineDef")?.value
  if (!definition || isProxy(definition) || prototype(definition) !== arrayPrototype) return
  for (let index = 0; index < definition.length; index++) {
    const step = descriptor(definition, String(index))?.value
    if (step && !isProxy(step) && prototype(step) === objectPrototype)
      allowFields(record.allowed, step, ["solverClass", "getConstructorParams", "onSolved"])
  }
  const input = descriptor(pipeline, "inputProblem")?.value
  if (input && !isProxy(input) && prototype(input) === objectPrototype) allowFields(record.allowed, input, ["createSectionMask"])
}

function allowedField(record: RootRecord, object: object, name: PropertyKey, current: PropertyDescriptor): boolean {
  const lists = [apply(weakGet, record.allowed, [object]), apply(weakGet, nativeFunctionFields, [object])]
  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const fields = lists[listIndex] as readonly Field[] | undefined
    if (!fields) continue
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index]!
      if (field.name === name) return sameDescriptor(current, field.original)
    }
  }
  return false
}

function matchesKnownClass(object: object, record: RootRecord): boolean {
  if (matchesContract(object, record.contract) || matchesContract(object, record.pipelineContract)) return true
  for (let index = 0; index < record.childContracts.length; index++)
    if (matchesContract(object, record.childContracts[index]!)) return true
  for (let index = 0; index < record.dataContracts.length; index++)
    if (matchesContract(object, record.dataContracts[index]!)) return true
  return false
}

function plainNativeData(root: object, record: RootRecord, isProxy: ReferenceDrcProxyInspector, stageRoot?: object): boolean {
  const seen = new WeakSet<object>(), pending: object[] = [root]
  while (pending.length > 0) {
    const object = pending[pending.length - 1]!
    pending.length--
    if (apply(weakHas, seen, [object])) continue
    apply(weakAdd, seen, [object])
    if (isProxy(object)) return false
    const proto = prototype(object)
    if (isView(object)) {
      let known = false
      for (let index = 0; index < typedPrototypes.length; index++) if (proto === typedPrototypes[index]) known = true
      if (!known || prototype(apply(typedBuffer, object, [])) !== arrayBufferPrototype) return false
      const length = apply(typedLength, object, []) as number
      const keys = ownKeys(object)
      for (let index = 0; index < keys.length; index++) {
        const name = keys[index]!
        if (typeof name === "string") {
          const numeric = +name
          if (numeric === (numeric >>> 0) && name === String(numeric) && numeric < length) continue
        }
        const field = descriptor(object, name)!
        if (field.get || field.set || typeof field.value === "function") return false
      }
      continue
    }
    if (proto === arrayBufferPrototype) continue
    if (proto === mapPrototype) {
      if (ownKeys(object).length !== 0) return false
      let invalid = false
      apply(mapForEach, object, [(value: unknown, key: unknown): void => {
        if (typeof value === "function" || typeof key === "function") invalid = true
        if (value && typeof value === "object") pending[pending.length] = value
        if (key && typeof key === "object") pending[pending.length] = key
      }])
      if (invalid) return false
      continue
    }
    if (proto === setPrototype) {
      if (ownKeys(object).length !== 0) return false
      let invalid = false
      apply(setForEach, object, [(value: unknown): void => {
        if (typeof value === "function") invalid = true
        if (value && typeof value === "object") pending[pending.length] = value
      }])
      if (invalid) return false
      continue
    }
    if (proto === weakMapPrototype || proto === weakSetPrototype) {
      if (ownKeys(object).length !== 0) return false
      continue
    }
    if (proto !== objectPrototype && proto !== null && proto !== arrayPrototype && !matchesKnownClass(object, record)) return false
    const keys = ownKeys(object)
    let isKernelOwner = false
    for (let index = 0; index < record.childContracts.length; index++)
      if (proto === record.childContracts[index]!.root) isKernelOwner = true
    for (let index = 0; index < keys.length; index++) {
      const name = keys[index]!, field = descriptor(object, name)!
      // Indexed synchronous pathing never accesses its worker pool. Kernel
      // mirrors contain private C exports and fixed native closures, not input.
      if (object === stageRoot && name === "workerPool") continue
      if (isKernelOwner && name === "wasmNeighborKernel") {
        if (field.get || field.set) return false
        const kernel = field.value
        if (kernel !== undefined) {
          if (!kernel || typeof kernel !== "object" || isProxy(kernel) || !matchesContract(kernel, record.kernelContract)) return false
          const keys = ownKeys(kernel)
          for (let index = 0; index < keys.length; index++) {
            const entry = descriptor(kernel, keys[index]!)!
            if (entry.get || entry.set || typeof entry.value === "function") return false
          }
        }
        continue
      }
      if (field.get || field.set || typeof field.value === "function") {
        if (!allowedField(record, object, name, field)) return false
        continue
      }
      const value = field.value
      if (value && typeof value === "object") pending[pending.length] = value
    }
  }
  return true
}

export function beginTinyNativeSynchronousScope(root: object): TinyNativeSynchronousScope | undefined {
  const record = apply(weakGet, roots, [root]) as RootRecord | undefined
  const isProxy = getReferenceDrcProxyInspector()
  if (fallbackRunDepth !== 0 || !record || !isProxy || isProxy(root) || apply(weakGet, scopes, [root]) || !nativeBuiltins() ||
    !matchesContract(root, record.contract) || !plainNativeData(root, record, isProxy, root)) return undefined
  // Constructors/setup run before the first search expansion. Their complete
  // module-load method contracts must already be native at entry.
  for (let index = 0; index < record.childContracts.length; index++) {
    const contract = record.childContracts[index]!
    for (let level = 0; level < contract.levels.length; level++) if (!matchesLevel(contract.levels[level]!)) return undefined
  }
  for (let level = 0; level < record.kernelContract.levels.length; level++)
    if (!matchesLevel(record.kernelContract.levels[level]!)) return undefined
  const scope: TinyNativeSynchronousScope = { open: true, active: false, paused: false, finished: false,
    record, diagnostics: { childChecks: 0, trustedBatches: 0 }, children: [] }
  apply(weakSet, scopes, [root, scope])
  return scope
}

export function getTinyNativeSynchronousScope(root: object): TinyNativeSynchronousScope | undefined {
  return apply(weakGet, scopes, [root]) as TinyNativeSynchronousScope | undefined
}

export function getTinyNativeRunExclusion(root: object): boolean {
  return apply(weakGet, runExclusions, [root]) === true
}

export function isTinyNativeFallbackRun(): boolean { return fallbackRunDepth !== 0 }
export function enterTinyNativeFallbackRun(): void { fallbackRunDepth++ }
export function leaveTinyNativeFallbackRun(): void { fallbackRunDepth-- }

export function setTinyNativeRunExclusion(root: object, excluded: boolean): void {
  if (excluded) apply(weakSet, runExclusions, [root, true])
  else apply(weakDelete, runExclusions, [root])
}

export function endTinyNativeSynchronousScope(root: object, scope: TinyNativeSynchronousScope | undefined): void {
  if (!scope) return
  scope.open = false
  scope.active = false
  scope.finished = true
  apply(weakDelete, scopes, [root])
}

/** Check each newly constructed native child before trusting any expansion. */
export function canTrustTinyNativeScopeChild(scope: TinyNativeSynchronousScope, child: object): boolean {
  scope.diagnostics.childChecks++
  const isProxy = getReferenceDrcProxyInspector()
  if (!scope.open || !isProxy || isProxy(child) || !nativeBuiltins()) return false
  let nativeChild = false
  for (let index = 0; index < scope.record.childContracts.length; index++)
    if (matchesContract(child, scope.record.childContracts[index]!)) nativeChild = true
  if (!nativeChild || !plainNativeData(child, scope.record, isProxy)) return false
  registerTinyScopedChild(scope, child)
  scope.children[scope.children.length] = new WeakRef(child)
  scope.active = true
  return true
}

export function registerTinyScopedChild(scope: TinyNativeSynchronousScope, child: object): void {
  apply(weakSet, scopedChildren, [child, scope])
}

export function pauseTinyNativeSynchronousScope(scope: TinyNativeSynchronousScope): void {
  scope.open = false
  scope.active = false
  scope.paused = true
}

/** The original factory pauses before constructing an unverified greedy class. */
export function pauseTinyNativeScopeForChild(child: object): void {
  const scope = apply(weakGet, scopedChildren, [child]) as TinyNativeSynchronousScope | undefined
  if (scope) pauseTinyNativeSynchronousScope(scope)
}
