import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("terminal vias retain an exact wire endpoint after submillimeter rounding", (): void => {
  const hdRoute: HighDensityIntraNodeRoute = {
    connectionName: "ground",
    traceThickness: 0.08,
    viaDiameter: 0.45,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const route = convertHdRouteToSimplifiedRoute(hdRoute, 4, {
    connectionPoints: [-1, 1].map((x) => ({
      x,
      y: 0.0000522,
      layer: "top",
      terminalVia: { toLayer: "inner1", viaDiameter: 0.45 },
    })),
    defaultViaHoleDiameter: 0.3,
  })
  expect(route).toHaveLength(6)
  for (const [viaIndex, wireIndex] of [
    [0, 1],
    [5, 4],
  ]) {
    const via = route[viaIndex]!
    const wire = route[wireIndex]!
    expect(via.route_type).toBe("via")
    expect(wire.route_type).toBe("wire")
    if (via.route_type !== "via" || wire.route_type !== "wire") {
      throw new Error("Expected a terminal via and its adjacent wire")
    }
    expect(wire.x).toBe(via.x)
    expect(wire.y).toBe(via.y)
    expect(via.via_hole_diameter).toBe(0.3)
  }
  expect(route.slice(2, 4)).toEqual([
    { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.08 },
    { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.08 },
  ])
  expect(hdRoute.route.map((point) => point.y)).toEqual([0, 0])
})
