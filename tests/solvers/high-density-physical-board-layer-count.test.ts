import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { IntraNodePhysicalClearanceContext } from "lib/solvers/HighDensitySolver/IntraNodeSolver"

test("high-density physical input requires an explicit positive board layer count without changing the legacy default", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 4,
    minClearance: 0.1,
  })
  const physicalClearanceContext: IntraNodePhysicalClearanceContext = {
    traceClearanceIndex: index,
    viaClearanceIndex: index,
    canonicalNetIdByConnectionName: new Map(),
    solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
  }
  for (const layerCount of [
    undefined,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect((): void => {
      new HighDensitySolver({
        nodePortPoints: [],
        layerCount,
        physicalClearanceContext,
      })
    }).toThrow("requires the physical board layer count")
  }
  const physicalSolver = new HighDensitySolver({
    nodePortPoints: [],
    layerCount: 4,
    physicalClearanceContext,
  })
  expect(physicalSolver.layerCount).toBe(4)
  expect(physicalSolver.physicalClearanceContext).toBe(physicalClearanceContext)
  expect(new HighDensitySolver({ nodePortPoints: [] }).layerCount).toBe(2)
})
