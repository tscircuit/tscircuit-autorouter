import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"
import { simpleRouteJson } from "../../../examples/features/off-board-obstacles/off-board-assignable.fixture"

test("routes with assignable off-board obstacles between pads", () => {
  const solver = new AssignableAutoroutingPipeline1Solver(
    simpleRouteJson as SimpleRouteJson,
  )
  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
