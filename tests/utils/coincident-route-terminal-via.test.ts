import { expect, test } from "bun:test"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("coincident route export retains an explicit terminal via hint", (): void => {
  const route = convertHdRouteToSimplifiedRoute(
    {
      connectionName: "direct",
      traceThickness: 0.1,
      viaDiameter: 0.6,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "a" },
        { x: 0, y: 0, z: 0, pcb_port_id: "b" },
      ],
      vias: [],
    },
    2,
    {
      connectionPoints: [
        { x: 0, y: 0, layer: "top", terminalVia: { toLayer: "bottom" } },
        { x: 0, y: 0, layer: "top" },
      ],
    },
  )
  expect(route).toContainEqual({
    route_type: "via",
    x: 0,
    y: 0,
    from_layer: "top",
    to_layer: "bottom",
    via_diameter: 0.6,
  })
})
