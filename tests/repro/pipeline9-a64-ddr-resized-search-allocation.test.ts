import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { loadA64DdrResizedSearch } from "../fixtures/loadA64DdrResizedSearch"

test.failing("the real A64 DDR retry solves without allocating uniform enlarged grids", (): void => {
  const params = loadA64DdrResizedSearch()
  const solver = new GrowShrinkHighDensityIntraNodeSolver(params)
  const inspected = new Set<object>()
  while (!solver.solved && !solver.failed) {
    solver.step()
    if (solver.scaleFactor <= 1) continue
    const portfolio = solver.activeSubSolver
    for (const candidate of portfolio?.supervisedSolvers ?? []) {
      if (!candidate.hyperParameters.HIGH_DENSITY_A01) continue
      if (inspected.has(candidate.solver)) continue
      // Read the real allocated grid in both the legacy and replacement backend.
      const grid = candidate.solver as unknown as {
        gridStats?: { states: number }
        usedCellsFlat?: Int32Array
      }
      const states = grid.gridStats?.states ?? grid.usedCellsFlat?.length
      if (!states) continue
      inspected.add(candidate.solver)
      const node = portfolio!.nodeWithPortPoints
      const uniformStates =
        (Math.ceil(node.width / 0.1) + 1) *
        (Math.ceil(node.height / 0.1) + 1) *
        node.availableZ!.length
      expect(states).toBeLessThan(uniformStates / 2)
    }
  }
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.growthAttempts).toBeGreaterThan(0)
  expect(solver.solvedRoutes).toHaveLength(19)
  expect(new Set(solver.solvedRoutes.map((route) => route.connectionName))).toEqual(
    new Set(params.nodeWithPortPoints.portPoints.map((port) => port.connectionName)),
  )
  for (const route of solver.solvedRoutes) {
    expect(route.traceThickness).toBe(params.traceWidth)
    expect(route.viaDiameter).toBe(params.viaDiameter)
    for (const endpoint of [route.route[0]!, route.route.at(-1)!]) {
      expect(params.nodeWithPortPoints.portPoints.some((port) =>
        port.connectionName === route.connectionName &&
        port.z === endpoint.z &&
        Math.hypot(port.x - endpoint.x, port.y - endpoint.y) < 1e-8,
      )).toBeTrue()
    }
  }
})
