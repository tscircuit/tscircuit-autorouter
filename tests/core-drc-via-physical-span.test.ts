import { expect, test } from "bun:test"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createCoreDrcViaSpanFixture } from "tests/fixtures/core-drc-via-span-fixture"

test("reference DRC matches Core's bottom-layer contact detection for physical via spans", () => {
  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const { srj, traces } = createCoreDrcViaSpanFixture({
      allowBlindAndBuriedVias,
    })
    const originalRoutes = structuredClone(traces)
    const circuitJson = convertToCircuitJson(srj, traces)
    const via = circuitJson.find((element) => element.type === "pcb_via")
    expect(via?.layers).toEqual(
      allowBlindAndBuriedVias
        ? ["top", "inner1", "inner2"]
        : ["top", "inner1", "inner2", "bottom"],
    )

    const coreErrors = checkEachPcbTraceNonOverlapping(circuitJson)
    const { errors } = getDrcErrors(circuitJson)
    expect(errors).toEqual(coreErrors)
    if (allowBlindAndBuriedVias) {
      expect(errors).toEqual([])
    } else {
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        type: "pcb_trace_error",
        pcb_trace_id: "bottom_trace",
        pcb_trace_error_id: "overlap_bottom_trace_via_0",
      })
    }
    expect(traces).toEqual(originalRoutes)
  }
})
