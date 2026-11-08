import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("terminal vias enter and leave the actual wire layer in traversal order", (): void => {
  for (const [z, layer] of [
    [0, "top"],
    [1, "inner1"],
    [3, "bottom"],
  ] as const) {
    const hdRoute: HighDensityIntraNodeRoute = {
      connectionName: "ground",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      route: [
        { x: 0, y: 0, z },
        { x: 1, y: 0, z },
      ],
      vias: [],
    }
    const points = [0, 1].map((x) => ({
      x,
      y: 0,
      layer: "top",
      terminalVia: {
        toLayer: "inner1",
        layers: ["top", "inner1", "inner2", "bottom"],
      },
    }))
    const route = convertHdRouteToSimplifiedRoute(hdRoute, 4, {
      connectionPoints: points,
      defaultViaHoleDiameter: 0.2,
    })
    const otherLayer = layer === "inner1" ? "top" : "inner1"
    expect(route[0]).toMatchObject({
      route_type: "via",
      from_layer: otherLayer,
      to_layer: layer,
      via_hole_diameter: 0.2,
    })
    expect(route.at(-1)).toMatchObject({
      route_type: "via",
      from_layer: layer,
      to_layer: otherLayer,
      via_hole_diameter: 0.2,
    })
    let currentLayer: string = otherLayer
    for (const point of route) {
      if (point.route_type === "wire") expect(point.layer).toBe(currentLayer)
      else if (point.route_type === "via") {
        expect(point.from_layer).toBe(currentLayer)
        currentLayer = point.to_layer
      }
    }
  }
})
