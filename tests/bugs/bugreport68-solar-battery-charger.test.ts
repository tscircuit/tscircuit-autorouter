import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport68-solar-battery-charger/bugreport68-solar-battery-charger.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const simpleRouteJson = srj as SimpleRouteJson

test("bugreport68-solar-battery-charger.srj.json", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(simpleRouteJson)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
