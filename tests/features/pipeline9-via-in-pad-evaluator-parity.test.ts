import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { createViaInPadEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createViaInPadEvaluator"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

test("local via-in-pad geometry matches the independent checks oracle", (): void => {
  const pads: Obstacle[] = [
    {
      type: "rect",
      shape: "circle",
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["signal"],
      circuitJsonMetadata: { pcb_smtpad_id: "ball" },
    },
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.8,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["signal"],
      circuitJsonMetadata: { pcb_smtpad_id: "rect" },
    },
    {
      type: "rect",
      center: { x: 0, y: 0 },
      ccwRotationDegrees: 45,
      width: 0.8,
      height: 0.4,
      layers: ["inner1"],
      connectedTo: ["signal"],
      circuitJsonMetadata: { pcb_smtpad_id: "rotated" },
    },
    {
      type: "rect",
      shape: "circle",
      center: { x: 0, y: 0 },
      width: 0.6,
      height: 0.6,
      layers: ["top", "bottom"],
      connectedTo: ["signal"],
      circuitJsonMetadata: { pcb_plated_hole_id: "plated" },
    },
  ]
  for (const obstacle of pads) {
    for (const allowBlindAndBuriedVias of [false, true]) {
      const srj: SimpleRouteJson = {
        layerCount: 4,
        minTraceWidth: 0.1,
        minViaDiameter: 0.6,
        minViaHoleDiameter: 0.2,
        allowBlindAndBuriedVias,
        bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
        connections: [],
        obstacles: [obstacle],
      }
      const evaluate = createViaInPadEvaluator({ srj, previousRoutes: [] })
      for (const x of [-0.6, -0.31, -0.3, -0.29, 0, 0.29, 0.3, 0.31, 0.6]) {
        for (const holeDiameter of [0.1, 0.2, 0.3]) {
          const trace: SimplifiedPcbTrace = {
            type: "pcb_trace",
            pcb_trace_id: "signal_trace",
            connection_name: "signal",
            route: [
              {
                route_type: "via",
                x,
                y: 0.05,
                from_layer: "inner1",
                to_layer: "inner2",
                via_diameter: 0.6,
                via_hole_diameter: holeDiameter,
              },
            ],
          }
          const circuitJson = convertToCircuitJson(srj, [trace])
          const expected = checkViasInPads(circuitJson).length > 0
          expect(evaluate([trace])).toBe(expected)
        }
      }
    }
  }
})
