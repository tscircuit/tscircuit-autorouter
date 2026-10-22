import { expect } from "bun:test"
import type {
  HighDensityForceImproveSolver,
} from "high-density-repair01/lib/HighDensityForceImproveSolver"

export function expectHighDensityForceImproveState(
  actual: HighDensityForceImproveSolver,
  expected: HighDensityForceImproveSolver,
): void {
  expect(actual.getOutput()).toStrictEqual(expected.getOutput())
  expect([...actual.improvedRoutesByIndex]).toStrictEqual([
    ...expected.improvedRoutesByIndex,
  ])
  expect(actual.sampleEntries).toStrictEqual(expected.sampleEntries)
  expect(actual.originalHdRoutes).toStrictEqual(expected.originalHdRoutes)
  expect(actual.originalNodeWithPortPoints).toStrictEqual(
    expected.originalNodeWithPortPoints,
  )
  expect(actual.getConstructorParams()).toStrictEqual(
    expected.getConstructorParams(),
  )
  expect(actual.stats).toStrictEqual(expected.stats)
  expect(actual.activeSampleIndex).toBe(expected.activeSampleIndex)
  expect(actual.iterations).toBe(expected.iterations)
  expect(actual.MAX_ITERATIONS).toBe(expected.MAX_ITERATIONS)
  expect(actual.progress).toBe(expected.progress)
  expect(actual.solved).toBe(expected.solved)
  expect(actual.failed).toBe(expected.failed)
  expect(actual.error).toBe(expected.error)
  expect(actual.getSolverName()).toBe(expected.getSolverName())
  expect(actual.latestVisualization).toStrictEqual(expected.latestVisualization)
  expect(actual.visualize()).toStrictEqual(expected.visualize())
}
