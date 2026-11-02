import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("retained copper pours preserve clearance checks against unrelated traces", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 5, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.15,
    connections: [
      {
        name: "ground",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "ground_left" },
          { x: 4, y: 0, layer: "bottom", pcb_port_id: "ground_right" },
        ],
      },
      {
        name: "connectivity_net0",
        pointsToConnect: [
          { x: 1.1, y: 1, layer: "bottom", pcb_port_id: "signal_left" },
          { x: 2.9, y: 1, layer: "bottom", pcb_port_id: "signal_right" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 1.1, y: 1 },
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        connectedTo: ["signal_left"],
      },
      {
        type: "rect",
        center: { x: 2.9, y: 1 },
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        connectedTo: ["signal_right"],
      },
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 2,
        height: 0.6,
        layers: ["bottom"],
        connectedTo: ["ground", "ground_left", "ground_right"],
        isCopperPour: true,
      },
    ],
  }
  const nearTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal_route",
    connection_name: "connectivity_net0",
    route: [
      { route_type: "wire", x: 1.1, y: 1, layer: "bottom", width: 0.15 },
      { route_type: "wire", x: 1.1, y: 0.425, layer: "bottom", width: 0.15 },
      { route_type: "wire", x: 2.9, y: 0.425, layer: "bottom", width: 0.15 },
      { route_type: "wire", x: 2.9, y: 1, layer: "bottom", width: 0.15 },
    ],
  }
  const result = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [nearTrace],
  })
  expect(
    result.errors.filter(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toHaveLength(1)
  const overlappingTrace = structuredClone(nearTrace)
  const firstCrossingPoint = overlappingTrace.route[1]!
  const secondCrossingPoint = overlappingTrace.route[2]!
  if (
    firstCrossingPoint.route_type !== "wire" ||
    secondCrossingPoint.route_type !== "wire"
  ) {
    throw new Error("Expected crossing wire segments")
  }
  firstCrossingPoint.y = 0
  secondCrossingPoint.y = 0
  const overlappingResult = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [overlappingTrace],
  })
  expect(
    overlappingResult.errors.some((error) => error.type === "pcb_trace_error"),
  ).toBe(true)
})
