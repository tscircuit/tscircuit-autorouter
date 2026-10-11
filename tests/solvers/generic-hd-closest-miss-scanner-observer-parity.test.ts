import { test, expect } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { scanClosestFuturePointMiss, type ClosestFuturePointMissResult } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/generic-hd-closest-point/scanClosestFuturePointMiss"

type Point = { x: number; y: number; z: number }
type Owner = { futureConnectionPoints: Point[]; readonly viaPenaltyDistance: number }
type Scenario = { owner: Owner; node: Point; log: string[]; literalOnly?: boolean; install?: () => void }
type Outcome = { index: number; error?: unknown; log: string[] }
const originalMath = Math
const originalSqrt = Math.sqrt
const originalApply = Reflect.apply
const mathDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Math")!
const sqrtDescriptor = Object.getOwnPropertyDescriptor(originalMath, "sqrt")!

function nativeScan(owner: Owner, node: Point): ClosestFuturePointMissResult {
  let minimum = Infinity, point: Point | null = null, index = -1, current = 0
  for (const candidate of owner.futureConnectionPoints) {
    const value = distance(node, candidate) + (node.z !== candidate.z ? owner.viaPenaltyDistance : 0)
    if (value < minimum) { minimum = value; point = candidate; index = current }
    current++
  }
  return { point, index }
}

function observe(factory: () => Scenario, scanner: typeof scanClosestFuturePointMiss): Outcome {
  Object.defineProperty(globalThis, "Math", mathDescriptor)
  Object.defineProperty(originalMath, "sqrt", sqrtDescriptor)
  const scenario = factory()
  scenario.install?.()
  try {
    const result = scanner(scenario.owner, scenario.node, scenario.literalOnly ? undefined : { sqrt: originalSqrt, apply: originalApply })
    expect(result.point).toBe(result.index < 0 ? null : scenario.owner.futureConnectionPoints[result.index])
    return { index: result.index, log: [...scenario.log] }
  } catch (error: unknown) { return { index: -1, error, log: [...scenario.log] } }
  finally {
    Object.defineProperty(globalThis, "Math", mathDescriptor)
    Object.defineProperty(originalMath, "sqrt", sqrtDescriptor)
  }
}

test("dormant closest miss scanner retains native observers and numeric winners", async () => {
  const directory = await mkdtemp(join(tmpdir(), "generic-closest-miss-oracle-"))
  // The bundle mocks only the otherwise-disabled authority query. It proves
  // the isolated scanner algorithm, not genuine worker admission or activation.
  const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/generic-hd-closest-point/scanClosestFuturePointMiss.ts", import.meta.url))],
    target: "bun", plugins: [{ name: "isolated-algorithm-authority-only", setup(builder): void {
      builder.onResolve({ filter: /NativeGenericHistoryTaskAuthority$/ }, (): { path: string; namespace: string } => ({ path: "authority", namespace: "isolated-scanner-oracle" }))
      builder.onLoad({ filter: /.*/, namespace: "isolated-scanner-oracle" }, (): { contents: string; loader: "js" } => ({ contents: "export function hasNativeGenericIntrinsicContext(value) { return value !== undefined }", loader: "js" }))
    } }] })
  expect(build.success).toBe(true)
  await Bun.write(join(directory, "scanner.mjs"), await build.outputs[0]!.text())
  const kernel = (await import(join(directory, "scanner.mjs"))).scanClosestFuturePointMiss as typeof scanClosestFuturePointMiss
  const factories: (() => Scenario)[] = []
  const scalarCases = [0, -0, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity, NaN]
  for (const scalar of scalarCases) factories.push((): Scenario => ({ log: [], node: { x: 0, y: 0, z: 0 },
    owner: { viaPenaltyDistance: scalar, futureConnectionPoints: [{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 0 }, { x: Infinity, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }] } }))
  factories.push((): Scenario => {
    const log: string[] = [], points = [{ x: 1, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 2, y: 0, z: 1 }]
    return { log, node: { x: 0, y: 0, z: 0 }, owner: { futureConnectionPoints: points, viaPenaltyDistance: 0 },
      install: (): void => { Object.defineProperty(originalMath, "sqrt", { ...sqrtDescriptor, value: function (this: unknown, value: number): number {
        log.push(this === originalMath ? `sqrt:${value}` : "wrong-receiver")
        return originalSqrt(value)
      } }) } }
  })
  factories.push((): Scenario => {
    const log: string[] = [], node = { get x(): number { log.push("node.x"); return 0 }, get y(): number { log.push("node.y"); return 0 }, get z(): number { log.push("node.z"); return 0 } }
    const points = [1, 2, 3].map((value): Point => ({ get x(): number { log.push(`p${value}.x`); return value }, get y(): number { log.push(`p${value}.y`); return 0 }, get z(): number { log.push(`p${value}.z`); return value % 2 } }))
    let penaltyReads = 0
    return { log, node, owner: { futureConnectionPoints: points, get viaPenaltyDistance(): number { log.push("via"); return penaltyReads++ } },
      install: (): void => {
        Object.defineProperty(globalThis, "Math", { configurable: mathDescriptor.configurable, enumerable: mathDescriptor.enumerable,
          get: (): typeof Math => { log.push("Math"); return originalMath } })
        Object.defineProperty(originalMath, "sqrt", { configurable: true, get: (): typeof Math.sqrt => { log.push("sqrt.lookup"); return originalSqrt } })
      } }
  })
  factories.push((): Scenario => {
    const log: string[] = [], points = [{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: 1 }]
    const penalty = { valueOf(): string { log.push("penalty.valueOf"); return "0" } }
    return { log, node: { x: 0, y: 0, z: 0 }, owner: { futureConnectionPoints: points, viaPenaltyDistance: penalty as unknown as number } }
  })
  factories.push((): Scenario => ({ log: [], node: { x: 0n as unknown as number, y: 0n as unknown as number, z: 0 },
    owner: { futureConnectionPoints: [{ x: 1n as unknown as number, y: 0n as unknown as number, z: 0 }], viaPenaltyDistance: 0 } }))
  factories.push((): Scenario => ({ log: [], node: { x: 0, y: 0, z: 0 },
    owner: { futureConnectionPoints: [undefined as unknown as Point], viaPenaltyDistance: 0 } }))
  // A noncallable property requires literal Native admission before any point
  // read. The mocked positive authority is not a closed-miss domain proof.
  factories.push((): Scenario => ({ log: [], literalOnly: true, node: { x: 0, y: 0, z: 0 }, owner: { futureConnectionPoints: [{ x: 1, y: 0, z: 0 }], viaPenaltyDistance: 0 },
    install: (): void => { Object.defineProperty(originalMath, "sqrt", { ...sqrtDescriptor, value: undefined }) } }))
  const sentinel = new Error("point getter sentinel")
  factories.push((): Scenario => ({ log: [], node: { x: 0, y: 0, z: 0 }, owner: { futureConnectionPoints: [{ get x(): number { throw sentinel }, y: 0, z: 0 }], viaPenaltyDistance: 0 } }))
  for (const factory of factories) {
    const reference = observe(factory, nativeScan)
    for (const scanner of [scanClosestFuturePointMiss, kernel]) {
      const actual = observe(factory, scanner)
      expect(actual.index).toBe(reference.index)
      expect(actual.log).toEqual(reference.log)
      if (reference.error === sentinel) expect(actual.error).toBe(sentinel)
      else if (reference.error) {
        expect((actual.error as Error).name).toBe((reference.error as Error).name)
        expect((actual.error as Error).message).toBe((reference.error as Error).message)
      } else expect(actual.error).toBeUndefined()
    }
  }
  let seed = 0x725618ad
  for (let trial = 0; trial < 4096; trial++) {
    const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000 }
    const node = { x: next() * 100, y: next() * 100, z: trial % 3 }
    const owner = { futureConnectionPoints: Array.from({ length: 32 }, (): Point => ({ x: next() * 100, y: next() * 100, z: (next() * 3) | 0 })), viaPenaltyDistance: next() * 10 - 5 }
    const reference = nativeScan(owner, node), actual = kernel(owner, node, { sqrt: originalSqrt, apply: originalApply })
    expect(actual.index).toBe(reference.index)
    expect(actual.point).toBe(reference.point)
  }
  await rm(directory, { recursive: true, force: true })
})
