import { expect, test } from "bun:test"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("records existing terminal-via copper in both route directions without a new drill", (): void => {
  for (const points of [
    [
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
    [
      { x: 4, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
    ],
  ]) {
    const hdRoute: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.45,
      vias: [],
      route: points,
    }
    const route = convertHdRouteToSimplifiedRoute(hdRoute, 4, {
      connectionPoints: [
        { x: 0, y: 0, layers: ["top", "inner1"], pcb_port_id: "pad" },
        { x: 4, y: 0, layer: "inner1", pcb_port_id: "other" },
      ],
      obstacles: [
        {
          type: "rect",
          shape: "circle",
          center: { x: 0, y: 0 },
          width: 0.45,
          height: 0.45,
          layers: ["inner1"],
          connectedTo: ["pad", "signal"],
          circuitJsonMetadata: { pcb_via_id: "existing-via" },
        },
      ],
    })
    expect(route.filter((point) => point.route_type === "via")).toEqual([])
    expect(
      route.filter((point) => point.route_type === "through_obstacle"),
    ).toHaveLength(1)
    expect(
      route.filter(
        (point) => point.route_type === "wire" && point.layer === "top",
      ),
    ).toEqual([{ route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" }])
    expect(hdRoute.route).toEqual(points)
  }
})

test("a planned via occupies the same layers as an existing barrel and still requires a drill", () => {
  const hdRoute: HighDensityRoute = {
    connectionName: "GND",
    traceThickness: 0.15,
    viaDiameter: 0.45,
    vias: [{ x: 0, y: 0 }],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
  }
  for (const representsFutureVia of [true, false]) {
    const route = convertHdRouteToSimplifiedRoute(hdRoute, 4, {
      obstacles: [
        {
          type: "rect",
          layers: ["top", "inner1", "inner2", "bottom"],
          center: { x: 0, y: 0 },
          width: 0.45,
          height: 0.45,
          connectedTo: ["GND"],
          representsFutureVia,
        },
      ],
    })
    expect(route.filter((p) => p.route_type === "via")).toHaveLength(
      representsFutureVia ? 1 : 0,
    )
    expect(
      route.filter((p) => p.route_type === "through_obstacle"),
    ).toHaveLength(representsFutureVia ? 0 : 1)
  }
})
