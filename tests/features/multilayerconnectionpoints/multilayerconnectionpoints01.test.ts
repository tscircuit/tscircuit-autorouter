import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"
import { simpleRouteJson } from "../../../examples/features/multilayerconnectionpoints/multilayerconnectionpoints01.fixture"

test("routes multilayer connection point with mixed layer obstacles", () => {
  const solver = new AutoroutingPipelineSolver(
    simpleRouteJson as SimpleRouteJson,
  )
  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
