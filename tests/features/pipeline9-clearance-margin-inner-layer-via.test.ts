import { expect, test } from "bun:test"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("clearance margin follows an inner-layer transition inside a through-hole via", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      { name: "owner", pointsToConnect: [] },
      { name: "signal", pointsToConnect: [] },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "owner",
      connection_name: "owner",
      route: [
        { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
        { route_type: "wire", x: 0, y: 0, layer: "inner1", width: 0.1 },
        { route_type: "wire", x: 1, y: 0, layer: "inner1", width: 0.1 },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -1, y: 0.28, layer: "bottom", width: 0.1 },
        { route_type: "wire", x: 1, y: 0.28, layer: "bottom", width: 0.1 },
      ],
    },
  ]
  const originalCircuitJson = convertToCircuitJson(srj, traces, {
    minViaDiameter: 0.3,
  })
  const originalVia = originalCircuitJson.find(
    (element) => element.type === "pcb_via",
  )!
  expect(originalVia).toMatchObject({
    layers: ["top", "inner1", "inner2", "bottom"],
  })
  const candidateTraces = structuredClone(traces)
  for (const point of candidateTraces[0]!.route) {
    if (point.route_type !== "wire" && point.route_type !== "via") {
      throw new Error("Expected wire or via geometry in the test route")
    }
    point.y -= 0.0195
  }
  const circuitJson = convertToCircuitJson(srj, candidateTraces, {
    minViaDiameter: 0.3,
  })
  const measurement = getPipeline9ClearanceMarginErrors({
    originalCircuitJson,
    circuitJson,
    targets: [
      {
        type: "pcb_via_trace_clearance_error",
        pcb_trace_id: "signal",
        pcb_via_id: "via_0",
        minimum_clearance: 0.1,
        actual_clearance: 0.08,
      },
    ],
  })
  expect(measurement.status).toBe("measured")
  if (measurement.status !== "measured")
    throw new Error("Expected measurable via identity")
  expect(measurement.errors).toHaveLength(1)
  expect(measurement.errors[0]!.actual_clearance).toBeCloseTo(0.0995, 10)
  expect(measurement.errors[0]!.center).toEqual({ x: 0, y: -0.0195 })
})
