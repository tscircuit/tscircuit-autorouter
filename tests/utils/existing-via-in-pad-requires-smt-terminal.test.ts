import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getExistingViaInPadByPcbPortId } from "lib/utils/getExistingViaInPadByPcbPortId"

test("an ordinary plated-hole terminal does not opt into via-in-pad selection", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pad" }],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top", "bottom"],
        connectedTo: ["pad", "signal"],
        circuitJsonMetadata: { pcb_plated_hole_id: "through-hole" },
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.45,
        height: 0.45,
        layers: ["bottom"],
        connectedTo: ["pad", "signal"],
        circuitJsonMetadata: { pcb_via_id: "existing-via" },
      },
    ],
  }
  const original = structuredClone(srj)
  expect(getExistingViaInPadByPcbPortId(srj).size).toBe(0)
  expect(srj).toEqual(original)
})
