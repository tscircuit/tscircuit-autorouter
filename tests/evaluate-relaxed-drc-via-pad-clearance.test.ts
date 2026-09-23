import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC catches via-pad clearance violations on different nets sharing a layer", (): void => {
  // Cropped SRJ18 sample 15 geometry: the through via on net 110 overlaps
  // the top pad on net 109 by 0.08 mm, even with its wires on other layers.
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -14, minY: 6, maxX: -9, maxY: 12 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -11.5, y: 9.55 },
        width: 2,
        height: 0.5,
        connectedTo: ["pad_net", "pcb_smtpad_220", "pcb_port_256"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_220",
          pcb_port_id: "pcb_port_256",
        },
      },
    ],
    connections: [
      {
        name: "via_net",
        pointsToConnect: [
          { x: -12.130219883483937, y: 11, layer: "bottom" },
          { x: -13, y: 9.87, layer: "inner1" },
        ],
      },
      {
        name: "pad_net",
        pointsToConnect: [
          { x: -11.5, y: 9.55, layer: "top", pcb_port_id: "pcb_port_256" },
        ],
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "via_trace",
    connection_name: "via_net",
    route: [
      {
        route_type: "wire",
        x: -12.130219883483937,
        y: 11,
        width: 0.1,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: -12.130219883483937,
        y: 9.87,
        width: 0.1,
        layer: "bottom",
      },
      {
        route_type: "via",
        x: -12.130219883483937,
        y: 9.87,
        from_layer: "bottom",
        to_layer: "inner1",
      },
      {
        route_type: "wire",
        x: -12.130219883483937,
        y: 9.87,
        width: 0.1,
        layer: "inner1",
      },
      { route_type: "wire", x: -13, y: 9.87, width: 0.1, layer: "inner1" },
    ],
  }
  const input = {
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [trace],
    // The cropped fixture omits the pads at the trace's remote endpoints.
    drcOptions: { includeTraceContinuity: false },
  }
  const result = evaluateRelaxedDrc(input)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_pad_ids: ["via_0", "pcb_smtpad_220"],
    minimum_clearance: 0.1,
    actual_clearance: 0,
  })
  expect(result.locationAwareErrors).toHaveLength(1)
  expect(result.locationAwareErrors[0].center.x).toBeCloseTo(-11.81510994174197)
  expect(result.locationAwareErrors[0].center.y).toBeCloseTo(9.71)

  for (const [gap, expectedErrors] of [
    [0.08, 1],
    [0.1, 0],
    [0.2, 0],
  ]) {
    const movedTrace = structuredClone(trace)
    for (const point of movedTrace.route) {
      if (point.route_type === "wire" || point.route_type === "via") {
        point.y += 9.8 + 0.15 + gap - 9.87
      }
    }
    const moved = evaluateRelaxedDrc({ ...input, routedTraces: [movedTrace] })
    expect(moved.errors).toHaveLength(expectedErrors)
    if (expectedErrors) {
      expect(moved.errors[0]).toMatchObject({
        type: "pcb_pad_pad_clearance_error",
      })
    }
    if (gap === 0.1) {
      const stricter = evaluateRelaxedDrc({
        ...input,
        routedTraces: [movedTrace],
        drcOptions: { ...input.drcOptions, viaClearance: 0.2 },
      })
      expect(stricter.errors).toHaveLength(1)
      expect(stricter.errors[0]).toMatchObject({
        type: "pcb_pad_pad_clearance_error",
        minimum_clearance: 0.2,
      })
    }
  }

  const sameNetSrj = structuredClone(srj)
  sameNetSrj.connections[0].__netConnectionName = "pad_net"
  expect(
    evaluateRelaxedDrc({
      ...input,
      inputSrj: sameNetSrj,
      srjWithPointPairs: sameNetSrj,
    }).errors,
  ).toEqual([])

  const blindViaSrj = { ...srj, allowBlindAndBuriedVias: true }
  expect(
    evaluateRelaxedDrc({
      ...input,
      inputSrj: blindViaSrj,
      srjWithPointPairs: blindViaSrj,
    }).errors,
  ).toEqual([])
})
