import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport92-ee8c57/bugreport92-ee8c57.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test.failing(
  "bugreport92-ee8c57: routes the captured Game Boy parent board without creating a noncoincident layer transition",
  () => {
    const solver = new AutoroutingPipelineSolver(srj)

    try {
      solver.solve()
    } catch (error) {
      expect(error).toHaveProperty(
        "message",
        "CrossingViaReductionSolver found a layer transition without a via at route point 282",
      )
      expect(
        getSvgFromGraphicsObject(solver.visualize(), {
          backgroundColor: "white",
        }),
      ).toMatchSvgSnapshot(import.meta.path)
      throw error
    }
  },
)
