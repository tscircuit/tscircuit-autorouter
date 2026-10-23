import { expect, test } from "bun:test"
import { indexElectricalTreeRepairPrimitives } from "lib/solvers/SharedElectricalTreeClearanceSolver/indexElectricalTreeRepairPrimitives"

test("primitive reduction preserves emitted variants and wire-site obligations that no rule-equivalent cap covers", (): void => {
  const a = { id: 0, x: 0, y: 0 }, b = { id: 1, x: 1, y: 0 }
  const physical = { kind: "physical" as const, sourceRouteIndex: 0, sourceSegmentIndex: 0, reversed: false }
  const base = { a, b, minZ: 0, maxZ: 0, net: "net", radius: 0.1, via: false, sourceIdentity: physical }
  const result = indexElectricalTreeRepairPrimitives([base, { ...base, a: b, b: a, radius: 0.3, sourceIdentity: { ...physical, reversed: true } }, { ...base }])
  expect(result.primitives.map((primitive) => primitive.radius)).toEqual([0.1, 0.3])
  expect(result.stats.treePrimitiveMultipleVariantSources).toBe(1)
  expect(result.stats.treePrimitiveMergedSourceReferences).toBe(1)
  const seam = { ...base, a, b: a, sourceIdentity: { kind: "adapter-seam" as const } }
  for (const cover of [
    { ...base, b: a, via: true, maxZ: 1, radius: 0.3 },
    { ...base, minZ: 1, maxZ: 1, radius: 0.3 },
    { ...base, net: "foreign", radius: 0.3 },
    { ...base, radius: 0.05 },
  ]) {
    const indexed = indexElectricalTreeRepairPrimitives([cover, seam, { ...seam }])
    expect(indexed.stats.treePrimitiveCoveredSeams).toBe(0)
    expect(indexed.stats.treePrimitiveRetainedWireSites).toBe(1)
    expect(indexed.stats.treePrimitiveMergedWireSiteReferences).toBe(1)
    expect(indexed.primitives).toHaveLength(2)
  }
  // Equal disk support from a via does not dominate a wire-class rule:
  // at distance.25, radii.05+.05, traceGap.2 rejects while viaGap.1 accepts.
  expect(0.25).toBeLessThan(0.05 + 0.05 + 0.2)
  expect(0.25).toBeGreaterThanOrEqual(0.05 + 0.05 + 0.1)
  expect(indexElectricalTreeRepairPrimitives([base, seam]).stats.treePrimitiveCoveredSeams).toBe(1)
  expect(() => indexElectricalTreeRepairPrimitives([base, { ...base, net: "foreign" }])).toThrow("contradictory ownership")
  expect(() => indexElectricalTreeRepairPrimitives([{ ...base, via: true, maxZ: 1 }])).toThrow("diagonal active via")
})
