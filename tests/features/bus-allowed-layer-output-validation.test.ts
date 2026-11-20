import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "lib/types"
import { assertRoutesStayOnAllowedLayers } from "lib/utils/assertRoutesStayOnAllowedLayers"

test("bus layer validation permits through-vias but rejects inner-layer wires", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace",
    connection_name: "data",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "inner1", "inner2", "bottom"],
      },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const constraints = {
    allowedLayersByConnection: new Map([["data", new Set([0, 3])]]),
    layerCount: 4,
  }
  expect(() => assertRoutesStayOnAllowedLayers([trace], constraints)).not.toThrow()
  trace.route = [
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
    { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1" },
  ]
  expect(() => assertRoutesStayOnAllowedLayers([trace], constraints)).toThrow(
    'Connection "data" routed wire on forbidden bus layer "inner1"',
  )
  trace.connection_name = "unrestricted"
  expect(() => assertRoutesStayOnAllowedLayers([trace], constraints)).not.toThrow()
})
