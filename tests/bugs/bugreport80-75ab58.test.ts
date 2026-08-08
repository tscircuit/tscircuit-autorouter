import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport80-75ab58/bugreport80-75ab58.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport80 surfaces an untunable differential-pair route", () => {
  const solver = new AutoroutingPipelineSolver(srj)

  expect(() => solver.solve()).toThrow(
    'no same-layer straight segment can tune connection "source_trace_13"',
  )
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
})
