const metadataName = Bun.argv[2]!
const nativeDefine = Object.defineProperty, nativeDelete = Reflect.deleteProperty
let getterCalls = 0, admitted = true
try {
  nativeDefine(Object.prototype, metadataName, { __proto__: null, configurable: true,
    get(): never { getterCalls++; throw new Error("preimport descriptor metadata observer") } } as PropertyDescriptor)
  const guard = await import("../../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeDescriptorMetadataGuard")
  admitted = guard.hasNativeDescriptorMetadata()
} finally { nativeDelete(Object.prototype, metadataName) }
console.log(JSON.stringify({ admitted, getterCalls }))
