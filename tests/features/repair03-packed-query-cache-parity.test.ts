import { expect, test } from "bun:test"
import {
  createPackedSpatialIndex,
  getPackedSpatialCandidateIndexes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/packedSpatialIndex"
import {
  createSpatialIndex,
  getSpatialCandidateIndexes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/spatialIndex"

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

test("packed query caches preserve pass membership, range keys, rebuilds and bounded retention", () => {
  const items: Bounds[] = [
    { minX: 0.1, minY: 0.1, maxX: 0.2, maxY: 0.2 },
    { minX: 1.1, minY: 0.1, maxX: 1.2, maxY: 0.2 },
    { minX: 0.1, minY: 1.1, maxX: 0.2, maxY: 1.2 },
    { minX: 1.1, minY: 1.1, maxX: 1.2, maxY: 1.2 },
  ]
  const generic = createSpatialIndex(items, (item) => item, 1)
  const packed = createPackedSpatialIndex(items, (item) => item, 1)
  const whole: Bounds = { minX: 0, minY: 0, maxX: 1.9, maxY: 1.9 }
  const ranges = [
    whole,
    { ...whole, minX: 1 },
    { ...whole, maxX: 0.9 },
    { ...whole, minY: 1 },
    { ...whole, maxY: 0.9 },
  ]
  for (const range of ranges) {
    expect(getPackedSpatialCandidateIndexes(packed, range, 1))
      .toEqual(getSpatialCandidateIndexes(generic, range, 1))
  }
  expect(packed.candidateCache.size).toBe(5)
  const firstResult = getPackedSpatialCandidateIndexes(packed, whole, 1)
  const sameCells = { minX: 0.3, minY: 0.4, maxX: 1.3, maxY: 1.4 }
  expect(getPackedSpatialCandidateIndexes(packed, sameCells, 1)).toBe(firstResult)

  // Force passes move live geometry while retaining their original grid.
  for (const item of items) {
    item.minX += 10
    item.maxX += 10
  }
  expect(getPackedSpatialCandidateIndexes(packed, whole, 1))
    .toEqual(getSpatialCandidateIndexes(generic, whole, 1))
  packed.generation = 0xffffffff
  expect(getPackedSpatialCandidateIndexes(packed, whole, 1)).toBe(firstResult)
  expect(packed.generation).toBe(0xffffffff)
  const uncachedRange = { minX: 0, minY: 0, maxX: 2, maxY: 2 }
  expect(getPackedSpatialCandidateIndexes(packed, uncachedRange, 1))
    .toEqual(getSpatialCandidateIndexes(generic, uncachedRange, 1))
  expect(packed.generation).toBe(1)
  expect(getPackedSpatialCandidateIndexes(packed, whole, 1)).toBe(firstResult)

  for (const rebuiltItems of [items, items.filter((_, index) => index % 2 === 0), []]) {
    const rebuiltGeneric = createSpatialIndex(rebuiltItems, (item) => item, 1)
    const rebuiltPacked = createPackedSpatialIndex(rebuiltItems, (item) => item, 1)
    expect(rebuiltPacked.candidateCache.size).toBe(0)
    expect(rebuiltPacked.cachedCandidateCount).toBe(0)
    for (const range of [whole, { ...whole, minX: 10, maxX: 11.9 }]) {
      expect(getPackedSpatialCandidateIndexes(rebuiltPacked, range, 1))
        .toEqual(getSpatialCandidateIndexes(rebuiltGeneric, range, 1))
    }
  }

  const empty = createPackedSpatialIndex<Bounds>([], (item) => item, 1)
  for (let query = 0; query < 300; query += 1) {
    expect(getPackedSpatialCandidateIndexes(empty, {
      minX: query, minY: 0, maxX: query, maxY: 0,
    }, 1)).toEqual([])
  }
  expect(empty.candidateCache.size).toBe(256)
  expect(empty.cachedCandidateCount).toBe(0)

  const denseItems = Array.from({ length: 513 }, (): Bounds => ({
    minX: 0.1, minY: 0.1, maxX: 0.2, maxY: 0.2,
  }))
  const denseGeneric = createSpatialIndex(denseItems, (item) => item, 1)
  const densePacked = createPackedSpatialIndex(denseItems, (item) => item, 1)
  for (let query = 0; query < 140; query += 1) {
    const range = { minX: -query - 1, minY: 0, maxX: 1, maxY: 1 }
    expect(getPackedSpatialCandidateIndexes(densePacked, range, 1))
      .toEqual(getSpatialCandidateIndexes(denseGeneric, range, 1))
  }
  expect(densePacked.candidateCache.size).toBe(127)
  expect(densePacked.cachedCandidateCount).toBe(65_151)
})
