import { expect, test } from "bun:test"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"

test("plane-return endpoints require physical same-net copper on a via layer", (): void => {
  const plane: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layers: ["inner1"],
    connectedTo: ["ground", "pcb_port_0"],
    isCopperPour: true,
  }
  const via: Obstacle = {
    type: "rect",
    shape: "circle",
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 0.6,
    layers: ["top", "inner1"],
    connectedTo: ["ground", "pcb_port_0", "fixed_via"],
    circuitJsonMetadata: { pcb_via_id: "fixed_via" },
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "plane_return",
    connection_name: "ground",
    connectsTo: ["pcb_port_0"],
    route: [
      { route_type: "wire", x: -3, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
    ],
  }
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: true,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [],
    traces: [trace],
    obstacles: [
      plane,
      via,
      {
        type: "rect",
        center: { x: -3, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["ground", "pcb_port_0"],
        circuitJsonMetadata: {
          pcb_port_id: "pcb_port_0",
          pcb_smtpad_id: "pad",
        },
      },
    ],
  }
  for (const viaKind of ["retained", "routed"] as const) {
    const srj = structuredClone(input)
    if (viaKind === "routed") {
      srj.obstacles.splice(1, 1)
      srj.traces![0]!.route.push(
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.6,
          via_hole_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, layer: "inner1", width: 0.2 },
        { route_type: "wire", x: 0.1, y: 0, layer: "inner1", width: 0.2 },
      )
    }
    for (const change of [
      "none",
      "foreign",
      "distant",
      "wrong-layer",
      "missing",
    ] as const) {
      const candidate = structuredClone(srj)
      const pour = candidate.obstacles[0]!
      if (change === "foreign") pour.connectedTo = ["other"]
      if (change === "distant") pour.center.x = 2
      if (change === "wrong-layer") pour.layers = ["bottom"]
      if (change === "missing") candidate.obstacles.splice(0, 1)
      const result = createPipeline9AutoroutingDrcEvaluator({
        inputSrj: candidate,
        srjWithPointPairs: candidate,
        includeBoardClearance: true,
      })([])
      const endpointErrors = result.errors.filter((error) =>
        String(error.pcb_trace_error_id).startsWith("disconnected_endpoint_"),
      )
      if (change === "none") expect(result.errors).toEqual([])
      else
        expect({
          viaKind,
          change,
          disconnected: endpointErrors.length > 0,
        }).toEqual({ viaKind, change, disconnected: true })
    }
  }
})
