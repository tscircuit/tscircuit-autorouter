import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import routedTracesJson from "../../fixtures/repro/rv1106g2-pipeline9-final-drc/phase-2.output.traces.json" with {
  type: "json",
}
import srjJson from "../../fixtures/repro/rv1106g2-pipeline9-final-drc/phase-2.input.simple-route.json" with {
  type: "json",
}

test("Pipeline9 preserves the owner of an RV1106G2 via-pad error", () => {
  const input = srjJson as SimpleRouteJson
  const routedTraces = routedTracesJson as SimplifiedPcbTrace[]
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces,
    drcOptions: { traceClearance: 0.1 },
  })
  const error = drc.errors.find(
    (error) =>
      "pcb_pad_ids" in error && error.pcb_pad_ids.includes("pcb_smtpad_53"),
  )!
  const [mappedError] = addAutoroutingViaTraceIds({
    errors: [error as unknown as Record<string, unknown>],
    circuitJson: drc.circuitJson,
    evaluatedTraceIds: new Set(
      routedTraces.map((trace) => trace.pcb_trace_id),
    ),
  })

  expect(mappedError.pcb_trace_ids).toEqual(["source_net_31_mst6_0"])

  const fullBoard = {
    ...input,
    traces: combinePreloadedAndRoutedTraces(input.traces ?? [], routedTraces),
  }
  expect(
    getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(fullBoard, { traceColorMode: "layer" }),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
