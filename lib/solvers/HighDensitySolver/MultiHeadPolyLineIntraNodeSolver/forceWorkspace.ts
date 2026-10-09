import type { Candidate2, MHPoint2, PolyLine2 } from "./types2"

export type ForceSegment = {
  p1: MHPoint2
  p2: MHPoint2
  deltaX: number
  deltaY: number
  lengthSquared: number
  layer: number
  p1Idx: number
  p2Idx: number
  lastTargetLine: number
  lastEndpointIndex: number
  lastFx: number
  lastFy: number
  lastForceActive: boolean
}

export type ForceVia = {
  point: MHPoint2
  layers: number[]
  index: number
}

export type ForceGeometry = {
  segments: ForceSegment[]
  vias: ForceVia[]
}

type NetForce = { fx: number; fy: number }

type ForceWorkspace = {
  polyLines: PolyLine2[]
  points: MHPoint2[][]
  netForces: NetForce[][] | null
  geometry: ForceGeometry[] | null
  internalCall: boolean
  inUse: boolean
}

export type ForceWorkspaceScope = {
  previous: ForceWorkspace | undefined
  current: ForceWorkspace | undefined
}

type ForceSolver = {
  applyForcesToPolyLines: (polyLines: PolyLine2[]) => unknown
  viaDiameter: number
  obstacleMargin: number
  traceWidth: number
  BOUNDARY_PADDING: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const iteratorKey: typeof Symbol.iterator = Symbol.iterator
const speciesKey: typeof Symbol.species = Symbol.species
const nativeGlobalObject = globalThis
const nativeLookupGetterMethod = (
  Object.prototype as Object & {
    __lookupGetter__: (key: PropertyKey) => unknown
  }
).__lookupGetter__
const nativeHasOwn = Function.prototype.call.bind(
  Object.prototype.hasOwnProperty,
) as (object: object, key: PropertyKey) => boolean
const nativeLookupGetter = Function.prototype.call.bind(
  nativeLookupGetterMethod,
) as (object: object, key: PropertyKey) => unknown
const nativeDefineProperty = Object.defineProperty
const nativeGetPrototypeOf = Object.getPrototypeOf
const nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const nativeArrayIsArray = Array.isArray
const nativeNumberIsFinite = Number.isFinite
const nativeArray = Array
const nativeArrayPrototype = Array.prototype
const nativeObjectPrototype = Object.prototype
const nativeMath = Math
const nativeArrayIteratorPrototype = nativeGetPrototypeOf([][iteratorKey]())
const arrayMethods = ["map", "slice", "flatMap", "filter", "includes"] as const
const mathMethods = ["min", "max", "sqrt", "exp", "abs"] as const
const nativeArrayMethods = [
  Array.prototype.map,
  Array.prototype.slice,
  Array.prototype.flatMap,
  Array.prototype.filter,
  Array.prototype.includes,
]
const nativeMathMethods = [Math.min, Math.max, Math.sqrt, Math.exp, Math.abs]
const nativeArrayFrom = Array.from
const nativeArrayIterator = Array.prototype[iteratorKey]
const nativeArrayIteratorNext = nativeArrayIteratorPrototype.next
const nativeArraySpeciesGetter = nativeGetOwnPropertyDescriptor(
  Array,
  speciesKey,
)!.get
const nativeFunctionToString = Function.prototype.call.bind(
  Function.prototype.toString,
) as (value: Function) => string
const nativeWeakMapGet = Function.prototype.call.bind(
  WeakMap.prototype.get,
) as (
  map: WeakMap<object, ForceWorkspace>,
  key: object,
) => ForceWorkspace | undefined
const nativeWeakMapSet = Function.prototype.call.bind(
  WeakMap.prototype.set,
) as (
  map: WeakMap<object, ForceWorkspace>,
  key: object,
  value: ForceWorkspace,
) => void
const nativeWeakMapDelete = Function.prototype.call.bind(
  WeakMap.prototype.delete,
) as (map: WeakMap<object, ForceWorkspace>, key: object) => void
const workspaces = new WeakMap<object, ForceWorkspace>()
const forceOwnedObjects = new WeakSet<object>()
const nativeWeakSetHas = Function.prototype.call.bind(
  WeakSet.prototype.has,
) as (set: WeakSet<object>, value: object) => boolean
const nativeWeakSetAdd = Function.prototype.call.bind(
  WeakSet.prototype.add,
) as (set: WeakSet<object>, value: object) => void
const pointKeys = ["x", "y", "z1", "z2"]
const scalarKeys = [
  "viaDiameter",
  "obstacleMargin",
  "traceWidth",
  "BOUNDARY_PADDING",
]
const boundKeys = ["minX", "minY", "maxX", "maxY"]
// Capture primordials at module initialization, before callers customize dispatch.
// No user array iteration/species hooks participate in this certification.
const capturedBuiltins = [
  nativeArrayFrom,
  nativeArrayIterator,
  nativeArrayIteratorNext,
  nativeArraySpeciesGetter,
  nativeDefineProperty,
  nativeGetPrototypeOf,
  nativeGetOwnPropertyDescriptor,
  nativeArrayIsArray,
  nativeNumberIsFinite,
  Object.prototype.hasOwnProperty,
  nativeLookupGetterMethod,
]
let capturedBuiltinsAreNative = true
for (let index = 0; index < capturedBuiltins.length; index++) {
  const value = capturedBuiltins[index]
  if (
    typeof value !== "function" ||
    !nativeFunctionToString(value).includes("[native code]")
  ) {
    capturedBuiltinsAreNative = false
  }
}
for (let index = 0; index < nativeArrayMethods.length; index++) {
  if (
    !nativeFunctionToString(nativeArrayMethods[index]!).includes(
      "[native code]",
    )
  ) {
    capturedBuiltinsAreNative = false
  }
}
for (let index = 0; index < nativeMathMethods.length; index++) {
  if (
    !nativeFunctionToString(nativeMathMethods[index]!).includes("[native code]")
  ) {
    capturedBuiltinsAreNative = false
  }
}

function getOwnData(object: object, key: PropertyKey): unknown {
  if (!nativeHasOwn(object, key)) return undefined
  if (nativeLookupGetter(object, key) !== undefined) return undefined
  // Setter-only accessors return undefined, so they also fail shape validation.
  return (object as Record<PropertyKey, unknown>)[key]
}

function hasNativeDataProperty(
  object: object,
  key: PropertyKey,
  value: unknown,
): boolean {
  const descriptor = nativeGetOwnPropertyDescriptor(object, key)
  return (
    descriptor !== undefined &&
    nativeHasOwn(descriptor, "value") &&
    descriptor.value === value
  )
}

function hasNativeForceBuiltins(): boolean {
  if (!capturedBuiltinsAreNative) return false
  // Array.from's length bags inherit this hook; reuse must never omit a callback.
  if (nativeHasOwn(nativeObjectPrototype, iteratorKey)) return false
  if (!hasNativeDataProperty(nativeGlobalObject, "Array", nativeArray))
    return false
  if (!hasNativeDataProperty(nativeGlobalObject, "Math", nativeMath))
    return false
  if (!hasNativeDataProperty(nativeArray, "from", nativeArrayFrom)) return false
  if (!hasNativeDataProperty(nativeArrayPrototype, "constructor", nativeArray))
    return false
  if (
    !hasNativeDataProperty(
      nativeArrayPrototype,
      iteratorKey,
      nativeArrayIterator,
    )
  )
    return false
  if (
    !hasNativeDataProperty(
      nativeArrayIteratorPrototype,
      "next",
      nativeArrayIteratorNext,
    )
  )
    return false
  const species = nativeGetOwnPropertyDescriptor(nativeArray, speciesKey)
  if (!species || nativeHasOwn(species, "value")) return false
  if (!nativeHasOwn(species, "get") || species.get !== nativeArraySpeciesGetter)
    return false
  for (let index = 0; index < arrayMethods.length; index++) {
    if (
      !hasNativeDataProperty(
        nativeArrayPrototype,
        arrayMethods[index]!,
        nativeArrayMethods[index],
      )
    )
      return false
  }
  for (let index = 0; index < mathMethods.length; index++) {
    if (
      !hasNativeDataProperty(
        nativeMath,
        mathMethods[index]!,
        nativeMathMethods[index],
      )
    )
      return false
  }
  return true
}

function isOrdinaryObject(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null) return false
  if (!nativeWeakSetHas(forceOwnedObjects, value)) return false
  if (nativeArrayIsArray(value)) return false
  const prototype = nativeGetPrototypeOf(value)
  return prototype === nativeObjectPrototype || prototype === null
}

function isDenseNativeArray(value: unknown): value is unknown[] {
  if (typeof value !== "object" || value === null) return false
  if (!nativeWeakSetHas(forceOwnedObjects, value)) return false
  if (!nativeArrayIsArray(value)) return false
  if (nativeGetPrototypeOf(value) !== nativeArrayPrototype) return false
  if (nativeHasOwn(value, "constructor")) return false
  if (nativeHasOwn(value, iteratorKey)) return false
  for (let index = 0; index < arrayMethods.length; index++) {
    if (nativeHasOwn(value, arrayMethods[index]!)) return false
  }
  for (let index = 0; index < value.length; index++) {
    if (getOwnData(value, index) === undefined) return false
  }
  return true
}

function isOrdinaryForcePoint(value: unknown): value is MHPoint2 {
  if (!isOrdinaryObject(value)) return false
  for (let index = 0; index < pointKeys.length; index++) {
    const number = getOwnData(value, pointKeys[index]!)
    if (typeof number !== "number" || !nativeNumberIsFinite(number))
      return false
  }
  return true
}

function hasNativeForceMethod(solver: object, nativeMethod: Function): boolean {
  let current: object | null = solver
  while (current !== null) {
    if (!nativeWeakSetHas(forceOwnedObjects, current)) return false
    const descriptor = nativeGetOwnPropertyDescriptor(
      current,
      "applyForcesToPolyLines",
    )
    if (descriptor) {
      return (
        nativeHasOwn(descriptor, "value") && descriptor.value === nativeMethod
      )
    }
    current = nativeGetPrototypeOf(current)
  }
  return false
}

function canUseForceWorkspace(
  solver: ForceSolver,
  candidate: Candidate2,
  nativeMethod: Function,
): boolean {
  if (!nativeWeakSetHas(forceOwnedObjects, solver)) return false
  if (!hasNativeForceBuiltins() || !hasNativeForceMethod(solver, nativeMethod))
    return false
  if (!isOrdinaryObject(candidate)) return false
  const lines = getOwnData(candidate, "polyLines")
  if (!isDenseNativeArray(lines)) return false
  for (let index = 0; index < scalarKeys.length; index++) {
    const number = getOwnData(solver, scalarKeys[index]!)
    if (typeof number !== "number" || !nativeNumberIsFinite(number))
      return false
  }
  const bounds = getOwnData(solver, "bounds")
  if (!isOrdinaryObject(bounds)) return false
  for (let index = 0; index < boundKeys.length; index++) {
    const number = getOwnData(bounds, boundKeys[index]!)
    if (typeof number !== "number" || !nativeNumberIsFinite(number))
      return false
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (!isOrdinaryObject(line)) return false
    if (!isOrdinaryForcePoint(getOwnData(line, "start"))) return false
    const points = getOwnData(line, "mPoints")
    if (!isDenseNativeArray(points)) return false
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      if (!isOrdinaryForcePoint(points[pointIndex])) return false
    }
    if (!isOrdinaryForcePoint(getOwnData(line, "end"))) return false
  }
  return true
}

export function beginForceWorkspaceStep(
  solver: ForceSolver,
  candidate: Candidate2,
  nativeMethod: Function,
): ForceWorkspaceScope {
  const previous = nativeWeakMapGet(workspaces, solver)
  const current: ForceWorkspace | undefined = canUseForceWorkspace(
    solver,
    candidate,
    nativeMethod,
  )
    ? {
        polyLines: candidate.polyLines,
        points: [],
        netForces: null,
        geometry: null,
        internalCall: false,
        inUse: false,
      }
    : undefined
  if (current) nativeWeakMapSet(workspaces, solver, current)
  else nativeWeakMapDelete(workspaces, solver)
  return { previous, current }
}

export function endForceWorkspaceStep(
  solver: ForceSolver,
  scope: ForceWorkspaceScope,
): void {
  if (scope.previous) nativeWeakMapSet(workspaces, solver, scope.previous)
  else nativeWeakMapDelete(workspaces, solver)
  if (scope.current) {
    scope.current.internalCall = false
    scope.current.inUse = false
  }
}

export function prepareForceWorkspaceCall(scope: ForceWorkspaceScope): void {
  if (!scope.current) return
  // Only the next native dispatch inside this step can claim the private arrays.
  scope.current.internalCall = true
  if (scope.current.inUse) {
    throw new Error("Force workspace is already in use")
  }
}

export function getForceWorkspaceForCall(
  solver: ForceSolver,
  lines: PolyLine2[],
): ForceWorkspace | undefined {
  const workspace = nativeWeakMapGet(workspaces, solver)
  if (!workspace || !workspace.internalCall || workspace.inUse) return undefined
  workspace.internalCall = false
  if (workspace.polyLines !== lines) return undefined
  workspace.inUse = true
  return workspace
}

export function refreshForceWorkspace(workspace: ForceWorkspace): void {
  const netForces = workspace.netForces!
  const geometry = workspace.geometry!
  for (let lineIndex = 0; lineIndex < netForces.length; lineIndex++) {
    for (
      let pointIndex = 0;
      pointIndex < netForces[lineIndex]!.length;
      pointIndex++
    ) {
      const force = netForces[lineIndex]![pointIndex]!
      force.fx = 0
      force.fy = 0
    }
  }
  for (let lineIndex = 0; lineIndex < geometry.length; lineIndex++) {
    const points = workspace.points[lineIndex]!
    const segments = geometry[lineIndex]!.segments
    for (let index = 0; index < segments.length; index++) {
      const point = points[index]!
      const nextPoint = points[index + 1]!
      const deltaX = nextPoint.x - point.x
      const deltaY = nextPoint.y - point.y
      const segment = segments[index]!
      segment.p1 = point
      segment.p2 = nextPoint
      segment.deltaX = deltaX
      segment.deltaY = deltaY
      segment.lengthSquared = deltaX * deltaX + deltaY * deltaY
      segment.layer = point.z2
      segment.p1Idx = index
      segment.p2Idx = index + 1
      segment.lastTargetLine = -1
      segment.lastEndpointIndex = -1
      segment.lastFx = 0
      segment.lastFy = 0
      segment.lastForceActive = false
    }
    const vias = geometry[lineIndex]!.vias
    let viaIndex = 0
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!
      if (point.z1 === point.z2) continue
      const via = vias[viaIndex++]!
      via.point = point
      via.layers[0] = point.z1
      via.layers[1] = point.z2
      via.index = index
    }
  }
}

export function storeForceWorkspacePoints(
  workspace: ForceWorkspace,
  points: MHPoint2[],
): void {
  // Defining the own slot avoids inherited numeric setters on array prototypes.
  nativeDefineProperty(workspace.points, workspace.points.length, {
    __proto__: null,
    value: points,
    writable: true,
    enumerable: true,
    configurable: true,
  } as PropertyDescriptor)
}

export function markForceOwned<T extends object>(value: T): T {
  // This marker belongs only at actual VM literal/constructor creation sites.
  // Never grant provenance by traversing arbitrary input or factory return graphs.
  nativeWeakSetAdd(forceOwnedObjects, value)
  return value
}
