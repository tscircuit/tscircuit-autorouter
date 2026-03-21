import { test, expect } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"
import { AssignableAutoroutingPipeline3 } from "lib/index"
import reproJson from "fixtures/bug-reports/bugreport01-be84eb/bugreport01-be84eb.json"

test.skip("bugreport01", () => {
  const solver = new AssignableAutoroutingPipeline3({
    ...(reproJson.simple_route_json as SimpleRouteJson),
    availableJumperTypes: ["1206x4"],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
