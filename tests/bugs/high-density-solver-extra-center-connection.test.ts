import { expect, test } from "bun:test"
import {
  createHighDensityRouteSolverForProblem,
  highDensityRouteSolverGridProblems,
} from "fixtures/features/highDensityRouteSolver/highDensityRouteSolver.fixture"

test("HighDensitySolver does not add an extra connection at the center", () => {
  const problemDef = highDensityRouteSolverGridProblems[0]
  const solver = createHighDensityRouteSolverForProblem(problemDef)

  solver.solve()

  expect(solver.hdSolver.routes).toHaveLength(2)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
