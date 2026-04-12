import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../../fixtures/features/pour-via-escape/pour-via-escape03.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { getLastStepGraphicsObject } from "../../fixtures/getLastStepGraphicsObject"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("pour-via-escape03.json", () => {
  expect(srj.layerCount).toBe(4)
  expect(
    srj.obstacles.some(
      (obstacle) =>
        obstacle.isCopperPour &&
        obstacle.layers.includes("inner1") &&
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

  const output = solver.getOutputSimpleRouteJson()
  const forbiddenLayer = mapZToLayerName(1, srj.layerCount)
  const expectedBottomLayer = mapZToLayerName(
    srj.layerCount - 1,
    srj.layerCount,
  )

  expect(
    output.traces?.flatMap((trace) =>
      trace.route.filter(
        (segment) =>
          segment.route_type === "wire" && segment.layer === forbiddenLayer,
      ),
    ) ?? [],
  ).toHaveLength(0)

  expect(
    output.traces?.flatMap((trace) =>
      trace.route.filter(
        (segment) =>
          segment.route_type === "wire" &&
          segment.layer === expectedBottomLayer,
      ),
    ) ?? [],
  ).not.toHaveLength(0)

  const lastStepGraphics = getLastStepGraphicsObject(solver.visualize())

  expect(
    lastStepGraphics.lines?.filter((line) => line.layer === "z1") ?? [],
  ).toHaveLength(0)
  expect(
    lastStepGraphics.lines?.filter((line) => line.layer === "z3") ?? [],
  ).not.toHaveLength(0)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
