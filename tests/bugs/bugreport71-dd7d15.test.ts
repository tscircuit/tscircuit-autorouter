import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport71-dd7d15/bugreport71-dd7d15.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport71-dd7d15.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const hdRoutes = solver._getOutputHdRoutes()
  const vias = hdRoutes.flatMap((route) =>
    route.vias.map((via) => ({
      connectionName: route.connectionName,
      rootConnectionName: route.rootConnectionName,
      x: via.x,
      y: via.y,
    })),
  )
  const sourceNet3CenterClusterVias = vias.filter(
    (via) =>
      via.rootConnectionName === "source_trace_45__source_net_3" &&
      via.x > 1.4 &&
      via.x < 1.7 &&
      via.y > 2.2 &&
      via.y < 3.2,
  )

  expect(vias.length).toBeLessThanOrEqual(78)
  expect(sourceNet3CenterClusterVias).toHaveLength(2)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
