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

test("packed cells retain ordered candidates when grids are rebuilt after moves and layer changes", () => {
  let state = 9182
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  let comparisons = 0
  for (const count of [0, 1, 31, 32, 33, 127, 513]) {
    const initialItems = Array.from({ length: count }, (): Bounds => {
      const x = random() * 40 - 20
      const y = random() * 40 - 20
      return { minX: x, minY: y, maxX: x + random() * 3, maxY: y + random() * 3 }
    })
    const movedItems = initialItems.map((bounds, index): Bounds => ({
      minX: bounds.minX + index % 3 - 1,
      minY: bounds.minY - index % 2,
      maxX: bounds.maxX + index % 3 - 1,
      maxY: bounds.maxY - index % 2,
    }))
    const remainingLayerItems = movedItems.filter((_, index) => index % 2 === 0)
    for (const items of [initialItems, movedItems, remainingLayerItems, []]) {
      for (const cellSize of [0.5, 2, 10]) {
        const generic = createSpatialIndex(items, (item) => item, cellSize)
        const packed = createPackedSpatialIndex(items, (item) => item, cellSize)
        for (let query = 0; query < 12; query++) {
          const x = random() * 50 - 25
          const y = random() * 50 - 25
          const bounds = { minX: x, minY: y, maxX: x + random() * 12, maxY: y + random() * 12 }
          expect(getPackedSpatialCandidateIndexes(packed, bounds, cellSize))
            .toEqual(getSpatialCandidateIndexes(generic, bounds, cellSize))
          comparisons += 1
        }
        packed.generation = 0xffffffff
        const whole = { minX: -30, minY: -30, maxX: 30, maxY: 30 }
        expect(getPackedSpatialCandidateIndexes(packed, whole, cellSize))
          .toEqual(getSpatialCandidateIndexes(generic, whole, cellSize))
      }
    }
  }
  expect(comparisons).toBe(1008)
})
