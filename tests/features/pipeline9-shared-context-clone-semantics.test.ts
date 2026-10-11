import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { Pipeline9SharedContextCodec } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9SharedContextCodec"

test("one shared context snapshot preserves native clone aliases and numeric values in four workers", async (): Promise<void> => {
  const stats = { contextSerializationCalls: 0, contextSerializedBytes: 0, sharedContextMessages: 0,
    contextAliasNativeMessages: 0, contextShapeNativeMessages: 0 }
  const codec = await Pipeline9SharedContextCodec.create(stats)
  const buffer = new ArrayBuffer(24)
  const values = new Float64Array(buffer)
  values.set([NaN, -0, Infinity])
  const common = { missing: undefined, positive: Infinity, negative: -Infinity, z: -0, nan: NaN }
  const context: Record<PropertyKey, unknown> = { first: common, second: common, values,
    bytes: new Uint8Array(buffer), map: new Map([[common, values]]), set: new Set([common, values]),
    sparse: [, undefined, common], expression: /route/gi, when: new Date(1234567) }
  context.self = context
  context[Symbol("ignored")] = "omitted"
  const workers = Array.from({ length: 4 }, () => new Worker(new URL("../fixtures/pipeline9-shared-context-worker.ts", import.meta.url)))
  const request = (worker: Worker, message: unknown): Promise<any> => new Promise((resolve, reject) => {
    worker.onmessage = (event): void => resolve(event.data)
    worker.onerror = (event): void => { event.preventDefault(); reject(new Error(event.message)) }
    worker.postMessage(message)
  })
  try {
    const expected = await Promise.all(workers.map((worker) => request(worker, { context })))
    const references = workers.map(() => codec.getReference("high-density", 1, context, { kind: "probe" })!)
    expect(references.every((reference) => reference.bytes === references[0]!.bytes)).toBe(true)
    const actual = await Promise.all(workers.map((worker, index) => request(worker, { sharedContext: references[index] })))
    for (let index = 0; index < 4; index++) {
      deepStrictEqual(actual[index], expected[index])
      expect(actual[index].first).toBe(actual[index].second)
      expect(actual[index].map.get(actual[index].first)).toBe(actual[index].values)
      expect(actual[index].set.has(actual[index].first)).toBe(true)
      expect(actual[index].values.buffer).toBe(actual[index].bytes.buffer)
      expect(actual[index].self).toBe(actual[index])
      expect(Object.is(actual[index].values[1], -0)).toBe(true)
      expect(Object.hasOwn(actual[index].first, "missing")).toBe(true)
      expect(Object.getOwnPropertySymbols(actual[index])).toEqual([])
    }
    expect(stats.contextSerializationCalls).toBe(1)
    expect(stats.contextSerializedBytes).toBe(references[0]!.bytes.byteLength)
    expect(stats.sharedContextMessages).toBe(4)
    common.z = 9
    const snapshot = await request(workers[0]!, { sharedContext: references[0] })
    expect(Object.is(snapshot.first.z, -0)).toBe(true)
  } finally { for (const worker of workers) worker.terminate() }
})
