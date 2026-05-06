import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson } from "lib/types"
import srj from "./pcb_trace_id-should-return-root-connection-name.srj.json"
import { mergeGraphics, Text } from "graphics-debug"
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
  expect(errors.length).toBeGreaterThan(0)
  let mixedErrorVIz = getLastStepGraphicsObject(solver.visualize())
  if (errors.length > 0) {
    const texts: Text[] = []
    const lineHeight = 1.2
    let lineNumber = 0
    for (const error of errors) {
      texts.push({
        text: error.message,
        x: 0,
        y: lineNumber * lineHeight,
        fontSize: 0.3,
        color: "red",
      })
      lineNumber++
    }
    mixedErrorVIz = mergeGraphics(mixedErrorVIz, { texts })
  }
  let finalviz = mixedErrorVIz
  expect(finalviz).toMatchGraphicsSvg(import.meta.path)
})
