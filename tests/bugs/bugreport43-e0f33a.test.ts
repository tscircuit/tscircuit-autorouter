import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline3 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport43-e0f33a/bugreport43-e0f33a.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test.skip(
  "bugreport43-e0f33a",
  () => {
    const solver = new AssignableAutoroutingPipeline3({
      ...srj,
      availableJumperTypes: ["1206x4"],
    })
    solver.solve()
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 180_000 },
)
