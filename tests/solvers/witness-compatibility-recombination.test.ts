import { expect, test } from "bun:test"
import { witnessCatalog, witnessCharge, witnessRoute } from "./witnessCompatibilityTestUtils"

test("route-choice master recombines immutable alternatives from incompatible contexts and reuses exact pair clauses", () => {
  const a = witnessRoute("a", [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])
  const b = witnessRoute("b", [{ x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }])
  const c = witnessRoute("c", [{ x: -2, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }])
  const aLayered = witnessRoute("a", [
    { x: -2, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: -1, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  ])
  const bLayered = witnessRoute("b", [
    { x: 0, y: -2, z: 0 }, { x: 0, y: -1.5, z: 0 }, { x: 0, y: -1.5, z: 1 },
    { x: 0, y: 1.5, z: 1 }, { x: 0, y: 1.5, z: 0 }, { x: 0, y: 2, z: 0 },
  ])
  const catalog = witnessCatalog([a, b, c])
  const firstContext = {}, secondContext = {}
  const originalA = catalog.add(0, a, witnessCharge, firstContext)
  const originalB = catalog.add(1, b, witnessCharge, firstContext)
  catalog.add(2, c, witnessCharge, firstContext)
  expect(catalog.select(witnessCharge)).toBeNull()
  catalog.add(0, aLayered, witnessCharge, secondContext)
  catalog.add(1, bLayered, witnessCharge, secondContext)
  const selected = catalog.select(witnessCharge)
  expect(selected).not.toBeNull()
  expect(selected!.map((w) => w.task)).toEqual([0, 1, 2])
  expect(selected![0]).toBe(originalA)
  expect(selected![1]).not.toBe(originalB)
  expect(new Set(selected!.map((w) => w.contextId)).size).toBe(2)
  for (let i = 0; i < selected!.length; i++)
    for (let j = i + 1; j < selected!.length; j++)
      expect(catalog.conflict(selected![i], selected![j], witnessCharge)).toBe(false)
  expect(catalog.conflict(originalA, originalB, witnessCharge)).toBe(true)
  const evaluations = catalog.stats.witnessCompatibilityPairEvaluations
  expect(catalog.conflict(originalA, originalB, witnessCharge)).toBe(true)
  expect(catalog.stats.witnessCompatibilityPairEvaluations).toBe(evaluations)
  expect(catalog.stats.witnessCompatibilityPairCacheHits).toBeGreaterThan(0)
  expect(catalog.stats.witnessCompatibilityLearnedPairExclusions).toBeGreaterThan(0)
  a.route[0]!.x = 99
  expect(originalA.route.route[0]!.x).toBe(-2)
  expect(Object.isFrozen(originalA.route.route)).toBe(true)
})
