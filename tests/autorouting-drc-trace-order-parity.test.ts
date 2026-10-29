import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

test("native trace DRC preserves interleaved bucket ordering and parallel pair centers", () => {
  for (const shift of [0, 0.05, 0.4, -0.45]) {
    const pads: AnyCircuitElement[] = [
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: "pcb_smtpad_overlap",
        shape: "rect",
        x: -1.4 + shift,
        y: 0,
        width: 0.3,
        height: 0.3,
        layer: "top",
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: "pcb_smtpad_clearance",
        shape: "rect",
        x: 0.5 + shift,
        y: 0.22,
        width: 0.2,
        height: 0.2,
        layer: "top",
      },
    ]
    const routes = [
      [
        { x: -3, y: 0 },
        { x: 3, y: 0 },
      ],
      [
        { x: 1, y: 0.18 },
        { x: -1, y: 0.18 },
      ],
      [
        { x: 2, y: -1 },
        { x: 2, y: 1 },
      ],
    ]
    const traces: PcbTrace[] = routes.map((route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `trace_${index}`,
      source_trace_id: `source_${index}`,
      route: route.map((point) => ({
        ...point,
        x: point.x + shift,
        route_type: "wire",
        width: 0.1,
        layer: "top",
      })),
    }))
    const circuitJson: AnyCircuitElement[] = [
      ...pads,
      ...traces,
      {
        type: "pcb_via",
        pcb_via_id: "via_0",
        pcb_trace_id: "trace_via_0",
        x: shift,
        y: 0.25,
        outer_diameter: 0.3,
        hole_diameter: 0.15,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_via",
        pcb_via_id: "via_1",
        pcb_trace_id: "trace_via_1",
        x: 2 + shift,
        y: 0.7,
        outer_diameter: 0.3,
        hole_diameter: 0.15,
        layers: ["top", "bottom"],
      },
    ]
    const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
    connMap.addConnections([
      ["via_0", "trace_via_0"],
      ["via_1", "trace_via_1"],
    ])
    const expected = getDrcErrors(structuredClone(circuitJson), {
      traceClearance: 0.1,
      includeTraceContinuity: false,
    }).errors
    const groups = createTraceObstacleClearanceEvaluator(pads)(
      circuitJson,
      connMap,
    )
    const actual = [
      ...groups.traceErrors,
      ...groups.viaErrors,
      ...groups.padErrors,
      ...groups.holeErrors,
    ]
    expect(actual).toEqual(expected.map((error) => ({ ...error })))
    const parallelPair = actual.find(
      (error) => error.pcb_trace_error_id === "overlap_trace_0_trace_1",
    )
    expect((parallelPair?.center as { x: number }).x).toBeCloseTo(1 + shift, 12)
    expect((parallelPair?.center as { y: number }).y).toBeCloseTo(0.09, 12)
  }
})
