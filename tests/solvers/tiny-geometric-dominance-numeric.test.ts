import { expect, test } from "bun:test"
import { geometricSourceDominates } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installGeometricRegionalDominance"

test("strict numerical certificates reject ties and preserve native ordered costs over wide magnitudes", (): void => {
  let seed = 1979, certified = 0
  const random = (): number => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 0x100000000 }
  const distance = (a: [number, number], b: [number, number], k: number): number => {
    const dx = a[0] - b[0], dy = a[1] - b[1]
    return Math.sqrt(dx * dx + dy * dy) * k
  }
  for (let i = 0; i < 20000; i++) {
    const scale = 2 ** Math.floor(random() * 800 - 400)
    const coords = 2 ** Math.floor(random() * 900 - 450)
    const u: [number, number] = [(random() - 0.5) * coords, (random() - 0.5) * coords]
    const v: [number, number] = [(random() - 0.5) * coords, (random() - 0.5) * coords]
    const w: [number, number] = [(random() - 0.5) * coords, (random() - 0.5) * coords]
    const m = Math.max(1, coords * 4 * scale)
    const sourceG = (random() - 0.5) * m, candidateG = sourceG + distance(u, v, scale) + random() * m
    const common = (random() - 0.5) * m, congestion = (random() - 0.5) * m, penalty = (random() - 0.5) * m
    if (geometricSourceDominates(sourceG, candidateG, u[0] - v[0], u[1] - v[1], scale, m)) {
      certified++
      const lowerU = (sourceG + congestion) + penalty + distance(u, w, scale)
      const lowerV = (candidateG + congestion) + penalty + distance(v, w, scale)
      const costU = ((sourceG + common) + congestion) + penalty + distance(u, w, scale)
      const costV = ((candidateG + common) + congestion) + penalty + distance(v, w, scale)
      expect(lowerU <= lowerV).toBeTrue()
      expect(costU <= costV).toBeTrue()
    }
    expect(geometricSourceDominates(sourceG, sourceG, 0, 0, scale, m)).toBeFalse()
  }
  expect(certified).toBeGreaterThan(1000)
  expect(geometricSourceDominates(0, 1, 0, 0, -1, 1)).toBeFalse()
  expect(geometricSourceDominates(0, 1, Infinity, 0, 1, 1)).toBeFalse()
  expect(geometricSourceDominates(0, 1, 0, 0, 1, Infinity)).toBeFalse()
  expect(geometricSourceDominates(0, 1, 0, 0, 1, Number.MAX_VALUE)).toBeFalse()
  // Native squared distances need not satisfy triangle inequality after
  // underflow: each short leg rounds to zero while the long leg is nonzero.
  const a = Math.sqrt(Number.MIN_VALUE) * 0.4, k = 1 / Math.sqrt(Number.MIN_VALUE)
  expect(Math.sqrt(a * a) * k).toBe(0)
  expect(Math.sqrt((2 * a) * (2 * a)) * k).toBe(1)
  expect(geometricSourceDominates(0, 0.5, a, 0, k, 4)).toBeFalse()
})
