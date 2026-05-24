import { expect, test } from "bun:test"
import {
  createHighDensityRouteSolverForProblem,
  highDensityRouteSolverGridProblems,
} from "fixtures/features/highDensityRouteSolver/highDensityRouteSolver.fixture"

test("HighDensitySolver does not add an extra connection at the center", () => {
  const solver = createHighDensityRouteSolverForProblem(
    highDensityRouteSolverGridProblems[0],
  )

  solver.solve()

  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
