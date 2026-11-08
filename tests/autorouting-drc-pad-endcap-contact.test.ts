import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

test("pad contact uses the incoming copper width and a round endpoint cap", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 5, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.02,
    obstacles: [0, 4].map((x, index) => ({
      type: "rect",
      center: { x, y: 0 },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [`pcb_port_${index}`, `pcb_smtpad_${index}`],
    })),
    connections: [
      {
        name: "net",
        pointsToConnect: [0, 4].map((x, index) => ({
          x,
          y: 0,
          layer: "top",
          pcb_port_id: `pcb_port_${index}`,
        })),
      },
    ],
  }
  for (const [x, y, incomingWidth, finalWidth, errors] of [
    [3.46, 0, 0.1, 0.001, 0],
    [3.46, 0, 0.02, 1, 1],
    [3.47, 0.53, 0.1, 0.1, 0],
    [3.46, 0.54, 0.1, 0.1, 1],
  ] as const) {
    const trace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "endcap",
      connection_name: "net",
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: incomingWidth },
        { route_type: "wire", x, y, layer: "top", width: finalWidth },
      ],
    }
    expect(
      checkTraceContinuity(convertToCircuitJson(srj, [trace])),
    ).toHaveLength(errors)
  }
})
