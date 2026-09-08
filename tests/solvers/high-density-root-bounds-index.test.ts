import { expect, test } from "bun:test"
import Flatbush from "flatbush"
import { searchObstacleIndex } from "lib/solvers/HighDensitySolver/searchObstacleIndex"

test("obstacle root rejection matches Flatbush boundaries, ordering and custom searches", () => {
  let seed = 917_253
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    const value = seed / 0x1_0000_0000
    return value
  }
  for (const size of [1, 2, 16, 17, 33, 100]) {
    const original = new Flatbush(size)
    for (let i = 0; i < size; i++) {
      const x = random() * 20 - 10
      const y = random() * 20 - 10
      original.add(x, y, x + random(), y + random())
    }
    original.finish()
    const queries: Array<[number, number, number, number]> = [
      [-Infinity, -Infinity, Infinity, Infinity],
      [Infinity, Infinity, -Infinity, -Infinity],
      [NaN, -Infinity, NaN, Infinity],
      [-Infinity, NaN, Infinity, NaN],
      [NaN, NaN, NaN, NaN],
      [original.maxX, original.minY, original.maxX, original.maxY],
      [original.minX, original.maxY, original.maxX, original.maxY],
      [original.maxX + 1e-10, -Infinity, Infinity, Infinity],
      [-Infinity, original.maxY + 1e-10, Infinity, Infinity],
    ]
    for (let i = 0; i < 200; i++) {
      const x = random() * 40 - 20
      const y = random() * 40 - 20
      queries.push([x, y, x + random() * 5, y + random() * 5])
    }
    const restored = Flatbush.from(original.data)
    // Public aggregate fields are not authoritative after reconstruction or
    // external edits. Search and the guard both use the stored root instead.
    restored.minX = restored.minY = 100
    restored.maxX = restored.maxY = 101
    for (const index of [original, restored]) {
      for (const query of queries) {
        expect(searchObstacleIndex(index, ...query)).toEqual(
          index.search(...query),
        )
      }
      const firstMiss = searchObstacleIndex(index, 100, 100, 101, 101)
      firstMiss.push(9)
      expect(searchObstacleIndex(index, 100, 100, 101, 101)).toEqual([])
    }
  }

  const unfinished = new Flatbush(1)
  expect(() => searchObstacleIndex(unfinished, 100, 100, 101, 101)).toThrow(
    "Data not yet indexed",
  )
  const custom = new Flatbush(1)
  custom.add(0, 0)
  custom.finish()
  const calls: unknown[][] = []
  custom.search = (...args: Parameters<Flatbush["search"]>): number[] => {
    calls.push(args)
    return [87]
  }
  expect(searchObstacleIndex(custom, 100, 100, 101, 101)).toEqual([87])
  expect(calls).toEqual([[100, 100, 101, 101]])
  expect(searchObstacleIndex(null, 0, 0, 0, 0)).toEqual([])
})
