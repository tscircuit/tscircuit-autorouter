import { expect, test } from "bun:test"
import Flatbush from "flatbush"
import { ClearanceCopperGridIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/ClearanceCopperGridIndex"

test("copper CSR queries retain exact tree candidates, boundaries, filter order and stamp reuse", (): void => {
  const tree = new Flatbush(514)
  let state = 0x19af473
  for (let id = 0; id < 512; id++) {
    state = Math.imul(state, 1664525) + 1013904223 | 0
    const x = ((state >>> 0) / 2 ** 32 - .5) * 24
    state = Math.imul(state, 1664525) + 1013904223 | 0
    const y = ((state >>> 0) / 2 ** 32 - .5) * 24
    tree.add(x, y, x + (id % 5) / 4, y + (id % 7) / 8)
  }
  tree.add(-0, -0, 0, 0)
  tree.add(-10, -10, 10, 10)
  tree.finish()
  const bounds = { minX: -10, minY: -10, maxX: 10, maxY: 10 }
  const grid = ClearanceCopperGridIndex.create(tree, bounds)
  expect(grid).toBeInstanceOf(ClearanceCopperGridIndex)
  bounds.minX = -20
  for (let query = 0; query < 4000; query++) {
    state = Math.imul(state, 1664525) + 1013904223 | 0
    const x = query % 8 === 0 ? (query % 41) / 2 - 10 : ((state >>> 0) / 2 ** 32 - .5) * 24
    state = Math.imul(state, 1664525) + 1013904223 | 0
    const y = query % 8 === 0 ? (query % 37) / 2 - 10 : ((state >>> 0) / 2 ** 32 - .5) * 24
    const maxX = x + (query % 6) / 8
    const maxY = y + (query % 5) / 8
    const native = tree.search(x, y, maxX, maxY)
    const packed = grid.search(x, y, maxX, maxY)
    expect(packed.slice().sort()).toEqual(native.slice().sort())
    expect(new Set(packed).size).toBe(packed.length)
  }
  const retained = grid.search(-1, -1, 1, 1)
  const retainedSnapshot = retained.slice()
  Object.assign(grid, { queryId: 0xffff_ffff })
  expect(grid.search(-1, -1, 1, 1).sort())
    .toEqual(tree.search(-1, -1, 1, 1).sort())
  expect(retained).toEqual(retainedSnapshot)
  for (const box of [[-0, -0, 0, 0], [-10, -10, 10, 10], [-11, -11, 11, 11],
    [1, 1, -1, -1], [-Infinity, -Infinity, Infinity, Infinity], [NaN, NaN, NaN, NaN]]) {
    const nativeCalls: number[] = []
    const packedCalls: number[] = []
    const native = tree.search(box[0]!, box[1]!, box[2]!, box[3]!, (id): boolean => {
      nativeCalls.push(id)
      return id % 3 === 0
    })
    const packed = grid.search(box[0]!, box[1]!, box[2]!, box[3]!, (id): boolean => {
      packedCalls.push(id)
      return id % 3 === 0
    })
    expect(packed).toEqual(native)
    expect(packedCalls).toEqual(nativeCalls)
  }
  expect(ClearanceCopperGridIndex.create(tree, { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 })).toBe(tree)
  expect(ClearanceCopperGridIndex.create(tree, { minX: 1, minY: 1, maxX: -1, maxY: -1 })).toBe(tree)
  expect(ClearanceCopperGridIndex.create(tree, { minX: NaN, minY: 0, maxX: 1, maxY: 1 })).toBe(tree)
  expect(ClearanceCopperGridIndex.create(tree, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0)).toBe(tree)
  const denseBoxes = new Flatbush(257)
  for (let id = 0; id < 257; id++) denseBoxes.add(-32, -32, 32, 32)
  denseBoxes.finish()
  expect(ClearanceCopperGridIndex.create(denseBoxes, { minX: -32, minY: -32, maxX: 32, maxY: 32 })).toBe(denseBoxes)
  const nonFinite = new Flatbush(1)
  nonFinite.add(NaN, 0, 1, 1)
  nonFinite.finish()
  expect(ClearanceCopperGridIndex.create(nonFinite, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBe(nonFinite)
  const outside = new Flatbush(1)
  outside.add(20, 20, 30, 30)
  outside.finish()
  const outsideGrid = ClearanceCopperGridIndex.create(outside, { minX: 0, minY: 0, maxX: 1, maxY: 1 })
  expect(outsideGrid.search(0, 0, 1, 1)).toEqual([])
  expect(outsideGrid.search(20, 20, 30, 30)).toEqual(outside.search(20, 20, 30, 30))
  const unindexed = new Flatbush(1)
  unindexed.add(0, 0, 1, 1)
  expect(() => ClearanceCopperGridIndex.create(unindexed, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toThrow("Data not yet indexed")
})
