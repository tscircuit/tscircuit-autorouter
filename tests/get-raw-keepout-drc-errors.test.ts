import { expect, test } from "bun:test"
import { getRawKeepoutDrcErrors } from "lib/testing/getRawKeepoutDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("raw keepout DRC detects sample24 Net13 through-via copper without imposing routing margins", (): void => {
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
        center: { x: 232.0036, y: 40.4622 },
        width: 0.5334,
        height: 0.5334,
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
  const errors = getRawKeepoutDrcErrors({
    inputSrj,
    jointTraces: [trace],
    circuitJson,
  })
  expect(errors).toHaveLength(1)
  const circuitTrace = circuitJson.find((element) => element.type === "pcb_trace")!
  expect(errors[0]).toMatchObject({
    type: "pcb_trace_error",
    pcb_trace_id: trace.pcb_trace_id,
    source_trace_id: circuitTrace.source_trace_id,
    pcb_keepout_id: "pcb_keepout_altium_arc_4604",
    minimum_clearance: 0,
    actual_clearance: -0.15,
    center: { x, y },
  })
  expect(errors[0]).not.toHaveProperty("pcb_pad_ids")
  expect(errors[0]).not.toHaveProperty("pcb_via_ids")

  const subdividedTrace: SimplifiedPcbTrace = {
    ...trace,
    route: [
      trace.route[0]!,
      { route_type: "wire", x: x - 0.5, y, width: 0.1, layer: "inner1" },
      ...trace.route.slice(1),
    ],
  }
  const subdividedErrors = getRawKeepoutDrcErrors({
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
    getRawKeepoutDrcErrors({
      inputSrj,
      jointTraces: [repeatedContactTrace],
      circuitJson: convertToCircuitJson(inputSrj, [repeatedContactTrace]),
    }),
  ).toEqual(errors)

  const blindSrj = { ...inputSrj, allowBlindAndBuriedVias: true }
  expect(
    getRawKeepoutDrcErrors({
      inputSrj: blindSrj,
      jointTraces: [trace],
      circuitJson: convertToCircuitJson(blindSrj, [trace]),
    }),
  ).toEqual([])

  const clearX = 232.0036 + 0.5334 / 2 + 0.15 + 0.05
  const nearKeepoutTrace: SimplifiedPcbTrace = {
    ...trace,
    route: trace.route.map((point) =>
      "x" in point ? { ...point, x: point.x + clearX - x } : point,
    ),
  }
  expect(
    getRawKeepoutDrcErrors({
      inputSrj,
      jointTraces: [nearKeepoutTrace],
      circuitJson: convertToCircuitJson(inputSrj, [nearKeepoutTrace]),
    }),
  ).toEqual([])
  expect({ inputSrj, trace, circuitJson }).toEqual(snapshot)
})
