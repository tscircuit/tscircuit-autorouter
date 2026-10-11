import { expect, test } from "bun:test"
import { TinyBitsetIntersectionIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetIntersectionIndex"
import { countNewIntersectionsWithValues } from "tiny-hypergraph/lib/countNewIntersections"
import type { DynamicAnglePairArrays } from "tiny-hypergraph/lib/types"

type IntersectionQuery = {
  netId: number
  lesserAngle: number
  greaterAngle: number
  layerMask: number
}

const assertMatchesLinear = (
  index: TinyBitsetIntersectionIndex,
  pairs: DynamicAnglePairArrays,
  query: IntersectionQuery,
): void => {
  const expected = countNewIntersectionsWithValues(
    pairs, query.netId, query.lesserAngle, query.greaterAngle, query.layerMask, 0,
  )
  const actual = index.count(
    pairs, query.netId, query.lesserAngle, query.greaterAngle, query.layerMask,
  )
  expect(actual).toEqual([expected[0], expected[1]])
}

test("tiny bitsets preserve strict intersection bounds, net filtering, layer masks, and snapshot identity", (): void => {
  let seed = 0x4f2c1a79
  const randomInt32 = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed | 0
  }
  const boundaryAngles = [
    -2147483648, -3141593, -3141592, -1, 0, 1, 3141592, 3141593, 2147483647,
  ]
  const index = new TinyBitsetIntersectionIndex()
  const snapshots: Array<{ pairs: DynamicAnglePairArrays; queries: IntersectionQuery[] }> = []
  for (const size of [0, 1, 2, 8, 16, 31, 32, 33, 40]) {
    for (let snapshotNumber = 0; snapshotNumber < 8; snapshotNumber++) {
      const pairs: DynamicAnglePairArrays = {
        netIds: new Int32Array(size),
        lesserAngles: new Int32Array(size),
        greaterAngles: new Int32Array(size),
        layerMasks: new Int32Array(size),
      }
      for (let i = 0; i < size; i++) {
        const first = i % 2 === 0
          ? boundaryAngles[(randomInt32() >>> 0) % boundaryAngles.length]!
          : randomInt32()
        const second = i % 3 === 0 ? first : randomInt32()
        pairs.netIds[i] = i % 3 === 0 ? 7 : randomInt32()
        pairs.lesserAngles[i] = Math.min(first, second)
        pairs.greaterAngles[i] = Math.max(first, second)
        pairs.layerMasks[i] = i % 5 === 0 ? 1 << 31 : randomInt32()
      }
      const original = {
        netIds: Array.from(pairs.netIds),
        lesserAngles: Array.from(pairs.lesserAngles),
        greaterAngles: Array.from(pairs.greaterAngles),
        layerMasks: Array.from(pairs.layerMasks),
      }
      const queries: IntersectionQuery[] = []
      for (let i = 0; i < 120; i++) {
        const existingIndex = size > 0 ? (randomInt32() >>> 0) % size : 0
        const first = size > 0 && i % 3 === 0
          ? pairs.lesserAngles[existingIndex]!
          : boundaryAngles[(randomInt32() >>> 0) % boundaryAngles.length]!
        const second = size > 0 && i % 4 === 0
          ? pairs.greaterAngles[existingIndex]!
          : randomInt32()
        queries.push({
          netId: i % 4 === 0 ? 7 : size > 0 && i % 5 === 0 ? pairs.netIds[existingIndex]! : randomInt32(),
          lesserAngle: Math.min(first, second),
          greaterAngle: Math.max(first, second),
          layerMask: i % 5 === 0 ? 1 << 31 : i % 7 === 0 ? 0 : randomInt32(),
        })
      }
      for (const angle of boundaryAngles) {
        queries.push({ netId: 7, lesserAngle: angle, greaterAngle: angle, layerMask: -1 })
        queries.push({ netId: -7, lesserAngle: -2147483648, greaterAngle: angle, layerMask: 0 })
        queries.push({ netId: -7, lesserAngle: angle, greaterAngle: 2147483647, layerMask: -1 })
      }
      for (const query of queries) assertMatchesLinear(index, pairs, query)
      for (const query of queries.toReversed()) assertMatchesLinear(index, pairs, query)
      expect({
        netIds: Array.from(pairs.netIds),
        lesserAngles: Array.from(pairs.lesserAngles),
        greaterAngles: Array.from(pairs.greaterAngles),
        layerMasks: Array.from(pairs.layerMasks),
      }).toEqual(original)
      snapshots.push({ pairs, queries })
    }
  }
  // Revisiting older, distinct region snapshots must retain their own indexes.
  for (const { pairs, queries } of snapshots.toReversed()) {
    for (const query of queries.slice(0, 20)) assertMatchesLinear(index, pairs, query)
  }

  const highBitPairs: DynamicAnglePairArrays = {
    netIds: new Int32Array(32).fill(11),
    lesserAngles: new Int32Array(32).fill(-10),
    greaterAngles: new Int32Array(32).fill(20),
    layerMasks: new Int32Array(32).fill(1),
  }
  highBitPairs.lesserAngles[31] = 3
  highBitPairs.layerMasks[31] = 1 << 31
  expect(index.count(highBitPairs, 12, 0, 10, 1 << 31)).toEqual([1, 0])
  expect(index.count(highBitPairs, 12, 0, 10, 1)).toEqual([0, 1])
  expect(index.count(highBitPairs, 11, 0, 10, -1)).toEqual([0, 0])
  expect(index.count(highBitPairs, 12, 3, 10, -1)).toEqual([0, 0])
  expect(index.count(highBitPairs, 12, 0, 3, -1)).toEqual([0, 0])

  const replacementSnapshot: DynamicAnglePairArrays = {
    netIds: highBitPairs.netIds.slice(),
    lesserAngles: highBitPairs.lesserAngles.slice(),
    greaterAngles: highBitPairs.greaterAngles.slice(),
    layerMasks: highBitPairs.layerMasks.slice(),
  }
  replacementSnapshot.layerMasks[31] = 1
  expect(index.count(replacementSnapshot, 12, 0, 10, 1 << 31)).toEqual([0, 1])
  expect(index.count(highBitPairs, 12, 0, 10, 1 << 31)).toEqual([1, 0])
})
