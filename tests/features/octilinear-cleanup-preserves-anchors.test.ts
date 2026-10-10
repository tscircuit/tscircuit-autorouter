import { expect, test } from "bun:test"
import { getOctilinearCleanupCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getOctilinearCleanupCandidates"
import type { SimplifiedPcbTrace } from "lib/types"

test("octilinear cleanup preserves terminal, width and layer anchors", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "power-trace",
    connection_name: "power",
    route: [
      {
        route_type: "wire",
        x: -4,
        y: 0,
        width: 0.3,
        layer: "top",
        start_pcb_port_id: "start",
      },
      { route_type: "wire", x: -2, y: 2, width: 0.3, layer: "top" },
      { route_type: "wire", x: 0, y: 2.15, width: 0.3, layer: "top" },
      { route_type: "wire", x: 2, y: 2, width: 0.3, layer: "top" },
      {
        route_type: "wire",
        x: 4,
        y: 0,
        width: 0.3,
        layer: "top",
        end_pcb_port_id: "tap",
      },
      { route_type: "wire", x: 5, y: 0, width: 0.5, layer: "top" },
      {
        route_type: "via",
        x: 5,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.6,
      },
      { route_type: "wire", x: 5, y: 0, width: 0.5, layer: "bottom" },
      {
        route_type: "wire",
        x: 6,
        y: 0,
        width: 0.5,
        layer: "bottom",
        end_pcb_port_id: "end",
      },
    ],
  }
  const original = structuredClone(trace)
  const candidates = [...getOctilinearCleanupCandidates(trace, original)]
  expect(candidates.length).toBeGreaterThan(0)
  for (const candidate of candidates) {
    expect(candidate.route[0]).toEqual(trace.route[0])
    expect(candidate.route.slice(-5)).toEqual(trace.route.slice(-5))
    expect(candidate.route.length).toBeLessThan(trace.route.length)
  }
  expect(trace).toEqual(original)
})
