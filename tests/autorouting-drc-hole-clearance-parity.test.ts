import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

test("native hole clearance preserves physical shapes, centers, board defaults and explicit overrides", () => {
  const holes = [
    { hole_shape: "circle", hole_diameter: 0.6 },
    { hole_shape: "square", hole_diameter: 0.6 },
    { hole_shape: "rect", hole_width: 1.2, hole_height: 0.6 },
    { hole_shape: "oval", hole_width: 1.2, hole_height: 0.6 },
    { hole_shape: "pill", hole_width: 1.2, hole_height: 0.6 },
    {
      hole_shape: "rotated_pill",
      hole_width: 1.2,
      hole_height: 0.6,
      ccw_rotation: 37,
    },
  ]
  for (const geometry of holes) {
    const hole = {
      type: "pcb_hole",
      pcb_hole_id: "hole",
      x: 0,
      y: 0,
      ...geometry,
    } as AnyCircuitElement
    for (const holeClearance of [undefined, 0.1, 0.35]) {
      const options = { holeClearance, traceClearance: 0.13 }
      const evaluate = createTraceObstacleClearanceEvaluator([hole], options)
      for (const y of [0, 0.25, 0.4, 0.5, 0.65, 0.85]) {
        const trace: PcbTrace = {
          type: "pcb_trace",
          pcb_trace_id: "trace",
          source_trace_id: "source",
          route: [
            { route_type: "wire", x: -2, y, width: 0.15, layer: "top" },
            { route_type: "wire", x: 2, y, width: 0.15, layer: "top" },
          ],
        }
        const circuitJson: AnyCircuitElement[] = [
          hole,
          trace,
          {
            type: "pcb_board",
            pcb_board_id: "board",
            center: { x: 0, y: 0 },
            width: 20,
            height: 20,
            num_layers: 2,
            thickness: 1.6,
            material: "fr4",
            min_trace_to_hole_edge_clearance: 0.26,
          },
        ]
        const expected = getDrcErrors(structuredClone(circuitJson), {
          ...options,
          includeTraceContinuity: false,
        }).errorsWithCenters
        const groups = evaluate(
          circuitJson,
          getFullConnectivityMapFromCircuitJson(circuitJson),
        )
        const actual = [
          ...groups.traceErrors,
          ...groups.viaErrors,
          ...groups.padErrors,
          ...groups.holeErrors,
        ]
        expect(actual, JSON.stringify({ geometry, y, holeClearance })).toEqual(
          expected.map((error) => ({ ...error })),
        )
      }
    }
  }
})
