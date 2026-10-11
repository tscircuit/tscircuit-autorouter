// Each case runs in a fresh process: native engine reflection initializes first.
import { strictEqual, deepStrictEqual } from "node:assert"
import { Pipeline9MemoizedAutoroutingDrcEngine as Engine, readNativeIndexedDrcSpatialHashObservationContract as readSpatial } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair03/Pipeline9MemoizedAutoroutingDrcEngine"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { segmentToSegmentMinDistance as originalDistance } from "@tscircuit/math-utils"

const which = process.argv[2]!, apply = Reflect.apply, getDescriptor = Object.getOwnPropertyDescriptor, define = Object.defineProperty
let observations = 0
let activeConnectionMap: ConnectivityMap | undefined
let srj: any = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -1, maxX: 5, minY: -1, maxY: 5 },
  obstacles: [{ type: "rect", center: { x: 2, y: 2 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["pcb_smtpad_0", "a"] }], connections: [] }
const wire = (id: string, y: number): any => ({ type: "pcb_trace", pcb_trace_id: id, connection_name: id, route: [
  { route_type: "wire", x: 0, y, width: 0.1, layer: "top" }, { route_type: "wire", x: 4, y, width: 0.1, layer: "top" }] })
const traces = [wire("a", 0), wire("b", 0.02), wire("c", 0.04)]
const makeOptions = (): any => {
  const connMap = new ConnectivityMap({ x: ["a", "alias_a"], y: ["b"], z: ["c"] })
  activeConnectionMap = connMap
  return { connMap, ...(which === "engine-equal-source-closure" ? { traceClearance: 1 } : {}) }
}
let expectedAdmission = false
const install = (): void => {
  if (which === "engine-equal-source-closure") {
    const original = getDescriptor(Engine.prototype, "checkTracePair")!, source = apply(Function.prototype.toString, original.value, [])
    const segmentToSegmentMinDistance = (...args: Parameters<typeof originalDistance>): number => {
      observations++
      if (observations === 1) activeConnectionMap!.addConnections([["x", "y"]])
      return originalDistance(...args)
    }
    const DRC_EPSILON = 0.005
    const createTraceErrorMessage = (): string => "same counterfeit callback message"
    const getClosestPointBetweenSegments = (): object => ({ x: 0, y: 0 })
    const replacement = eval(`({${source}}).checkTracePair`)
    strictEqual(apply(Function.prototype.toString, replacement, []), source)
    define(Engine.prototype, "checkTracePair", { ...original, value: replacement })
    srj.obstacles = []
    traces.splice(0, traces.length, ...["a", "b"].map((id, index) => ({ ...wire(id, index * 0.4),
      route: [0, 1, 2, 3, 4].map(x => ({ route_type: "wire", x, y: index * 0.4, width: 0.1, layer: "top" })) })))
  } else if (which === "source-printer-wrapper" || which === "source-printer-getter") {
    const original = getDescriptor(Function.prototype, "toString")!
    if (which === "source-printer-wrapper") define(Function.prototype, "toString", { ...original, value: function toString(...args: any[]) { observations++; return apply(original.value, this, args) } })
    else define(Function.prototype, "toString", { configurable: true, get() { observations++; return original.value } })
  } else if (which === "native-marker-wrapper") {
    const original = getDescriptor(Map.prototype, "get")!
    define(Map.prototype, "get", { ...original, value: function get(key: unknown) {
      const marker = "[native code]"
      observations += marker.length > 0 ? 1 : 0
      return apply(original.value, this, [key])
    } })
  } else if (which === "missing-map-global") {
    Reflect.deleteProperty(globalThis, "Map")
  } else if (which === "metadata-prototype-accessor" || which === "metadata-predicate-accessor") {
    define(Object.prototype, "value", { configurable: true, get() { observations++; return undefined } })
    if (which === "metadata-prototype-accessor") {
      const original = getDescriptor(globalThis, "Map")!, constructor = original.value
      const replacement = (function (...args: any[]) { return Reflect.construct(constructor, args) }).bind(null)
      define(replacement, "prototype", { configurable: true, get() { observations++; return constructor.prototype } })
      define(globalThis, "Map", { ...original, value: replacement })
    } else {
      const original = getDescriptor(Engine.prototype, "areConnected")!
      define(Engine.prototype, "areConnected", { configurable: true, get() { observations++; return original.value } })
    }
  } else if (which.startsWith("global-getter-")) {
    const name = which.slice(14), original = getDescriptor(globalThis, name)!
    define(globalThis, name, { configurable: original.configurable, enumerable: original.enumerable, get() { observations++; return original.value } })
  } else if (which === "array-inherited-index") {
    define(Array.prototype, "0", { configurable: true, get() { observations++; return undefined }, set(value) {
      observations++
      define(this, "0", { configurable: true, enumerable: true, writable: true, value })
    } })
  } else if (which.startsWith("array-")) {
    const name = which.slice(6), key = name === "iterator" ? Symbol.iterator : name
    const original = getDescriptor(Array.prototype, key)!.value
    define(Array.prototype, key, { ...getDescriptor(Array.prototype, key), value: function (...args: any[]) { observations++; return apply(original, this, args) } })
  } else if (which === "slice-proxy") {
    const original = Array.prototype.slice
    define(Array.prototype, "slice", { ...getDescriptor(Array.prototype, "slice"), value: new Proxy(original, { apply(target, receiver, args) { observations++; return apply(target, receiver, args) } }) })
  } else if (which === "slice-bound") {
    const original = Array.prototype.slice
    const bound = (function (this: any, ...args: any[]) { observations++; return apply(original, this, args) }).bind([])
    define(Array.prototype, "slice", { ...getDescriptor(Array.prototype, "slice"), value: bound })
  } else if (which === "map-constructor" || which === "weakset-constructor" || which === "map-proxy-constructor") {
    const name = which === "weakset-constructor" ? "WeakSet" : "Map", original = (globalThis as any)[name]
    const replacement = which === "map-proxy-constructor" ? new Proxy(original, { construct(target, args) { observations++; return Reflect.construct(target, args) } }) : function (...args: any[]) { observations++; return Reflect.construct(original, args) }
    if (which !== "map-proxy-constructor") define(replacement, "prototype", { value: original.prototype })
    define(globalThis, name, { ...getDescriptor(globalThis, name), value: replacement })
  } else if (which === "engine-predicate" || which === "engine-evaluate") {
    const key = which === "engine-predicate" ? "areConnected" : "evaluate", original = getDescriptor(Engine.prototype, key)!.value
    define(Engine.prototype, key, { ...getDescriptor(Engine.prototype, key), value: function (...args: any[]) { observations++; return apply(original, this, args) } })
  } else if (which === "map-predicate") {
    const original = ConnectivityMap.prototype.areIdsConnected
    ConnectivityMap.prototype.areIdsConnected = function (left, right) { observations++; return apply(original, this, [left, right]) }
  } else if (which === "math-hypot") {
    const original = Math.hypot
    Math.hypot = function (...args) { observations++; return apply(original, Math, args) }
  } else if (which === "spatial-forgery" || which === "spatial-copy-only") {
    const returned: any = readSpatial(), query = getDescriptor(returned.object, "query")!
    if (which === "spatial-forgery") define(returned.object, "query", { ...query, value: function (...args: any[]) { observations++; return apply(query.value, this, args) } })
    returned.object = {}
    returned.parent = null
    returned.nativeFunctionSource = function () { observations++; return "function get() { [native code] }" }
    returned.keys.length = 0
    for (const descriptor of returned.descriptors) descriptor.value = undefined
    returned.originalEngineConstructor = function () { observations++ }
    returned.engineDefinition.object = {}
    returned.engineDefinition.keys.length = 0
    for (const descriptor of returned.engineDefinition.descriptors) descriptor.value = undefined
    returned.engineConstructorDefinition.object = {}
    returned.engineConstructorDefinition.keys.length = 0
    for (const descriptor of returned.engineConstructorDefinition.descriptors) descriptor.value = undefined
    expectedAdmission = which === "spatial-copy-only"
  } else if (which === "late-reflection") {
    const original = Reflect.ownKeys
    Reflect.ownKeys = function (value) { observations++; return original(value) }
  } else throw new Error(`Unknown observer case ${which}`)
}
let make: any
const dataCase = which === "retirement" || which === "retained-aliases" || which === "retained-map" || which === "data-getter" || which === "trace-proxy" || which === "root-proxy" || which === "numeric-coercion" || which === "map-owned-exception"
if (dataCase) {
  make = (await import("../../../scripts/parallel-benchmark/prototypes/native-indexed-connectivity/createPrivatelyMemoizedIndexedDrcEvaluator")).createPrivatelyMemoizedIndexedDrcEvaluator
  if (which === "data-getter") define(traces[0].route[0], "x", { configurable: true, enumerable: true, get() { observations++; return 0 } })
  else if (which === "trace-proxy") traces[0].route[0] = new Proxy(traces[0].route[0], { get(target, key, receiver) { observations++; return Reflect.get(target, key, receiver) } })
  else if (which === "root-proxy") srj = new Proxy(srj, { get(target, key, receiver) { observations++; return Reflect.get(target, key, receiver) } })
  else if (which === "numeric-coercion") srj.obstacles[0].width = { valueOf() { observations++; return 0.2 } }
} else if (which === "late-reflection") { make = (await import("../../../scripts/parallel-benchmark/prototypes/native-indexed-connectivity/createPrivatelyMemoizedIndexedDrcEvaluator")).createPrivatelyMemoizedIndexedDrcEvaluator; install() }
else { install(); observations = 0; make = (await import("../../../scripts/parallel-benchmark/prototypes/native-indexed-connectivity/createPrivatelyMemoizedIndexedDrcEvaluator")).createPrivatelyMemoizedIndexedDrcEvaluator }
const importObservations = observations
strictEqual(importObservations, 0, "Admission import must not invoke an installed observer")
const run = (candidate: boolean): { result: any; error: string | undefined; observations: number; admitted?: number } => {
  const options = makeOptions()
  const localSrj = which === "retained-aliases" ? { ...srj, obstacles: [{ ...srj.obstacles[0], center: { x: 2, y: 0 }, connectedTo: ["pcb_smtpad_0", "a"] }] } : srj
  if (which === "map-owned-exception") options.connMap.getNetConnectedToId = function () { observations++; throw new Error("original connectivity query") }
  observations = 0
  let result: any, error: string | undefined, admitted: number | undefined
  try {
    const instance = candidate ? make(localSrj, options) : new Engine(localSrj, options)
    if (which === "retained-aliases") {
      const old = localSrj.obstacles[0].connectedTo, original = Array.prototype.some
      old.some = function (...args: any[]) { observations++; return apply(original, this, args) }
      localSrj.obstacles[0].connectedTo = ["pcb_smtpad_0", "a"]
    } else if (which === "retained-map") {
      const old = options.connMap, original = old.getNetConnectedToId
      old.getNetConnectedToId = function (...args: any[]) { observations++; return apply(original, this, args) }
      options.connMap = new ConnectivityMap({ different: ["a", "b", "c"] })
    }
    if (which === "retirement") {
      const original = getDescriptor(Engine.prototype, "areConnected")!, point = traces[0].route[0]
      let captured: unknown
      define(point, "x", { configurable: true, enumerable: true, get() {
        define(Engine.prototype, "areConnected", { ...original, value: function (...args: any[]) {
          captured = this; observations++; define(Engine.prototype, "areConnected", original); return apply(original.value, this, args)
        } })
        return 0
      } })
      try { instance.evaluate(traces) }
      finally { define(point, "x", { configurable: true, writable: true, enumerable: true, value: 0 }); define(Engine.prototype, "areConnected", original) }
      strictEqual(typeof captured, "object", "Native callback demonstrably captures the private engine")
      // Public data and methods are pristine again; only escaped private cache
      // state changes. Re-admission would give callbacks a memoized predicate.
      const corruptedCache = new WeakMap<object, WeakSet<object>>()
      define(corruptedCache, "get", { configurable: true, value: function () {
        observations++
        return { has(): boolean { observations++; return true } }
      } })
      define(captured!, "clearTracePairs", { ...getDescriptor(captured!, "clearTracePairs"), value: corruptedCache })
      strictEqual(getDescriptor(Engine.prototype, "areConnected")!.value, original.value)
    }
    result = instance.evaluate(traces)
    if (candidate) admitted = instance.getStats().admittedEvaluations
  } catch (value) { error = value instanceof Error ? value.message : String(value) }
  return { result, error, observations, admitted }
}
const native = run(false), candidate = run(true)
deepStrictEqual(candidate.result, native.result)
strictEqual(candidate.error, native.error)
strictEqual(candidate.observations, native.observations)
if (candidate.error === undefined) strictEqual(candidate.admitted, expectedAdmission ? 1 : 0)
console.log(JSON.stringify({ case: which, importObservations, nativeObservations: native.observations, candidateObservations: candidate.observations, admitted: candidate.admitted, error: candidate.error }))
