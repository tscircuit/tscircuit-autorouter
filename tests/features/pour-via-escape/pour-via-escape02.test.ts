import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../../fixtures/features/pour-via-escape/pour-via-escape02.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "pour-via-escape02.json",
  () => {
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

    const traces = solver.getOutputSimplifiedPcbTraces()
    const inner2Vias = traces.flatMap((trace) =>
      trace.route.filter(
        (segment): segment is Extract<typeof segment, { route_type: "via" }> =>
          segment.route_type === "via" && segment.to_layer === "inner2",
      ),
    )
    const pcbPort2 = { x: -2.15, y: -0.635 }
    const pcbPort14 = { x: 8.45, y: 0.5259644383800433 }

    expect(inner2Vias.some((segment) => distance(segment, pcbPort2) <= 1)).toBe(
      true,
    )
    expect(
      inner2Vias.some((segment) => distance(segment, pcbPort14) <= 1),
    ).toBe(true)

    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 180_000 },
)
