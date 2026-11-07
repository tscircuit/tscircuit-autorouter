import { expect, test } from "bun:test"
import { createPipeline9CopperPourWireDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9CopperPourWireDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 preserves foreign pour layers even when their aliases contain pad ports", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        layers: ["inner1"],
        isCopperPour: true,
        connectedTo: ["GND", "pcb_port_ground"],
      },
    ],
  }
  const evaluate = createPipeline9CopperPourWireDrcEvaluator(srj, srj)
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "power",
    connection_name: "power",
    route: [
      { route_type: "wire", x: -1, y: 0, layer: "inner1", width: 0.1 },
      { route_type: "wire", x: 1, y: 0, layer: "inner1", width: 0.1 },
    ],
  }
  expect(evaluate([trace])).toHaveLength(1)
  expect(evaluate([{ ...trace, connection_name: "GND" }])).toHaveLength(0)
  expect(
    evaluate([
      {
        ...trace,
        route: [
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.45,
            via_hole_diameter: 0.2,
          },
        ],
      },
    ]),
  ).toHaveLength(0)
  expect(
    evaluate([
      {
        ...trace,
        route: trace.route.map((point) => ({
          ...point,
          layer: "bottom",
        })),
      },
    ]),
  ).toHaveLength(0)
})
