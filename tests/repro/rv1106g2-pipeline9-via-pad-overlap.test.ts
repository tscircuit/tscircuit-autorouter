import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
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

test("Pipeline9 DRC reports the RV1106G2 via beside an unrelated pad", () => {
  const input = srjJson as SimpleRouteJson
  const routedTraces = routedTracesJson as SimplifiedPcbTrace[]
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces,
    drcOptions: { traceClearance: 0.1 },
  })

  expect(drc.errors).toContainEqual(
    expect.objectContaining({
      pcb_pad_ids: expect.arrayContaining(["pcb_smtpad_53"]),
    }),
  )

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
