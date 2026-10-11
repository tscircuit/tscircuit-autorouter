import { expect, test } from "bun:test"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"

test("primitive snapshots preserve hidden geometry, unsupported accessors, numeric distinctions and fresh native errors", () => {
  const memo = new ReferenceDrcPrimitiveMemo(20)
  let calls = 0
  const point = { y: 0 } as { x: number; y: number }
  Object.defineProperty(point, "x", { value: 1, writable: true, enumerable: false, configurable: true })
  const compute = (): number => { calls++; return point.x }
  expect(memo.getOrCompute("point", point, compute)).toBe(1)
  expect(memo.getOrCompute("point", point, compute)).toBe(1)
  point.x = 2
  expect(memo.getOrCompute("point", point, compute)).toBe(2)
  expect(calls).toBe(2)
  const failures: Error[] = []
  Object.defineProperty(point, "x", { get: (): never => { const error = new Error("native hidden getter"); failures.push(error); throw error }, configurable: true })
  for (let i = 0; i < 2; i++) expect(() => memo.getOrCompute("point", point, compute)).toThrow("native hidden getter")
  expect(failures).toHaveLength(2)
  expect(failures[0]).not.toBe(failures[1])
  const identities = [undefined, null, 0, -0, NaN, Infinity, -Infinity, "NaN", [], [undefined], new Array(1)].map((value) => memo.intern(value))
  expect(new Set(identities).size).toBe(identities.length)
  const mutable = { route: [{ x: 1, width: .1, layer: "top" }] }
  const before = memo.intern(mutable)
  mutable.route[0].x = 2
  expect(memo.intern(mutable)).not.toBe(before)
  mutable.route[0].x = 1
  expect(memo.intern(mutable)).toBe(before)
  const unsupported = { [Symbol.iterator]: (): Iterator<number> => [1][Symbol.iterator]() }
  expect(memo.intern(unsupported)).not.toBe(memo.intern(unsupported))
  class CustomRoute extends Array<number> {}
  const customRoute = new CustomRoute(1, 2)
  expect(memo.intern(customRoute)).not.toBe(memo.intern(customRoute))
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  expect(memo.intern(cyclic)).not.toBe(memo.intern(cyclic))
  const errorCompute = (): never => { throw new RangeError("native computation") }
  for (let i = 0; i < 2; i++) expect(() => memo.getOrCompute("fail", {}, errorCompute)).toThrow(RangeError)
})
