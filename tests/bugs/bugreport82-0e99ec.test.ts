import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import bugReport from "../../fixtures/bug-reports/bugreport82-0e99ec/bugreport82-0e99ec.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport82-0e99ec.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  let routingError: unknown

  try {
    solver.solve()
  } catch (error) {
    routingError = error
  }

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
  expect(routingError).toBeInstanceOf(Error)
  expect((routingError as Error).message).toBe(
    'PostProcessingSolver: HD route "source_net_8_mst3" must have exactly one via for each layer transition',
  )
  expect(solver.failed).toBe(true)
})
