import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getUnownedObstacleDrcErrors } from "lib/testing/getUnownedObstacleDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("unowned obstacle DRC catches sample24 raw barrier 2591 independently of its ID", (): void => {
  const x = 231.91874594465745
  const y = 40.48072046064339
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "source_net_altium_pcb_13_0",
    connection_name: "source_net_altium_pcb_13",
    route: [
      { route_type: "wire", x: x - 1, y, width: 0.1, layer: "inner1" },
      { route_type: "wire", x, y, width: 0.1, layer: "inner1" },
      {
        route_type: "via",
        x,
        y,
        from_layer: "inner1",
        to_layer: "top",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      { route_type: "wire", x, y, width: 0.1, layer: "top" },
      { route_type: "wire", x: x + 1, y, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    allowBlindAndBuriedVias: false,
    defaultObstacleMargin: 0.15,
    minTraceToPadEdgeClearance: 0.15,
    minViaEdgeToPadEdgeClearance: 0.15,
    bounds: { minX: 230, minY: 39, maxX: 234, maxY: 42 },
    connections: [{ name: trace.connection_name, pointsToConnect: [] }],
    obstacles: [
      {
        obstacleId: "pcb_keepout_altium_arc_4604",
        type: "rect",
        layers: ["inner5"],
        center: { x: 232.0036, y: 40.462199999999996 },
        width: 0.5334000000000098,
        height: 0.5334000000000098,
        connectedTo: [],
      },
      {
        obstacleId: "pcb_keepout_owned",
        type: "rect",
        layers: ["inner5"],
        center: { x, y },
        width: 1,
        height: 1,
        connectedTo: [trace.connection_name],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x, y },
        width: 1,
        height: 1,
        connectedTo: ["pcb_plated_hole_existing", trace.connection_name],
      },
    ],
  }
  const circuitJson = convertToCircuitJson(inputSrj, [trace])
  const snapshot = structuredClone({ inputSrj, trace, circuitJson })
  const errors = getUnownedObstacleDrcErrors({
    inputSrj,
    jointTraces: [trace],
    circuitJson,
  })
  expect(errors).toHaveLength(1)
  const circuitTrace = circuitJson.find(
    (element) => element.type === "pcb_trace",
  )!
  expect(errors[0]).toMatchObject({
    type: "pcb_trace_error",
    pcb_trace_id: trace.pcb_trace_id,
    source_trace_id: circuitTrace.source_trace_id,
    srj_obstacle_id: "pcb_keepout_altium_arc_4604",
    srj_obstacle_index: 0,
    minimum_clearance: 0,
    actual_clearance: -0.15,
    center: { x, y },
  })
  expect(errors[0]).not.toHaveProperty("pcb_pad_ids")
  expect(errors[0]).not.toHaveProperty("pcb_via_ids")
  expect(errors[0]).not.toHaveProperty("pcb_keepout_id")

  for (const obstacleId of ["opaque-external-object", undefined]) {
    const opaqueInput = {
      ...inputSrj,
      obstacles: [{ ...inputSrj.obstacles[0]!, obstacleId }],
    }
    const opaqueErrors = getUnownedObstacleDrcErrors({
      inputSrj: opaqueInput,
      jointTraces: [trace],
      circuitJson: convertToCircuitJson(opaqueInput, [trace]),
    })
    expect(opaqueErrors).toHaveLength(1)
    expect(opaqueErrors[0]).toMatchObject({
      srj_obstacle_index: 0,
      actual_clearance: -0.15,
      minimum_clearance: 0,
    })
    expect(opaqueErrors[0]!.srj_obstacle_id).toBe(obstacleId)
  }

  const sourceLessPadInput: SimpleRouteJson = {
    ...inputSrj,
    minViaEdgeToPadEdgeClearance: 0.1,
    obstacles: [{
      ...inputSrj.obstacles[0]!,
      center: { x: x + 0.15 + 0.5334 / 2 + 0.02, y },
      layers: ["top"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "source-less-pad",
        pcb_port_id: "source-less-port",
      },
    }],
  }
  const sourceLessPadResult = evaluateRelaxedDrc({
    inputSrj: sourceLessPadInput,
    srjWithPointPairs: sourceLessPadInput,
    routedTraces: [trace],
    drcOptions: { includeTraceContinuity: false },
  })
  expect(getUnownedObstacleDrcErrors({
    inputSrj: sourceLessPadInput,
    jointTraces: [trace],
    circuitJson: sourceLessPadResult.circuitJson,
  })).toEqual([])
  const padErrors = sourceLessPadResult.errors.filter(
    (error) => error.type === "pcb_pad_pad_clearance_error",
  )
  expect(padErrors).toHaveLength(1)
  expect(padErrors[0]!.minimum_clearance).toBe(0.1)
  expect(padErrors[0]!.actual_clearance).toBeCloseTo(0.02, 8)

  for (const ownership of [
    { connectedTo: ["opaque-owner"] },
    { connectedTo: [], offBoardConnectsTo: ["offboard-owner"] },
  ]) {
    const ownedOpaqueInput: SimpleRouteJson = {
      ...inputSrj,
      obstacles: [{ ...inputSrj.obstacles[0]!, ...ownership }],
    }
    const ownedOpaqueCircuitJson = convertToCircuitJson(ownedOpaqueInput, [trace])
    expect(ownedOpaqueCircuitJson.some(
      (element) => element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
    )).toBe(false)
    expect(getUnownedObstacleDrcErrors({
      inputSrj: ownedOpaqueInput,
      jointTraces: [trace],
      circuitJson: ownedOpaqueCircuitJson,
    })).toEqual([])
  }

  const subdividedTrace: SimplifiedPcbTrace = {
    ...trace,
    route: [
      trace.route[0]!,
      { route_type: "wire", x: x - 0.5, y, width: 0.1, layer: "inner1" },
      ...trace.route.slice(1),
    ],
  }
  const subdividedErrors = getUnownedObstacleDrcErrors({
    inputSrj,
    jointTraces: [subdividedTrace],
    circuitJson: convertToCircuitJson(inputSrj, [subdividedTrace]),
  })
  expect(subdividedErrors).toEqual(errors)

  const secondViaX = 232.0036 + 0.5334 / 2 + 0.1
  const repeatedContactTrace: SimplifiedPcbTrace = {
    ...trace,
    route: [
      ...trace.route,
      { route_type: "wire", x: secondViaX, y, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: secondViaX,
        y,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.3,
      },
      { route_type: "wire", x: secondViaX, y, width: 0.1, layer: "inner1" },
    ],
  }
  expect(
    getUnownedObstacleDrcErrors({
      inputSrj,
      jointTraces: [repeatedContactTrace],
      circuitJson: convertToCircuitJson(inputSrj, [repeatedContactTrace]),
    }),
  ).toEqual(errors)

  const blindSrj = { ...inputSrj, allowBlindAndBuriedVias: true }
  expect(
    getUnownedObstacleDrcErrors({
      inputSrj: blindSrj,
      jointTraces: [trace],
      circuitJson: convertToCircuitJson(blindSrj, [trace]),
    }),
  ).toEqual([])

  const clearX = 232.0036 + 0.5334 / 2 + 0.15 + 0.02
  const nearKeepoutTrace: SimplifiedPcbTrace = {
    ...trace,
    route: trace.route.map((point) =>
      "x" in point ? { ...point, x: point.x + clearX - x } : point,
    ),
  }
  for (const obstacleId of ["opaque-nearby", undefined]) {
    const opaqueInput = {
      ...inputSrj,
      obstacles: [{ ...inputSrj.obstacles[0]!, obstacleId }],
    }
    expect(getUnownedObstacleDrcErrors({
      inputSrj: opaqueInput,
      jointTraces: [nearKeepoutTrace],
      circuitJson: convertToCircuitJson(opaqueInput, [nearKeepoutTrace]),
    })).toEqual([])
  }
  expect({ inputSrj, trace, circuitJson }).toEqual(snapshot)
})
