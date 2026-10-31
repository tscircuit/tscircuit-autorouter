import { expect, test } from "bun:test"
import { getPipeline9WitnessViaCertificate } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WitnessViaCertificate"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("pairwise multilayer terminal contacts cannot substitute for a single common component", () => {
  const original: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.1, bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, obstacles: [], connections: [{ name: "A", pointsToConnect: [{ x: 0, y: 0, layers: ["top", "inner1"] }, { x: 1, y: 0, layers: ["inner1", "bottom"] }, { x: 2, y: 0, layers: ["top", "bottom"] }] }] }
  const traces: SimplifiedPcbTrace[] = [["top", 0, 2], ["inner1", 0, 1], ["bottom", 1, 2]].map(([layer, start, end], index) => ({ type: "pcb_trace", pcb_trace_id: `trace-${index}`, connection_name: "A", route: [{ route_type: "wire", x: Number(start), y: 0, width: 0.1, layer: String(layer) }, { route_type: "wire", x: Number(end), y: 0, width: 0.1, layer: String(layer) }] }))
  const certificate = getPipeline9WitnessViaCertificate(original, original, traces)
  expect(certificate.status).toBe("UNKNOWN")
  expect(certificate.reasons).toContain("An original net's demanded terminals lack one common physical component")
})
