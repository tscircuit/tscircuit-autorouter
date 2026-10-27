import { beforeAll, expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import fixture from "../fixtures/assets/a64-via-pad-clearance.json"
import { getA64Byte0ReferenceDrcInput } from "../fixtures/getA64Byte0ReferenceDrcInput"
import { getA64ViaPadClearanceSnapshotSvg } from "../fixtures/getA64ViaPadClearanceSnapshotSvg"

const input = structuredClone(fixture.srj) as SimpleRouteJson
const trace = fixture.trace as SimplifiedPcbTrace
const reference = evaluateRelaxedDrc(
  getA64Byte0ReferenceDrcInput({ inputSrj: input, routedTraces: [trace] }),
)
const measured = checkViaPadClearance(reference.circuitJson, {
  minClearance: input.defaultObstacleMargin,
})

beforeAll(async (): Promise<void> => {
  await expect(
    getA64ViaPadClearanceSnapshotSvg({
      inputSrj: input,
      routedTraces: [trace],
      viaPadErrorCount: measured.length,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})

test(
  "reference DRC reports the real A64 DQ2 via copper too close to foreign pad U2.F3",
  (): void => {
    expect(measured).toHaveLength(1)
    expect(measured[0]!.actual_clearance).toBeCloseTo(0.0837135955, 8)
    expect(measured[0]!.minimum_clearance).toBe(0.10668)
    expect(reference.errors).toContainEqual(
      expect.objectContaining({
        type: "pcb_pad_pad_clearance_error",
        pcb_trace_id: trace.pcb_trace_id,
        pcb_via_ids: [expect.any(String)],
        actual_clearance: measured[0]!.actual_clearance,
        minimum_clearance: measured[0]!.minimum_clearance,
      }),
    )
    expect(input).toEqual(fixture.srj)

    const genericPadRule = { ...input, minPadEdgeToPadEdgeClearance: 0.25 }
    const genericReference = evaluateRelaxedDrc(
      getA64Byte0ReferenceDrcInput({
        inputSrj: genericPadRule,
        routedTraces: [trace],
      }),
    )
    expect(genericReference.errors).toContainEqual(
      expect.objectContaining({
        type: "pcb_pad_pad_clearance_error",
        minimum_clearance: 0.25,
      }),
    )
    const explicitViaRule = evaluateRelaxedDrc(
      getA64Byte0ReferenceDrcInput({
        inputSrj: { ...genericPadRule, minViaEdgeToPadEdgeClearance: 0.05 },
        routedTraces: [trace],
      }),
    )
    expect(explicitViaRule.errors).toEqual([])
  },
)
