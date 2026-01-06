import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport02-bc4361/bugreport02-bc4361.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport2", () => {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj)

  // // solve until the high density route solver, take a snapshot of the
  // // visualization from the port point pathing solver
  // solver.solveUntilPhase("simpleHighDensityRouteSolver")

  // expect(
  //   getLastStepSvg(solver.portPointPathingSolver!.visualize()),
  // ).toMatchSvgSnapshot(import.meta.path, {
  //   svgName: "bugreport27-portPointPathingSolver",
  // })

  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
