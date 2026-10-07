import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC reports via-to-pad violations using the declared SRJ clearance", () => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.5,
    minViaHoleDiameter: 0.2,
    minViaEdgeToPadEdgeClearance: 0.2,
    bounds: { minX: -2, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["pad", "pad_port", "pad_net"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad", pcb_port_id: "pad_port" },
      },
    ],
    connections: [
      {
        name: "pad_net",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pad_port" }],
      },
      {
        name: "route_net",
        pointsToConnect: [
          { x: 0.9, y: -2, layer: "bottom" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "route",
    connection_name: "route_net",
    route: [
      { route_type: "wire", x: 0.9, y: -2, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 0.9, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "via", x: 0.9, y: 0, from_layer: "bottom", to_layer: "top" },
      { route_type: "wire", x: 0.9, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const input = { inputSrj, srjWithPointPairs: inputSrj, routedTraces: [trace] }
  const result = evaluateRelaxedDrc(input)
  const errors = result.errors.filter(
    (error) => error.type === "pcb_pad_pad_clearance_error",
  )
  expect(errors).toHaveLength(1)
  expect(errors[0].minimum_clearance).toBe(0.2)
  expect(errors[0].actual_clearance).toBeCloseTo(0.15)
  expect(errors[0].pcb_pad_ids).toEqual(["via_0", "pad"])
  expect(errors).toEqual(
    result.locationAwareErrors.filter(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    ),
  )

  expect(
    evaluateRelaxedDrc({
      ...input,
      drcOptions: { viaPadClearance: 0.1 },
    }).errors.filter((error) => error.type === "pcb_pad_pad_clearance_error"),
  ).toEqual([])
})
