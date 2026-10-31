import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("keeps unrelated nets separate when pads overlap on different layers", () => {
  const layers = ["top", "bottom"] as const
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 1 },
    obstacles: layers.map((layer) => ({
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: [layer],
      connectedTo: [`net-${layer}`, `pcb_port_${layer}`],
    })),
    connections: layers.map((layer) => ({
      name: `net-${layer}`,
      pointsToConnect: [
        { x: 0, y: 0, layer, pcb_port_id: `pcb_port_${layer}` },
        { x: 1, y: 0, layer, pcb_port_id: `pcb_port_${layer}_end` },
      ],
    })),
  }
  const traces: SimplifiedPcbTrace[] = layers.map((layer) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace-${layer}`,
    connection_name: `net-${layer}`,
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer },
    ],
  }))

  const circuitJson = convertToCircuitJson(srj, traces)
  const connectivity = getFullConnectivityMapFromCircuitJson(circuitJson)
  expect(connectivity.areIdsConnected("net-top", "net-bottom")).toBe(false)
  expect(connectivity.areIdsConnected("trace-top", "pcb_port_top")).toBe(true)
  expect(connectivity.areIdsConnected("trace-bottom", "pcb_port_bottom")).toBe(
    true,
  )
})
