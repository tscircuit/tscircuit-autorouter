import { hasNativeDescriptorMetadata } from "./nativeDescriptorMetadataGuard"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"

type PrototypeContract = {
  prototype: object
  descriptors: Record<string, PropertyDescriptor>
}
type A01HistoryDomain = {
  params: ConstructorParameters<typeof HighDensitySolverA01>[0]
  connections: HighDensitySolverA01["unsolvedConnections"]
}

const nativePrototype = Object.getPrototypeOf
const nativeDescriptors = Object.getOwnPropertyDescriptors
const nativeKeys = Object.keys, nativeValues = Object.values, nativeOwnKeys = Reflect.ownKeys
const nativeHasOwn = Object.hasOwn, nativeIs = Object.is, nativeIsArray = Array.isArray
const objectPrototype = Object.prototype, arrayPrototype = Array.prototype
const nativeContracts: PrototypeContract[] = []
for (let prototype: object | null = HighDensitySolverA01.prototype;
  prototype && prototype !== objectPrototype; prototype = nativePrototype(prototype)) {
  nativeContracts.push({ prototype, descriptors: nativeDescriptors(prototype) })
}

function matchesPrototypeContract(contract: PrototypeContract): boolean {
  const current = nativeDescriptors(contract.prototype)
  const names = nativeKeys(contract.descriptors)
  if (nativeKeys(current).length !== names.length) return false
  for (const name of names) {
    const before = contract.descriptors[name]!
    const after = current[name]
    if (!after || after.value !== before.value || after.get !== before.get || after.set !== before.set ||
      after.enumerable !== before.enumerable || after.configurable !== before.configurable ||
      after.writable !== before.writable) return false
  }
  return true
}

function isPlainDataGraph(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") {
    return value === null || ["undefined", "string", "number", "boolean"].includes(typeof value)
  }
  if (seen.has(value)) return true
  const prototype = nativePrototype(value)
  if (prototype !== objectPrototype && prototype !== arrayPrototype) return false
  seen.add(value)
  const descriptors = nativeDescriptors(value)
  for (const key of nativeOwnKeys(descriptors)) {
    if (typeof key !== "string") return false
    const descriptor = descriptors[key]!
    if (!("value" in descriptor) || (!descriptor.enumerable && !(nativeIsArray(value) && key === "length")) ||
      !isPlainDataGraph(descriptor.value, seen)) return false
  }
  return true
}

/** Bijection preserves point aliases, array holes, property order and signed zero. */
function equalDataGraphs(left: unknown, right: unknown,
  leftToRight = new Map<object, object>(), rightToLeft = new Map<object, object>()): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return nativeIs(left, right)
  if (nativeIsArray(left) !== nativeIsArray(right)) return false
  if (leftToRight.has(left)) return leftToRight.get(left) === right
  if (rightToLeft.has(right)) return false
  leftToRight.set(left, right)
  rightToLeft.set(right, left)
  const leftKeys = nativeKeys(left)
  const rightKeys = nativeKeys(right)
  if (leftKeys.length !== rightKeys.length ||
    (nativeIsArray(left) && left.length !== (right as unknown[]).length)) return false
  for (let index = 0; index < leftKeys.length; index++) {
    const key = leftKeys[index]!
    if (key !== rightKeys[index] || !equalDataGraphs(
      (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], leftToRight, rightToLeft)) return false
  }
  return true
}

function hasNativeMethods(solver: HighDensitySolverA01, replayContract?: PrototypeContract): boolean {
  if (!hasNativeDescriptorMetadata() || nativePrototype(solver) !== (replayContract?.prototype ?? HighDensitySolverA01.prototype) ||
    (replayContract && !matchesPrototypeContract(replayContract)) ||
    (replayContract && nativePrototype(replayContract.prototype) !== HighDensitySolverA01.prototype) ||
    !nativeContracts.every((contract, index) => matchesPrototypeContract(contract) &&
      nativePrototype(contract.prototype) === (nativeContracts[index + 1]?.prototype ?? objectPrototype))) return false
  const own = nativeDescriptors(solver)
  for (const descriptor of nativeValues(own)) if (!("value" in descriptor)) return false
  for (const { descriptors } of nativeContracts) {
    for (const name of nativeKeys(descriptors)) if (name !== "constructor" && nativeHasOwn(own, name)) return false
  }
  return true
}

function getNormalizedParams(solver: HighDensitySolverA01): A01HistoryDomain["params"] | null {
  const [params] = solver.getConstructorParams()
  if (!isPlainDataGraph(params) || params.initialPenaltyFn !== undefined) return null
  // The pinned native source reads shuffleSeed only while shuffling setup's
  // initial ordered segments. Every other constructor value remains in the key.
  return { ...params, hyperParameters: { ...params.hyperParameters, shuffleSeed: 0 } }
}

/** One setup snapshot, scoped to a single native candidate and owner request. */
export class NativeA01HistoryEquivalence {
  private constructor(
    private readonly domain: A01HistoryDomain,
    private readonly replayContract?: PrototypeContract,
  ) {}

  static capture(solver: HighDensitySolverA01, replayContract?: PrototypeContract): NativeA01HistoryEquivalence | null {
    if (!hasNativeMethods(solver, replayContract)) return null
    const params = getNormalizedParams(solver)
    const connections = solver.unsolvedConnections
    if (!params || !isPlainDataGraph(connections)) return null
    // Clone both together: endpoint references into params must remain aliases.
    return new NativeA01HistoryEquivalence(structuredClone({ params, connections }), replayContract)
  }

  matches(solver: HighDensitySolverA01, other: NativeA01HistoryEquivalence, otherSolver: HighDensitySolverA01): boolean {
    if (solver.MAX_ITERATIONS !== otherSolver.MAX_ITERATIONS ||
      !hasNativeMethods(solver, this.replayContract) || !hasNativeMethods(otherSolver, other.replayContract)) return false
    const params = getNormalizedParams(solver)
    const otherParams = getNormalizedParams(otherSolver)
    return params !== null && otherParams !== null &&
      equalDataGraphs(params, this.domain.params) && equalDataGraphs(otherParams, other.domain.params) &&
      equalDataGraphs(this.domain, other.domain)
  }
}
