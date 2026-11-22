import { expect, test } from "bun:test"
import { widenClearInteriorSegments } from "lib/solvers/TraceWidthSolver/widenClearInteriorSegments"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("keeps existing widths and contacts around typed copper", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: 20 }, (_, x) => ({ x, y: 0, z: 0 })),
  }
  route.route[3]!.terminalApproach = "start"
  route.route[7]!.toNextSegmentType = "through_obstacle"
  route.route[7]!.toNextSegmentCircuitJsonMetadata = {
    pcb_smtpad_id: "pad",
  }
  route.route[11]!.insideJumperPad = true
  route.route[14]!.pcb_port_id = "middle"
  const params = { route, nominalWidth: 0.2, hasClearance: () => true }
  const refined = widenClearInteriorSegments(params)
  expect(refined).not.toBe(route)
  for (const index of [0, 3, 7, 8, 11, 14, 19]) {
    expect(refined.route[index]).toEqual({
      ...route.route[index],
      traceThickness: 0.1,
    })
  }
  for (const width of [0.08, 0.25]) {
    const tapered = {
      ...route,
      route: route.route.map((point, index) =>
        index === 2 ? { ...point, traceThickness: width } : point,
      ),
    }
    expect(widenClearInteriorSegments({ ...params, route: tapered })).toBe(
      tapered,
    )
  }
})
