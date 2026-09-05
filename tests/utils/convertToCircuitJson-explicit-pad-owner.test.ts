import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("explicit pad ownership wins over a closer sibling port", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "nearby" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "owner" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["nearby", "owner"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad", pcb_port_id: "owner" },
      },
    ],
  }
  expect(
    convertToCircuitJson(srj, []).find((e) => e.type === "pcb_smtpad"),
  ).toMatchObject({ pcb_smtpad_id: "pad", pcb_port_id: "owner" })
})
