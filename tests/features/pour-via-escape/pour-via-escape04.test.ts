import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { AutoroutingPipelineSolver7_MultiGraph as AutoroutingPipelineSolver } from "lib"
import bugReport from "../../../fixtures/features/pour-via-escape/pour-via-escape04.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("pour-via-escape04.json", () => {
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
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toHaveLength(0)

  const longSignalRoute = solver.exactGeometryDrcForceImproveSolver!
    .getOutput()
    .find((route) => route.startPcbPortId === "pcb_port_17")!
  const minimumStraightRunLength = 8
  expect(
    longSignalRoute.route.some((point, index) => {
      const previous = longSignalRoute.route[index - 1]
      if (!previous) return false
      return (
        point.z === previous.z &&
        point.y === previous.y &&
        Math.abs(point.x - previous.x) > minimumStraightRunLength
      )
    }),
  ).toBe(true)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
