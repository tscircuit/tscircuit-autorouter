import { expect, test } from "bun:test"
import { OwnerPairCutDomain, type OwnerPairCutWork } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/OwnerPairCutDomain"

test("exact pair domain replays every old cut for late owners and preserves bit31/63/64", (): void => {
  const counters: Partial<OwnerPairCutWork> = {}
  const charge = (field: keyof OwnerPairCutWork, units = 1): boolean => {
    counters[field] = (counters[field] ?? 0) + units
    return true
  }
  const boundaryPairs: Array<[number, number]> = [[3, 8], [8, 11], [9, 11], [68, 69]]
  for (const pair of boundaryPairs) {
    const domain = new OwnerPairCutDomain(charge)
    expect(domain.choose(70, [[pair]])).toEqual(pair)
    expect(domain.storage.bytes).toBe(304)
    expect(domain.storage.limited).toBe(false)
  }
  const domain = new OwnerPairCutDomain(charge)
  const cuts = [[[0], [1]], [[2]]]
  expect(domain.choose(3, cuts)).toEqual([0, 2])
  cuts.push([[0, 69], [1, 69]])
  // Applying only the new cut after growth would admit an invalid pair.
  expect(domain.choose(70, cuts)).toBeUndefined()
  const newlyValid = new OwnerPairCutDomain(charge)
  expect(newlyValid.choose(3, [[[0], [1]]])).toEqual([0, 1])
  expect(newlyValid.choose(70, [[[0], [1]], [[69]]])).toEqual([0, 69])
  expect(counters.pairDomainRebuilds).toBe(8)
  expect(counters.pairReplayedCuts).toBeGreaterThan(8)
  expect(counters.pairActiveTests).toBeGreaterThan(0)
  const limited = new OwnerPairCutDomain(charge)
  expect(limited.choose(1000000000, [[[0]]])).toBeUndefined()
  expect(limited.storage.limited).toBe(true)
  expect(counters.pairStorageLimitHits).toBe(1)
  expect(() => new OwnerPairCutDomain(charge).choose(3, [[[0, 0]]])).toThrow()
  expect(() => new OwnerPairCutDomain(charge).choose(3, [[[2, 1]]])).toThrow()
  expect(() => new OwnerPairCutDomain(charge).choose(3, [[[3]]])).toThrow()
})
