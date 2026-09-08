import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

const createSolver = (fixedObstacleGeometry?: boolean): SingleHighDensityRouteSolver =>
  new SingleHighDensityRouteSolver({
    connectionName: "route",
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 1 },
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    minDistBetweenEnteringPoints: 0.1,
    fixedObstacleGeometry,
    traceThickness: 0.05,
    obstacleMargin: 0.05,
    viaDiameter: 0.1,
    obstacleRoutes: [{
      connectionName: "obstacle", traceThickness: 0.05, viaDiameter: 0.1,
      route: [{ x: -1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }],
      vias: [{ x: 0.6, y: 0.8 }],
    }],
  })

const parent: Node = { x: 0, y: 0.8, z: 0, f: 0, g: 0, h: 0, parent: null }
const state = (solver: SingleHighDensityRouteSolver): unknown => {
  solver.exploredNodes.clear()
  return {
    neighbors: solver.getNeighbors(parent),
    explored: [...solver.exploredNodes],
  }
}

test("planar free cache invalidates live dimensions and rebuilds while public defaults retain mutable geometry", () => {
  for (const [property, value] of [
    ["traceThickness", 0.8], ["obstacleMargin", 0.8], ["viaDiameter", 1.6],
    ["traceThickness", NaN], ["obstacleMargin", -0.5], ["viaDiameter", Infinity],
  ] as const) {
    const candidate = createSolver(true)
    const reference = createSolver(false)
    expect(state(candidate)).toEqual(state(reference))
    expect(state(candidate)).toEqual(state(reference))
    candidate[property] = value
    reference[property] = value
    expect(state(candidate)).toEqual(state(reference))
  }
  for (const enabled of [undefined, false, true]) {
    const candidate = createSolver(enabled)
    const reference = createSolver(false)
    const before = state(candidate)
    expect(before).toEqual(state(reference))
    expect(state(candidate)).toEqual(state(reference))
    for (const solver of [candidate, reference]) {
      for (const point of solver.obstacleRoutes[0].route) point.y = 0.8
      // Enabled owners explicitly rebuild. The default API still observes
      // endpoint mutations within the existing broad-phase box directly.
      if (enabled) solver.buildObstacleIndexes()
    }
    const after = state(candidate)
    expect(after).toEqual(state(reference))
    expect(after).not.toEqual(before)
    if (!enabled) {
      expect((candidate as unknown as { planarFreeCache: unknown }).planarFreeCache).toBeUndefined()
    }
  }
  const bounded = createSolver(true)
  bounded.gridWidth = 1_000_000
  expect(() => state(bounded)).not.toThrow()
  expect((bounded as unknown as { planarFreeCache: unknown }).planarFreeCache).toBeNull()
})
