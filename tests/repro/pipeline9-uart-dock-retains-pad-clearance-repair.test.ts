import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import fixture from "../../fixtures/bug-reports/uart-dock-pad-shorts/uart-dock-pad-shorts.srj.json"

test("Pipeline 9 retains the cleared CTS1-to-RTS1 pad contact after final repair", () => {
  const input: SimpleRouteJson = structuredClone(fixture)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .traceContactRollbackCheckpointRetained,
  ).toBe(true)
  const routes = solver.getOutputSimplifiedPcbTraces()
  expect(routes.some((trace) => trace.pcb_trace_id === "source_net_21_0")).toBe(
    true,
  )
  const { srjWithPointPairs } = solver
  if (!srjWithPointPairs) throw new Error("UART Dock point pairs are missing")
  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs,
    routedTraces: routes,
  })
  expect(
    errors.filter(
      (error) =>
        error.type === "pcb_trace_error" &&
        (error.pcb_trace_error_id === "overlap_source_net_21_0_pcb_smtpad_54" ||
          error.pcb_trace_error_id.startsWith(
            "missing_connection_source_net_21_0_",
          ) ||
          error.pcb_trace_error_id.startsWith(
            "missing_layer_connection_source_net_21_0_",
          ) ||
          error.pcb_trace_error_id.startsWith(
            "disconnected_endpoint_source_net_21_0_",
          ) ||
          error.pcb_trace_error_id.startsWith(
            "misaligned_via_source_net_21_0_",
          )),
    ),
  ).toEqual([])
}, 120_000)
