import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../../fixtures/features/pour-via-escape/pour-via-escape06.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("pour-via-escape06.json", () => {
  expect(srj.layerCount).toBe(4)
  expect(
    srj.obstacles.some(
      (obstacle) =>
        obstacle.isCopperPour &&
        obstacle.layers.includes("bottom") &&
        obstacle.connectedTo.includes("source_net_0"),
    ),
  ).toBe(true)
  expect(
    srj.obstacles.some(
      (obstacle) =>
        obstacle.isCopperPour &&
        obstacle.layers.includes("inner2") &&
        obstacle.connectedTo.includes("source_net_1"),
    ),
  ).toBe(true)

  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const traces = solver.getOutputSimplifiedPcbTraces()
  const vias = traces.flatMap((trace) =>
    trace.route.filter(
      (segment): segment is Extract<typeof segment, { route_type: "via" }> =>
        segment.route_type === "via",
    ),
  )

  expect(vias.some((segment) => segment.to_layer === "bottom")).toBe(true)
  expect(vias.some((segment) => segment.to_layer === "inner2")).toBe(true)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
