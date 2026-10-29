import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

test("native generic DRC includes wire-via segments and wider endpoints while typed clearance retains wire pairs", () => {
  for (const routeKind of ["wire", "via"] as const) {
    for (const traceClearance of [0.1, 0.28, 1]) {
      const pad: AnyCircuitElement = {
        type: "pcb_smtpad",
        pcb_smtpad_id: "pad",
        shape: "rect",
        x: 0,
        y: 0.24,
        width: 0.4,
        height: 0.2,
        layer: "top",
      }
      const route: PcbTrace["route"] = [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        routeKind === "wire"
          ? { route_type: "wire", x: 1, y: 0, width: 0.4, layer: "top" }
          : {
              route_type: "via",
              x: 1,
              y: 0,
              from_layer: "top",
              to_layer: "bottom",
            },
      ]
      const circuitJson: AnyCircuitElement[] = [
        pad,
        {
          type: "pcb_trace",
          pcb_trace_id: "trace",
          source_trace_id: "source",
          route,
        },
        {
          type: "source_trace",
          source_trace_id: "source",
          display_name: "POWER",
          connected_source_port_ids: [],
        },
      ]
      const expected = getDrcErrors(structuredClone(circuitJson), {
        traceClearance,
        includeTraceContinuity: false,
      }).errorsWithCenters
      const groups = createTraceObstacleClearanceEvaluator([pad], {
        traceClearance,
      })(circuitJson, getFullConnectivityMapFromCircuitJson(circuitJson))
      const actual = [
        ...groups.traceErrors,
        ...groups.viaErrors,
        ...groups.padErrors,
        ...groups.holeErrors,
      ]
      expect(actual).toEqual(expected.map((error) => ({ ...error })))
    }
  }
})
