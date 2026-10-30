import { expect, test } from "bun:test"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getPipeline9OriginalOwnerCopperFeedback, mergePipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"

test("one-member native self-short policy stays visible without being invented as a foreign copper pair", (): void => {
  const original: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.2,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [{ name: "A", pointsToConnect: [] }] }
  const route: SimplifiedPcbTrace["route"] = [[-1, -1], [1, 1], [-1, 1], [1, -1]].map(([x, y]) => ({ route_type: "wire", x: x!, y: y!, layer: "top", width: 0.2 }))
  const traces: SimplifiedPcbTrace[] = [{ type: "pcb_trace", pcb_trace_id: "trace_A", connection_name: "A", route }]
  const circuitJson = [{ type: "source_bus", source_bus_id: "matched", source_trace_ids: ["source_A"], max_length_skew: 1 },
    { type: "source_trace", source_trace_id: "source_A", connected_source_port_ids: [], name: "A" },
    { type: "pcb_trace", pcb_trace_id: "trace_A", source_trace_id: "source_A", route }] as unknown as AnyCircuitElement[]
  const native = checkEachPcbTraceNonOverlapping(circuitJson)
  expect(native).toHaveLength(1)
  expect(native[0]).toMatchObject({ pcb_trace_error_id: "self_short_trace_A" })
  const feedback = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: original, srjWithPointPairs: original, routedTraces: traces, circuitJson })
  expect(feedback.status).toBe("SUPPORTED")
  expect(feedback.errors).toEqual([])
  const merged = mergePipeline9OriginalOwnerCopperFeedback(native as unknown as Record<string, unknown>[], feedback.errors)
  expect(merged.errors).toEqual(native as unknown as Record<string, unknown>[])
  expect(merged.appendedCount).toBe(0)
})
