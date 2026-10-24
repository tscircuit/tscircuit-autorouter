import { expect, test } from "bun:test"
import { regionalBlockLowerBound } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyRegionalBlockPruning"

test("bbox lower bound never exceeds native ordered arithmetic including subnormal, overflow, equality and signed zero", (): void => {
  const values = [-Number.MAX_VALUE, -1e150, -100, -1e-200, -Number.MIN_VALUE, -0, 0, Number.MIN_VALUE, 1e-200, 0.1, 100, 1e150, Number.MAX_VALUE]
  let comparisons = 0
  for (const x of values) for (const y of values) for (const a of values) for (const b of values) {
    const points = [{ x: a, y: b, penalty: -0.1 }, { x: b, y: a, penalty: 0.2 }]
    const block = { minX: Math.min(a, b), maxX: Math.max(a, b), minY: Math.min(a, b), maxY: Math.max(a, b), minPenalty: -0.1 }
    const bound = regionalBlockLowerBound(x, y, 0.731, 0.413, 0.05, block)
    for (const point of points) {
      const dx = x - point.x; const dy = y - point.y
      const native = 0.731 + 0.413 + point.penalty + Math.sqrt(dx * dx + dy * dy) * 0.05
      expect(Number.isNaN(bound) || Number.isNaN(native) || bound <= native).toBeTrue()
      comparisons++
    }
  }
  expect(comparisons).toBe(57122)
})
