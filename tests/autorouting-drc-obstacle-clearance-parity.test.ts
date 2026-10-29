import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

test("native obstacle DRC preserves rotated pad clearance, overlap classification, and centers", () => {
  const pads = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pcb_smtpad_rotated",
      pcb_port_id: "pcb_port_pad",
      shape: "rotated_rect",
      x: 0,
      y: 0,
      width: 0.3,
      height: 1.4,
      ccw_rotation: 37,
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pcb_smtpad_rect",
      shape: "rect",
      x: 0,
      y: 0,
      width: 0.3,
      height: 1.4,
      layer: "top",
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "pcb_plated_hole_rect",
      shape: "rotated_pill_hole_with_rect_pad",
      x: 0,
      y: 0,
      rect_pad_width: 0.3,
      rect_pad_height: 1.4,
      rect_ccw_rotation: 37,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "pcb_plated_hole_circle",
      shape: "circle",
      x: 0,
      y: 0,
      outer_diameter: 0.8,
      hole_diameter: 0.3,
      layers: ["top", "bottom"],
    },
  ] as AnyCircuitElement[]
  let sawOverlap = false
  let sawClearance = false
  for (const pad of pads) {
    const evaluate = createTraceObstacleClearanceEvaluator([pad])
    for (let offsetIndex = 0; offsetIndex < 20; offsetIndex++) {
      const offset = offsetIndex * 0.05
      const trace: PcbTrace = {
        type: "pcb_trace",
        pcb_trace_id: "trace_candidate",
        source_trace_id: "source_candidate",
        route: [
          { route_type: "wire", x: offset, y: -2, width: 0.1, layer: "top" },
          { route_type: "wire", x: offset, y: 2, width: 0.1, layer: "top" },
        ],
      }
      const circuitJson = [pad, trace]
      const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
      const expected = getDrcErrors(structuredClone(circuitJson), {
        traceClearance: 0.1,
        includeTraceContinuity: false,
      }).errorsWithCenters
      const groups = evaluate(circuitJson, connMap)
      const actual = [
        ...groups.traceErrors,
        ...groups.viaErrors,
        ...groups.padErrors,
        ...groups.holeErrors,
      ]
      // Current circuit-json bounds retain the rotated pad's true extent.
      if (
        pad.type === "pcb_smtpad" &&
        pad.shape === "rotated_rect" &&
        offsetIndex === 12
      ) {
        expect(actual[0]?.type).toBe("pcb_pad_trace_clearance_error")
      }
      expect(
        actual.length,
        JSON.stringify({ pad, offset, actual, expected }),
      ).toBe(expected.length)
      for (let index = 0; index < expected.length; index++) {
        const error = actual[index]!
        const reference = expected[index]! as unknown as Record<string, unknown>
        const { center, actual_clearance, ...metadata } = error
        const {
          center: expectedCenter,
          actual_clearance: expectedGap,
          ...expectedMetadata
        } = reference
        expect(metadata).toEqual(expectedMetadata)
        if (typeof actual_clearance === "number")
          expect(actual_clearance).toBeCloseTo(expectedGap as number, 12)
        expect((center as { x: number }).x).toBeCloseTo(
          (expectedCenter as { x: number }).x,
          12,
        )
        expect((center as { y: number }).y).toBeCloseTo(
          (expectedCenter as { y: number }).y,
          12,
        )
        sawOverlap ||= error.type === "pcb_trace_error"
        sawClearance ||= error.type === "pcb_pad_trace_clearance_error"
      }
    }
  }
  expect(sawOverlap).toBeTrue()
  expect(sawClearance).toBeTrue()
})
