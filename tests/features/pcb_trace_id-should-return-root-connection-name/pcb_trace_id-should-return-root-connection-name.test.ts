import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson } from "lib/types"
import srj from "./pcb_trace_id-should-return-root-connection-name.srj.json"
import { getLastStepGraphicsObject } from "tests/fixtures/getLastStepGraphicsObject"

const boardSrj = srj as SimpleRouteJson

test("board#23 trace keeps original connection name", () => {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(boardSrj)
  solver.solve()

  if (solver.failed) {
    throw new Error(solver.error ?? "solver failed")
  }

  const traces = solver.getOutputSimplifiedPcbTraces()

  expect(traces.length).toBeGreaterThan(0)
  expect(new Set(traces.map((trace) => trace.pcb_trace_id))).toEqual(
    new Set([
      "source_trace_0__source_trace_1_mst0_0",
      "source_trace_0__source_trace_1_mst1_0",
    ]),
  )

  const circuitJson = convertToCircuitJson(boardSrj, traces, {
    minTraceWidth: boardSrj.minTraceWidth,
    minViaDiameter: boardSrj.minViaDiameter ?? 0.6,
  })
  const { errors } = getDrcErrors(circuitJson)
  expect(errors).toHaveLength(0)
  expect(getLastStepGraphicsObject(solver.visualize())).toMatchGraphicsSvg(
    import.meta.path,
  )
})
