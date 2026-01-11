import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import bugReport from "../../fixtures/bug-reports/bugreport36-d4c6c2/bugreport36-d4c6c2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import { HyperJumperPrepatternSolver2 } from "lib/solvers/JumperPrepatternSolver/HyperJumperPrepatternSolver2"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport36-d4c6c2",
  () => {
    const solver = new AssignableAutoroutingPipeline3(srj)

    while (solver.iterations < 1798) {
      solver.step()
    }

    const hyperJumperPrepatternSolver = solver.highDensitySolver!
      .activeSubSolver as HyperJumperPrepatternSolver2

    const jhd =
      hyperJumperPrepatternSolver.getSupervisedSolverWithBestFitness()?.solver!

    jhd.curvySolvers.forEach((curvySolver) => {
      console.log(curvySolver.solver.problem.obstacles)
    })

    solver.solve()
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 180_000 },
)
