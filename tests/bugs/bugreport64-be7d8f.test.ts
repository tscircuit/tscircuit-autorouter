import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport64-be7d8f/bugreport64-be7d8f.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport64-be7d8f.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  const outputTrace = solver
    .getOutputSimpleRouteJson()
    .traces?.find((trace) => trace.connection_name === "source_trace_6")
  const sourceTrace6PadWidthLimit = Math.min(
    ...(srj.obstacles ?? [])
      .filter((obstacle) => obstacle.connectedTo.includes("source_trace_6"))
      .map((obstacle) => Math.min(obstacle.width, obstacle.height)),
  )

  expect(
    Math.max(
      ...(outputTrace?.route
        .filter((segment) => segment.route_type === "wire")
        .map((segment) => segment.width) ?? []),
    ),
  ).toBeLessThanOrEqual(sourceTrace6PadWidthLimit + 1e-6)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
