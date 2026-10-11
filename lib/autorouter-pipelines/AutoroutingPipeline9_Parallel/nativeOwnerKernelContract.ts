import { hasNativeDescriptorMetadata } from "./nativeDescriptorMetadataGuard"
import { isWorkerNativeGridProxy } from "./workerNativeGridRuntime"
export type NativeOwnerKernelContract = {
  prototype: object
  descriptors: Record<string, PropertyDescriptor>
}

// Capture reflection before later instrumentation. Eligibility never evaluates
// an accessor and never traverses a replaceable Array iterator.
export const nativeOwnerDescriptor = Object.getOwnPropertyDescriptor
export const nativeOwnerPrototype = Object.getPrototypeOf
export const nativeOwnerDefine = Object.defineProperties
export const nativeOwnerHasOwn = Object.hasOwn
export const nativeOwnerDelete = Reflect.deleteProperty
export const nativeOwnerGet = Reflect.get
export const nativeOwnerApply = Reflect.apply
export const nativeOwnerIs = Object.is
export const nativeOwnerIsArray = Array.isArray
const nativeOwnerNames = Object.getOwnPropertyNames
const nativeOwnerKeys = Object.keys
const policyNames = ["shuffleSeed", "ripCost", "ripTracePenalty", "ripViaPenalty", "viaBaseCost", "greedyMultiplier"]
const descriptorNames = new WeakMap<object, readonly string[]>()
const getDescriptorNames = descriptorNames.get.bind(descriptorNames)
const setDescriptorNames = descriptorNames.set.bind(descriptorNames)

function getCapturedDescriptorNames(descriptors: Record<string, PropertyDescriptor>): readonly string[] {
  const cached = getDescriptorNames(descriptors)
  if (cached) return cached
  const names = nativeOwnerKeys(descriptors)
  setDescriptorNames(descriptors, names)
  return names
}

/** Full fixed method contracts, without per-step descriptor-map allocation. */
export function matchesNativeOwnerKernelContract(owner: object,
  contract: NativeOwnerKernelContract, nativePrototype: object,
  nativeDescriptors: Record<string, PropertyDescriptor>,
  installedOwnMethods?: Record<string, unknown>): boolean {
  if (!hasNativeDescriptorMetadata() || nativeOwnerPrototype(owner) !== contract.prototype) return false
  if (contract.prototype !== nativePrototype && nativeOwnerPrototype(contract.prototype) !== nativePrototype) return false
  for (let level = 0; level < 2; level++) {
    const prototype = level === 0 ? contract.prototype : nativePrototype
    const descriptors = level === 0 ? contract.descriptors : nativeDescriptors
    const names = getCapturedDescriptorNames(descriptors)
    for (let index = 0; index < names.length; index++) {
      const name = names[index]!, original = descriptors[name]!
      const current = nativeOwnerDescriptor(prototype, name)
      if (!current || current.value !== original.value || current.get !== original.get ||
        current.set !== original.set || current.writable !== original.writable ||
        current.enumerable !== original.enumerable || current.configurable !== original.configurable) return false
      if (name !== "constructor" && nativeOwnerHasOwn(owner, name)) {
        const own = nativeOwnerDescriptor(owner, name)!
        if (!installedOwnMethods || !nativeOwnerHasOwn(installedOwnMethods, name) ||
          own.value !== installedOwnMethods[name] || own.get || own.set) return false
      }
    }
  }
  const penalty = nativeOwnerDescriptor(owner, "initialPenaltyFn")
  return penalty !== undefined && nativeOwnerHasOwn(penalty, "value") && penalty.value === undefined
}

/** Extra prototype names cannot become hidden user callbacks at installation. */
export function hasOriginalNativeOwnerNames(contract: NativeOwnerKernelContract,
  nativePrototype: object, nativeDescriptors: Record<string, PropertyDescriptor>): boolean {
  const ownerNames = getCapturedDescriptorNames(contract.descriptors)
  const nativeNames = getCapturedDescriptorNames(nativeDescriptors)
  return nativeOwnerNames(contract.prototype).length === ownerNames.length &&
    nativeOwnerNames(nativePrototype).length === nativeNames.length
}

/** A numeric data policy cannot execute a callback during a verified batch. */
export function hasNativeOwnerNumericPolicy(owner: object): boolean {
  const descriptor = nativeOwnerDescriptor(owner, "hyperParameters")
  if (!descriptor || !nativeOwnerHasOwn(descriptor, "value") || !descriptor.value || typeof descriptor.value !== "object" ||
    isWorkerNativeGridProxy(descriptor.value)) return false
  for (let index = 0; index < policyNames.length; index++) {
    const policy = nativeOwnerDescriptor(descriptor.value, policyNames[index]!)
    if (!policy || !nativeOwnerHasOwn(policy, "value") || typeof policy.value !== "number") return false
  }
  return true
}
