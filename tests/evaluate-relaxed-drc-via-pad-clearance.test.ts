import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("reference DRC honors declared via-to-pad clearance and net connectivity", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    minViaEdgeToPadEdgeClearance: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["bottom"],
        connectedTo: ["ground"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "ground_pad",
          pcb_port_id: "pad_port",
        },
      },
    ],
    connections: [
      {
        name: "ground",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "pad_port" },
        ],
      },
      {
        name: "signal",
        pointsToConnect: [
          { x: 0.6, y: -2, layer: "top" },
          { x: 2, y: 0, layer: "bottom" },
        ],
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal_trace",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: 0.6, y: -2, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.6, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0.6,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      },
      { route_type: "wire", x: 0.6, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const input = {
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [trace],
    drcOptions: { includeTraceContinuity: false },
  }
  const result = evaluateRelaxedDrc(input)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    minimum_clearance: 0.15,
  })
  expect(result.errors[0]).toHaveProperty("actual_clearance")
  expect(result.locationAwareErrors).toHaveLength(1)
  for (const clearance of [undefined, 0, 0.05, 0.1]) {
    expect(
      evaluateRelaxedDrc({
        ...input,
        inputSrj: { ...srj, minViaEdgeToPadEdgeClearance: clearance },
      }).errors,
    ).toEqual([])
  }
  expect(
    evaluateRelaxedDrc({
      ...input,
      drcOptions: { ...input.drcOptions, viaToPadClearance: 0.05 },
    }).errors,
  ).toEqual([])
  const sameNetSrj: SimpleRouteJson = {
    ...srj,
    obstacles: [{ ...srj.obstacles[0]!, connectedTo: ["signal"] }],
    connections: [
      {
        ...srj.connections[1]!,
        pointsToConnect: [
          ...srj.connections[1]!.pointsToConnect,
          ...srj.connections[0]!.pointsToConnect,
        ],
      },
    ],
  }
  expect(
    evaluateRelaxedDrc({
      ...input,
      inputSrj: sameNetSrj,
      srjWithPointPairs: sameNetSrj,
    }).errors,
  ).toEqual([])
})
