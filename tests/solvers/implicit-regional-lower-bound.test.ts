import { expect, test } from "bun:test"
import { implicitRegionalLowerBound } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installImplicitRegionalTransitions"

test("componentwise geometric bounds preserve native addition order including amplified subnormals and overflow", (): void => {
  let state = 19937
  const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const magnitudes = [0, Number.MIN_VALUE, Math.sqrt(Number.MIN_VALUE), 1e-100, 1e-10, 1, 1e10, 1e100, Math.sqrt(Number.MAX_VALUE), 1e300]
  for (let trial = 0; trial < 30000; trial++) {
    const magnitude = magnitudes[trial % magnitudes.length]!
    const x = (random() - 0.5) * magnitude, y = (random() - 0.5) * magnitude
    const exits = Array.from({ length: 5 }, (): {x: number; y: number; penalty: number; h: number} => ({
      x: (random() - 0.5) * magnitude, y: (random() - 0.5) * magnitude,
      penalty: random() * 11, h: random() * 13,
    }))
    const node = {
      minX: Math.min(...exits.map(p => p.x)), maxX: Math.max(...exits.map(p => p.x)),
      minY: Math.min(...exits.map(p => p.y)), maxY: Math.max(...exits.map(p => p.y)),
      minPenalty: Math.min(...exits.map(p => p.penalty)), minH: Math.min(...exits.map(p => p.h)),
    }
    const g = random() * 7, delta = random() * 19, congestion = random()
    const scale = trial % 3 === 0 ? 1 / Math.sqrt(Number.MIN_VALUE) : 0.05
    const bound = implicitRegionalLowerBound(g, x, y, delta, congestion, scale, node)
    for (const p of exits) {
      const dx = x - p.x, dy = y - p.y
      const leaf = g + delta + congestion + p.penalty + Math.sqrt(dx * dx + dy * dy) * scale + p.h
      expect(bound <= leaf).toBe(true)
    }
  }
})
