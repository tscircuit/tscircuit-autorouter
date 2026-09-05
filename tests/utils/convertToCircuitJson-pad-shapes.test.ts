import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("preserves rectangular and legacy oval plated copper instead of inferring circles from bounds", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: -1, y: 0 },
        width: 1,
        height: 1,
        connectedTo: [],
        circuitJsonMetadata: { pcb_plated_hole_id: "square" },
      },
      {
        type: "oval" as "rect",
        layers: ["top", "bottom"],
        center: { x: 1, y: 0 },
        width: 1,
        height: 2,
        connectedTo: [],
        circuitJsonMetadata: { pcb_plated_hole_id: "oval" },
      },
    ],
  }
  const elements = convertToCircuitJson(srj, [])
  expect(elements).toContainEqual(
    expect.objectContaining({
      pcb_plated_hole_id: "square",
      shape: "circular_hole_with_rect_pad",
      rect_pad_width: 1,
      rect_pad_height: 1,
    }),
  )
  expect(elements).toContainEqual(
    expect.objectContaining({
      pcb_plated_hole_id: "oval",
      shape: "oval",
      outer_width: 1,
      outer_height: 2,
    }),
  )
})
