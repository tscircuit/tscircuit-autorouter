import { expect, test } from "bun:test"
import { ReverseCostToGoCache, type ReversePotentialGeometry } from "lib/solvers/HighDensitySolver/ReverseCostToGoCache"

test("reverse generations repair increases, decreases and blocked cells against an independent shortest-path oracle", () => {
  const diagnostics: Record<string, number> = {}
  const cache = new ReverseCostToGoCache(diagnostics)
  const columns = 7
  const rows = 3
  const count = columns * rows * 2
  const goals = new Uint8Array(count)
  goals[count - 1] = 1
  const geometry: ReversePotentialGeometry = {
    key: "delta-oracle", columns, rows, layers: [0, 2],
    bounds: { minX: 0, minY: 0, maxX: columns, maxY: rows },
    pitchX: 1, pitchY: 1, planarStepCost: 0.7, viaStepCost: 2.3, goals,
  }
  let firstGeneration = 0
  let firstValue = 0
  for (let generation = 0; generation < 24; generation++) {
    const planarCosts = Float64Array.from({ length: count }, (_, i) => ((i * 13 + generation * 7) % 11) / 3)
    const viaCosts = Float64Array.from({ length: count }, (_, i) => ((i * 3 + generation) % 7) / 5)
    const blocked = Uint8Array.from({ length: count }, (_, i) => i !== count - 1 && (i * 7 + generation) % 17 === 0 ? 1 : 0)
    const context = { signature: String(generation), planarCosts, viaCosts, blocked }
    const id = cache.prepare(geometry, context)
    expect(id).not.toBeNull()
    const reference = new Float64Array(count).fill(Infinity)
    reference[count - 1] = 0
    for (let pass = 0; pass < count; pass++) {
      for (let i = 0; i < count; i++) {
        if (blocked[i] || goals[i]) continue
        const plane = columns * rows
        const xy = i % plane
        const x = xy % columns
        const y = Math.floor(xy / columns)
        const layer = Math.floor(i / plane)
        for (let j = 0; j < count; j++) {
          if (blocked[j] && !goals[j]) continue
          const other = j % plane
          const dx = Math.abs(other % columns - x)
          const dy = Math.abs(Math.floor(other / columns) - y)
          const via = Math.floor(j / plane) !== layer && other === xy
          const planar = Math.floor(j / plane) === layer && Math.max(dx, dy) === 1
          if (!via && !planar) continue
          const edge = via ? 2.3 + viaCosts[j]! : 0.7 * (dx && dy ? Math.SQRT2 : 1) + planarCosts[j]!
          reference[i] = Math.min(reference[i]!, edge + reference[j]!)
        }
      }
    }
    for (let i = 0; i < count; i++) {
      const xy = i % (columns * rows)
      const actual = cache.estimate(id!, { x: xy % columns + 0.5, y: Math.floor(xy / columns) + 0.5, z: i < columns * rows ? 0 : 2 })
      expect(actual).toBeCloseTo(Number.isFinite(reference[i]) ? reference[i]! : 0, 9)
    }
    expect(cache.prepare(geometry, context)).toBe(id)
    if (generation === 0) {
      firstGeneration = id!
      firstValue = cache.estimate(id!, { x: 1.5, y: 0.5, z: 0 })
      planarCosts.fill(999)
      expect(cache.estimate(id!, { x: 1.5, y: 0.5, z: 0 })).toBe(firstValue)
    }
  }
  expect(cache.estimate(firstGeneration, { x: 1.5, y: 0.5, z: 0 })).toBe(firstValue)
  expect(diagnostics.reversePotentialRepairs).toBe(23)
  expect(diagnostics.reversePotentialCacheHits).toBe(24)
  expect(diagnostics.reversePotentialChangedCells).toBeGreaterThan(count)
})
