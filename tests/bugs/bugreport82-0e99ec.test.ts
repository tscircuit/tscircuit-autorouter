import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport82-0e99ec/bugreport82-0e99ec.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport82 rejects an unmatched HD-route layer transition", () => {
  const solver = new AutoroutingPipelineSolver(srj)

  expect(() => solver.solve()).toThrow(
    'HD route "source_net_8_mst3" must have exactly one via for each layer transition',
  )
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
})
