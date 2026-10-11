import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01HistoryEquivalence } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeA01HistoryEquivalence"
import cmn45 from "tests/fixtures/parallel-grid-history-cmn45.json"

test("native A01 equivalence preserves complete inputs, setup order, aliases and mutable-domain guards", (): void => {
  const make = (seed: number): HighDensitySolverA01 => {
    const solver = new HighDensitySolverA01({ nodeWithPortPoints: structuredClone(cmn45),
      cellSizeMm: 0.1, viaDiameter: 0.3, viaMinDistFromBorder: 0.15,
      traceMargin: 0.1, traceThickness: 0.15, effort: 1, hyperParameters: { shuffleSeed: seed } })
    solver.setup()
    solver.MAX_ITERATIONS = 160_000
    return solver
  }
  const candidates = [0, 1, 2, 3, 4, 5].map(make)
  const domains = candidates.map((solver) => NativeA01HistoryEquivalence.capture(solver))
  expect(domains.every((domain) => domain !== null)).toBe(true)
  for (const index of [3, 4]) expect(domains[1]!.matches(candidates[1]!, domains[index]!, candidates[index]!)).toBe(true)
  for (const index of [0, 2, 5]) expect(domains[1]!.matches(candidates[1]!, domains[index]!, candidates[index]!)).toBe(false)
  const first = candidates[1]!
  const other = candidates[3]!
  const equal = (): boolean => domains[1]!.matches(first, domains[3]!, other)
  other.MAX_ITERATIONS--
  expect(equal()).toBe(false)
  other.MAX_ITERATIONS++
  other.hyperParameters.greedyMultiplier += 0.1
  expect(equal()).toBe(false)
  other.hyperParameters.greedyMultiplier -= 0.1
  // Restore the exact native bit pattern rather than undo floating arithmetic.
  other.hyperParameters.greedyMultiplier = first.hyperParameters.greedyMultiplier
  expect(equal()).toBe(true)
  const originalX = other.nodeWithPortPoints.portPoints[0]!.x
  other.nodeWithPortPoints.portPoints[0]!.x += 0.01
  expect(equal()).toBe(false)
  other.nodeWithPortPoints.portPoints[0]!.x = originalX
  for (let step = 0; step < 1_000; step++) first.step()
  for (let step = 0; step < 100; step++) other.step()
  expect(equal()).toBe(true)

  const aliasA = make(1)
  const aliasB = make(3)
  const shared = { value: 4 }
  Object.assign(aliasA.nodeWithPortPoints, { extra: [shared, shared], number: -0, hole: [undefined] })
  Object.assign(aliasB.nodeWithPortPoints, { extra: [{ value: 4 }, { value: 4 }], number: -0, hole: [undefined] })
  const aliasDomainA = NativeA01HistoryEquivalence.capture(aliasA)!
  const aliasDomainB = NativeA01HistoryEquivalence.capture(aliasB)!
  expect(aliasDomainA.matches(aliasA, aliasDomainB, aliasB)).toBe(false)
  const duplicated = { value: 4 }
  Object.assign(aliasB.nodeWithPortPoints, { extra: [duplicated, duplicated] })
  const equalAliasDomain = NativeA01HistoryEquivalence.capture(aliasB)!
  expect(aliasDomainA.matches(aliasA, equalAliasDomain, aliasB)).toBe(true)
  Object.assign(aliasB.nodeWithPortPoints, { number: 0 })
  expect(aliasDomainA.matches(aliasA, NativeA01HistoryEquivalence.capture(aliasB)!, aliasB)).toBe(false)
  Object.assign(aliasB.nodeWithPortPoints, { number: -0, hole: Array(1) })
  expect(aliasDomainA.matches(aliasA, NativeA01HistoryEquivalence.capture(aliasB)!, aliasB)).toBe(false)

  let reads = 0
  const getter = make(1)
  Object.defineProperty(getter.nodeWithPortPoints, "extra", { enumerable: true, get: (): number => { reads++; return 1 } })
  expect(NativeA01HistoryEquivalence.capture(getter)).toBeNull()
  expect(reads).toBe(0)
  const override = make(1)
  override.getConstructorParams = (): never => { throw new Error("custom constructor parameters") }
  expect(NativeA01HistoryEquivalence.capture(override)).toBeNull()
  const originalOutput = HighDensitySolverA01.prototype.getOutput
  HighDensitySolverA01.prototype.getOutput = (): never => { throw new Error("custom output") }
  try { expect(NativeA01HistoryEquivalence.capture(make(1))).toBeNull() }
  finally { HighDensitySolverA01.prototype.getOutput = originalOutput }
  expect(equal()).toBe(true)
})
