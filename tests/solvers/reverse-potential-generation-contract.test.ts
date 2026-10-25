import { expect, test } from "bun:test"
import { ReverseCostToGoCache, type ReversePotentialGeometry } from "lib/solvers/HighDensitySolver/ReverseCostToGoCache"

test("goal keys, expired generations and repair quotas never expose a field for a different context", () => {
  const diagnostics: Record<string, number> = {}
  const cache = new ReverseCostToGoCache(diagnostics, 8000)
  const geometry: ReversePotentialGeometry = {
    key: "same-caller-key", columns: 5, rows: 1, layers: [0],
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 1 },
    pitchX: 1, pitchY: 1, planarXCosts: [0], planarYCosts: [0], planarStepCost: 1, viaStepCost: 3,
    goals: Uint8Array.from([0, 0, 0, 0, 1]),
  }
  const context = { signature: "same-ancestor", planarCosts: new Float64Array(5), viaCosts: new Float64Array(5), blocked: new Uint8Array(5) }
  const rightGoal = cache.prepare(geometry, context)!
  expect(cache.estimate(rightGoal, { x: 0.1, y: 0.5, z: 0 })).toBe(4)
  geometry.goals[0] = 1
  geometry.goals[4] = 0
  const leftGoal = cache.prepare(geometry, context)!
  expect(leftGoal).not.toBe(rightGoal)
  expect(cache.estimate(leftGoal, { x: 0.1, y: 0.5, z: 0 })).toBe(0)
  expect(cache.estimate(rightGoal, { x: 0.1, y: 0.5, z: 0 })).toBe(4)
  expect(() => cache.prepare(geometry, { ...context, planarCosts: new Float64Array(0) })).toThrow("graph")
  expect(() => cache.prepare(geometry, { ...context, planarCosts: new Float64Array(5).fill(1) })).toThrow("different costs")
  for (let i = 0; i < 20; i++) cache.prepare(geometry, { ...context, signature: `ancestor-${i}`, planarCosts: new Float64Array(5).fill(i) })
  expect(cache.memoryBytes).toBeLessThanOrEqual(8000)
  expect(cache.estimate(rightGoal, { x: 0.1, y: 0.5, z: 0 })).toBe(0)
  expect(diagnostics.reversePotentialEvictions).toBeGreaterThan(0)
  const limited = new ReverseCostToGoCache(diagnostics, 8000, 1)
  expect(limited.prepare(geometry, context)).toBeNull()
  expect(limited.memoryBytes).toBe(0)
  expect(diagnostics.reversePotentialWorkBypasses).toBeGreaterThan(0)
  expect(() => cache.prepare(geometry, { ...context, signature: "broken", viaCosts: new Float64Array(5).fill(-1) })).toThrow("edge cost")
})
