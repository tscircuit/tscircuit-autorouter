import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("connects every merged root alias to the routed trace and its pads", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: [
          "pcb_smtpad_0",
          "pcb_port_0",
          "root_a",
          "endpoint_alias_a",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_1", "pcb_port_1", "root_b"],
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["bottom_only_alias"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -0.6, y: -0.6 },
        width: 2,
        height: 0.2,
        ccwRotationDegrees: 45,
        connectedTo: ["rotated_endpoint_alias"],
      },
    ],
    connections: [
      {
        name: "root_a",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "root_b",
        pointsToConnect: [
          { x: 1, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
        ],
      },
    ],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...originalSrj,
    connections: [
      {
        name: "merged_mst0",
        __rootConnectionNames: ["root_a", "root_b"],
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "pcb_trace_0",
      connection_name: "merged_mst0",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]

  const circuitJson = convertToCircuitJson(srjWithPointPairs, traces, {
    minTraceWidth: originalSrj.minTraceWidth,
    originalSrj,
  })
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)

  expect(connMap.areIdsConnected("root_a", "root_b")).toBe(true)
  expect(connMap.areIdsConnected("root_b", "pcb_trace_0")).toBe(true)
  expect(connMap.areIdsConnected("root_b", "pcb_smtpad_0")).toBe(true)
  expect(connMap.areIdsConnected("root_a", "pcb_smtpad_1")).toBe(true)
  expect(connMap.areIdsConnected("root_b", "endpoint_alias_a")).toBe(true)
  expect(connMap.areIdsConnected("root_b", "rotated_endpoint_alias")).toBe(true)
  expect(connMap.areIdsConnected("root_a", "bottom_only_alias")).toBe(false)
})
