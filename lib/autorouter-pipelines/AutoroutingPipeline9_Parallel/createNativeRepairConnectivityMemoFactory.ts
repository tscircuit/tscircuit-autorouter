import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "../../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { isObstacleConnectedToRoute } from "../../solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { getReferenceDrcProxyInspector } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"

type ConstructorParams = ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0]
type ElectricalPredicate = typeof isObstacleConnectedToRoute
type Contract = { object: object; parent: object | null; keys: readonly PropertyKey[]; descriptors: readonly PropertyDescriptor[] }

const getDescriptor = Object.getOwnPropertyDescriptor
const getPrototype = Object.getPrototypeOf
const ownKeys = Reflect.ownKeys
const functionSource = Function.prototype.toString
const arrayIsArray = Array.isArray
const objectIs = Object.is
const hasOwn = Object.prototype.hasOwnProperty
const nativeGlobals = ["Object", "Array", "Math", "Number", "String", "Symbol", "Map", "Set", "WeakMap", "WeakSet", "Reflect", "Function"]
const globalDescriptors = nativeGlobals.map((name) => getDescriptor(globalThis, name)!)

function captureContract(object: object): Contract {
  const keys = ownKeys(object)
  const descriptors: PropertyDescriptor[] = []
  for (let index = 0; index < keys.length; index++) descriptors[index] = getDescriptor(object, keys[index]!)!
  return { object, parent: getPrototype(object), keys, descriptors }
}

const nativeContracts = [Object, Object.prototype, Array, Array.prototype, Math, Number, Number.prototype,
  String, String.prototype, Symbol, Symbol.prototype, Map, Map.prototype, Set, Set.prototype,
  WeakMap, WeakMap.prototype, WeakSet, WeakSet.prototype, Reflect, Function, Function.prototype,
  ConnectivityMap.prototype, Pipeline4HighDensityRepairSolver.prototype,
  getPrototype(Pipeline4HighDensityRepairSolver.prototype),
  getPrototype([][Symbol.iterator]()), getPrototype(getPrototype([][Symbol.iterator]())),
  getPrototype(new Map()[Symbol.iterator]()), getPrototype(new Set()[Symbol.iterator]()),
].map((object) => captureContract(object!))
const nativeFunctionChecks = [getDescriptor, getPrototype, ownKeys, functionSource, arrayIsArray, objectIs, hasOwn,
  Function.prototype.call, Function.prototype.apply, Array.prototype.some, Array.prototype.every,
  Array.prototype.map, Array.prototype.findIndex, Array.prototype.push, Array.prototype.pop,
  Map.prototype.get, Map.prototype.set, Map.prototype.has, WeakMap.prototype.get, WeakMap.prototype.set,
  WeakSet.prototype.add, WeakSet.prototype.has, Math.abs, Math.min, Math.max, Math.floor, Math.sqrt]
  .map((value) => functionSource.call(value).includes("[native code]"))

function matchesContract(contract: Contract): boolean {
  if (getPrototype(contract.object) !== contract.parent) return false
  const keys = ownKeys(contract.object)
  if (keys.length !== contract.keys.length) return false
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] !== contract.keys[index]) return false
    const original = contract.descriptors[index]!, current = getDescriptor(contract.object, keys[index]!)
    if (!current || !objectIs(current.value, original.value) || current.get !== original.get || current.set !== original.set ||
      current.writable !== original.writable || current.enumerable !== original.enumerable || current.configurable !== original.configurable) return false
  }
  return true
}

function hasNativeObservationContract(ownerContract: Contract): boolean {
  for (let index = 0; index < nativeFunctionChecks.length; index++) if (!nativeFunctionChecks[index]) return false
  for (let index = 0; index < nativeGlobals.length; index++) {
    const current = getDescriptor(globalThis, nativeGlobals[index]!), original = globalDescriptors[index]!
    if (!current || current.value !== original.value || current.get !== original.get || current.set !== original.set) return false
  }
  for (let index = 0; index < nativeContracts.length; index++) if (!matchesContract(nativeContracts[index]!)) return false
  return matchesContract(ownerContract)
}

/** One callback-free synchronous constructor span, including all aliased input data. */
function hasPlainConstructorData(params: ConstructorParams, connMap: ConnectivityMap): boolean {
  const isProxy = getReferenceDrcProxyInspector()
  if (!isProxy) return false
  const seen = new WeakSet<object>()
  const pending: unknown[] = [params]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || value === undefined || typeof value === "boolean" || typeof value === "string" || typeof value === "number") continue
    if (typeof value !== "object" || isProxy(value)) return false
    if (seen.has(value)) continue
    seen.add(value)
    const prototype = getPrototype(value)
    if (value === connMap) {
      if (prototype !== ConnectivityMap.prototype) return false
    } else if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false
    const keys = ownKeys(value)
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!, descriptor = getDescriptor(value, key)
      if (!descriptor || !hasOwn.call(descriptor, "value")) return false
      if (value === connMap && key !== "netMap" && key !== "idToNetMap") return false
      pending.push(descriptor.value)
    }
  }
  return true
}

/** The returned memo belongs only to one original constructor classification loop. */
export function createNativeRepairConnectivityMemoFactory(ownerPrototype: object): (
  owner: Pipeline4HighDensityRepairSolver,
  params: ConstructorParams,
) => ElectricalPredicate | undefined {
  const ownerContract = captureContract(ownerPrototype)
  return (owner, params): ElectricalPredicate | undefined => {
    const isProxy = getReferenceDrcProxyInspector()
    if (!isProxy || isProxy(owner) || isProxy(params) || !hasNativeObservationContract(ownerContract) ||
      getPrototype(owner) !== ownerPrototype || getPrototype(params) !== Object.prototype) return undefined
    const connDescriptor = getDescriptor(params, "connMap")
    if (!connDescriptor || !hasOwn.call(connDescriptor, "value")) return undefined
    const connMap: unknown = connDescriptor.value
    if (typeof connMap !== "object" || connMap === null || isProxy(connMap) || getPrototype(connMap) !== ConnectivityMap.prototype ||
      !hasPlainConstructorData(params, connMap as ConnectivityMap)) return undefined
    const routesDescriptor = getDescriptor(params, "hdRoutes"), obstaclesDescriptor = getDescriptor(params, "obstacles")
    if (!routesDescriptor || !hasOwn.call(routesDescriptor, "value") || !obstaclesDescriptor || !hasOwn.call(obstaclesDescriptor, "value") ||
      !arrayIsArray(routesDescriptor.value) || !arrayIsArray(obstaclesDescriptor.value)) return undefined
    const routes = routesDescriptor.value as ConstructorParams["hdRoutes"]
    for (let index = 0; index < routes.length; index++) {
      const route = routes[index]
      if (!route || typeof route.connectionName !== "string" ||
        (route.rootConnectionName !== undefined && typeof route.rootConnectionName !== "string")) return undefined
    }
    const obstacles = obstaclesDescriptor.value as ConstructorParams["obstacles"]
    for (let index = 0; index < obstacles.length; index++) {
      const obstacle = obstacles[index]
      if (!obstacle || !arrayIsArray(obstacle.connectedTo)) return undefined
      for (let idIndex = 0; idIndex < obstacle.connectedTo.length; idIndex++) {
        if (typeof obstacle.connectedTo[idIndex] !== "string") return undefined
      }
    }
    const memo = new Map<string, Map<string | undefined, WeakMap<object, boolean>>>()
    return (obstacle, route, map): boolean => {
      let roots = memo.get(route.connectionName)
      if (!roots) memo.set(route.connectionName, roots = new Map())
      let obstacleAnswers = roots.get(route.rootConnectionName)
      if (!obstacleAnswers) roots.set(route.rootConnectionName, obstacleAnswers = new WeakMap())
      const previous = obstacleAnswers.get(obstacle)
      if (previous !== undefined) return previous
      const answer = isObstacleConnectedToRoute(obstacle, route, map)
      obstacleAnswers.set(obstacle, answer)
      return answer
    }
  }
}
