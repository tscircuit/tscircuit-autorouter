import { expect, test } from "bun:test"
import {
  AssignableAutoroutingPipeline1Solver,
  AssignableAutoroutingPipeline2,
} from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport22-2a75ce/bugreport22-2a75ce.json" with {
  type: "json",
}
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("bugreport22 - singlelayer", () => {
  const solver = new AssignableAutoroutingPipeline2({
    ...(bugReport as SimpleRouteJson),
    layerCount: 1,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 60_000)
