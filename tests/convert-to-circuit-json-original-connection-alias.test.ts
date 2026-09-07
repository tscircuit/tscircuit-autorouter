import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

test("Circuit JSON conversion resolves preloaded traces through original connections", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "PARENT_NET",
        pointsToConnect: [
          {
            x: -1,
            y: 0,
            layer: "top",
            pointId: "pcb_port_left",
            pcb_port_id: "pcb_port_left",
          },
          {
            x: 1,
            y: 0,
            layer: "top",
            pointId: "pcb_port_right",
            pcb_port_id: "pcb_port_right",
          },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "child_trace_1",
        connection_name: "CHILD_INTERNAL_NET",
        connectsTo: ["pcb_port_left", "pcb_port_right"],
        route: [
          {
            route_type: "wire",
            x: -1,
            y: 0,
            width: 0.15,
            layer: "top",
            start_pcb_port_id: "pcb_port_left",
          },
          {
            route_type: "wire",
            x: 1,
            y: 0,
            width: 0.15,
            layer: "top",
            end_pcb_port_id: "pcb_port_right",
          },
        ],
      },
    ],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...originalSrj,
    connections: [],
  }

  const circuitJson = convertToCircuitJson(
    srjWithPointPairs,
    originalSrj.traces!,
    {
      originalSrj,
      includeOriginalConnections: true,
    },
  )
  const pcbTrace = circuitJson.find(
    (element) =>
      element.type === "pcb_trace" && element.pcb_trace_id === "child_trace_1",
  )
  const sourceTrace = circuitJson.find(
    (element) =>
      element.type === "source_trace" &&
      element.source_trace_id === "PARENT_NET",
  )
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)

  expect(pcbTrace).toMatchObject({ source_trace_id: "PARENT_NET" })
  expect(sourceTrace).toBeDefined()
  expect(connMap.areIdsConnected("child_trace_1", "pcb_port_left")).toBeTrue()
})
