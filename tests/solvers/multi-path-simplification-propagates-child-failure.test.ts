import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { SingleSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("multi-path simplification reports an exhausted child without spinning", (): void => {
  const route: HighDensityRoute = {
    connectionName: "long_route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 5000, y: 0, z: 0 },
    ],
    vias: [],
  }
  const solver: MultiSimplifiedPathSolver = new MultiSimplifiedPathSolver({
    unsimplifiedHdRoutes: [route],
    obstacles: [],
  })
  solver.step()
  const child: SingleSimplifiedPathSolver | null = solver.activeSubSolver
  if (!child) throw new Error("Expected a path simplifier for the route")
  for (
    let iteration: number = 0;
    iteration <= child.MAX_ITERATIONS + 1 && !solver.failed;
    iteration++
  ) {
    solver.step()
  }

  expect(child.failed).toBeTrue()
  expect(child.error).toContain("ran out of iterations")
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  expect(solver.error).toBe(child.error)
  expect(solver.simplifiedHdRoutes).toEqual([])
})
