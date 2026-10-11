type DescriptorMetadata = {
  value: unknown; get: PropertyDescriptor["get"]; set: PropertyDescriptor["set"]
  writable: boolean | undefined; enumerable: boolean | undefined; configurable: boolean | undefined
}
const nativeDescriptors = Object.getOwnPropertyDescriptors
const nativePrototype = Object.getPrototypeOf
const nativeSetPrototype = Object.setPrototypeOf
const nativeOwnKeys = Reflect.ownKeys
const nativeHasOwn = Object.hasOwn
const nativeIs = Object.is
const objectPrototype = Object.prototype
const objectPrototypeParent = nativePrototype(objectPrototype)
const originalDescriptors = nativeDescriptors(objectPrototype)
const originalNames = nativeOwnKeys(originalDescriptors)
const originalMetadata: DescriptorMetadata[] = []
const metadataNames = ["value", "get", "set", "writable", "enumerable", "configurable"] as const
let hasOriginalMetadataDomain = true
for (let index = 0; index < metadataNames.length; index++) {
  if (nativeHasOwn(originalDescriptors, metadataNames[index]!)) hasOriginalMetadataDomain = false
}
for (let index = 0; index < originalNames.length; index++) {
  const descriptor = originalDescriptors[originalNames[index] as keyof typeof originalDescriptors]!
  // All six fields are own properties, even when the native descriptor omits
  // them. Capturing an absent optional field must never invoke an inherited hook.
  originalMetadata[index] = {
    value: nativeHasOwn(descriptor, "value") ? descriptor.value : undefined,
    get: nativeHasOwn(descriptor, "get") ? descriptor.get : undefined,
    set: nativeHasOwn(descriptor, "set") ? descriptor.set : undefined,
    writable: nativeHasOwn(descriptor, "writable") ? descriptor.writable : undefined,
    enumerable: nativeHasOwn(descriptor, "enumerable") ? descriptor.enumerable : undefined,
    configurable: nativeHasOwn(descriptor, "configurable") ? descriptor.configurable : undefined,
  }
}

/** Fixed native Object.prototype preflight before any optional metadata read. */
export function hasNativeDescriptorMetadata(): boolean {
  if (!hasOriginalMetadataDomain || nativePrototype(objectPrototype) !== objectPrototypeParent) return false
  const descriptors = nativeDescriptors(objectPrototype)
  nativeSetPrototype(descriptors, null)
  if (nativeOwnKeys(descriptors).length !== originalNames.length) return false
  for (let index = 0; index < originalNames.length; index++) {
    const original = originalMetadata[index]!
    const current = descriptors[originalNames[index] as keyof typeof descriptors]
    if (!current) return false
    nativeSetPrototype(current, null)
    if (!nativeIs(current.value, original.value) || current.get !== original.get || current.set !== original.set ||
      current.writable !== original.writable || current.enumerable !== original.enumerable ||
      current.configurable !== original.configurable) return false
  }
  return true
}

/** The caller has proved the metadata domain; incoming proxies are not eligible. */
export function getNativeDescriptorMap(object: object): Record<PropertyKey, PropertyDescriptor> {
  const descriptors = nativeDescriptors(object)
  // Missing snapshot keys then resolve to undefined rather than an inherited
  // property. Only captured native reflection operates on these fresh maps.
  nativeSetPrototype(descriptors, null)
  // Fixed intrinsic/contract targets were captured before late instrumentation.
  return descriptors
}

export const nativeDescriptorMapKeys = nativeOwnKeys
