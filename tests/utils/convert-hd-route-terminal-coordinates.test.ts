import { expect, test } from "bun:test"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("output conversion preserves exact terminal coordinates within routing tolerance", () => {
  const exactStart = {
    x: 0.123340833333333,
    y: 0,
    layer: "top",
    pointId: "pcb_breakout_point_0",
  }
  const exactEnd = {
    x: 30.983340833333333,
    y: -4.5680968,
    layer: "top",
    pointId: "pcb_breakout_point_1",
  }
  const route = convertHdRouteToSimplifiedRoute(
    {
      connectionName: "breakout_connection",
      route: [
        { x: 0.123, y: 0, z: 0 },
        { x: 30.983, y: -4.568, z: 0 },
      ],
      vias: [],
      jumpers: [],
      traceThickness: 0.15,
      viaDiameter: 0.6,
    },
    2,
    { connectionPoints: [exactStart, exactEnd] },
  )
  const wires = route.filter((point) => point.route_type === "wire")

  expect(wires[0]).toMatchObject({ x: exactStart.x, y: exactStart.y })
  expect(wires.at(-1)).toMatchObject({ x: exactEnd.x, y: exactEnd.y })
})
