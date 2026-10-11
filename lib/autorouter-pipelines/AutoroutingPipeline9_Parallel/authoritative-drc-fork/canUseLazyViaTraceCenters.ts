import { getReferenceDrcProxyInspector, type ReferenceDrcProxyInspector } from "./initializeReferenceDrcRuntime"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

const getPrototypeOf = Object.getPrototypeOf
const getOwnPropertyNames = Object.getOwnPropertyNames
const getOwnPropertySymbols = Object.getOwnPropertySymbols
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const arrayIsArray = Array.isArray
const numberIsFinite = Number.isFinite
const objectIs = Object.is

type DescriptorSnapshot = {
  target: object
  names: string[]
  symbols: symbol[]
  descriptors: PropertyDescriptor[]
}

const observedNativeObjects: object[] = [
  Object, Object.prototype, Array, Array.prototype, Map, Map.prototype,
  Set, Set.prototype, Number, Number.prototype, String, String.prototype,
  Function.prototype, Math, ConnectivityMap.prototype,
  getPrototypeOf([][Symbol.iterator]()),
  getPrototypeOf(new Map().values()), getPrototypeOf(new Set().values()),
]
const nativeDescriptors: DescriptorSnapshot[] = observedNativeObjects.map((target) => {
  const names = getOwnPropertyNames(target)
  const symbols = getOwnPropertySymbols(target)
  return {
    target, names, symbols,
    descriptors: [...names, ...symbols].map((name) => getOwnPropertyDescriptor(target, name)!),
  }
})
const globalDescriptors = ["Object", "Array", "Map", "Set", "Number", "String", "Math"].map((name) => ({
  name, descriptor: getOwnPropertyDescriptor(globalThis, name)!,
}))

function sameDescriptor(a: PropertyDescriptor | undefined, b: PropertyDescriptor): boolean {
  return a !== undefined && objectIs(a.value, b.value) && a.get === b.get && a.set === b.set &&
    a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable
}

function nativeExecutionIsUnchanged(): boolean {
  for (let index = 0; index < globalDescriptors.length; index++) {
    const { name, descriptor } = globalDescriptors[index]!
    if (!sameDescriptor(getOwnPropertyDescriptor(globalThis, name), descriptor)) return false
  }
  for (let index = 0; index < nativeDescriptors.length; index++) {
    const snapshot = nativeDescriptors[index]!
    const names = getOwnPropertyNames(snapshot.target)
    const symbols = getOwnPropertySymbols(snapshot.target)
    if (names.length !== snapshot.names.length || symbols.length !== snapshot.symbols.length) return false
    for (let i = 0; i < names.length; i++) {
      if (names[i] !== snapshot.names[i] || !sameDescriptor(getOwnPropertyDescriptor(snapshot.target, names[i]!), snapshot.descriptors[i]!)) return false
    }
    for (let i = 0; i < symbols.length; i++) {
      if (symbols[i] !== snapshot.symbols[i] || !sameDescriptor(getOwnPropertyDescriptor(snapshot.target, symbols[i]!), snapshot.descriptors[names.length + i]!)) return false
    }
  }
  return true
}

function hasFiniteViaAndWireGeometry(circuitJson: unknown[]): boolean {
  for (let index = 0; index < circuitJson.length; index++) {
    const element = circuitJson[index]
    if (element === null || typeof element !== "object") return false
    const data = element as Record<string, unknown>
    if (data.type === "pcb_via") {
      if (typeof data.pcb_via_id !== "string" || typeof data.x !== "number" || typeof data.y !== "number" ||
        typeof data.outer_diameter !== "number" || data.outer_diameter < 0) return false
      if (data.layers !== undefined && (!arrayIsArray(data.layers) || data.layers.some((layer) => typeof layer !== "string"))) return false
    }
    if (data.type === "pcb_trace") {
      if (typeof data.pcb_trace_id !== "string" || !arrayIsArray(data.route)) return false
      for (let routeIndex = 0; routeIndex < data.route.length; routeIndex++) {
        const point = data.route[routeIndex]
        if (point === null || typeof point !== "object") return false
        const wire = point as Record<string, unknown>
        if (wire.route_type !== "wire") continue
        if (typeof wire.x !== "number" || typeof wire.y !== "number" || typeof wire.layer !== "string") return false
        if ("width" in wire && (typeof wire.width !== "number" || wire.width < 0)) return false
      }
    }
  }
  return true
}

function isPlainFiniteData(value: unknown, visiting: Set<object>, checked: Set<object>, isProxy: ReferenceDrcProxyInspector): boolean {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return numberIsFinite(value)
  if (typeof value !== "object" || isProxy(value) || visiting.has(value)) return false
  if (checked.has(value)) return true
  const prototype = getPrototypeOf(value)
  if (arrayIsArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false
  if (getOwnPropertySymbols(value).length !== 0) return false
  visiting.add(value)
  const properties = getOwnPropertyNames(value)
  for (let index = 0; index < properties.length; index++) {
    const property = properties[index]!
    const descriptor = getOwnPropertyDescriptor(value, property)!
    if (!("value" in descriptor) || !isPlainFiniteData(descriptor.value, visiting, checked, isProxy)) return false
  }
  visiting.delete(value)
  checked.add(value)
  return true
}

/** Native, synchronous converted data only; observers retain the unmodified checker. */
export function canUseLazyViaTraceCenters(circuitJson: unknown, connMap: ConnectivityMap | undefined, minClearance: number | undefined): boolean {
  const isProxy = getReferenceDrcProxyInspector()
  if (!isProxy || !nativeExecutionIsUnchanged() || isProxy(circuitJson) || !arrayIsArray(circuitJson)) return false
  const visiting = new Set<object>()
  const checked = new Set<object>()
  if (!isPlainFiniteData(circuitJson, visiting, checked, isProxy) || !hasFiniteViaAndWireGeometry(circuitJson)) return false
  if (minClearance !== undefined && !numberIsFinite(minClearance)) return false
  if (connMap !== undefined) {
    if (connMap === null || typeof connMap !== "object" || isProxy(connMap) || getPrototypeOf(connMap) !== ConnectivityMap.prototype || getOwnPropertySymbols(connMap).length !== 0) return false
    const properties = getOwnPropertyNames(connMap)
    for (let index = 0; index < properties.length; index++) {
      const property = properties[index]!
      const descriptor = getOwnPropertyDescriptor(connMap, property)!
      if (!("value" in descriptor) || !isPlainFiniteData(descriptor.value, visiting, checked, isProxy)) return false
    }
  }
  return true
}
