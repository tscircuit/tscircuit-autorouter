import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { createPcbPadElements } from "lib/utils/convertToCircuitJson"

test("only a centered fixed via provides a terminal's plated layer bridge", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 1 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pad" }],
      },
    ],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.45,
        height: 0.45,
        layers: ["inner1", "inner2", "bottom"],
        connectedTo: ["pad", "signal"],
        circuitJsonMetadata: { pcb_via_id: "centered-via" },
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 1, y: 0 },
        width: 0.45,
        height: 0.45,
        layers: ["inner1", "inner2", "bottom"],
        connectedTo: ["pad", "signal"],
        circuitJsonMetadata: { pcb_via_id: "offset-via" },
      },
    ],
  }
  const pads = createPcbPadElements(srj)
  expect(pads).toHaveLength(1)
  expect(pads[0]).toMatchObject({
    type: "pcb_plated_hole",
    pcb_plated_hole_id: "centered-via",
    pcb_port_id: "pad",
    layers: ["inner1", "inner2", "bottom"],
    outer_diameter: 0.45,
    hole_diameter: 0.15,
  })
})
