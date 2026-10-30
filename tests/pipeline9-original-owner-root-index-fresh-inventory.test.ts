import { expect, test } from "bun:test"
import { checkPipeline9SelectedOriginalIntentCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9OriginalIntentCopper"

test("each selected copper invocation observes current original declarations after an earlier owner index was resolved", (): void => {
  const original = { layerCount: 2, connections: [{ name: "declared-A", pointsToConnect: [{ pcb_port_id: "port-A" }] }], obstacles: [] }
  const input = { original, pointPairs: { connections: [] }, traces: [{ pcb_trace_id: "trace-A", connection_name: "declared-A" }],
    circuitJson: [{ type: "pcb_trace", pcb_trace_id: "trace-A", route: [
      { route_type: "wire", layer: "top", x: 0, y: 0, width: 0.1 },
      { route_type: "wire", layer: "top", x: 1, y: 0, width: 0.1 },
    ] }] }
  const predicates = { viaTrace: (): [] => [], traceOverlap: (): [] => [] }
  const first = checkPipeline9SelectedOriginalIntentCopper(input, predicates)
  expect(first.ownershipCoverageStatus).toBe("COMPLETE")
  expect(first.traceOwners[0].anchors).toEqual(["0:declared-A"])
  original.connections[0].name = "declared-B"
  const missing = checkPipeline9SelectedOriginalIntentCopper(input, predicates)
  expect(missing.ownershipCoverageStatus).toBe("UNKNOWN")
  expect(missing.unknownTraceCount).toBe(1)
  input.traces[0].connection_name = "declared-B"
  const restored = checkPipeline9SelectedOriginalIntentCopper(input, predicates)
  expect(restored.ownershipCoverageStatus).toBe("COMPLETE")
  expect(restored.traceOwners[0].anchors).toEqual(["0:declared-B"])
  expect(first.traceOwners[0].anchors).toEqual(["0:declared-A"])
  expect(restored.allPublishedCopperChecksRun).toBe(false)
  expect(restored.fullCopperGrade).toBe("NOT_EVALUATED")
})
