import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type SimplifiedPcbTraces,
} from "high-density-repair03/lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "./assets/gameboy-generated-via-layer-short.json"

test("Repair03 misses a generated Game Boy via short outside its signal layers", async (): Promise<void> => {
  // Core 0.0.1989 exported the SRJ from the unchanged Game Boy TSX board.
  // Unmodified SWCLK and XOUT traces captured from its full Pipeline9 solve.
  // Only the other nets and component obstacles were removed.
  const captured = structuredClone(capturedInput)
  const routedTraces = captured.traces as SimplifiedPcbTraces
  const inputSrj = { ...captured, traces: undefined } satisfies SimpleRouteJson
  const drcInput = {
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces,
  }
  expect(routedTraces).toHaveLength(2)
  expect(inputSrj.allowBlindAndBuriedVias).toBeFalse()

  const reference = evaluateRelaxedDrc(drcInput)
  const indexed = new AutoroutingDrcEngine(inputSrj).evaluate(routedTraces)

  // The inner2-to-inner1 SWCLK transition still drills through the top layer,
  // where its via overlaps the unrelated XOUT trace.
  expect(reference.errors).toHaveLength(1)
  expect(reference.errors[0]).toMatchObject({
    type: "pcb_trace_error",
    pcb_trace_id: "source_trace_67_0",
  })
  expect(reference.errors[0]!.message).toContain("accidental contact")
  const vias = reference.circuitJson.filter(
    (element) => element.type === "pcb_via",
  )
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  }

  // Known bug: Repair03 checks only the signal-layer span and misses the short.
  expect(indexed.errors).toEqual([])

  // Identical copper is valid only if blind/buried vias are explicitly allowed.
  const blindInput = { ...inputSrj, allowBlindAndBuriedVias: true }
  expect(
    evaluateRelaxedDrc({
      ...drcInput,
      inputSrj: blindInput,
      srjWithPointPairs: blindInput,
    }).errors,
  ).toEqual([])

  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
  expect(capturedInput.traces).toEqual(routedTraces)
})
