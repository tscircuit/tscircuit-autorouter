import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"

test("Pipeline9 checks drill spacing between retained and routed same-net vias", (): void => {
  // Exact two drill sites rejected by core after RVboy's native signal phase.
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    allowViaInPad: true,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.4,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [{ name: "GND", pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: 1.3806, y: 2.245 },
        width: 0.45,
        height: 0.45,
        holeDiameter: 0.2,
        layers: ["top", "inner1", "inner2", "bottom"],
        connectedTo: ["GND", "pcb_via_0"],
        circuitJsonMetadata: { pcb_via_id: "pcb_via_0" },
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "new-via",
      connection_name: "GND",
      route: [
        {
          route_type: "via",
          x: 1.675,
          y: 1.775,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.45,
          via_hole_diameter: 0.2,
        },
      ],
    },
  ]
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs: srj,
    drcOptions: {
      traceClearance: 0.1,
      viaClearance: 0.4,
      includeTraceContinuity: false,
    },
  })
  const result = evaluate(traces)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    minimum_clearance: 0.4,
  })
  expect(result.errors[0]!.actual_clearance).toBeCloseTo(0.35459116473307895, 9)
  expect(
    result.circuitJson.find(
      (e) => e.type === "pcb_via" && e.pcb_via_id === "pcb_via_0",
    ),
  ).toMatchObject({ hole_diameter: 0.2, outer_diameter: 0.45 })
  const moved = structuredClone(traces)
  const via = moved[0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected via")
  via.y -= 0.1
  expect(evaluate(moved).errors).toHaveLength(0)
})
