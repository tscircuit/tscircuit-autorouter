import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("explicit simplified segments preserve hole omission, zero, key order and metadata identity", () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "signal",
    traceThickness: 0.2,
    viaDiameter: 0.5,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }

  for (const hole of [undefined, 0, 0.3]) {
    const simplified = convertHdRouteToSimplifiedRoute(route, 2, {
      defaultViaHoleDiameter: hole,
      connectionPoints: [
        { x: -1, y: 0, layer: "top", terminalVia: { toLayer: "bottom" } },
        { x: 1, y: 0, layer: "bottom", terminalVia: { toLayer: "top" } },
      ],
    })
    const vias = simplified.filter((segment) => segment.route_type === "via")
    expect(vias).toHaveLength(3)
    expect(vias.map((via) => [via.x, via.y])).toEqual([
      [-1, 0],
      [0, 0],
      [1, 0],
    ])

    for (const via of vias) {
      expect(Object.hasOwn(via, "via_hole_diameter")).toBe(hole !== undefined)
      expect(via.via_hole_diameter).toBe(hole)
      expect(Object.keys(via)).toEqual([
        "route_type",
        "x",
        "y",
        "from_layer",
        "to_layer",
        "via_diameter",
        ...(hole === undefined ? [] : ["via_hole_diameter"]),
      ])
    }
  }

  route.route[1]!.toNextSegmentType = "through_obstacle"
  const absent = convertHdRouteToSimplifiedRoute(route, 2).find(
    (segment) => segment.route_type === "through_obstacle",
  )!
  expect(Object.hasOwn(absent, "circuitJsonMetadata")).toBe(false)

  const metadata = { pcb_plated_hole_id: "hole-1" }
  route.route[1]!.toNextSegmentCircuitJsonMetadata = metadata
  const present = convertHdRouteToSimplifiedRoute(route, 2).find(
    (segment) => segment.route_type === "through_obstacle",
  )!
  expect(present.circuitJsonMetadata).toBe(metadata)
  expect(Object.keys(present)).toEqual([
    "route_type",
    "start",
    "end",
    "from_layer",
    "to_layer",
    "width",
    "circuitJsonMetadata",
  ])
})
