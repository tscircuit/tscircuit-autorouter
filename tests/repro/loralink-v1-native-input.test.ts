import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import captured from "../../fixtures/bug-reports/loralink-v1/loralink-v1.solver-input.json" with { type: "json" }

test("native LoRaLink routing input reproduces the VBUS to USB hole clearance violation", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(captured.input) as SimpleRouteJson,
    captured.options,
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  if (!solver.srjWithPointPairs) throw new Error("Expected routed point pairs")
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(solver.getOutputSimpleRouteJson().traces).toHaveLength(121)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: solver.originalSrj,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces,
  })
  // Core pours are finalized after routing; only assert this geometric violation.
  expect(errors).toContainEqual(
    expect.objectContaining({
      pcb_trace_error_id: "overlap_source_net_1_mst1_0_pcb_hole_0",
      pcb_trace_id: "source_net_1_mst1_0",
      message: expect.stringContaining("required: 0.2mm"),
    }),
  )
})
