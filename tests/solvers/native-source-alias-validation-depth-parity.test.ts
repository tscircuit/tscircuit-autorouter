import { expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import * as candidate from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSourceAliasProvenance"

type Validator = typeof candidate
type Outcome = { name: string; message: string } | { accepted: true }
type RecordNode = Record<string, unknown>

test("validation-only graph depth keeps original errors, bounds, aliases and observer behavior", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const sourcePath = resolve(import.meta.dir, "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSourceAliasProvenance.ts")
  const runtimePath = resolve(import.meta.dir, "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime.ts")
  const source = await readFile(sourcePath, "utf8")
  const anchor = "  validatePlainGraph(output, inspector, budget)"
  expect(source.split(anchor).length - 1).toBe(1)
  const directory = await mkdtemp(join(tmpdir(), "native-alias-depth-oracle-"))
  const nativePath = join(directory, "native.ts")
  await writeFile(nativePath, source.replace(anchor, "  walkPlainGraph(output, inspector, budget)").replace('"./authoritative-drc-fork/initializeReferenceDrcRuntime"', JSON.stringify(runtimePath)))
  const native = await import(nativePath) as Validator
  const cases: [unknown, unknown][] = [
    [null, []], [undefined, []], [0, []], [-0, []], ["", []], [false, []],
    [NaN, []], [Infinity, []], [-Infinity, []], [1n, []], [Symbol("value"), []], [(): void => {}, []],
    [new Date(), []], [new Uint32Array(0), []], [Object.create(Array.prototype), []],
    [{ hidden: Object.create(null) }, []], [[], null], [[], {}], [[], [null]],
    [{ bad: undefined }, [{ outputPath: ["missing"], sourcePath: [] }]],
    [{ first: {} }, [{ outputPath: ["first"], sourcePath: [] }, { outputPath: ["first"], sourcePath: [] }]],
    [{ first: { nested: {} } }, [{ outputPath: ["first"], sourcePath: [] }, { outputPath: ["first", "nested"], sourcePath: ["child"] }]],
    [{}, [{ outputPath: [], sourcePath: [] }, { outputPath: [], sourcePath: [] }]],
  ]
  const cycle: RecordNode = { primitive: -0 }
  cycle.self = cycle
  const shared = { position: { x: 1, y: 2 } }
  cases.push([cycle, []], [{ a: shared, b: shared }, []])
  const hidden = {}
  Object.defineProperty(hidden, "value", { value: 1, enumerable: false })
  const symbolKey = { [Symbol("key")]: 1 }
  cases.push([hidden, []], [symbolKey, []])
  for (const depth of [1_023, 1_024, 1_025]) {
    cases.push([chain(depth, 1), []], [chain(depth, cycle), []], [chain(depth, shared), []])
  }
  for (const [output, provenance] of cases) {
    expect(outcome(candidate, output, provenance)).toEqual(outcome(native, output, provenance))
  }
  expect(outcome(candidate, chain(1_024, 1), [])).toEqual({ accepted: true })
  expect(outcome(candidate, chain(1_025, 1), [])).toEqual({ name: "Error", message: "Native source alias provenance exceeds its path depth bound" })
  // The depth check occurs when a child is enqueued, even when that object has
  // already been seen through a shallower identity path.
  const alreadySeen = {}
  const repeatedDeep = { first: alreadySeen, deep: chain(1_024, alreadySeen) }
  expect(outcome(candidate, repeatedDeep, [])).toEqual(outcome(native, repeatedDeep, []))
  expect(outcome(candidate, repeatedDeep, [])).toEqual({ name: "Error", message: "Native source alias provenance exceeds its path depth bound" })

  for (const validator of [native, candidate]) {
    let reads = 0, traps = 0
    const getter = Object.defineProperty({}, "getter", { get(): unknown { reads++; throw new Error("Getter must stay unread") } })
    const proxy = new Proxy({}, { ownKeys(): string[] { traps++; return [] }, getPrototypeOf(): object { traps++; return Object.prototype }, getOwnPropertyDescriptor(): PropertyDescriptor | undefined { traps++; return undefined } })
    const outputWithUnusedBadRow = { rows: [{ selected: true }, { unused: getter }] }
    expect(outcome(validator, outputWithUnusedBadRow, [])).toEqual({ name: "Error", message: "Native source alias provenance requires existing own data properties" })
    expect(outcome(validator, { nested: proxy }, [])).toEqual({ name: "Error", message: "Native source alias provenance rejects Proxy objects" })
    expect(outcome(validator, NaN, proxy)).toEqual({ name: "Error", message: "Native source alias provenance requires finite plain data" })
    expect(outcome(validator, { first: NaN, second: getter }, [])).toEqual({ name: "Error", message: "Native source alias provenance requires finite plain data" })
    expect(outcome(validator, { first: getter, second: NaN }, [])).toEqual({ name: "Error", message: "Native source alias provenance requires existing own data properties" })
    expect(reads).toBe(0)
    expect(traps).toBe(0)
  }

  const maximumObjects = Array.from({ length: 99_998 }, (): object => ({}))
  expect(outcome(candidate, maximumObjects, [])).toEqual(outcome(native, maximumObjects, []))
  expect(outcome(candidate, maximumObjects, [])).toEqual({ accepted: true })
  maximumObjects.push({})
  expect(outcome(candidate, maximumObjects, [])).toEqual(outcome(native, maximumObjects, []))
  expect(outcome(candidate, maximumObjects, [])).toEqual({ name: "Error", message: "Native source alias provenance exceeds its object bound" })
  // Test the exact branch boundary in source copies with a small property cap;
  // the genuine million-property overflow still uses unchanged production caps.
  const limited = await limitedPropertyOracles(source, runtimePath, directory, anchor)
  const maximumProperties = new Array<number>(127).fill(0)
  expect(outcome(limited.candidate, maximumProperties, [])).toEqual(outcome(limited.native, maximumProperties, []))
  expect(outcome(limited.candidate, maximumProperties, [])).toEqual({ accepted: true })
  maximumProperties.push(0)
  expect(outcome(limited.candidate, maximumProperties, [])).toEqual(outcome(limited.native, maximumProperties, []))
  expect(outcome(limited.candidate, maximumProperties, [])).toEqual({ name: "Error", message: "Native source alias provenance exceeds its property bound" })
  const oversizedProperties = new Array<number>(1_000_000).fill(0)
  expect(outcome(candidate, oversizedProperties, [])).toEqual(outcome(native, oversizedProperties, []))
  expect(outcome(candidate, oversizedProperties, [])).toEqual({ name: "Error", message: "Native source alias provenance exceeds its property bound" })

  const original = { route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], metadata: { nested: shared }, jumpers: [{ id: "original" }] }
  const output = { route: [original.route[0], { ...original.route[1] }], metadata: original.metadata, jumpers: original.jumpers }
  const provenance = candidate.captureNativeSourceAliasProvenance(output, original)
  expect(provenance).toEqual(native.captureNativeSourceAliasProvenance(output, original))
  expect(outcome(candidate, structuredClone(output), provenance)).toEqual(outcome(native, structuredClone(output), provenance))
  const actual = candidate.rehydrateNativeSourceAliases(structuredClone(output), original, provenance)
  const expected = native.rehydrateNativeSourceAliases(structuredClone(output), original, provenance)
  expect(actual).toEqual(expected)
  expect(actual.route[0]).toBe(original.route[0])
  expect(actual.route[1]).not.toBe(original.route[1])
  expect(actual.metadata).toBe(original.metadata)
  expect(actual.jumpers).toBe(original.jumpers)
})

function outcome(validator: Validator, output: unknown, provenance: unknown): Outcome {
  try {
    validator.assertNativeSourceAliasOutput(output, provenance)
    return { accepted: true }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { name: error.name, message: error.message }
  }
}

function chain(depth: number, end: unknown): unknown {
  let value = end
  for (let index = 0; index < depth; index++) {
    value = { child: value }
  }
  return value
}

async function limitedPropertyOracles(source: string, runtimePath: string, directory: string, anchor: string): Promise<{ native: Validator; candidate: Validator }> {
  const bound = "const MAX_PROPERTIES = 1_000_000"
  expect(source.split(bound).length - 1).toBe(1)
  const limited = source.replace(bound, "const MAX_PROPERTIES = 128").replace('"./authoritative-drc-fork/initializeReferenceDrcRuntime"', JSON.stringify(runtimePath))
  const candidatePath = join(directory, "candidate-property-bound.ts")
  const nativePath = join(directory, "native-property-bound.ts")
  await writeFile(candidatePath, limited)
  await writeFile(nativePath, limited.replace(anchor, "  walkPlainGraph(output, inspector, budget)"))
  return { candidate: await import(candidatePath) as Validator, native: await import(nativePath) as Validator }
}
