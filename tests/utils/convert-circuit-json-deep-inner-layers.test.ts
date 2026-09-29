import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Circuit JSON conversion preserves copper beyond inner8", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 18,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 1 },
    obstacles: [],
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 10, y: 0, layer: "inner11" },
      ],
    }],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "deep-inner-route",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "inner11", via_diameter: 0.3 },
      { route_type: "wire", x: 0, y: 0, layer: "inner11", width: 0.1 },
      { route_type: "wire", x: 10, y: 0, layer: "inner11", width: 0.1 },
    ],
  }
  const circuitJson = convertToCircuitJson(srj, [trace])
  const outputTrace = circuitJson.find((element) => element.type === "pcb_trace")
  expect(outputTrace).toMatchObject({ route: [
    { route_type: "wire", layer: "top" },
    { route_type: "via", from_layer: "top", to_layer: "inner11" },
    { route_type: "wire", layer: "inner11" },
    { route_type: "wire", layer: "inner11" },
  ] })
  const via = circuitJson.find((element) => element.type === "pcb_via")
  expect(via).toBeDefined()
  expect((via as { layers: string[] }).layers).toContain("inner11")
})
