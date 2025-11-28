import { expect, test } from "bun:test"
import { AssignableViaAutoroutingPipelineSolver } from "lib/solvers/AssignableViaAutoroutingPipeline/AssignableViaAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"
import { simpleRouteJson } from "../../../examples/features/off-board-obstacles/off-board-assignable.fixture"

test("routes with assignable off-board obstacles between pads", () => {
  const solver = new AssignableViaAutoroutingPipelineSolver(
    simpleRouteJson as SimpleRouteJson,
  )
  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
