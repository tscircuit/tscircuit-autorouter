import { expect, test } from "bun:test"
import type { SimpleRouteConnection, SimplifiedPcbTraces } from "lib/types"
import { getMaxViaCountViolation } from "lib/utils/get-max-via-count-violation"

test("a via on an adjacent merged branch does not count against the original trace", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "NO_VIAS",
      maxViaCount: 0,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "A" },
        { x: 1, y: 0, layer: "top", pointId: "J" },
      ],
    },
    {
      name: "ONE_VIA_ALLOWED",
      maxViaCount: 1,
      pointsToConnect: [
        { x: 1, y: 0, layer: "top", pointId: "J" },
        { x: 2, y: 0, layer: "bottom", pointId: "B" },
      ],
    },
  ]
  const routedConnections: SimpleRouteConnection[] = [
    {
      name: "NO_VIAS__ONE_VIA_ALLOWED_mst0",
      __rootConnectionNames: ["NO_VIAS", "ONE_VIA_ALLOWED"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "A" },
        { x: 1, y: 0, layer: "top", pointId: "J" },
      ],
    },
    {
      name: "NO_VIAS__ONE_VIA_ALLOWED_mst1",
      __rootConnectionNames: ["NO_VIAS", "ONE_VIA_ALLOWED"],
      pointsToConnect: [
        { x: 1, y: 0, layer: "top", pointId: "J" },
        { x: 2, y: 0, layer: "bottom", pointId: "B" },
      ],
    },
  ]
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "NO_VIAS__ONE_VIA_ALLOWED_mst0_0",
      connection_name: "NO_VIAS",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "NO_VIAS__ONE_VIA_ALLOWED_mst1_0",
      connection_name: "NO_VIAS",
      route: [
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 1.5,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]

  expect(
    getMaxViaCountViolation({ connections, routedConnections, traces }),
  ).toBeNull()
})
