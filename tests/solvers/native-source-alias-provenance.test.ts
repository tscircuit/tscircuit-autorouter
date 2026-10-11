import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { captureNativeSourceAliasProvenance, rehydrateNativeSourceAliases } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSourceAliasProvenance"

test("native source identity provenance restores source aliases without coalescing equal fresh points or observing rejected graphs", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const metadata: { label: string; self?: unknown } = { label: "original" }
  metadata.self = metadata
  const point = { x: 0, y: -0, z: 0, metadata }
  const end = { x: 2, y: 1, z: 0, metadata }
  const source = { route: [point, end], vias: [], metadata, undefinedValue: undefined }
  const sharedFresh = { x: 0, y: -0, z: 0, metadata }
  const output: { route: unknown[]; vias: unknown[]; first: unknown; second: unknown; self?: unknown } = {
    route: [point, sharedFresh, end], vias: [], first: sharedFresh, second: sharedFresh,
  }
  output.self = output
  const aliases = captureNativeSourceAliasProvenance(output, source)
  expect(aliases).toEqual([
    { outputPath: ["route", "0"], sourcePath: ["route", "0"] },
    { outputPath: ["route", "1", "metadata"], sourcePath: ["route", "0", "metadata"] },
    { outputPath: ["route", "2"], sourcePath: ["route", "1"] },
  ])
  const transported = structuredClone(output)
  const restored = rehydrateNativeSourceAliases(transported, source, structuredClone(aliases))
  expect(restored).toBe(transported)
  expect(restored.route[0]).toBe(point)
  expect(restored.route[2]).toBe(end)
  expect(restored.route[1]).not.toBe(point)
  expect(restored.route[1]).toBe(restored.first)
  expect(restored.first).toBe(restored.second)
  expect(restored.self).toBe(restored)
  expect((restored.first as typeof sharedFresh).metadata).toBe(metadata)
  expect((restored.first as typeof sharedFresh).metadata.self).toBe(metadata)
  expect(Object.is((restored.first as typeof sharedFresh).y, -0)).toBe(true)
  point.x = 0.125
  metadata.label = "published mutation"
  expect((restored.route[0] as typeof point).x).toBe(0.125)
  expect((restored.first as typeof sharedFresh).x).toBe(0)
  expect((restored.first as typeof sharedFresh).metadata.label).toBe("published mutation")
  expect(rehydrateNativeSourceAliases(structuredClone(source), source,
    captureNativeSourceAliasProvenance(source, source))).toBe(source)
  expect(rehydrateNativeSourceAliases(7, source, [])).toBe(7)

  const literal = Object.create(null) as Record<string, unknown>
  Object.defineProperty(literal, "__proto__", { value: metadata, enumerable: true, configurable: true, writable: true })
  const literalOutput = { value: literal }
  const literalCopy = structuredClone(literalOutput)
  rehydrateNativeSourceAliases(literalCopy, source, captureNativeSourceAliasProvenance(literalOutput, source))
  expect(Object.getOwnPropertyDescriptor(literalCopy.value, "__proto__")!.value).toBe(metadata)
  expect(Object.getPrototypeOf(literalCopy.value)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(literalCopy)).toBe(Object.prototype)

  let observations = 0
  const trap = new Proxy({}, { get(): never { observations++; throw new Error("get observed") },
    ownKeys(): never { observations++; throw new Error("keys observed") },
    getPrototypeOf(): never { observations++; throw new Error("prototype observed") },
    getOwnPropertyDescriptor(): never { observations++; throw new Error("descriptor observed") } })
  for (const [badOutput, badSource] of [[trap, source], [{ deep: trap }, source], [output, trap], [output, { deep: trap }]]) {
    expect(() => captureNativeSourceAliasProvenance(badOutput, badSource)).toThrow("Proxy")
  }
  expect(() => rehydrateNativeSourceAliases(trap, source, [])).toThrow("Proxy")
  expect(() => rehydrateNativeSourceAliases({}, source, trap)).toThrow("provenance")
  const getter = Object.defineProperty({}, "value", { enumerable: true, get(): never {
    observations++; throw new Error("getter observed")
  } })
  expect(() => captureNativeSourceAliasProvenance({ nested: getter }, source)).toThrow("own data")
  expect(() => captureNativeSourceAliasProvenance(output, { nested: getter })).toThrow("own data")
  expect(() => rehydrateNativeSourceAliases({ nested: getter }, source, [])).toThrow("own data")
  const getterRow = Object.defineProperty({ sourcePath: [] }, "outputPath", { enumerable: true, get(): never {
    observations++; throw new Error("row getter observed")
  } })
  expect(() => rehydrateNativeSourceAliases({}, source, [getterRow])).toThrow("own data")
  const getterPath = Object.defineProperty([], "0", { configurable: true, get(): never {
    observations++; throw new Error("path getter observed")
  } })
  expect(() => rehydrateNativeSourceAliases({}, source, [{ outputPath: getterPath, sourcePath: [] }])).toThrow("own data")
  expect(observations).toBe(0)

  for (const bad of [NaN, Infinity, () => {}, Symbol("bad"), 1n, new Map(), { [Symbol("key")]: 0 }]) {
    expect(() => captureNativeSourceAliasProvenance({ bad }, source)).toThrow()
  }
  const rejects = [
    [{ outputPath: ["a"], sourcePath: ["route", "0"] }, { outputPath: ["a"], sourcePath: ["route", "1"] }],
    [{ outputPath: ["a"], sourcePath: ["route", "0"] }, { outputPath: ["a", "nested"], sourcePath: ["route", "1"] }],
    [{ outputPath: [], sourcePath: [] }, { outputPath: ["a"], sourcePath: ["route", "0"] }],
    [{ outputPath: ["missing"], sourcePath: ["route", "0"] }],
    [{ outputPath: ["a"], sourcePath: ["route", "missing"] }],
    [{ outputPath: ["toString"], sourcePath: [] }],
    [{ outputPath: ["a"], sourcePath: ["metadata", "label"] }],
    [{ outputPath: ["a"], sourcePath: [], extra: 1 }],
    [{ outputPath: ["a"], sourcePath: ["route", "0"], [Symbol("extra")]: true }],
    [{ outputPath: ["a", undefined], sourcePath: [] }],
    [trap],
    [{ outputPath: ["a"], sourcePath: trap }],
  ]
  for (const provenance of rejects) {
    const target = { a: { nested: {} } }
    const oldA = target.a
    const oldNested = target.a.nested
    expect(() => rehydrateNativeSourceAliases(target, source, provenance)).toThrow()
    expect(target.a).toBe(oldA)
    expect(target.a.nested).toBe(oldNested)
  }
  const shared = { item: {} }
  const aliasTarget = { left: shared, right: shared }
  expect(() => rehydrateNativeSourceAliases(aliasTarget, source, [
    { outputPath: ["left", "item"], sourcePath: ["route", "0"] },
    { outputPath: ["right", "item"], sourcePath: ["route", "0"] },
  ])).toThrow("Duplicate")
  const sameOldObject = {}
  expect(() => rehydrateNativeSourceAliases({ a: sameOldObject, b: sameOldObject }, source, [
    { outputPath: ["a"], sourcePath: ["route", "0"] },
    { outputPath: ["b"], sourcePath: ["route", "1"] },
  ])).toThrow("Conflicting source identity")
  const immutable = Object.defineProperty({}, "point", { value: {}, writable: false, configurable: false })
  expect(() => rehydrateNativeSourceAliases(immutable, source,
    [{ outputPath: ["point"], sourcePath: ["route", "0"] }])).toThrow("not writable")
  expect(observations).toBe(0)
  const tooDeep: Record<string, unknown> = {}
  let cursor = tooDeep
  for (let index = 0; index < 1_025; index++) {
    const next: Record<string, unknown> = {}
    cursor.next = next
    cursor = next
  }
  expect(() => captureNativeSourceAliasProvenance(tooDeep, source)).toThrow("depth bound")

  // Native publication preserves the initial input point and any retained end
  // point. Clone a worker's actual native result, then recover those identities.
  for (const inputPoints of [[{ x: 0, y: 0, z: 0 }],
    [{ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.6, z: 0 }, { x: 2, y: 1, z: 0 }],
    [{ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.6, z: 0 }, { x: 0.5, y: 0.6, z: 1 }, { x: 2, y: 1, z: 1 }]]) {
    const input: HighDensityRoute = { connectionName: "native", traceThickness: 0.15, viaDiameter: 0.3,
      route: inputPoints, vias: [], jumpers: [] }
    input.route[0]!.toNextSegmentCircuitJsonMetadata = { pcb_port_id: "source-metadata" }
    const native = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: [input], obstacles: [] })
    native.solve()
    const workerInput = structuredClone(input)
    const worker = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: [workerInput], obstacles: [] })
    worker.solve()
    const workerOutput = worker.simplifiedHdRoutes[0]!
    const result = structuredClone(workerOutput)
    const restoredNative = rehydrateNativeSourceAliases(result, input,
      structuredClone(captureNativeSourceAliasProvenance(workerOutput, workerInput)))
    expect(restoredNative).toEqual(native.simplifiedHdRoutes[0]!)
    expect(restoredNative.route[0]).toBe(input.route[0])
    expect(restoredNative.route[0]).toBe(native.simplifiedHdRoutes[0]!.route[0])
    expect(restoredNative.route[0]!.toNextSegmentCircuitJsonMetadata).toBe(input.route[0]!.toNextSegmentCircuitJsonMetadata)
    expect(restoredNative.jumpers).toBe(input.jumpers)
    input.route[0]!.x += 0.01
    input.route[0]!.toNextSegmentCircuitJsonMetadata.pcb_port_id = "live-metadata"
    expect(restoredNative).toEqual(native.simplifiedHdRoutes[0]!)
  }
})
