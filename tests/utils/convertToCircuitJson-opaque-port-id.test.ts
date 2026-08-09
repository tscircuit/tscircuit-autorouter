import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("uses trace endpoint metadata instead of pcb port ID prefixes", () => {
  const opaquePcbPortId = "opaque-port-reference"
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [],
  }
  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preloaded-trace",
    connection_name: "preloaded-connection",
    connectsTo: [opaquePcbPortId, "opaque-point-reference"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: opaquePcbPortId,
      },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }

  const circuitJson = convertToCircuitJson(srj, [preloadedTrace])
  const sourceTrace = circuitJson.find(
    (element) =>
      element.type === "source_trace" &&
      element.source_trace_id === "preloaded-connection",
  )

  expect(sourceTrace).toMatchObject({
    connected_source_port_ids: [opaquePcbPortId],
    connected_source_net_ids: ["opaque-point-reference"],
  })
})
