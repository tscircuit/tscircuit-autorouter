import { expect, test } from "bun:test"
import { Pipeline9SharedContextCodec, deserializePipeline9SharedContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9SharedContextCodec"

test("context boundary aliases and accessors retain native transport without extra reads", async (): Promise<void> => {
  const stats = { contextSerializationCalls: 0, contextSerializedBytes: 0, sharedContextMessages: 0,
    contextAliasNativeMessages: 0, contextShapeNativeMessages: 0 }
  const codec = await Pipeline9SharedContextCodec.create(stats)
  const common = { x: 1 }
  const backing = new ArrayBuffer(8)
  const context = { common, view: new Float64Array(backing) }
  expect(codec.getReference("global-drc", 1, context, { nested: [common] })).toBeUndefined()
  expect(codec.getReference("global-drc", 1, context, { map: new Map([[common, 1]]) })).toBeUndefined()
  expect(codec.getReference("global-drc", 1, context, { view: new Uint8Array(backing) })).toBeUndefined()
  const allowed = codec.getReference("global-drc", 1, context, { snapshot: { common: { x: 1 } } })!
  expect(await deserializePipeline9SharedContext(allowed)).toEqual(structuredClone(context))
  let accessorReads = 0
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get: (): number => { accessorReads++; return 7 } })
  expect(codec.getReference("simplification", 2, accessor, {})).toBeUndefined()
  expect(accessorReads).toBe(0)
  expect(structuredClone(accessor)).toEqual({ value: 7 })
  expect(accessorReads).toBe(1)
  expect(codec.getReference("simplification", 3, { x: 1 }, accessor)).toBeUndefined()
  expect(accessorReads).toBe(1)
  expect(codec.getReference("simplification", 4, { cancellation: new SharedArrayBuffer(4) }, {})).toBeUndefined()
  expect(codec.getReference("high-density", 6, context, { cancellation: new SharedArrayBuffer(4) })).toBeDefined()
  expect(codec.getReference("simplification", 5, { invalid: Symbol("invalid") }, {})).toBeUndefined()
  expect(() => structuredClone({ invalid: Symbol("invalid") })).toThrow()
  expect(stats.contextAliasNativeMessages).toBe(3)
  expect(stats.contextSerializationCalls).toBe(2)
})
