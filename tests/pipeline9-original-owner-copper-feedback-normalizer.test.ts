import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getPipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { remapDrcTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"

test("strict wire overlap preserves native remapping and makes the movable secondary the primary repair target", (): void => {
  const original: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.2, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [], connections: [{ name: "fixed", pointsToConnect: [] }, { name: "movable", pointsToConnect: [] }] }
  const traces: SimplifiedPcbTrace[] = [
    { type: "pcb_trace", pcb_trace_id: "fixed_prepared", connection_name: "fixed", route: [{ route_type: "wire", x: -1, y: 0, width: 0.2, layer: "top" }, { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "top" }] },
    { type: "pcb_trace", pcb_trace_id: "movable_prepared", connection_name: "movable", route: [{ route_type: "wire", x: 0, y: -1, width: 0.2, layer: "top" }, { route_type: "wire", x: 0, y: 1, width: 0.2, layer: "top" }] },
  ]
  const circuitJson = traces.map(({ connection_name: _, ...trace }) => trace) as AnyCircuitElement[]
  const feedback = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: original, srjWithPointPairs: original, routedTraces: traces, circuitJson })
  expect(feedback.status).toBe("SUPPORTED")
  expect(feedback.errors).toHaveLength(1)
  expect(feedback.errors[0]!.pcb_trace_id).toBe("fixed_prepared")
  const remapped = remapDrcTraceIds(feedback.errors, new Map([["fixed_prepared", "fixed_solver"], ["movable_prepared", "movable_solver"]]))
  const normalized = normalizePipeline9DrcErrorsForRepair({ errors: remapped, circuitJson: [], newTraceIds: new Set(["movable_solver"]) })
  expect(normalized[0]!.pcb_trace_id).toBe("movable_solver")
  expect(normalized[0]!.pcb_trace_error_id).toBe("overlap_movable_solver_fixed_solver")
  expect(normalized[0]!.originalOwnerCopperFeedbackKey).toBe(feedback.errors[0]!.originalOwnerCopperFeedbackKey)
})
