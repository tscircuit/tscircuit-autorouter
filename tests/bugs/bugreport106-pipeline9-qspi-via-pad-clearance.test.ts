import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import inputJson from "../../fixtures/bug-reports/bugreport106-pipeline9-qspi-via-pad-overlap/bugreport106-pipeline9-qspi-via-pad-overlap.srj.json"

test("Pipeline9 rejects unresolved QSPI via-to-pad clearance instead of reporting solved", (): void => {
  const input = inputJson as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
  )
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain("minViaEdgeToPadEdgeClearance=0.25mm")
  const error = solver.viaPadClearanceErrors.find(
    (error) => error.pcb_trace_id === "source_trace_30_0" &&
      Array.isArray(error.pcb_pad_ids) &&
      error.pcb_pad_ids.includes("pcb_smtpad_87"),
  )
  expect(error).toBeDefined()
  expect(error!.actual_clearance).toBeLessThan(0.25)
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )
})
