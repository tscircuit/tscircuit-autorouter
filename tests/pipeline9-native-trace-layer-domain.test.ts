import { expect, test } from "bun:test"
import { assertPreloadedTracesStayOnAllowedLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assertPreloadedTracesStayOnAllowedLayers"
import type { SimplifiedPcbTrace } from "lib/types"

test("final native copper keeps its signal layers while through vias may cross inner layers", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "data",
    connection_name: "data",
    allowedLayers: ["top", "bottom"],
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      { route_type: "via", x: 1, y: 0, from_layer: "top", to_layer: "bottom" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const input = { traces: [trace], preloadedTraces: [trace], layerCount: 4 }
  expect(() => assertPreloadedTracesStayOnAllowedLayers(input)).not.toThrow()
  const forbidden: SimplifiedPcbTrace = {
    ...trace,
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1" },
    ],
  }
  expect(() => assertPreloadedTracesStayOnAllowedLayers({ ...input, traces: [forbidden] })).toThrow("forbidden signal layer")
})
