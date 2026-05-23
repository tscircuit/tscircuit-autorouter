import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport60-fe53a2/bugreport60-fe53a2.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

const getPointKey = (point: { x: number; y: number }) =>
  `${point.x.toFixed(3)},${point.y.toFixed(3)}`

test("bugreport60-fe53a2.json uses the preplaced via in pipeline8", () => {
  const solver = new AutoroutingPipelineSolver8(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const preplacedViaKeys = new Set(
    srj.obstacles
      .filter((obstacle) => obstacle.netIsAssignable)
      .map((obstacle) => getPointKey(obstacle.center)),
  )
  expect(preplacedViaKeys.size).toBe(1)

  const routedVias = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) =>
      trace.route.filter((segment) => segment.route_type === "via"),
    )
  expect(routedVias.map(getPointKey)).toEqual([...preplacedViaKeys])

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 30_000)
