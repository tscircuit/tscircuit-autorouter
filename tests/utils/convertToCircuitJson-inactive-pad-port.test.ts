import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("same-net pads outside the active phase keep their physical port ownership", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -20, maxX: 20, minY: -5, maxY: 5 },
    connections: [
      {
        name: "ground",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "active_pad" },
          { x: 0, y: 0, layer: "top", pcb_port_id: "active_via" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -1, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["ground", "active_pad", "active_via", "inactive_pad"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "active",
          pcb_port_id: "active_pad",
        },
      },
      {
        type: "rect",
        center: { x: 10, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["ground", "active_pad", "active_via", "inactive_pad"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "inactive",
          pcb_port_id: "inactive_pad",
        },
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top", "bottom"],
        connectedTo: ["ground", "active_via"],
        circuitJsonMetadata: { pcb_via_id: "via" },
      },
    ],
  }
  const original = structuredClone(srj)
  const pads = convertToCircuitJson(srj, []).filter(
    (e) => e.type === "pcb_smtpad",
  )
  expect(pads.find((p) => p.pcb_smtpad_id === "active")?.pcb_port_id).toBe(
    "active_pad",
  )
  expect(pads.find((p) => p.pcb_smtpad_id === "inactive")?.pcb_port_id).toBe(
    "inactive_pad",
  )
  expect(pads.some((p) => p.pcb_port_id === "active_via")).toBeFalse()
  expect(srj).toEqual(original)
})
