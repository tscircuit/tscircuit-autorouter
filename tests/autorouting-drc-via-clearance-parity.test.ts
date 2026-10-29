import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/check-trace-obstacle-clearance"

test("native via DRC preserves typed clearance, overlap suppression, and dynamic via positions", () => {
  const evaluate = createTraceObstacleClearanceEvaluator([])
  for (const centerX of [0, 0.2, 0.24, 0.294, 0.296, 1]) {
    for (const endsOverlapping of [false, true]) {
      const trace: PcbTrace = {
        type: "pcb_trace", pcb_trace_id: "trace_candidate", source_trace_id: "source_candidate",
        route: [
          { route_type: "wire", x: 0, y: -2, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 2, width: 0.1, layer: "top" },
          ...(endsOverlapping ? [
            { route_type: "wire" as const, x: centerX, y: 0, width: 0.1, layer: "top" as const },
          ] : []),
        ],
      }
      const circuitJson: AnyCircuitElement[] = [trace, {
        type: "pcb_via", pcb_via_id: "via_0", pcb_trace_id: "trace_via", x: centerX, y: 0,
        outer_diameter: 0.4, hole_diameter: 0.2, layers: ["top", "bottom"],
      }]
      const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
      connMap.addConnections([["via_0", "trace_via"]])
      const expected = getDrcErrors(structuredClone(circuitJson), {
        traceClearance: 0.1, includeTraceContinuity: false,
      }).errorsWithCenters
      const actual = evaluate(circuitJson, connMap)
      expect(actual).toEqual(expected.map((error) => ({ ...error })))
      expect(actual.length).toBeLessThanOrEqual(1)
    }
  }
})
