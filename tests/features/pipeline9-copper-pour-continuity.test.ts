import { expect, test } from "bun:test"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"

test("continuity follows physical pour islands and preserves missing-connection errors", () => {
  const pads: Obstacle[] = [-3, 3].map((x, i) => ({
    type: "rect",
    center: { x, y: 0 },
    width: 0.6,
    height: 0.6,
    layers: ["top"],
    connectedTo: [`pcb_port_${i}`, "GND"],
  }))
  const pours: Obstacle[] = [-1, 1].map((x) => ({
    type: "rect",
    center: { x, y: 0 },
    width: 2,
    height: 2,
    layers: ["inner1"],
    connectedTo: ["GND"],
    isCopperPour: true,
  }))
  const input: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    minViaHoleDiameter: 0.2,
    connections: [
      {
        name: "GND",
        pointsToConnect: [-3, 3].map((x, i) => ({
          x,
          y: 0,
          layer: "top",
          pcb_port_id: `pcb_port_${i}`,
        })),
      },
    ],
    obstacles: [...pads, ...pours],
  }
  const traces: SimplifiedPcbTrace[] = [-3, 3].map((x, i) => ({
    type: "pcb_trace",
    pcb_trace_id: `branch_${i}`,
    connection_name: "GND",
    route: [
      { route_type: "wire", x, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: x / 2, y: 0, layer: "top", width: 0.1 },
      {
        route_type: "via",
        x: x / 2,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.45,
        via_hole_diameter: 0.2,
      },
    ],
  }))
  const missing = (
    srj: SimpleRouteJson,
    routed: SimplifiedPcbTrace[],
  ): unknown[] => {
    const evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: srj,
      srjWithPointPairs: srj,
    })
    return evaluate(routed).errors.filter((e) =>
      String(e.message).includes("missing a connection"),
    )
  }
  expect(missing(input, traces)).toHaveLength(0)
  const split = structuredClone(input)
  split.obstacles[3]!.center.x += 0.2
  expect(missing(split, traces)).toHaveLength(1)
  const otherLayer = structuredClone(input)
  otherLayer.obstacles[3]!.layers = ["inner2"]
  expect(missing(otherLayer, traces)).toHaveLength(1)
  const corner = structuredClone(input)
  corner.obstacles[3]!.center.y = 2
  expect(missing(corner, traces)).toHaveLength(1)
  const foreign = structuredClone(input)
  foreign.obstacles[3]!.connectedTo = ["OTHER"]
  expect(missing(foreign, traces)).toHaveLength(1)
  const disconnected = structuredClone(traces)
  disconnected[1]!.route.pop()
  expect(missing(input, disconnected)).toHaveLength(1)
  const brokenPadApproach = structuredClone(traces)
  const first = brokenPadApproach[1]!.route[0]!
  if (first.route_type !== "wire") throw new Error("Expected pad approach")
  first.x = 2.5
  expect(missing(input, brokenPadApproach)).toHaveLength(1)
})
